import { act } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { createStartupShellMarkup } from "../../../config/startup-shell-html";
import type { AppInitializationStep } from "../../shared/app-startup";
import { startStartupController } from "./startup-controller";

interface BridgeHarness {
  readonly rejectInitialization: (cause: unknown) => void;
  readonly restartApplication: ReturnType<typeof vi.fn>;
  readonly sendStep: (step: AppInitializationStep) => void;
}

function installBridge(): BridgeHarness {
  let initializationListener: ((step: AppInitializationStep) => void) | null = null;
  let rejectInitialization = (_cause: unknown): void => undefined;
  const initialization = new Promise<void>((_resolve, reject) => {
    rejectInitialization = reject;
  });
  const restartApplication = vi.fn(() => Promise.resolve());
  Object.defineProperty(window, "api", {
    configurable: true,
    value: {
      awaitInitialization: () => initialization,
      invoke: vi.fn(() => Promise.resolve()),
      on: vi.fn(() => () => undefined),
      onInitializationStep: (listener: (step: AppInitializationStep) => void) => {
        initializationListener = listener;
        return () => {
          initializationListener = null;
        };
      },
      reportInitializationReady: vi.fn(),
      restartApplication,
    },
  });
  return {
    rejectInitialization,
    restartApplication,
    sendStep: (step) => initializationListener?.(step),
  };
}

describe("startup controller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = `<div id="root">${createStartupShellMarkup()}</div>`;
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
    Reflect.deleteProperty(window, "api");
  });

  test("keeps fast opening quiet and immediately presents real migration state", () => {
    const bridge = installBridge();
    const controller = startStartupController();
    const visibleStatus = document.querySelector<HTMLElement>("[data-startup-visible-status]");

    expect(visibleStatus?.hidden).toBe(true);
    bridge.sendStep({ phase: "migrating", fromVersion: 2, toVersion: 3 });
    expect(visibleStatus?.hidden).toBe(false);
    expect(visibleStatus?.textContent).toBe("Updating local data…");
    bridge.sendStep({
      phase: "migrating",
      fromVersion: 2,
      toVersion: 3,
      completed: 4,
      total: 5,
    });
    expect(visibleStatus?.textContent).toBe("Updating local data… 80%");
    bridge.sendStep({
      phase: "migrating",
      fromVersion: 2,
      toVersion: 3,
      completed: 3,
      total: 5,
    });
    expect(visibleStatus?.textContent).toBe("Updating local data… 80%");
    bridge.sendStep({ phase: "opening" });
    expect(visibleStatus?.textContent).toBe("Updating local data… 80%");

    controller.dispose();
  });

  test("reveals generic copy only after the quiet-start delay", async () => {
    installBridge();
    const controller = startStartupController();
    const visibleStatus = document.querySelector<HTMLElement>("[data-startup-visible-status]");

    expect(visibleStatus?.hidden).toBe(true);
    await act(async () => vi.advanceTimersByTime(1_800));
    expect(visibleStatus?.hidden).toBe(false);
    expect(visibleStatus?.textContent).toBe("Opening Nodex…");

    controller.dispose();
  });

  test("retains the logo and exposes restart when initialization fails", async () => {
    const bridge = installBridge();
    startStartupController();
    bridge.rejectInitialization(new Error("startup failed"));

    await act(async () => Promise.resolve());
    const shell = document.querySelector<HTMLElement>(".nodex-startup-shell");
    const restart = document.querySelector<HTMLButtonElement>("[data-startup-restart]");
    expect(shell?.dataset.startupPhase).toBe("failed");
    expect(document.querySelector(".nodex-startup-logo-base")).not.toBeNull();
    expect(restart?.hidden).toBe(false);
    restart?.click();
    expect(bridge.restartApplication).toHaveBeenCalledOnce();
  });
});
