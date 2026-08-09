import { randomUUID } from "node:crypto";

import type {
  BackupRecord,
  CreateBackupInput,
  RestoreBackupInput,
  RestoreBackupResult,
} from "../../shared/types";
import type { DesktopDataAuthorityRuntime } from "./desktop-data-authority";
import {
  type CoreAuthorizedDeliveryAtom,
  type CoreClientPort,
  type StoreAdministrationApplyResult,
  type StoreAdministrationIntent,
} from "./types";

type CoreBackupRecord = Extract<
  Awaited<ReturnType<CoreClientPort["administrationRead"]>>["value"],
  { readonly kind: "backups" }
>["backups"]["items"][number];

export type DesktopStoreMaintenanceTask = Extract<
  StoreAdministrationIntent,
  { readonly kind: "run_maintenance" }
>["tasks"][number];

export interface DesktopStoreMaintenanceInput {
  readonly tasks: readonly DesktopStoreMaintenanceTask[];
  readonly blockRetentionCount?: number;
}

export interface DesktopStoreAdministrationPort {
  listBackups(): Promise<BackupRecord[]>;
  createBackup(input?: CreateBackupInput): Promise<BackupRecord>;
  deleteBackup(
    backupId: string,
  ): Promise<{ success: true; deletedBackupId: string }>;
  restoreBackup(input: RestoreBackupInput): Promise<RestoreBackupResult>;
  pruneBackups(retainCount: number): Promise<void>;
  runMaintenance(input: DesktopStoreMaintenanceInput): Promise<void>;
}

export interface DesktopStoreAdministrationBridgeInput {
  readonly authority: Promise<DesktopDataAuthorityRuntime>;
}

export interface CoreStoreAdministrationInvalidation {
  readonly backupIds: readonly string[];
  readonly readinessChanged: boolean;
}

const operationId = (kind: string): string =>
  `electron:administration:${kind}:${randomUUID()}`;

const mapBackup = (backup: CoreBackupRecord): BackupRecord => ({
  version: backup.version,
  id: backup.backup_id,
  createdAt: backup.created_at,
  trigger: backup.trigger,
  label: backup.label ?? null,
  includesAssets: backup.includes_assets,
  dbBytes: backup.db_bytes,
  assetsBytes: backup.assets_bytes,
  totalBytes: backup.total_bytes,
});

const requireBackupId = (
  committed: StoreAdministrationApplyResult,
): string => {
  const backupId = committed.outcome.backup_id;
  if (backupId) return backupId;
  throw new Error("Core Store Administration commit omitted its Backup identity");
};

const createCorePort = (
  client: CoreClientPort,
): DesktopStoreAdministrationPort => {
  const listBackups = async (): Promise<BackupRecord[]> => {
    const snapshot = await client.administrationRead({
      kind: "backups",
      window: { after: null, first: 200 },
    });
    if (snapshot.value.kind !== "backups") {
      throw new Error("Core returned a non-Backup Store Administration read");
    }
    if (snapshot.value.backups.next_cursor) {
      throw new Error("Backup collection exceeded its fixed Core bound");
    }
    return snapshot.value.backups.items.map(mapBackup);
  };

  return {
    listBackups,
    createBackup: async (input = {}) => {
      const committed = await client.administrationApply({
        operationId: operationId("create-backup"),
        intent: {
          kind: "create_backup",
          label: input.label?.trim() || null,
          include_assets: true,
          trigger: input.trigger ?? "manual",
        },
      });
      const backupId = requireBackupId(committed);
      const created = (await listBackups()).find((backup) =>
        backup.id === backupId
      );
      if (created) return created;
      throw new Error("Core Backup commit is missing from the durable inventory");
    },
    deleteBackup: async (backupId) => {
      await client.administrationApply({
        operationId: operationId(`delete-backup:${backupId}`),
        intent: { kind: "delete_backup", backup_id: backupId },
      });
      return { success: true, deletedBackupId: backupId };
    },
    restoreBackup: async (input) => {
      if (!input.confirm) {
        throw new Error("Backup restore requires explicit confirmation");
      }
      const committed = await client.administrationApply({
        operationId: operationId(`restore-backup:${input.backupId}`),
        intent: {
          kind: "restore_backup",
          backup_id: input.backupId,
          create_safety_backup: input.createSafetyBackup !== false,
        },
      });
      return {
        success: true,
        restoredBackupId: requireBackupId(committed),
        ...(committed.outcome.safety_backup_id
          ? { safetyBackupId: committed.outcome.safety_backup_id }
          : {}),
      };
    },
    pruneBackups: async (retainCount) => {
      await client.administrationApply({
        operationId: operationId("prune-backups"),
        intent: {
          kind: "prune_backups",
          retain_count: Math.max(0, Math.trunc(retainCount)),
        },
      });
    },
    runMaintenance: async (input) => {
      await client.administrationApply({
        operationId: operationId("run-maintenance"),
        intent: {
          kind: "run_maintenance",
          tasks: [...input.tasks],
          ...(input.blockRetentionCount === undefined
            ? {}
            : {
                block_retention_count: Math.max(
                  0,
                  Math.trunc(input.blockRetentionCount),
                ),
              }),
        },
      });
    },
  };
};

export function createDesktopStoreAdministrationBridge(
  input: DesktopStoreAdministrationBridgeInput,
): DesktopStoreAdministrationPort {
  let corePort: DesktopStoreAdministrationPort | null = null;
  const resolve = async (): Promise<DesktopStoreAdministrationPort> => {
    const runtime = await input.authority;
    corePort ??= createCorePort(runtime.rootClient);
    return corePort;
  };

  return {
    listBackups: async () => await (await resolve()).listBackups(),
    createBackup: async (backupInput) =>
      await (await resolve()).createBackup(backupInput),
    deleteBackup: async (backupId) =>
      await (await resolve()).deleteBackup(backupId),
    restoreBackup: async (restoreInput) =>
      await (await resolve()).restoreBackup(restoreInput),
    pruneBackups: async (retainCount) =>
      await (await resolve()).pruneBackups(retainCount),
    runMaintenance: async (maintenanceInput) =>
      await (await resolve()).runMaintenance(maintenanceInput),
  };
}

export function mapCoreStoreAdministrationEvent(
  effect: CoreAuthorizedDeliveryAtom,
): CoreStoreAdministrationInvalidation | null {
  const payload = effect.payload;
  if (payload.module !== "store_administration") return null;
  return {
    backupIds: payload.event.backup_ids,
    readinessChanged: payload.event.readiness_changed,
  };
}
