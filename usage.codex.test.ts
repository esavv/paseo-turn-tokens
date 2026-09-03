import { describe, expect, it } from "vitest";
import { parseCodexRequests } from "./usage.codex.server";
import { aggregateTurnUsage, usageTotal } from "./usage.shared";

describe("Codex usage", () => {
  it("uses response records without adding cumulative token events", () => {
    const requests = parseCodexRequests([
      {
        type: "event_msg",
        payload: { type: "task_started", turn_id: "turn-1", model_context_window: 1_000 },
      },
      { type: "turn_context", payload: { turn_id: "turn-1", model: "gpt-5.6-sol" } },
      {
        type: "response_item",
        payload: {
          id: "assistant-1",
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "I will inspect the files." }],
        },
      },
      {
        type: "token_usage_record",
        payload: {
          turn_id: "turn-1",
          response_id: "response-1",
          usage: {
            input_tokens: 100,
            cached_input_tokens: 60,
            cache_write_input_tokens: 10,
            output_tokens: 20,
            reasoning_output_tokens: 5,
            total_tokens: 120,
          },
        },
      },
      {
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: {
              input_tokens: 100,
              cached_input_tokens: 60,
              cache_write_input_tokens: 10,
              output_tokens: 20,
              reasoning_output_tokens: 5,
              total_tokens: 120,
            },
            model_context_window: 1_000,
          },
        },
      },
      {
        type: "response_item",
        payload: {
          id: "assistant-2",
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "The task is complete." }],
        },
      },
      {
        type: "token_usage_record",
        payload: {
          turn_id: "turn-1",
          response_id: "response-2",
          usage: {
            input_tokens: 200,
            cached_input_tokens: 150,
            cache_write_input_tokens: 0,
            output_tokens: 30,
            reasoning_output_tokens: 10,
            total_tokens: 230,
          },
        },
      },
    ]);

    expect(requests).toHaveLength(2);
    expect(requests[0]?.tokens).toEqual({
      input: 30,
      cacheRead: 60,
      cacheWrite: 10,
      reasoning: 5,
      output: 15,
    });
    const turns = aggregateTurnUsage(requests, new Map());
    const turn = turns[0];
    if (!turn) throw new Error("Expected one Codex turn");
    expect(turn.displayMessageIds).toEqual(["assistant-2"]);
    expect(turn.requestCount).toBe(2);
    expect(usageTotal(turn.tokens)).toBe(350);
    expect(turn.contextWindow).toEqual({ used: 230, max: 1_000 });
  });

  it("supports older token-count-only rollouts", () => {
    const requests = parseCodexRequests([
      { type: "event_msg", payload: { type: "task_started", turn_id: "turn-old" } },
      {
        type: "response_item",
        payload: {
          id: "assistant-old",
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Older response" }],
        },
      },
      {
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            last_token_usage: {
              input_tokens: 50,
              cached_input_tokens: 30,
              output_tokens: 10,
              reasoning_output_tokens: 4,
              total_tokens: 60,
            },
            model_context_window: 500,
          },
        },
      },
    ]);

    expect(requests).toEqual([
      {
        turnId: "turn-old",
        displayMessageIds: ["assistant-old"],
        modelId: null,
        tokens: { input: 20, cacheRead: 30, cacheWrite: 0, reasoning: 4, output: 6 },
        hasVisibleText: true,
        contextWindowUsed: 60,
        contextWindowMax: 500,
      },
    ]);
  });

  it("removes turns discarded by a rollback", () => {
    const usage = {
      input_tokens: 10,
      cached_input_tokens: 0,
      output_tokens: 2,
      reasoning_output_tokens: 0,
      total_tokens: 12,
    };
    const records: unknown[] = [];
    for (const turnId of ["turn-1", "turn-2"]) {
      records.push(
        { type: "event_msg", payload: { type: "task_started", turn_id: turnId } },
        {
          type: "response_item",
          payload: {
            id: `assistant-${turnId}`,
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Response" }],
          },
        },
        { type: "event_msg", payload: { type: "token_count", info: { last_token_usage: usage } } },
        { type: "event_msg", payload: { type: "task_complete", turn_id: turnId } },
      );
    }
    records.push(
      { type: "event_msg", payload: { type: "thread_rolled_back", num_turns: 1 } },
      { type: "event_msg", payload: { type: "task_started", turn_id: "turn-3" } },
      {
        type: "response_item",
        payload: {
          id: "assistant-turn-3",
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "Replacement" }],
        },
      },
      { type: "event_msg", payload: { type: "token_count", info: { last_token_usage: usage } } },
    );

    expect(parseCodexRequests(records).map((request) => request.turnId)).toEqual([
      "turn-1",
      "turn-3",
    ]);
  });
});
