import type { PluginContext } from "@getpaseo/plugin";
import { TokenUsageAssistantMessage } from "./timeline.client";
import { assistantMessageSchema, transformAssistantMessage } from "./timeline.shared";
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
  return () => {};
}
