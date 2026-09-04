import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  fileExists,
  findFileByName,
  isRecord,
  parseJsonLinesFile,
  resolveUserPath,
} from "./usage.jsonl.server";
import { type ModelRequestUsage, tokenUsageSchema, usageTotal } from "./usage.shared";

const projectDirLengthCap = 200;

const claudeEntrySchema = z
  .object({
    type: z.string(),
    uuid: z.string().optional(),
    requestId: z.string().optional(),
    isSidechain: z.boolean().optional(),
    isMeta: z.boolean().optional(),
    isSynthetic: z.boolean().optional(),
    isCompactSummary: z.boolean().optional(),
    message: z
      .object({
        id: z.string().optional(),
        role: z.string().optional(),
        model: z.string().optional(),
        content: z.unknown().optional(),
        usage: z.unknown().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const claudeUsageSchema = z
  .object({
    input_tokens: z.number().int().nonnegative().default(0),
    cache_creation_input_tokens: z.number().int().nonnegative().default(0),
    cache_read_input_tokens: z.number().int().nonnegative().default(0),
    output_tokens: z.number().int().nonnegative().default(0),
    thinking_tokens: z.number().int().nonnegative().optional(),
    output_tokens_details: z
      .object({ thinking_tokens: z.number().int().nonnegative().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();

interface ClaudeRequest {
  turnId: string;
  transcriptMessageId: string | null;
  apiMessageId: string | null;
  modelId: string | null;
  tokens: ModelRequestUsage["tokens"];
  hasVisibleText: boolean;
  contextWindowUsed: number | null;
}

function contentBlocks(content: unknown): Record<string, unknown>[] {
  if (!Array.isArray(content)) return [];
  return content.filter(isRecord);
}

function hasVisibleAssistantText(content: unknown): boolean {
  if (typeof content === "string") return content.trim().length > 0;
  return contentBlocks(content).some(
    (block) => block.type === "text" && typeof block.text === "string" && block.text.trim().length > 0,
  );
}

function isVisibleUserEntry(entry: z.output<typeof claudeEntrySchema>): boolean {
  if (
    entry.type !== "user" ||
    entry.isSidechain === true ||
    entry.isMeta === true ||
    entry.isSynthetic === true ||
    entry.isCompactSummary === true
  ) {
    return false;
  }
  const content = entry.message?.content;
  if (contentBlocks(content).some((block) => block.type === "tool_result")) return false;
  if (typeof content === "string") return content.trim().length > 0;
  return contentBlocks(content).some((block) => block.type === "text" || block.type === "image");
}

function normalizeClaudeUsage(value: unknown) {
  const parsed = claudeUsageSchema.safeParse(value);
  if (!parsed.success) throw new Error("Claude assistant usage has an unsupported schema");
  const stored = parsed.data;
  const reportedReasoning =
    stored.output_tokens_details?.thinking_tokens ?? stored.thinking_tokens ?? 0;
  const reasoning = Math.min(reportedReasoning, stored.output_tokens);
  return tokenUsageSchema.parse({
    input: stored.input_tokens,
    cacheRead: stored.cache_read_input_tokens,
    cacheWrite: stored.cache_creation_input_tokens,
    reasoning,
    output: stored.output_tokens - reasoning,
  });
}

function uniqueMessageIds(request: ClaudeRequest): string[] {
  return [...new Set([request.transcriptMessageId, request.apiMessageId].filter(Boolean))].flatMap(
    (value) => (typeof value === "string" ? [value] : []),
  );
}

export function parseClaudeRequests(records: readonly unknown[]): ModelRequestUsage[] {
  const requests = new Map<string, ClaudeRequest>();
  let activeTurnId: string | null = null;

  for (const record of records) {
    const result = claudeEntrySchema.safeParse(record);
    if (!result.success) continue;
    const entry = result.data;
    if (isVisibleUserEntry(entry) && entry.uuid) {
      activeTurnId = entry.uuid;
      continue;
    }
    if (
      entry.type !== "assistant" ||
      entry.isSidechain === true ||
      entry.message?.role !== "assistant" ||
      !activeTurnId
    ) {
      continue;
    }

    const apiMessageId = entry.message.id?.trim() || null;
    const transcriptMessageId = entry.uuid?.trim() || null;
    const requestId = entry.requestId?.trim() || null;
    const identity =
      requestId && apiMessageId
        ? `${requestId}\0${apiMessageId}`
        : requestId || apiMessageId || transcriptMessageId;
    if (!identity) continue;
    const key = `${activeTurnId}\0${identity}`;
    const visibleText = hasVisibleAssistantText(entry.message.content);
    const stored = requests.get(key) ?? {
      turnId: activeTurnId,
      transcriptMessageId: null,
      apiMessageId,
      modelId: entry.message.model?.trim() || null,
      tokens: null,
      hasVisibleText: false,
      contextWindowUsed: null,
    };

    if (entry.message.usage !== undefined) {
      stored.tokens = normalizeClaudeUsage(entry.message.usage);
      stored.contextWindowUsed = usageTotal(stored.tokens);
    }
    if (visibleText) {
      stored.hasVisibleText = true;
      stored.transcriptMessageId = transcriptMessageId;
    }
    stored.apiMessageId = apiMessageId ?? stored.apiMessageId;
    stored.modelId = entry.message.model?.trim() || stored.modelId;
    requests.set(key, stored);
  }

  return [...requests.values()].map((request) => ({
    turnId: request.turnId,
    displayMessageIds: uniqueMessageIds(request),
    modelId: request.modelId,
    tokens: request.tokens,
    hasVisibleText: request.hasVisibleText,
    contextWindowUsed: request.contextWindowUsed,
  }));
}

function hashSuffix(input: string): string {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) - hash + input.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function encodeProjectPath(input: string): string {
  const replaced = input.replace(/[^a-zA-Z0-9]/g, "-");
  return replaced.length <= projectDirLengthCap
    ? replaced
    : `${replaced.slice(0, projectDirLengthCap)}-${hashSuffix(input)}`;
}

async function resolveClaudeSessionFile(sessionId: string, cwd: string): Promise<string | null> {
  const configDir = resolveUserPath(process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), ".claude"));
  const projectsRoot = join(configDir, "projects");
  const canonicalCwd = await realpath(cwd).catch(() => cwd);
  const configuredProjectDir = process.env.CLAUDE_CODE_PROJECT_DIR_NAME?.trim();
  const projectDir = configuredProjectDir || encodeProjectPath(canonicalCwd.normalize("NFC"));
  const expected = join(projectsRoot, projectDir, `${sessionId}.jsonl`);
  if (await fileExists(expected)) return expected;
  return findFileByName(projectsRoot, `${sessionId}.jsonl`);
}

export async function readClaudeRequests(
  sessionId: string,
  cwd: string,
): Promise<ModelRequestUsage[]> {
  const filePath = await resolveClaudeSessionFile(sessionId, cwd);
  if (!filePath) return [];
  return parseClaudeRequests(await parseJsonLinesFile(filePath, "Claude transcript"));
}
