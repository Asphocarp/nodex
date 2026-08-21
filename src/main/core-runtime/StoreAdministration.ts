import { randomUUID } from "node:crypto";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type {
  BackupRecord,
  CreateBackupInput,
  RestoreBackupInput,
  RestoreBackupResult,
} from "../../shared/types";
import type {
  CoreAuthorizedDeliveryAtom,
  StoreAdministrationApplyResult,
  StoreAdministrationIntent,
  StoreAdministrationReadSnapshot,
} from "../core-client/types";
import { CoreModules } from "./CoreModules";
import {
  projectCoreStoreAdministrationEvent,
  type CoreStoreAdministrationInvalidation,
} from "./CoreApplicationEventProjection";

type CoreBackupRecord = Extract<
  StoreAdministrationReadSnapshot["value"],
  { readonly kind: "backups" }
>["backups"]["items"][number];

export type StoreMaintenanceTask = Extract<
  StoreAdministrationIntent,
  { readonly kind: "run_maintenance" }
>["tasks"][number];

export interface StoreMaintenanceInput {
  readonly tasks: readonly StoreMaintenanceTask[];
  readonly blockRetentionCount?: number;
}

export type { CoreStoreAdministrationInvalidation } from "./CoreApplicationEventProjection";

export class StoreAdministrationError extends Schema.TaggedError<StoreAdministrationError>()(
  "StoreAdministrationError",
  {
    operation: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export class StoreAdministration extends Context.Service<
  StoreAdministration,
  {
    readonly listBackups: Effect.Effect<readonly BackupRecord[], StoreAdministrationError>;
    readonly createBackup: (
      input?: CreateBackupInput,
    ) => Effect.Effect<BackupRecord, StoreAdministrationError>;
    readonly deleteBackup: (
      backupId: string,
    ) => Effect.Effect<
      { readonly success: true; readonly deletedBackupId: string },
      StoreAdministrationError
    >;
    readonly restoreBackup: (
      input: RestoreBackupInput,
    ) => Effect.Effect<RestoreBackupResult, StoreAdministrationError>;
    readonly pruneBackups: (retainCount: number) => Effect.Effect<void, StoreAdministrationError>;
    readonly runMaintenance: (
      input: StoreMaintenanceInput,
    ) => Effect.Effect<void, StoreAdministrationError>;
  }
>()("nodex/main/core-runtime/StoreAdministration") {}

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

const operationId = (kind: string): string => `electron:administration:${kind}:${randomUUID()}`;

export const mapCoreStoreAdministrationEvent = (
  effect: CoreAuthorizedDeliveryAtom,
): CoreStoreAdministrationInvalidation | null => projectCoreStoreAdministrationEvent(effect);

export const live: Layer.Layer<StoreAdministration, never, CoreModules> = Layer.effect(
  StoreAdministration,
  Effect.gen(function* () {
    const core = yield* CoreModules;
    const error = (operation: string, cause: unknown): StoreAdministrationError =>
      new StoreAdministrationError({ operation, cause });
    const apply = (
      operation: string,
      input: Parameters<typeof core.administration.apply>[0],
    ): Effect.Effect<StoreAdministrationApplyResult, StoreAdministrationError> =>
      core.administration.apply(input).pipe(Effect.mapError((cause) => error(operation, cause)));

    const listBackups = Effect.gen(function* () {
      const snapshot = yield* core.administration
        .read({ kind: "backups", window: { after: null, first: 200 } })
        .pipe(Effect.mapError((cause) => error("list-backups", cause)));
      if (snapshot.value.kind !== "backups") {
        return yield* error(
          "list-backups",
          new Error("Core returned a non-Backup Store Administration read"),
        );
      }
      if (snapshot.value.backups.next_cursor) {
        return yield* error(
          "list-backups",
          new Error("Backup collection exceeded its fixed Core bound"),
        );
      }
      return snapshot.value.backups.items.map(mapBackup);
    }).pipe(Effect.withSpan("StoreAdministration.listBackups"));

    const requireBackupId = Effect.fn("StoreAdministration.requireBackupId")(function* (
      operation: string,
      committed: StoreAdministrationApplyResult,
    ) {
      const backupId = committed.outcome.backup_id;
      if (backupId) return backupId;
      return yield* error(
        operation,
        new Error("Core Store Administration commit omitted its Backup identity"),
      );
    });

    const createBackup = Effect.fn("StoreAdministration.createBackup")(function* (
      input: CreateBackupInput = {},
    ) {
      const committed = yield* apply("create-backup", {
        operationId: operationId("create-backup"),
        intent: {
          kind: "create_backup",
          label: input.label?.trim() || null,
          include_assets: true,
          trigger: input.trigger ?? "manual",
        },
      });
      const backupId = yield* requireBackupId("create-backup", committed);
      const created = (yield* listBackups).find((backup) => backup.id === backupId);
      if (created) return created;
      return yield* error(
        "create-backup",
        new Error("Core Backup commit is missing from the durable inventory"),
      );
    });

    const deleteBackup = Effect.fn("StoreAdministration.deleteBackup")(function* (
      backupId: string,
    ) {
      yield* apply("delete-backup", {
        operationId: operationId(`delete-backup:${backupId}`),
        intent: { kind: "delete_backup", backup_id: backupId },
      });
      return { success: true as const, deletedBackupId: backupId };
    });

    const restoreBackup = Effect.fn("StoreAdministration.restoreBackup")(function* (
      input: RestoreBackupInput,
    ) {
      if (!input.confirm) {
        return yield* error(
          "restore-backup",
          new Error("Backup restore requires explicit confirmation"),
        );
      }
      const committed = yield* apply("restore-backup", {
        operationId: operationId(`restore-backup:${input.backupId}`),
        intent: {
          kind: "restore_backup",
          backup_id: input.backupId,
          create_safety_backup: input.createSafetyBackup !== false,
        },
      });
      const restoredBackupId = yield* requireBackupId("restore-backup", committed);
      return {
        success: true as const,
        restoredBackupId,
        ...(committed.outcome.safety_backup_id
          ? { safetyBackupId: committed.outcome.safety_backup_id }
          : {}),
      };
    });

    const pruneBackups = Effect.fn("StoreAdministration.pruneBackups")(function* (
      retainCount: number,
    ) {
      yield* apply("prune-backups", {
        operationId: operationId("prune-backups"),
        intent: {
          kind: "prune_backups",
          retain_count: Math.max(0, Math.trunc(retainCount)),
        },
      });
    });

    const runMaintenance = Effect.fn("StoreAdministration.runMaintenance")(function* (
      input: StoreMaintenanceInput,
    ) {
      yield* apply("run-maintenance", {
        operationId: operationId("run-maintenance"),
        intent: {
          kind: "run_maintenance",
          tasks: [...input.tasks],
          ...(input.blockRetentionCount === undefined
            ? {}
            : { block_retention_count: Math.max(0, Math.trunc(input.blockRetentionCount)) }),
        },
      });
    });

    return StoreAdministration.of({
      listBackups,
      createBackup,
      deleteBackup,
      restoreBackup,
      pruneBackups,
      runMaintenance,
    });
  }),
);
