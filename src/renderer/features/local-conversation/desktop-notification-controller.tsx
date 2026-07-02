import {
  useEffect,
  useEffectEvent,
  useState,
} from "react";
import {
  getWindowFocusState,
  invoke,
  subscribeDesktopNotificationActions,
  subscribeWindowFocusChanges,
  useDefaultCodexAppServerManager,
  useThreadNotificationSettings,
} from "./desktop-notification-controller-deps";
import type {
  DesktopNotificationPayload,
  ThreadNotificationTurnMode,
} from "../../lib/types";
import { NEW_THREAD_STAGE_TAB_ID, type StageId } from "../../lib/use-workbench-state";

const APPROVAL_NOTIFICATION_ACTIONS = [
  {
    id: "approve",
    title: "Approve",
    actionType: "approve",
  },
  {
    id: "approve-session",
    title: "Approve for session",
    actionType: "approve-for-session",
  },
  {
    id: "decline",
    title: "Decline",
    actionType: "decline",
  },
] as const;

function normalizeNotificationText(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : null;
}

function summarizeCodeReviewFindings(message: string): string | null {
  const findings = message.match(/::code-comment\{/g)?.length ?? 0;
  if (findings <= 0) {
    return null;
  }
  if (findings === 1) {
    return "Code review finished. 1 finding.";
  }
  return `Code review finished. ${findings} findings.`;
}

function buildTurnCompleteBody(lastAgentMessage: string | null): string {
  const normalized = normalizeNotificationText(lastAgentMessage);
  if (!normalized) {
    return "Codex finished a turn.";
  }

  return summarizeCodeReviewFindings(normalized) ?? normalized;
}

function buildQuestionBody(questionCount: number): string {
  if (questionCount > 1) {
    return `Answer ${questionCount} questions to proceed.`;
  }
  if (questionCount === 1) {
    return "Answer 1 question to proceed.";
  }
  return "Answer a question to proceed.";
}

function probeNotificationPermission(): void {
  try {
    if (typeof Notification === "undefined") {
      return;
    }
    if (Notification.permission === "default" && Notification.requestPermission) {
      void Notification.requestPermission();
    }
  } catch {
    // Ignore browser Notification API probing failures.
  }
}

export function DesktopNotificationController({
  activeThreadId,
  focusedStage,
  threadsProjectId,
  onOpenThread,
}: {
  activeThreadId: string;
  focusedStage: StageId;
  threadsProjectId: string;
  onOpenThread: (projectId: string, threadId: string) => void;
}) {
  const manager = useDefaultCodexAppServerManager();
  const { settings } = useThreadNotificationSettings();
  const [isWindowFocused, setIsWindowFocused] = useState(true);

  useEffect(() => {
    probeNotificationPermission();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getWindowFocusState().then((nextFocused) => {
      if (!cancelled) {
        setIsWindowFocused(nextFocused);
      }
    });
    const unsubscribe = subscribeWindowFocusChanges((nextFocused) => {
      setIsWindowFocused(nextFocused);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (activeThreadId === NEW_THREAD_STAGE_TAB_ID) {
      return;
    }
    void invoke("desktop-notification:hide", activeThreadId);
  }, [activeThreadId]);

  const isSameFocusedConversation = useEffectEvent((conversationId: string): boolean => {
    return (
      focusedStage === "threads"
      && activeThreadId !== NEW_THREAD_STAGE_TAB_ID
      && activeThreadId === conversationId
      && isWindowFocused
    );
  });

  const shouldSuppressTurnComplete = useEffectEvent((conversationId: string, turnMode: ThreadNotificationTurnMode): boolean => {
    void conversationId;
    if (turnMode === "off") {
      return true;
    }
    return turnMode === "unfocused" && isWindowFocused;
  });

  const showNotification = useEffectEvent((notification: DesktopNotificationPayload) => {
    void invoke("desktop-notification:show", notification);
  });

  useEffect(() => {
    const stopTurnCompleted = manager.addTurnCompletedListener((payload) => {
      if (shouldSuppressTurnComplete(payload.conversationId, settings.turnMode)) {
        return;
      }

      const conversation = manager.readConversation(payload.conversationId);
      const summary = manager.readThreadSummary(payload.conversationId);
      showNotification({
        id: `turn-${payload.turnId}`,
        kind: "turn-complete",
        title:
          normalizeNotificationText(conversation?.threadName ?? summary?.threadName)
          ?? "Turn complete",
        body: buildTurnCompleteBody(payload.lastAgentMessage),
        conversationId: payload.conversationId,
        replyPlaceholder: "Reply to Codex",
      });
    });

    const stopApprovalRequests = manager.addApprovalRequestListener((payload) => {
      if (!settings.permissionsEnabled || isSameFocusedConversation(payload.conversationId)) {
        return;
      }

      showNotification({
        id: `approval-${payload.requestId}`,
        kind: "permission",
        title: payload.kind === "command" ? "Command approval" : "File edit approval",
        body: normalizeNotificationText(payload.reason) ?? "Approval required",
        conversationId: payload.conversationId,
        requestId: payload.requestId,
        actions: [...APPROVAL_NOTIFICATION_ACTIONS],
      });
    });

    const stopUserInputRequests = manager.addUserInputRequestListener((payload) => {
      if (!settings.questionsEnabled || isSameFocusedConversation(payload.conversationId)) {
        return;
      }

      const conversation = manager.readConversation(payload.conversationId);
      const summary = manager.readThreadSummary(payload.conversationId);
      showNotification({
        id: `question-${payload.requestId}`,
        kind: "question",
        title:
          normalizeNotificationText(conversation?.threadName ?? summary?.threadName)
          ?? "Need your input",
        body: buildQuestionBody(payload.questionCount),
        conversationId: payload.conversationId,
        requestId: payload.requestId,
      });
    });

    return () => {
      stopTurnCompleted();
      stopApprovalRequests();
      stopUserInputRequests();
    };
  }, [isSameFocusedConversation, manager, settings.permissionsEnabled, settings.questionsEnabled, settings.turnMode, shouldSuppressTurnComplete, showNotification]);

  const handleOpenThread = useEffectEvent((threadId: string) => {
    const summary = manager.readThreadSummary(threadId);
    onOpenThread(summary?.projectId ?? threadsProjectId, threadId);
  });

  const handleAction = useEffectEvent(async (payload: {
    notificationId: string;
    actionId: string | null;
    actionType: "open" | "reply" | "approve" | "approve-for-session" | "decline";
    reply?: string;
    conversationId: string | null;
    requestId: string | null;
  }) => {
    void payload.notificationId;
    void payload.actionId;
    const conversationId = payload.conversationId ?? null;
    const requestId = payload.requestId ?? null;

    if (conversationId && payload.actionType !== "open") {
      handleOpenThread(conversationId);
    }

    if (payload.actionType === "open") {
      if (conversationId) {
        handleOpenThread(conversationId);
      }
      return;
    }

    if (payload.actionType === "reply") {
      const reply = normalizeNotificationText(payload.reply);
      if (!conversationId || !reply) {
        return;
      }
      await manager.startTurn(conversationId, reply);
      return;
    }

    if (!requestId) {
      return;
    }

    const decision =
      payload.actionType === "approve"
        ? "accept"
        : payload.actionType === "approve-for-session"
          ? "acceptForSession"
          : payload.actionType === "decline"
            ? "decline"
            : null;
    if (!decision) {
      return;
    }

    await manager.respondApproval(requestId, decision, conversationId);
  });

  useEffect(() => {
    return subscribeDesktopNotificationActions((payload) => {
      void handleAction(payload).catch(() => {
        // Notification actions should fail closed; the thread remains available in the UI.
      });
    });
  }, [handleAction]);

  return null;
}
