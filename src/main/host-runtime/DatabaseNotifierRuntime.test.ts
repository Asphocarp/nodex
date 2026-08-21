import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { assert, it } from "@effect/vitest";
import type { BrowserWindow } from "electron";
import { DatabaseNotifier } from "../local-store/notifier";
import { WindowRuntime } from "../window-runtime/WindowRuntime";
import { fromNotifier } from "./DatabaseNotifierRuntime";

it.effect("broadcasts database events and releases every notifier listener", () =>
  Effect.gen(function* () {
    const notifier = new DatabaseNotifier();
    const sent: Array<{ channel: string; payload: unknown }> = [];
    const window = {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        send: (channel: string, payload: unknown) => sent.push({ channel, payload }),
      },
    } as unknown as BrowserWindow;
    const windows = {
      all: () => [window],
      count: () => 1,
    } as unknown as WindowRuntime["Service"];
    const scope = yield* Scope.make();
    yield* Layer.buildWithScope(
      fromNotifier(notifier).pipe(Layer.provide(Layer.succeed(WindowRuntime, windows))),
      scope,
    );
    assert.strictEqual(notifier.listenerCount("board-changed"), 1);
    notifier.notifyChange("project-1", "update", "column-1");
    assert.deepEqual(sent, [
      {
        channel: "board-changed",
        payload: {
          projectId: "project-1",
          changeType: "update",
          columnId: "column-1",
          pageId: undefined,
          status: "column-1",
        },
      },
    ]);

    yield* Scope.close(scope, Exit.void);
    assert.strictEqual(notifier.eventNames().length, 0);
  }),
);
