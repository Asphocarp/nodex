import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { protocol, session, type Session } from "electron";

export class ElectronSessionHost extends Context.Service<
  ElectronSessionHost,
  {
    readonly defaultSession: Effect.Effect<Session>;
    readonly fromPartition: (partition: string) => Effect.Effect<Session>;
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
    scopedRegistration: (acquire, release) =>
      Effect.acquireRelease(Effect.sync(acquire), () => Effect.sync(release)),
    protocol,
  }),
);
