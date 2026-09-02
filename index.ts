import type { PluginContext } from "@getpaseo/plugin";
import { contributeComposerPill } from "./composer.client";
import { HelloAssistantMessage } from "./timeline.client";
import { helloAssistantSchema, transformAssistantMessage } from "./timeline.shared";

export default function contribute(plugin: PluginContext) {
  plugin.addTimelineTransformer({
    id: "hello-assistant-message",
    query: { itemType: "assistant_message" },
    transform: transformAssistantMessage,
  });
  plugin.addTimelineRenderer({
    kind: "hello-assistant-message",
    version: 1,
    schema: helloAssistantSchema,
    Component: HelloAssistantMessage,
  });
  plugin.addClientSide(contributeComposerPill);
  return () => {};
}
