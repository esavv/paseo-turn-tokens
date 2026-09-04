import { defineRpc } from "@getpaseo/plugin/server";
import { z } from "zod";

export const tokenUsageSchema = z.object({
  input: z.number().int().nonnegative(),
  cacheRead: z.number().int().nonnegative(),
  cacheWrite: z.number().int().nonnegative(),
  reasoning: z.number().int().nonnegative(),
  output: z.number().int().nonnegative(),
});

export const turnUsageSchema = z.object({
  displayMessageIds: z.array(z.string()).min(1),
  responseIndex: z.number().int().positive(),
  requestCount: z.number().int().positive(),
  modelChange: z
    .object({
      from: z.string().min(1),
      to: z.string().min(1),
    })
    .optional(),
  tokens: tokenUsageSchema,
  contextWindow: z
    .object({
      used: z.number().int().nonnegative(),
      max: z.number().int().positive(),
    })
    .nullable(),
});

export const compactionUsageSchema = z.object({
  timestamp: z.number().int().nonnegative(),
  trigger: z.enum(["auto", "manual"]).optional(),
  tokens: tokenUsageSchema,
});

export const getAgentUsage = defineRpc({
  name: "usage.get-agent",
  input: z.object({ agentId: z.string().min(1) }),
  output: z.object({
    turns: z.array(turnUsageSchema),
    compactions: z.array(compactionUsageSchema),
  }),
});

export type TokenUsage = z.output<typeof tokenUsageSchema>;
export type TurnUsage = z.output<typeof turnUsageSchema>;
export type CompactionUsage = z.output<typeof compactionUsageSchema>;

export interface ModelRequestUsage {
  turnId: string;
  displayMessageIds: readonly string[];
  modelId: string | null;
  tokens: TokenUsage | null;
  hasVisibleText: boolean;
  contextWindowUsed?: number | null;
  contextWindowMax?: number | null;
}

export interface ProviderUsage {
  requests: ModelRequestUsage[];
  compactions: CompactionUsage[];
}

const compactionMatchWindowMs = 5 * 60 * 1_000;

export function findCompactionUsage(
  compactions: readonly CompactionUsage[],
  timestamp: number,
): CompactionUsage | undefined {
  let closest: CompactionUsage | undefined;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const compaction of compactions) {
    const distance = Math.abs(compaction.timestamp - timestamp);
    if (distance < closestDistance) {
      closest = compaction;
      closestDistance = distance;
    }
  }
  return closestDistance <= compactionMatchWindowMs ? closest : undefined;
}

const zeroUsage: TokenUsage = {
  input: 0,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: 0,
  output: 0,
};

export function usageTotal(tokens: TokenUsage): number {
  return tokens.input + tokens.cacheRead + tokens.cacheWrite + tokens.reasoning + tokens.output;
}

export function sumUsage(left: TokenUsage, right: TokenUsage): TokenUsage {
  return {
    input: left.input + right.input,
    cacheRead: left.cacheRead + right.cacheRead,
    cacheWrite: left.cacheWrite + right.cacheWrite,
    reasoning: left.reasoning + right.reasoning,
    output: left.output + right.output,
  };
}

export function aggregateTurnUsage(
  requests: readonly ModelRequestUsage[],
  contextLimits: ReadonlyMap<string, number>,
): TurnUsage[] {
  const groups = new Map<
    string,
    {
      displayMessageIds: readonly string[];
      requestCount: number;
      tokens: TokenUsage;
      lastCompleted: ModelRequestUsage | null;
    }
  >();

  for (const request of requests) {
    const group = groups.get(request.turnId) ?? {
      displayMessageIds: [],
      requestCount: 0,
      tokens: zeroUsage,
      lastCompleted: null,
    };

    if (request.hasVisibleText && request.tokens && request.displayMessageIds.length > 0) {
      group.displayMessageIds = request.displayMessageIds;
    }
    if (request.tokens) {
      group.requestCount += 1;
      group.tokens = sumUsage(group.tokens, request.tokens);
      group.lastCompleted = request;
    }
    groups.set(request.turnId, group);
  }

  const turns: TurnUsage[] = [];
  let previousModelId: string | null = null;
  for (const group of groups.values()) {
    if (group.displayMessageIds.length === 0 || !group.lastCompleted || group.requestCount === 0) {
      continue;
    }
    const { contextWindowMax, contextWindowUsed, modelId, tokens } = group.lastCompleted;
    const contextMax = contextWindowMax ?? (modelId ? contextLimits.get(modelId) : undefined);
    const contextUsed = contextWindowUsed ?? usageTotal(tokens ?? zeroUsage);
    const modelChange =
      previousModelId && modelId && previousModelId !== modelId
        ? { from: previousModelId, to: modelId }
        : null;

    turns.push({
      displayMessageIds: [...group.displayMessageIds],
      responseIndex: turns.length + 1,
      requestCount: group.requestCount,
      ...(modelChange ? { modelChange } : {}),
      tokens: group.tokens,
      contextWindow:
        contextMax === undefined
          ? null
          : {
              used: contextUsed,
              max: contextMax,
            },
    });
    if (modelId) previousModelId = modelId;
  }
  return turns;
}

const numberFormatter = new Intl.NumberFormat("en-US");

export function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

export function formatTimelineTokens(value: number): string {
  if (value >= 1_000) return `${formatNumber(Math.round(value / 1_000))}K`;
  return formatNumber(value);
}

export function formatTurnUsage(turn: TurnUsage): string {
  return formatTokenUsage(turn.tokens);
}

export function formatTokenUsage(tokens: TokenUsage): string {
  return [
    `${formatTimelineTokens(usageTotal(tokens))} total tokens`,
    `${formatTimelineTokens(tokens.input)} input`,
    `${formatTimelineTokens(tokens.cacheRead)} cache read`,
    `${formatTimelineTokens(tokens.cacheWrite)} cache write`,
    `${formatTimelineTokens(tokens.reasoning)} reasoning`,
    `${formatTimelineTokens(tokens.output)} output`,
  ].join(" · ");
}

export function formatTurnMetadata(turn: TurnUsage): string {
  const requestLabel = turn.requestCount === 1 ? "model request" : "model requests";
  const parts = [
    `assistant turn ${formatNumber(turn.responseIndex)}`,
    `${formatNumber(turn.requestCount)} ${requestLabel}`,
  ];
  const context = formatTurnContext(turn);
  if (context) parts.push(context);
  return parts.join(" · ");
}

export function formatCollapsedTurnMetadata(turn: TurnUsage): string {
  return `assistant turn ${formatNumber(turn.responseIndex)} · see token usage`;
}

export function formatCompactTurnMetadata(turn: TurnUsage): string {
  const requestLabel = turn.requestCount === 1 ? "model request" : "model requests";
  return [
    `assistant turn ${formatNumber(turn.responseIndex)}`,
    `${formatNumber(turn.requestCount)} ${requestLabel}`,
  ].join(" · ");
}

export function formatCompactTurnSummary(turn: TurnUsage): string {
  const parts = [`${formatTimelineTokens(usageTotal(turn.tokens))} total tokens`];
  const context = formatTurnContext(turn);
  if (context) parts.push(context);
  return parts.join(" · ");
}

export function formatCompactTurnUsage(turn: TurnUsage): string {
  return formatCompactTokenUsage(turn.tokens);
}

export function formatCompactTokenUsage(tokens: TokenUsage): string {
  return [
    `${formatTimelineTokens(tokens.input)} in`,
    `${formatTimelineTokens(tokens.cacheRead)} cache read`,
    `${formatTimelineTokens(tokens.cacheWrite)} cache write`,
    `${formatTimelineTokens(tokens.reasoning)} reasoning`,
    `${formatTimelineTokens(tokens.output)} out`,
  ].join(" · ");
}

export function formatTurnModelChange(turn: TurnUsage): string | null {
  return turn.modelChange
    ? `model changed from ${turn.modelChange.from} to ${turn.modelChange.to}`
    : null;
}

function formatTurnContext(turn: TurnUsage): string | null {
  if (turn.contextWindow) {
    return (
      `context ${Math.round((turn.contextWindow.used / turn.contextWindow.max) * 100)}% ` +
      `(${formatTimelineTokens(turn.contextWindow.used)} / ` +
      `${formatTimelineTokens(turn.contextWindow.max)})`
    );
  }
  return null;
}
