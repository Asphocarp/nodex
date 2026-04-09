import { describe, expect, mock, test } from "bun:test";
import type { DesktopNotificationActionPayload } from "../shared/types";

mock.module("electron", () => ({
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

  on(event: "action" | "click" | "close" | "reply", listener: (...args: unknown[]) => void): void {
    const existing = this.listeners.get(event) ?? [];
    existing.push(listener);
    this.listeners.set(event, existing);
  }

  emit(event: "action" | "click" | "close" | "reply", ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(...args);
    }
  }
}

function createOriginWebContents(id = 7) {
  return {
    id,
    isDestroyed: () => false,
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

    manager.showNotification({
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
    }, createOriginWebContents(), () => undefined);

    manager.showNotification({
      id: "question-1",
      kind: "question",
      title: "Need your input",
      body: "Answer 1 question to proceed.",
      conversationId: "thread-1",
    }, createOriginWebContents(8), () => undefined);

    expect(constructorOptions[0]?.hasReply).toBeTrue();
    expect(constructorOptions[0]?.replyPlaceholder).toBe("Reply to Codex");
    expect(String(constructorOptions[0]?.actions?.length ?? 0)).toBe("4");
    expect(constructorOptions[1]?.hasReply === true).toBeFalse();
    expect(constructorOptions[1]?.timeoutType).toBe("never");
    expect(notifications[0]?.shown).toBeTrue();
    expect(notifications[1]?.shown).toBeTrue();
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

    manager.showNotification({
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
    }, createOriginWebContents(), (payload) => {
      actions.push(payload);
    });

    notifications[0]?.emit("click");
    notifications[0]?.emit("action", {}, 0);
    notifications[0]?.emit("reply", {}, "Ship it");

    expect(actions[0]?.actionType).toBe("open");
    expect(actions[1]?.actionId).toBe("approve");
    expect(actions[1]?.actionType).toBe("approve");
    expect(actions[2]?.actionType).toBe("reply");
    expect(actions[2]?.reply).toBe("Ship it");

    manager.dismissByConversationId("thread-1");
    expect(notifications[0]?.closed).toBeTrue();
  });
});
