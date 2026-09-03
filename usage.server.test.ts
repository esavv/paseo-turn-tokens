import { describe, expect, it } from "vitest";
import { addCompactionTimelineTimestamps, addPiTimelineMessageIds } from "./usage.server";
import type { TokenUsage, TurnUsage } from "./usage.shared";

const turns: TurnUsage[] = [
  {
    displayMessageIds: ["persisted-1"],
    responseIndex: 1,
    requestCount: 1,
    tokens: { input: 10, cacheRead: 0, cacheWrite: 0, reasoning: 0, output: 2 },
    contextWindow: null,
  },
  {
    displayMessageIds: ["persisted-2"],
    responseIndex: 2,
    requestCount: 1,
    tokens: { input: 20, cacheRead: 0, cacheWrite: 0, reasoning: 0, output: 3 },
    contextWindow: null,
  },
];

describe("Pi timeline aliases", () => {
  it("adds live message IDs by completed user turn", () => {
    expect(
      addPiTimelineMessageIds(turns, [
        { item: { type: "user_message", messageId: "user-1" } },
        { item: { type: "assistant_message", messageId: "persisted-1" } },
        { item: { type: "user_message", messageId: "user-2" } },
        { item: { type: "assistant_message", messageId: "live-2" } },
      ]),
    ).toEqual([
      turns[0],
      {
        ...turns[1],
        displayMessageIds: ["persisted-2", "live-2"],
      },
    ]);
  });

  it("uses the last visible assistant message in a user turn", () => {
    expect(
      addPiTimelineMessageIds([turns[0]], [
        { item: { type: "user_message" } },
        { item: { type: "assistant_message", messageId: "intermediate" } },
        { item: { type: "tool_call" } },
        { item: { type: "assistant_message", messageId: "final" } },
      ])[0]?.displayMessageIds,
    ).toEqual(["persisted-1", "final"]);
  });

  it("does not guess when completed turn counts differ", () => {
    expect(
      addPiTimelineMessageIds(turns, [
        { item: { type: "user_message" } },
        { item: { type: "assistant_message", messageId: "only-one" } },
      ]),
    ).toEqual(turns);
  });
});

describe("compaction timeline aliases", () => {
  const tokens: TokenUsage = {
    input: 100,
    cacheRead: 200,
    cacheWrite: 0,
    reasoning: 10,
    output: 20,
  };

  it("matches provider usage to completed markers by order", () => {
    expect(
      addCompactionTimelineTimestamps([tokens], [
        {
          timestamp: "2026-09-03T12:00:00.000Z",
          item: { type: "compaction", status: "completed" },
        },
      ]),
    ).toEqual([
      {
        timelineTimestamp: "2026-09-03T12:00:00.000Z",
        tokens,
      },
    ]);
  });

  it("does not guess when provider and timeline counts differ", () => {
    expect(addCompactionTimelineTimestamps([tokens], [])).toEqual([]);
  });

  it("keeps marker positions when an older compaction has no usage", () => {
    expect(
      addCompactionTimelineTimestamps([null, tokens], [
        {
          timestamp: "2026-09-03T12:00:00.000Z",
          item: { type: "compaction", status: "completed" },
        },
        {
          timestamp: "2026-09-03T13:00:00.000Z",
          item: { type: "compaction", status: "completed" },
        },
      ]),
    ).toEqual([
      {
        timelineTimestamp: "2026-09-03T13:00:00.000Z",
        tokens,
      },
    ]);
  });
});
