import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import type { MainRuntimeController } from "../main-runtime";
import type { DesktopProjectWorkspacePort } from "../core-client/project-workspace-adapter";
import * as TerminalIpc from "../ipc/handlers/TerminalIpc";
import {
  activateMainServiceComposition,
  createMainServiceComposition,
} from "../main-service-composition";
import { ElectronApp } from "../platform/electron/ElectronApp";
import { ElectronIpc } from "../platform/electron/ElectronIpc";
import { ElectronWindowHost } from "../platform/electron/ElectronWindowHost";
import { assertTerminalProjectIsActive } from "../project-lifecycle-service";
import {
  fromResolver as terminalAdmissionFromResolver,
  TerminalProjectAdmissionError,
} from "../terminal-runtime/TerminalProjectAdmission";
import { MainConfig } from "./MainConfig";
import { MainRuntime, MainRuntimeError } from "./MainRuntimeLive";
import { ScopedCallbackRuntime } from "./ScopedCallbackRuntime";
import { TerminalSessions } from "../terminal-runtime/TerminalSessions";
import * as TerminalRuntimeLive from "../terminal-runtime/TerminalRuntimeLive";
import * as WindowSessionCatalog from "../window-runtime/WindowSessionCatalog";

type RuntimeModule = typeof import("../main-runtime");

const runtimeError = (operation: string, cause: unknown) =>
  new MainRuntimeError({ operation, cause });

/** Production Main runtime owner while feature Layers replace the remaining application Modules. */
export const live: Layer.Layer<
  MainRuntime,
  MainRuntimeError,
  | ElectronApp
  | ElectronIpc
  | ElectronWindowHost
  | MainConfig
  | ScopedCallbackRuntime
  | TerminalSessions
> = Layer.effect(
  MainRuntime,
  Effect.gen(function* () {
    const electron = yield* ElectronApp;
    const config = yield* MainConfig;
    const callbacks = yield* ScopedCallbackRuntime;
    const terminals = yield* TerminalSessions;
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
    let runtimeModule: RuntimeModule | null = null;
    let controller: MainRuntimeController | null = null;
    let terminalProjectAuthority: Pick<
      DesktopProjectWorkspacePort,
      "getProject" | "getProjectSession" | "getThread"
    > | null = null;
    yield* Layer.build(
      TerminalIpc.live.pipe(
        Layer.provide(
          Layer.merge(
            terminalAdmissionFromResolver((input) =>
              Effect.suspend(() => {
                if (terminalProjectAuthority === null) {
                  return Effect.fail(
                    new TerminalProjectAdmissionError({
                      operation: "authority-not-ready",
                      cause: new Error("Project authority is not ready"),
                    }),
                  );
                }
                return Effect.tryPromise({
                  try: () => assertTerminalProjectIsActive(terminalProjectAuthority!, input),
                  catch: (cause) =>
                    new TerminalProjectAdmissionError({ operation: "admission", cause }),
                });
              }),
            ),
            WindowSessionCatalog.fromResolver(
              (webContentsId) => runtimeModule?.resolveMainWindowSessionId(webContentsId) ?? null,
            ),
          ),
        ),
      ),
    );
    yield* Effect.addFinalizer(() => {
      const release =
        controller !== null
          ? Effect.tryPromise({
              try: () => controller!.shutdown(),
              catch: (cause) => runtimeError("shutdown", cause),
            })
          : runtimeModule !== null
            ? Effect.tryPromise({
                try: () => runtimeModule!.shutdownFailedMainAppStartup(),
                catch: (cause) => runtimeError("startup-rollback", cause),
              })
            : Effect.void;
      return release.pipe(Effect.orDie);
    });

    const requireController = (
      operation: string,
    ): Effect.Effect<MainRuntimeController, MainRuntimeError> =>
      Effect.suspend(() =>
        controller === null
          ? Effect.fail(runtimeError(operation, new Error("Main runtime has not started")))
          : Effect.succeed(controller),
      );

    return MainRuntime.of({
      start: Effect.uninterruptible(
        Effect.tryPromise({
          try: () =>
            import("../main-runtime").then((module) => {
              runtimeModule = module;
              return module
                .runMainAppStartup({
                  initialArgv: [...config.argv],
                  manageElectronLifecycle: false,
                  startupEvents: [],
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
                  onTerminalProjectAuthorityReady: (authority) => {
                    terminalProjectAuthority = authority;
                  },
                })
                .then((started) => {
                  controller = started;
                });
            }),
          catch: (cause) => runtimeError("startup", cause),
        }),
      ),
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
