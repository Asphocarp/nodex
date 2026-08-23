import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as LayerMap from "effect/LayerMap";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import type {
  BrowserSidebarThemeVariant,
  BrowserSidebarViewport,
} from "../../shared/browser-sidebar";
import type { ScopedCallbackRuntime } from "../app/ScopedCallbackRuntime";

interface BrowserDebuggerPort {
  attach(protocolVersion?: string): void;
  detach?(): void;
  isAttached(): boolean;
  sendCommand(
    method: string,
    commandParams?: Record<string, unknown>,
    sessionId?: string,
  ): Promise<unknown>;
}

export interface BrowserPageEmulationTarget {
  debugger?: BrowserDebuggerPort;
  isDestroyed(): boolean;
}

export type BrowserPageEmulationResult =
  | { ok: true }
  | { ok: false; reason: "debugger-unavailable" | "target-destroyed" | "cdp-failed" };

class BrowserPageEmulationCommandError extends Schema.TaggedError<BrowserPageEmulationCommandError>()(
  "BrowserPageEmulationCommandError",
  { cause: Schema.Defect() },
) {}

export interface BrowserPageEmulationRuntime {
  readonly retainDebugger: (
    target: BrowserPageEmulationTarget,
  ) => Effect.Effect<BrowserPageEmulationResult>;
  readonly isDebuggerRetained: (target: BrowserPageEmulationTarget) => boolean;
  readonly syncDeviceMetrics: (
    target: BrowserPageEmulationTarget,
    viewport: BrowserSidebarViewport,
  ) => Effect.Effect<BrowserPageEmulationResult>;
  readonly clearDeviceMetrics: (
    target: BrowserPageEmulationTarget,
  ) => Effect.Effect<BrowserPageEmulationResult>;
  readonly syncColorScheme: (
    target: BrowserPageEmulationTarget,
    themeVariant: BrowserSidebarThemeVariant,
  ) => Effect.Effect<BrowserPageEmulationResult>;
  readonly release: (target: BrowserPageEmulationTarget) => Effect.Effect<void>;
}

/** Narrow Promise projection used only by the Electron BrowserSidebar callback consumer. */
export interface BrowserPageEmulationElectronPort {
  readonly retainDebugger: (
    target: BrowserPageEmulationTarget,
  ) => Promise<BrowserPageEmulationResult>;
  readonly isDebuggerRetained: (target: BrowserPageEmulationTarget) => boolean;
  readonly syncDeviceMetrics: (
    target: BrowserPageEmulationTarget,
    viewport: BrowserSidebarViewport,
  ) => Promise<BrowserPageEmulationResult>;
  readonly clearDeviceMetrics: (
    target: BrowserPageEmulationTarget,
  ) => Promise<BrowserPageEmulationResult>;
  readonly syncColorScheme: (
    target: BrowserPageEmulationTarget,
    themeVariant: BrowserSidebarThemeVariant,
  ) => Promise<BrowserPageEmulationResult>;
  readonly release: (target: BrowserPageEmulationTarget) => void;
}

const MOBILE_PRESET_PATTERN = /(iphone|pixel|samsung|ipad|surface-duo|surface-pro)/i;
const COLOR_SCHEME_SYNC_TIMEOUT = Duration.seconds(1);

function isMobileViewport(viewport: BrowserSidebarViewport): boolean {
  return MOBILE_PRESET_PATTERN.test(viewport.presetId);
}

class BrowserPageEmulationSession extends Context.Service<
  BrowserPageEmulationSession,
  {
    readonly run: (
      operation: (
        debuggerPort: BrowserDebuggerPort,
      ) => Effect.Effect<void, BrowserPageEmulationCommandError>,
    ) => Effect.Effect<BrowserPageEmulationResult>;
    readonly awaitIdle: Effect.Effect<void>;
  }
>()("nodex/main/browser/BrowserPageEmulationSession") {}

interface EmulationSessionKey {
  readonly generation: symbol;
  readonly target: BrowserPageEmulationTarget;
}

interface RegisteredTarget {
  readonly key: EmulationSessionKey;
  accepting: boolean;
}

const sessionLayer = (
  key: EmulationSessionKey,
  onRetained: () => void,
  onReleased: () => void,
): Layer.Layer<BrowserPageEmulationSession> =>
  Layer.effect(
    BrowserPageEmulationSession,
    Effect.acquireRelease(
      Effect.gen(function* () {
        const debuggerPort = key.target.debugger;
        const available =
          debuggerPort === undefined
            ? ({ ok: false, reason: "debugger-unavailable" } as const)
            : key.target.isDestroyed()
              ? ({ ok: false, reason: "target-destroyed" } as const)
              : yield* Effect.try({
                  try: () => {
                    if (!debuggerPort.isAttached()) debuggerPort.attach("1.3");
                    onRetained();
                    return { ok: true } as const;
                  },
                  catch: () => ({ ok: false, reason: "cdp-failed" }) as const,
                }).pipe(Effect.catch((result) => Effect.succeed(result)));
        const lane = yield* Semaphore.make(1);
        const run = (
          operation: (
            port: BrowserDebuggerPort,
          ) => Effect.Effect<void, BrowserPageEmulationCommandError>,
        ): Effect.Effect<BrowserPageEmulationResult> => {
          if (!available.ok || debuggerPort === undefined) return Effect.succeed(available);
          return lane.withPermits(1)(
            Effect.gen(function* () {
              if (key.target.isDestroyed()) {
                return { ok: false, reason: "target-destroyed" } as const;
              }
              return yield* operation(debuggerPort).pipe(
                Effect.as({ ok: true } as const),
                Effect.catch(() => Effect.succeed({ ok: false, reason: "cdp-failed" } as const)),
              );
            }),
          );
        };
        return BrowserPageEmulationSession.of({ awaitIdle: lane.withPermits(1)(Effect.void), run });
      }),
      () =>
        Effect.sync(() => {
          onReleased();
          const debuggerPort = key.target.debugger;
          if (!debuggerPort || key.target.isDestroyed() || !debuggerPort.isAttached()) return;
          try {
            debuggerPort.detach?.();
          } catch {
            // WebContents destruction remains the physical lifecycle authority.
          }
        }),
    ),
  );

/**
 * Owns one serialized CDP emulation session per Browser guest.
 *
 * Entries stay alive until guest release or parent Scope close. Revocation closes
 * admission before invalidating the keyed resource, so late callbacks cannot
 * recreate or mutate a detached debugger session.
 */
export const makeBrowserPageEmulationRuntime: Effect.Effect<
  BrowserPageEmulationRuntime,
  never,
  import("effect/Scope").Scope
> = Effect.gen(function* () {
  let accepting = true;
  const registrations = new Map<BrowserPageEmulationTarget, RegisteredTarget>();
  const retained = new Set<BrowserPageEmulationTarget>();
  const sessions = yield* LayerMap.make(
    (key: EmulationSessionKey) =>
      sessionLayer(
        key,
        () => retained.add(key.target),
        () => retained.delete(key.target),
      ),
    { idleTimeToLive: Duration.infinity },
  );
  const registration = (target: BrowserPageEmulationTarget): RegisteredTarget | null => {
    if (!accepting) return null;
    const current = registrations.get(target);
    if (current?.accepting) return current;
    if (current) return null;
    const created: RegisteredTarget = {
      accepting: true,
      key: { generation: Symbol("browser-page-emulation"), target },
    };
    registrations.set(target, created);
    return created;
  };

  const withSession = (
    target: BrowserPageEmulationTarget,
    operation: (
      session: BrowserPageEmulationSession["Service"],
    ) => Effect.Effect<BrowserPageEmulationResult>,
  ): Effect.Effect<BrowserPageEmulationResult> =>
    Effect.suspend(() => {
      const current = registration(target);
      if (!current) return Effect.succeed({ ok: false, reason: "target-destroyed" } as const);
      return Effect.gen(function* () {
        const context = yield* sessions.contextEffect(current.key);
        if (!current.accepting || registrations.get(target)?.key !== current.key) {
          return { ok: false, reason: "target-destroyed" } as const;
        }
        return yield* operation(Context.get(context, BrowserPageEmulationSession));
      }).pipe(Effect.scoped);
    });

  const runCommand = (
    target: BrowserPageEmulationTarget,
    operation: (
      debuggerPort: BrowserDebuggerPort,
    ) => Effect.Effect<void, BrowserPageEmulationCommandError>,
  ): Effect.Effect<BrowserPageEmulationResult> =>
    withSession(target, (session) => session.run(operation));

  const release = Effect.fn("BrowserPageEmulationRuntime.release")(function* (
    target: BrowserPageEmulationTarget,
  ) {
    const current = registrations.get(target);
    if (!current) return;
    current.accepting = false;
    yield* Effect.gen(function* () {
      const context = yield* sessions.contextEffect(current.key);
      yield* Context.get(context, BrowserPageEmulationSession).awaitIdle;
    }).pipe(Effect.scoped);
    yield* sessions.invalidate(current.key);
  });

  const sendCommand = (
    debuggerPort: BrowserDebuggerPort,
    method: string,
    params?: Record<string, unknown>,
  ): Effect.Effect<unknown, BrowserPageEmulationCommandError> =>
    Effect.tryPromise({
      try: () => debuggerPort.sendCommand(method, params),
      catch: (cause) => new BrowserPageEmulationCommandError({ cause }),
    });

  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      accepting = false;
      for (const current of registrations.values()) current.accepting = false;
      registrations.clear();
      retained.clear();
    }),
  );

  return {
    retainDebugger: (target) => withSession(target, (session) => session.run(() => Effect.void)),
    isDebuggerRetained: (target) => retained.has(target),
    syncDeviceMetrics: (target, viewport) =>
      runCommand(target, (debuggerPort) => {
        const mobile = isMobileViewport(viewport);
        return sendCommand(debuggerPort, "Emulation.setDeviceMetricsOverride", {
          width: viewport.width,
          height: viewport.height,
          deviceScaleFactor: 1,
          mobile,
          screenWidth: viewport.width,
          screenHeight: viewport.height,
        }).pipe(
          Effect.andThen(
            sendCommand(debuggerPort, "Emulation.setTouchEmulationEnabled", {
              enabled: mobile,
              maxTouchPoints: mobile ? 5 : 1,
            }),
          ),
          Effect.asVoid,
        );
      }),
    clearDeviceMetrics: (target) =>
      runCommand(target, (debuggerPort) =>
        sendCommand(debuggerPort, "Emulation.clearDeviceMetricsOverride").pipe(
          Effect.andThen(
            sendCommand(debuggerPort, "Emulation.setTouchEmulationEnabled", {
              enabled: false,
            }),
          ),
          Effect.asVoid,
        ),
      ),
    syncColorScheme: (target, themeVariant) =>
      runCommand(target, (debuggerPort) =>
        sendCommand(debuggerPort, "Emulation.setEmulatedMedia", {
          features: [{ name: "prefers-color-scheme", value: themeVariant }],
        }).pipe(
          Effect.timeoutOrElse({
            duration: COLOR_SCHEME_SYNC_TIMEOUT,
            orElse: () =>
              Effect.fail(
                new BrowserPageEmulationCommandError({
                  cause: new Error("Timed out synchronizing Browser page emulation"),
                }),
              ),
          }),
          Effect.asVoid,
        ),
      ),
    release,
  };
});

export const makeBrowserPageEmulationElectronPort = (
  runtime: BrowserPageEmulationRuntime,
  callbacks: ScopedCallbackRuntime["Service"],
): BrowserPageEmulationElectronPort => ({
  retainDebugger: (target) => callbacks.runPromise(runtime.retainDebugger(target)),
  isDebuggerRetained: runtime.isDebuggerRetained,
  syncDeviceMetrics: (target, viewport) =>
    callbacks.runPromise(runtime.syncDeviceMetrics(target, viewport)),
  clearDeviceMetrics: (target) => callbacks.runPromise(runtime.clearDeviceMetrics(target)),
  syncColorScheme: (target, themeVariant) =>
    callbacks.runPromise(runtime.syncColorScheme(target, themeVariant)),
  release: (target) => {
    callbacks.fork(runtime.release(target));
  },
});

/** Test-only port for synchronous BrowserSidebarService fixtures. */
export const makeBrowserPageEmulationElectronPortUnsafe = (): BrowserPageEmulationElectronPort => {
  const retained = new Set<BrowserPageEmulationTarget>();
  const withDebugger = async (
    target: BrowserPageEmulationTarget,
    operation?: (debuggerPort: BrowserDebuggerPort) => Promise<unknown>,
  ): Promise<BrowserPageEmulationResult> => {
    const debuggerPort = target.debugger;
    if (!debuggerPort) return { ok: false, reason: "debugger-unavailable" };
    if (target.isDestroyed()) return { ok: false, reason: "target-destroyed" };
    try {
      if (!debuggerPort.isAttached()) debuggerPort.attach("1.3");
      retained.add(target);
      await operation?.(debuggerPort);
      return { ok: true };
    } catch {
      return { ok: false, reason: "cdp-failed" };
    }
  };
  return {
    retainDebugger: (target) => withDebugger(target),
    isDebuggerRetained: (target) => retained.has(target),
    syncDeviceMetrics: (target, viewport) =>
      withDebugger(target, async (debuggerPort) => {
        const mobile = isMobileViewport(viewport);
        await debuggerPort.sendCommand("Emulation.setDeviceMetricsOverride", {
          width: viewport.width,
          height: viewport.height,
          deviceScaleFactor: 1,
          mobile,
          screenWidth: viewport.width,
          screenHeight: viewport.height,
        });
        await debuggerPort.sendCommand("Emulation.setTouchEmulationEnabled", {
          enabled: mobile,
          maxTouchPoints: mobile ? 5 : 1,
        });
      }),
    clearDeviceMetrics: (target) =>
      withDebugger(target, async (debuggerPort) => {
        await debuggerPort.sendCommand("Emulation.clearDeviceMetricsOverride");
        await debuggerPort.sendCommand("Emulation.setTouchEmulationEnabled", { enabled: false });
      }),
    syncColorScheme: (target, themeVariant) =>
      withDebugger(target, (debuggerPort) =>
        debuggerPort.sendCommand("Emulation.setEmulatedMedia", {
          features: [{ name: "prefers-color-scheme", value: themeVariant }],
        }),
      ),
    release: (target) => retained.delete(target),
  };
};
