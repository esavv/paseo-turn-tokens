import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { type ModelRequestUsage, tokenUsageSchema } from "./usage.shared";

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

export function readOpenCodeRequests(sessionId: string): ModelRequestUsage[] {
  const database = new DatabaseSync(resolveDatabasePath(), { readOnly: true });
  try {
    database.exec("PRAGMA query_only = ON");
    const session = database.prepare("SELECT id FROM session WHERE id = ?").get(sessionId);
    if (!session) return [];

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
    return requests;
  } finally {
    database.close();
  }
}
