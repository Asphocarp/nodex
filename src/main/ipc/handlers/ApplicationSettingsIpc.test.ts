import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { assert, it } from "@effect/vitest";
import type { IpcMainInvokeEvent } from "electron";
import { testLayer as mainConfigLayer } from "../../app/MainConfig";
import { ApplicationMenuRuntime } from "../../host-runtime/ApplicationMenuRuntime";
import { ApplicationSchedulerRuntime } from "../../host-runtime/ApplicationSchedulerRuntime";
import { ElectronIpc } from "../../platform/electron/ElectronIpc";
import { WindowRuntime } from "../../window-runtime/WindowRuntime";
import { ApplicationSettingsIpcError, live } from "./ApplicationSettingsIpc";

type Handler = (
  event: IpcMainInvokeEvent,
  ...args: readonly unknown[]
) => Effect.Effect<unknown, ApplicationSettingsIpcError>;

it.effect("owns the complete application settings ingress with the Main Scope", () =>
  Effect.gen(function* () {
    const handlers = new Map<string, Handler>();
    const ipc = ElectronIpc.of({
      handle: (channel, handler) =>
        Effect.acquireRelease(
          Effect.sync(() => handlers.set(channel, handler as Handler)),
          () => Effect.sync(() => handlers.delete(channel)),
        ).pipe(Effect.asVoid),
      on: () => Effect.void,
    } as ElectronIpc["Service"]);
    const menus = ApplicationMenuRuntime.of({ refresh: () => undefined });
    const schedulers = ApplicationSchedulerRuntime.of({
      configureBackup: () => undefined,
    } as unknown as ApplicationSchedulerRuntime["Service"]);
    const windows = WindowRuntime.of({
      all: () => [],
      has: () => true,
    } as unknown as WindowRuntime["Service"]);
    const scope = yield* Scope.make();
    yield* Layer.buildWithScope(
      live.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(ApplicationMenuRuntime, menus),
            Layer.succeed(ApplicationSchedulerRuntime, schedulers),
            Layer.succeed(ElectronIpc, ipc),
            mainConfigLayer(),
            Layer.succeed(WindowRuntime, windows),
          ),
        ),
      ),
      scope,
    );

    assert.deepEqual([...handlers.keys()].sort(), [
      "codex-command-keymap-state",
      "global-dictation-capture-fn-hotkey",
      "reset-codex-command-keybindings",
      "set-codex-command-keybinding",
      "settings:backup:get",
      "settings:backup:update",
      "settings:codex-developer:get",
      "settings:codex-developer:update",
      "settings:diagnostics:get",
      "settings:diagnostics:update",
      "settings:git:get",
      "settings:git:update",
      "settings:history:get",
      "settings:history:update",
      "settings:telemetry:get",
      "settings:telemetry:update",
      "settings:third-party-notices:get",
      "settings:thread-notifications:get",
      "settings:thread-notifications:update",
      "settings:window-restore:get",
      "settings:window-restore:update",
    ]);
    const frame = { url: "app://-/index.html" };
    const event = {
      sender: { getType: () => "window", id: 7, mainFrame: frame },
      senderFrame: frame,
    } as unknown as IpcMainInvokeEvent;
    const invalid = yield* Effect.result(
      handlers.get("settings:backup:update")!(event, {
        autoEnabled: true,
        intervalHours: 6,
        retentionCount: 28,
        unexpected: true,
      }),
    );
    assert.strictEqual(invalid._tag, "Failure");

    yield* Scope.close(scope, Exit.void);
    assert.strictEqual(handlers.size, 0);
  }),
);
