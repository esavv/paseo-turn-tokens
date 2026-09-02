import { useQuery } from "@tanstack/react-query";
import { type PluginTimelineItemProps, useAgent, useRpc } from "@getpaseo/plugin";
import { Text, View } from "react-native";
import type { z } from "zod";
import { assistantMessageSchema } from "./timeline.shared";
import { formatTurnUsage, getAgentUsage } from "./usage.shared";

type AssistantMessageData = z.output<typeof assistantMessageSchema>;

export function TokenUsageAssistantMessage({
  agentId,
  host,
  item,
  theme,
  layout,
}: PluginTimelineItemProps<AssistantMessageData>) {
  const agent = useAgent(agentId, ({ provider, status }) => ({ provider, status }));
  const loadUsage = useRpc(getAgentUsage);
  const messageId = item.data.messageId;
  const { data } = useQuery({
    queryKey: ["paseo-token-usage", host.id, agentId, agent?.status],
    queryFn: () => loadUsage({ agentId }),
    enabled: agent?.provider === "opencode" && messageId !== null,
    refetchInterval: agent?.status === "running" ? 2_000 : false,
    staleTime: agent?.status === "running" ? 1_000 : 30_000,
  });
  const turn = data?.turns.find((candidate) => candidate.displayMessageId === messageId);

  return (
    <View style={{ paddingVertical: layout.compact ? 8 : 12 }}>
      <Text
        selectable
        style={{
          color: theme.colors.foreground,
          fontSize: 15,
          lineHeight: 21,
        }}
      >
        {item.data.text}
      </Text>
      {turn ? (
        <Text
          selectable
          style={{
            alignSelf: "flex-end",
            color: theme.colors.foregroundMuted,
            fontSize: layout.compact ? 10 : 11,
            fontVariant: ["tabular-nums"],
            lineHeight: layout.compact ? 14 : 15,
            marginTop: layout.compact ? 6 : 8,
            maxWidth: "100%",
            textAlign: "right",
          }}
        >
          {formatTurnUsage(turn)}
        </Text>
      ) : null}
    </View>
  );
}
