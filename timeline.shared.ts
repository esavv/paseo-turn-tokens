import type { PluginTimelineTransformerContribution } from "@getpaseo/plugin";
import { z } from "zod";

export const assistantMessageSchema = z.object({
  messageId: z.string().nullable(),
  text: z.string(),
});

export const compactionSchema = z.object({
  status: z.enum(["loading", "completed"]),
  trigger: z.enum(["auto", "manual"]).optional(),
  preTokens: z.number().finite().nonnegative().optional(),
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

type CompactionTransformer =
  PluginTimelineTransformerContribution<"compaction">["transform"];

export const transformCompaction: CompactionTransformer = ({ item }) => ({
  items: [
    {
      type: "plugin",
      kind: "token-usage-compaction",
      version: 1,
      data: {
        status: item.status,
        ...(item.trigger ? { trigger: item.trigger } : {}),
        ...(item.preTokens !== undefined ? { preTokens: item.preTokens } : {}),
      },
    },
  ],
});

export function formatCompactionLabel(data: z.output<typeof compactionSchema>): string {
  if (data.status === "loading") return "Compacting...";
  if (data.trigger === "auto") return "Context automatically compacted";
  if (data.trigger === "manual") return "Context manually compacted";
  if (data.preTokens) return `Context compacted (${Math.round(data.preTokens / 1_000)}K tokens)`;
  return "Context compacted";
}

export function shouldHideLoadingCompaction(
  status: z.output<typeof compactionSchema>["status"],
  hasCompletedUsage: boolean,
  agentStatus: string | null | undefined,
): boolean {
  return (
    status === "loading" &&
    (hasCompletedUsage || (agentStatus != null && agentStatus !== "running"))
  );
}
