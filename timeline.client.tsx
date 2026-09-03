import { Icon, type PluginTimelineItemProps } from "@getpaseo/plugin";
import { useState } from "react";
import { Pressable, Text, type TextStyle, View } from "react-native";
import type { z } from "zod";
import { assistantMessageSchema } from "./timeline.shared";
import { useAgentUsage } from "./usage.client";
import {
  formatCollapsedTurnMetadata,
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
  const [expanded, setExpanded] = useState(false);
  const messageId = item.data.messageId;
  const usage = useAgentUsage(agentId, host.id, messageId);
  const turn = usage?.turns.find((candidate) => candidate.displayMessageId === messageId);
  const metadata = turn
    ? expanded
      ? layout.compact
        ? formatCompactTurnMetadata(turn)
        : formatTurnMetadata(turn)
      : formatCollapsedTurnMetadata(turn)
    : null;
  const details = turn
    ? layout.compact
      ? [formatCompactTurnSummary(turn), formatCompactTurnUsage(turn)]
      : [formatTurnUsage(turn)]
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
      {turn && metadata ? (
        <View
          style={{
            alignSelf: "flex-end",
            alignItems: "flex-end",
            marginTop: layout.compact ? 6 : 8,
            maxWidth: "100%",
          }}
        >
          <Pressable
            accessibilityLabel={`${expanded ? "Hide" : "Show"} token details for assistant turn ${turn.responseIndex}`}
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            hitSlop={8}
            onPress={() => setExpanded((current) => !current)}
            style={({ pressed }) => ({
              alignItems: "center",
              flexDirection: "row",
              gap: layout.compact ? 1 : 2,
              maxWidth: "100%",
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Text style={[detailStyle, { flexShrink: 1 }]}>{metadata}</Text>
            <Icon
              color={theme.colors.foregroundMuted}
              name={expanded ? "ChevronDown" : "ChevronRight"}
              size={layout.compact ? 12 : 13}
            />
          </Pressable>
          {expanded
            ? details.map((detail) => (
                <Text key={detail} selectable style={[detailStyle, { marginTop: 2 }]}>
                  {detail}
                </Text>
              ))
            : null}
        </View>
      ) : null}
    </View>
  );
}
