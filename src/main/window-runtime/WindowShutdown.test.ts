import { EventEmitter } from "node:events";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { TestClock } from "effect/testing";
import { expect } from "vite-plus/test";
import { make, type ShutdownWindow } from "./WindowShutdown";

class FakeWindow extends EventEmitter implements ShutdownWindow {
  readonly id: number;
  closeCalls = 0;
  destroyCalls = 0;
  destroyed = false;
  closeFailure: unknown = undefined;
  destroyFailure: unknown = undefined;

  constructor(id: number) {
    super();
    this.id = id;
  }

  close(): void {
    this.closeCalls += 1;
    if (this.closeFailure !== undefined) throw this.closeFailure;
  }

  destroy(): void {
    this.destroyCalls += 1;
    if (this.destroyFailure !== undefined) throw this.destroyFailure;
    this.destroyed = true;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  finishClose(): void {
    this.destroyed = true;
    this.emit("closed");
  }
}

it.effect("closes every window within a deadline and reports exact escalation", () =>
  Effect.gen(function* () {
    const graceful = new FakeWindow(1);
    const timedOut = new FakeWindow(2);
    const closeThrows = new FakeWindow(3);
    closeThrows.closeFailure = new Error("close failed");
    const destroyThrows = new FakeWindow(4);
    destroyThrows.destroyFailure = new Error("destroy failed");
    const alreadyClosed = new FakeWindow(5);
    alreadyClosed.destroyed = true;
    const shutdown = make("1 second");

    const fiber = yield* shutdown
      .closeAll([graceful, timedOut, closeThrows, destroyThrows, alreadyClosed])
      .pipe(Effect.forkChild);
    yield* Effect.yieldNow;
    graceful.finishClose();
    yield* TestClock.adjust("1 second");
    const report = yield* Fiber.join(fiber);

    expect(report).toEqual({
      alreadyClosed: 1,
      destroyed: 2,
      failed: 1,
      failures: [{ phase: "destroy", reason: "destroy failed", windowId: 4 }],
      graceful: 1,
      total: 5,
    });
    expect(timedOut.destroyCalls).toBe(1);
    expect(closeThrows.destroyCalls).toBe(1);
    expect(destroyThrows.destroyCalls).toBe(1);
    expect(graceful.listenerCount("closed")).toBe(0);
    expect(timedOut.listenerCount("closed")).toBe(0);
    expect(closeThrows.listenerCount("closed")).toBe(0);
    expect(destroyThrows.listenerCount("closed")).toBe(0);
  }),
);

it.effect("is idempotent for windows that are already gone", () =>
  Effect.gen(function* () {
    const window = new FakeWindow(7);
    window.destroyed = true;

    const report = yield* make(0).closeAll([window]);

    expect(report.alreadyClosed).toBe(1);
    expect(window.closeCalls).toBe(0);
    expect(window.destroyCalls).toBe(0);
  }),
);
