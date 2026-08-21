import { describe, expect, it } from "vite-plus/test";
import { resolveSideChatProjectId } from "./side-chat-conversation-context";

describe("resolveSideChatProjectId", () => {
  it("preserves an explicit projectless owner on a ready side chat", () => {
    expect(
      resolveSideChatProjectId({
        ready: true,
        conversationProjectId: null,
        parentProjectId: "project-1",
      }),
    ).toBe(null);
  });

  it("uses the parent owner until the child conversation is ready", () => {
    expect(
      resolveSideChatProjectId({
        ready: false,
        conversationProjectId: null,
        parentProjectId: "project-1",
      }),
    ).toBe("project-1");
  });
});
