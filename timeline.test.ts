import { describe, expect, it } from "vitest";
import { transformAssistantMessage } from "./timeline.shared";

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
          kind: "hello-assistant-message",
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
