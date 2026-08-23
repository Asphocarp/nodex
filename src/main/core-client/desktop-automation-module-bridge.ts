import { createHash, randomUUID } from "node:crypto";

import type {
  CodexAutomationInboxItem,
  CodexAutomationRun,
  CodexAutomationRunArchiveInput,
  CodexAutomationRunMarkAllReadInput,
  CodexAutomationRunReadStateInput,
  CodexAutomationRunsInboxResponse,
  CodexScheduledAutomation,
  CodexScheduledAutomationCreateInput,
  CodexScheduledAutomationDeleteResponse,
  CodexScheduledAutomationUpdateInput,
  PageOccurrence,
  PageOccurrenceActionInput,
  PageOccurrenceCompleteInput,
  PageOccurrenceMutationResult,
  PageOccurrenceUpdateInput,
} from "../../shared/types";
import {
  finiteDateMilliseconds,
  projectAutomationDefinition as mapDefinition,
  projectAutomationInboxItem as mapInboxItem,
  projectAutomationRun as mapRun,
  projectPageOccurrence as mapOccurrence,
  requireAutomationDefinition as requireDefinition,
  requireAutomationRun as requireRun,
  slugifyAutomationName,
  toCoreAutomationDefinitionInput as toCoreDefinitionInput,
  toCoreOccurrenceSchedulePatch,
  type CoreAutomationDefinition,
  type CoreAutomationInboxItem,
  type CoreAutomationRun,
} from "../automation-application/AutomationProjection";
import type { DesktopDataAuthorityRuntime } from "./desktop-data-authority";
import {
  type CoreAuthorizedDeliveryAtom,
  type CoreClientPort,
  type CoreRequestOptions,
} from "./types";
import {
  projectCoreAutomationEvent,
  type CoreAutomationInvalidation,
} from "../core-runtime/CoreApplicationEventProjection";
import type { AutomationRoutingIndex } from "../core-runtime/AutomationRoutingIndex";

const BACKGROUND_CORE_REQUEST = { class: "background" } as const satisfies CoreRequestOptions;

type CoreAutomationIntent = Parameters<CoreClientPort["automationApply"]>[0]["intent"];

export interface AutomationArchiveMessages {
  readonly archivedUserMessage: string | null;
  readonly archivedAssistantMessage: string | null;
}

export interface DesktopAutomationDefinitionDeleteResult extends CodexScheduledAutomationDeleteResponse {
  readonly deletedRunCount: number;
}

export interface DesktopAutomationClaim {
  readonly leaseId: string;
  readonly scheduledFor: number;
  readonly attempt: number;
  readonly expiresAt: number;
  readonly definition: CodexScheduledAutomation;
}

export interface DesktopAutomationRunMutationInput {
  readonly threadId: string;
  readonly automationId: string;
  readonly threadTitle?: string | null;
  readonly sourceCwd?: string | null;
}

export interface DesktopReminderClaim {
  readonly leaseId: string;
  readonly projectId: string;
  readonly pageId: string;
  readonly occurrenceStart: number;
  readonly reminderOffsetMinutes: number;
  readonly dueAt: number;
  readonly title: string;
  readonly attempt: number;
  readonly expiresAt: number;
}

export interface DesktopPageOccurrenceWindow {
  readonly items: readonly PageOccurrence[];
  readonly nextCursor: string | null;
}

export type DesktopAutomationReadClass = "interactive" | "background";

export interface DesktopAutomationModulePort {
  listDefinitions(requestClass?: DesktopAutomationReadClass): Promise<CodexScheduledAutomation[]>;
  getDefinition(id: string): Promise<CodexScheduledAutomation | null>;
  createDefinition(input: CodexScheduledAutomationCreateInput): Promise<CodexScheduledAutomation>;
  updateDefinition(
    input: CodexScheduledAutomationUpdateInput,
  ): Promise<CodexScheduledAutomation | null>;
  deleteDefinition(id: string): Promise<DesktopAutomationDefinitionDeleteResult>;
  dispatchDefinitionNow(id: string): Promise<CodexScheduledAutomation | null>;
  rescheduleDefinition(
    id: string,
    expectedRevision: number,
    policy: {
      readonly notBefore?: number;
      readonly retryWithinMs?: number;
    },
  ): Promise<CodexScheduledAutomation | null>;
  claimDueDefinitions(limit: number, leaseDurationMs: number): Promise<DesktopAutomationClaim[]>;
  completeLease(leaseId: string): Promise<void>;
  failLease(leaseId: string, retryDelayMs: number | null, reasonCode: string): Promise<void>;
  settleInterruptedRuns(): Promise<{
    readonly archivedPendingCount: number;
    readonly pendingReviewCount: number;
  }>;
  getRun(threadId: string): Promise<CodexAutomationRun | null>;
  beginRun(input: DesktopAutomationRunMutationInput): Promise<boolean>;
  replacePendingRunThread(input: {
    readonly pendingThreadId: string;
    readonly threadId: string;
  }): Promise<boolean>;
  setRunThreadTitle(threadId: string, threadTitle: string | null): Promise<boolean>;
  completeRunForReview(input: {
    readonly threadId: string;
    readonly inboxTitle?: string | null;
    readonly inboxSummary?: string | null;
  }): Promise<boolean>;
  setRunInboxItem(input: {
    readonly threadId: string;
    readonly inboxTitle?: string | null;
    readonly inboxSummary?: string | null;
  }): Promise<boolean>;
  acceptRun(threadId: string): Promise<boolean>;
  archiveRun(
    input: CodexAutomationRunArchiveInput,
    messages: AutomationArchiveMessages,
  ): Promise<boolean>;
  deleteRun(threadId: string): Promise<boolean>;
  unarchiveRun(threadId: string): Promise<boolean>;
  readInbox(
    limit?: number,
    requestClass?: DesktopAutomationReadClass,
  ): Promise<CodexAutomationRunsInboxResponse>;
  setRunReadState(
    input: CodexAutomationRunReadStateInput,
  ): Promise<CodexAutomationInboxItem | null>;
  markAllRunsRead(input: CodexAutomationRunMarkAllReadInput): Promise<number>;
  listPageOccurrences(
    projectId: string,
    windowStart: Date,
    windowEnd: Date,
    searchQuery?: string,
    after?: string | null,
  ): Promise<DesktopPageOccurrenceWindow>;
  completePageOccurrence(
    projectId: string,
    input: PageOccurrenceCompleteInput,
    sessionId?: string,
  ): Promise<PageOccurrenceMutationResult>;
  skipPageOccurrence(
    projectId: string,
    input: PageOccurrenceActionInput,
    sessionId?: string,
  ): Promise<PageOccurrenceMutationResult>;
  updatePageOccurrence(
    projectId: string,
    input: PageOccurrenceUpdateInput,
    sessionId?: string,
  ): Promise<PageOccurrenceMutationResult>;
  snoozeReminder(
    projectId: string,
    pageId: string,
    occurrenceStart: string,
    snoozeMinutes: number,
  ): Promise<void>;
  claimDueReminders(limit: number, leaseDurationMs: number): Promise<DesktopReminderClaim[]>;
  completeReminderLease(leaseId: string): Promise<void>;
  failReminderLease(
    leaseId: string,
    retryDelayMs: number | null,
    reasonCode: string,
  ): Promise<void>;
}

export interface DesktopAutomationModuleBridgeInput {
  readonly authority: Promise<DesktopDataAuthorityRuntime>;
  readonly routing: Pick<AutomationRoutingIndex["Service"], "commit">;
}

export type { CoreAutomationInvalidation } from "../core-runtime/CoreApplicationEventProjection";

export function mapCoreAutomationEvent(
  effect: CoreAuthorizedDeliveryAtom,
): CoreAutomationInvalidation | null {
  return projectCoreAutomationEvent(effect);
}

const operationId = (kind: string): string => `electron:automation:${kind}:${randomUUID()}`;

const stableOperationId = (kind: string, payload: unknown): string => {
  const hash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  return `electron:automation:${kind}:${hash}`;
};

const createAutomationId = async (
  name: string,
  isAvailable: (candidate: string) => Promise<boolean>,
): Promise<string> => {
  const base = slugifyAutomationName(name) || "automation";
  for (let suffix = 1; suffix <= 20; suffix += 1) {
    const candidate = suffix === 1 ? base : `${base}-${suffix}`;
    if (await isAvailable(candidate)) return candidate;
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = `${base}-${randomUUID().slice(0, 8)}`;
    if (await isAvailable(candidate)) return candidate;
  }
  throw new Error("Unable to allocate a unique Scheduled Automation id");
};

const createCoreAutomationPort = (
  client: CoreClientPort,
  clientForProject: (projectId: string) => CoreClientPort,
  routing: Pick<AutomationRoutingIndex["Service"], "commit">,
): DesktopAutomationModulePort => {
  const readDefinition = async (automationId: string): Promise<CoreAutomationDefinition | null> => {
    const snapshot = await client.automationRead({
      kind: "definition",
      automation_id: automationId,
    });
    if (snapshot.value.kind !== "definition") {
      throw new Error("Core returned a non-Definition Automation read");
    }
    return snapshot.value.item ?? null;
  };
  const readRun = async (
    threadId: string,
    options?: CoreRequestOptions,
  ): Promise<CoreAutomationRun | null> => {
    const snapshot = await client.automationRead(
      {
        kind: "run",
        thread_id: threadId,
      },
      options,
    );
    if (snapshot.value.kind !== "run") {
      throw new Error("Core returned a non-Run Automation read");
    }
    return snapshot.value.item ?? null;
  };
  const applyRun = async (
    threadId: string,
    intent: (run: CoreAutomationRun) => Parameters<CoreClientPort["automationApply"]>[0]["intent"],
    options?: CoreRequestOptions,
  ): Promise<CoreAutomationRun | null> => {
    const run = await readRun(threadId, options);
    if (!run) return null;
    const requestedIntent = intent(run);
    const committed = await client.automationApply(
      {
        operationId: stableOperationId(`run:${threadId}`, requestedIntent),
        intent: requestedIntent,
      },
      options,
    );
    return requireRun(committed, threadId);
  };
  const applyPageOccurrence = async (
    projectId: string,
    operationId: string,
    intent: Extract<
      CoreAutomationIntent,
      {
        readonly kind:
          | "complete_page_occurrence"
          | "skip_page_occurrence"
          | "update_page_occurrence";
      }
    >,
  ): Promise<PageOccurrenceMutationResult> => {
    const committed = await clientForProject(projectId).automationApply({
      operationId,
      intent,
    });
    const result = committed.outcome.page_occurrence_mutation;
    if (!result) {
      throw new Error("Core Automation commit omitted its occurrence result");
    }
    if (!result.success) {
      return { success: false, error: result.error ?? "Occurrence update failed" };
    }
    const commitCursor =
      committed.status === "committed"
        ? {
            storeEpoch: committed.commit.store_epoch,
            commitSeq: committed.commit.commit_seq,
          }
        : {
            storeEpoch: committed.observed.store_epoch,
            commitSeq: committed.observed.commit_head,
          };
    return { success: true, commitCursor };
  };
  const readActiveDefinitions = async (
    requestClass: DesktopAutomationReadClass = "interactive",
  ): Promise<CoreAutomationDefinition[]> => {
    const snapshot = await client.automationRead(
      {
        kind: "definitions",
        include_deleted: false,
        window: { after: null, first: 200 },
      },
      requestClass === "background" ? BACKGROUND_CORE_REQUEST : undefined,
    );
    if (snapshot.value.kind !== "definitions") {
      throw new Error("Core returned a non-Definitions Automation read");
    }
    if (snapshot.value.window.next_cursor) {
      throw new Error("Active Scheduled Automation collection exceeded its fixed Core bound");
    }
    return [...snapshot.value.window.items];
  };
  const readInboxItems = async (
    limit: number | undefined,
    requestClass: DesktopAutomationReadClass = "interactive",
  ): Promise<{
    readonly items: CoreAutomationInboxItem[];
    readonly unreadTotal: number;
  }> => {
    const requested = limit ?? 200;
    if (!Number.isInteger(requested) || requested < 1 || requested > 1_000) {
      throw new Error("Automation inbox limit must be between 1 and 1000");
    }
    const items: CoreAutomationInboxItem[] = [];
    let after: string | null = null;
    let unreadTotal = 0;
    do {
      const snapshot = await client.automationRead(
        {
          kind: "inbox",
          window: {
            after,
            first: Math.min(200, requested - items.length),
          },
        },
        requestClass === "background" ? BACKGROUND_CORE_REQUEST : undefined,
      );
      if (snapshot.value.kind !== "inbox") {
        throw new Error("Core returned a non-Inbox Automation read");
      }
      items.push(...snapshot.value.window.items);
      unreadTotal = snapshot.value.unread_counts.total;
      after = items.length < requested ? (snapshot.value.window.next_cursor ?? null) : null;
    } while (after !== null);
    return { items, unreadTotal };
  };

  return {
    listDefinitions: async (requestClass) => {
      const definitions = await readActiveDefinitions(requestClass);
      return definitions.map(mapDefinition);
    },
    getDefinition: async (id) => {
      const item = await readDefinition(id);
      return item ? mapDefinition(item) : null;
    },
    createDefinition: async (input) => {
      const automationId = await createAutomationId(
        input.name,
        async (candidate) => (await readDefinition(candidate)) === null,
      );
      const committed = await client.automationApply({
        operationId: operationId(`create:${automationId}`),
        intent: {
          kind: "create_definition",
          automation_id: automationId,
          definition: toCoreDefinitionInput(input),
        },
      });
      const definition = requireDefinition(committed, automationId);
      routing.commit({ definitions: { upsert: [definition] } });
      return mapDefinition(definition);
    },
    updateDefinition: async (input) => {
      const current = await readDefinition(input.id);
      if (!current) return null;
      const committed = await client.automationApply({
        operationId: operationId(`update:${input.id}`),
        intent:
          input.status === "DELETED"
            ? {
                kind: "delete_definition",
                automation_id: input.id,
                expected_revision: current.definition_revision,
              }
            : {
                kind: "update_definition",
                automation_id: input.id,
                expected_revision: current.definition_revision,
                status: input.status,
                definition: toCoreDefinitionInput(input),
              },
      });
      const definition = requireDefinition(committed, input.id);
      routing.commit({ definitions: { upsert: [definition] } });
      return mapDefinition(definition);
    },
    deleteDefinition: async (id) => {
      const current = await readDefinition(id);
      if (!current) {
        return {
          item: null,
          success: true,
          status: "not_found",
          deletedRunCount: 0,
        };
      }
      const committed = await client.automationApply({
        operationId: operationId(`delete:${id}`),
        intent: {
          kind: "delete_definition",
          automation_id: id,
          expected_revision: current.definition_revision,
        },
      });
      routing.commit({
        definitions: { removeIds: [id] },
        runs: { removeThreadIds: committed.outcome.deleted_run_ids },
      });
      return {
        item: mapDefinition(current),
        success: true,
        status: "deleted",
        deletedRunCount: committed.outcome.deleted_run_ids.length,
      };
    },
    dispatchDefinitionNow: async (id) => {
      const current = await readDefinition(id);
      if (!current) return null;
      const committed = await client.automationApply({
        operationId: operationId(`dispatch-now:${id}`),
        intent: { kind: "dispatch_now", automation_id: id },
      });
      return mapDefinition(requireDefinition(committed, id));
    },
    rescheduleDefinition: async (id, expectedRevision, policy) => {
      const committed = await client.automationApply(
        {
          operationId: stableOperationId(`reschedule:${id}`, {
            expectedRevision,
            ...policy,
          }),
          intent: {
            kind: "reschedule_definition",
            automation_id: id,
            expected_revision: expectedRevision,
            not_before_ms: policy.notBefore ?? null,
            retry_within_ms: policy.retryWithinMs ?? null,
          },
        },
        BACKGROUND_CORE_REQUEST,
      );
      return mapDefinition(requireDefinition(committed, id));
    },
    claimDueDefinitions: async (limit, leaseDurationMs) => {
      const committed = await client.automationApply(
        {
          operationId: operationId("claim-due"),
          intent: {
            kind: "claim_due",
            limit,
            lease_duration_ms: leaseDurationMs,
          },
        },
        BACKGROUND_CORE_REQUEST,
      );
      const definitions = new Map(
        committed.outcome.definitions.map((item) => [item.automation_id, item]),
      );
      return committed.outcome.claimed_leases.map((lease) => {
        const claimedDefinition = definitions.get(lease.automation_id);
        if (!claimedDefinition) {
          throw new Error("Core Automation claim omitted its Definition");
        }
        return {
          leaseId: lease.lease_id,
          scheduledFor: lease.scheduled_for_ms,
          attempt: lease.attempt,
          expiresAt: lease.expires_at_ms,
          definition: mapDefinition(claimedDefinition),
        };
      });
    },
    completeLease: async (leaseId) => {
      await client.automationApply(
        {
          operationId: operationId(`complete-lease:${leaseId}`),
          intent: { kind: "complete_lease", lease_id: leaseId },
        },
        BACKGROUND_CORE_REQUEST,
      );
    },
    failLease: async (leaseId, retryDelayMs, reasonCode) => {
      await client.automationApply(
        {
          operationId: operationId(`fail-lease:${leaseId}`),
          intent: {
            kind: "fail_lease",
            lease_id: leaseId,
            retry_delay_ms: retryDelayMs,
            reason_code: reasonCode,
          },
        },
        BACKGROUND_CORE_REQUEST,
      );
    },
    settleInterruptedRuns: async () => {
      const committed = await client.automationApply(
        {
          operationId: operationId("settle-interrupted-runs"),
          intent: { kind: "settle_interrupted_runs" },
        },
        BACKGROUND_CORE_REQUEST,
      );
      return {
        archivedPendingCount: committed.outcome.run_bulk?.archived_pending_count ?? 0,
        pendingReviewCount: committed.outcome.run_bulk?.pending_review_count ?? 0,
      };
    },
    getRun: async (threadId) => {
      const run = await readRun(threadId);
      return run ? mapRun(run) : null;
    },
    beginRun: async (input) => {
      const committed = await client.automationApply(
        {
          operationId: operationId(`begin-run:${input.threadId}`),
          intent: {
            kind: "begin_run",
            thread_id: input.threadId,
            automation_id: input.automationId,
            thread_title: input.threadTitle ?? null,
            source_cwd: input.sourceCwd ?? null,
          },
        },
        BACKGROUND_CORE_REQUEST,
      );
      const run = committed.outcome.runs.find(
        (candidate) => candidate.thread_id === input.threadId,
      );
      if (run) routing.commit({ runs: { upsert: [run] } });
      return run !== undefined;
    },
    replacePendingRunThread: async (input) => {
      const pending = await readRun(input.pendingThreadId, BACKGROUND_CORE_REQUEST);
      if (!pending) return false;
      const committed = await client.automationApply(
        {
          operationId: operationId(`replace-run:${input.pendingThreadId}:${input.threadId}`),
          intent: {
            kind: "replace_pending_run_thread",
            pending_thread_id: input.pendingThreadId,
            thread_id: input.threadId,
            expected_revision: pending.run_revision,
          },
        },
        BACKGROUND_CORE_REQUEST,
      );
      const run = committed.outcome.runs.find(
        (candidate) => candidate.thread_id === input.threadId,
      );
      if (!run) return false;
      routing.commit({
        runs: { removeThreadIds: [input.pendingThreadId], upsert: [run] },
      });
      return true;
    },
    setRunThreadTitle: async (threadId, threadTitle) =>
      (await applyRun(
        threadId,
        (current) => ({
          kind: "set_run_thread_title",
          thread_id: threadId,
          expected_revision: current.run_revision,
          thread_title: threadTitle,
        }),
        BACKGROUND_CORE_REQUEST,
      )) !== null,
    completeRunForReview: async (input) =>
      (await applyRun(
        input.threadId,
        (current) => ({
          kind: "complete_run_for_review",
          thread_id: input.threadId,
          expected_revision: current.run_revision,
          inbox_title: input.inboxTitle ?? null,
          inbox_summary: input.inboxSummary ?? null,
        }),
        BACKGROUND_CORE_REQUEST,
      )) !== null,
    setRunInboxItem: async (input) =>
      (await applyRun(
        input.threadId,
        (current) => ({
          kind: "set_run_inbox_item",
          thread_id: input.threadId,
          expected_revision: current.run_revision,
          inbox_title: input.inboxTitle ?? null,
          inbox_summary: input.inboxSummary ?? null,
        }),
        BACKGROUND_CORE_REQUEST,
      )) !== null,
    acceptRun: async (threadId) =>
      (await applyRun(threadId, (current) => ({
        kind: "accept_run",
        thread_id: threadId,
        expected_revision: current.run_revision,
      }))) !== null,
    archiveRun: async (input, messages) =>
      (await applyRun(input.threadId, (run) => ({
        kind: "archive_run",
        thread_id: input.threadId,
        expected_revision: run.run_revision,
        archived_user_message: messages.archivedUserMessage,
        archived_assistant_message: messages.archivedAssistantMessage,
        archived_reason: input.archivedReason ?? null,
      }))) !== null,
    deleteRun: async (threadId) => {
      const run = await readRun(threadId);
      if (!run) return false;
      const committed = await client.automationApply({
        operationId: operationId(`delete-run:${threadId}`),
        intent: {
          kind: "delete_run",
          thread_id: threadId,
          expected_revision: run.run_revision,
        },
      });
      const deleted = committed.outcome.deleted_run_ids.includes(threadId);
      if (deleted) routing.commit({ runs: { removeThreadIds: [threadId] } });
      return deleted;
    },
    unarchiveRun: async (threadId) =>
      (await applyRun(threadId, (run) => ({
        kind: "unarchive_run",
        thread_id: threadId,
        expected_revision: run.run_revision,
      }))) !== null,
    readInbox: async (limit, requestClass = "interactive") => {
      const { items, unreadTotal } = await readInboxItems(limit, requestClass);
      const mappedItems = items.map(mapInboxItem);
      const unreadItems = mappedItems.filter(
        (item) =>
          item.readAt === null && (item.status === "PENDING_REVIEW" || item.status === "ACCEPTED"),
      );
      return {
        items: mappedItems,
        unreadRunCounts: {
          total: unreadTotal,
          automationIds: [...new Set(unreadItems.map((item) => item.automationId))],
          unreadRuns: unreadItems.map((item) => ({
            automationId: item.automationId,
            threadId: item.threadId,
          })),
        },
      };
    },
    setRunReadState: async (input) => {
      const run = await applyRun(input.threadId, (current) => ({
        kind: "set_run_read_state",
        thread_id: input.threadId,
        expected_revision: current.run_revision,
        read: input.readAt !== null,
      }));
      if (!run) return null;
      const inbox = await client.automationRead({
        kind: "inbox",
        window: { after: null, first: 200 },
      });
      if (inbox.value.kind !== "inbox") {
        throw new Error("Core returned a non-Inbox Automation read");
      }
      const item = inbox.value.window.items.find(
        (candidate) => candidate.thread_id === input.threadId,
      );
      return item ? mapInboxItem(item) : null;
    },
    markAllRunsRead: async () => {
      const committed = await client.automationApply({
        operationId: operationId("mark-all-read"),
        intent: { kind: "mark_all_runs_read" },
      });
      return committed.outcome.run_bulk?.changed_count ?? 0;
    },
    listPageOccurrences: async (projectId, windowStart, windowEnd, searchQuery, after) => {
      const windowStartMs = finiteDateMilliseconds(windowStart, "window start");
      const windowEndMs = finiteDateMilliseconds(windowEnd, "window end");
      const snapshot = await clientForProject(projectId).automationRead({
        kind: "occurrences",
        window_start_ms: windowStartMs,
        window_end_ms: windowEndMs,
        search_query: searchQuery?.trim() || null,
        window: { after: after ?? null, first: 200 },
      });
      if (snapshot.value.kind !== "occurrences") {
        throw new Error("Core returned a non-Occurrence Automation read");
      }
      return {
        items: snapshot.value.window.items.map(mapOccurrence),
        nextCursor: snapshot.value.window.next_cursor ?? null,
      };
    },
    completePageOccurrence: async (projectId, input) =>
      await applyPageOccurrence(projectId, input.operationId, {
        kind: "complete_page_occurrence",
        page_id: input.pageId,
        occurrence_start_ms: finiteDateMilliseconds(input.occurrenceStart, "occurrence start"),
        created_page_id: input.createdPageId,
      }),
    skipPageOccurrence: async (projectId, input) =>
      await applyPageOccurrence(projectId, input.operationId, {
        kind: "skip_page_occurrence",
        page_id: input.pageId,
        occurrence_start_ms: finiteDateMilliseconds(input.occurrenceStart, "occurrence start"),
      }),
    updatePageOccurrence: async (projectId, input) =>
      await applyPageOccurrence(projectId, input.operationId, {
        kind: "update_page_occurrence",
        page_id: input.pageId,
        occurrence_start_ms: finiteDateMilliseconds(input.occurrenceStart, "occurrence start"),
        scope: input.scope === "this-and-future" ? "this_and_future" : input.scope,
        created_page_id: input.scope === "all" ? null : input.createdPageId,
        updates: toCoreOccurrenceSchedulePatch(input.updates),
      }),
    snoozeReminder: async (projectId, pageId, occurrenceStart, snoozeMinutes) => {
      const occurrenceStartMs = new Date(occurrenceStart).getTime();
      if (!Number.isFinite(occurrenceStartMs)) {
        throw new Error("Reminder occurrence start is invalid");
      }
      if (!Number.isSafeInteger(snoozeMinutes) || snoozeMinutes < 1) {
        throw new Error("Reminder snooze duration is invalid");
      }
      await clientForProject(projectId).automationApply({
        operationId: operationId(`snooze-reminder:${pageId}`),
        intent: {
          kind: "snooze_reminder",
          page_id: pageId,
          occurrence_start_ms: occurrenceStartMs,
          snooze_minutes: snoozeMinutes,
        },
      });
    },
    claimDueReminders: async (limit, leaseDurationMs) => {
      const committed = await client.automationApply(
        {
          operationId: operationId("claim-due-reminders"),
          intent: {
            kind: "claim_due_reminders",
            limit,
            lease_duration_ms: leaseDurationMs,
          },
        },
        BACKGROUND_CORE_REQUEST,
      );
      return committed.outcome.reminder_leases.map((lease) => ({
        leaseId: lease.lease_id,
        projectId: lease.project_id,
        pageId: lease.page_id,
        occurrenceStart: lease.occurrence_start_ms,
        reminderOffsetMinutes: lease.reminder_offset_minutes,
        dueAt: lease.due_at_ms,
        title: lease.title,
        attempt: lease.attempt,
        expiresAt: lease.expires_at_ms,
      }));
    },
    completeReminderLease: async (leaseId) => {
      await client.automationApply(
        {
          operationId: operationId(`complete-reminder:${leaseId}`),
          intent: { kind: "complete_reminder_lease", lease_id: leaseId },
        },
        BACKGROUND_CORE_REQUEST,
      );
    },
    failReminderLease: async (leaseId, retryDelayMs, reasonCode) => {
      await client.automationApply(
        {
          operationId: operationId(`fail-reminder:${leaseId}`),
          intent: {
            kind: "fail_reminder_lease",
            lease_id: leaseId,
            retry_delay_ms: retryDelayMs,
            reason_code: reasonCode,
          },
        },
        BACKGROUND_CORE_REQUEST,
      );
    },
  };
};

export const createDesktopAutomationModuleBridge = (
  input: DesktopAutomationModuleBridgeInput,
): DesktopAutomationModulePort => {
  let corePort: DesktopAutomationModulePort | null = null;
  const port = async (): Promise<DesktopAutomationModulePort> => {
    const runtime = await input.authority;
    corePort ??= createCoreAutomationPort(
      runtime.rootClient,
      runtime.clientForProject,
      input.routing,
    );
    return corePort;
  };
  return {
    listDefinitions: async (requestClass) => (await port()).listDefinitions(requestClass),
    getDefinition: async (id) => (await port()).getDefinition(id),
    createDefinition: async (definition) => (await port()).createDefinition(definition),
    updateDefinition: async (definition) => (await port()).updateDefinition(definition),
    deleteDefinition: async (id) => (await port()).deleteDefinition(id),
    dispatchDefinitionNow: async (id) => (await port()).dispatchDefinitionNow(id),
    rescheduleDefinition: async (id, expectedRevision, policy) =>
      (await port()).rescheduleDefinition(id, expectedRevision, policy),
    claimDueDefinitions: async (limit, leaseDurationMs) =>
      (await port()).claimDueDefinitions(limit, leaseDurationMs),
    completeLease: async (leaseId) => (await port()).completeLease(leaseId),
    failLease: async (leaseId, retryDelayMs, reasonCode) =>
      (await port()).failLease(leaseId, retryDelayMs, reasonCode),
    settleInterruptedRuns: async () => (await port()).settleInterruptedRuns(),
    getRun: async (threadId) => (await port()).getRun(threadId),
    beginRun: async (runInput) => (await port()).beginRun(runInput),
    replacePendingRunThread: async (runInput) => (await port()).replacePendingRunThread(runInput),
    setRunThreadTitle: async (threadId, threadTitle) =>
      (await port()).setRunThreadTitle(threadId, threadTitle),
    completeRunForReview: async (runInput) => (await port()).completeRunForReview(runInput),
    setRunInboxItem: async (runInput) => (await port()).setRunInboxItem(runInput),
    acceptRun: async (threadId) => (await port()).acceptRun(threadId),
    archiveRun: async (archiveInput, messages) => (await port()).archiveRun(archiveInput, messages),
    deleteRun: async (threadId) => (await port()).deleteRun(threadId),
    unarchiveRun: async (threadId) => (await port()).unarchiveRun(threadId),
    readInbox: async (limit, requestClass) => (await port()).readInbox(limit, requestClass),
    setRunReadState: async (readInput) => (await port()).setRunReadState(readInput),
    markAllRunsRead: async (readInput) => (await port()).markAllRunsRead(readInput),
    listPageOccurrences: async (projectId, windowStart, windowEnd, searchQuery, after) =>
      (await port()).listPageOccurrences(projectId, windowStart, windowEnd, searchQuery, after),
    completePageOccurrence: async (projectId, occurrenceInput, sessionId) =>
      (await port()).completePageOccurrence(projectId, occurrenceInput, sessionId),
    skipPageOccurrence: async (projectId, occurrenceInput, sessionId) =>
      (await port()).skipPageOccurrence(projectId, occurrenceInput, sessionId),
    updatePageOccurrence: async (projectId, occurrenceInput, sessionId) =>
      (await port()).updatePageOccurrence(projectId, occurrenceInput, sessionId),
    snoozeReminder: async (projectId, pageId, occurrenceStart, snoozeMinutes) =>
      (await port()).snoozeReminder(projectId, pageId, occurrenceStart, snoozeMinutes),
    claimDueReminders: async (limit, leaseDurationMs) =>
      (await port()).claimDueReminders(limit, leaseDurationMs),
    completeReminderLease: async (leaseId) => (await port()).completeReminderLease(leaseId),
    failReminderLease: async (leaseId, retryDelayMs, reasonCode) =>
      (await port()).failReminderLease(leaseId, retryDelayMs, reasonCode),
  };
};
