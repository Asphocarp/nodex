import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import type { ThreadStartParams } from "@nodex/codex-app-server-protocol/v2/ThreadStartParams";
import type { ConfigRequirementsReadResponse } from "@nodex/codex-app-server-protocol/v2/ConfigRequirementsReadResponse";
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

export interface BrowserUseTurnLifecyclePort {
  readonly releaseSession?: (sessionId: string) => Effect.Effect<void, Error>;
  readonly turnEnded: (input: { sessionId: string; turnId: string }) => Effect.Effect<void, Error>;
  readonly turnStarted: (input: {
    sessionId: string;
    turnId: string;
  }) => Effect.Effect<void, Error>;
}

export interface BrowserUseRoutePromoterPort {
  readonly promote: (input: {
    browserConversationId: string;
    browserViewScopeId: string;
    codexSessionId: string;
    projectId: string | null;
  }) => Effect.Effect<void, Error>;
}

export interface BrowserUseRuntimeBindings {
  readonly lifecycle: BrowserUseTurnLifecyclePort;
  readonly routePromoter: BrowserUseRoutePromoterPort;
}

export class DesktopToolRuntime extends Context.Service<
  DesktopToolRuntime,
  {
    readonly browserRuntime: BrowserRuntimeAvailability;
    readonly clearBrowserUseBindings: Effect.Effect<void>;
    readonly ensureComputerUse: Effect.Effect<ComputerUseRuntimeResult, DesktopToolRuntimeError>;
    readonly ensureReady: Effect.Effect<DesktopToolRuntimeSnapshot, DesktopToolRuntimeError>;
    readonly installBrowserUseBindings: (
      bindings: BrowserUseRuntimeBindings,
    ) => Effect.Effect<void>;
    readonly promoteBrowserUseRoute: (
      input: Parameters<BrowserUseRoutePromoterPort["promote"]>[0],
    ) => Effect.Effect<void, DesktopToolRuntimeError>;
    readonly readConfigRequirements: Effect.Effect<
      ConfigRequirementsReadResponse,
      DesktopToolRuntimeError
    >;
    readonly releaseBrowserUseSession: (
      sessionId: string,
    ) => Effect.Effect<void, DesktopToolRuntimeError>;
    readonly threadConfig: Effect.Effect<
      NonNullable<ThreadStartParams["config"]> | null,
      DesktopToolRuntimeError
    >;
    readonly setAvailableBackendsResolver: (
      resolver: () => readonly BrowserRuntimeBackend[],
    ) => void;
    readonly turnEnded: (
      input: Parameters<BrowserUseTurnLifecyclePort["turnEnded"]>[0],
    ) => Effect.Effect<void, DesktopToolRuntimeError>;
    readonly turnStarted: (
      input: Parameters<BrowserUseTurnLifecyclePort["turnStarted"]>[0],
    ) => Effect.Effect<void, DesktopToolRuntimeError>;
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
  readonly readConfigRequirements: Effect.Effect<
    ConfigRequirementsReadResponse,
    DesktopToolRuntimeError
  >;
  readonly runtimeStateHome: string;
}

const make = (options: DesktopToolRuntimeLayerOptions) =>
  Effect.gen(function* () {
    let availableBackends: () => readonly BrowserRuntimeBackend[] = () => [];
    const plugins = yield* options.plugins(() => availableBackends());
    const browserUseBindings = yield* Ref.make<BrowserUseRuntimeBindings | null>(null);
    const runBrowserUse = (
      operation: string,
      callback: (bindings: BrowserUseRuntimeBindings) => Effect.Effect<void, Error> | undefined,
    ): Effect.Effect<void, DesktopToolRuntimeError> =>
      Ref.get(browserUseBindings).pipe(
        Effect.flatMap((bindings) => {
          if (!bindings) return Effect.void;
          return (callback(bindings) ?? Effect.void).pipe(
            Effect.mapError((cause) => new DesktopToolRuntimeError({ operation, cause })),
          );
        }),
      );
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
      clearBrowserUseBindings: Ref.set(browserUseBindings, null),
      ensureComputerUse,
      ensureReady,
      installBrowserUseBindings: (bindings) => Ref.set(browserUseBindings, bindings),
      promoteBrowserUseRoute: (input) =>
        runBrowserUse("browser-use-promote-route", (bindings) =>
          bindings.routePromoter.promote(input),
        ),
      readConfigRequirements: ensureReady.pipe(
        Effect.andThen(options.readConfigRequirements),
        Effect.mapError(
          (cause) => new DesktopToolRuntimeError({ operation: "config-requirements", cause }),
        ),
      ),
      releaseBrowserUseSession: (sessionId) =>
        runBrowserUse("browser-use-release-session", (bindings) =>
          bindings.lifecycle.releaseSession?.(sessionId),
        ),
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
      turnEnded: (input) =>
        runBrowserUse("browser-use-turn-ended", (bindings) => bindings.lifecycle.turnEnded(input)),
      turnStarted: (input) =>
        runBrowserUse("browser-use-turn-started", (bindings) =>
          bindings.lifecycle.turnStarted(input),
        ),
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
        readConfigRequirements: gateway.requestLocal("configRequirements/read", undefined).pipe(
          Effect.map((response) => response as unknown as ConfigRequirementsReadResponse),
          Effect.mapError(
            (cause) =>
              new DesktopToolRuntimeError({ operation: "config-requirements.request", cause }),
          ),
        ),
        runtimeStateHome: options.runtimeStateHome,
      });
    }),
  );

export interface DesktopToolRuntimePromiseAdapter {
  readonly ensureReady: () => Promise<DesktopToolRuntimeSnapshot>;
  readonly promoteBrowserUseRoute: (
    input: Parameters<BrowserUseRoutePromoterPort["promote"]>[0],
  ) => Promise<void>;
  readonly releaseBrowserUseSession: (sessionId: string) => Promise<void>;
  readonly threadConfig: () => Promise<NonNullable<ThreadStartParams["config"]> | null>;
  readonly turnEnded: (
    input: Parameters<BrowserUseTurnLifecyclePort["turnEnded"]>[0],
  ) => Promise<void>;
  readonly turnStarted: (
    input: Parameters<BrowserUseTurnLifecyclePort["turnStarted"]>[0],
  ) => Promise<void>;
}

export const makeDesktopToolRuntimePromiseAdapter = (
  runtime: DesktopToolRuntime["Service"],
  callbacks: ScopedCallbackRuntime["Service"],
): DesktopToolRuntimePromiseAdapter => ({
  ensureReady: () => callbacks.runPromise(runtime.ensureReady),
  promoteBrowserUseRoute: (input) => callbacks.runPromise(runtime.promoteBrowserUseRoute(input)),
  releaseBrowserUseSession: (sessionId) =>
    callbacks.runPromise(runtime.releaseBrowserUseSession(sessionId)),
  threadConfig: () => callbacks.runPromise(runtime.threadConfig),
  turnEnded: (input) => callbacks.runPromise(runtime.turnEnded(input)),
  turnStarted: (input) => callbacks.runPromise(runtime.turnStarted(input)),
});

export const testLayer = fromPorts;
