import { describe, expect, test } from "vitest";
import {
  parseCodexUserInputAutoResolutionActivityInput,
  parseCodexUserInputAutoResolutionTarget,
} from "./codex-user-input-auto-resolution";

describe("Codex user-input auto-resolution IPC validation", () => {
  test("accepts trimmed conversation identities and strict scalar request ids", () => {
    expect(parseCodexUserInputAutoResolutionActivityInput({
      conversationId: " thread-1 ",
    })).toBe("thread-1");
    expect(parseCodexUserInputAutoResolutionTarget({
      conversationId: " thread-1 ",
      requestId: 0,
    })).toEqual({
      conversationId: "thread-1",
      requestId: 0,
    });
    expect(parseCodexUserInputAutoResolutionTarget({
      conversationId: "thread-1",
      requestId: "",
    })).toEqual({
      conversationId: "thread-1",
      requestId: "",
    });
  });

  test.each([
    null,
    undefined,
    [],
    {},
    { conversationId: "" },
    { conversationId: "   " },
    { conversationId: "thread-1", requestId: null },
    { conversationId: "thread-1", requestId: Number.NaN },
    { conversationId: "thread-1", requestId: Number.POSITIVE_INFINITY },
    { conversationId: "thread-1", requestId: true },
  ])("rejects malformed input %#", (input) => {
    expect(parseCodexUserInputAutoResolutionTarget(input)).toBeNull();
  });
});
