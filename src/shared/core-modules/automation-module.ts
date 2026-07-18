import type {
  CodexScheduledAutomation,
  CodexScheduledAutomationCreateInput,
  CodexScheduledAutomationUpdateInput,
  PageOccurrenceCompleteInput,
  PageOccurrenceUpdateInput,
} from "../types";
import type {
  CommittedModuleValue,
  CoreModuleResult,
  DeepCoreModule,
  ModuleApplyRequest,
  ModuleMutationReceipt,
  ModuleReadRequest,
  ModuleReadSnapshot,
} from "./common";

export type AutomationRead =
  | { readonly kind: "definitions"; readonly includeDeleted?: boolean }
  | { readonly kind: "definition"; readonly automationId: string }
  | { readonly kind: "runs_inbox"; readonly limit?: number }
  | {
      readonly kind: "occurrences";
      readonly projectId: string;
      readonly windowStart: string;
      readonly windowEnd: string;
    };

export type AutomationReadValue =
  | {
      readonly kind: "definitions";
      readonly items: readonly CodexScheduledAutomation[];
    }
  | {
      readonly kind: "definition";
      readonly item: CodexScheduledAutomation;
    }
  | {
      readonly kind: "runs_inbox";
      readonly leases: readonly AutomationLease[];
    }
  | {
      readonly kind: "occurrences";
      readonly occurrenceIds: readonly string[];
    };

export interface AutomationLease {
  readonly leaseId: string;
  readonly automationId: string;
  readonly attempt: number;
  readonly expiresAt: string;
}

export type AutomationIntent =
  | {
      readonly kind: "create_definition";
      readonly definition: CodexScheduledAutomationCreateInput;
    }
  | {
      readonly kind: "update_definition";
      readonly definition: CodexScheduledAutomationUpdateInput;
    }
  | { readonly kind: "delete_definition"; readonly automationId: string }
  | {
      readonly kind: "claim_due";
      readonly dueBefore: string;
      readonly limit: number;
      readonly leaseDurationMs: number;
    }
  | {
      readonly kind: "complete_lease";
      readonly leaseId: string;
      readonly completedAt: string;
    }
  | {
      readonly kind: "fail_lease";
      readonly leaseId: string;
      readonly failedAt: string;
      readonly retryAt?: string;
      readonly reasonCode: string;
    }
  | {
      readonly kind: "complete_occurrence";
      readonly request: PageOccurrenceCompleteInput;
    }
  | {
      readonly kind: "update_occurrence";
      readonly request: PageOccurrenceUpdateInput;
    }
  | {
      readonly kind: "consume_reminder";
      readonly reminderId: string;
      readonly consumedAt: string;
    }
  | {
      readonly kind: "snooze_reminder";
      readonly reminderId: string;
      readonly wakeAt: string;
    };

export interface AutomationCommitValue {
  readonly affectedAutomationIds: readonly string[];
  readonly affectedOccurrenceIds: readonly string[];
  readonly claimedLeases: readonly AutomationLease[];
}

export interface AutomationReceipt extends ModuleMutationReceipt {
  readonly affectedAutomationIds: readonly string[];
  readonly affectedOccurrenceIds: readonly string[];
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
  readonly occurrenceIds: readonly string[];
  readonly leaseIds: readonly string[];
}
