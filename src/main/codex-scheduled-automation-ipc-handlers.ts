import * as codexAutomationRunsStore from "./local-store/codex-automation-runs";
import * as codexScheduledAutomationsStore from "./local-store/codex-scheduled-automations";
import type { IpcApi } from "../shared/ipc-api";
import type {
  CodexAutomationRunsUpdatedEvent,
  CodexHeartbeatAutomationThreadStateChangedInput,
  CodexHeartbeatAutomationsEnabledChangedInput,
  CodexScheduledAutomationRunNowInput,
} from "../shared/types";

export type CodexScheduledAutomationIpcChannel =
  | "codex:scheduled-automations:list"
  | "codex:scheduled-automations:create"
  | "codex:scheduled-automations:update"
  | "codex:scheduled-automations:delete"
  | "codex:scheduled-automations:run-now"
  | "codex:scheduled-automations:heartbeat-enabled-changed"
  | "codex:scheduled-automations:heartbeat-thread-state-changed"
  | "codex:automation-runs:archive"
  | "codex:automation-runs:delete"
  | "codex:automation-runs:unarchive"
  | "codex:automation-runs:inbox-items"
  | "codex:automation-runs:set-read-state"
  | "codex:automation-runs:mark-all-read";

export type CodexScheduledAutomationIpcHandler<Channel extends CodexScheduledAutomationIpcChannel> = (
  event: unknown,
  ...args: IpcApi[Channel]["args"]
) => IpcApi[Channel]["result"] | Promise<IpcApi[Channel]["result"]>;

export interface CodexScheduledAutomationIpcRegistration {
  registerHandle: <Channel extends CodexScheduledAutomationIpcChannel>(
    channel: Channel,
    listener: CodexScheduledAutomationIpcHandler<Channel>,
  ) => void;
  runScheduledAutomationNow: (input: CodexScheduledAutomationRunNowInput) => Promise<void>;
  captureAutomationArchiveMessages: (threadId: string) => Promise<boolean>;
  unarchiveThread: (threadId: string) => Promise<unknown>;
  broadcastScheduledAutomationChanged: (
    automationId: string,
    targetThreadId: string | null,
    reason: "upsert" | "delete",
  ) => void;
  broadcastAutomationRunsUpdated: (event: CodexAutomationRunsUpdatedEvent) => void;
  onHeartbeatAutomationsEnabledChanged?: (input: CodexHeartbeatAutomationsEnabledChangedInput) => void;
  onHeartbeatAutomationThreadStateChanged?: (input: CodexHeartbeatAutomationThreadStateChangedInput) => void;
}

export function registerCodexScheduledAutomationIpcHandlers(
  options: CodexScheduledAutomationIpcRegistration,
): void {
  const broadcastAutomationRunChanged = (
    event: CodexAutomationRunsUpdatedEvent,
    eventOptions: { refreshAutomationList?: boolean } = {},
  ) => {
    options.broadcastAutomationRunsUpdated(event);
    if (eventOptions.refreshAutomationList === false || !event.automationId) return;
    options.broadcastScheduledAutomationChanged(event.automationId, null, "upsert");
  };

  options.registerHandle("codex:scheduled-automations:list", () => ({
    items: codexScheduledAutomationsStore.listCodexScheduledAutomations(),
  }));

  options.registerHandle("codex:scheduled-automations:create", (_, input) => {
    const automation = codexScheduledAutomationsStore.createCodexScheduledAutomation(input);
    options.broadcastScheduledAutomationChanged(automation.id, automation.targetThreadId, "upsert");
    return { item: automation };
  });

  options.registerHandle("codex:scheduled-automations:update", (_, input) => {
    const automation = codexScheduledAutomationsStore.updateCodexScheduledAutomation(input);
    if (!automation) throw new Error("Scheduled automation update failed.");
    options.broadcastScheduledAutomationChanged(automation.id, automation.targetThreadId, "upsert");
    return { item: automation };
  });

  options.registerHandle("codex:scheduled-automations:delete", (_, input) => {
    const existing = codexScheduledAutomationsStore.getCodexScheduledAutomation(input.id);
    const result = codexScheduledAutomationsStore.deleteCodexScheduledAutomationWithStatus(input.id);
    const success = result.status === "deleted" || result.status === "not_found";
    if (success) {
      const deletedRunCount = codexAutomationRunsStore.deleteCodexAutomationRunsForAutomation(input.id);
      if (deletedRunCount > 0) {
        options.broadcastAutomationRunsUpdated({
          automationId: existing?.id ?? input.id,
          threadId: null,
          reason: "delete",
        });
      }
      options.broadcastScheduledAutomationChanged(existing?.id ?? input.id, existing?.targetThreadId ?? null, "delete");
    }
    return {
      item: existing,
      success,
      status: result.status,
    };
  });

  options.registerHandle("codex:scheduled-automations:run-now", async (_, input) => {
    await options.runScheduledAutomationNow(input);
    return { success: true };
  });

  options.registerHandle("codex:scheduled-automations:heartbeat-enabled-changed", (_, input) => {
    options.onHeartbeatAutomationsEnabledChanged?.(input);
    return { success: true };
  });

  options.registerHandle("codex:scheduled-automations:heartbeat-thread-state-changed", (_, input) => {
    options.onHeartbeatAutomationThreadStateChanged?.(input);
    return { success: true };
  });

  options.registerHandle("codex:automation-runs:archive", async (_, input) => {
    const run = codexAutomationRunsStore.getCodexAutomationRun(input.threadId);
    let capturedMessages = false;
    if (input.archivedAssistantMessage != null || input.archivedUserMessage != null) {
      capturedMessages = codexAutomationRunsStore.captureCodexAutomationArchiveMessages({
        threadId: input.threadId,
        archivedAssistantMessage: input.archivedAssistantMessage,
        archivedUserMessage: input.archivedUserMessage,
      });
    } else {
      capturedMessages = await options.captureAutomationArchiveMessages(input.threadId);
    }

    const success = codexAutomationRunsStore.archiveCodexAutomationRun(input.threadId, input.archivedReason);
    if (run && (success || capturedMessages)) {
      broadcastAutomationRunChanged({
        automationId: run.automationId,
        threadId: input.threadId,
        reason: "archive",
      });
    }
    return {
      success,
    };
  });

  options.registerHandle("codex:automation-runs:delete", (_, input) => {
    const run = codexAutomationRunsStore.getCodexAutomationRun(input.threadId);
    const success = codexAutomationRunsStore.deleteCodexAutomationRun(input.threadId);
    if (success && run) {
      broadcastAutomationRunChanged({
        automationId: run.automationId,
        threadId: input.threadId,
        reason: "delete",
      });
    }
    return { success };
  });

  options.registerHandle("codex:automation-runs:unarchive", async (_, input) => {
    const run = codexAutomationRunsStore.getCodexAutomationRun(input.threadId);
    await options.unarchiveThread(input.threadId);
    const success = codexAutomationRunsStore.unarchiveCodexAutomationRun(input.threadId);
    if (success && run) {
      broadcastAutomationRunChanged({
        automationId: run.automationId,
        threadId: input.threadId,
        reason: "unarchive",
      });
    }
    return { success };
  });

  options.registerHandle("codex:automation-runs:inbox-items", (_, limit) => ({
    items: codexAutomationRunsStore.listCodexAutomationInboxItems(limit ?? 200),
    unreadRunCounts: codexAutomationRunsStore.getCodexAutomationRunUnreadCounts(),
  }));

  options.registerHandle("codex:automation-runs:set-read-state", (_, input) => {
    const item = codexAutomationRunsStore.setCodexAutomationRunReadAt(input.threadId, input.readAt);
    if (item) {
      broadcastAutomationRunChanged({
        automationId: item.automationId,
        threadId: input.threadId,
        reason: "read-state",
      });
    }
    return item;
  });

  options.registerHandle("codex:automation-runs:mark-all-read", (_, input) => {
    const changedCount = codexAutomationRunsStore.markAllCodexAutomationRunsRead(input.readAt);
    if (changedCount > 0) {
      options.broadcastAutomationRunsUpdated({
        automationId: null,
        threadId: null,
        reason: "mark-all-read",
      });
    }
    return { changedCount };
  });
}
