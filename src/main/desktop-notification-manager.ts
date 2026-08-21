import { constants, copyFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Notification, type WebContents } from "electron";
import type {
  DesktopNotificationActionPayload,
  DesktopNotificationHideSelector,
  DesktopNotificationPayload,
} from "../shared/types";
import { toDesktopNotificationPlainText } from "../shared/desktop-notification-text";

const MAX_ACTIONS = 4;
const MACOS_NOTIFICATION_SOUND_FILENAME = "nodex-notification.aiff";

type NotificationEventName = "action" | "click" | "close" | "failed" | "reply";

interface DesktopNotificationInstance {
  show(): void;
  close(): void;
  on(event: NotificationEventName, listener: (...args: unknown[]) => void): void;
}

export interface DesktopNotificationManagerOptions {
  isSupported?: () => boolean;
  createNotification?: (
    input: Electron.NotificationConstructorOptions,
  ) => DesktopNotificationInstance;
  platform?: NodeJS.Platform;
  logger?: Pick<Console, "warn">;
}

interface ActiveDesktopNotification {
  notification: DesktopNotificationInstance;
  notificationId: string;
  conversationId: string | null;
  navigationPath: string | null;
  originWebContentsId: number;
  disposeCallback: () => void;
}

function createElectronNotification(
  input: Electron.NotificationConstructorOptions,
): DesktopNotificationInstance {
  const notification = new Notification(input);
  const typedNotification = notification as Notification & {
    on(event: NotificationEventName, listener: (...args: unknown[]) => void): Notification;
  };
  return {
    show: () => notification.show(),
    close: () => notification.close(),
    on: (event: NotificationEventName, listener: (...args: unknown[]) => void) => {
      if (event === "action") {
        typedNotification.on("action", (eventObject, index) => {
          listener(eventObject, index);
        });
        return;
      }
      if (event === "reply") {
        typedNotification.on("reply", (eventObject, reply) => {
          listener(eventObject, reply);
        });
        return;
      }
      if (event === "failed") {
        typedNotification.on("failed", (_eventObject, error) => {
          listener(error);
        });
        return;
      }
      typedNotification.on(event, () => {
        listener();
      });
    },
  };
}

export class DesktopNotificationManager {
  private readonly notifications = new Map<string, ActiveDesktopNotification>();
  private readonly isSupported: () => boolean;
  private readonly createNotification: (
    input: Electron.NotificationConstructorOptions,
  ) => DesktopNotificationInstance;
  private readonly platform: NodeJS.Platform;
  private readonly logger?: Pick<Console, "warn">;
  private notificationSoundStaged = false;
  private stagedSoundName: string | null = null;

  constructor(options: DesktopNotificationManagerOptions = {}) {
    this.isSupported = options.isSupported ?? (() => Notification.isSupported());
    this.createNotification = options.createNotification ?? createElectronNotification;
    this.platform = options.platform ?? process.platform;
    this.logger = options.logger;
  }

  showNotification(
    notification: DesktopNotificationPayload,
    originWebContents: WebContents,
    onAction: (payload: DesktopNotificationActionPayload) => void,
    onRemove: () => void = () => undefined,
  ): void {
    if (!this.isSupported() || originWebContents.isDestroyed()) {
      this.callRemoveCallback(onRemove, notification.id);
      return;
    }

    const actions = (notification.actions ?? []).slice(0, MAX_ACTIONS);
    const hasReply =
      notification.kind === "turn-complete" &&
      typeof notification.replyPlaceholder === "string" &&
      notification.replyPlaceholder.trim().length > 0;
    const timeoutType =
      notification.kind === "permission" || notification.kind === "question" ? "never" : undefined;

    const occurrenceId = notification.occurrenceId ?? notification.id;
    this.removeNotification(occurrenceId, true);

    let instance: DesktopNotificationInstance;
    try {
      instance = this.createNotification({
        title: toDesktopNotificationPlainText(notification.title),
        body: toDesktopNotificationPlainText(notification.body),
        silent: false,
        timeoutType,
        hasReply,
        replyPlaceholder: hasReply ? notification.replyPlaceholder : undefined,
        sound: this.resolveMacOSNotificationSoundName(),
        actions: actions.map((action) => ({
          type: "button",
          text: action.title,
        })),
      });
    } catch (error) {
      this.logger?.warn("[desktop-notifications] constructor failed", {
        error,
        notificationId: notification.id,
      });
      this.callRemoveCallback(onRemove, notification.id);
      return;
    }

    let actionConsumed = false;
    const consumeAction = (payload: DesktopNotificationActionPayload): void => {
      if (actionConsumed) return;
      const active = this.notifications.get(occurrenceId);
      if (active?.notification !== instance) return;
      actionConsumed = true;
      this.removeNotification(occurrenceId, true);
      onAction(payload);
    };

    instance.on("click", () => {
      consumeAction({
        notificationId: notification.id,
        actionId: null,
        actionType: "open",
      });
    });
    instance.on("action", (_event, index) => {
      if (typeof index !== "number") {
        return;
      }
      const action = actions[index];
      if (!action) {
        return;
      }
      consumeAction({
        notificationId: notification.id,
        actionId: action.id,
        actionType: action.actionType,
      });
    });
    instance.on("reply", (_event, reply) => {
      if (typeof reply !== "string") {
        return;
      }
      consumeAction({
        notificationId: notification.id,
        actionId: null,
        actionType: "reply",
        reply,
      });
    });
    instance.on("close", () => {
      const active = this.notifications.get(occurrenceId);
      if (active?.notification !== instance) return;
      this.removeNotification(occurrenceId, false);
    });
    instance.on("failed", (error) => {
      const active = this.notifications.get(occurrenceId);
      if (active?.notification !== instance) return;
      this.logger?.warn("[desktop-notifications] native show failed", {
        error,
        notificationId: notification.id,
      });
      this.removeNotification(occurrenceId, false);
    });

    this.notifications.set(occurrenceId, {
      notification: instance,
      notificationId: notification.id,
      conversationId: notification.conversationId ?? null,
      navigationPath: notification.navigationPath ?? null,
      originWebContentsId: originWebContents.id,
      disposeCallback: onRemove,
    });
    try {
      instance.show();
    } catch (error) {
      this.logger?.warn("[desktop-notifications] show threw", {
        error,
        notificationId: notification.id,
      });
      this.removeNotification(occurrenceId, true);
    }
  }

  dismiss(selector: DesktopNotificationHideSelector): void {
    if (selector.occurrenceId !== undefined) {
      this.removeNotification(selector.occurrenceId, true);
      return;
    }
    if (selector.notificationId !== undefined) {
      this.dismissByNotificationId(selector.notificationId);
      return;
    }
    if (selector.conversationId !== undefined) {
      this.dismissByConversationId(selector.conversationId ?? null);
    }
    if (selector.navigationPath !== undefined) {
      this.dismissByNavigationPath(selector.navigationPath ?? null);
    }
  }

  dismissByNotificationId(notificationId: string): void {
    for (const [occurrenceId, active] of this.notifications.entries()) {
      if (active.notificationId !== notificationId) continue;
      this.removeNotification(occurrenceId, true);
    }
  }

  dismissByConversationId(conversationId: string | null): void {
    for (const [notificationId, active] of this.notifications.entries()) {
      if (active.conversationId !== conversationId) {
        continue;
      }
      this.removeNotification(notificationId, true);
    }
  }

  dismissByNavigationPath(navigationPath: string | null): void {
    for (const [notificationId, active] of this.notifications.entries()) {
      if (active.navigationPath !== navigationPath) continue;
      this.removeNotification(notificationId, true);
    }
  }

  dismissByOriginWebContentsId(webContentsId: number): void {
    for (const [notificationId, active] of this.notifications.entries()) {
      if (active.originWebContentsId !== webContentsId) continue;
      this.removeNotification(notificationId, true);
    }
  }

  dispose(): void {
    for (const notificationId of [...this.notifications.keys()]) {
      this.removeNotification(notificationId, true);
    }
  }

  private removeNotification(notificationId: string, closeNative: boolean): void {
    const active = this.notifications.get(notificationId);
    if (!active) return;
    this.notifications.delete(notificationId);
    this.callRemoveCallback(active.disposeCallback, active.notificationId);
    if (!closeNative) return;
    try {
      active.notification.close();
    } catch (error) {
      this.logger?.warn("[desktop-notifications] native close failed", {
        error,
        notificationId: active.notificationId,
      });
    }
  }

  private callRemoveCallback(callback: () => void, notificationId: string): void {
    try {
      callback();
    } catch (error) {
      this.logger?.warn("[desktop-notifications] callback cleanup failed", {
        error,
        notificationId,
      });
    }
  }

  private resolveMacOSNotificationSoundName(): string | undefined {
    if (this.platform !== "darwin") {
      return undefined;
    }
    if (this.notificationSoundStaged) {
      return this.stagedSoundName ?? undefined;
    }

    this.notificationSoundStaged = true;
    const candidates = [
      typeof process.resourcesPath === "string"
        ? join(process.resourcesPath, MACOS_NOTIFICATION_SOUND_FILENAME)
        : "",
      join(__dirname, "..", "..", "resources", MACOS_NOTIFICATION_SOUND_FILENAME),
    ].filter((candidate) => candidate.length > 0);
    const sourcePath = candidates.find((candidate) => existsSync(candidate));
    if (!sourcePath) {
      return undefined;
    }

    const soundDirectory = join(homedir(), "Library", "Sounds");
    const targetPath = join(soundDirectory, MACOS_NOTIFICATION_SOUND_FILENAME);
    try {
      mkdirSync(soundDirectory, { recursive: true });
      if (!existsSync(targetPath)) {
        copyFileSync(sourcePath, targetPath, constants.COPYFILE_EXCL);
      }
      this.stagedSoundName = MACOS_NOTIFICATION_SOUND_FILENAME.replace(/\.[^.]+$/, "");
    } catch {
      this.stagedSoundName = null;
    }

    return this.stagedSoundName ?? undefined;
  }
}
