import { Icon, type PluginTimelineItemProps, useAgent } from "@getpaseo/plugin";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, type TextStyle, View } from "react-native";
import type { z } from "zod";
import {
  assistantMessageSchema,
  compactionSchema,
  formatCompactionLabel,
  shouldHideLoadingCompaction,
} from "./timeline.shared";
import { useAgentUsage } from "./usage.client";
import {
  formatCompactTokenUsage,
  formatCollapsedTurnMetadata,
  formatCompactTurnMetadata,
  formatCompactTurnSummary,
  formatCompactTurnUsage,
  formatTimelineTokens,
  formatTokenUsage,
  formatTurnMetadata,
  formatTurnModelChange,
  formatTurnUsage,
  findCompactionUsage,
  usageTotal,
} from "./usage.shared";

type AssistantMessageData = z.output<typeof assistantMessageSchema>;
type CompactionData = z.output<typeof compactionSchema>;

interface TokenDisclosureProps {
  accessibilityLabel: string;
  collapsedMetadata: string;
  compact: boolean;
  details: string[];
  expandedMetadata: string;
  foregroundMuted: string;
  marginTop?: number;
}

function TokenDisclosure({
  accessibilityLabel,
  collapsedMetadata,
  compact,
  details,
  expandedMetadata,
  foregroundMuted,
  marginTop,
}: TokenDisclosureProps) {
  const [expanded, setExpanded] = useState(true);
  const detailStyle: TextStyle = {
    color: foregroundMuted,
    fontSize: compact ? 10 : 11,
    fontVariant: ["tabular-nums"],
    lineHeight: compact ? 14 : 15,
    maxWidth: "100%",
    textAlign: "right",
  };

  return (
    <View
      style={{
        alignSelf: "flex-end",
        alignItems: "flex-end",
        marginTop: marginTop ?? (compact ? 6 : 8),
        maxWidth: "100%",
      }}
    >
      <Pressable
        accessibilityLabel={`${expanded ? "Hide" : "Show"} token details for ${accessibilityLabel}`}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        hitSlop={8}
        onPress={() => setExpanded((current) => !current)}
        style={({ pressed }) => ({
          alignItems: "center",
          flexDirection: "row",
          gap: compact ? 1 : 2,
          maxWidth: "100%",
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Text style={[detailStyle, { flexShrink: 1 }]}>
          {expanded ? expandedMetadata : collapsedMetadata}
        </Text>
        <Icon
          color={foregroundMuted}
          name={expanded ? "ChevronDown" : "ChevronRight"}
          size={compact ? 12 : 13}
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
  );
}

export function TokenUsageAssistantMessage({
  agentId,
  host,
  item,
  theme,
  layout,
}: PluginTimelineItemProps<AssistantMessageData>) {
  const messageId = item.data.messageId;
  const usage = useAgentUsage(agentId, host.id, messageId !== null);
  const turn = usage?.turns.find((candidate) =>
    candidate.displayMessageIds.includes(messageId ?? ""),
  );
  const details = turn
    ? layout.compact
      ? [formatCompactTurnSummary(turn), formatCompactTurnUsage(turn)]
      : [formatTurnUsage(turn)]
    : [];
  const modelChange = turn ? formatTurnModelChange(turn) : null;
  if (modelChange) details.push(modelChange);

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
        <TokenDisclosure
          accessibilityLabel={`assistant turn ${turn.responseIndex}`}
          collapsedMetadata={formatCollapsedTurnMetadata(turn)}
          compact={layout.compact}
          details={details}
          expandedMetadata={
            layout.compact ? formatCompactTurnMetadata(turn) : formatTurnMetadata(turn)
          }
          foregroundMuted={theme.colors.foregroundMuted}
        />
      ) : null}
    </View>
  );
}

export function TokenUsageCompaction({
  agentId,
  host,
  item,
  layout,
  theme,
  timestamp,
}: PluginTimelineItemProps<CompactionData>) {
  const agentStatus = useAgent(agentId, ({ status }) => status);
  const usage = useAgentUsage(agentId, host.id, item.data.status === "completed");
  const matchedCompaction = usage
    ? findCompactionUsage(usage.compactions, timestamp.getTime())
    : undefined;
  const compaction = item.data.status === "completed" ? matchedCompaction : undefined;
  if (shouldHideLoadingCompaction(item.data.status, Boolean(matchedCompaction), agentStatus)) {
    return null;
  }

  const markerData = {
    ...item.data,
    trigger: item.data.trigger ?? compaction?.trigger,
  };
  const details = compaction
    ? layout.compact
      ? [
          `${formatTimelineTokens(usageTotal(compaction.tokens))} total tokens`,
          formatCompactTokenUsage(compaction.tokens),
        ]
      : [formatTokenUsage(compaction.tokens)]
    : [];

  return (
    <View>
      <View
        style={{
          alignItems: "center",
          flexDirection: "row",
          gap: 8,
          paddingHorizontal: 16,
          paddingVertical: 12,
        }}
      >
        <View style={{ backgroundColor: theme.colors.border, flex: 1, height: 1 }} />
        <View style={{ alignItems: "center", flexDirection: "row", gap: 8 }}>
          {item.data.status === "loading" ? (
            <ActivityIndicator color="#a1a1aa" size="small" />
          ) : (
            <Icon color="#a1a1aa" name="Scissors" size={12} />
          )}
          <Text style={{ color: theme.colors.foregroundMuted, fontSize: 13 }}>
            {formatCompactionLabel(markerData)}
          </Text>
        </View>
        <View style={{ backgroundColor: theme.colors.border, flex: 1, height: 1 }} />
      </View>
      {compaction ? (
        <View style={{ paddingHorizontal: 16 }}>
          <TokenDisclosure
            accessibilityLabel="context compaction"
            collapsedMetadata="see compaction token usage"
            compact={layout.compact}
            details={details}
            expandedMetadata="compaction token usage"
            foregroundMuted={theme.colors.foregroundMuted}
            marginTop={0}
          />
        </View>
      ) : null}
    </View>
  );
}
