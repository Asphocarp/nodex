import { describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { render, settleAsyncRender } from "../../test/dom";

const invokeCalls: Array<[string, ...unknown[]]> = [];
let currentFocusState = true;
let desktopNotificationActionListener:
  | ((payload: {
      notificationId: string;
      actionId: string | null;
      actionType: "open" | "reply" | "approve" | "approve-for-session" | "decline";
      reply?: string;
      conversationId: string | null;
      requestId: string | null;
    }) => void)
  | null = null;
let windowFocusChangeListener: ((isFocused: boolean) => void) | null = null;
let threadNotificationSettings: {
  turnMode: "off" | "unfocused" | "always";
  permissionsEnabled: boolean;
  questionsEnabled: boolean;
} = {
  turnMode: "unfocused" as const,
  permissionsEnabled: true,
  questionsEnabled: true,
};
let turnCompletedListener:
  | ((payload: {
      conversationId: string;
      turnId: string;
      status: "completed" | "failed";
      lastAgentMessage: string | null;
      heartbeatAssistantMessage: null | {
        decision: "NOTIFY" | "DONT_NOTIFY";
        visibleText: string | null;
        notificationMessage: string | null;
      };
      hasPendingContinuation: boolean;
    }) => void)
  | null = null;
let approvalRequestListener:
  | ((payload: {
      conversationId: string;
      requestId: string;
      kind: "command" | "file";
      reason: string | null;
    }) => void)
  | null = null;
let userInputRequestListener:
  | ((payload: {
      conversationId: string;
      requestId: string;
      turnId: string;
      questionCount: number;
      firstQuestion: string | null;
    }) => void)
  | null = null;
const startTurnCalls: Array<[string, string]> = [];
const respondApprovalCalls: Array<[string, string, string | null]> = [];

const mockManager = {
  addTurnCompletedListener(listener: NonNullable<typeof turnCompletedListener>) {
    turnCompletedListener = listener;
    return () => {
      if (turnCompletedListener === listener) {
        turnCompletedListener = null;
      }
    };
  },
  addApprovalRequestListener(listener: NonNullable<typeof approvalRequestListener>) {
    approvalRequestListener = listener;
    return () => {
      if (approvalRequestListener === listener) {
        approvalRequestListener = null;
      }
    };
  },
  addUserInputRequestListener(listener: NonNullable<typeof userInputRequestListener>) {
    userInputRequestListener = listener;
    return () => {
      if (userInputRequestListener === listener) {
        userInputRequestListener = null;
      }
    };
  },
  readConversation(threadId: string) {
    if (threadId === "thread-system") {
      return {
        threadName: "Internal helper",
        threadSource: "system",
        source: null,
      };
    }
    if (threadId === "thread-1") {
      return {
        threadName: "Ship notifications",
        threadSource: null,
        source: null,
      };
    }
    return null;
  },
  readThreadSummary(threadId: string) {
    return {
      threadId,
      projectId: "project-1",
      threadName: "Summary title",
      threadSource: null,
      source: null,
    };
  },
  async startTurn(threadId: string, prompt: string) {
    startTurnCalls.push([threadId, prompt]);
    return null;
  },
  async respondApproval(requestId: string, decision: string, conversationId: string | null) {
    respondApprovalCalls.push([requestId, decision, conversationId]);
    return true;
  },
};

mock.module("./desktop-notification-controller-deps", () => ({
  invoke: async (channel: string, ...args: unknown[]) => {
    invokeCalls.push([channel, ...args]);
    if (channel === "electron-window:focus:get") {
      return currentFocusState;
    }
    return null;
  },
  getWindowFocusState: async () => currentFocusState,
  subscribeDesktopNotificationActions: (listener: NonNullable<typeof desktopNotificationActionListener>) => {
    desktopNotificationActionListener = listener;
    return () => {
      if (desktopNotificationActionListener === listener) {
        desktopNotificationActionListener = null;
      }
    };
  },
  subscribeWindowFocusChanges: (listener: (isFocused: boolean) => void) => {
    windowFocusChangeListener = listener;
    return () => {
      if (windowFocusChangeListener === listener) {
        windowFocusChangeListener = null;
      }
    };
  },
  useThreadNotificationSettings: () => ({
    settings: threadNotificationSettings,
    isLoading: false,
    updateSettings: async () => threadNotificationSettings,
    reloadSettings: async () => undefined,
  }),
  useDefaultCodexAppServerManager: () => mockManager,
}));

function resetTestState(): void {
  invokeCalls.length = 0;
  currentFocusState = true;
  desktopNotificationActionListener = null;
  windowFocusChangeListener = null;
  threadNotificationSettings = {
    turnMode: "unfocused",
    permissionsEnabled: true,
    questionsEnabled: true,
  };
  turnCompletedListener = null;
  approvalRequestListener = null;
  userInputRequestListener = null;
  startTurnCalls.length = 0;
  respondApprovalCalls.length = 0;
}

describe("DesktopNotificationController", () => {
  test("shows turn-complete notifications when the window is unfocused and shapes the payload", async () => {
    resetTestState();
    currentFocusState = false;
    const { DesktopNotificationController } = await import("./desktop-notification-controller");

    render(createElement(DesktopNotificationController, {
      activeThreadId: "thread-2",
      focusedStage: "cards",
      threadsProjectId: "project-default",
      onOpenThread: () => undefined,
    }));
    await settleAsyncRender();

    turnCompletedListener?.({
      conversationId: "thread-1",
      turnId: "turn-1",
      status: "completed",
      lastAgentMessage: "::code-comment{title=\"One\" body=\"Issue\" file=\"/tmp/a.ts\"}",
      heartbeatAssistantMessage: null,
      hasPendingContinuation: false,
    });
    await settleAsyncRender();

    const hideCall = invokeCalls.find((call) => call[0] === "desktop-notification:hide");
    expect(hideCall?.[1]).toBe("thread-2");

    const showCall = invokeCalls.find((call) => call[0] === "desktop-notification:show");
    const payload = showCall?.[1] as {
      id: string;
      kind: string;
      title: string;
      body: string;
      conversationId: string;
      replyPlaceholder?: string;
    } | undefined;
    expect(payload?.id).toBe("turn-turn-1");
    expect(payload?.kind).toBe("turn-complete");
    expect(payload?.title).toBe("Ship notifications");
    expect(payload?.body).toBe("Code review finished. 1 finding.");
    expect(payload?.conversationId).toBe("thread-1");
    expect(payload?.replyPlaceholder).toBe("Reply to Codex");
  });

  test("suppresses approval and question notifications for the focused conversation but still allows turn-complete in always mode", async () => {
    resetTestState();
    currentFocusState = true;
    threadNotificationSettings = {
      turnMode: "always",
      permissionsEnabled: true,
      questionsEnabled: true,
    };
    const { DesktopNotificationController } = await import("./desktop-notification-controller");

    render(createElement(DesktopNotificationController, {
      activeThreadId: "thread-1",
      focusedStage: "threads",
      threadsProjectId: "project-default",
      onOpenThread: () => undefined,
    }));
    await settleAsyncRender();

    approvalRequestListener?.({
      conversationId: "thread-1",
      requestId: "approval-1",
      kind: "command",
      reason: "Need approval",
    });
    userInputRequestListener?.({
      conversationId: "thread-1",
      requestId: "question-1",
      turnId: "turn-1",
      questionCount: 2,
      firstQuestion: "Continue?",
    });
    turnCompletedListener?.({
      conversationId: "thread-1",
      turnId: "turn-2",
      status: "completed",
      lastAgentMessage: "All done",
      heartbeatAssistantMessage: null,
      hasPendingContinuation: false,
    });
    await settleAsyncRender();

    const showCalls = invokeCalls.filter((call) => call[0] === "desktop-notification:show");
    expect(String(showCalls.length)).toBe("1");
    const payload = showCalls[0]?.[1] as { kind?: string; body?: string } | undefined;
    expect(payload?.kind).toBe("turn-complete");
    expect(payload?.body).toBe("All done");
  });

  test("uses heartbeat decisions and pending continuation to resolve turn-complete notifications", async () => {
    resetTestState();
    currentFocusState = false;
    const { DesktopNotificationController } = await import("./desktop-notification-controller");

    render(createElement(DesktopNotificationController, {
      activeThreadId: "thread-2",
      focusedStage: "cards",
      threadsProjectId: "project-default",
      onOpenThread: () => undefined,
    }));
    await settleAsyncRender();

    turnCompletedListener?.({
      conversationId: "thread-1",
      turnId: "turn-pending",
      status: "completed",
      lastAgentMessage: "Queued follow-up will continue.",
      heartbeatAssistantMessage: null,
      hasPendingContinuation: true,
    });
    turnCompletedListener?.({
      conversationId: "thread-1",
      turnId: "turn-muted",
      status: "completed",
      lastAgentMessage: "No alert.<heartbeat><decision>DONT_NOTIFY</decision></heartbeat>",
      heartbeatAssistantMessage: {
        decision: "DONT_NOTIFY",
        visibleText: "No alert.",
        notificationMessage: null,
      },
      hasPendingContinuation: false,
    });
    turnCompletedListener?.({
      conversationId: "thread-1",
      turnId: "turn-heartbeat",
      status: "completed",
      lastAgentMessage: "Visible body",
      heartbeatAssistantMessage: {
        decision: "NOTIFY",
        visibleText: "Visible body",
        notificationMessage: "Explicit heartbeat body",
      },
      hasPendingContinuation: false,
    });
    await settleAsyncRender();

    const showCalls = invokeCalls.filter((call) => call[0] === "desktop-notification:show");
    expect(String(showCalls.length)).toBe("1");
    const payload = showCalls[0]?.[1] as { id?: string; body?: string } | undefined;
    expect(payload?.id).toBe("turn-turn-heartbeat");
    expect(payload?.body).toBe("Explicit heartbeat body");
  });

  test("suppresses approval and question notifications for system conversations", async () => {
    resetTestState();
    currentFocusState = false;
    const { DesktopNotificationController } = await import("./desktop-notification-controller");

    render(createElement(DesktopNotificationController, {
      activeThreadId: "thread-2",
      focusedStage: "cards",
      threadsProjectId: "project-default",
      onOpenThread: () => undefined,
    }));
    await settleAsyncRender();

    approvalRequestListener?.({
      conversationId: "thread-system",
      requestId: "approval-system",
      kind: "command",
      reason: "Internal approval",
    });
    userInputRequestListener?.({
      conversationId: "thread-system",
      requestId: "question-system",
      turnId: "turn-system",
      questionCount: 1,
      firstQuestion: "Internal question?",
    });
    await settleAsyncRender();

    const showCalls = invokeCalls.filter((call) => call[0] === "desktop-notification:show");
    expect(String(showCalls.length)).toBe("0");
  });

  test("routes reply and approval actions back through thread navigation and manager methods", async () => {
    resetTestState();
    currentFocusState = false;
    const openThreadCalls: Array<[string, string]> = [];
    const { DesktopNotificationController } = await import("./desktop-notification-controller");

    render(createElement(DesktopNotificationController, {
      activeThreadId: "thread-2",
      focusedStage: "cards",
      threadsProjectId: "project-default",
      onOpenThread: (projectId: string, threadId: string) => {
        openThreadCalls.push([projectId, threadId]);
      },
    }));
    await settleAsyncRender();

    desktopNotificationActionListener?.({
      notificationId: "turn-turn-1",
      actionId: null,
      actionType: "reply",
      reply: "Ship the change",
      conversationId: "thread-1",
      requestId: null,
    });
    await settleAsyncRender();

    desktopNotificationActionListener?.({
      notificationId: "approval-1",
      actionId: "approve-session",
      actionType: "approve-for-session",
      conversationId: "thread-1",
      requestId: "request-1",
    });
    await settleAsyncRender();

    expect(openThreadCalls[0]?.[0]).toBe("project-1");
    expect(openThreadCalls[0]?.[1]).toBe("thread-1");
    expect(startTurnCalls[0]?.[0]).toBe("thread-1");
    expect(startTurnCalls[0]?.[1]).toBe("Ship the change");
    expect(openThreadCalls[1]?.[1]).toBe("thread-1");
    expect(respondApprovalCalls[0]?.[0]).toBe("request-1");
    expect(respondApprovalCalls[0]?.[1]).toBe("acceptForSession");
    expect(respondApprovalCalls[0]?.[2]).toBe("thread-1");
  });
});
