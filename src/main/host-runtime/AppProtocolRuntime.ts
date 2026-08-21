import { join } from "node:path";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { registerAppRendererProtocol } from "../app-renderer-protocol";
import { MainConfig } from "../app/MainConfig";
import { registerManagedAssetProtocol } from "../managed-asset-protocol";
import { getLogger } from "../logging/logger";
import { ElectronSessionHost } from "../platform/electron/ElectronSessionHost";

export const live: Layer.Layer<never, never, ElectronSessionHost | MainConfig> =
  Layer.effectDiscard(
    Effect.gen(function* () {
      const config = yield* MainConfig;
      const sessions = yield* ElectronSessionHost;
      const defaultSession = yield* sessions.defaultSession;
      const logger = getLogger({ component: "app-protocol-runtime" });
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          const releaseManagedAssets = registerManagedAssetProtocol(defaultSession, {
            logError: (message, error) => logger.warn(message, { error }),
          });
          const releaseRenderer = config.rendererUrl
            ? null
            : registerAppRendererProtocol(
                defaultSession,
                join(__dirname, "../renderer"),
                (message, error) => logger.warn(message, { error }),
              );
          return () => {
            releaseRenderer?.();
            releaseManagedAssets();
          };
        }),
        (release) => Effect.sync(release),
      ).pipe(Effect.asVoid);
    }),
  );
