import { describe, expect, vi, test } from "vite-plus/test";
import type { DesktopNotificationActionPayload } from "../shared/types";

vi.mock("electron", () => ({
  Notification: class Notification {
    static isSupported() {
      return true;
    }
  },
}));

class FakeNotification {
  private readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  closed = false;
  shown = false;

  show(): void {
    this.shown = true;
  }

  close(): void {
    this.closed = true;
    this.emit("close");
  }

  on(
    event: "action" | "click" | "close" | "failed" | "reply",
    listener: (...args: unknown[]) => void,
  ): void {
    const existing = this.listeners.get(event) ?? [];
    existing.push(listener);
    this.listeners.set(event, existing);
  }

  emit(event: "action" | "click" | "close" | "failed" | "reply", ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(...args);
    }
  }
}

function createOriginWebContents(id = 7, destroyed = false) {
  return {
    id,
    isDestroyed: () => destroyed,
  } as unknown as Electron.WebContents;
}

describe("DesktopNotificationManager", () => {
  test("caps actions, enables replies only for turn-complete, and uses never timeout for question/permission", async () => {
    const { DesktopNotificationManager } = await import("./desktop-notification-manager");
    const notifications: FakeNotification[] = [];
    const constructorOptions: Electron.NotificationConstructorOptions[] = [];
    const manager = new DesktopNotificationManager({
      isSupported: () => true,
      platform: "linux",
      createNotification: (input) => {
        constructorOptions.push(input);
        const notification = new FakeNotification();
        notifications.push(notification);
        return notification;
      },
    });

    manager.showNotification(
      {
        id: "turn-1",
        kind: "turn-complete",
        title: "Turn complete",
        body: "Done",
        conversationId: "thread-1",
        replyPlaceholder: "Reply to Codex",
        actions: Array.from({ length: 5 }, (_, index) => ({
          id: `action-${index + 1}`,
          title: `Action ${index + 1}`,
          actionType: "approve",
        })),
      },
      createOriginWebContents(),
      () => undefined,
    );

    manager.showNotification(
      {
        id: "question-1",
        kind: "question",
        title: "Need your input",
        body: "Answer 1 question to proceed.",
        conversationId: "thread-1",
      },
      createOriginWebContents(8),
      () => undefined,
    );

    expect(constructorOptions[0]?.hasReply).toBe(true);
    expect(constructorOptions[0]?.replyPlaceholder).toBe("Reply to Codex");
    expect(String(constructorOptions[0]?.actions?.length ?? 0)).toBe("4");
    expect(constructorOptions[1]?.hasReply === true).toBe(false);
    expect(constructorOptions[1]?.timeoutType).toBe("never");
    expect(notifications[0]?.shown).toBe(true);
    expect(notifications[1]?.shown).toBe(true);
  });

  test("routes click, action, and reply events and dismisses notifications by conversation id", async () => {
    const { DesktopNotificationManager } = await import("./desktop-notification-manager");
    const notifications: FakeNotification[] = [];
    const manager = new DesktopNotificationManager({
      isSupported: () => true,
      platform: "linux",
      createNotification: () => {
        const notification = new FakeNotification();
        notifications.push(notification);
        return notification;
      },
    });
    const actions: DesktopNotificationActionPayload[] = [];

    manager.showNotification(
      {
        id: "turn-1",
        kind: "turn-complete",
        title: "Turn complete",
        body: "Done",
        conversationId: "thread-1",
        replyPlaceholder: "Reply to Codex",
        actions: [
          {
            id: "approve",
            title: "Approve",
            actionType: "approve",
          },
        ],
      },
      createOriginWebContents(),
      (payload) => {
        actions.push(payload);
      },
    );

    notifications[0]?.emit("click");
    notifications[0]?.emit("action", {}, 0);
    notifications[0]?.emit("reply", {}, "Ship it");

    expect(actions[0]?.actionType).toBe("open");
    expect(actions).toHaveLength(1);
    expect(notifications[0]?.closed).toBe(true);

    manager.dismissByConversationId("thread-1");
    expect(notifications[0]?.closed).toBe(true);
  });

  test("replaces same-id notifications and dismisses by exact navigation path", async () => {
    const { DesktopNotificationManager } = await import("./desktop-notification-manager");
    const notifications: FakeNotification[] = [];
    const removed: string[] = [];
    const manager = new DesktopNotificationManager({
      isSupported: () => true,
      platform: "linux",
      createNotification: () => {
        const notification = new FakeNotification();
        notifications.push(notification);
        return notification;
      },
    });
    const show = (body: string, path: string, removeLabel: string) => {
      manager.showNotification(
        {
          id: "question-1",
          kind: "question",
          title: "Need input",
          body,
          navigationPath: path,
        },
        createOriginWebContents(),
        () => undefined,
        () => {
          removed.push(removeLabel);
        },
      );
    };

    show("First", "thread:first", "first");
    show("Second", "thread:second", "second");
    expect(notifications[0]?.closed).toBe(true);
    expect(removed).toEqual(["first"]);

    manager.dismissByNavigationPath("thread:first");
    expect(notifications[1]?.closed).toBe(false);
    manager.dismissByNavigationPath("thread:second");
    expect(notifications[1]?.closed).toBe(true);
    expect(removed).toEqual(["first", "second"]);
  });

  test("keeps colliding public IDs isolated by strict occurrence identity", async () => {
    const { DesktopNotificationManager } = await import("./desktop-notification-manager");
    const notifications: FakeNotification[] = [];
    const manager = new DesktopNotificationManager({
      isSupported: () => true,
      platform: "linux",
      createNotification: () => {
        const notification = new FakeNotification();
        notifications.push(notification);
        return notification;
      },
    });
    const base = {
      id: "question-default-73",
      kind: "question" as const,
      title: "Need input",
      body: "Answer a question to proceed.",
    };
    manager.showNotification(
      {
        ...base,
        occurrenceId: '["question","default","thread-1",73]',
      },
      createOriginWebContents(),
      () => undefined,
    );
    manager.showNotification(
      {
        ...base,
        occurrenceId: '["question","default","thread-1","73"]',
      },
      createOriginWebContents(),
      () => undefined,
    );

    expect(notifications[0]?.closed).toBe(false);
    expect(notifications[1]?.closed).toBe(false);
    manager.dismiss({ occurrenceId: '["question","default","thread-1",73]' });
    expect(notifications[0]?.closed).toBe(true);
    expect(notifications[1]?.closed).toBe(false);
  });

  test("sanitizes title and body at the Main native boundary", async () => {
    const { DesktopNotificationManager } = await import("./desktop-notification-manager");
    const constructorOptions: Electron.NotificationConstructorOptions[] = [];
    const manager = new DesktopNotificationManager({
      isSupported: () => true,
      platform: "linux",
      createNotification: (input) => {
        constructorOptions.push(input);
        return new FakeNotification();
      },
    });
    manager.showNotification(
      {
        id: "turn-unsafe",
        kind: "turn-complete",
        title: "**Task** <style>bad</style>",
        body: "Done <script>bad()</script> [details](https://example.com)",
      },
      createOriginWebContents(),
      () => undefined,
    );

    expect(constructorOptions[0]?.title).toBe("Task");
    expect(constructorOptions[0]?.body).toBe("Done details");
  });

  test("withdraws records when native presentation fails", async () => {
    const { DesktopNotificationManager } = await import("./desktop-notification-manager");
    const notifications: FakeNotification[] = [];
    const onRemove = vi.fn();
    const logger = { warn: vi.fn() };
    const manager = new DesktopNotificationManager({
      isSupported: () => true,
      platform: "linux",
      logger,
      createNotification: () => {
        const notification = new FakeNotification();
        notifications.push(notification);
        return notification;
      },
    });

    manager.showNotification(
      {
        id: "question-failed",
        kind: "question",
        title: "Need input",
        body: "Answer a question to proceed.",
      },
      createOriginWebContents(),
      () => undefined,
      onRemove,
    );
    notifications[0]?.emit("failed", new Error("native failure"));
    manager.dismissByNotificationId("question-failed");

    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      "[desktop-notifications] native show failed",
      expect.objectContaining({ notificationId: "question-failed" }),
    );
  });

  test("cleans up when native show throws", async () => {
    const { DesktopNotificationManager } = await import("./desktop-notification-manager");
    const onRemove = vi.fn();
    const logger = { warn: vi.fn() };
    const manager = new DesktopNotificationManager({
      isSupported: () => true,
      platform: "linux",
      logger,
      createNotification: () => {
        const notification = new FakeNotification();
        notification.show = () => {
          throw new Error("show failure");
        };
        return notification;
      },
    });

    manager.showNotification(
      {
        id: "question-show-throws",
        kind: "question",
        title: "Need input",
        body: "Answer a question to proceed.",
      },
      createOriginWebContents(),
      () => undefined,
      onRemove,
    );
    manager.dismissByNotificationId("question-show-throws");

    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      "[desktop-notifications] show threw",
      expect.objectContaining({ notificationId: "question-show-throws" }),
    );
  });

  test("isolates cleanup callback failures from native close and later records", async () => {
    const { DesktopNotificationManager } = await import("./desktop-notification-manager");
    const notifications: FakeNotification[] = [];
    const logger = { warn: vi.fn() };
    const manager = new DesktopNotificationManager({
      isSupported: () => true,
      platform: "linux",
      logger,
      createNotification: () => {
        const notification = new FakeNotification();
        notifications.push(notification);
        return notification;
      },
    });

    manager.showNotification(
      {
        id: "question-callback-throws",
        kind: "question",
        title: "Need input",
        body: "First",
      },
      createOriginWebContents(),
      () => undefined,
      () => {
        throw new Error("cleanup failure");
      },
    );
    manager.showNotification(
      {
        id: "question-after-callback",
        kind: "question",
        title: "Need input",
        body: "Second",
      },
      createOriginWebContents(),
      () => undefined,
    );
    manager.dispose();

    expect(notifications.every((notification) => notification.closed)).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      "[desktop-notifications] callback cleanup failed",
      expect.objectContaining({ notificationId: "question-callback-throws" }),
    );
  });

  test("withdraws unsupported or rendererless occurrences without constructing native UI", async () => {
    const { DesktopNotificationManager } = await import("./desktop-notification-manager");
    const createNotification = vi.fn(() => new FakeNotification());
    const unsupportedRemove = vi.fn();
    const unsupported = new DesktopNotificationManager({
      isSupported: () => false,
      platform: "linux",
      createNotification,
    });
    const destroyedRemove = vi.fn();
    const destroyed = new DesktopNotificationManager({
      isSupported: () => true,
      platform: "linux",
      createNotification,
    });
    const payload = {
      id: "question-unavailable",
      kind: "question" as const,
      title: "Need input",
      body: "Answer a question to proceed.",
    };

    unsupported.showNotification(
      payload,
      createOriginWebContents(),
      () => undefined,
      unsupportedRemove,
    );
    destroyed.showNotification(
      payload,
      createOriginWebContents(8, true),
      () => undefined,
      destroyedRemove,
    );

    expect(createNotification).not.toHaveBeenCalled();
    expect(unsupportedRemove).toHaveBeenCalledTimes(1);
    expect(destroyedRemove).toHaveBeenCalledTimes(1);
  });
});
