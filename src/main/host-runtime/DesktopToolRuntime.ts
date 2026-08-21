import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type { ThreadStartParams } from "@nodex/codex-app-server-protocol/v2/ThreadStartParams";
import type { BrowserRuntimeBackend } from "../../shared/browser-runtime-metadata";
import type { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import {
  BrowserPluginReconcileError,
  makeBrowserPluginReconciler,
  type BrowserPluginReconciler,
  type BrowserPluginReconcileResult,
} from "../codex/browser-plugin-reconciler";
import type { BrowserRuntimeAvailability } from "../codex/browser-runtime-bundle";
import { BrowserUseThreadConfigBuilder } from "../codex/browser-use-thread-config";
import type { ComputerUseRuntimeResult } from "../codex/computer-use-runtime";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import { ComputerUseRuntime } from "./ComputerUseRuntime";

export class DesktopToolRuntimeError extends Schema.TaggedError<DesktopToolRuntimeError>()(
  "DesktopToolRuntimeError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}

export interface DesktopToolRuntimeSnapshot {
  readonly browserPluginReady: boolean;
  readonly computerUsePluginReady: boolean;
  readonly computerUse: ComputerUseRuntimeResult | null;
  readonly plugins: BrowserPluginReconcileResult | null;
}

export class DesktopToolRuntime extends Context.Service<
  DesktopToolRuntime,
  {
    readonly browserRuntime: BrowserRuntimeAvailability;
    readonly ensureComputerUse: Effect.Effect<ComputerUseRuntimeResult, DesktopToolRuntimeError>;
    readonly ensureReady: Effect.Effect<DesktopToolRuntimeSnapshot, DesktopToolRuntimeError>;
    readonly threadConfig: Effect.Effect<
      NonNullable<ThreadStartParams["config"]> | null,
      DesktopToolRuntimeError
    >;
    readonly setAvailableBackendsResolver: (
      resolver: () => readonly BrowserRuntimeBackend[],
    ) => void;
  }
>()("nodex/main/host-runtime/DesktopToolRuntime") {}

interface DesktopToolRuntimeOptions {
  readonly browserRuntime: BrowserRuntimeAvailability;
  readonly runtimeStateHome: string;
}

interface DesktopToolRuntimeLayerOptions {
  readonly browserRuntime: BrowserRuntimeAvailability;
  readonly computerUse: ComputerUseRuntime["Service"];
  readonly plugins: (
    availableBackends: () => readonly BrowserRuntimeBackend[],
  ) => Effect.Effect<BrowserPluginReconciler>;
  readonly runtimeStateHome: string;
}

const make = (options: DesktopToolRuntimeLayerOptions) =>
  Effect.gen(function* () {
    let availableBackends: () => readonly BrowserRuntimeBackend[] = () => [];
    const plugins = yield* options.plugins(() => availableBackends());
    const snapshot = Effect.gen(function* () {
      const computerUse = options.computerUse.current();
      const pluginResult = yield* plugins.result;
      return {
        browserPluginReady: pluginResult?.status === "ready" && pluginResult.enabled,
        computerUsePluginReady:
          pluginResult?.status === "ready" &&
          pluginResult.computerUse.status === "ready" &&
          computerUse?.status === "available",
        computerUse,
        plugins: pluginResult,
      } satisfies DesktopToolRuntimeSnapshot;
    });
    const ensureComputerUse = options.computerUse.ensureReady.pipe(
      Effect.mapError(
        (cause) => new DesktopToolRuntimeError({ operation: "computer-use-ready", cause }),
      ),
    );
    const ensureReady = ensureComputerUse.pipe(
      Effect.andThen(plugins.ensureInstalled),
      Effect.mapError(
        (cause) => new DesktopToolRuntimeError({ operation: "reconcile-plugins", cause }),
      ),
      Effect.andThen(snapshot),
    );
    return DesktopToolRuntime.of({
      browserRuntime: options.browserRuntime,
      ensureComputerUse,
      ensureReady,
      threadConfig: snapshot.pipe(
        Effect.flatMap((current) =>
          Effect.try({
            try: () => {
              const result = new BrowserUseThreadConfigBuilder({
                availableBackends: () => (current.browserPluginReady ? availableBackends() : []),
                browserRuntime: options.browserRuntime,
                computerUsePluginReady: () => current.computerUsePluginReady,
                computerUseRuntime: () => current.computerUse,
                runtimeStateHome: options.runtimeStateHome,
              }).buildResult();
              return result.status === "available" ? result.config : null;
            },
            catch: (cause) => new DesktopToolRuntimeError({ operation: "thread-config", cause }),
          }),
        ),
      ),
      setAvailableBackendsResolver: (resolver) => {
        availableBackends = resolver;
      },
    });
  });

const fromPorts = (options: DesktopToolRuntimeLayerOptions): Layer.Layer<DesktopToolRuntime> =>
  Layer.effect(DesktopToolRuntime, make(options));

export const live = (
  options: DesktopToolRuntimeOptions,
): Layer.Layer<DesktopToolRuntime, never, CodexGateway | ComputerUseRuntime> =>
  Layer.effect(
    DesktopToolRuntime,
    Effect.gen(function* () {
      const computerUse = yield* ComputerUseRuntime;
      const gateway = yield* CodexGateway;
      return yield* make({
        browserRuntime: options.browserRuntime,
        computerUse,
        plugins: (availableBackends) =>
          makeBrowserPluginReconciler({
            availableBackends,
            browserRuntime: options.browserRuntime,
            client: {
              request: (method, params) =>
                gateway.requestLocal(method, params).pipe(
                  Effect.mapError(
                    (cause) =>
                      new BrowserPluginReconcileError({
                        operation: `request.${method}`,
                        cause,
                      }),
                  ),
                ),
            },
            computerUseAvailable: () => computerUse.current()?.status === "available",
            runtimeStateHome: options.runtimeStateHome,
          }),
        runtimeStateHome: options.runtimeStateHome,
      });
    }),
  );

export interface DesktopToolRuntimePromiseAdapter {
  readonly browserRuntime: BrowserRuntimeAvailability;
  readonly ensureComputerUse: () => Promise<ComputerUseRuntimeResult>;
  readonly ensureReady: () => Promise<DesktopToolRuntimeSnapshot>;
  readonly threadConfig: () => Promise<NonNullable<ThreadStartParams["config"]> | null>;
  readonly setAvailableBackendsResolver: (resolver: () => readonly BrowserRuntimeBackend[]) => void;
}

export const makeDesktopToolRuntimePromiseAdapter = (
  runtime: DesktopToolRuntime["Service"],
  callbacks: ScopedCallbackRuntime["Service"],
): DesktopToolRuntimePromiseAdapter => ({
  browserRuntime: runtime.browserRuntime,
  ensureComputerUse: () => callbacks.runPromise(runtime.ensureComputerUse),
  ensureReady: () => callbacks.runPromise(runtime.ensureReady),
  threadConfig: () => callbacks.runPromise(runtime.threadConfig),
  setAvailableBackendsResolver: runtime.setAvailableBackendsResolver,
});

export const testLayer = fromPorts;
