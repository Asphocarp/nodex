import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SubscriptionRef from "effect/SubscriptionRef";
import type { RustDataAuthorityRuntime } from "../../../src/main/core-client";
import {
  CoreAuthority,
  CoreSessionAccess,
  type CoreAuthorityState,
} from "../../../src/main/core-runtime/CoreAuthority";
import {
  DatabaseModule,
  live as databaseModuleLive,
} from "../../../src/main/database-application/DatabaseModule";

/** One-shot Effect root for scenario tooling that runs outside Electron Main. */
export const runScenarioDatabase = <A, E>(
  runtime: RustDataAuthorityRuntime,
  use: (database: DatabaseModule["Service"]) => Effect.Effect<A, E>,
): Promise<A> =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const state = yield* SubscriptionRef.make<CoreAuthorityState>({
          kind: "ready",
          generation: runtime.rootClient.handshake.generation.start_nonce,
        });
        const authority = CoreAuthority.of({
          identity: runtime.identity,
          initialLaunch: {
            executablePath: runtime.launch.executablePath,
            startedProcessId: runtime.launch.startedProcessId,
            timings: runtime.launch.timings,
          },
          state,
          retry: Effect.void,
          requestRelaunch: Effect.void,
        });
        const sessions = CoreSessionAccess.of({
          handshake: Effect.succeed(runtime.rootClient.handshake),
          use: (_operation, operation, options) =>
            Effect.promise((signal) =>
              operation(
                options?.projectId
                  ? runtime.clientForProject(options.projectId)
                  : runtime.rootClient,
                signal,
              ),
            ),
        });
        const context = yield* Layer.build(
          databaseModuleLive.pipe(
            Layer.provide(
              Layer.merge(
                Layer.succeed(CoreAuthority, authority),
                Layer.succeed(CoreSessionAccess, sessions),
              ),
            ),
          ),
        );
        return yield* use(Context.get(context, DatabaseModule));
      }),
    ),
  );
