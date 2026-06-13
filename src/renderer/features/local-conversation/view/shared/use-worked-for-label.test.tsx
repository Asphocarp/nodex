import { afterEach, describe, expect, test } from "bun:test";
import { act } from "@testing-library/react";
import { createElement } from "react";
import { render } from "@/test/dom";
import { useWorkedForLabelText } from "./use-worked-for-label";

const originalDateNow = Date.now;
const originalSetInterval = window.setInterval;
const originalClearInterval = window.clearInterval;

afterEach(() => {
  Object.defineProperty(Date, "now", {
    configurable: true,
    value: originalDateNow,
  });
  window.setInterval = originalSetInterval;
  window.clearInterval = originalClearInterval;
});

function WorkedForProbe({ renderNonce }: { renderNonce: number }) {
  const label = useWorkedForLabelText({
    timing: {
      status: "working",
      startedAtMs: 1_000,
      completedAtMs: null,
    },
    durationMs: null,
  });

  return createElement("div", null, `${label ?? ""}:${renderNonce}`);
}

describe("useWorkedForLabelText", () => {
  test("keeps one active timer across new-but-equal timing rerenders", async () => {
    let nowMs = 1_500;
    const intervalCallbacks: Array<() => void> = [];
    const clearedIntervals: number[] = [];

    Object.defineProperty(Date, "now", {
      configurable: true,
      value: () => nowMs,
    });
    window.setInterval = ((callback: TimerHandler, timeout?: number) => {
      expect(timeout).toBe(1000);
      intervalCallbacks.push(callback as () => void);
      return intervalCallbacks.length;
    }) as typeof window.setInterval;
    window.clearInterval = ((timerId?: number) => {
      if (typeof timerId === "number") {
        clearedIntervals.push(timerId);
      }
    }) as typeof window.clearInterval;

    const view = render(createElement(WorkedForProbe, { renderNonce: 0 }));
    await act(async () => {
      await Promise.resolve();
    });

    expect(intervalCallbacks.length).toBe(1);
    expect(clearedIntervals.length).toBe(0);
    expect(Boolean(view.container.textContent?.includes("Working:0"))).toBeTrue();

    for (let renderNonce = 1; renderNonce <= 4; renderNonce += 1) {
      await act(async () => {
        view.rerender(createElement(WorkedForProbe, { renderNonce }));
        await Promise.resolve();
      });
    }

    expect(intervalCallbacks.length).toBe(1);
    expect(clearedIntervals.length).toBe(0);

    nowMs = 66_000;
    await act(async () => {
      intervalCallbacks[0]?.();
      await Promise.resolve();
    });

    expect(Boolean(view.container.textContent?.includes("Working for 1m 5s:4"))).toBeTrue();
  });
});
