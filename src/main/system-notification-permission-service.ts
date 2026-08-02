import type { SystemNotificationPermissionStatus } from "../shared/types";

const NODEX_MACOS_BUNDLE_IDENTIFIER = "app.jyu.nodex";
const MACOS_NOTIFICATION_OPTIONS_ALERT_SOUND_BADGE = 0b111;

interface NotificationPermissionApi {
  getPermissionStatus?: () => unknown | Promise<unknown>;
}

interface MacRunLoopApi {
  run(): () => void;
}

let macRunLoopReferenceCount = 0;
let stopMacRunLoop: (() => void) | null = null;

function acquireMacRunLoop(runLoop: MacRunLoopApi): () => void {
  if (macRunLoopReferenceCount === 0) {
    stopMacRunLoop = runLoop.run();
  }
  macRunLoopReferenceCount += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    macRunLoopReferenceCount -= 1;
    if (macRunLoopReferenceCount !== 0) return;
    stopMacRunLoop?.();
    stopMacRunLoop = null;
  };
}

export interface MacSystemNotificationPermissionBridge {
  getStatus(): Promise<SystemNotificationPermissionStatus>;
  requestAuthorization(options: number): Promise<boolean>;
}

export interface SystemNotificationPermissionServiceOptions {
  platform?: NodeJS.Platform;
  notificationApi?: NotificationPermissionApi | null;
  loadMacBridge?: () => Promise<MacSystemNotificationPermissionBridge>;
  openExternal: (url: string) => Promise<unknown>;
  bundleIdentifier?: string;
  waitForPermissionPersistence?: () => Promise<void>;
  logger?: Pick<Console, "info" | "warn">;
}

function mapPermissionStatus(value: unknown): SystemNotificationPermissionStatus {
  if (typeof value === "number") {
    if (value === 0) return "not-determined";
    if (value === 1) return "disabled";
    if (value === 2 || value === 3 || value === 4) return "enabled";
    return null;
  }
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/[_\s]+/g, "-");
  if (
    normalized === "enabled"
    || normalized === "granted"
    || normalized === "authorized"
    || normalized === "provisional"
    || normalized === "ephemeral"
  ) return "enabled";
  if (normalized === "disabled" || normalized === "denied") return "disabled";
  if (
    normalized === "default"
    || normalized === "notdetermined"
    || normalized === "not-determined"
  ) return "not-determined";
  return null;
}

async function runMacNotificationCallback<T>(
  register: (resolve: (value: T) => void, reject: (error: unknown) => void) => void,
): Promise<T> {
  const { RunLoop } = await import("objc-js");
  return await new Promise<T>((resolve, reject) => {
    let settled = false;
    const releaseRunLoop = acquireMacRunLoop(RunLoop);
    const timeout = setTimeout(() => {
      finish(() => reject(new Error("macOS notification permission request timed out")));
    }, 10_000);
    const finish = (complete: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      releaseRunLoop();
      complete();
    };
    register(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}

export async function loadObjcMacSystemNotificationPermissionBridge(): Promise<
  MacSystemNotificationPermissionBridge
> {
  const { NobjcLibrary, typedBlock } = await import("objc-js");
  const userNotifications = new NobjcLibrary(
    "/System/Library/Frameworks/UserNotifications.framework/UserNotifications",
  );
  const center = userNotifications.UNUserNotificationCenter
    .currentNotificationCenter();

  return {
    async getStatus() {
      return await runMacNotificationCallback<SystemNotificationPermissionStatus>(
        (resolve, reject) => {
          try {
            const callback = typedBlock(
              { returns: "v", args: ["@"] },
              (settings: { authorizationStatus: () => unknown }) => {
                resolve(mapPermissionStatus(settings.authorizationStatus()));
              },
            );
            center.getNotificationSettingsWithCompletionHandler$(callback);
          } catch (error) {
            reject(error);
          }
        },
      );
    },
    async requestAuthorization(options) {
      return await runMacNotificationCallback<boolean>((resolve, reject) => {
        try {
          const callback = typedBlock(
            { returns: "v", args: ["B", "@"] },
            (granted: unknown, error: unknown) => {
              if (error) {
                reject(new Error(String(error)));
                return;
              }
              resolve(Boolean(granted));
            },
          );
          center.requestAuthorizationWithOptions$completionHandler$(
            options,
            callback,
          );
        } catch (error) {
          reject(error);
        }
      });
    },
  };
}

export class SystemNotificationPermissionService {
  private readonly options: Required<Pick<
    SystemNotificationPermissionServiceOptions,
    "platform" | "bundleIdentifier" | "waitForPermissionPersistence"
  >> & SystemNotificationPermissionServiceOptions;

  constructor(options: SystemNotificationPermissionServiceOptions) {
    this.options = {
      ...options,
      platform: options.platform ?? process.platform,
      bundleIdentifier:
        options.bundleIdentifier?.trim() || NODEX_MACOS_BUNDLE_IDENTIFIER,
      loadMacBridge:
        options.loadMacBridge ?? loadObjcMacSystemNotificationPermissionBridge,
      waitForPermissionPersistence:
        options.waitForPermissionPersistence
        ?? (() => new Promise((resolve) => setTimeout(resolve, 2_000))),
    };
  }

  async getNotificationPermissionStatus(): Promise<SystemNotificationPermissionStatus> {
    try {
      const staticStatus = this.options.notificationApi?.getPermissionStatus;
      const status = staticStatus
        ? mapPermissionStatus(await staticStatus.call(this.options.notificationApi))
        : await this.getPlatformFallbackStatus();
      this.options.logger?.info("[desktop-notifications] permission status", {
        platform: this.options.platform,
        status,
      });
      return status;
    } catch (error) {
      this.options.logger?.warn("[desktop-notifications] permission status failed", {
        error,
        platform: this.options.platform,
      });
      return null;
    }
  }

  async openNotificationSettings(): Promise<void> {
    if (this.options.platform === "darwin") {
      await this.prepareMacPermissionForSettings();
      const url = "x-apple.systempreferences:com.apple.Notifications-Settings.extension"
        + `?id=${encodeURIComponent(this.options.bundleIdentifier)}`;
      await this.options.openExternal(url);
      return;
    }
    if (this.options.platform === "win32") {
      await this.options.openExternal("ms-settings:notifications");
    }
  }

  private async getPlatformFallbackStatus(): Promise<SystemNotificationPermissionStatus> {
    if (this.options.platform !== "darwin") return null;
    const bridge = await this.options.loadMacBridge!();
    return await bridge.getStatus();
  }

  private async prepareMacPermissionForSettings(): Promise<void> {
    const status = await this.getNotificationPermissionStatus();
    if (status === "enabled" || status === "disabled") return;
    void this.requestMacPermission();
    await this.options.waitForPermissionPersistence();
  }

  private async requestMacPermission(): Promise<void> {
    try {
      const bridge = await this.options.loadMacBridge!();
      await bridge.requestAuthorization(
        MACOS_NOTIFICATION_OPTIONS_ALERT_SOUND_BADGE,
      );
    } catch (error) {
      this.options.logger?.warn("[desktop-notifications] permission request failed", {
        error,
        platform: this.options.platform,
      });
    }
  }
}
