import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import {
  Menu,
  dialog,
  nativeTheme,
  powerMonitor,
  shell,
  type MessageBoxOptions,
  type MessageBoxReturnValue,
} from "electron";
import { ScopedCallbackRuntime } from "../../app/ScopedCallbackRuntime";

export class ElectronDesktop extends Context.Service<
  ElectronDesktop,
  {
    readonly dialog: typeof dialog;
    readonly menu: typeof Menu;
    readonly nativeTheme: typeof nativeTheme;
    readonly shell: typeof shell;
    readonly showMessage: (options: MessageBoxOptions) => Effect.Effect<MessageBoxReturnValue>;
    readonly onPowerEvent: (
      event: "lock-screen" | "resume" | "suspend" | "unlock-screen",
      handler: Effect.Effect<void>,
    ) => Effect.Effect<void, never, Scope.Scope>;
  }
>()("nodex/main/platform/electron/ElectronDesktop") {}

export const live: Layer.Layer<ElectronDesktop, never, ScopedCallbackRuntime> = Layer.effect(
  ElectronDesktop,
  Effect.gen(function* () {
    const callbacks = yield* ScopedCallbackRuntime;
    return ElectronDesktop.of({
      dialog,
      menu: Menu,
      nativeTheme,
      shell,
      showMessage: (options) => Effect.promise(() => dialog.showMessageBox(options)),
      onPowerEvent: (event, handler) => {
        const listener = () => {
          callbacks.fork(handler);
        };
        const register = () => {
          if (event === "lock-screen") return powerMonitor.on("lock-screen", listener);
          if (event === "unlock-screen") return powerMonitor.on("unlock-screen", listener);
          if (event === "resume") return powerMonitor.on("resume", listener);
          return powerMonitor.on("suspend", listener);
        };
        const unregister = () => {
          if (event === "lock-screen") return powerMonitor.removeListener("lock-screen", listener);
          if (event === "unlock-screen")
            return powerMonitor.removeListener("unlock-screen", listener);
          if (event === "resume") return powerMonitor.removeListener("resume", listener);
          return powerMonitor.removeListener("suspend", listener);
        };
        return Effect.acquireRelease(Effect.sync(register), () => Effect.sync(unregister));
      },
    });
  }),
);
