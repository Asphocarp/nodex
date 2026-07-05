import { describe, expect, test } from "bun:test";
import { resolveThreadBlockRenderKey } from "./local-conversation-thread-turn";

describe("resolveThreadBlockRenderKey", () => {
  test("prefers the projection render key over the business block id", () => {
    expect(resolveThreadBlockRenderKey({
      id: "patch-1::collapsed-tool-activity",
      renderKey: "collapsed-tool-activity:item:patch:patch-1:0",
    })).toBe("collapsed-tool-activity:item:patch:patch-1:0");
  });

  test("falls back to the block id when no stable render key is projected", () => {
    expect(resolveThreadBlockRenderKey({ id: "assistant-1" })).toBe("assistant-1");
  });
});
