import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import type { MainRuntimeController, MainRuntimeStartupContext } from "../main-runtime";
import {
  CoreAuthority,
  CoreSessionAccess,
  live as coreAuthorityLive,
} from "../core-runtime/CoreAuthority";
import {
  CoreEventHub,
  deliveryFrom as coreDeliveryFrom,
  live as coreEventHubLive,
} from "../core-runtime/CoreEventHub";
import { CoreModules, live as coreModulesLive } from "../core-runtime/CoreModules";
import { coreRuntimeError } from "../core-runtime/CoreRuntimeError";
import { live as coreTransportLive } from "../core-runtime/CoreTransport";
import { makeDesktopDataAuthority } from "../core-runtime/DesktopCoreAdapter";
import * as TerminalIpc from "../ipc/handlers/TerminalIpc";
import {
  activateMainServiceComposition,
  createMainServiceComposition,
} from "../main-service-composition";
import { ElectronApp } from "../platform/electron/ElectronApp";
import { ElectronIpc } from "../platform/electron/ElectronIpc";
import { ElectronWindowHost } from "../platform/electron/ElectronWindowHost";
import { TerminalSessions } from "../terminal-runtime/TerminalSessions";
import * as TerminalProjectAdmission from "../terminal-runtime/TerminalProjectAdmission";
import * as TerminalRuntimeLive from "../terminal-runtime/TerminalRuntimeLive";
import * as WindowSessionCatalog from "../window-runtime/WindowSessionCatalog";
import { MainConfig } from "./MainConfig";
import { MainRuntime, MainRuntimeError } from "./MainRuntimeLive";
import { MainShutdown } from "./MainShutdown";
import { ScopedCallbackRuntime } from "./ScopedCallbackRuntime";

const runtimeError = (operation: string, cause: unknown) =>
  new MainRuntimeError({ operation, cause });

const deliveryError = (operation: string, cause: unknown) =>
  coreRuntimeError({ operation, reason: "delivery", retryable: false, cause });

/** Production Main runtime owner while feature Layers replace the remaining application Modules. */
export const live: Layer.Layer<
  MainRuntime,
  MainRuntimeError,
  | ElectronApp
  | ElectronIpc
  | ElectronWindowHost
  | MainConfig
  | MainShutdown
  | ScopedCallbackRuntime
  | TerminalSessions
> = Layer.effect(
  MainRuntime,
  Effect.gen(function* () {
    const electron = yield* ElectronApp;
    const ipc = yield* ElectronIpc;
    const windowHost = yield* ElectronWindowHost;
    const config = yield* MainConfig;
    const shutdown = yield* MainShutdown;
    const callbacks = yield* ScopedCallbackRuntime;
    const terminals = yield* TerminalSessions;
    const runtimeScope = yield* Scope.Scope;
    const locale = yield* electron.locale;
    const activation = yield* Effect.acquireRelease(
      Effect.try({
        try: () => {
          const composition = createMainServiceComposition({
            locale: () => locale,
            terminalRuntime: {
              getSessionSnapshot: (sessionId) =>
                callbacks.runPromise(terminals.getSessionSnapshot(sessionId)),
              getThreadSnapshot: (threadId) =>
                callbacks.runPromise(terminals.getThreadSnapshot(threadId)),
              refreshSessionProcessMetrics: (sessionIds) =>
                callbacks.runPromise(terminals.refreshSessionProcessMetrics(sessionIds)),
            },
          });
          return { composition, release: activateMainServiceComposition(composition) };
        },
        catch: (cause) => runtimeError("activate-services", cause),
      }),
      ({ release }) => Effect.sync(release),
    );
    yield* Effect.forkScoped(
      terminals.events.pipe(
        Stream.runForEach((event) =>
          event.channel === "terminal-data"
            ? Effect.sync(() =>
                activation.composition.browserSidebarService.observePtyData(
                  event.payload.sessionId,
                  event.payload.data,
                ),
              )
            : Effect.void,
        ),
      ),
    );
    let controller: MainRuntimeController | null = null;
    let started = false;

    const requireController = (
      operation: string,
    ): Effect.Effect<MainRuntimeController, MainRuntimeError> =>
      Effect.suspend(() =>
        controller === null
          ? Effect.fail(runtimeError(operation, new Error("Main runtime has not started")))
          : Effect.succeed(controller),
      );

    const start = Effect.uninterruptible(
      Effect.gen(function* () {
        if (started)
          return yield* runtimeError("startup", new Error("Main runtime already started"));
        started = true;
        const module = yield* Effect.tryPromise({
          try: () => import("../main-runtime"),
          catch: (cause) => runtimeError("load-runtime", cause),
        });
        const authorityLayer = coreAuthorityLive().pipe(
          Layer.provide(
            Layer.merge(
              coreTransportLive({
                appResourcesPath: config.isPackaged ? config.resourcesPath : undefined,
                buildId: `nodex-desktop/${config.appVersion}`,
                isPackaged: config.isPackaged,
                nodexHome: config.nodexHome,
                onAuthorityProcessExit: module.publishCoreAuthorityProcessExit,
                onStartupEvent: module.publishCoreStartupEvent,
                repositoryRoot: config.projectRootPath,
              }),
              Layer.succeed(MainShutdown, shutdown),
            ),
          ),
        );
        const authorityContext = yield* Layer.buildWithScope(authorityLayer, runtimeScope).pipe(
          Effect.mapError((cause) => runtimeError("core-authority", cause)),
        );
        const authority = Context.get(authorityContext, CoreAuthority);
        const access = Context.get(authorityContext, CoreSessionAccess);
        const coreModulesContext = yield* Layer.buildWithScope(
          coreModulesLive.pipe(Layer.provide(Layer.succeed(CoreSessionAccess, access))),
          runtimeScope,
        );
        const coreModules = Context.get(coreModulesContext, CoreModules);
        const dataAuthority = yield* makeDesktopDataAuthority(callbacks).pipe(
          Effect.provideService(CoreAuthority, authority),
          Effect.provideService(CoreSessionAccess, access),
        );

        const terminalDependencies = Layer.mergeAll(
          Layer.succeed(ElectronIpc, ipc),
          Layer.succeed(ElectronWindowHost, windowHost),
          Layer.succeed(ScopedCallbackRuntime, callbacks),
          Layer.succeed(TerminalSessions, terminals),
          TerminalProjectAdmission.live.pipe(
            Layer.provide(Layer.succeed(CoreModules, coreModules)),
          ),
          WindowSessionCatalog.fromResolver((webContentsId) =>
            module.resolveMainWindowSessionId(webContentsId),
          ),
        );
        yield* Layer.buildWithScope(
          TerminalIpc.live.pipe(Layer.provide(terminalDependencies)),
          runtimeScope,
        );

        let coreEventsStarted = false;
        const startCoreEvents: MainRuntimeStartupContext["startCoreEvents"] = (input) => {
          if (coreEventsStarted) {
            return Promise.reject(new Error("Native Core events have already started"));
          }
          coreEventsStarted = true;
          return callbacks.runPromise(
            Effect.gen(function* () {
              const delivery = coreDeliveryFrom({
                event: (event) =>
                  Effect.tryPromise({
                    try: () => input.onEvent(event),
                    catch: (cause) => deliveryError("events.deliver", cause),
                  }),
                checkpoint: (checkpoint) =>
                  Effect.try({
                    try: () => input.onCheckpoint(checkpoint),
                    catch: (cause) => deliveryError("events.checkpoint", cause),
                  }),
                resync: (boundary) =>
                  Effect.tryPromise({
                    try: () => input.onResyncRequired(boundary),
                    catch: (cause) => deliveryError("events.resync", cause),
                  }),
              });
              const eventContext = yield* Layer.buildWithScope(
                coreEventHubLive({ initialAfter: input.initialAfter }).pipe(
                  Layer.provide(Layer.merge(Layer.succeed(CoreSessionAccess, access), delivery)),
                ),
                runtimeScope,
              );
              const hub = Context.get(eventContext, CoreEventHub);
              yield* SubscriptionRef.changes(hub.connection).pipe(
                Stream.runForEach((connection) => {
                  if (connection.kind === "ready") {
                    return Effect.sync(() => input.onConnectionStateChanged("connected"));
                  }
                  if (connection.kind === "backing-off") {
                    return Effect.sync(() =>
                      input.onConnectionStateChanged("interrupted", connection.error),
                    );
                  }
                  if (connection.kind === "failed") {
                    return Effect.sync(() =>
                      input.onConnectionStateChanged("failed", connection.error),
                    );
                  }
                  return Effect.void;
                }),
                Effect.forkIn(runtimeScope),
                Effect.asVoid,
              );
            }),
          );
        };

        const startup = yield* Effect.result(
          Effect.tryPromise({
            try: () =>
              module.runMainAppStartup({
                dataAuthority: Promise.resolve(dataAuthority),
                initialArgv: [...config.argv],
                manageElectronLifecycle: false,
                startupEvents: [],
                startCoreEvents,
                terminalRuntime: {
                  listLiveSessionsForOwners: (input) =>
                    callbacks.runPromise(terminals.listLiveSessionsForOwners(input)),
                  discardExitedSessionsForOwners: (input) =>
                    callbacks.runPromise(terminals.discardExitedSessionsForOwners(input)),
                  runAction: (input) =>
                    callbacks.runPromise(
                      terminals.runAction(
                        {
                          webContentsId: input.webContentsId,
                          windowSessionId: input.windowSessionId,
                        },
                        input.request,
                      ),
                    ),
                },
              }),
            catch: (cause) => runtimeError("startup", cause),
          }),
        );
        if (startup._tag === "Failure") {
          yield* Effect.tryPromise({
            try: () => module.shutdownFailedMainAppStartup(),
            catch: (cause) => runtimeError("startup-rollback", cause),
          }).pipe(Effect.orDie);
          return yield* startup.failure;
        }
        controller = startup.success;
        yield* Scope.addFinalizer(
          runtimeScope,
          Effect.tryPromise({
            try: () => controller!.shutdown(),
            catch: (cause) => runtimeError("shutdown", cause),
          }).pipe(Effect.orDie),
        );
      }),
    ).pipe(
      Effect.mapError((cause) =>
        Schema.is(MainRuntimeError)(cause) ? cause : runtimeError("startup", cause),
      ),
    );

    return MainRuntime.of({
      start,
      prepareQuit: requireController("prepare-quit").pipe(
        Effect.andThen((runtime) =>
          Effect.tryPromise({
            try: () => runtime.prepareQuit(),
            catch: (cause) => runtimeError("prepare-quit", cause),
          }),
        ),
      ),
      handleBootstrapEvent: (event) =>
        requireController("bootstrap-event").pipe(
          Effect.andThen((runtime) =>
            Effect.sync(() => {
              if (event.type === "open-url") runtime.handleOpenUrl(event.url);
              else runtime.handleSecondInstance([...event.argv]);
            }),
          ),
        ),
    });
  }),
);

export const productionLive = live.pipe(Layer.provideMerge(TerminalRuntimeLive.live));
