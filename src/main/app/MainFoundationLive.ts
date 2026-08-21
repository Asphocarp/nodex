import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Layer from "effect/Layer";
import * as ElectronApp from "../platform/electron/ElectronApp";
import * as ElectronDesktop from "../platform/electron/ElectronDesktop";
import * as ElectronIpc from "../platform/electron/ElectronIpc";
import * as ElectronSessionHost from "../platform/electron/ElectronSessionHost";
import * as ElectronWindowHost from "../platform/electron/ElectronWindowHost";
import * as MainConfig from "./MainConfig";
import * as MainObservability from "./MainObservability";
import * as MainShutdown from "./MainShutdown";
import * as ScopedCallbackRuntime from "./ScopedCallbackRuntime";

export type MainFoundation =
  | MainConfig.MainConfig
  | MainObservability.MainObservability
  | MainShutdown.MainShutdown
  | ScopedCallbackRuntime.ScopedCallbackRuntime
  | ElectronApp.ElectronApp
  | ElectronDesktop.ElectronDesktop
  | ElectronIpc.ElectronIpc
  | ElectronIpc.ElectronSyncIpc
  | ElectronSessionHost.ElectronSessionHost
  | ElectronWindowHost.ElectronWindowHost
  | NodeServices.NodeServices;

const electronPlatform = Layer.mergeAll(
  ElectronApp.live,
  ElectronDesktop.live,
  ElectronIpc.live,
  ElectronSessionHost.live,
  ElectronWindowHost.live,
);

export const make = (config: unknown): Layer.Layer<MainFoundation, MainConfig.MainConfigError> => {
  const base = Layer.mergeAll(
    MainConfig.layer(config),
    MainObservability.layer,
    MainShutdown.layer,
    ScopedCallbackRuntime.layer,
    NodeServices.layer,
  );
  return electronPlatform.pipe(Layer.provideMerge(base));
};
