import type {
  DesktopNotificationActionInvocation,
  DesktopNotificationActionPayload,
  DesktopNotificationHideSelector,
  DesktopNotificationPayload,
  ThreadNotificationSettings,
} from "../../shared/types";
import { DEFAULT_CODEX_HOST_ID } from "../../shared/codex-host";
import {
  buildCodexApprovalNotificationId,
  buildCodexQuestionNotificationId,
  buildCodexRequestNotificationOccurrenceId,
  buildCodexTurnNotificationId,
  buildCodexTurnNotificationOccurrenceId,
  decideCodexRequestNotification,
  decideCodexTurnNotification,
  resolveCodexApprovalNotificationCopy,
  resolveCodexQuestionNotificationBody,
  resolveCodexQuestionNotificationTitle,
  resolveCodexTurnNotificationBody,
  resolveCodexTurnNotificationTitle,
  type CodexThreadNotificationEvent,
} from "../../shared/codex-thread-notification";

const APPROVAL_ACTIONS = [
  { id: "approve", title: "Approve", actionType: "approve" },
  {
    id: "approve-session",
    title: "Approve for session",
    actionType: "approve-for-session",
  },
  { id: "decline", title: "Decline", actionType: "decline" },
] as const;

export interface CodexThreadNotificationEventSource {
  addThreadNotificationListener(
    listener: (event: CodexThreadNotificationEvent) => void,
  ): () => void;
  addRendererConversationPresentedInForegroundListener(
    listener: (conversationId: string) => void,
  ): () => void;
}

export interface CodexThreadNotificationCoordinatorOptions {
  source: CodexThreadNotificationEventSource;
  getSettings: () => ThreadNotificationSettings;
  isAppForegrounded: () => boolean;
  isConversationPresentedInForeground: (conversationId: string) => boolean;
  resolveTargetClientId: (conversationId: string) => string | null;
  showNotification: (
    notification: DesktopNotificationPayload,
    targetClientId: string,
    onAction: (action: DesktopNotificationActionPayload) => void,
  ) => void;
  dismissNotification: (selector: DesktopNotificationHideSelector) => void;
  dispatchAction: (
    targetClientId: string,
    action: DesktopNotificationActionInvocation,
  ) => boolean;
  focusTargetClient: (targetClientId: string) => void;
  logger?: Pick<Console, "debug" | "warn">;
}

function resolveNavigation(event: Exclude<
  CodexThreadNotificationEvent,
  { type: "request-resolved" }
>): {
  navigationPath: string;
  activateTabId: string | null;
} {
  const parentPath = event.conversation.sideConversationParentNavigationPath?.trim() ?? "";
  if (parentPath.length > 0) {
    return {
      navigationPath: parentPath,
      activateTabId: `sidechat:${event.conversation.conversationId}`,
    };
  }
  return {
    navigationPath: `thread:${event.conversation.conversationId}`,
    activateTabId: null,
  };
}

export class CodexThreadNotificationCoordinator {
  private readonly options: CodexThreadNotificationCoordinatorOptions;
  private readonly disposers: Array<() => void>;

  constructor(options: CodexThreadNotificationCoordinatorOptions) {
    this.options = options;
    this.disposers = [
      options.source.addThreadNotificationListener((event) => {
        this.handleEvent(event);
      }),
      options.source.addRendererConversationPresentedInForegroundListener(
        (conversationId) => {
          options.dismissNotification({ conversationId });
        },
      ),
    ];
  }

  dispose(): void {
    for (const dispose of this.disposers.splice(0)) dispose();
  }

  private handleEvent(event: CodexThreadNotificationEvent): void {
    if (event.type === "request-resolved") {
      this.options.dismissNotification({
        occurrenceId: buildCodexRequestNotificationOccurrenceId(
          "approval",
          event.hostId,
          event.conversationId,
          event.requestId,
        ),
      });
      this.options.dismissNotification({
        occurrenceId: buildCodexRequestNotificationOccurrenceId(
          "question",
          event.hostId,
          event.conversationId,
          event.requestId,
        ),
      });
      return;
    }

    const settings = this.options.getSettings();
    if (event.type === "turn-completed") {
      const decision = decideCodexTurnNotification(event, {
        turnMode: settings.turnMode,
        isAppForegrounded: this.options.isAppForegrounded(),
        includeTurnNotifications: event.hostId === DEFAULT_CODEX_HOST_ID,
      });
      if (decision.type === "suppress") {
        this.options.logger?.debug("[desktop-notifications] suppressed", {
          type: event.type,
          conversationId: event.conversation.conversationId,
          reason: decision.reason,
        });
        return;
      }
      this.show(event, {
        id: buildCodexTurnNotificationId(event.turnId),
        occurrenceId: buildCodexTurnNotificationOccurrenceId(
          event.hostId,
          event.conversation.conversationId,
          event.turnId,
        ),
        kind: "turn-complete",
        title: resolveCodexTurnNotificationTitle(event.conversation.title),
        body: resolveCodexTurnNotificationBody(event),
        replyPlaceholder: "Reply to Nodex",
      });
      return;
    }

    const enabled = event.type === "approval-requested"
      ? settings.permissionsEnabled
      : settings.questionsEnabled;
    const decision = decideCodexRequestNotification(event.conversation, {
      enabled,
      isConversationPresentedInForeground:
        this.options.isConversationPresentedInForeground(
          event.conversation.conversationId,
        ),
    });
    if (decision.type === "suppress") {
      this.options.logger?.debug("[desktop-notifications] suppressed", {
        type: event.type,
        conversationId: event.conversation.conversationId,
        reason: decision.reason,
      });
      return;
    }

    if (event.type === "approval-requested") {
      const copy = resolveCodexApprovalNotificationCopy(event);
      this.show(event, {
        id: buildCodexApprovalNotificationId(event.hostId, event.requestId),
        occurrenceId: buildCodexRequestNotificationOccurrenceId(
          "approval",
          event.hostId,
          event.conversation.conversationId,
          event.requestId,
        ),
        kind: "permission",
        title: copy.title,
        body: copy.body,
        ...(copy.hasActions ? { actions: [...APPROVAL_ACTIONS] } : {}),
      });
      return;
    }

    this.show(event, {
      id: buildCodexQuestionNotificationId(event.hostId, event.requestId),
      occurrenceId: buildCodexRequestNotificationOccurrenceId(
        "question",
        event.hostId,
        event.conversation.conversationId,
        event.requestId,
      ),
      kind: "question",
      title: resolveCodexQuestionNotificationTitle(event.conversation.title),
      body: resolveCodexQuestionNotificationBody(event.questionCount),
    });
  }

  private show(
    event: Exclude<CodexThreadNotificationEvent, { type: "request-resolved" }>,
    copy: Pick<
      DesktopNotificationPayload,
      | "id"
      | "occurrenceId"
      | "kind"
      | "title"
      | "body"
      | "actions"
      | "replyPlaceholder"
    >,
  ): void {
    const conversationId = event.conversation.conversationId;
    const targetClientId = this.options.resolveTargetClientId(conversationId);
    if (!targetClientId) {
      this.options.logger?.warn("[desktop-notifications] dropped", {
        conversationId,
        reason: "no-live-target",
        type: event.type,
      });
      return;
    }
    const navigation = resolveNavigation(event);
    const notification: DesktopNotificationPayload = {
      ...copy,
      hostId: event.hostId,
      conversationId,
      navigationPath: navigation.navigationPath,
      activateTabId: navigation.activateTabId,
      ...(event.type === "approval-requested" || event.type === "user-input-requested"
        ? { requestId: event.requestId }
        : {}),
    };

    this.options.showNotification(notification, targetClientId, (action) => {
      if (action.actionType === "open") {
        this.options.focusTargetClient(targetClientId);
      }
      const dispatched = this.options.dispatchAction(targetClientId, {
        ...action,
        hostId: event.hostId,
        conversationId,
        navigationPath: navigation.navigationPath,
        activateTabId: navigation.activateTabId,
        requestId:
          event.type === "approval-requested" || event.type === "user-input-requested"
            ? event.requestId
            : null,
      });
      if (!dispatched) {
        this.options.dismissNotification(
          notification.occurrenceId
            ? { occurrenceId: notification.occurrenceId }
            : { notificationId: notification.id },
        );
      }
    });
  }
}
