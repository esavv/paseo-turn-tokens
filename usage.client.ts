import { useQuery } from "@tanstack/react-query";
import { useAgent, useRpc } from "@getpaseo/plugin";
import { useEffect } from "react";
import { getAgentUsage } from "./usage.shared";

export function useAgentUsage(
  agentId: string,
  hostId: string,
  pollingOwner: boolean,
  consumerEnabled = true,
) {
  const agent = useAgent(agentId, ({ provider, status }) => ({ provider, status }));
  const loadUsage = useRpc(getAgentUsage);
  const enabled = consumerEnabled && agent?.provider === "opencode";
  const { data, refetch } = useQuery({
    queryKey: ["paseo-token-usage", hostId, agentId],
    queryFn: () => loadUsage({ agentId }),
    enabled,
    refetchInterval: pollingOwner && agent?.status === "running" ? 2_000 : false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    staleTime: agent?.status === "running" ? 1_000 : 30_000,
  });

  useEffect(() => {
    if (pollingOwner && enabled) void refetch();
  }, [agent?.status, enabled, pollingOwner, refetch]);

  return data;
}
