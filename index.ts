import type { PluginContext } from "@getpaseo/plugin";
import { TokenUsageAssistantMessage, TokenUsageCompaction } from "./timeline.client";
import {
  assistantMessageSchema,
  compactionSchema,
  transformAssistantMessage,
  transformCompaction,
} from "./timeline.shared";
import { collectAgentUsage } from "./usage.server";
import { getAgentUsage } from "./usage.shared";

export default function contribute(plugin: PluginContext) {
  plugin.handle(getAgentUsage, collectAgentUsage);
  plugin.addTimelineTransformer({
    id: "token-usage-assistant-message",
    query: { itemType: "assistant_message" },
    transform: transformAssistantMessage,
  });
  plugin.addTimelineRenderer({
    kind: "token-usage-assistant-message",
    version: 1,
    schema: assistantMessageSchema,
    Component: TokenUsageAssistantMessage,
  });
  plugin.addTimelineTransformer({
    id: "token-usage-compaction",
    query: { itemType: "compaction" },
    transform: transformCompaction,
  });
  plugin.addTimelineRenderer({
    kind: "token-usage-compaction",
    version: 1,
    schema: compactionSchema,
    Component: TokenUsageCompaction,
  });
  return () => {};
}
