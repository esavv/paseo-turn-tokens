import type { PluginClientContext, PluginComposerPillProps } from "@getpaseo/plugin";
import { Text } from "react-native";

export function HelloComposerPill({ theme }: PluginComposerPillProps) {
  return <Text style={{ color: theme.colors.foregroundMuted }}>hello</Text>;
}

export function contributeComposerPill(client: PluginClientContext) {
  const pills = new Map<string, { remove: () => void; workspaceId: string }>();
  let stopped = false;

  function remove(agentId: string) {
    pills.get(agentId)?.remove();
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
    current?.remove();

    const workspaceId = agent.workspaceId;
    pills.set(agent.id, {
      workspaceId,
      remove: client.addComposerPill({
        id: "hello-token-usage",
        title: "Token usage preview",
        workspaceId,
        agentId: agent.id,
        Component: HelloComposerPill,
        onPress() {},
      }),
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
    for (const pill of pills.values()) pill.remove();
    pills.clear();
  };
}
