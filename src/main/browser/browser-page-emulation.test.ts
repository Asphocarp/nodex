import { describe, expect, test, vi } from "vitest";
import { BrowserPageEmulationController } from "./browser-page-emulation";

function target({ initiallyAttached = false } = {}) {
  const commands: Array<[string, Record<string, unknown> | undefined]> = [];
  let attached = initiallyAttached;
  return {
    commands,
    target: {
      debugger: {
        attach: vi.fn(() => {
          attached = true;
        }),
        detach: vi.fn(() => {
          attached = false;
        }),
        isAttached: () => attached,
        sendCommand: vi.fn(async (method: string, params?: Record<string, unknown>) => {
          commands.push([method, params]);
        }),
      },
      isDestroyed: () => false,
    },
  };
}

describe("BrowserPageEmulationController", () => {
  test("retains one debugger session so viewport emulation survives", async () => {
    const fixture = target();
    const controller = new BrowserPageEmulationController();

    await expect(
      controller.syncDeviceMetrics(fixture.target, {
        width: 393,
        height: 852,
        zoomPercent: 100,
        presetId: "iphone-15-pro",
      }),
    ).resolves.toEqual({ ok: true });
    expect(fixture.commands).toEqual([
      [
        "Emulation.setDeviceMetricsOverride",
        {
          width: 393,
          height: 852,
          deviceScaleFactor: 1,
          mobile: true,
          screenWidth: 393,
          screenHeight: 852,
        },
      ],
      [
        "Emulation.setTouchEmulationEnabled",
        {
          enabled: true,
          maxTouchPoints: 5,
        },
      ],
    ]);
    expect(fixture.target.debugger.attach).toHaveBeenCalledWith("1.3");
    expect(fixture.target.debugger.detach).not.toHaveBeenCalled();
    expect(controller.isDebuggerRetained(fixture.target)).toBe(true);
  });

  test("adopts an existing Browser Use debugger without detaching it", async () => {
    const fixture = target({ initiallyAttached: true });
    const controller = new BrowserPageEmulationController();

    await expect(controller.syncColorScheme(fixture.target, "dark")).resolves.toEqual({ ok: true });
    expect(fixture.commands).toEqual([
      [
        "Emulation.setEmulatedMedia",
        {
          features: [
            {
              name: "prefers-color-scheme",
              value: "dark",
            },
          ],
        },
      ],
    ]);
    expect(fixture.target.debugger.attach).not.toHaveBeenCalled();
    expect(fixture.target.debugger.detach).not.toHaveBeenCalled();
    expect(controller.isDebuggerRetained(fixture.target)).toBe(true);
  });

  test("serializes color scheme and viewport mutations for one page", async () => {
    const fixture = target({ initiallyAttached: true });
    const controller = new BrowserPageEmulationController();
    let releaseFirstCommand: () => void = () => undefined;
    fixture.target.debugger.sendCommand.mockImplementationOnce(
      async (method: string, params?: Record<string, unknown>) => {
        fixture.commands.push([method, params]);
        await new Promise<void>((resolve) => {
          releaseFirstCommand = resolve;
        });
      },
    );

    const colorSchemeSync = controller.syncColorScheme(fixture.target, "light");
    const metricsSync = controller.clearDeviceMetrics(fixture.target);
    await Promise.resolve();
    expect(fixture.commands.map(([method]) => method)).toEqual(["Emulation.setEmulatedMedia"]);

    releaseFirstCommand();
    await expect(Promise.all([colorSchemeSync, metricsSync])).resolves.toEqual([
      { ok: true },
      { ok: true },
    ]);
    expect(fixture.commands.map(([method]) => method)).toEqual([
      "Emulation.setEmulatedMedia",
      "Emulation.clearDeviceMetricsOverride",
      "Emulation.setTouchEmulationEnabled",
    ]);
  });

  test("fails closed when a debugger target is unavailable", async () => {
    const controller = new BrowserPageEmulationController();
    await expect(
      controller.syncDeviceMetrics(
        {
          isDestroyed: () => false,
        },
        {
          width: 390,
          height: 844,
          zoomPercent: 100,
          presetId: "responsive",
        },
      ),
    ).resolves.toEqual({
      ok: false,
      reason: "debugger-unavailable",
    });
  });
});
