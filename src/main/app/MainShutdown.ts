import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type { MainRuntimeError } from "./MainRuntimeLive";

export const MainShutdownReason = Schema.Union([
  Schema.TaggedStruct("UserQuit", {}),
  Schema.TaggedStruct("Signal", { signal: Schema.String }),
  Schema.TaggedStruct("UpdateInstall", {}),
  Schema.TaggedStruct("AuthorityDriftRelaunch", {}),
  Schema.TaggedStruct("StartupFailure", {}),
  Schema.TaggedStruct("RuntimeFatal", {}),
]);

export type MainShutdownReason = typeof MainShutdownReason.Type;
export type MainRuntimeExit = Exit.Exit<void, MainRuntimeError>;

export class MainShutdown extends Context.Service<
  MainShutdown,
  {
    readonly request: (reason: MainShutdownReason) => Effect.Effect<boolean>;
    readonly awaitRequest: Effect.Effect<MainShutdownReason>;
    readonly markRuntimeClosed: (exit: MainRuntimeExit) => Effect.Effect<boolean>;
    readonly awaitRuntimeClosed: Effect.Effect<MainRuntimeExit>;
  }
>()("nodex/main/app/MainShutdown") {}

export const layer: Layer.Layer<MainShutdown> = Layer.effect(
  MainShutdown,
  Effect.gen(function* () {
    const request = yield* Deferred.make<MainShutdownReason>();
    const runtimeClosed = yield* Deferred.make<MainRuntimeExit>();

    return MainShutdown.of({
      request: Effect.fn("MainShutdown.request")((reason: MainShutdownReason) =>
        Deferred.succeed(request, reason),
      ),
      awaitRequest: Deferred.await(request),
      markRuntimeClosed: Effect.fn("MainShutdown.markRuntimeClosed")((exit: MainRuntimeExit) =>
        Deferred.succeed(runtimeClosed, exit),
      ),
      awaitRuntimeClosed: Deferred.await(runtimeClosed),
    });
  }),
);
