import { randomUUID } from "node:crypto";

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
} from "../../shared/types";
import type { DesktopDataAuthorityRuntime } from "./desktop-data-authority";
import type {
  AutomationCommittedValue,
  AutomationReadSnapshot,
  CoreClientPort,
  CoreEventEnvelope,
} from "./types";

type CoreAutomationDefinition = Extract<
  AutomationReadSnapshot["value"],
  { readonly kind: "definitions" }
>["items"][number];

type CoreAutomationRun = Extract<
  AutomationReadSnapshot["value"],
  { readonly kind: "runs" }
>["items"][number];

type CoreAutomationInboxItem = Extract<
  AutomationReadSnapshot["value"],
  { readonly kind: "inbox" }
>["items"][number];

export interface AutomationArchiveMessages {
  readonly archivedUserMessage: string | null;
  readonly archivedAssistantMessage: string | null;
}

export interface DesktopAutomationDefinitionDeleteResult
  extends CodexScheduledAutomationDeleteResponse {
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

export interface DesktopAutomationModulePort {
  peekRunAutomationId?(threadId: string): string | null;
  peekActiveHeartbeatAutomationId?(threadId: string): string | null;
  listDefinitions(): Promise<CodexScheduledAutomation[]>;
  getDefinition(id: string): Promise<CodexScheduledAutomation | null>;
  createDefinition(
    input: CodexScheduledAutomationCreateInput,
  ): Promise<CodexScheduledAutomation>;
  updateDefinition(
    input: CodexScheduledAutomationUpdateInput,
  ): Promise<CodexScheduledAutomation | null>;
  deleteDefinition(id: string): Promise<DesktopAutomationDefinitionDeleteResult>;
  dispatchDefinitionNow(id: string): Promise<CodexScheduledAutomation | null>;
  claimDueDefinitions(
    limit: number,
    leaseDurationMs: number,
  ): Promise<DesktopAutomationClaim[]>;
  completeLease(leaseId: string): Promise<void>;
  failLease(
    leaseId: string,
    retryDelayMs: number | null,
    reasonCode: string,
  ): Promise<void>;
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
  setRunThreadTitle(
    threadId: string,
    threadTitle: string | null,
  ): Promise<boolean>;
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
  readInbox(limit?: number): Promise<CodexAutomationRunsInboxResponse>;
  setRunReadState(
    input: CodexAutomationRunReadStateInput,
  ): Promise<CodexAutomationInboxItem | null>;
  markAllRunsRead(input: CodexAutomationRunMarkAllReadInput): Promise<number>;
}

export interface DesktopAutomationModuleBridgeInput {
  readonly authority: Promise<DesktopDataAuthorityRuntime>;
  readonly typescript: DesktopAutomationModulePort;
}

export interface CoreAutomationInvalidation {
  readonly automationIds: readonly string[];
  readonly runIds: readonly string[];
}

export function mapCoreAutomationEvent(
  envelope: CoreEventEnvelope,
): CoreAutomationInvalidation | null {
  const payload = envelope.event.payload;
  if (payload.module !== "automation") return null;
  return {
    automationIds: payload.event.automation_ids,
    runIds: payload.event.run_ids,
  };
}

const mapDefinition = (
  definition: CoreAutomationDefinition,
): CodexScheduledAutomation => ({
  id: definition.automation_id,
  kind: definition.kind,
  status: definition.status,
  targetThreadId: definition.target_thread_id ?? null,
  name: definition.name,
  prompt: definition.prompt,
  rrule: definition.rrule || null,
  model: definition.model ?? null,
  reasoningEffort: definition.reasoning_effort ?? null,
  cwds: [...definition.cwds],
  executionEnvironment: definition.execution_environment,
  localEnvironmentConfigPath:
    definition.local_environment_config_path ?? null,
  nextRunAt: definition.next_run_at_ms ?? null,
  lastRunAt: definition.last_run_at_ms ?? null,
  createdAt: definition.created_at_ms,
  updatedAt: definition.updated_at_ms,
});

const mapRun = (run: CoreAutomationRun): CodexAutomationRun => ({
  threadId: run.thread_id,
  automationId: run.automation_id,
  status: run.status,
  readAt: run.read_at_ms ?? null,
  threadTitle: run.thread_title ?? null,
  sourceCwd: run.source_cwd ?? null,
  inboxTitle: run.inbox_title ?? null,
  inboxSummary: run.inbox_summary ?? null,
  archivedUserMessage: run.archived_user_message ?? null,
  archivedAssistantMessage: run.archived_assistant_message ?? null,
  archivedReason: run.archived_reason ?? null,
  createdAt: run.created_at_ms,
  updatedAt: run.updated_at_ms,
});

const mapInboxItem = (
  item: CoreAutomationInboxItem,
): CodexAutomationInboxItem => ({
  id: item.thread_id,
  automationId: item.automation_id,
  automationName: item.automation_name ?? null,
  title: item.title ?? null,
  description: item.description ?? null,
  archivedAssistantMessage: item.archived_assistant_message ?? null,
  archivedUserMessage: item.archived_user_message ?? null,
  archivedReason: item.archived_reason ?? null,
  sourceCwd: item.source_cwd ?? null,
  threadId: item.thread_id,
  readAt: item.read_at_ms ?? null,
  createdAt: item.created_at_ms,
  status: item.status,
});

const toCoreDefinitionInput = (
  input: CodexScheduledAutomationCreateInput,
) => ({
  kind: input.kind,
  target_thread_id: input.targetThreadId ?? null,
  name: input.name,
  prompt: input.prompt ?? null,
  rrule: input.rrule ?? null,
  model: input.model ?? null,
  reasoning_effort: input.reasoningEffort ?? null,
  cwds: input.cwds ?? null,
  execution_environment: input.executionEnvironment ?? null,
  local_environment_config_path: input.localEnvironmentConfigPath ?? null,
});

const operationId = (kind: string): string =>
  `electron:automation:${kind}:${randomUUID()}`;

const slugifyAutomationName = (name: string): string =>
  name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");

const createAutomationId = (
  name: string,
  existingIds: ReadonlySet<string>,
): string => {
  const base = slugifyAutomationName(name) || "automation";
  if (!existingIds.has(base)) return base;
  for (let suffix = 2; suffix <= 20; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!existingIds.has(candidate)) return candidate;
  }
  return `${base}-${randomUUID().slice(0, 8)}`;
};

const requireDefinition = (
  committed: AutomationCommittedValue,
  automationId: string,
): CoreAutomationDefinition => {
  const definition = committed.value.definitions.find((candidate) =>
    candidate.automation_id === automationId
  );
  if (definition) return definition;
  throw new Error("Core Automation commit omitted its Definition result");
};

const requireRun = (
  committed: AutomationCommittedValue,
  threadId: string,
): CoreAutomationRun => {
  const run = committed.value.runs.find((candidate) =>
    candidate.thread_id === threadId
  );
  if (run) return run;
  throw new Error("Core Automation commit omitted its Run result");
};

const createCoreAutomationPort = (
  client: CoreClientPort,
): DesktopAutomationModulePort => {
  const readDefinition = async (
    automationId: string,
  ): Promise<CoreAutomationDefinition | null> => {
    const snapshot = await client.automationRead({
      kind: "definition",
      automation_id: automationId,
    });
    if (snapshot.value.kind !== "definition") {
      throw new Error("Core returned a non-Definition Automation read");
    }
    return snapshot.value.item ?? null;
  };
  const readRun = async (threadId: string): Promise<CoreAutomationRun | null> => {
    const snapshot = await client.automationRead({
      kind: "run",
      thread_id: threadId,
    });
    if (snapshot.value.kind !== "run") {
      throw new Error("Core returned a non-Run Automation read");
    }
    return snapshot.value.item ?? null;
  };
  const applyRun = async (
    threadId: string,
    intent: (run: CoreAutomationRun) => Parameters<CoreClientPort["automationApply"]>[0]["intent"],
  ): Promise<CoreAutomationRun | null> => {
    const run = await readRun(threadId);
    if (!run) return null;
    const committed = await client.automationApply({
      operationId: operationId(`run:${threadId}`),
      intent: intent(run),
    });
    return requireRun(committed, threadId);
  };

  return {
    listDefinitions: async () => {
      const snapshot = await client.automationRead({
        kind: "definitions",
        include_deleted: false,
      });
      if (snapshot.value.kind !== "definitions") {
        throw new Error("Core returned a non-Definitions Automation read");
      }
      return snapshot.value.items.map(mapDefinition);
    },
    getDefinition: async (id) => {
      const item = await readDefinition(id);
      return item ? mapDefinition(item) : null;
    },
    createDefinition: async (input) => {
      const definitions = await client.automationRead({
        kind: "definitions",
        include_deleted: true,
      });
      if (definitions.value.kind !== "definitions") {
        throw new Error("Core returned a non-Definitions Automation read");
      }
      const automationId = createAutomationId(
        input.name,
        new Set(
          definitions.value.items.map((definition) =>
            definition.automation_id
          ),
        ),
      );
      const committed = await client.automationApply({
        operationId: operationId(`create:${automationId}`),
        intent: {
          kind: "create_definition",
          automation_id: automationId,
          definition: toCoreDefinitionInput(input),
        },
      });
      return mapDefinition(requireDefinition(committed, automationId));
    },
    updateDefinition: async (input) => {
      const current = await readDefinition(input.id);
      if (!current) return null;
      const committed = await client.automationApply({
        operationId: operationId(`update:${input.id}`),
        intent: input.status === "DELETED"
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
      return mapDefinition(requireDefinition(committed, input.id));
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
      return {
        item: mapDefinition(current),
        success: true,
        status: "deleted",
        deletedRunCount: committed.value.deleted_run_ids.length,
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
    claimDueDefinitions: async (limit, leaseDurationMs) => {
      const committed = await client.automationApply({
        operationId: operationId("claim-due"),
        intent: {
          kind: "claim_due",
          limit,
          lease_duration_ms: leaseDurationMs,
        },
      });
      const definitions = new Map(
        committed.value.definitions.map((item) => [
          item.automation_id,
          item,
        ]),
      );
      return committed.value.claimed_leases.map((lease) => {
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
      await client.automationApply({
        operationId: operationId(`complete-lease:${leaseId}`),
        intent: { kind: "complete_lease", lease_id: leaseId },
      });
    },
    failLease: async (leaseId, retryDelayMs, reasonCode) => {
      await client.automationApply({
        operationId: operationId(`fail-lease:${leaseId}`),
        intent: {
          kind: "fail_lease",
          lease_id: leaseId,
          retry_delay_ms: retryDelayMs,
          reason_code: reasonCode,
        },
      });
    },
    settleInterruptedRuns: async () => {
      const committed = await client.automationApply({
        operationId: operationId("settle-interrupted-runs"),
        intent: { kind: "settle_interrupted_runs" },
      });
      return {
        archivedPendingCount:
          committed.value.run_bulk?.archived_pending_count ?? 0,
        pendingReviewCount:
          committed.value.run_bulk?.pending_review_count ?? 0,
      };
    },
    getRun: async (threadId) => {
      const run = await readRun(threadId);
      return run ? mapRun(run) : null;
    },
    beginRun: async (input) => {
      const committed = await client.automationApply({
        operationId: operationId(`begin-run:${input.threadId}`),
        intent: {
          kind: "begin_run",
          thread_id: input.threadId,
          automation_id: input.automationId,
          thread_title: input.threadTitle ?? null,
          source_cwd: input.sourceCwd ?? null,
        },
      });
      return committed.value.runs.some((candidate) =>
        candidate.thread_id === input.threadId
      );
    },
    replacePendingRunThread: async (input) => {
      const pending = await readRun(input.pendingThreadId);
      if (!pending) return false;
      const committed = await client.automationApply({
        operationId: operationId(
          `replace-run:${input.pendingThreadId}:${input.threadId}`,
        ),
        intent: {
          kind: "replace_pending_run_thread",
          pending_thread_id: input.pendingThreadId,
          thread_id: input.threadId,
          expected_revision: pending.run_revision,
        },
      });
      return committed.value.runs.some((candidate) =>
        candidate.thread_id === input.threadId
      );
    },
    setRunThreadTitle: async (threadId, threadTitle) =>
      (await applyRun(threadId, (current) => ({
        kind: "set_run_thread_title",
        thread_id: threadId,
        expected_revision: current.run_revision,
        thread_title: threadTitle,
      }))) !== null,
    completeRunForReview: async (input) =>
      (await applyRun(input.threadId, (current) => ({
        kind: "complete_run_for_review",
        thread_id: input.threadId,
        expected_revision: current.run_revision,
        inbox_title: input.inboxTitle ?? null,
        inbox_summary: input.inboxSummary ?? null,
      }))) !== null,
    setRunInboxItem: async (input) =>
      (await applyRun(input.threadId, (current) => ({
        kind: "set_run_inbox_item",
        thread_id: input.threadId,
        expected_revision: current.run_revision,
        inbox_title: input.inboxTitle ?? null,
        inbox_summary: input.inboxSummary ?? null,
      }))) !== null,
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
      return committed.value.deleted_run_ids.includes(threadId);
    },
    unarchiveRun: async (threadId) =>
      (await applyRun(threadId, (run) => ({
        kind: "unarchive_run",
        thread_id: threadId,
        expected_revision: run.run_revision,
      }))) !== null,
    readInbox: async (limit) => {
      const snapshot = await client.automationRead({
        kind: "inbox",
        limit: limit ?? null,
      });
      if (snapshot.value.kind !== "inbox") {
        throw new Error("Core returned a non-Inbox Automation read");
      }
      return {
        items: snapshot.value.items.map(mapInboxItem),
        unreadRunCounts: {
          total: snapshot.value.unread_counts.total,
          automationIds: [...snapshot.value.unread_counts.automation_ids],
          unreadRuns: snapshot.value.unread_counts.unread_runs.map((run) => ({
            automationId: run.automation_id,
            threadId: run.thread_id,
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
        limit: 200,
      });
      if (inbox.value.kind !== "inbox") {
        throw new Error("Core returned a non-Inbox Automation read");
      }
      const item = inbox.value.items.find((candidate) =>
        candidate.thread_id === input.threadId
      );
      return item ? mapInboxItem(item) : null;
    },
    markAllRunsRead: async () => {
      const committed = await client.automationApply({
        operationId: operationId("mark-all-read"),
        intent: { kind: "mark_all_runs_read" },
      });
      return committed.value.run_bulk?.changed_count ?? 0;
    },
  };
};

export const createDesktopAutomationModuleBridge = (
  input: DesktopAutomationModuleBridgeInput,
): DesktopAutomationModulePort => {
  let corePort: DesktopAutomationModulePort | null = null;
  const port = async (): Promise<DesktopAutomationModulePort> => {
    const runtime = await input.authority;
    if (runtime.backend === "typescript") return input.typescript;
    corePort ??= createCoreAutomationPort(runtime.rootClient);
    return corePort;
  };
  return {
    listDefinitions: async () => (await port()).listDefinitions(),
    getDefinition: async (id) => (await port()).getDefinition(id),
    createDefinition: async (definition) =>
      (await port()).createDefinition(definition),
    updateDefinition: async (definition) =>
      (await port()).updateDefinition(definition),
    deleteDefinition: async (id) => (await port()).deleteDefinition(id),
    dispatchDefinitionNow: async (id) =>
      (await port()).dispatchDefinitionNow(id),
    claimDueDefinitions: async (limit, leaseDurationMs) =>
      (await port()).claimDueDefinitions(limit, leaseDurationMs),
    completeLease: async (leaseId) => (await port()).completeLease(leaseId),
    failLease: async (leaseId, retryDelayMs, reasonCode) =>
      (await port()).failLease(leaseId, retryDelayMs, reasonCode),
    settleInterruptedRuns: async () =>
      (await port()).settleInterruptedRuns(),
    getRun: async (threadId) => (await port()).getRun(threadId),
    beginRun: async (runInput) => (await port()).beginRun(runInput),
    replacePendingRunThread: async (runInput) =>
      (await port()).replacePendingRunThread(runInput),
    setRunThreadTitle: async (threadId, threadTitle) =>
      (await port()).setRunThreadTitle(threadId, threadTitle),
    completeRunForReview: async (runInput) =>
      (await port()).completeRunForReview(runInput),
    setRunInboxItem: async (runInput) =>
      (await port()).setRunInboxItem(runInput),
    acceptRun: async (threadId) => (await port()).acceptRun(threadId),
    archiveRun: async (archiveInput, messages) =>
      (await port()).archiveRun(archiveInput, messages),
    deleteRun: async (threadId) => (await port()).deleteRun(threadId),
    unarchiveRun: async (threadId) => (await port()).unarchiveRun(threadId),
    readInbox: async (limit) => (await port()).readInbox(limit),
    setRunReadState: async (readInput) =>
      (await port()).setRunReadState(readInput),
    markAllRunsRead: async (readInput) =>
      (await port()).markAllRunsRead(readInput),
  };
};
