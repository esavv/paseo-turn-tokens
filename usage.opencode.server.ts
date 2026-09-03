import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import {
  type ModelRequestUsage,
  type ProviderUsage,
  type TokenUsage,
  tokenUsageSchema,
} from "./usage.shared";

const assistantMessageSchema = z
  .object({
    role: z.literal("assistant"),
    parentID: z.string().nullable().optional(),
    providerID: z.string().optional(),
    modelID: z.string().optional(),
    summary: z.boolean().default(false),
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

export function parseOpenCodeUsage(
  rows: readonly unknown[],
  visibleMessageIds: ReadonlySet<string>,
  compactionMessageIds: readonly string[],
): ProviderUsage {
  const requests: ModelRequestUsage[] = [];
  const compactionTokens = new Map<string, TokenUsage>();
  const compactionMessageIdSet = new Set(compactionMessageIds);
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
    if (parsed.data.summary) {
      if (tokens && parsed.data.parentID && compactionMessageIdSet.has(parsed.data.parentID)) {
        compactionTokens.set(parsed.data.parentID, tokens);
      }
      continue;
    }
    requests.push({
      turnId: parsed.data.parentID ?? messageId,
      displayMessageIds: [messageId],
      modelId:
        parsed.data.providerID && parsed.data.modelID
          ? `${parsed.data.providerID}/${parsed.data.modelID}`
          : null,
      tokens,
      hasVisibleText: visibleMessageIds.has(messageId),
    });
  }
  return {
    requests,
    compactions: compactionMessageIds.map((messageId) => compactionTokens.get(messageId) ?? null),
  };
}

export function readOpenCodeUsage(sessionId: string): ProviderUsage {
  const database = new DatabaseSync(resolveDatabasePath(), { readOnly: true });
  try {
    database.exec("PRAGMA query_only = ON");
    const session = database.prepare("SELECT id FROM session WHERE id = ?").get(sessionId);
    if (!session) return { requests: [], compactions: [] };

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

    const compactionMessageIds = database
      .prepare(
        `SELECT message_id AS messageId
         FROM part
         WHERE session_id = ?
           AND json_valid(data)
           AND json_extract(data, '$.type') = 'compaction'
         ORDER BY time_created, id`,
      )
      .all(sessionId)
      .map((row) => {
        if (!isRecord(row)) throw new Error("OpenCode returned an invalid compaction-part row");
        return stringField(row.messageId, "compaction message ID");
      });
    const rows = database
      .prepare(
        `SELECT id, data
         FROM message
         WHERE session_id = ?
         ORDER BY time_created, id`,
      )
      .all(sessionId);

    return parseOpenCodeUsage(rows, visibleMessageIds, compactionMessageIds);
  } finally {
    database.close();
  }
}
