import { useQuery } from "@tanstack/react-query";
import { useAgent, useRpc } from "@getpaseo/plugin";
import { useEffect, useRef } from "react";
import { getAgentUsage } from "./usage.shared";

const supportedProviders = new Set(["claude", "codex", "opencode", "pi"]);

export function useAgentUsage(agentId: string, hostId: string, requested: boolean) {
  const agent = useAgent(agentId, ({ provider, status }) => ({ provider, status }));
  const loadUsage = useRpc(getAgentUsage);
  const enabled = requested && supportedProviders.has(agent?.provider ?? "");
  const previousStatus = useRef(agent?.status);
  const { data, refetch } = useQuery({
    queryKey: ["paseo-token-usage", hostId, agentId],
    queryFn: () => loadUsage({ agentId }),
    enabled,
    refetchInterval: agent?.status === "running" ? 2_000 : false,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    staleTime: agent?.status === "running" ? 1_000 : 30_000,
  });

  useEffect(() => {
    const wasRunning = previousStatus.current === "running";
    previousStatus.current = agent?.status;
    if (!enabled) return;

    void refetch();
    if (!wasRunning || agent?.status === "running") return;

    const finalRefetch = setTimeout(() => void refetch(), 2_000);
    return () => clearTimeout(finalRefetch);
  }, [agent?.status, enabled, refetch]);

  return data;
}
