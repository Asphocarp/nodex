import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { assert, it } from "@effect/vitest";
import { describe, vi } from "vite-plus/test";
import { makeBrowserPageEmulationRuntime } from "./browser-page-emulation";

function target({ initiallyAttached = false } = {}) {
  const commands: Array<[string, Record<string, unknown> | undefined]> = [];
  let attached = initiallyAttached;
  return {
    commands,
    target: {
      debugger: {
        attach: vi.fn((_protocolVersion?: string) => {
          attached = true;
        }),
        detach: vi.fn(() => {
          attached = false;
        }),
        isAttached: () => attached,
        sendCommand: vi.fn(async (method: string, params?: Record<string, unknown>) => {
          commands.push([method, params]);
        }),
      },
      isDestroyed: () => false,
    },
  };
}

describe("Browser page emulation runtime", () => {
  it.effect("retains one debugger session and detaches it when its Scope closes", () =>
    Effect.gen(function* () {
      const fixture = target();
      yield* Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* makeBrowserPageEmulationRuntime;
          const result = yield* runtime.syncDeviceMetrics(fixture.target, {
            width: 393,
            height: 852,
            zoomPercent: 100,
            presetId: "iphone-15-pro",
          });
          assert.deepEqual(result, { ok: true });
          assert.isTrue(runtime.isDebuggerRetained(fixture.target));
        }),
      );

      assert.strictEqual(fixture.target.debugger.attach.mock.calls[0]?.[0], "1.3");
      assert.strictEqual(fixture.target.debugger.detach.mock.calls.length, 1);
      assert.deepEqual(
        fixture.commands.map(([method]) => method),
        ["Emulation.setDeviceMetricsOverride", "Emulation.setTouchEmulationEnabled"],
      );
    }),
  );

  it.effect("serializes mutations for one guest", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = target({ initiallyAttached: true });
        let releaseFirstCommand: () => void = () => undefined;
        let markFirstCommandStarted: () => void = () => undefined;
        const firstCommandStarted = new Promise<void>((resolve) => {
          markFirstCommandStarted = resolve;
        });
        fixture.target.debugger.sendCommand.mockImplementationOnce(
          async (method: string, params?: Record<string, unknown>) => {
            fixture.commands.push([method, params]);
            markFirstCommandStarted();
            await new Promise<void>((resolve) => {
              releaseFirstCommand = resolve;
            });
          },
        );
        const runtime = yield* makeBrowserPageEmulationRuntime;
        const colorScheme = yield* Effect.forkChild(
          runtime.syncColorScheme(fixture.target, "light"),
        );
        const metrics = yield* Effect.forkChild(runtime.clearDeviceMetrics(fixture.target));
        yield* Effect.promise(() => firstCommandStarted);
        assert.deepEqual(
          fixture.commands.map(([method]) => method),
          ["Emulation.setEmulatedMedia"],
        );

        releaseFirstCommand();
        assert.deepEqual(yield* Effect.all([Fiber.join(colorScheme), Fiber.join(metrics)]), [
          { ok: true },
          { ok: true },
        ]);
        assert.deepEqual(
          fixture.commands.map(([method]) => method),
          [
            "Emulation.setEmulatedMedia",
            "Emulation.clearDeviceMetricsOverride",
            "Emulation.setTouchEmulationEnabled",
          ],
        );
      }),
    ),
  );

  it.effect("closes admission, drains the guest lane, and detaches on release", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = target();
        let finishCommand: () => void = () => undefined;
        let markCommandStarted: () => void = () => undefined;
        const commandStarted = new Promise<void>((resolve) => {
          markCommandStarted = resolve;
        });
        fixture.target.debugger.sendCommand.mockImplementationOnce(async () => {
          markCommandStarted();
          await new Promise<void>((resolve) => {
            finishCommand = resolve;
          });
        });
        const runtime = yield* makeBrowserPageEmulationRuntime;
        const command = yield* Effect.forkChild(runtime.syncColorScheme(fixture.target, "dark"));
        yield* Effect.promise(() => commandStarted);
        const release = yield* Effect.forkChild(runtime.release(fixture.target));
        yield* Effect.yieldNow;
        assert.strictEqual(fixture.target.debugger.detach.mock.calls.length, 0);
        assert.isTrue(runtime.isDebuggerRetained(fixture.target));
        assert.deepEqual(yield* runtime.retainDebugger(fixture.target), {
          ok: false,
          reason: "target-destroyed",
        });

        finishCommand();
        assert.deepEqual(yield* Fiber.join(command), { ok: true });
        yield* Fiber.join(release);
        assert.strictEqual(fixture.target.debugger.detach.mock.calls.length, 1);
        assert.isFalse(runtime.isDebuggerRetained(fixture.target));
        assert.deepEqual(yield* runtime.retainDebugger(fixture.target), {
          ok: false,
          reason: "target-destroyed",
        });
      }),
    ),
  );
});
