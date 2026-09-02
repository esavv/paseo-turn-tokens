import type { PluginClientContext, PluginComposerPillProps } from "@getpaseo/plugin";
import { Text } from "react-native";
import { useAgentUsage } from "./usage.client";
import { formatCompactTokens, formatNumber, usageTotal } from "./usage.shared";

export function TotalTokensPill({ theme, host, agentId, layout }: PluginComposerPillProps) {
  const usage = useAgentUsage(agentId, host.id, true);
  const label = usage ? `${formatCompactTokens(usageTotal(usage.session.tokens))} tokens` : "-- tokens";
  return (
    <Text style={{ color: theme.colors.foregroundMuted, fontSize: layout.compact ? 12 : 13 }}>
      {label}
    </Text>
  );
}

export function ModelRequestsPill({ theme, host, agentId, layout }: PluginComposerPillProps) {
  const usage = useAgentUsage(agentId, host.id, false);
  const count = usage ? formatNumber(usage.session.requestCount) : "--";
  const noun = usage?.session.requestCount === 1 ? "request" : "requests";
  return (
    <Text style={{ color: theme.colors.foregroundMuted, fontSize: layout.compact ? 12 : 13 }}>
      {`${count} ${noun}`}
    </Text>
  );
}

export function CompactionsPill({ theme, host, agentId, layout }: PluginComposerPillProps) {
  const usage = useAgentUsage(agentId, host.id, false);
  const count = usage ? formatNumber(usage.session.compactionCount) : "--";
  const noun = usage?.session.compactionCount === 1 ? "compaction" : "compactions";
  return (
    <Text style={{ color: theme.colors.foregroundMuted, fontSize: layout.compact ? 12 : 13 }}>
      {`${count} ${noun}`}
    </Text>
  );
}

export function contributeComposerPills(client: PluginClientContext) {
  const pills = new Map<string, { remove: readonly (() => void)[]; workspaceId: string }>();
  let stopped = false;

  function remove(agentId: string) {
    for (const dispose of pills.get(agentId)?.remove ?? []) dispose();
    pills.delete(agentId);
  }

  function register(agent: { id: string; provider: string; workspaceId?: string | null }) {
    if (stopped) return;
    if (agent.provider !== "opencode" || !agent.workspaceId) {
      remove(agent.id);
      return;
    }

    const current = pills.get(agent.id);
    if (current?.workspaceId === agent.workspaceId) return;
    remove(agent.id);

    const workspaceId = agent.workspaceId;
    const common = { workspaceId, agentId: agent.id };
    pills.set(agent.id, {
      workspaceId,
      remove: [
        client.addComposerPill({
          ...common,
          id: "session-tokens",
          title: "Session token usage",
          Component: TotalTokensPill,
          onPress() {},
        }),
        client.addComposerPill({
          ...common,
          id: "session-requests",
          title: "Session model requests",
          Component: ModelRequestsPill,
          onPress() {},
        }),
        client.addComposerPill({
          ...common,
          id: "session-compactions",
          title: "Session compactions",
          Component: CompactionsPill,
          onPress() {},
        }),
      ],
    });
  }

  const unsubscribe = client.paseo.agents.subscribe((update) => {
    if (update.kind === "remove") remove(update.agentId);
    else register(update.agent);
  });

  void client.paseo.agents
    .list()
    .then(({ entries }) => {
      for (const { agent } of entries) register(agent);
    })
    .catch(() => undefined);

  return () => {
    stopped = true;
    unsubscribe();
    for (const agentId of pills.keys()) remove(agentId);
  };
}
