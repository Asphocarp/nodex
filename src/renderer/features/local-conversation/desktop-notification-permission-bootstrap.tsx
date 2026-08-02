import { useEffect } from "react";

interface BrowserNotificationPermissionApi {
  readonly permission: NotificationPermission;
  requestPermission(): Promise<NotificationPermission>;
}

interface DesktopNotificationPermissionLogger {
  debug(message: string, context?: unknown): void;
  warn(message: string, context?: unknown): void;
}

let probedNotificationConstructors = new WeakSet<object>();

export async function bootstrapDesktopNotificationPermission(
  notificationApi: BrowserNotificationPermissionApi | null,
  logger: DesktopNotificationPermissionLogger = console,
): Promise<NotificationPermission | null> {
  if (!notificationApi) {
    logger.debug("[desktop-notifications] browser permission API missing");
    return null;
  }
  if (probedNotificationConstructors.has(notificationApi)) {
    return notificationApi.permission;
  }
  probedNotificationConstructors.add(notificationApi);

  const initialStatus = notificationApi.permission;
  logger.debug("[desktop-notifications] browser permission status", {
    status: initialStatus,
  });
  if (initialStatus !== "default") return initialStatus;

  try {
    const result = await notificationApi.requestPermission();
    logger.debug("[desktop-notifications] browser permission result", {
      status: result,
    });
    return result;
  } catch (error) {
    logger.warn("[desktop-notifications] browser permission request failed", {
      error,
    });
    return null;
  }
}

export function resetDesktopNotificationPermissionBootstrapForTests(): void {
  probedNotificationConstructors = new WeakSet<object>();
}

export function DesktopNotificationPermissionBootstrap(): null {
  useEffect(() => {
    const notificationApi = typeof globalThis.Notification === "function"
      ? globalThis.Notification
      : null;
    void bootstrapDesktopNotificationPermission(notificationApi);
  }, []);
  return null;
}
