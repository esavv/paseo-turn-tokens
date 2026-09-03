import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import {
  fileExists,
  findFileBySuffix,
  isRecord,
  parseJsonLinesFile,
  resolveUserPath,
} from "./usage.jsonl.server";
import { type ModelRequestUsage, tokenUsageSchema, usageTotal } from "./usage.shared";

const piUsageSchema = z
  .object({
    input: z.number().int().nonnegative().default(0),
    output: z.number().int().nonnegative().default(0),
    cacheRead: z.number().int().nonnegative().default(0),
    cacheWrite: z.number().int().nonnegative().default(0),
    reasoning: z.number().int().nonnegative().default(0),
    totalTokens: z.number().int().nonnegative().optional(),
  })
  .passthrough();

interface PiEntry {
  id: string;
  parentId: string | null;
  source: Record<string, unknown>;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizePiUsage(value: unknown) {
  const parsed = piUsageSchema.safeParse(value);
  if (!parsed.success) throw new Error("Pi token usage has an unsupported schema");
  const stored = parsed.data;
  const reasoning = Math.min(stored.reasoning, stored.output);
  const tokens = tokenUsageSchema.parse({
    input: stored.input,
    cacheRead: stored.cacheRead,
    cacheWrite: stored.cacheWrite,
    reasoning,
    output: stored.output - reasoning,
  });
  return {
    tokens,
    contextWindowUsed: stored.totalTokens ?? usageTotal(tokens),
  };
}

function activePath(records: readonly unknown[]): PiEntry[] {
  const entries: PiEntry[] = [];
  const byId = new Map<string, PiEntry>();
  for (const record of records) {
    if (!isRecord(record) || record.type === "session") continue;
    const id = nonEmptyString(record.id);
    if (!id) continue;
    const parentId = record.parentId === null ? null : nonEmptyString(record.parentId);
    const entry = { id, parentId, source: record };
    entries.push(entry);
    byId.set(id, entry);
  }

  const path: PiEntry[] = [];
  const visited = new Set<string>();
  let current: PiEntry | undefined = entries[entries.length - 1];
  while (current) {
    if (visited.has(current.id)) throw new Error("Pi session contains a cyclic entry tree");
    visited.add(current.id);
    path.push(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path.reverse();
}

function contextPath(path: readonly PiEntry[]): PiEntry[] {
  let compactionIndex = -1;
  for (let index = 0; index < path.length; index += 1) {
    if (path[index]?.source.type === "compaction") compactionIndex = index;
  }
  if (compactionIndex < 0) return [...path];

  const compaction = path[compactionIndex];
  if (!compaction) return [...path];
  const firstKeptEntryId = nonEmptyString(compaction.source.firstKeptEntryId);
  const projected = [compaction];
  if (firstKeptEntryId) {
    const firstKeptIndex = path.findIndex((entry) => entry.id === firstKeptEntryId);
    if (firstKeptIndex >= 0 && firstKeptIndex < compactionIndex) {
      projected.push(...path.slice(firstKeptIndex, compactionIndex));
    }
  }
  projected.push(...path.slice(compactionIndex + 1));
  return projected;
}

function hasVisibleText(content: unknown): boolean {
  if (typeof content === "string") return content.trim().length > 0;
  return (
    Array.isArray(content) &&
    content.some(
      (part) =>
        isRecord(part) &&
        part.type === "text" &&
        typeof part.text === "string" &&
        part.text.trim().length > 0,
    )
  );
}

function modelId(message: Record<string, unknown>): string | null {
  const provider = nonEmptyString(message.provider);
  const model = nonEmptyString(message.model);
  return provider && model ? `${provider}/${model}` : null;
}

function usageRequest(
  turnId: string,
  value: unknown,
  options: {
    displayMessageIds?: string[];
    modelId?: string | null;
    hasVisibleText?: boolean;
  } = {},
): ModelRequestUsage {
  const normalized = normalizePiUsage(value);
  return {
    turnId,
    displayMessageIds: options.displayMessageIds ?? [],
    modelId: options.modelId ?? null,
    tokens: normalized.tokens,
    hasVisibleText: options.hasVisibleText ?? false,
    contextWindowUsed: normalized.contextWindowUsed,
  };
}

export function parsePiRequests(records: readonly unknown[]): ModelRequestUsage[] {
  const requests: ModelRequestUsage[] = [];
  let activeTurnId: string | null = null;
  let assistantIndex = 0;

  for (const entry of contextPath(activePath(records))) {
    const type = entry.source.type;
    if (type === "message") {
      const message = isRecord(entry.source.message) ? entry.source.message : null;
      if (!message) continue;
      if (message.role === "user") {
        activeTurnId = entry.id;
        continue;
      }
      if (message.role === "assistant") {
        assistantIndex += 1;
        if (!activeTurnId || message.usage === undefined) continue;
        const visibleText = hasVisibleText(message.content);
        const responseId =
          nonEmptyString(message.responseId) ?? `pi-history-assistant-${assistantIndex}`;
        requests.push(
          usageRequest(activeTurnId, message.usage, {
            displayMessageIds: visibleText ? [responseId] : [],
            modelId: modelId(message),
            hasVisibleText: visibleText,
          }),
        );
        continue;
      }
      if (message.role === "toolResult" && activeTurnId && message.usage !== undefined) {
        requests.push(usageRequest(activeTurnId, message.usage));
      }
      continue;
    }

    if (
      activeTurnId &&
      (type === "compaction" || type === "branch_summary") &&
      entry.source.usage !== undefined
    ) {
      requests.push(usageRequest(activeTurnId, entry.source.usage));
    }
  }
  return requests;
}

function resolveConfiguredPath(value: string, cwd: string): string {
  if (value === "~" || value.startsWith("~/")) return resolveUserPath(value);
  return isAbsolute(value) ? value : resolve(cwd, value);
}

async function sessionDirFromSettings(filePath: string, cwd: string): Promise<string | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
    if (!isRecord(parsed)) return null;
    const sessionDir = nonEmptyString(parsed.sessionDir);
    return sessionDir ? resolveConfiguredPath(sessionDir, cwd) : null;
  } catch {
    return null;
  }
}

function encodedProjectDirectory(cwd: string): string {
  return `--${resolve(cwd).replace(/^[/\\]/u, "").replace(/[/\\:]/gu, "-")}--`;
}

async function resolvePiSessionFile(
  sessionId: string,
  cwd: string,
  nativeHandle?: string,
): Promise<string | null> {
  if (nativeHandle?.trim()) {
    const direct = resolveConfiguredPath(nativeHandle, cwd);
    if (await fileExists(direct)) return direct;
  }

  const agentDir = resolveConfiguredPath(
    process.env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent"),
    cwd,
  );
  const envSessionDir = process.env.PI_CODING_AGENT_SESSION_DIR?.trim();
  const projectSessionDir = await sessionDirFromSettings(join(cwd, ".pi", "settings.json"), cwd);
  const globalSessionDir = await sessionDirFromSettings(join(agentDir, "settings.json"), cwd);
  const roots = [
    envSessionDir ? resolveConfiguredPath(envSessionDir, cwd) : null,
    projectSessionDir,
    globalSessionDir,
    join(agentDir, "sessions"),
  ].flatMap((value) => (value ? [value] : []));

  const suffix = `${sessionId}.jsonl`;
  for (const root of roots) {
    const expectedRoot =
      root === join(agentDir, "sessions") ? join(root, encodedProjectDirectory(cwd)) : root;
    const match =
      (await findFileBySuffix(expectedRoot, suffix)) ??
      (expectedRoot === root ? null : await findFileBySuffix(root, suffix));
    if (match) return match;
  }
  return null;
}

export async function readPiRequests(
  sessionId: string,
  cwd: string,
  nativeHandle?: string,
): Promise<ModelRequestUsage[]> {
  const filePath = await resolvePiSessionFile(sessionId, cwd, nativeHandle);
  if (!filePath) return [];
  return parsePiRequests(await parseJsonLinesFile(filePath, "Pi session"));
}
