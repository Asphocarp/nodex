import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FiberSet from "effect/FiberSet";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import type { BrowserRuntimeBackend } from "../../shared/browser-runtime-metadata";
import { resolveBrowserUseHostCapability } from "../../shared/browser-use-host-capability";
import type { BrowserSidebarService } from "../browser-sidebar-service";
import { createBrowserUsePeerAuthorizer } from "../browser-use/browser-use-peer-authorizer";
import type { BrowserUsePolicyReader } from "../browser-use/browser-use-policy-store";
import {
  BrowserUseSessionRegistry,
  type BrowserUseCursorArrivalInput,
  type BrowserUseRouteCapture,
} from "../browser-use/browser-use-session-registry";
import type { BrowserRuntimeAvailability } from "../codex/browser-runtime-bundle";
import { getLogger } from "../logging/logger";
import { DesktopToolRuntime } from "./DesktopToolRuntime";

export class BrowserUseRuntimeError extends Schema.TaggedError<BrowserUseRuntimeError>()(
  "BrowserUseRuntimeError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}

export interface BrowserUseRuntimeInstallInput {
  readonly policyStore: BrowserUsePolicyReader;
  readonly releaseCredentialOwner: (ownerWebContentsId: number) => void;
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
  "off" | "on" | "promoteBrowserUseRoute" | "setBrowserUseRouteCaptureHandler"
>;

interface BrowserUseRegistryPort {
  readonly availableBackends: () => readonly BrowserRuntimeBackend[];
  readonly captureRoute: (input: BrowserUseRouteCapture) => Promise<unknown>;
  readonly dispose: () => Promise<void>;
  readonly notifyCursorArrived: (input: BrowserUseCursorArrivalInput) => void;
  readonly releaseOwner: (ownerWebContentsId: number) => Promise<void>;
  readonly releaseSession: (sessionId: string) => Promise<void>;
  readonly turnEnded: (input: { sessionId: string; turnId: string }) => Promise<void>;
  readonly turnStarted: (input: { sessionId: string; turnId: string }) => void;
}

type DesktopToolPort = Pick<
  DesktopToolRuntime["Service"],
  "clearBrowserUseBindings" | "installBrowserUseBindings" | "setAvailableBackendsResolver"
>;

export interface BrowserUseRuntimePorts {
  readonly browserSidebar: BrowserSidebarPort;
  readonly desktopTools: DesktopToolPort;
  readonly makeRegistry: (policyStore: BrowserUsePolicyReader) => BrowserUseRegistryPort;
}

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
              const registry = yield* Effect.try({
                try: () => ports.makeRegistry(input.policyStore),
                catch: (cause) =>
                  new BrowserUseRuntimeError({ operation: "create-registry", cause }),
              });
              yield* Scope.addFinalizer(
                childScope,
                Effect.tryPromise({
                  try: () => registry.dispose(),
                  catch: (cause) =>
                    new BrowserUseRuntimeError({ operation: "dispose-registry", cause }),
                }).pipe(Effect.catch((error) => logFailure(error.operation, error.cause))),
              );

              ports.desktopTools.setAvailableBackendsResolver(() => registry.availableBackends());
              yield* Scope.addFinalizer(
                childScope,
                Effect.sync(() => ports.desktopTools.setAvailableBackendsResolver(() => [])),
              );
              yield* ports.desktopTools.installBrowserUseBindings({
                lifecycle: registry,
                routePromoter: {
                  promote: (route) => ports.browserSidebar.promoteBrowserUseRoute(route),
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
                  : runPromise(
                      Effect.tryPromise({
                        try: () => registry.captureRoute(route),
                        catch: (cause) =>
                          new BrowserUseRuntimeError({ operation: "capture-route", cause }),
                      }).pipe(Effect.asVoid),
                    ),
              );
              yield* Scope.addFinalizer(
                childScope,
                Effect.sync(() => ports.browserSidebar.setBrowserUseRouteCaptureHandler(null)),
              );

              const ownerReleased = (event: { ownerWebContentsId: number }) => {
                void runPromise(
                  Effect.try({
                    try: () => input.releaseCredentialOwner(event.ownerWebContentsId),
                    catch: (cause) =>
                      new BrowserUseRuntimeError({ operation: "release-credential-owner", cause }),
                  }).pipe(
                    Effect.andThen(
                      Effect.tryPromise({
                        try: () => registry.releaseOwner(event.ownerWebContentsId),
                        catch: (cause) =>
                          new BrowserUseRuntimeError({ operation: "release-owner", cause }),
                      }),
                    ),
                    Effect.catch((error) => logFailure(error.operation, error.cause)),
                  ),
                );
              };
              const cursorArrived = (event: {
                browserConversationId: string;
                browserViewScopeId: string;
                browserTabId: string;
                moveSequence: number;
                ownerWebContentsId: number | null;
              }) => {
                const ownerWebContentsId = event.ownerWebContentsId;
                if (ownerWebContentsId === null) return;
                void runPromise(
                  Effect.try({
                    try: () =>
                      registry.notifyCursorArrived({
                        ...event,
                        ownerWebContentsId,
                      }),
                    catch: (cause) =>
                      new BrowserUseRuntimeError({ operation: "notify-cursor-arrived", cause }),
                  }).pipe(Effect.catch((error) => logFailure(error.operation, error.cause))),
                );
              };
              ports.browserSidebar.on("browserUseOwnerReleased", ownerReleased);
              ports.browserSidebar.on("browserUseCursorArrived", cursorArrived);
              yield* Scope.addFinalizer(
                childScope,
                Effect.sync(() => {
                  ports.browserSidebar.off("browserUseOwnerReleased", ownerReleased);
                  ports.browserSidebar.off("browserUseCursorArrived", cursorArrived);
                }),
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
        browserSidebar: options.browserSidebar,
        desktopTools,
        makeRegistry: (policyStore) =>
          new BrowserUseSessionRegistry({
            appVersion: options.appVersion,
            browserService: options.browserSidebar,
            buildFlavor:
              options.browserRuntime.status === "available"
                ? options.browserRuntime.bundle.manifest.buildFlavor
                : "unavailable",
            enabled: capability.status === "available",
            nativePipeEvents: {
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
                logger.warn("Browser Use native pipe socket failed", { error: error.message }),
            },
            policyStore,
            socketPeerAuthorizer,
          }),
      });
    }),
  );

export const testLayer = (ports: BrowserUseRuntimePorts): Layer.Layer<BrowserUseRuntime> =>
  Layer.effect(BrowserUseRuntime, make(ports));
