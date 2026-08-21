import { describe, expect, test } from "vitest";
import { resolvePresentedSessionThread } from "./workbench-session-thread-presentation";

describe("Session thread launch presentation", () => {
  test("keeps a newly linked thread detached until its optimistic first turn is visible", () => {
    const attached = { threadId: "thread-created" };

    expect(
      resolvePresentedSessionThread(attached, {
        rendererLaunchPending: true,
        waitForFirstVisibleTurn: true,
        hasVisibleFirstTurn: false,
      }),
    ).toBeNull();
    expect(
      resolvePresentedSessionThread(attached, {
        rendererLaunchPending: false,
        waitForFirstVisibleTurn: true,
        hasVisibleFirstTurn: true,
      }),
    ).toBe(attached);
  });

  test("keeps the launch detached between barrier release and the first visible turn", () => {
    const attached = { threadId: "thread-created" };

    expect(
      resolvePresentedSessionThread(attached, {
        rendererLaunchPending: false,
        waitForFirstVisibleTurn: true,
        hasVisibleFirstTurn: false,
      }),
    ).toBeNull();
  });

  test("does not alter ordinary attached or blank Sessions", () => {
    const attached = { threadId: "thread-existing" };

    expect(resolvePresentedSessionThread(attached, null)).toBe(attached);
    expect(
      resolvePresentedSessionThread(null, {
        rendererLaunchPending: true,
      }),
    ).toBeNull();
  });
});
