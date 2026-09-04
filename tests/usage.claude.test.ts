import { describe, expect, it } from "vitest";
import { parseClaudeRequests } from "../src/usage.claude.server";
import { aggregateTurnUsage, usageTotal } from "../src/usage.shared";

const firstUsage = {
  input_tokens: 2,
  cache_creation_input_tokens: 100,
  cache_read_input_tokens: 1_000,
  output_tokens: 80,
  output_tokens_details: { thinking_tokens: 30 },
};

describe("Claude usage", () => {
  it("deduplicates split responses and supports live and historical message IDs", () => {
    const requests = parseClaudeRequests([
      {
        type: "user",
        uuid: "user-1",
        message: { role: "user", content: "Create a file" },
      },
      {
        type: "assistant",
        uuid: "thinking-entry",
        requestId: "request-1",
        message: {
          id: "api-message-1",
          role: "assistant",
          model: "claude-sonnet-5",
          content: [{ type: "thinking", thinking: "Reasoning" }],
          usage: firstUsage,
        },
      },
      {
        type: "assistant",
        uuid: "tool-entry",
        requestId: "request-1",
        message: {
          id: "api-message-1",
          role: "assistant",
          model: "claude-sonnet-5",
          content: [{ type: "tool_use", id: "tool-1" }],
          usage: firstUsage,
        },
      },
      {
        type: "user",
        uuid: "tool-result-entry",
        message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tool-1" }] },
      },
      {
        type: "assistant",
        uuid: "text-entry",
        requestId: "request-2",
        message: {
          id: "api-message-2",
          role: "assistant",
          model: "claude-sonnet-5",
          content: [{ type: "text", text: "Created the file." }],
          usage: {
            input_tokens: 3,
            cache_creation_input_tokens: 20,
            cache_read_input_tokens: 1_100,
            output_tokens: 40,
            output_tokens_details: { thinking_tokens: 10 },
          },
        },
      },
    ]);

    expect(requests).toHaveLength(2);
    expect(requests[0]?.tokens).toEqual({
      input: 2,
      cacheRead: 1_000,
      cacheWrite: 100,
      reasoning: 30,
      output: 50,
    });
    const turns = aggregateTurnUsage(requests, new Map([["claude-sonnet-5", 200_000]]));
    expect(turns).toHaveLength(1);
    const turn = turns[0];
    if (!turn) throw new Error("Expected one Claude turn");
    expect(turn.displayMessageIds).toEqual(["text-entry", "api-message-2"]);
    expect(turn.requestCount).toBe(2);
    expect(usageTotal(turn.tokens)).toBe(2_345);
    expect(turn.contextWindow).toEqual({ used: 1_163, max: 200_000 });
  });

  it("ignores sidechain responses", () => {
    expect(
      parseClaudeRequests([
        { type: "user", uuid: "user-1", message: { role: "user", content: "Task" } },
        {
          type: "assistant",
          uuid: "subagent-entry",
          isSidechain: true,
          message: {
            id: "subagent-message",
            role: "assistant",
            content: [{ type: "text", text: "Background result" }],
            usage: firstUsage,
          },
        },
      ]),
    ).toEqual([]);
  });
});
