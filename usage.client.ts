import { useQuery } from "@tanstack/react-query";
import { useAgent, useRpc } from "@getpaseo/plugin";
import { useEffect } from "react";
import { getAgentUsage } from "./usage.shared";

const supportedProviders = new Set(["claude", "codex", "opencode", "pi"]);

export function useAgentUsage(agentId: string, hostId: string, messageId: string | null) {
  const agent = useAgent(agentId, ({ provider, status }) => ({ provider, status }));
  const loadUsage = useRpc(getAgentUsage);
  const enabled = messageId !== null && supportedProviders.has(agent?.provider ?? "");
  const { data, refetch } = useQuery({
    queryKey: ["paseo-token-usage", hostId, agentId],
    queryFn: () => loadUsage({ agentId }),
    enabled,
    refetchInterval(query) {
      const turns = query.state.data?.turns;
      const latestTurn = turns?.[turns.length - 1];
      return agent?.status === "running" && latestTurn?.displayMessageIds.includes(messageId ?? "")
        ? 2_000
        : false;
    },
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    staleTime: agent?.status === "running" ? 1_000 : 30_000,
  });

  useEffect(() => {
    if (enabled) void refetch();
  }, [agent?.status, enabled, refetch]);

  return data;
}
