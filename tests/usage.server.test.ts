import { describe, expect, it } from "vitest";
import { addPiTimelineMessageIds } from "../src/usage.server";
import type { TurnUsage } from "../src/usage.shared";

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
      addPiTimelineMessageIds(
        [turns[0]],
        [
          { item: { type: "user_message" } },
          { item: { type: "assistant_message", messageId: "intermediate" } },
          { item: { type: "tool_call" } },
          { item: { type: "assistant_message", messageId: "final" } },
        ],
      )[0]?.displayMessageIds,
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
