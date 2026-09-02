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
  output: z.object({ turns: z.array(turnUsageSchema) }),
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

    if (request.hasVisibleText) group.displayMessageId = request.messageId;
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

export function formatCompactTokens(value: number): string {
  if (value >= 1_000_000) return `${Math.round(value / 1_000_000)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return numberFormatter.format(value);
}

export function formatTurnUsage(turn: TurnUsage): string {
  const total = usageTotal(turn.tokens);
  const requestLabel = turn.requestCount === 1 ? "model request" : "model requests";
  const parts = [
    `${numberFormatter.format(total)} total tokens`,
    `${numberFormatter.format(turn.tokens.input)} input`,
    `${numberFormatter.format(turn.tokens.cacheRead)} cache read`,
    `${numberFormatter.format(turn.tokens.cacheWrite)} cache write`,
    `${numberFormatter.format(turn.tokens.reasoning)} reasoning`,
    `${numberFormatter.format(turn.tokens.output)} output`,
    `${turn.requestCount} ${requestLabel}`,
  ];

  if (turn.contextWindow) {
    parts.push(
      `context ${Math.round((turn.contextWindow.used / turn.contextWindow.max) * 100)}% ` +
        `(${formatCompactTokens(turn.contextWindow.used)} / ` +
        `${formatCompactTokens(turn.contextWindow.max)})`,
    );
  }
  return parts.join(" | ");
}
