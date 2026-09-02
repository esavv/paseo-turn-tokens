import type { PluginTimelineTransformerContribution } from "@getpaseo/plugin";
import { z } from "zod";

export const assistantMessageSchema = z.object({
  messageId: z.string().nullable(),
  text: z.string(),
});

type AssistantMessageTransformer =
  PluginTimelineTransformerContribution<"assistant_message">["transform"];

export const transformAssistantMessage: AssistantMessageTransformer = ({ item }) => ({
  items: [
    {
      type: "plugin",
      kind: "token-usage-assistant-message",
      version: 1,
      data: {
        messageId: item.messageId ?? null,
        text: item.text,
      },
    },
  ],
});
