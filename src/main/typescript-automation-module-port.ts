import { randomUUID } from "node:crypto";

import * as runsStore from "./local-store/codex-automation-runs";
import * as definitionsStore from "./local-store/codex-scheduled-automations";
import { blockMutationWriter } from "./block-mutation-writer";
import { listPageOccurrences } from "./local-store/page-occurrences";
import { snoozeReminder } from "./local-store/reminders";
import type {
  DesktopAutomationClaim,
  DesktopAutomationModulePort,
} from "./core-client/desktop-automation-module-bridge";

export function createTypeScriptAutomationModulePort(): DesktopAutomationModulePort {
  const claims = new Map<string, DesktopAutomationClaim>();
  return {
    peekRunAutomationId: (threadId) =>
      runsStore.getCodexAutomationRun(threadId)?.automationId ?? null,
    peekActiveHeartbeatAutomationId: (threadId) =>
      definitionsStore.listCodexScheduledAutomations().find((definition) =>
        definition.kind === "heartbeat"
        && definition.status === "ACTIVE"
        && definition.targetThreadId === threadId
      )?.id ?? null,
    listDefinitions: async () =>
      definitionsStore.listCodexScheduledAutomations(),
    getDefinition: async (id) =>
      definitionsStore.getCodexScheduledAutomation(id),
    createDefinition: async (input) =>
      definitionsStore.createCodexScheduledAutomation(input),
    updateDefinition: async (input) =>
      definitionsStore.updateCodexScheduledAutomation(input),
    deleteDefinition: async (id) => {
      const existing = definitionsStore.getCodexScheduledAutomation(id);
      const result = definitionsStore.deleteCodexScheduledAutomationWithStatus(id);
      const success = result.status === "deleted" || result.status === "not_found";
      const deletedRunCount = success
        ? runsStore.deleteCodexAutomationRunsForAutomation(id)
        : 0;
      return {
        item: existing,
        success,
        status: result.status,
        deletedRunCount,
      };
    },
    dispatchDefinitionNow: async (id) =>
      definitionsStore.recordCodexScheduledAutomationRunDispatched(id),
    claimDueDefinitions: async (limit, leaseDurationMs) => {
      const now = Date.now();
      definitionsStore.reconcileCodexScheduledAutomations(now);
      return definitionsStore
        .listDueCodexScheduledAutomationRuns(now, limit)
        .map((definition) => {
          const dispatched =
            definitionsStore.recordCodexScheduledAutomationRunDispatched(
              definition.id,
              now,
            );
          if (!dispatched) {
            throw new Error("Scheduled Automation disappeared during dispatch");
          }
          const claim = {
            leaseId: `typescript:${randomUUID()}`,
            scheduledFor: definition.nextRunAt ?? now,
            attempt: 1,
            expiresAt: now + leaseDurationMs,
            definition: dispatched,
          };
          claims.set(claim.leaseId, claim);
          return claim;
        });
    },
    completeLease: async (leaseId) => {
      claims.delete(leaseId);
    },
    failLease: async (leaseId, retryDelayMs) => {
      const claim = claims.get(leaseId);
      claims.delete(leaseId);
      if (!claim || retryDelayMs === null) return;
      const now = Date.now();
      const retryAt = now + retryDelayMs;
      definitionsStore.recordCodexScheduledAutomationNextRun(
        claim.definition.id,
        claim.definition.nextRunAt === null
          ? retryAt
          : Math.min(claim.definition.nextRunAt, retryAt),
        now,
      );
    },
    settleInterruptedRuns: async () =>
      runsStore.settleInterruptedCodexAutomationRuns(),
    getRun: async (threadId) => runsStore.getCodexAutomationRun(threadId),
    beginRun: async (input) => runsStore.insertCodexAutomationRunInProgress(input),
    replacePendingRunThread: async (input) =>
      runsStore.replacePendingCodexAutomationRunThreadId(input),
    setRunThreadTitle: async (threadId, threadTitle) =>
      runsStore.setCodexAutomationRunThreadTitle(threadId, threadTitle),
    completeRunForReview: async (input) => {
      const review = runsStore.markCodexAutomationRunPendingReview(input.threadId);
      const inbox = runsStore.setCodexAutomationRunInboxItem(input);
      return review || inbox;
    },
    setRunInboxItem: async (input) =>
      runsStore.setCodexAutomationRunInboxItem(input),
    acceptRun: async (threadId) =>
      runsStore.markCodexAutomationRunAccepted(threadId),
    archiveRun: async (input, messages) => {
      runsStore.captureCodexAutomationArchiveMessages({
        threadId: input.threadId,
        archivedAssistantMessage: messages.archivedAssistantMessage,
        archivedUserMessage: messages.archivedUserMessage,
      });
      return runsStore.archiveCodexAutomationRun(
        input.threadId,
        input.archivedReason,
      );
    },
    deleteRun: async (threadId) => runsStore.deleteCodexAutomationRun(threadId),
    unarchiveRun: async (threadId) =>
      runsStore.unarchiveCodexAutomationRun(threadId),
    readInbox: async (limit) => ({
      items: runsStore.listCodexAutomationInboxItems(limit ?? 200),
      unreadRunCounts: runsStore.getCodexAutomationRunUnreadCounts(),
    }),
    setRunReadState: async (input) =>
      runsStore.setCodexAutomationRunReadAt(input.threadId, input.readAt),
    markAllRunsRead: async (input) =>
      runsStore.markAllCodexAutomationRunsRead(input.readAt),
    listPageOccurrences: async (
      projectId,
      windowStart,
      windowEnd,
      searchQuery,
    ) => listPageOccurrences(
      projectId,
      windowStart,
      windowEnd,
      searchQuery,
    ),
    completePageOccurrence: async (projectId, input, sessionId) =>
      (await blockMutationWriter.completePageOccurrence(
        projectId,
        input,
        sessionId,
      )).result,
    skipPageOccurrence: async (projectId, input, sessionId) =>
      (await blockMutationWriter.skipPageOccurrence(
        projectId,
        input,
        sessionId,
      )).result,
    updatePageOccurrence: async (projectId, input, sessionId) =>
      (await blockMutationWriter.updatePageOccurrence(
        projectId,
        input,
        sessionId,
      )).result,
    snoozeReminder,
    claimDueReminders: async () => {
      throw new Error("TypeScript reminder delivery remains scheduler-owned");
    },
    completeReminderLease: async () => {
      throw new Error("TypeScript reminder delivery remains scheduler-owned");
    },
    failReminderLease: async () => {
      throw new Error("TypeScript reminder delivery remains scheduler-owned");
    },
  };
}
