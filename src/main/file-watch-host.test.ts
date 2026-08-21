import { EventEmitter } from "node:events";
import path from "node:path";
import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { describe, expect, vi } from "vite-plus/test";
import { NodeFileWatchHost, type NativeFileWatchFactory } from "./file-watch-host";

class FakeNativeWatcher extends EventEmitter {
  readonly close = vi.fn();
}

function createHarness() {
  const watcher = new FakeNativeWatcher();
  let listener: Parameters<NativeFileWatchFactory>[2] | null = null;
  const watchFactory = vi.fn<NativeFileWatchFactory>((_watchPath, _options, nextListener) => {
    listener = nextListener;
    return watcher;
  });
  return {
    host: new NodeFileWatchHost(watchFactory),
    listener: () => {
      if (listener === null) throw new Error("Watcher listener was not set.");
      return listener;
    },
    watcher,
    watchFactory,
  };
}

const awaitStarted = (harness: ReturnType<typeof createHarness>) =>
  Effect.gen(function* () {
    while (harness.watchFactory.mock.calls.length === 0) yield* Effect.yieldNow;
  });

describe("NodeFileWatchHost", () => {
  it.effect("streams normalized changes and releases the native watcher", () =>
    Effect.gen(function* () {
      const harness = createHarness();
      const eventsFiber = yield* harness.host
        .watch({
          path: path.join(path.sep, "repo"),
          recursive: true,
          renameEventHandling: "changed-path-with-parent-directory",
        })
        .pipe(Stream.take(4), Stream.runCollect, Effect.forkChild);
      yield* awaitStarted(harness);

      harness.listener()("change", "src/example.ts");
      harness.listener()("rename", Buffer.from("src/renamed.ts"));
      harness.listener()("change", null);
      const events = yield* Fiber.join(eventsFiber);

      expect(harness.watchFactory).toHaveBeenCalledWith(
        path.join(path.sep, "repo"),
        { recursive: true },
        expect.any(Function),
      );
      expect(events).toEqual([
        {
          _tag: "Ready",
          coverage: { recursive: true, typedPathChanges: false },
          path: path.join(path.sep, "repo"),
        },
        { _tag: "Changed", changedPaths: [path.join(path.sep, "repo", "src", "example.ts")] },
        {
          _tag: "Changed",
          changedPaths: [
            path.join(path.sep, "repo", "src", "renamed.ts"),
            path.join(path.sep, "repo", "src"),
          ],
        },
        { _tag: "Changed", changedPaths: [] },
      ]);
      expect(harness.watcher.close).toHaveBeenCalledTimes(1);
    }),
  );

  it.effect("reports native failure and closes once through the stream Scope", () =>
    Effect.gen(function* () {
      const errorHarness = createHarness();
      const failureFiber = yield* errorHarness.host
        .watch({
          path: path.join(path.sep, "repo"),
          recursive: false,
          renameEventHandling: "changed-path",
        })
        .pipe(Stream.runDrain, Effect.flip, Effect.forkChild);
      yield* awaitStarted(errorHarness);
      const cause = new Error("watch failed");
      errorHarness.watcher.emit("error", cause);

      expect(yield* Fiber.join(failureFiber)).toMatchObject({
        _tag: "FileWatchError",
        path: path.join(path.sep, "repo"),
        cause,
      });
      expect(errorHarness.watcher.close).toHaveBeenCalledTimes(1);

      const acquisitionCause = new Error("watch unavailable");
      const unavailableHost = new NodeFileWatchHost(() => {
        throw acquisitionCause;
      });
      expect(
        yield* unavailableHost
          .watch({
            path: path.join(path.sep, "missing"),
            recursive: false,
            renameEventHandling: "changed-path",
          })
          .pipe(Stream.runDrain, Effect.flip),
      ).toMatchObject({
        _tag: "FileWatchError",
        path: path.join(path.sep, "missing"),
        cause: acquisitionCause,
      });

      const scopedHarness = createHarness();
      const parentScope = yield* Scope.Scope;
      const watchScope = yield* Scope.fork(parentScope);
      yield* scopedHarness.host
        .watch({
          path: path.join(path.sep, "repo"),
          recursive: false,
          renameEventHandling: "changed-path",
        })
        .pipe(Stream.runDrain, Effect.forkScoped, Scope.provide(watchScope));
      yield* awaitStarted(scopedHarness);
      yield* Scope.close(watchScope, Exit.void);

      expect(scopedHarness.watcher.close).toHaveBeenCalledTimes(1);
    }),
  );
});
