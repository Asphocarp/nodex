import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type { ThreadStartParams } from "@nodex/codex-app-server-protocol/v2/ThreadStartParams";
import type { BrowserRuntimeBackend } from "../../shared/browser-runtime-metadata";
import type { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";
import {
  BrowserPluginReconciler,
  type BrowserPluginReconcileResult,
} from "../codex/browser-plugin-reconciler";
import type { BrowserRuntimeAvailability } from "../codex/browser-runtime-bundle";
import { BrowserUseThreadConfigBuilder } from "../codex/browser-use-thread-config";
import type { ComputerUseRuntimeResult } from "../codex/computer-use-runtime";
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
    readonly current: () => DesktopToolRuntimeSnapshot;
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

interface PluginReconcilerPort {
  readonly ensureInstalled: () => Promise<BrowserPluginReconcileResult>;
  readonly getResult: () => BrowserPluginReconcileResult | null;
}

interface DesktopToolRuntimeOptions {
  readonly browserRuntime: BrowserRuntimeAvailability;
  readonly client: { readonly request: (method: string, params?: unknown) => Promise<unknown> };
  readonly runtimeStateHome: string;
}

interface DesktopToolRuntimeLayerOptions {
  readonly browserRuntime: BrowserRuntimeAvailability;
  readonly computerUse: ComputerUseRuntime["Service"];
  readonly plugins: (
    availableBackends: () => readonly BrowserRuntimeBackend[],
  ) => PluginReconcilerPort;
  readonly runtimeStateHome: string;
}

const make = (options: DesktopToolRuntimeLayerOptions) =>
  Effect.sync(() => {
    let availableBackends: () => readonly BrowserRuntimeBackend[] = () => [];
    const plugins = options.plugins(() => availableBackends());
    let lastPluginResult = plugins.getResult();
    const snapshot = (): DesktopToolRuntimeSnapshot => {
      const computerUse = options.computerUse.current();
      const pluginResult = lastPluginResult ?? plugins.getResult();
      return {
        browserPluginReady: pluginResult?.status === "ready" && pluginResult.enabled,
        computerUsePluginReady:
          pluginResult?.status === "ready" &&
          pluginResult.computerUse.status === "ready" &&
          computerUse?.status === "available",
        computerUse,
        plugins: pluginResult,
      };
    };
    const ensureComputerUse = options.computerUse.ensureReady.pipe(
      Effect.mapError(
        (cause) => new DesktopToolRuntimeError({ operation: "computer-use-ready", cause }),
      ),
    );
    const ensureReady = ensureComputerUse.pipe(
      Effect.flatMap(() =>
        Effect.tryPromise({
          try: () => plugins.ensureInstalled(),
          catch: (cause) => new DesktopToolRuntimeError({ operation: "reconcile-plugins", cause }),
        }),
      ),
      Effect.tap((result) =>
        Effect.sync(() => {
          lastPluginResult = result;
        }),
      ),
      Effect.map(snapshot),
    );
    const builder = new BrowserUseThreadConfigBuilder({
      availableBackends: () => (snapshot().browserPluginReady ? availableBackends() : []),
      browserRuntime: options.browserRuntime,
      computerUsePluginReady: () => snapshot().computerUsePluginReady,
      computerUseRuntime: () => options.computerUse.current(),
      runtimeStateHome: options.runtimeStateHome,
    });
    return DesktopToolRuntime.of({
      browserRuntime: options.browserRuntime,
      current: snapshot,
      ensureComputerUse,
      ensureReady,
      threadConfig: Effect.try({
        try: () => {
          const result = builder.buildResult();
          return result.status === "available" ? result.config : null;
        },
        catch: (cause) => new DesktopToolRuntimeError({ operation: "thread-config", cause }),
      }),
      setAvailableBackendsResolver: (resolver) => {
        availableBackends = resolver;
      },
    });
  });

const fromPorts = (options: DesktopToolRuntimeLayerOptions): Layer.Layer<DesktopToolRuntime> =>
  Layer.effect(DesktopToolRuntime, make(options));

export const live = (
  options: DesktopToolRuntimeOptions,
): Layer.Layer<DesktopToolRuntime, never, ComputerUseRuntime> =>
  Layer.effect(
    DesktopToolRuntime,
    Effect.gen(function* () {
      const computerUse = yield* ComputerUseRuntime;
      return yield* make({
        browserRuntime: options.browserRuntime,
        computerUse,
        plugins: (availableBackends) =>
          new BrowserPluginReconciler({
            availableBackends,
            browserRuntime: options.browserRuntime,
            client: options.client,
            computerUseAvailable: () => computerUse.current()?.status === "available",
            runtimeStateHome: options.runtimeStateHome,
          }),
        runtimeStateHome: options.runtimeStateHome,
      });
    }),
  );

export interface DesktopToolRuntimePromiseAdapter {
  readonly browserRuntime: BrowserRuntimeAvailability;
  readonly current: () => DesktopToolRuntimeSnapshot;
  readonly ensureComputerUse: () => Promise<ComputerUseRuntimeResult>;
  readonly ensureReady: () => Promise<DesktopToolRuntimeSnapshot>;
  readonly threadConfig: () => Promise<NonNullable<ThreadStartParams["config"]> | null>;
  readonly setAvailableBackendsResolver: (
    resolver: () => readonly BrowserRuntimeBackend[],
  ) => void;
}

export const makeDesktopToolRuntimePromiseAdapter = (
  runtime: DesktopToolRuntime["Service"],
  callbacks: ScopedCallbackRuntime["Service"],
): DesktopToolRuntimePromiseAdapter => ({
  browserRuntime: runtime.browserRuntime,
  current: runtime.current,
  ensureComputerUse: () => callbacks.runPromise(runtime.ensureComputerUse),
  ensureReady: () => callbacks.runPromise(runtime.ensureReady),
  threadConfig: () => callbacks.runPromise(runtime.threadConfig),
  setAvailableBackendsResolver: runtime.setAvailableBackendsResolver,
});

export const testLayer = fromPorts;
