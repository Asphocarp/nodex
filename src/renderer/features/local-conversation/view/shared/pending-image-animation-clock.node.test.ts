import { describe, expect, test, vi } from "vitest";

import { createPendingImageAnimationClock } from "./pending-image-animation-clock";

describe("pending image animation clock", () => {
  test("shares one frame across subscribers and stops it with the last unsubscribe", () => {
    let nextFrameId = 1;
    let nowMs = 0;
    const frames = new Map<number, (timestamp: number) => void>();
    const cancelFrame = vi.fn((frameId: number) => {
      frames.delete(frameId);
    });
    const clock = createPendingImageAnimationClock({
      cancelFrame,
      now: () => nowMs,
      requestFrame: (callback) => {
        const frameId = nextFrameId++;
        frames.set(frameId, callback);
        return frameId;
      },
    });
    const first = vi.fn();
    const second = vi.fn();

    const unsubscribeFirst = clock.subscribe(first);
    const unsubscribeSecond = clock.subscribe(second);
    expect(frames.size).toBe(1);
    expect(clock.getSubscriberCount()).toBe(2);

    const firstFrame = frames.values().next().value;
    if (!firstFrame) throw new Error("Expected a scheduled frame");
    frames.clear();
    nowMs = 16;
    firstFrame(16);

    expect(first).toHaveBeenCalledWith(16);
    expect(second).toHaveBeenCalledWith(16);
    expect(frames.size).toBe(1);

    unsubscribeFirst();
    expect(cancelFrame).not.toHaveBeenCalled();
    unsubscribeSecond();
    expect(cancelFrame).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);
  });

  test("never reports time moving backwards", () => {
    let nowMs = 20;
    const clock = createPendingImageAnimationClock({
      cancelFrame: () => undefined,
      now: () => nowMs,
      requestFrame: () => 1,
    });

    expect(clock.now()).toBe(20);
    nowMs = 10;
    expect(clock.now()).toBe(20);
    nowMs = 30;
    expect(clock.now()).toBe(30);
  });
});
