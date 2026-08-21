import { describe, expect, test } from "vite-plus/test";
import { CodexManualCompactionTracker } from "./codex-manual-compaction-tracker";

describe("CodexManualCompactionTracker", () => {
  test("consumes one manual registration at a time per thread", () => {
    const tracker = new CodexManualCompactionTracker();

    expect(tracker.register("thread-a")).toBe(1);
    expect(tracker.register("thread-a")).toBe(2);
    expect(tracker.register("thread-b")).toBe(1);

    expect(tracker.consumeSource("thread-a")).toBe("manual");
    expect(tracker.getPendingCount("thread-a")).toBe(1);
    expect(tracker.consumeSource("thread-a")).toBe("manual");
    expect(tracker.consumeSource("thread-a")).toBe("automatic");
    expect(tracker.consumeSource("thread-b")).toBe("manual");
  });

  test("cancels only the failed request registration", () => {
    const tracker = new CodexManualCompactionTracker();
    tracker.register("thread-a");
    tracker.register("thread-a");

    expect(tracker.cancel("thread-a")).toBe(1);
    expect(tracker.consumeSource("thread-a")).toBe("manual");
    expect(tracker.getPendingCount("thread-a")).toBe(0);
  });
});
