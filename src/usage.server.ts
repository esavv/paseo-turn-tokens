import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { z } from "zod";
import { readClaudeRequests } from "./usage.claude.server";
import { readCodexUsage } from "./usage.codex.server";
import { readOpenCodeUsage } from "./usage.opencode.server";
import { readPiUsage } from "./usage.pi.server";
import {
  aggregateTurnUsage,
  getAgentUsage,
  type ProviderUsage,
  type TurnUsage,
} from "./usage.shared";

const modelCacheDurationMs = 5 * 60 * 1_000;
const modelLimitCache = new Map<
  string,
  { expiresAt: number; limits: ReadonlyMap<string, number> }
>();
const pendingModelLimits = new Map<string, Promise<ReadonlyMap<string, number>>>();

interface ProjectedTimelineEntry {
  item: {
    type: string;
    messageId?: string;
  };
}

export function addPiTimelineMessageIds(
  turns: readonly TurnUsage[],
  entries: readonly ProjectedTimelineEntry[],
): TurnUsage[] {
  const timelineMessageIds: string[] = [];
  let groupStarted = false;
  let assistantMessageId: string | null = null;

  const finishGroup = () => {
    if (assistantMessageId) timelineMessageIds.push(assistantMessageId);
  };

  for (const { item } of entries) {
    if (item.type === "user_message") {
      if (groupStarted) finishGroup();
      groupStarted = true;
      assistantMessageId = null;
      continue;
    }
    if (item.type !== "assistant_message") continue;
    const messageId = item.messageId?.trim();
    if (!messageId) continue;
    groupStarted = true;
    assistantMessageId = messageId;
  }
  if (groupStarted) finishGroup();

  if (timelineMessageIds.length !== turns.length) return [...turns];
  return turns.map((turn, index) => {
    const messageId = timelineMessageIds[index];
    if (!messageId || turn.displayMessageIds.includes(messageId)) return turn;
    return {
      ...turn,
      displayMessageIds: [...turn.displayMessageIds, messageId],
    };
  });
}

async function addPiTimelineAliases(
  paseo: PluginHandlerContext["paseo"],
  agentId: string,
  turns: readonly TurnUsage[],
): Promise<TurnUsage[]> {
  try {
    const timeline = await paseo.agents.ref(agentId).timeline.refetch({
      direction: "tail",
      limit: 0,
      projection: "projected",
    });
    if (timeline.error) return [...turns];
    return addPiTimelineMessageIds(turns, timeline.entries);
  } catch {
    return [...turns];
  }
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

async function loadModelLimits(
  paseo: PluginHandlerContext["paseo"],
  provider: string,
  cwd: string,
): Promise<ReadonlyMap<string, number>> {
  const response = await paseo.providers.listModels(provider, { cwd });
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
  provider: string,
  cwd: string,
): Promise<ReadonlyMap<string, number>> {
  const cacheKey = `${provider}\0${cwd}`;
  const cached = modelLimitCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.limits);
  const pending = pendingModelLimits.get(cacheKey);
  if (pending) return pending;

  const request = loadModelLimits(paseo, provider, cwd)
    .then((limits) => {
      modelLimitCache.set(cacheKey, { expiresAt: Date.now() + modelCacheDurationMs, limits });
      return limits;
    })
    .finally(() => pendingModelLimits.delete(cacheKey));
  pendingModelLimits.set(cacheKey, request);
  return request;
}

export async function collectAgentUsage(
  { agentId }: z.output<typeof getAgentUsage.input>,
  { paseo }: PluginHandlerContext,
): Promise<z.input<typeof getAgentUsage.output>> {
  const result = await paseo.agents.ref(agentId).refresh();
  if (!result) return { turns: [], compactions: [] };
  const { agent } = result;

  const sessionId = agent.runtimeInfo?.sessionId ?? agent.persistence?.sessionId;
  if (!sessionId) return { turns: [], compactions: [] };
  const usage: ProviderUsage =
    agent.provider === "opencode"
      ? readOpenCodeUsage(sessionId)
      : agent.provider === "claude"
        ? { requests: await readClaudeRequests(sessionId, agent.cwd), compactions: [] }
        : agent.provider === "codex"
          ? await readCodexUsage(sessionId, agent.persistence?.nativeHandle)
          : agent.provider === "pi"
            ? await readPiUsage(sessionId, agent.cwd, agent.persistence?.nativeHandle)
            : { requests: [], compactions: [] };

  let limits: ReadonlyMap<string, number> = new Map();
  try {
    limits = await modelLimits(paseo, agent.provider, agent.cwd);
  } catch {
    // Token usage is still useful when model metadata is temporarily unavailable.
  }
  const turns = aggregateTurnUsage(usage.requests, limits);
  return {
    turns: agent.provider === "pi" ? await addPiTimelineAliases(paseo, agentId, turns) : turns,
    compactions: usage.compactions,
  };
}
