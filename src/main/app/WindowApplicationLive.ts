import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  ApplicationInitializationRuntime,
  live as applicationInitializationRuntimeLive,
} from "../host-runtime/ApplicationInitializationRuntime";
import { ElectronApp } from "../platform/electron/ElectronApp";
import { WindowRuntime, live as windowRuntimeLive } from "../window-runtime/WindowRuntime";
import { MainConfig } from "./MainConfig";

const windowRuntime = Layer.unwrap(
  Effect.gen(function* () {
    const electron = yield* ElectronApp;
    const config = yield* MainConfig;
    const userDataPath = yield* electron.userDataPath;
    return windowRuntimeLive(userDataPath, config.platform as NodeJS.Platform);
  }),
);

const initialization = Layer.unwrap(
  Effect.gen(function* () {
    const windows = yield* WindowRuntime;
    return applicationInitializationRuntimeLive(windows);
  }),
).pipe(Layer.provideMerge(windowRuntime));

/** Foundation-adjacent Window state required while the rest of the application is acquired. */
export const live: Layer.Layer<
  WindowRuntime | ApplicationInitializationRuntime,
  never,
  ElectronApp | MainConfig
> = initialization;
