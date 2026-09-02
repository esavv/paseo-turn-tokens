import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { z } from "zod";
import {
  aggregateTurnUsage,
  getAgentUsage,
  type ModelRequestUsage,
  summarizeSessionUsage,
  tokenUsageSchema,
} from "./usage.shared";

const modelCacheDurationMs = 5 * 60 * 1_000;
const modelLimitCache = new Map<string, { expiresAt: number; limits: ReadonlyMap<string, number> }>();
const pendingModelLimits = new Map<string, Promise<ReadonlyMap<string, number>>>();

const assistantMessageSchema = z
  .object({
    role: z.literal("assistant"),
    parentID: z.string().nullable().optional(),
    providerID: z.string().optional(),
    modelID: z.string().optional(),
    time: z.object({ completed: z.number().finite().optional() }).passthrough(),
    tokens: z
      .object({
        input: z.number().finite().nonnegative().default(0),
        output: z.number().finite().nonnegative().default(0),
        reasoning: z.number().finite().nonnegative().default(0),
        cache: z
          .object({
            read: z.number().finite().nonnegative().default(0),
            write: z.number().finite().nonnegative().default(0),
          })
          .default({ read: 0, write: 0 }),
      })
      .optional(),
  })
  .passthrough();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown, name: string): string {
  if (typeof value !== "string") throw new Error(`OpenCode returned an invalid ${name}`);
  return value;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error("OpenCode message data contains invalid JSON");
  }
}

function resolveDatabasePath(): string {
  const configured = process.env.OPENCODE_DB?.trim();
  if (configured) return configured;
  const dataHome = process.env.XDG_DATA_HOME?.trim() || join(homedir(), ".local", "share");
  return join(dataHome, "opencode", "opencode.db");
}

function readRequests(sessionId: string): {
  requests: ModelRequestUsage[];
  compactionCount: number;
} {
  const database = new DatabaseSync(resolveDatabasePath(), { readOnly: true });
  try {
    database.exec("PRAGMA query_only = ON");
    const session = database.prepare("SELECT id FROM session WHERE id = ?").get(sessionId);
    if (!session) return { requests: [], compactionCount: 0 };

    const compactionRow = database
      .prepare(
        `SELECT COUNT(DISTINCT id) AS count
         FROM part
         WHERE session_id = ?
           AND json_valid(data)
           AND json_extract(data, '$.type') = 'compaction'`,
      )
      .get(sessionId);
    if (!isRecord(compactionRow)) {
      throw new Error("OpenCode returned an invalid compaction count");
    }
    const compactionCount = compactionRow.count;
    if (
      typeof compactionCount !== "number" ||
      !Number.isInteger(compactionCount) ||
      compactionCount < 0
    ) {
      throw new Error("OpenCode returned an invalid compaction count");
    }

    const visibleMessageIds = new Set(
      database
        .prepare(
          `SELECT DISTINCT message_id AS messageId
           FROM part
           WHERE session_id = ?
             AND json_valid(data)
             AND json_extract(data, '$.type') = 'text'
             AND trim(COALESCE(json_extract(data, '$.text'), '')) <> ''`,
        )
        .all(sessionId)
        .map((row) => {
          if (!isRecord(row)) throw new Error("OpenCode returned an invalid text-part row");
          return stringField(row.messageId, "part message ID");
        }),
    );

    const requests: ModelRequestUsage[] = [];
    const rows = database
      .prepare(
        `SELECT id, data
         FROM message
         WHERE session_id = ?
         ORDER BY time_created, id`,
      )
      .all(sessionId);

    for (const row of rows) {
      if (!isRecord(row)) throw new Error("OpenCode returned an invalid message row");
      const messageId = stringField(row.id, "message ID");
      const source = parseJson(stringField(row.data, "message data"));
      if (!isRecord(source) || source.role !== "assistant") continue;
      const parsed = assistantMessageSchema.safeParse(source);
      if (!parsed.success) {
        throw new Error("OpenCode assistant message usage has an unsupported schema");
      }

      const stored = parsed.data.tokens;
      const tokens =
        parsed.data.time.completed === undefined || stored === undefined
          ? null
          : tokenUsageSchema.parse({
              input: stored.input,
              cacheRead: stored.cache.read,
              cacheWrite: stored.cache.write,
              reasoning: stored.reasoning,
              output: stored.output,
            });
      requests.push({
        messageId,
        parentMessageId: parsed.data.parentID ?? null,
        providerId: parsed.data.providerID ?? null,
        modelId: parsed.data.modelID ?? null,
        tokens,
        hasVisibleText: visibleMessageIds.has(messageId),
      });
    }
    return { requests, compactionCount };
  } finally {
    database.close();
  }
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

async function loadModelLimits(
  paseo: PluginHandlerContext["paseo"],
  cwd: string,
): Promise<ReadonlyMap<string, number>> {
  const response = await paseo.providers.listModels("opencode", { cwd });
  const limits = new Map<string, number>();
  for (const model of response.models ?? []) {
    const metadataLimit = positiveNumber(model.metadata?.contextWindowMaxTokens);
    const limit = positiveNumber(model.contextWindowMaxTokens) ?? metadataLimit;
    if (limit !== undefined) limits.set(model.id, limit);
  }
  return limits;
}

function modelLimits(
  paseo: PluginHandlerContext["paseo"],
  cwd: string,
): Promise<ReadonlyMap<string, number>> {
  const cached = modelLimitCache.get(cwd);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.limits);
  const pending = pendingModelLimits.get(cwd);
  if (pending) return pending;

  const request = loadModelLimits(paseo, cwd)
    .then((limits) => {
      modelLimitCache.set(cwd, { expiresAt: Date.now() + modelCacheDurationMs, limits });
      return limits;
    })
    .finally(() => pendingModelLimits.delete(cwd));
  pendingModelLimits.set(cwd, request);
  return request;
}

export async function collectAgentUsage(
  { agentId }: z.output<typeof getAgentUsage.input>,
  { paseo }: PluginHandlerContext,
): Promise<z.input<typeof getAgentUsage.output>> {
  const result = await paseo.agents.ref(agentId).refresh();
  const emptySession = summarizeSessionUsage([], 0);
  if (!result) return { session: emptySession, turns: [] };
  const { agent } = result;
  if (agent.provider !== "opencode") return { session: emptySession, turns: [] };

  const sessionId = agent.runtimeInfo?.sessionId ?? agent.persistence?.sessionId;
  if (!sessionId) return { session: emptySession, turns: [] };
  const stored = readRequests(sessionId);

  let limits: ReadonlyMap<string, number> = new Map();
  try {
    limits = await modelLimits(paseo, agent.cwd);
  } catch {
    // Token usage is still useful when model metadata is temporarily unavailable.
  }
  return {
    session: summarizeSessionUsage(stored.requests, stored.compactionCount),
    turns: aggregateTurnUsage(stored.requests, limits),
  };
}
