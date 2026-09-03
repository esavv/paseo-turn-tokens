import type { PluginTimelineItemProps } from "@getpaseo/plugin";
import { Text, type TextStyle, View } from "react-native";
import type { z } from "zod";
import { assistantMessageSchema } from "./timeline.shared";
import { useAgentUsage } from "./usage.client";
import {
  formatCompactTurnMetadata,
  formatCompactTurnSummary,
  formatCompactTurnUsage,
  formatTurnMetadata,
  formatTurnUsage,
} from "./usage.shared";

type AssistantMessageData = z.output<typeof assistantMessageSchema>;

export function TokenUsageAssistantMessage({
  agentId,
  host,
  item,
  theme,
  layout,
}: PluginTimelineItemProps<AssistantMessageData>) {
  const messageId = item.data.messageId;
  const usage = useAgentUsage(agentId, host.id, false, messageId !== null);
  const turn = usage?.turns.find((candidate) => candidate.displayMessageId === messageId);
  const details = turn
    ? layout.compact
      ? [
          formatCompactTurnMetadata(turn),
          formatCompactTurnSummary(turn),
          formatCompactTurnUsage(turn),
        ]
      : [formatTurnMetadata(turn), formatTurnUsage(turn)]
    : [];
  const detailStyle: TextStyle = {
    color: theme.colors.foregroundMuted,
    fontSize: layout.compact ? 10 : 11,
    fontVariant: ["tabular-nums"],
    lineHeight: layout.compact ? 14 : 15,
    maxWidth: "100%",
    textAlign: "right",
  };

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
      {details.length > 0 ? (
        <View
          style={{
            alignSelf: "flex-end",
            alignItems: "flex-end",
            marginTop: layout.compact ? 6 : 8,
            maxWidth: "100%",
          }}
        >
          {details.map((detail, index) => (
            <Text key={detail} selectable style={[detailStyle, index > 0 && { marginTop: 2 }]}>
              {detail}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}
