import { describe, expect, test, vi } from "vite-plus/test";

import { BoundedBurstScheduler } from "./bounded-burst-scheduler";

describe("BoundedBurstScheduler", () => {
  test("runs after quiet but never starves during continuous requests", async () => {
    vi.useFakeTimers();
    try {
      const ready = vi.fn();
      const scheduler = new BoundedBurstScheduler({
        quietMs: 100,
        maxMs: 500,
        onReady: ready,
      });
      for (let elapsed = 0; elapsed < 500; elapsed += 50) {
        scheduler.request();
        await vi.advanceTimersByTimeAsync(50);
      }

      expect(ready).toHaveBeenCalledOnce();
      expect(scheduler.scheduled).toBe(false);
      scheduler.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  test("does not leave a second timer behind a queued flush", async () => {
    const ready = vi.fn();
    const scheduler = new BoundedBurstScheduler({
      quietMs: 100,
      maxMs: 500,
      onReady: ready,
    });

    scheduler.flush();
    scheduler.request();
    await Promise.resolve();

    expect(ready).toHaveBeenCalledOnce();
    expect(scheduler.scheduled).toBe(false);
    scheduler.dispose();
  });
});
