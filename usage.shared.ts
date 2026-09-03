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
  displayMessageId: z.string(),
  responseIndex: z.number().int().positive(),
  requestCount: z.number().int().positive(),
  tokens: tokenUsageSchema,
  contextWindow: z
    .object({
      used: z.number().int().nonnegative(),
      max: z.number().int().positive(),
    })
    .nullable(),
});

export const getAgentUsage = defineRpc({
  name: "usage.get-agent",
  input: z.object({ agentId: z.string().min(1) }),
  output: z.object({
    turns: z.array(turnUsageSchema),
  }),
});

export type TokenUsage = z.output<typeof tokenUsageSchema>;
export type TurnUsage = z.output<typeof turnUsageSchema>;

export interface ModelRequestUsage {
  messageId: string;
  parentMessageId: string | null;
  providerId: string | null;
  modelId: string | null;
  tokens: TokenUsage | null;
  hasVisibleText: boolean;
}

const zeroUsage: TokenUsage = {
  input: 0,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: 0,
  output: 0,
};

export function usageTotal(tokens: TokenUsage): number {
  return (
    tokens.input + tokens.cacheRead + tokens.cacheWrite + tokens.reasoning + tokens.output
  );
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
      displayMessageId: string | null;
      requestCount: number;
      tokens: TokenUsage;
      lastCompleted: ModelRequestUsage | null;
    }
  >();

  for (const request of requests) {
    const groupId = request.parentMessageId ?? request.messageId;
    const group = groups.get(groupId) ?? {
      displayMessageId: null,
      requestCount: 0,
      tokens: zeroUsage,
      lastCompleted: null,
    };

    if (request.hasVisibleText && request.tokens) group.displayMessageId = request.messageId;
    if (request.tokens) {
      group.requestCount += 1;
      group.tokens = sumUsage(group.tokens, request.tokens);
      group.lastCompleted = request;
    }
    groups.set(groupId, group);
  }

  const turns: TurnUsage[] = [];
  for (const group of groups.values()) {
    if (!group.displayMessageId || !group.lastCompleted || group.requestCount === 0) continue;
    const { providerId, modelId, tokens } = group.lastCompleted;
    const contextMax =
      providerId && modelId ? contextLimits.get(`${providerId}/${modelId}`) : undefined;

    turns.push({
      displayMessageId: group.displayMessageId,
      responseIndex: turns.length + 1,
      requestCount: group.requestCount,
      tokens: group.tokens,
      contextWindow:
        contextMax === undefined
          ? null
          : {
              used: usageTotal(tokens ?? zeroUsage),
              max: contextMax,
            },
    });
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
  return [
    formatTurnSummary(turn),
    `${formatTimelineTokens(turn.tokens.input)} input`,
    `${formatTimelineTokens(turn.tokens.cacheRead)} cache read`,
    `${formatTimelineTokens(turn.tokens.cacheWrite)} cache write`,
    `${formatTimelineTokens(turn.tokens.reasoning)} reasoning`,
    `${formatTimelineTokens(turn.tokens.output)} output`,
  ].join(" · ");
}

export function formatTurnSummary(turn: TurnUsage): string {
  return `${formatTimelineTokens(usageTotal(turn.tokens))} total tokens`;
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
  return [
    `${formatTimelineTokens(turn.tokens.input)} in`,
    `${formatTimelineTokens(turn.tokens.cacheRead)} cache read`,
    `${formatTimelineTokens(turn.tokens.cacheWrite)} cache write`,
    `${formatTimelineTokens(turn.tokens.reasoning)} reasoning`,
    `${formatTimelineTokens(turn.tokens.output)} out`,
  ].join(" · ");
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
