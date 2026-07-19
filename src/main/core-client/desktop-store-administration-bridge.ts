import { randomUUID } from "node:crypto";

import type {
  BackupRecord,
  CreateBackupInput,
  RestoreBackupInput,
  RestoreBackupResult,
} from "../../shared/types";
import type { DesktopDataAuthorityRuntime } from "./desktop-data-authority";
import type {
  CoreClientPort,
  CoreEventEnvelope,
  StoreAdministrationCommittedValue,
  StoreAdministrationIntent,
} from "./types";

type CoreBackupRecord = Extract<
  Awaited<ReturnType<CoreClientPort["administrationRead"]>>["value"],
  { readonly kind: "backups" }
>["items"][number];

export type DesktopStoreMaintenanceTask = Extract<
  StoreAdministrationIntent,
  { readonly kind: "run_maintenance" }
>["tasks"][number];

export interface DesktopStoreAdministrationPort {
  listBackups(): Promise<BackupRecord[]>;
  createBackup(input?: CreateBackupInput): Promise<BackupRecord>;
  deleteBackup(
    backupId: string,
  ): Promise<{ success: true; deletedBackupId: string }>;
  restoreBackup(input: RestoreBackupInput): Promise<RestoreBackupResult>;
  pruneBackups(retainCount: number): Promise<void>;
  runMaintenance(tasks: readonly DesktopStoreMaintenanceTask[]): Promise<void>;
}

export interface DesktopStoreAdministrationBridgeInput {
  readonly authority: Promise<DesktopDataAuthorityRuntime>;
  readonly typescript: DesktopStoreAdministrationPort;
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
  committed: StoreAdministrationCommittedValue,
): string => {
  const backupId = committed.value.backup_id;
  if (backupId) return backupId;
  throw new Error("Core Store Administration commit omitted its Backup identity");
};

const createCorePort = (
  client: CoreClientPort,
): DesktopStoreAdministrationPort => {
  const listBackups = async (): Promise<BackupRecord[]> => {
    const snapshot = await client.administrationRead({ kind: "backups" });
    if (snapshot.value.kind !== "backups") {
      throw new Error("Core returned a non-Backup Store Administration read");
    }
    return snapshot.value.items.map(mapBackup);
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
        ...(committed.value.safety_backup_id
          ? { safetyBackupId: committed.value.safety_backup_id }
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
    runMaintenance: async (tasks) => {
      await client.administrationApply({
        operationId: operationId("run-maintenance"),
        intent: { kind: "run_maintenance", tasks: [...tasks] },
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
    if (runtime.backend === "typescript") return input.typescript;
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
    runMaintenance: async (tasks) =>
      await (await resolve()).runMaintenance(tasks),
  };
}

export function mapCoreStoreAdministrationEvent(
  envelope: CoreEventEnvelope,
): CoreStoreAdministrationInvalidation | null {
  const payload = envelope.event.payload;
  if (payload.module !== "store_administration") return null;
  return {
    backupIds: payload.event.backup_ids,
    readinessChanged: payload.event.readiness_changed,
  };
}
