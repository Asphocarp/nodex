import { EventEmitter } from "node:events";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { assert, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import type { BrowserWindow } from "electron";
import type { ComposerAppshotServiceDependencies } from "../composer-appshot-service";
import { ComposerAppshotRuntime, liveWithDependencies } from "./ComposerAppshotRuntime";

vi.mock("electron", () => ({
  desktopCapturer: { getSources: async () => [] },
  screen: { getDisplayMatching: () => ({ scaleFactor: 1 }) },
}));

class FakeWindow extends EventEmitter {
  readonly webContents = { id: 41 };
  isFocused(): boolean {
    return false;
  }
}

it.effect("releases observed windows and tracking timers with the Main Scope", () =>
  Effect.gen(function* () {
    let startTracking!: () => void;
    let clearedIntervals = 0;
    let clearedStartTimers = 0;
    const timer = { unref: () => timer } as unknown as NodeJS.Timeout;
    const dependencies: ComposerAppshotServiceDependencies = {
      platform: "darwin",
      processIdentifier: 7,
      helperAvailable: () => true,
      readFrontmostWindow: async () => null,
      listWindowSources: async () => [],
      displayScaleFactor: () => 1,
      createId: () => "target",
      scheduleInterval: () => timer,
      scheduleTimeout: (callback) => {
        startTracking = callback;
        return timer;
      },
      clearInterval: () => {
        clearedIntervals += 1;
      },
      clearTimeout: () => {
        clearedStartTimers += 1;
      },
    };
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(liveWithDependencies(dependencies), scope);
    const appshots = Context.get(context, ComposerAppshotRuntime);
    const window = new FakeWindow();

    appshots.observeWindow(window as unknown as BrowserWindow);
    assert.strictEqual(window.listenerCount("focus"), 1);
    assert.strictEqual(window.listenerCount("blur"), 1);
    assert.strictEqual(window.listenerCount("closed"), 1);
    startTracking();

    yield* Scope.close(scope, Exit.void);
    assert.strictEqual(clearedStartTimers, 0);
    assert.strictEqual(clearedIntervals, 1);
    assert.strictEqual(window.listenerCount("focus"), 0);
    assert.strictEqual(window.listenerCount("blur"), 0);
    assert.strictEqual(window.listenerCount("closed"), 0);
  }),
);
