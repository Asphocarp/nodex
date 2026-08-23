import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { BrowserWindow, protocol, session, type Session, type WebContents } from "electron";

export class ElectronSessionHost extends Context.Service<
  ElectronSessionHost,
  {
    readonly defaultSession: Effect.Effect<Session>;
    readonly fromPartition: (partition: string) => Effect.Effect<Session>;
    readonly hasOwnerWindow: (webContents: WebContents | null) => boolean;
    readonly scopedRegistration: (
      acquire: () => void,
      release: () => void,
    ) => Effect.Effect<void, never, Scope.Scope>;
    readonly protocol: typeof protocol;
  }
>()("nodex/main/platform/electron/ElectronSessionHost") {}

export const live: Layer.Layer<ElectronSessionHost> = Layer.succeed(
  ElectronSessionHost,
  ElectronSessionHost.of({
    defaultSession: Effect.sync(() => session.defaultSession),
    fromPartition: (partition) => Effect.sync(() => session.fromPartition(partition)),
    hasOwnerWindow: (webContents) =>
      webContents !== null && BrowserWindow.fromWebContents(webContents) !== null,
    scopedRegistration: (acquire, release) =>
      Effect.acquireRelease(Effect.sync(acquire), () => Effect.sync(release)),
    protocol,
  }),
);
