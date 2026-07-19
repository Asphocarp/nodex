import type { BackupRecord, BackupTrigger } from "../types";
import type {
  CommittedModuleValue,
  CoreModuleResult,
  DeepCoreModule,
  ModuleApplyRequest,
  ModuleMutationReceipt,
  ModuleReadRequest,
  ModuleReadSnapshot,
} from "./common";

export type StoreAdministrationRead =
  | { readonly kind: "status" }
  | { readonly kind: "backups" }
  | { readonly kind: "maintenance_status" };

export type StoreAdministrationReadValue =
  | {
      readonly kind: "status";
      readonly readiness: "starting" | "ready" | "maintenance" | "failed";
      readonly schemaVersion: number;
      readonly schemaOwner: "typescript" | "rust";
      readonly integrity: "unknown" | "ok" | "failed";
    }
  | { readonly kind: "backups"; readonly items: readonly BackupRecord[] }
  | {
      readonly kind: "maintenance_status";
      readonly active: boolean;
      readonly operationId: string | null;
      readonly phase: string | null;
    };

export type StoreAdministrationIntent =
  | {
      readonly kind: "create_backup";
      readonly label?: string;
      readonly includeAssets: boolean;
      readonly trigger: BackupTrigger;
    }
  | {
      readonly kind: "restore_backup";
      readonly backupId: string;
      readonly createSafetyBackup: boolean;
    }
  | { readonly kind: "delete_backup"; readonly backupId: string }
  | { readonly kind: "prune_backups"; readonly retainCount: number }
  | {
      readonly kind: "run_maintenance";
      readonly tasks: readonly (
        | "integrity_check"
        | "foreign_key_check"
        | "document_revision_finalize"
        | "document_compaction"
        | "history_retention"
        | "block_retention"
      )[];
      readonly blockRetentionCount?: number;
    };

export interface StoreAdministrationCommitValue {
  readonly backupId: string | null;
  readonly safetyBackupId: string | null;
  readonly completedTasks: readonly string[];
}

export interface StoreAdministrationReceipt extends ModuleMutationReceipt {
  readonly backupId: string | null;
  readonly safetyBackupId: string | null;
}

export type StoreAdministrationModuleReadRequest =
  ModuleReadRequest<StoreAdministrationRead>;
export type StoreAdministrationModuleReadResult = CoreModuleResult<
  ModuleReadSnapshot<StoreAdministrationReadValue>
>;
export type StoreAdministrationModuleApplyRequest =
  ModuleApplyRequest<StoreAdministrationIntent>;
export type StoreAdministrationModuleApplyResult = CoreModuleResult<
  CommittedModuleValue<
    StoreAdministrationCommitValue,
    StoreAdministrationReceipt
  >
>;

export type StoreAdministrationModule = DeepCoreModule<
  StoreAdministrationModuleReadRequest,
  StoreAdministrationModuleReadResult,
  StoreAdministrationModuleApplyRequest,
  StoreAdministrationModuleApplyResult
>;

export interface StoreAdministrationEvent {
  readonly kind: "store_administration_changed";
  readonly operation: StoreAdministrationIntent["kind"];
  readonly backupIds: readonly string[];
  readonly readinessChanged: boolean;
}
