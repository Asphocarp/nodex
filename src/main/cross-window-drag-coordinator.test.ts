import { describe, expect, test } from "bun:test";
import {
  CROSS_WINDOW_DRAG_TOKEN_VERSION,
  type CrossWindowDragPreview,
  type CrossWindowDragSourceResult,
  type CrossWindowDragStartInput,
} from "../shared/cross-window-drag";
import { CrossWindowDragCoordinator } from "./cross-window-drag-coordinator";

const SESSION_ONE = "00000000-0000-4000-8000-000000000001";
const SESSION_TWO = "00000000-0000-4000-8000-000000000002";
const GROUP_ONE = "00000000-0000-4000-8000-000000000011";

function makeBlockInput(
  sessionId = SESSION_ONE,
): Extract<CrossWindowDragStartInput, { kind: "blocks" }> {
  return {
    version: CROSS_WINDOW_DRAG_TOKEN_VERSION,
    sessionId,
    kind: "blocks",
    payload: {
      cards: [{ title: "Block", description: "Body" }],
      sourceUpdates: [],
      groupId: GROUP_ONE,
    },
  };
}

function makeHarness() {
  let nextTimerId = 1;
  const timers = new Map<number, () => void>();
  const previews: Array<CrossWindowDragPreview | null> = [];
  const sourceResults: Array<{ sourceId: number; result: CrossWindowDragSourceResult }> = [];
  const coordinator = new CrossWindowDragCoordinator({
    timers: {
      setTimeout(callback) {
        const timerId = nextTimerId;
        nextTimerId += 1;
        timers.set(timerId, callback);
        return timerId as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimeout(timer) {
        timers.delete(timer as unknown as number);
      },
    },
    onActiveChanged: (preview) => previews.push(preview),
    onSourceResult: (sourceId, result) => sourceResults.push({ sourceId, result }),
  });
  return {
    coordinator,
    previews,
    sourceResults,
    runNewestTimer() {
      const newest = [...timers.entries()].at(-1);
      if (!newest) return;
      timers.delete(newest[0]);
      newest[1]();
    },
  };
}

describe("cross-window drag coordinator", () => {
  test("publishes a bounded preview and releases the immutable payload only to another window", () => {
    const harness = makeHarness();
    const input = makeBlockInput();
    harness.coordinator.start(10, input);
    input.payload.cards[0]!.title = "Mutated after start";

    const preview = harness.coordinator.getActive();
    expect(preview?.kind).toBe("blocks");
    expect(preview?.kind === "blocks" ? preview.cards[0]?.title : "").toBe("Block");

    let sameWindowError = "";
    try {
      harness.coordinator.claim(10, { sessionId: SESSION_ONE, kind: "blocks" });
    } catch (error) {
      sameWindowError = (error as Error).message;
    }
    expect(sameWindowError).toBe("Cross-window drag must be claimed by another window");

    const claim = harness.coordinator.claim(20, {
      sessionId: SESSION_ONE,
      kind: "blocks",
    });
    expect(claim.kind).toBe("blocks");
    expect(harness.coordinator.getActive()).toBe(null);

    let doubleClaimError = "";
    try {
      harness.coordinator.claim(30, { sessionId: SESSION_ONE, kind: "blocks" });
    } catch (error) {
      doubleClaimError = (error as Error).message;
    }
    expect(doubleClaimError).toBe("Cross-window drag has already been claimed");

    expect(harness.coordinator.complete(20, {
      sessionId: SESSION_ONE,
      result: "invalid" as never,
    })).toBeFalse();

    expect(
      harness.coordinator.complete(20, { sessionId: SESSION_ONE, result: "copy" }),
    ).toBeTrue();
    expect(harness.sourceResults[0]?.sourceId).toBe(10);
    expect(harness.sourceResults[0]?.result.result).toBe("copy");
  });

  test("replaces unclaimed drags and cancels source-ended or destroyed claims", () => {
    const harness = makeHarness();
    harness.coordinator.start(10, makeBlockInput(SESSION_ONE));
    harness.coordinator.start(11, makeBlockInput(SESSION_TWO));
    expect(harness.sourceResults[0]?.result.result).toBe("cancel");
    expect(harness.coordinator.getActive()?.sessionId).toBe(SESSION_TWO);

    expect(harness.coordinator.sourceEnded(11, SESSION_TWO)).toBeTrue();
    harness.runNewestTimer();
    expect(harness.sourceResults[1]?.result.result).toBe("cancel");

    harness.coordinator.start(12, makeBlockInput(SESSION_ONE));
    harness.coordinator.claim(22, { sessionId: SESSION_ONE, kind: "blocks" });
    harness.coordinator.handleWebContentsDestroyed(22);
    expect(harness.sourceResults[2]?.sourceId).toBe(12);
    expect(harness.sourceResults[2]?.result.result).toBe("cancel");
  });
});
