import { readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import {
  fileExists,
  findFileBySuffix,
  isRecord,
  parseJsonLinesFile,
  resolveUserPath,
} from "./usage.jsonl.server";
import { type ModelRequestUsage, tokenUsageSchema, usageTotal } from "./usage.shared";

const codexUsageSchema = z
  .object({
    input_tokens: z.number().int().nonnegative(),
    cached_input_tokens: z.number().int().nonnegative().default(0),
    cache_write_input_tokens: z.number().int().nonnegative().default(0),
    output_tokens: z.number().int().nonnegative(),
    reasoning_output_tokens: z.number().int().nonnegative().default(0),
    total_tokens: z.number().int().nonnegative().optional(),
  })
  .passthrough();

interface CodexTurnState {
  id: string;
  modelId: string | null;
  contextWindowMax: number | null;
  pendingDisplayMessageIds: string[];
  hasDirectUsage: boolean;
}

interface CodexRequest {
  turn: CodexTurnState;
  source: "direct" | "fallback";
  displayMessageIds: string[];
  tokens: ModelRequestUsage["tokens"];
  contextWindowUsed: number;
}

const sessionPathCache = new Map<string, string>();

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function nonnegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function visibleAssistantMessageId(payload: Record<string, unknown>): string | null {
  if (payload.type !== "message" || payload.role !== "assistant") return null;
  const content = payload.content;
  if (!Array.isArray(content)) return null;
  const hasText = content.some(
    (part) =>
      isRecord(part) &&
      part.type === "output_text" &&
      typeof part.text === "string" &&
      part.text.trim().length > 0,
  );
  return hasText ? nonEmptyString(payload.id) : null;
}

function normalizeCodexUsage(value: unknown) {
  const parsed = codexUsageSchema.safeParse(value);
  if (!parsed.success) throw new Error("Codex token usage has an unsupported schema");
  const stored = parsed.data;
  const cacheRead = Math.min(stored.cached_input_tokens, stored.input_tokens);
  const cacheWrite = Math.min(
    stored.cache_write_input_tokens,
    stored.input_tokens - cacheRead,
  );
  const reasoning = Math.min(stored.reasoning_output_tokens, stored.output_tokens);
  const tokens = tokenUsageSchema.parse({
    input: stored.input_tokens - cacheRead - cacheWrite,
    cacheRead,
    cacheWrite,
    reasoning,
    output: stored.output_tokens - reasoning,
  });
  return {
    tokens,
    contextWindowUsed: stored.total_tokens ?? usageTotal(tokens),
  };
}

export function parseCodexRequests(records: readonly unknown[]): ModelRequestUsage[] {
  const turns = new Map<string, CodexTurnState>();
  let parsedRequests: CodexRequest[] = [];
  const responseIds = new Set<string>();
  const directTurnIds = new Set<string>();
  let activeTurnId: string | null = null;

  for (const record of records) {
    if (!isRecord(record) || record.type !== "token_usage_record" || !isRecord(record.payload)) {
      continue;
    }
    const turnId = nonEmptyString(record.payload.turn_id);
    if (turnId) directTurnIds.add(turnId);
  }

  function getTurn(turnId: string): CodexTurnState {
    const existing = turns.get(turnId);
    if (existing) return existing;
    const created: CodexTurnState = {
      id: turnId,
      modelId: null,
      contextWindowMax: null,
      pendingDisplayMessageIds: [],
      hasDirectUsage: directTurnIds.has(turnId),
    };
    turns.set(turnId, created);
    return created;
  }

  function addUsage(turn: CodexTurnState, value: unknown, source: CodexRequest["source"]): void {
    const normalized = normalizeCodexUsage(value);
    parsedRequests.push({
      turn,
      source,
      displayMessageIds: turn.pendingDisplayMessageIds,
      tokens: normalized.tokens,
      contextWindowUsed: normalized.contextWindowUsed,
    });
    turn.pendingDisplayMessageIds = [];
  }

  for (const record of records) {
    if (!isRecord(record)) continue;
    const payload = isRecord(record.payload) ? record.payload : null;
    if (!payload) continue;

    if (record.type === "turn_context") {
      const turnId = nonEmptyString(payload.turn_id);
      if (!turnId) continue;
      activeTurnId = turnId;
      getTurn(turnId).modelId = nonEmptyString(payload.model);
      continue;
    }

    if (record.type === "response_item" && activeTurnId) {
      const messageId = visibleAssistantMessageId(payload);
      if (messageId) getTurn(activeTurnId).pendingDisplayMessageIds.push(messageId);
      continue;
    }

    if (record.type === "token_usage_record") {
      const turnId = nonEmptyString(payload.turn_id) ?? activeTurnId;
      if (!turnId) continue;
      const responseId = nonEmptyString(payload.response_id);
      if (responseId && responseIds.has(responseId)) continue;
      if (responseId) responseIds.add(responseId);
      const turn = getTurn(turnId);
      turn.hasDirectUsage = true;
      addUsage(turn, payload.usage, "direct");
      continue;
    }

    if (record.type !== "event_msg") continue;
    if (payload.type === "task_started") {
      const turnId = nonEmptyString(payload.turn_id);
      if (!turnId) continue;
      activeTurnId = turnId;
      const turn = getTurn(turnId);
      turn.contextWindowMax = positiveInteger(payload.model_context_window);
      continue;
    }
    if (payload.type === "task_complete") {
      activeTurnId = null;
      continue;
    }
    if (payload.type === "thread_rolled_back") {
      const message = isRecord(payload.msg) ? payload.msg : payload;
      const count = nonnegativeInteger(message.num_turns) ?? nonnegativeInteger(message.numTurns) ?? 0;
      if (count === 0) continue;
      const removedTurnIds = [...turns.keys()].slice(-count);
      const removed = new Set(removedTurnIds);
      parsedRequests = parsedRequests.filter((request) => !removed.has(request.turn.id));
      for (const turnId of removedTurnIds) turns.delete(turnId);
      if (activeTurnId && removed.has(activeTurnId)) activeTurnId = null;
      continue;
    }
    if (payload.type !== "token_count" || !activeTurnId) continue;
    const info = isRecord(payload.info) ? payload.info : null;
    if (!info) continue;
    const turn = getTurn(activeTurnId);
    turn.contextWindowMax = positiveInteger(info.model_context_window) ?? turn.contextWindowMax;
    if (!turn.hasDirectUsage) addUsage(turn, info.last_token_usage, "fallback");
  }

  return parsedRequests
    .filter((request) => request.source === "direct" || !request.turn.hasDirectUsage)
    .map((request) => ({
      turnId: request.turn.id,
      displayMessageIds: request.displayMessageIds,
      modelId: request.turn.modelId,
      tokens: request.tokens,
      hasVisibleText: request.displayMessageIds.length > 0,
      contextWindowUsed: request.contextWindowUsed,
      contextWindowMax: request.turn.contextWindowMax,
    }));
}

function resolveCodexHome(): string {
  return resolveUserPath(process.env.CODEX_HOME?.trim() || join(homedir(), ".codex"));
}

async function stateDatabasePaths(codexHome: string): Promise<string[]> {
  const configured = process.env.CODEX_SQLITE_HOME?.trim();
  const sqliteHome = configured ? resolveUserPath(configured) : codexHome;
  if (sqliteHome.endsWith(".sqlite") && (await fileExists(sqliteHome))) return [sqliteHome];
  let entries;
  try {
    entries = await readdir(sqliteHome, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && /^state_\d+\.sqlite$/u.test(entry.name))
    .map((entry) => join(sqliteHome, entry.name))
    .sort((left, right) => right.localeCompare(left, "en", { numeric: true }));
}

async function sessionFileFromStateDatabase(
  codexHome: string,
  sessionId: string,
): Promise<string | null> {
  for (const databasePath of await stateDatabasePaths(codexHome)) {
    try {
      const database = new DatabaseSync(databasePath, { readOnly: true });
      try {
        database.exec("PRAGMA query_only = ON");
        const row = database
          .prepare("SELECT rollout_path AS rolloutPath FROM threads WHERE id = ?")
          .get(sessionId);
        if (!isRecord(row)) continue;
        const rolloutPath = nonEmptyString(row.rolloutPath);
        if (rolloutPath && (await fileExists(rolloutPath))) return rolloutPath;
      } finally {
        database.close();
      }
    } catch {
      // Older Codex databases can use a different schema. File discovery is the fallback.
    }
  }
  return null;
}

async function resolveCodexSessionFile(
  sessionId: string,
  nativeHandle?: string,
): Promise<string | null> {
  if (nativeHandle?.endsWith(".jsonl")) {
    const direct = isAbsolute(nativeHandle) ? nativeHandle : resolveUserPath(nativeHandle);
    if (await fileExists(direct)) return direct;
  }

  const codexHome = resolveCodexHome();
  const cacheKey = `${codexHome}\0${sessionId}`;
  const cached = sessionPathCache.get(cacheKey);
  if (cached && (await fileExists(cached))) return cached;

  const databaseMatch = await sessionFileFromStateDatabase(codexHome, sessionId);
  if (databaseMatch) {
    sessionPathCache.set(cacheKey, databaseMatch);
    return databaseMatch;
  }

  const fileNameSuffix = `${sessionId}.jsonl`;
  for (const root of [join(codexHome, "sessions"), join(codexHome, "archived_sessions")]) {
    const match = await findFileBySuffix(root, fileNameSuffix);
    if (match) {
      sessionPathCache.set(cacheKey, match);
      return match;
    }
  }
  return null;
}

export async function readCodexRequests(
  sessionId: string,
  nativeHandle?: string,
): Promise<ModelRequestUsage[]> {
  const filePath = await resolveCodexSessionFile(sessionId, nativeHandle);
  if (!filePath) return [];
  return parseCodexRequests(await parseJsonLinesFile(filePath, "Codex rollout"));
}
