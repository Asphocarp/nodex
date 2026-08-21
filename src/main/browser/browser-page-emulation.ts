import type {
  BrowserSidebarThemeVariant,
  BrowserSidebarViewport,
} from "../../shared/browser-sidebar";

interface BrowserDebuggerPort {
  attach(protocolVersion?: string): void;
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

const MOBILE_PRESET_PATTERN = /(iphone|pixel|samsung|ipad|surface-duo|surface-pro)/i;
const COLOR_SCHEME_SYNC_TIMEOUT_MS = 1_000;

function isMobileViewport(viewport: BrowserSidebarViewport): boolean {
  return MOBILE_PRESET_PATTERN.test(viewport.presetId);
}

/**
 * Owns one debugger session for the guest lifetime and serializes every page
 * emulation mutation through it. Electron clears emulation overrides when a
 * debugger session detaches, so Browser Use borrows this baseline session
 * instead of replacing it.
 */
export class BrowserPageEmulationController {
  private readonly operations = new WeakMap<
    BrowserPageEmulationTarget,
    Promise<BrowserPageEmulationResult>
  >();
  private readonly retainedTargets = new WeakSet<BrowserPageEmulationTarget>();

  retainDebugger(target: BrowserPageEmulationTarget): BrowserPageEmulationResult {
    const debuggerPort = target.debugger;
    if (!debuggerPort) {
      return { ok: false, reason: "debugger-unavailable" };
    }
    if (target.isDestroyed()) {
      return { ok: false, reason: "target-destroyed" };
    }

    try {
      if (!debuggerPort.isAttached()) debuggerPort.attach("1.3");
      this.retainedTargets.add(target);
      return { ok: true };
    } catch {
      return { ok: false, reason: "cdp-failed" };
    }
  }

  isDebuggerRetained(target: BrowserPageEmulationTarget): boolean {
    return this.retainedTargets.has(target);
  }

  syncDeviceMetrics(
    target: BrowserPageEmulationTarget,
    viewport: BrowserSidebarViewport,
  ): Promise<BrowserPageEmulationResult> {
    return this.withDebugger(target, async (debuggerPort) => {
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
    });
  }

  clearDeviceMetrics(target: BrowserPageEmulationTarget): Promise<BrowserPageEmulationResult> {
    return this.withDebugger(target, async (debuggerPort) => {
      await debuggerPort.sendCommand("Emulation.clearDeviceMetricsOverride");
      await debuggerPort.sendCommand("Emulation.setTouchEmulationEnabled", {
        enabled: false,
      });
    });
  }

  syncColorScheme(
    target: BrowserPageEmulationTarget,
    themeVariant: BrowserSidebarThemeVariant,
  ): Promise<BrowserPageEmulationResult> {
    return this.withDebugger(target, async (debuggerPort) => {
      await withTimeout(
        debuggerPort.sendCommand("Emulation.setEmulatedMedia", {
          features: [
            {
              name: "prefers-color-scheme",
              value: themeVariant,
            },
          ],
        }),
        COLOR_SCHEME_SYNC_TIMEOUT_MS,
      );
    });
  }

  private withDebugger(
    target: BrowserPageEmulationTarget,
    operation: (debuggerPort: BrowserDebuggerPort) => Promise<void>,
  ): Promise<BrowserPageEmulationResult> {
    return this.enqueue(target, async () => {
      const debuggerPort = target.debugger;
      if (!debuggerPort) {
        return { ok: false, reason: "debugger-unavailable" };
      }
      if (target.isDestroyed()) {
        return { ok: false, reason: "target-destroyed" };
      }

      const retained = this.retainDebugger(target);
      if (!retained.ok) return retained;

      try {
        await operation(debuggerPort);
        return { ok: true };
      } catch {
        return { ok: false, reason: "cdp-failed" };
      }
    });
  }

  private enqueue(
    target: BrowserPageEmulationTarget,
    operation: () => Promise<BrowserPageEmulationResult>,
  ): Promise<BrowserPageEmulationResult> {
    const previous = this.operations.get(target) ?? Promise.resolve({ ok: true } as const);
    const next = previous.then(operation, operation);
    this.operations.set(target, next);
    const cleanup = () => {
      if (this.operations.get(target) === next) {
        this.operations.delete(target);
      }
    };
    void next.then(cleanup, cleanup);
    return next;
  }
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new Error("Timed out synchronizing Browser page emulation"));
        }, timeoutMs);
        timeout.unref?.();
      }),
    ]);
  } finally {
    if (timeout !== null) clearTimeout(timeout);
  }
}
