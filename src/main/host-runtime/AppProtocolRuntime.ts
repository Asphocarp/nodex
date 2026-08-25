import { join } from "node:path";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { registerAppProtocol } from "../app-protocol";
import { MainConfig } from "../app/MainConfig";
import { ElectronSessionHost } from "../platform/electron/ElectronSessionHost";

export class AppProtocolRuntime extends Context.Service<
  AppProtocolRuntime,
  { readonly installed: true }
>()("nodex/main/host-runtime/AppProtocolRuntime") {}

/** Installs Profile-local protocols before the first renderer is created. */
export const live: Layer.Layer<AppProtocolRuntime, never, ElectronSessionHost | MainConfig> =
  Layer.effect(
    AppProtocolRuntime,
    Effect.gen(function* () {
      const config = yield* MainConfig;
      const sessions = yield* ElectronSessionHost;
      const defaultSession = yield* sessions.defaultSession;
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          const release = registerAppProtocol(defaultSession, {
            rendererRoot: join(__dirname, "../renderer"),
            getDevelopmentRendererUrl: () => (config.isPackaged ? null : config.rendererUrl),
            protocol: sessions.protocol,
          });
          return release;
        }),
        (release) => Effect.sync(release),
      ).pipe(Effect.asVoid);
      return AppProtocolRuntime.of({ installed: true });
    }),
  );
