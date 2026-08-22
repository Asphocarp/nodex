import { randomUUID } from "node:crypto";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FiberSet from "effect/FiberSet";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import type { BrowserRuntimeBackend } from "../../shared/browser-runtime-metadata";
import type { BrowserSidebarTabIdentity } from "../../shared/browser-sidebar";
import { resolveBrowserUseHostCapability } from "../../shared/browser-use-host-capability";
import type { BrowserSidebarService } from "../browser-sidebar-service";
import type {
  BrowserSidebarEvent,
  BrowserSidebarEventHubService,
} from "../browser/BrowserSidebarEventHub";
import { BrowserUseIabApi } from "../browser-use/browser-use-iab-api";
import { BrowserUseNativePipeServer } from "../browser-use/browser-use-native-pipe-server";
import { createBrowserUsePeerAuthorizer } from "../browser-use/browser-use-peer-authorizer";
import type { BrowserUsePolicyReader } from "../browser-use/browser-use-policy-store";
import {
  makeBrowserUseSessionRuntime,
  type BrowserUseCursorArrivalInput,
  type BrowserUseRouteCapture,
  type BrowserUseSessionRuntime,
} from "../browser-use/browser-use-session-runtime";
import type { BrowserRuntimeAvailability } from "../codex/browser-runtime-bundle";
import { getLogger } from "../logging/logger";
import { DesktopToolRuntime } from "./DesktopToolRuntime";

export class BrowserUseRuntimeError extends Schema.TaggedError<BrowserUseRuntimeError>()(
  "BrowserUseRuntimeError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}

export interface BrowserUseRuntimeInstallInput {
  readonly grantDownload: (
    identity: BrowserSidebarTabIdentity,
    sourceUrl: string,
    ttlMs?: number,
  ) => void;
  readonly policyStore: BrowserUsePolicyReader;
  readonly releaseCredentialOwner: (ownerWebContentsId: number) => Effect.Effect<void>;
}

export class BrowserUseRuntime extends Context.Service<
  BrowserUseRuntime,
  {
    readonly install: (
      input: BrowserUseRuntimeInstallInput,
    ) => Effect.Effect<void, BrowserUseRuntimeError>;
  }
>()("nodex/main/host-runtime/BrowserUseRuntime") {}

type BrowserSidebarPort = Pick<
  BrowserSidebarService,
  "promoteBrowserUseRoute" | "setBrowserUseRouteCaptureHandler"
>;

interface BrowserUseRegistryPort {
  readonly availableBackends: () => readonly BrowserRuntimeBackend[];
  readonly captureRoute: (
    input: BrowserUseRouteCapture,
  ) => Effect.Effect<unknown, BrowserUseRuntimeError>;
  readonly notifyCursorArrived: (
    input: BrowserUseCursorArrivalInput,
  ) => Effect.Effect<void, BrowserUseRuntimeError>;
  readonly releaseOwner: (
    ownerWebContentsId: number,
  ) => Effect.Effect<void, BrowserUseRuntimeError>;
  readonly releaseSession: (sessionId: string) => Effect.Effect<void, BrowserUseRuntimeError>;
  readonly turnEnded: (input: {
    sessionId: string;
    turnId: string;
  }) => Effect.Effect<void, BrowserUseRuntimeError>;
  readonly turnStarted: (input: {
    sessionId: string;
    turnId: string;
  }) => Effect.Effect<void, BrowserUseRuntimeError>;
}

type DesktopToolPort = Pick<
  DesktopToolRuntime["Service"],
  "clearBrowserUseBindings" | "installBrowserUseBindings" | "setAvailableBackendsResolver"
>;

export interface BrowserUseRuntimePorts {
  readonly browserEvents: Stream.Stream<BrowserSidebarEvent>;
  readonly browserSidebar: BrowserSidebarPort;
  readonly desktopTools: DesktopToolPort;
  readonly makeRegistry: (
    input: BrowserUseRuntimeInstallInput,
  ) => Effect.Effect<BrowserUseRegistryPort, BrowserUseRuntimeError, Scope.Scope>;
}

const adaptSessionRuntime = (runtime: BrowserUseSessionRuntime): BrowserUseRegistryPort => {
  const adapt = <A>(effect: Effect.Effect<A, { readonly operation: string }>) =>
    effect.pipe(
      Effect.mapError((cause) => new BrowserUseRuntimeError({ operation: cause.operation, cause })),
    );
  return {
    availableBackends: runtime.availableBackends,
    captureRoute: (input) => adapt(runtime.captureRoute(input)),
    notifyCursorArrived: (input) => adapt(runtime.notifyCursorArrived(input)),
    releaseOwner: (ownerWebContentsId) => adapt(runtime.releaseOwner(ownerWebContentsId)),
    releaseSession: (sessionId) => adapt(runtime.releaseSession(sessionId)),
    turnEnded: (input) => adapt(runtime.turnEnded(input)),
    turnStarted: (input) => adapt(runtime.turnStarted(input)),
  };
};

const logFailure = (operation: string, cause: unknown): Effect.Effect<void> =>
  Effect.logWarning("Browser Use runtime operation failed").pipe(
    Effect.annotateLogs({ operation, error: String(cause) }),
  );

const make = (
  ports: BrowserUseRuntimePorts,
): Effect.Effect<BrowserUseRuntime["Service"], never, Scope.Scope> =>
  Effect.gen(function* () {
    const installation = yield* Ref.make<Scope.Closeable | null>(null);
    const lock = yield* Semaphore.make(1);
    yield* Effect.addFinalizer(() =>
      Ref.get(installation).pipe(
        Effect.flatMap((scope) => (scope === null ? Effect.void : Scope.close(scope, Exit.void))),
      ),
    );

    const install = (input: BrowserUseRuntimeInstallInput) =>
      lock.withPermits(1)(
        Effect.gen(function* () {
          if ((yield* Ref.get(installation)) !== null) {
            return yield* new BrowserUseRuntimeError({
              operation: "install",
              cause: new Error("Browser Use runtime is already installed"),
            });
          }
          const childScope = yield* Scope.make();
          const result = yield* Effect.exit(
            Effect.gen(function* () {
              const registry = yield* ports
                .makeRegistry(input)
                .pipe(Effect.provideService(Scope.Scope, childScope));

              ports.desktopTools.setAvailableBackendsResolver(() => registry.availableBackends());
              yield* Scope.addFinalizer(
                childScope,
                Effect.sync(() => ports.desktopTools.setAvailableBackendsResolver(() => [])),
              );
              yield* ports.desktopTools.installBrowserUseBindings({
                lifecycle: registry,
                routePromoter: {
                  promote: (route) =>
                    Effect.tryPromise({
                      try: () => ports.browserSidebar.promoteBrowserUseRoute(route),
                      catch: (cause) =>
                        new BrowserUseRuntimeError({ operation: "promote-route", cause }),
                    }),
                },
              });
              yield* Scope.addFinalizer(childScope, ports.desktopTools.clearBrowserUseBindings);

              const runPromise = yield* FiberSet.makeRuntimePromise<
                never,
                unknown,
                BrowserUseRuntimeError
              >().pipe(Effect.provideService(Scope.Scope, childScope));
              ports.browserSidebar.setBrowserUseRouteCaptureHandler((route) =>
                registry.availableBackends().length === 0
                  ? Promise.resolve()
                  : runPromise(registry.captureRoute(route).pipe(Effect.asVoid)),
              );
              yield* Scope.addFinalizer(
                childScope,
                Effect.sync(() => ports.browserSidebar.setBrowserUseRouteCaptureHandler(null)),
              );

              yield* ports.browserEvents.pipe(
                Stream.runForEach((event) => {
                  if (event.kind === "browserUseOwnerReleased") {
                    return input.releaseCredentialOwner(event.value.ownerWebContentsId).pipe(
                      Effect.andThen(registry.releaseOwner(event.value.ownerWebContentsId)),
                      Effect.catch((error) => logFailure(error.operation, error.cause)),
                    );
                  }
                  if (
                    event.kind !== "browserUseCursorArrived" ||
                    event.value.ownerWebContentsId === null
                  ) {
                    return Effect.void;
                  }
                  return registry
                    .notifyCursorArrived({
                      ...event.value,
                      ownerWebContentsId: event.value.ownerWebContentsId,
                    })
                    .pipe(Effect.catch((error) => logFailure(error.operation, error.cause)));
                }),
                Effect.forkIn(childScope, { startImmediately: true }),
              );
            }),
          );
          if (Exit.isFailure(result)) {
            yield* Scope.close(childScope, Exit.void);
            return yield* Effect.failCause(result.cause);
          }
          yield* Ref.set(installation, childScope);
        }),
      );

    return BrowserUseRuntime.of({ install });
  });

export interface BrowserUseRuntimeOptions {
  readonly appVersion: string;
  readonly browserRuntime: BrowserRuntimeAvailability;
  readonly browserEvents: BrowserSidebarEventHubService;
  readonly browserSidebar: BrowserSidebarService;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly isPackaged: boolean;
  readonly platform: NodeJS.Platform;
}

export const live = (
  options: BrowserUseRuntimeOptions,
): Layer.Layer<BrowserUseRuntime, never, DesktopToolRuntime> =>
  Layer.effect(
    BrowserUseRuntime,
    Effect.gen(function* () {
      const desktopTools = yield* DesktopToolRuntime;
      const capability = resolveBrowserUseHostCapability({
        browserRuntimeStatus: options.browserRuntime.status,
        environment: options.environment,
        isPackaged: options.isPackaged,
        platform: options.platform,
      });
      const logger = getLogger({ component: "browser-use-runtime" });
      logger.info("Browser Use host capability resolved", {
        availableBackends: capability.availableBackends,
        peerVerificationMode: capability.peerAuthorizationMode,
        reason: capability.status === "unavailable" ? capability.reason : null,
        runtimeStatus: options.browserRuntime.status,
        status: capability.status,
      });
      const socketPeerAuthorizer = createBrowserUsePeerAuthorizer({
        addonPath:
          capability.status === "available" && options.browserRuntime.status === "available"
            ? options.browserRuntime.bundle.paths.peerAuthorization
            : null,
        mode: capability.peerAuthorizationMode,
        platform: options.platform,
      });
      return yield* make({
        browserEvents: options.browserEvents.events,
        browserSidebar: options.browserSidebar,
        desktopTools,
        makeRegistry: (input) => {
          const appSessionId = randomUUID();
          const runtime = makeBrowserUseSessionRuntime(capability.status === "available", {
            createApi: (route, asyncRuntime) =>
              new BrowserUseIabApi({
                appSessionId,
                appVersion: options.appVersion,
                asyncRuntime,
                browserService: options.browserSidebar,
                subscribeWebviewAttached: (listener) =>
                  options.browserEvents.subscribeWebviewAttached(listener),
                buildFlavor:
                  options.browserRuntime.status === "available"
                    ? options.browserRuntime.bundle.manifest.buildFlavor
                    : "unavailable",
                grantDownload: input.grantDownload,
                policyStore: input.policyStore,
                route,
              }),
            createServer: (handler) =>
              new BrowserUseNativePipeServer({
                events: {
                  onAuthorizationError: (error) =>
                    logger.warn("Browser Use native pipe peer authorization failed", {
                      error: error instanceof Error ? error.message : String(error),
                    }),
                  onInvalidMessage: (error) =>
                    logger.warn("Browser Use native pipe received an invalid message", {
                      error: error instanceof Error ? error.message : String(error),
                    }),
                  onListening: () => logger.info("Browser Use native pipe listening"),
                  onRejectedSocket: (result) =>
                    logger.warn("Browser Use native pipe rejected a socket peer", {
                      reason: result.reason ?? "unauthorized",
                    }),
                  onRequestCompleted: (event) =>
                    logger.debug("Browser Use native pipe request completed", event),
                  onRequestStarted: (event) =>
                    logger.debug("Browser Use native pipe request started", event),
                  onSocketError: (error) =>
                    logger.warn("Browser Use native pipe socket failed", {
                      error: error.message,
                    }),
                },
                handler,
                socketPeerAuthorizer,
              }),
          });
          return runtime.pipe(
            Effect.map((sessionRuntime): BrowserUseRegistryPort =>
              adaptSessionRuntime(sessionRuntime),
            ),
          );
        },
      });
    }),
  );

export const testLayer = (ports: BrowserUseRuntimePorts): Layer.Layer<BrowserUseRuntime> =>
  Layer.effect(BrowserUseRuntime, make(ports));
