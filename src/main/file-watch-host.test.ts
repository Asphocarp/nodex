import { EventEmitter } from "node:events";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import {
  NodeFileWatchHost,
  type NativeFileWatchFactory,
} from "./file-watch-host";

class FakeNativeWatcher extends EventEmitter {
  readonly close = vi.fn();
}

function createHarness() {
  const watcher = new FakeNativeWatcher();
  let listener:
    | Parameters<NativeFileWatchFactory>[2]
    | null = null;
  const watchFactory = vi.fn<NativeFileWatchFactory>(
    (_watchPath, _options, nextListener) => {
      listener = nextListener;
      return watcher;
    },
  );
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

describe("NodeFileWatchHost", () => {
  test("normalizes changed paths and reports rename parents when requested", async () => {
    const harness = createHarness();
    const changes: string[][] = [];
    const session = await harness.host.startFileWatch({
      path: path.join(path.sep, "repo"),
      recursive: true,
      renameEventHandling: "changed-path-with-parent-directory",
      onChange: (change) => {
        changes.push([...change.changedPaths]);
      },
    });

    harness.listener()("change", "src/example.ts");
    harness.listener()("rename", Buffer.from("src/renamed.ts"));
    harness.listener()("change", null);

    expect(harness.watchFactory).toHaveBeenCalledWith(
      path.join(path.sep, "repo"),
      { recursive: true },
      expect.any(Function),
    );
    expect(changes).toEqual([
      [path.join(path.sep, "repo", "src", "example.ts")],
      [
        path.join(path.sep, "repo", "src", "renamed.ts"),
        path.join(path.sep, "repo", "src"),
      ],
      [],
    ]);
    expect(session.coverage).toEqual({
      recursive: true,
      typedPathChanges: false,
    });
  });

  test("closes once for errors or repeated disposal", async () => {
    const errorHarness = createHarness();
    const errorSession = await errorHarness.host.startFileWatch({
      path: path.join(path.sep, "repo"),
      recursive: false,
      renameEventHandling: "changed-path",
      onChange: () => {},
    });
    const error = new Error("watch failed");
    errorHarness.watcher.emit("error", error);

    await expect(errorSession.closed).resolves.toEqual({
      reason: "watch-error",
      error,
    });
    await errorSession.dispose();
    expect(errorHarness.watcher.close).toHaveBeenCalledTimes(1);

    const disposeHarness = createHarness();
    const disposeSession = await disposeHarness.host.startFileWatch({
      path: path.join(path.sep, "repo"),
      recursive: false,
      renameEventHandling: "changed-path",
      onChange: () => {},
    });
    await disposeSession.dispose();
    await disposeSession.dispose();
    await expect(disposeSession.closed).resolves.toEqual({
      reason: "disposed",
    });
    expect(disposeHarness.watcher.close).toHaveBeenCalledTimes(1);
  });
});
