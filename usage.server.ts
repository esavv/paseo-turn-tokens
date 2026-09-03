import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { z } from "zod";
import { readClaudeRequests } from "./usage.claude.server";
import { readCodexRequests } from "./usage.codex.server";
import { readOpenCodeRequests } from "./usage.opencode.server";
import { aggregateTurnUsage, getAgentUsage } from "./usage.shared";

const modelCacheDurationMs = 5 * 60 * 1_000;
const modelLimitCache = new Map<string, { expiresAt: number; limits: ReadonlyMap<string, number> }>();
const pendingModelLimits = new Map<string, Promise<ReadonlyMap<string, number>>>();

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
  if (!result) return { turns: [] };
  const { agent } = result;

  const sessionId = agent.runtimeInfo?.sessionId ?? agent.persistence?.sessionId;
  if (!sessionId) return { turns: [] };
  const requests =
    agent.provider === "opencode"
      ? readOpenCodeRequests(sessionId)
      : agent.provider === "claude"
        ? await readClaudeRequests(sessionId, agent.cwd)
        : agent.provider === "codex"
          ? await readCodexRequests(sessionId, agent.persistence?.nativeHandle)
        : [];

  let limits: ReadonlyMap<string, number> = new Map();
  try {
    limits = await modelLimits(paseo, agent.provider, agent.cwd);
  } catch {
    // Token usage is still useful when model metadata is temporarily unavailable.
  }
  return {
    turns: aggregateTurnUsage(requests, limits),
  };
}
