import { describe, expect, it } from "vitest";
import { parsePiRequests } from "./usage.pi.server";
import { aggregateTurnUsage, usageTotal } from "./usage.shared";

describe("Pi usage", () => {
  it("reads the active branch and includes nested model work", () => {
    const requests = parsePiRequests([
      { type: "session", version: 3, id: "session-1", cwd: "/project" },
      { type: "model_change", id: "model-entry", parentId: null },
      {
        type: "message",
        id: "user-1",
        parentId: "model-entry",
        message: { role: "user", content: [{ type: "text", text: "First task" }] },
      },
      {
        type: "message",
        id: "inactive-assistant",
        parentId: "user-1",
        message: {
          role: "assistant",
          responseId: "inactive-response",
          provider: "openai-codex",
          model: "gpt-5.5",
          content: [{ type: "text", text: "Abandoned branch" }],
          usage: { input: 9_000, output: 1_000, cacheRead: 0, cacheWrite: 0 },
        },
      },
      {
        type: "message",
        id: "user-2",
        parentId: "user-1",
        message: { role: "user", content: [{ type: "text", text: "Use another approach" }] },
      },
      {
        type: "message",
        id: "tool-request",
        parentId: "user-2",
        message: {
          role: "assistant",
          provider: "openai-codex",
          model: "gpt-5.5",
          content: [{ type: "toolCall", id: "tool-1", name: "write" }],
          usage: {
            input: 100,
            output: 20,
            cacheRead: 50,
            cacheWrite: 10,
            reasoning: 5,
            totalTokens: 180,
          },
        },
      },
      {
        type: "message",
        id: "tool-result",
        parentId: "tool-request",
        message: {
          role: "toolResult",
          content: [{ type: "text", text: "Result" }],
          usage: { input: 5, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 10 },
        },
      },
      {
        type: "message",
        id: "final-assistant",
        parentId: "tool-result",
        message: {
          role: "assistant",
          responseId: "final-response",
          provider: "openai-codex",
          model: "gpt-5.5",
          content: [{ type: "text", text: "Completed the task." }],
          usage: {
            input: 120,
            output: 10,
            cacheRead: 20,
            cacheWrite: 0,
            reasoning: 0,
            totalTokens: 150,
          },
        },
      },
    ]);

    expect(requests).toHaveLength(3);
    expect(requests[0]?.tokens).toEqual({
      input: 100,
      cacheRead: 50,
      cacheWrite: 10,
      reasoning: 5,
      output: 15,
    });
    const turns = aggregateTurnUsage(requests, new Map([["openai-codex/gpt-5.5", 200_000]]));
    const turn = turns[0];
    if (!turn) throw new Error("Expected one Pi turn");
    expect(turn.displayMessageIds).toEqual(["final-response"]);
    expect(turn.requestCount).toBe(3);
    expect(usageTotal(turn.tokens)).toBe(340);
    expect(turn.contextWindow).toEqual({ used: 150, max: 200_000 });
  });

  it("matches Paseo's synthetic history IDs when Pi has no response ID", () => {
    const requests = parsePiRequests([
      { type: "session", version: 3, id: "session-1", cwd: "/project" },
      {
        type: "message",
        id: "user-1",
        parentId: null,
        message: { role: "user", content: "Task" },
      },
      {
        type: "message",
        id: "assistant-1",
        parentId: "user-1",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Response" }],
          usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0 },
        },
      },
    ]);

    expect(requests[0]?.displayMessageIds).toEqual(["pi-history-assistant-1"]);
  });

  it("numbers synthetic history IDs from the compacted context", () => {
    const assistantMessage = {
      role: "assistant",
      content: [{ type: "text", text: "Response" }],
      usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0 },
    };
    const requests = parsePiRequests([
      { type: "session", version: 3, id: "session-1", cwd: "/project" },
      { type: "message", id: "user-1", parentId: null, message: { role: "user" } },
      { type: "message", id: "assistant-1", parentId: "user-1", message: assistantMessage },
      {
        type: "message",
        id: "user-2",
        parentId: "assistant-1",
        message: { role: "user" },
      },
      { type: "message", id: "assistant-2", parentId: "user-2", message: assistantMessage },
      {
        type: "compaction",
        id: "compaction-1",
        parentId: "assistant-2",
        firstKeptEntryId: "user-2",
      },
      {
        type: "message",
        id: "user-3",
        parentId: "compaction-1",
        message: { role: "user" },
      },
      { type: "message", id: "assistant-3", parentId: "user-3", message: assistantMessage },
    ]);

    expect(requests.at(-1)?.displayMessageIds).toEqual(["pi-history-assistant-2"]);
  });

  it("keeps usage when compaction omits the preceding user message", () => {
    const requests = parsePiRequests([
      { type: "session", version: 3, id: "session-1", cwd: "/project" },
      {
        type: "message",
        id: "omitted-user",
        parentId: null,
        message: { role: "user", content: "Large task" },
      },
      {
        type: "message",
        id: "kept-assistant",
        parentId: "omitted-user",
        message: {
          role: "assistant",
          responseId: "kept-response",
          provider: "openai-codex",
          model: "gpt-5.5",
          content: [{ type: "text", text: "Retained response" }],
          usage: { input: 100, output: 10, cacheRead: 0, cacheWrite: 0 },
        },
      },
      {
        type: "compaction",
        id: "compaction-1",
        parentId: "kept-assistant",
        firstKeptEntryId: "kept-assistant",
        usage: { input: 200, output: 20, cacheRead: 0, cacheWrite: 0 },
      },
    ]);

    expect(requests).toHaveLength(2);
    expect(requests[0]?.turnId).toBe("pi-context-kept-assistant");
    const turns = aggregateTurnUsage(requests, new Map());
    expect(turns[0]?.displayMessageIds).toEqual(["kept-response"]);
    expect(turns[0]?.requestCount).toBe(2);
  });
});
