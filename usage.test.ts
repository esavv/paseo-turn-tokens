import { describe, expect, it } from "vitest";
import {
  aggregateTurnUsage,
  formatCollapsedTurnMetadata,
  formatCompactTurnMetadata,
  formatCompactTurnSummary,
  formatCompactTurnUsage,
  formatTimelineTokens,
  formatTurnMetadata,
  formatTurnUsage,
  usageTotal,
  type ModelRequestUsage,
  type TokenUsage,
} from "./usage.shared";

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
        messageId: "assistant-1",
        parentMessageId: "user-1",
        providerId: "provider-a",
        modelId: "model-a",
        tokens: firstUsage,
        hasVisibleText: true,
      },
      {
        messageId: "assistant-2",
        parentMessageId: "user-1",
        providerId: "provider-b",
        modelId: "model-b",
        tokens: secondUsage,
        hasVisibleText: false,
      },
      {
        messageId: "assistant-3",
        parentMessageId: "user-1",
        providerId: "provider-b",
        modelId: "model-b",
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
        displayMessageId: "assistant-1",
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
          used: 2_400,
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
            messageId: "assistant-1",
            parentMessageId: "user-1",
            providerId: null,
            modelId: null,
            tokens: null,
            hasVisibleText: true,
          },
          {
            messageId: "assistant-2",
            parentMessageId: "user-2",
            providerId: null,
            modelId: null,
            tokens: firstUsage,
            hasVisibleText: false,
          },
        ],
        new Map(),
      ),
    ).toEqual([]);
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
        displayMessageId: "assistant-1",
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
        displayMessageId: "assistant-1",
        responseIndex: 10,
        requestCount: 2,
        tokens: secondUsage,
        contextWindow: { used: 2_400, max: 16_000 },
      }),
    ).toBe("assistant turn 10 · 2 model requests · context 15% (2K / 16K)");
    expect(
      formatCollapsedTurnMetadata({
        displayMessageId: "assistant-1",
        responseIndex: 10,
        requestCount: 2,
        tokens: secondUsage,
        contextWindow: { used: 2_400, max: 16_000 },
      }),
    ).toBe("assistant turn 10 * see token usage");
  });

  it("formats compact timeline details on three lines", () => {
    const turn = {
      displayMessageId: "assistant-1",
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
});
