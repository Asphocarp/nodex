import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import { EventEmitter } from "node:events";
import type {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  Display,
  WebContents,
} from "electron";
import { it } from "@effect/vitest";
import { describe, expect, test } from "vite-plus/test";
import type { WindowSessionRecord } from "../../shared/window-session";
import { resolveElectronWindowBackdrop } from "../electron-window-backdrop";
import type { WindowRuntimeService } from "./WindowRuntime";
import {
  ApplicationWindowShellRuntime,
  live,
  resolveApplicationWindowShellAppearance,
} from "./ApplicationWindowShellRuntime";

let nextWindowId = 1;

class FakeBrowserWindow extends EventEmitter {
  readonly id = nextWindowId++;
  private destroyed = false;
  readonly webContents = Object.assign(new EventEmitter(), {
    id: this.id + 100,
    setWindowOpenHandler: () => undefined,
  }) as unknown as WebContents;

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit("closed");
  }

  focus(): void {}
  isDestroyed(): boolean {
    return this.destroyed;
  }
  loadURL(): Promise<void> {
    return Promise.resolve();
  }
  maximize(): void {}
  setFullScreen(): void {}
  show(): void {}
  showInactive(): void {}
}

const session = (id: string, lastFocusedAt: number): WindowSessionRecord =>
  ({
    bounds: { height: 800, mode: "normal", width: 1_200, x: 40, y: 40 },
    id,
    lastFocusedAt,
  }) as unknown as WindowSessionRecord;

describe("ApplicationWindowShellRuntime", () => {
  test("constructs focused macOS shells as transparent native material windows", () => {
    const backdrop = resolveElectronWindowBackdrop({
      bounds: { width: 1_400, height: 900 },
      isFocused: true,
      platform: "darwin",
      prefersDarkColors: false,
      prefersReducedTransparency: false,
      scaleFactor: 2,
    });

    expect(resolveApplicationWindowShellAppearance("darwin", backdrop)).toMatchObject({
      backgroundColor: "#00000000",
      transparent: true,
      vibrancy: "menu",
      visualEffectState: "followWindow",
    });
  });

  test("keeps Reduce transparency opaque without changing window identity", () => {
    const backdrop = resolveElectronWindowBackdrop({
      bounds: { width: 1_400, height: 900 },
      isFocused: true,
      platform: "darwin",
      prefersDarkColors: true,
      prefersReducedTransparency: true,
      scaleFactor: 2,
    });

    expect(resolveApplicationWindowShellAppearance("darwin", backdrop)).toMatchObject({
      backgroundColor: "#000000",
      transparent: true,
      vibrancy: undefined,
    });
  });

  it.effect("opens restored renderer gates primary-first with concurrency one", () => {
    const sessions = [session("primary", 3), session("secondary", 2), session("tertiary", 1)];
    const windows = {
      attach: (_window: BrowserWindow, sessionId: string) =>
        sessions.find((candidate) => candidate.id === sessionId)!,
      markFocused: () => undefined,
      selectStartupSessions: () => sessions,
    } as unknown as WindowRuntimeService;

    return Effect.scoped(
      Effect.gen(function* () {
        const context = yield* Layer.build(
          live({
            createWindow: (_options: BrowserWindowConstructorOptions) =>
              new FakeBrowserWindow() as unknown as BrowserWindow,
            displays: {
              getAllDisplays: () => [
                {
                  bounds: { height: 1_080, width: 1_920, x: 0, y: 0 },
                  scaleFactor: 2,
                } as Display,
              ],
              getDisplayMatching: () => ({ scaleFactor: 2 }) as Display,
              getPrimaryDisplay: () => ({ scaleFactor: 2 }) as Display,
            },
            iconPath: "",
            platform: "darwin",
            preloadPath: "/tmp/nodex-preload.js",
            rendererUrl: "app://-/index.html",
            theme: { prefersReducedTransparency: false, shouldUseDarkColors: false },
            windows,
          }),
        );
        const shell = Context.get(context, ApplicationWindowShellRuntime);
        const opened = shell.openInitial("all");
        expect(opened).toHaveLength(3);

        for (const lease of shell.claimPendingActivation()) {
          shell.completeActivation(lease.window.webContents.id);
        }
        yield* shell.awaitActivation(opened[0]!.webContents.id);

        const secondary = yield* shell
          .awaitActivation(opened[1]!.webContents.id)
          .pipe(Effect.forkScoped);
        expect(secondary.pollUnsafe()).toBeUndefined();

        shell.reportRenderer(opened[0]!.webContents.id);
        yield* Fiber.join(secondary);
        const tertiary = yield* shell
          .awaitActivation(opened[2]!.webContents.id)
          .pipe(Effect.forkScoped);
        expect(tertiary.pollUnsafe()).toBeUndefined();

        shell.reportRenderer(opened[1]!.webContents.id);
        yield* Fiber.join(tertiary);
      }),
    );
  });
});
