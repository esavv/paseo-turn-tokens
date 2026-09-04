import { describe, expect, it } from "vitest";
import {
  aggregateTurnUsage,
  formatCollapsedTurnMetadata,
  formatCompactTurnMetadata,
  formatCompactTurnSummary,
  formatCompactTurnUsage,
  findCompactionUsage,
  formatTimelineTokens,
  formatTurnMetadata,
  formatTurnModelChange,
  formatTurnUsage,
  usageTotal,
  type ModelRequestUsage,
  type TokenUsage,
} from "../src/usage.shared";

const firstUsage: TokenUsage = {
  input: 100,
  cacheRead: 1_000,
  cacheWrite: 20,
  reasoning: 30,
  output: 50,
};

const secondUsage: TokenUsage = {
  input: 200,
  cacheRead: 2_000,
  cacheWrite: 40,
  reasoning: 60,
  output: 100,
};

describe("turn usage aggregation", () => {
  it("sums completed requests and uses the last request for context", () => {
    const requests: ModelRequestUsage[] = [
      {
        turnId: "user-1",
        displayMessageIds: ["assistant-1"],
        modelId: "provider-a/model-a",
        tokens: firstUsage,
        hasVisibleText: true,
      },
      {
        turnId: "user-1",
        displayMessageIds: ["assistant-2", "assistant-live-2"],
        modelId: "provider-b/model-b",
        tokens: secondUsage,
        hasVisibleText: false,
        contextWindowUsed: 2_000,
      },
      {
        turnId: "user-1",
        displayMessageIds: ["assistant-3"],
        modelId: "provider-b/model-b",
        tokens: null,
        hasVisibleText: true,
      },
    ];

    expect(
      aggregateTurnUsage(
        requests,
        new Map([
          ["provider-a/model-a", 8_000],
          ["provider-b/model-b", 16_000],
        ]),
      ),
    ).toEqual([
      {
        displayMessageIds: ["assistant-1"],
        responseIndex: 1,
        requestCount: 2,
        tokens: {
          input: 300,
          cacheRead: 3_000,
          cacheWrite: 60,
          reasoning: 90,
          output: 150,
        },
        contextWindow: {
          used: 2_000,
          max: 16_000,
        },
      },
    ]);
  });

  it("does not emit turns without completed requests or visible assistant text", () => {
    expect(
      aggregateTurnUsage(
        [
          {
            turnId: "user-1",
            displayMessageIds: ["assistant-1"],
            modelId: null,
            tokens: null,
            hasVisibleText: true,
          },
          {
            turnId: "user-2",
            displayMessageIds: ["assistant-2"],
            modelId: null,
            tokens: firstUsage,
            hasVisibleText: false,
          },
        ],
        new Map(),
      ),
    ).toEqual([]);
  });

  it("flags a model change on the first turn that uses the new model", () => {
    const requests: ModelRequestUsage[] = [
      {
        turnId: "user-1",
        displayMessageIds: ["assistant-1"],
        modelId: "provider/model-a",
        tokens: firstUsage,
        hasVisibleText: true,
      },
      {
        turnId: "user-2",
        displayMessageIds: ["assistant-2"],
        modelId: "provider/model-b",
        tokens: secondUsage,
        hasVisibleText: true,
      },
      {
        turnId: "user-3",
        displayMessageIds: ["assistant-3"],
        modelId: "provider/model-b",
        tokens: secondUsage,
        hasVisibleText: true,
      },
    ];

    const turns = aggregateTurnUsage(requests, new Map());
    expect(turns[0]?.modelChange).toBeUndefined();
    expect(turns[1]?.modelChange).toEqual({
      from: "provider/model-a",
      to: "provider/model-b",
    });
    expect(turns[2]?.modelChange).toBeUndefined();
  });
});

describe("usage formatting", () => {
  it("recalculates totals from all five categories", () => {
    expect(usageTotal(firstUsage)).toBe(1_200);
  });

  it("keeps timeline abbreviations in thousands", () => {
    expect(formatTimelineTokens(999)).toBe("999");
    expect(formatTimelineTokens(1_500)).toBe("2K");
    expect(formatTimelineTokens(3_480_643)).toBe("3,481K");
  });

  it("formats wide timeline details", () => {
    expect(
      formatTurnUsage({
        displayMessageIds: ["assistant-1"],
        responseIndex: 10,
        requestCount: 2,
        tokens: secondUsage,
        contextWindow: { used: 2_400, max: 16_000 },
      }),
    ).toBe(
      "2K total tokens · 200 input · 2K cache read · 40 cache write · " +
        "60 reasoning · 100 output",
    );
    expect(
      formatTurnMetadata({
        displayMessageIds: ["assistant-1"],
        responseIndex: 10,
        requestCount: 2,
        tokens: secondUsage,
        contextWindow: { used: 2_400, max: 16_000 },
      }),
    ).toBe("assistant turn 10 · 2 model requests · context 15% (2K / 16K)");
    expect(
      formatCollapsedTurnMetadata({
        displayMessageIds: ["assistant-1"],
        responseIndex: 10,
        requestCount: 2,
        tokens: secondUsage,
        contextWindow: { used: 2_400, max: 16_000 },
      }),
    ).toBe("assistant turn 10 · see token usage");
  });

  it("formats compact timeline details on three lines", () => {
    const turn = {
      displayMessageIds: ["assistant-1"],
      responseIndex: 10,
      requestCount: 2,
      tokens: secondUsage,
      contextWindow: { used: 2_400, max: 16_000 },
    };

    expect(formatCompactTurnMetadata(turn)).toBe("assistant turn 10 · 2 model requests");
    expect(formatCompactTurnSummary(turn)).toBe("2K total tokens · context 15% (2K / 16K)");
    expect(formatCompactTurnUsage(turn)).toBe(
      "200 in · 2K cache read · 40 cache write · 60 reasoning · 100 out",
    );
  });

  it("formats model changes", () => {
    expect(
      formatTurnModelChange({
        displayMessageIds: ["assistant-1"],
        responseIndex: 2,
        requestCount: 1,
        modelChange: { from: "provider/model-a", to: "provider/model-b" },
        tokens: secondUsage,
        contextWindow: null,
      }),
    ).toBe("model changed from provider/model-a to provider/model-b");
  });
});

describe("compaction usage matching", () => {
  const compactions = [
    { timestamp: 1_000_000, tokens: firstUsage },
    { timestamp: 2_000_000, tokens: secondUsage },
  ];

  it("uses the nearest provider event within five minutes", () => {
    expect(findCompactionUsage(compactions, 2_001_000)).toEqual(compactions[1]);
  });

  it("does not use a distant provider event", () => {
    expect(findCompactionUsage(compactions, 3_000_000)).toBeUndefined();
  });
});
