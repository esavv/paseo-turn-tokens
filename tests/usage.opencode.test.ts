import { describe, expect, it } from "vitest";
import { parseOpenCodeUsage } from "../src/usage.opencode.server";

describe("OpenCode usage", () => {
  it("separates compaction summary usage from assistant turns", () => {
    const rows = [
      {
        id: "summary-message",
        data: JSON.stringify({
          role: "assistant",
          parentID: "compaction-message",
          summary: true,
          time: { completed: 1 },
          tokens: {
            input: 100,
            output: 20,
            reasoning: 5,
            cache: { read: 50, write: 10 },
          },
        }),
      },
      {
        id: "assistant-message",
        data: JSON.stringify({
          role: "assistant",
          parentID: "user-message",
          providerID: "anthropic",
          modelID: "claude-sonnet",
          time: { completed: 2 },
          tokens: {
            input: 30,
            output: 10,
            reasoning: 0,
            cache: { read: 20, write: 0 },
          },
        }),
      },
    ];

    expect(
      parseOpenCodeUsage(rows, new Set(["assistant-message"]), [
        { messageId: "compaction-message", timestamp: 1_000, trigger: "auto" },
      ]),
    ).toEqual({
      requests: [
        {
          turnId: "user-message",
          displayMessageIds: ["assistant-message"],
          modelId: "anthropic/claude-sonnet",
          tokens: { input: 30, cacheRead: 20, cacheWrite: 0, reasoning: 0, output: 10 },
          hasVisibleText: true,
        },
      ],
      compactions: [
        {
          timestamp: 1_000,
          trigger: "auto",
          tokens: { input: 100, cacheRead: 50, cacheWrite: 10, reasoning: 5, output: 20 },
        },
      ],
    });
  });
});
