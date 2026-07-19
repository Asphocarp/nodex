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

export type AutomationRead =
  | { readonly kind: "definitions"; readonly includeDeleted?: boolean }
  | { readonly kind: "definition"; readonly automationId: string }
  | {
      readonly kind: "leases";
      readonly automationId?: string;
      readonly includeSettled?: boolean;
      readonly limit?: number;
    };

export type AutomationReadValue =
  | { readonly kind: "definitions"; readonly items: readonly AutomationDefinition[] }
  | { readonly kind: "definition"; readonly item?: AutomationDefinition }
  | { readonly kind: "leases"; readonly items: readonly AutomationLease[] };

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
    };

export interface AutomationCommitValue {
  readonly affectedAutomationIds: readonly string[];
  readonly definitions: readonly AutomationDefinition[];
  readonly claimedLeases: readonly AutomationLease[];
}

export interface AutomationReceipt extends ModuleMutationReceipt {
  readonly affectedAutomationIds: readonly string[];
  readonly affectedLeaseIds: readonly string[];
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
}
