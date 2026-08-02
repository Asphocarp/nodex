import { describe, expect, it, vi } from "vitest";
import {
  SystemNotificationPermissionService,
  type MacSystemNotificationPermissionBridge,
} from "./system-notification-permission-service";

function makeMacBridge(
  status: "enabled" | "disabled" | "not-determined" | null,
): MacSystemNotificationPermissionBridge & {
  requestAuthorization: ReturnType<typeof vi.fn>;
} {
  return {
    getStatus: vi.fn(async () => status),
    requestAuthorization: vi.fn(async () => true),
  };
}

describe("SystemNotificationPermissionService", () => {
  it.each([
    ["granted", "enabled"],
    ["denied", "disabled"],
    ["default", "not-determined"],
    ["unknown", null],
  ] as const)("maps runtime permission status %s", async (raw, expected) => {
    const service = new SystemNotificationPermissionService({
      platform: "linux",
      notificationApi: { getPermissionStatus: () => raw },
      openExternal: vi.fn(async () => undefined),
    });
    await expect(service.getNotificationPermissionStatus()).resolves.toBe(expected);
  });

  it("uses the macOS bridge only when the runtime static API is absent", async () => {
    const bridge = makeMacBridge("disabled");
    const loadMacBridge = vi.fn(async () => bridge);
    const service = new SystemNotificationPermissionService({
      platform: "darwin",
      notificationApi: {},
      loadMacBridge,
      openExternal: vi.fn(async () => undefined),
    });
    await expect(service.getNotificationPermissionStatus()).resolves.toBe("disabled");
    expect(loadMacBridge).toHaveBeenCalledOnce();
  });

  it("requests alert, sound, and badge before opening macOS settings", async () => {
    const bridge = makeMacBridge("not-determined");
    const openExternal = vi.fn(async () => undefined);
    const waitForPermissionPersistence = vi.fn(async () => undefined);
    const service = new SystemNotificationPermissionService({
      platform: "darwin",
      notificationApi: null,
      loadMacBridge: async () => bridge,
      openExternal,
      bundleIdentifier: "app.jyu.nodex",
      waitForPermissionPersistence,
    });

    await service.openNotificationSettings();

    expect(bridge.requestAuthorization).toHaveBeenCalledWith(0b111);
    expect(waitForPermissionPersistence).toHaveBeenCalledOnce();
    expect(openExternal).toHaveBeenCalledWith(
      "x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=app.jyu.nodex",
    );
  });

  it("opens macOS settings after the fixed persistence wait without awaiting the prompt", async () => {
    const bridge = makeMacBridge(null);
    bridge.requestAuthorization.mockImplementation(
      () => new Promise<boolean>(() => undefined),
    );
    const openExternal = vi.fn(async () => undefined);
    const service = new SystemNotificationPermissionService({
      platform: "darwin",
      loadMacBridge: async () => bridge,
      openExternal,
      waitForPermissionPersistence: vi.fn(async () => undefined),
    });

    await service.openNotificationSettings();

    expect(bridge.requestAuthorization).toHaveBeenCalledWith(0b111);
    expect(openExternal).toHaveBeenCalledOnce();
  });

  it("opens Windows notification settings and reports unknown status honestly", async () => {
    const openExternal = vi.fn(async () => undefined);
    const service = new SystemNotificationPermissionService({
      platform: "win32",
      openExternal,
    });
    await expect(service.getNotificationPermissionStatus()).resolves.toBeNull();
    await service.openNotificationSettings();
    expect(openExternal).toHaveBeenCalledWith("ms-settings:notifications");
  });

  it("returns null when a native status query fails", async () => {
    const service = new SystemNotificationPermissionService({
      platform: "darwin",
      loadMacBridge: async () => {
        throw new Error("native load failed");
      },
      openExternal: vi.fn(async () => undefined),
      logger: { info: vi.fn(), warn: vi.fn() },
    });
    await expect(service.getNotificationPermissionStatus()).resolves.toBeNull();
  });
});
