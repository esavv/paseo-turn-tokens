import { describe, expect, it } from "vitest";
import {
  aggregateTurnUsage,
  formatCompactTokens,
  formatTimelineTokens,
  formatTurnMetadata,
  formatTurnUsage,
  summarizeSessionUsage,
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

  it("summarizes all completed requests in the session", () => {
    expect(
      summarizeSessionUsage(
        [
          {
            messageId: "assistant-1",
            parentMessageId: "user-1",
            providerId: null,
            modelId: null,
            tokens: firstUsage,
            hasVisibleText: true,
          },
          {
            messageId: "assistant-2",
            parentMessageId: "user-1",
            providerId: null,
            modelId: null,
            tokens: null,
            hasVisibleText: false,
          },
          {
            messageId: "assistant-3",
            parentMessageId: "user-2",
            providerId: null,
            modelId: null,
            tokens: secondUsage,
            hasVisibleText: false,
          },
        ],
        3,
      ),
    ).toEqual({
      tokens: {
        input: 300,
        cacheRead: 3_000,
        cacheWrite: 60,
        reasoning: 90,
        output: 150,
      },
      requestCount: 2,
      compactionCount: 3,
    });
  });
});

describe("usage formatting", () => {
  it("recalculates totals from all five categories", () => {
    expect(usageTotal(firstUsage)).toBe(1_200);
  });

  it("matches Token Viz compact context formatting", () => {
    expect(formatCompactTokens(999)).toBe("999");
    expect(formatCompactTokens(1_500)).toBe("2K");
    expect(formatCompactTokens(1_500_000)).toBe("2M");
  });

  it("keeps timeline abbreviations in thousands", () => {
    expect(formatTimelineTokens(999)).toBe("999");
    expect(formatTimelineTokens(1_500)).toBe("2K");
    expect(formatTimelineTokens(3_480_643)).toBe("3,481K");
  });

  it("formats complete timeline details", () => {
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
    ).toBe("assistant response 10 · 2 model requests · context 15% (2K / 16K)");
  });
});
