import { describe, expect, it } from "vitest";
import {
  formatCompactionLabel,
  shouldHideLoadingCompaction,
  transformAssistantMessage,
  transformCompaction,
} from "./timeline.shared";

describe("assistant timeline transformer", () => {
  it("preserves the assistant message in plugin data", () => {
    expect(
      transformAssistantMessage({
        item: {
          type: "assistant_message",
          text: "Original response",
          messageId: "message-1",
        },
      }),
    ).toEqual({
      items: [
        {
          type: "plugin",
          kind: "token-usage-assistant-message",
          version: 1,
          data: {
            messageId: "message-1",
            text: "Original response",
          },
        },
      ],
    });
  });

  it("uses null when Paseo does not provide a message ID", () => {
    expect(
      transformAssistantMessage({
        item: {
          type: "assistant_message",
          text: "Streaming response",
        },
      }),
    ).toMatchObject({
      items: [{ data: { messageId: null } }],
    });
  });
});

describe("compaction timeline transformer", () => {
  it("preserves the native marker data in the plugin item", () => {
    expect(
      transformCompaction({
        item: {
          type: "compaction",
          status: "completed",
          trigger: "auto",
          preTokens: 120_000,
        },
      }),
    ).toEqual({
      items: [
        {
          type: "plugin",
          kind: "token-usage-compaction",
          version: 1,
          data: { status: "completed", trigger: "auto", preTokens: 120_000 },
        },
      ],
    });
  });

  it("reproduces Paseo's compaction labels", () => {
    expect(formatCompactionLabel({ status: "loading" })).toBe("Compacting...");
    expect(formatCompactionLabel({ status: "completed", trigger: "manual" })).toBe(
      "Context manually compacted",
    );
    expect(formatCompactionLabel({ status: "completed", preTokens: 120_000 })).toBe(
      "Context compacted (120K tokens)",
    );
  });

  it("hides a stale loading row after compaction finishes", () => {
    expect(shouldHideLoadingCompaction("loading", true, "running")).toBe(true);
    expect(shouldHideLoadingCompaction("loading", false, "idle")).toBe(true);
    expect(shouldHideLoadingCompaction("loading", false, "running")).toBe(false);
    expect(shouldHideLoadingCompaction("completed", true, "idle")).toBe(false);
  });
});
