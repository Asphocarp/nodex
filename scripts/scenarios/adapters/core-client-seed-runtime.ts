import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
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
import {
  LibraryModule,
  live as libraryModuleLive,
} from "../../../src/main/library-application/LibraryModule";

const runWithScenarioCore = <A, E>(
  runtime: RustDataAuthorityRuntime,
  operation: Effect.Effect<A, E, CoreAuthority | CoreSessionAccess | Scope.Scope>,
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
        return yield* operation.pipe(
          Effect.provideService(CoreAuthority, authority),
          Effect.provideService(CoreSessionAccess, sessions),
        );
      }),
    ),
  );

/** One-shot Effect root for scenario tooling that runs outside Electron Main. */
export const runScenarioDatabase = <A, E>(
  runtime: RustDataAuthorityRuntime,
  use: (database: DatabaseModule["Service"]) => Effect.Effect<A, E>,
): Promise<A> =>
  runWithScenarioCore(
    runtime,
    Effect.gen(function* () {
      const context = yield* Layer.build(databaseModuleLive);
      return yield* use(Context.get(context, DatabaseModule));
    }),
  );

/** Uses the same final minimum-commit capability as production Library reads. */
export const runScenarioLibrary = <A, E>(
  runtime: RustDataAuthorityRuntime,
  use: (library: LibraryModule["Service"]) => Effect.Effect<A, E>,
): Promise<A> =>
  runWithScenarioCore(
    runtime,
    Effect.gen(function* () {
      const context = yield* Layer.build(libraryModuleLive);
      return yield* use(Context.get(context, LibraryModule));
    }),
  );
