import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Notification, type WebContents } from "electron";
import type {
  DesktopNotificationActionPayload,
  DesktopNotificationPayload,
} from "../shared/types";

const MAX_ACTIONS = 4;
const MACOS_NOTIFICATION_SOUND_FILENAME = "Nodex Notification.aiff";

type NotificationEventName = "action" | "click" | "close" | "reply";

interface DesktopNotificationInstance {
  show(): void;
  close(): void;
  on(event: NotificationEventName, listener: (...args: unknown[]) => void): void;
}

export interface DesktopNotificationManagerOptions {
  isSupported?: () => boolean;
  createNotification?: (input: Electron.NotificationConstructorOptions) => DesktopNotificationInstance;
  platform?: NodeJS.Platform;
}

interface ActiveDesktopNotification {
  notification: DesktopNotificationInstance;
  conversationId: string | null;
  originWebContentsId: number;
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
  private notificationSoundStaged = false;
  private stagedSoundName: string | null = null;

  constructor(options: DesktopNotificationManagerOptions = {}) {
    this.isSupported = options.isSupported ?? (() => Notification.isSupported());
    this.createNotification = options.createNotification ?? createElectronNotification;
    this.platform = options.platform ?? process.platform;
  }

  showNotification(
    notification: DesktopNotificationPayload,
    originWebContents: WebContents,
    onAction: (payload: DesktopNotificationActionPayload) => void,
  ): void {
    if (!this.isSupported() || originWebContents.isDestroyed()) {
      return;
    }

    const actions = (notification.actions ?? []).slice(0, MAX_ACTIONS);
    const hasReply =
      notification.kind === "turn-complete"
      && typeof notification.replyPlaceholder === "string"
      && notification.replyPlaceholder.trim().length > 0;
    const timeoutType =
      notification.kind === "permission" || notification.kind === "question"
        ? "never"
        : undefined;

    this.notifications.get(notification.id)?.notification.close();

    const instance = this.createNotification({
      title: notification.title,
      body: notification.body,
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

    instance.on("click", () => {
      onAction({
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
      onAction({
        notificationId: notification.id,
        actionId: action.id,
        actionType: action.actionType,
      });
    });
    instance.on("reply", (_event, reply) => {
      if (typeof reply !== "string") {
        return;
      }
      onAction({
        notificationId: notification.id,
        actionId: null,
        actionType: "reply",
        reply,
      });
    });
    instance.on("close", () => {
      this.notifications.delete(notification.id);
    });

    this.notifications.set(notification.id, {
      notification: instance,
      conversationId: notification.conversationId ?? null,
      originWebContentsId: originWebContents.id,
    });
    instance.show();
  }

  dismissByConversationId(conversationId: string | null): void {
    for (const [notificationId, active] of this.notifications.entries()) {
      if (active.conversationId !== conversationId) {
        continue;
      }
      active.notification.close();
      this.notifications.delete(notificationId);
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
      copyFileSync(sourcePath, targetPath);
      this.stagedSoundName = MACOS_NOTIFICATION_SOUND_FILENAME.replace(/\.[^.]+$/, "");
    } catch {
      this.stagedSoundName = null;
    }

    return this.stagedSoundName ?? undefined;
  }
}
