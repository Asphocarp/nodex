import { EventEmitter } from "node:events";
import { it } from "@effect/vitest";
import { Effect, Fiber, Option } from "effect";
import { describe, expect } from "vite-plus/test";

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
  it.effect("waits for every renderer-driven close before allowing shutdown", () =>
    Effect.gen(function* () {
      const first = new FakeWindow();
      const second = new FakeWindow();
      const fiber = yield* Effect.forkChild(closeWindowsBeforeRuntimeShutdown([first, second]));
      yield* Effect.yieldNow;

      expect(first.closeCalls).toBe(1);
      expect(second.closeCalls).toBe(1);
      first.finishClose();
      yield* Effect.yieldNow;
      expect(Option.isNone(yield* Fiber.join(fiber).pipe(Effect.timeoutOption(0)))).toBe(true);
      second.finishClose();
      yield* Fiber.join(fiber);
    }),
  );

  it.effect("skips windows that are already destroyed", () =>
    Effect.gen(function* () {
      const window = new FakeWindow();
      window.destroyed = true;

      yield* closeWindowsBeforeRuntimeShutdown([window]);

      expect(window.closeCalls).toBe(0);
    }),
  );
});
