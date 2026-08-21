import { describe, expect, test } from "vitest";
import { resolveThreadBlockRenderKey } from "./local-conversation-thread-turn";

describe("resolveThreadBlockRenderKey", () => {
  test("prefers the projection render key over the business block id", () => {
    expect(
      resolveThreadBlockRenderKey({
        id: "patch-1::agent-activity-group",
        renderKey: "agent-activity-group:item:patch:patch-1:0",
      }),
    ).toBe("agent-activity-group:item:patch:patch-1:0");
  });

  test("falls back to the block id when no stable render key is projected", () => {
    expect(resolveThreadBlockRenderKey({ id: "assistant-1" })).toBe("assistant-1");
  });
});
