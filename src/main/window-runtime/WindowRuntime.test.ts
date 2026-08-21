import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { assert, it } from "@effect/vitest";
import type { BrowserWindow } from "electron";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { WindowSessionState } from "../window-session-state";
import { fromState, WindowRuntime } from "./WindowRuntime";

const fakeWindow = (webContentsId: number) => {
  let destroyed = false;
  const events = new EventEmitter();
  const sentChannels: string[] = [];
  return {
    window: {
      id: webContentsId,
      destroy: () => {
        destroyed = true;
        events.emit("closed");
      },
      close: () => {
        let prevented = false;
        events.emit("close", { preventDefault: () => (prevented = true) });
        if (prevented) return;
        destroyed = true;
        events.emit("closed");
      },
      getBounds: () => ({ x: 0, y: 0, width: 1_400, height: 900 }),
      isFullScreen: () => false,
      isFocused: () => false,
      isMaximized: () => false,
      isDestroyed: () => destroyed,
      on: events.on.bind(events),
      removeListener: events.removeListener.bind(events),
      setBackgroundColor: () => undefined,
      setVibrancy: () => undefined,
      webContents: {
        id: webContentsId,
        isDestroyed: () => false,
        send: (channel: string) => sentChannels.push(channel),
      },
    } as unknown as BrowserWindow,
    isDestroyed: () => destroyed,
    sentChannels,
  };
};

it.effect("owns window registration, focus, session assignment, and final release", () =>
  Effect.gen(function* () {
    const userDataPath = mkdtempSync(join(tmpdir(), "window-runtime-"));
    const sessions = new WindowSessionState(userDataPath);
    const firstSession = sessions.createFreshSession();
    const secondSession = sessions.createFreshSession();
    const first = fakeWindow(11);
    const second = fakeWindow(22);
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(fromState(sessions), scope);
    const runtime = Context.get(context, WindowRuntime);

    runtime.attach(first.window, firstSession.id);
    runtime.attach(second.window, secondSession.id);
    assert.strictEqual(runtime.count(), 2);
    assert.strictEqual(runtime.getLastFocused(), second.window);
    assert.strictEqual(runtime.resolveSessionId(11), firstSession.id);

    runtime.markFocused(11);
    assert.strictEqual(runtime.getLastFocused(), first.window);
    runtime.release(11, { disposition: "user-close" });
    assert.isFalse(runtime.has(11));
    assert.isNull(runtime.resolveSessionId(11));

    yield* Scope.close(scope, Exit.void);
    assert.isTrue(second.isDestroyed());
    assert.strictEqual(runtime.count(), 0);
    assert.isNull(runtime.resolveSessionId(22));
  }),
);

it.effect("owns the bounded renderer flush handshake before a user close", () =>
  Effect.gen(function* () {
    const userDataPath = mkdtempSync(join(tmpdir(), "window-close-runtime-"));
    const sessions = new WindowSessionState(userDataPath);
    const windowSession = sessions.createFreshSession();
    const subject = fakeWindow(33);
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(fromState(sessions), scope);
    const runtime = Context.get(context, WindowRuntime);
    runtime.attach(subject.window, windowSession.id);

    subject.window.close();
    assert.isTrue(runtime.has(33));
    assert.deepStrictEqual(subject.sentChannels, ["app:flush-before-close"]);

    runtime.acknowledgeClose(33);
    assert.isTrue(subject.isDestroyed());
    assert.isFalse(runtime.has(33));
    assert.isNull(runtime.resolveSessionId(33));

    yield* Scope.close(scope, Exit.void);
  }),
);
