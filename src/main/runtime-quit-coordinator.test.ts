import { EventEmitter } from "node:events";
import { describe, expect, test } from "vitest";

import {
  closeWindowsBeforeRuntimeShutdown,
  type FlushableRuntimeWindow,
} from "./runtime-quit-coordinator";

class FakeWindow extends EventEmitter implements FlushableRuntimeWindow {
  closeCalls = 0;
  destroyed = false;

  close(): void {
    this.closeCalls += 1;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  finishClose(): void {
    this.destroyed = true;
    this.emit("closed");
  }
}

describe("closeWindowsBeforeRuntimeShutdown", () => {
  test("waits for every renderer-driven close before allowing shutdown", async () => {
    const first = new FakeWindow();
    const second = new FakeWindow();
    let settled = false;
    const pending = closeWindowsBeforeRuntimeShutdown([first, second]).then(() => {
      settled = true;
    });

    expect(first.closeCalls).toBe(1);
    expect(second.closeCalls).toBe(1);
    first.finishClose();
    await Promise.resolve();
    expect(settled).toBe(false);
    second.finishClose();
    await pending;
    expect(settled).toBe(true);
  });

  test("skips windows that are already destroyed", async () => {
    const window = new FakeWindow();
    window.destroyed = true;

    await closeWindowsBeforeRuntimeShutdown([window]);

    expect(window.closeCalls).toBe(0);
  });
});
