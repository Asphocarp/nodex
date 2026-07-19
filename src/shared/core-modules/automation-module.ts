import type {
  CommittedModuleValue,
  CoreModuleResult,
  DeepCoreModule,
  ModuleApplyRequest,
  ModuleMutationReceipt,
  ModuleReadRequest,
  ModuleReadSnapshot,
} from "./common";

export type AutomationDefinitionKind = "cron" | "heartbeat";
export type AutomationDefinitionStatus = "ACTIVE" | "PAUSED" | "DELETED";
export type AutomationExecutionEnvironment = "local" | "worktree";
export type AutomationReasoningEffort =
  | "none"
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export interface AutomationDefinitionInput {
  readonly kind: AutomationDefinitionKind;
  readonly targetThreadId?: string;
  readonly name: string;
  readonly prompt?: string;
  readonly rrule?: string;
  readonly model?: string;
  readonly reasoningEffort?: AutomationReasoningEffort;
  readonly cwds?: readonly string[];
  readonly executionEnvironment?: AutomationExecutionEnvironment;
  readonly localEnvironmentConfigPath?: string;
}

export interface AutomationDefinition {
  readonly automationId: string;
  readonly definitionRevision: number;
  readonly kind: AutomationDefinitionKind;
  readonly status: AutomationDefinitionStatus;
  readonly targetThreadId?: string;
  readonly name: string;
  readonly prompt: string;
  readonly rrule: string;
  readonly model?: string;
  readonly reasoningEffort?: AutomationReasoningEffort;
  readonly cwds: readonly string[];
  readonly executionEnvironment: AutomationExecutionEnvironment;
  readonly localEnvironmentConfigPath?: string;
  readonly nextRunAtMs?: number;
  readonly lastRunAtMs?: number;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

export type AutomationLeaseStatus = "claimed" | "completed" | "failed" | "cancelled";

export interface AutomationLease {
  readonly leaseId: string;
  readonly automationId: string;
  readonly scheduledForMs: number;
  readonly attempt: number;
  readonly status: AutomationLeaseStatus;
  readonly claimedAtMs: number;
  readonly expiresAtMs: number;
  readonly settledAtMs?: number;
  readonly retryAtMs?: number;
  readonly reasonCode?: string;
}

export type AutomationRunStatus =
  | "IN_PROGRESS"
  | "PENDING_REVIEW"
  | "ACCEPTED"
  | "ARCHIVED";

export interface AutomationRun {
  readonly threadId: string;
  readonly automationId: string;
  readonly runRevision: number;
  readonly status: AutomationRunStatus;
  readonly readAtMs?: number;
  readonly threadTitle?: string;
  readonly sourceCwd?: string;
  readonly inboxTitle?: string;
  readonly inboxSummary?: string;
  readonly archivedUserMessage?: string;
  readonly archivedAssistantMessage?: string;
  readonly archivedReason?: string;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
}

export interface AutomationInboxItem {
  readonly automationId: string;
  readonly automationName?: string;
  readonly title?: string;
  readonly description?: string;
  readonly archivedAssistantMessage?: string;
  readonly archivedUserMessage?: string;
  readonly archivedReason?: string;
  readonly sourceCwd?: string;
  readonly threadId: string;
  readonly readAtMs?: number;
  readonly createdAtMs: number;
  readonly status: AutomationRunStatus;
}

export interface AutomationRunUnreadCounts {
  readonly total: number;
  readonly automationIds: readonly string[];
  readonly unreadRuns: ReadonlyArray<{
    readonly automationId: string;
    readonly threadId: string;
  }>;
}

export interface AutomationRunBulkResult {
  readonly changedCount: number;
  readonly archivedPendingCount: number;
  readonly pendingReviewCount: number;
  readonly hasMore: boolean;
}

export type AutomationRead =
  | { readonly kind: "definitions"; readonly includeDeleted?: boolean }
  | { readonly kind: "definition"; readonly automationId: string }
  | {
      readonly kind: "leases";
      readonly automationId?: string;
      readonly includeSettled?: boolean;
      readonly limit?: number;
    }
  | { readonly kind: "run"; readonly threadId: string }
  | {
      readonly kind: "runs";
      readonly automationId?: string;
      readonly includeArchived?: boolean;
      readonly limit?: number;
    }
  | { readonly kind: "inbox"; readonly limit?: number };

export type AutomationReadValue =
  | { readonly kind: "definitions"; readonly items: readonly AutomationDefinition[] }
  | { readonly kind: "definition"; readonly item?: AutomationDefinition }
  | { readonly kind: "leases"; readonly items: readonly AutomationLease[] }
  | { readonly kind: "run"; readonly item?: AutomationRun }
  | { readonly kind: "runs"; readonly items: readonly AutomationRun[] }
  | {
      readonly kind: "inbox";
      readonly items: readonly AutomationInboxItem[];
      readonly unreadCounts: AutomationRunUnreadCounts;
    };

export type AutomationIntent =
  | {
      readonly kind: "create_definition";
      readonly automationId: string;
      readonly definition: AutomationDefinitionInput;
    }
  | {
      readonly kind: "update_definition";
      readonly automationId: string;
      readonly expectedRevision: number;
      readonly status: Exclude<AutomationDefinitionStatus, "DELETED">;
      readonly definition: AutomationDefinitionInput;
    }
  | {
      readonly kind: "delete_definition";
      readonly automationId: string;
      readonly expectedRevision: number;
    }
  | {
      readonly kind: "claim_due";
      readonly limit: number;
      readonly leaseDurationMs: number;
    }
  | { readonly kind: "complete_lease"; readonly leaseId: string }
  | {
      readonly kind: "fail_lease";
      readonly leaseId: string;
      readonly retryDelayMs?: number;
      readonly reasonCode: string;
    }
  | {
      readonly kind: "begin_run";
      readonly threadId: string;
      readonly automationId: string;
      readonly threadTitle?: string;
      readonly sourceCwd?: string;
    }
  | {
      readonly kind: "replace_pending_run_thread";
      readonly pendingThreadId: string;
      readonly threadId: string;
      readonly expectedRevision: number;
    }
  | {
      readonly kind: "set_run_thread_title";
      readonly threadId: string;
      readonly expectedRevision: number;
      readonly threadTitle?: string;
    }
  | {
      readonly kind: "complete_run_for_review";
      readonly threadId: string;
      readonly expectedRevision: number;
      readonly inboxTitle?: string;
      readonly inboxSummary?: string;
    }
  | {
      readonly kind: "set_run_inbox_item";
      readonly threadId: string;
      readonly expectedRevision: number;
      readonly inboxTitle?: string;
      readonly inboxSummary?: string;
    }
  | {
      readonly kind: "accept_run";
      readonly threadId: string;
      readonly expectedRevision: number;
    }
  | {
      readonly kind: "set_run_read_state";
      readonly threadId: string;
      readonly expectedRevision: number;
      readonly read: boolean;
    }
  | { readonly kind: "mark_all_runs_read" }
  | {
      readonly kind: "archive_run";
      readonly threadId: string;
      readonly expectedRevision: number;
      readonly archivedUserMessage?: string;
      readonly archivedAssistantMessage?: string;
      readonly archivedReason?: string;
    }
  | {
      readonly kind: "unarchive_run";
      readonly threadId: string;
      readonly expectedRevision: number;
    }
  | {
      readonly kind: "delete_run";
      readonly threadId: string;
      readonly expectedRevision: number;
    }
  | { readonly kind: "settle_interrupted_runs" };

export interface AutomationCommitValue {
  readonly affectedAutomationIds: readonly string[];
  readonly definitions: readonly AutomationDefinition[];
  readonly claimedLeases: readonly AutomationLease[];
  readonly runs: readonly AutomationRun[];
  readonly deletedRunIds: readonly string[];
  readonly runBulk?: AutomationRunBulkResult;
}

export interface AutomationReceipt extends ModuleMutationReceipt {
  readonly affectedAutomationIds: readonly string[];
  readonly affectedLeaseIds: readonly string[];
  readonly affectedRunIds: readonly string[];
}

export type AutomationModuleReadRequest = ModuleReadRequest<AutomationRead>;
export type AutomationModuleReadResult = CoreModuleResult<
  ModuleReadSnapshot<AutomationReadValue>
>;
export type AutomationModuleApplyRequest = ModuleApplyRequest<AutomationIntent>;
export type AutomationModuleApplyResult = CoreModuleResult<
  CommittedModuleValue<AutomationCommitValue, AutomationReceipt>
>;

export type AutomationModule = DeepCoreModule<
  AutomationModuleReadRequest,
  AutomationModuleReadResult,
  AutomationModuleApplyRequest,
  AutomationModuleApplyResult
>;

export interface AutomationEvent {
  readonly kind: "automation_changed";
  readonly automationIds: readonly string[];
  readonly leaseIds: readonly string[];
  readonly runIds: readonly string[];
}
