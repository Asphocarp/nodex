import { describe, expect, test } from "bun:test";
import {
  isThreadScrollNearBottom,
  resolveThreadScrollModeForScrollEvent,
} from "./local-conversation-thread-scroll-controller";

describe("isThreadScrollNearBottom", () => {
  test("treats positions within the Codex near-bottom threshold as bottom", () => {
    expect(
      isThreadScrollNearBottom({
        scrollHeight: 1_000,
        scrollTop: 476,
        clientHeight: 500,
      }),
    ).toBeTrue();
  });

  test("treats positions beyond the Codex near-bottom threshold as scrolled away", () => {
    expect(
      isThreadScrollNearBottom({
        scrollHeight: 2_000,
        scrollTop: 1_300,
        clientHeight: 500,
      }),
    ).toBeFalse();
  });
});

describe("resolveThreadScrollModeForScrollEvent", () => {
  test("preserves programmatic find mode during follow-up scroll events", () => {
    expect(
      resolveThreadScrollModeForScrollEvent({
        currentMode: "programmaticFind",
        isNearBottom: false,
        nowMs: 1_000,
        userScrollGraceUntilMs: 1_500,
        programmaticScrollSettledUntilMs: 1_100,
      }),
    ).toBe("programmaticFind");
  });

  test("returns stickToBottom when the scroll position reaches the bottom again", () => {
    expect(
      resolveThreadScrollModeForScrollEvent({
        currentMode: "user",
        isNearBottom: true,
        nowMs: 1_000,
        userScrollGraceUntilMs: 1_500,
        programmaticScrollSettledUntilMs: 900,
      }),
    ).toBe("stickToBottom");
  });

  test("returns user when the user recently scrolled away and programmatic scrolling has settled", () => {
    expect(
      resolveThreadScrollModeForScrollEvent({
        currentMode: "stickToBottom",
        isNearBottom: false,
        nowMs: 1_000,
        userScrollGraceUntilMs: 1_200,
        programmaticScrollSettledUntilMs: 900,
      }),
    ).toBe("user");
  });

  test("does not leave stickToBottom without a recent user interaction", () => {
    expect(
      resolveThreadScrollModeForScrollEvent({
        currentMode: "stickToBottom",
        isNearBottom: false,
        nowMs: 2_000,
        userScrollGraceUntilMs: 1_200,
        programmaticScrollSettledUntilMs: 900,
      }),
    ).toBe("stickToBottom");
  });
});
