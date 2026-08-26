import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import type {
  BackupCapacity,
  BackupJobStatus,
  BackupRecord,
  CreateBackupInput,
  RestoreBackupInput,
  RestoreBackupResult,
  SnapshotStorageOptimization,
} from "../../shared/types";
import type {
  CoreAuthorizedDeliveryAtom,
  StoreAdministrationApplyResult,
  StoreAdministrationIntent,
  StoreAdministrationReadSnapshot,
} from "../core-client/types";
import { CoreModules } from "./CoreModules";
import { createDueWorkOperationId, createOperationId } from "./operation-identity";
import {
  projectCoreStoreAdministrationEvent,
  type CoreStoreAdministrationInvalidation,
} from "./CoreApplicationEventProjection";

type CoreBackupRecord = Extract<
  StoreAdministrationReadSnapshot["value"],
  { readonly kind: "backups" }
>["backups"]["items"][number];

type CoreBackupCapacity = Extract<
  StoreAdministrationReadSnapshot["value"],
  { readonly kind: "backups" }
>["capacity"];

type CoreBackupJob = Extract<
  StoreAdministrationReadSnapshot["value"],
  { readonly kind: "backup_jobs" }
>["jobs"][number];

type CoreOperationalJournalStatus = Extract<
  StoreAdministrationReadSnapshot["value"],
  { readonly kind: "operational_journal_status" }
>["status"];

const mapCoreBackupJobState = (state: CoreBackupJob["state"]): BackupJobStatus["state"] => {
  switch (state) {
    case "running":
    case "cancelling":
      return "running";
    case "cancelled":
      return "cancelled";
    case "ready":
      return "completed";
    case "failed":
      return "failed";
  }
};

export type StoreMaintenanceTask = Extract<
  StoreAdministrationIntent,
  { readonly kind: "run_maintenance" }
>["tasks"][number];

export interface StoreMaintenanceInput {
  readonly tasks: readonly StoreMaintenanceTask[];
  readonly blockRetentionCount?: number;
  readonly workToken?: string;
}

export interface StoreMaintenancePlan {
  readonly dueTasks: readonly StoreMaintenanceTask[];
  readonly nextWakeAt: number | null;
  readonly workToken: string | null;
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
    readonly backupCapacity: Effect.Effect<BackupCapacity, StoreAdministrationError>;
    readonly snapshotStorageOptimization: Effect.Effect<
      SnapshotStorageOptimization,
      StoreAdministrationError
    >;
    readonly createBackup: (
      input?: CreateBackupInput,
    ) => Effect.Effect<BackupRecord, StoreAdministrationError>;
    readonly startBackup: (
      input?: CreateBackupInput,
    ) => Effect.Effect<BackupJobStatus, StoreAdministrationError>;
    readonly backupJob: (
      jobId?: string,
    ) => Effect.Effect<BackupJobStatus | null, StoreAdministrationError>;
    readonly cancelBackup: (
      jobId: string,
    ) => Effect.Effect<BackupJobStatus, StoreAdministrationError>;
    readonly deleteBackup: (
      backupId: string,
    ) => Effect.Effect<
      { readonly success: true; readonly deletedBackupId: string },
      StoreAdministrationError
    >;
    readonly restoreBackup: (
      input: RestoreBackupInput,
    ) => Effect.Effect<RestoreBackupResult, StoreAdministrationError>;
    readonly pruneBackups: (
      retainCount: number,
      retainBytes: number,
    ) => Effect.Effect<void, StoreAdministrationError>;
    readonly planMaintenance: (
      input: StoreMaintenanceInput,
    ) => Effect.Effect<StoreMaintenancePlan, StoreAdministrationError>;
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

const mapBackupCapacity = (capacity: CoreBackupCapacity): BackupCapacity => ({
  availableBytes: capacity.available_bytes,
  estimatedNextBackupBytes: capacity.estimated_next_backup_bytes,
  safetyMarginBytes: capacity.safety_margin_bytes,
  totalReadyBytes: capacity.total_ready_bytes,
  manualReadyBytes: capacity.manual_ready_bytes,
  automaticReadyBytes: capacity.automatic_ready_bytes,
  canCreate: capacity.can_create,
});

const mapOperationalJournalStatus = (
  status: CoreOperationalJournalStatus,
): SnapshotStorageOptimization => ({
  optimizing: status.optimizing,
  commitHead: status.commit_head_seq,
  replayFloor: status.replay_floor_seq,
  pendingCommitMetadata: status.pending_commit_metadata,
  pendingReceiptMetadata: status.pending_receipt_metadata,
  retainedCommitCount: status.retained_commit_count,
  retainedDeliveryBytes: status.retained_delivery_bytes,
  retainedReceiptCount: status.retained_receipt_count,
  retainedReceiptBytes: status.retained_receipt_bytes,
  receiptFloorAt: status.receipt_floor_at ?? null,
  lastPrunedCommit: status.last_pruned_commit_seq,
  freelistPages: status.freelist_pages,
  reclaimableBytes: status.reclaimable_bytes,
});

const emptyBackupProgress = (): BackupJobStatus["progress"] => ({
  databaseCopiedPages: 0,
  databaseTotalPages: 0,
  databaseBusyRetries: 0,
  assetBytesCopied: 0,
  databaseCopyMs: 0,
  assetCopyMs: 0,
  validationMs: 0,
  digestMs: 0,
  publishMs: 0,
  writerHeldMs: 0,
});

const operationId = (kind: string): string => createOperationId(`administration.${kind}`);

export const mapCoreStoreAdministrationEvent = (
  effect: CoreAuthorizedDeliveryAtom,
): CoreStoreAdministrationInvalidation | null => projectCoreStoreAdministrationEvent(effect);

export const live: Layer.Layer<StoreAdministration, never, CoreModules> = Layer.effect(
  StoreAdministration,
  Effect.gen(function* () {
    const core = yield* CoreModules;
    const backupJobs = yield* Ref.make<ReadonlyMap<string, BackupJobStatus>>(new Map());
    const latestBackupJobId = yield* Ref.make<string | null>(null);
    const backupFibers = yield* FiberMap.make<string, void, never>();
    const error = (operation: string, cause: unknown): StoreAdministrationError =>
      new StoreAdministrationError({ operation, cause });
    const apply = (
      operation: string,
      input: Parameters<typeof core.administration.apply>[0],
    ): Effect.Effect<StoreAdministrationApplyResult, StoreAdministrationError> =>
      core.administration.apply(input).pipe(Effect.mapError((cause) => error(operation, cause)));

    const readBackupOverview = Effect.gen(function* () {
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
      return {
        backups: snapshot.value.backups.items.map(mapBackup),
        capacity: mapBackupCapacity(snapshot.value.capacity),
      };
    }).pipe(Effect.withSpan("StoreAdministration.readBackupOverview"));

    const listBackups = readBackupOverview.pipe(Effect.map(({ backups }) => backups));
    const backupCapacity = readBackupOverview.pipe(Effect.map(({ capacity }) => capacity));
    const snapshotStorageOptimization = core.administration
      .read({ kind: "operational_journal_status" })
      .pipe(
        Effect.mapError((cause) => error("read-operational-journal-status", cause)),
        Effect.flatMap((snapshot) =>
          snapshot.value.kind === "operational_journal_status"
            ? Effect.succeed(mapOperationalJournalStatus(snapshot.value.status))
            : Effect.fail(
                error(
                  "read-operational-journal-status",
                  new Error("Core returned a non-journal Store Administration read"),
                ),
              ),
        ),
      );

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

    const executeBackup = Effect.fn("StoreAdministration.executeBackup")(function* (
      operationIdentifier: string,
      input: CreateBackupInput = {},
    ) {
      const committed = yield* apply("create-backup", {
        operationId: operationIdentifier,
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

    const createBackup = Effect.fn("StoreAdministration.createBackup")(function* (
      input: CreateBackupInput = {},
    ) {
      return yield* executeBackup(operationId("create-backup"), input);
    });

    const readCoreBackupJobs = Effect.gen(function* () {
      const snapshot = yield* core.administration
        .read({ kind: "backup_jobs" })
        .pipe(Effect.mapError((cause) => error("read-backup-jobs", cause)));
      if (snapshot.value.kind !== "backup_jobs") {
        return yield* error(
          "read-backup-jobs",
          new Error("Core returned a non-BackupJobs Store Administration read"),
        );
      }
      return snapshot.value.jobs;
    });

    const mapCoreBackupJob = (
      job: CoreBackupJob,
      backup: BackupRecord | null = null,
    ): BackupJobStatus => ({
      jobId: job.job_id,
      state: mapCoreBackupJobState(job.state),
      phase: job.phase,
      completedUnits: job.completed_units,
      totalUnits: job.total_units,
      startedAt: job.started_at_ms,
      updatedAt: job.updated_at_ms,
      backup,
      error: job.error ?? null,
      progress: {
        databaseCopiedPages: job.progress.database_copied_pages,
        databaseTotalPages: job.progress.database_total_pages,
        databaseBusyRetries: job.progress.database_busy_retries,
        assetBytesCopied: job.progress.asset_bytes_copied,
        databaseCopyMs: job.progress.database_copy_ms,
        assetCopyMs: job.progress.asset_copy_ms,
        validationMs: job.progress.validation_ms,
        digestMs: job.progress.digest_ms,
        publishMs: job.progress.publish_ms,
        writerHeldMs: job.progress.writer_held_ms,
      },
    });

    const trimBackupJobs = (
      jobs: ReadonlyMap<string, BackupJobStatus>,
    ): ReadonlyMap<string, BackupJobStatus> => {
      if (jobs.size <= 32) return jobs;
      const terminal = [...jobs.values()]
        .filter(
          (job) => job.state === "completed" || job.state === "failed" || job.state === "cancelled",
        )
        .sort((left, right) => left.updatedAt - right.updatedAt);
      if (terminal.length === 0) return jobs;
      const next = new Map(jobs);
      next.delete(terminal[0]!.jobId);
      return trimBackupJobs(next);
    };

    const updateBackupJob = (
      jobId: string,
      update: (current: BackupJobStatus) => BackupJobStatus,
    ): Effect.Effect<void> =>
      Ref.update(backupJobs, (current) => {
        const job = current.get(jobId);
        if (!job) return current;
        const next = new Map(current);
        next.set(jobId, update(job));
        return trimBackupJobs(next);
      });

    const launchBackup = Effect.fn("StoreAdministration.launchBackup")(function* (
      jobId: string,
      operationIdentifier: string,
      input: CreateBackupInput,
    ) {
      const observeCorePhase = Effect.forever(
        readCoreBackupJobs.pipe(
          Effect.tap((jobs) => {
            const durable = jobs.find((job) => job.operation_id === operationIdentifier);
            if (!durable) return Effect.void;
            return updateBackupJob(jobId, (job) => ({
              ...job,
              ...mapCoreBackupJob(durable, job.backup),
              jobId,
            }));
          }),
          Effect.catch(() => Effect.void),
          Effect.andThen(Effect.sleep(250)),
        ),
      );
      const runJob = Effect.scoped(
        Effect.gen(function* () {
          const startedAt = yield* Clock.currentTimeMillis;
          yield* updateBackupJob(jobId, (job) => ({
            ...job,
            state: "running",
            phase: job.state === "queued" ? "preparing" : job.phase,
            updatedAt: startedAt,
          }));
          yield* observeCorePhase.pipe(Effect.forkScoped);
          const backup = yield* executeBackup(operationIdentifier, input);
          const completedAt = yield* Clock.currentTimeMillis;
          yield* updateBackupJob(jobId, (job) => ({
            ...job,
            state: "completed",
            phase: "ready",
            updatedAt: completedAt,
            backup,
            error: null,
          }));
        }),
      ).pipe(
        Effect.catch((failure) =>
          Effect.gen(function* () {
            const durableJobs = yield* readCoreBackupJobs.pipe(Effect.orElseSucceed(() => []));
            const durable = durableJobs.find((job) => job.operation_id === operationIdentifier);
            if (durable) {
              yield* updateBackupJob(jobId, () => mapCoreBackupJob(durable));
              return;
            }
            const failedAt = yield* Clock.currentTimeMillis;
            yield* updateBackupJob(jobId, (job) => ({
              ...job,
              state: "failed",
              phase: "failed",
              updatedAt: failedAt,
              error:
                failure.cause instanceof Error
                  ? failure.cause.message
                  : "Snapshot creation failed.",
            }));
          }),
        ),
      );
      yield* FiberMap.run(backupFibers, jobId, runJob, { startImmediately: true });
    });

    const awaitDurableBackupAdmission = Effect.fn(
      "StoreAdministration.awaitDurableBackupAdmission",
    )(function* (operationIdentifier: string, deadline: number) {
      while (true) {
        const jobs = yield* readCoreBackupJobs;
        const durable = jobs.find((job) => job.operation_id === operationIdentifier);
        if (durable) return durable;
        if ((yield* Clock.currentTimeMillis) >= deadline) {
          return yield* error(
            "start-backup",
            new Error("Core did not durably admit the snapshot job within 250 ms"),
          );
        }
        yield* Effect.sleep(10);
      }
    });

    const startBackup = Effect.fn("StoreAdministration.startBackup")(function* (
      input: CreateBackupInput = {},
    ) {
      const now = yield* Clock.currentTimeMillis;
      const operationIdentifier = operationId("create-backup-job");
      const jobId = operationIdentifier;
      const queued: BackupJobStatus = {
        jobId,
        state: "queued",
        phase: "queued",
        completedUnits: 0,
        totalUnits: 7,
        startedAt: now,
        updatedAt: now,
        backup: null,
        error: null,
        progress: emptyBackupProgress(),
      };
      const admitted = yield* Ref.modify(
        backupJobs,
        (
          current,
        ): readonly [
          { readonly job: BackupJobStatus; readonly created: boolean },
          ReadonlyMap<string, BackupJobStatus>,
        ] => {
          const active = [...current.values()].find(
            (job) => job.state === "queued" || job.state === "running",
          );
          if (active) return [{ job: active, created: false } as const, current] as const;
          const next = new Map(current);
          next.set(jobId, queued);
          return [{ job: queued, created: true } as const, trimBackupJobs(next)] as const;
        },
      );
      if (!admitted.created) return admitted.job;
      yield* Ref.set(latestBackupJobId, jobId);

      yield* launchBackup(jobId, operationIdentifier, input);
      const durable = yield* awaitDurableBackupAdmission(operationIdentifier, now + 250);
      const admittedJob = mapCoreBackupJob(durable);
      yield* Ref.update(backupJobs, (current) => {
        const next = new Map(current);
        next.set(jobId, admittedJob);
        return trimBackupJobs(next);
      });
      return admittedJob;
    });

    const backupJob = Effect.fn("StoreAdministration.backupJob")(function* (jobId?: string) {
      const selectedId = jobId ?? (yield* Ref.get(latestBackupJobId));
      if (!selectedId) return null;
      return (yield* Ref.get(backupJobs)).get(selectedId) ?? null;
    });

    const cancelBackup = Effect.fn("StoreAdministration.cancelBackup")(function* (jobId: string) {
      yield* apply("cancel-backup", {
        operationId: operationId(`cancel-backup:${jobId}`),
        intent: { kind: "cancel_backup", job_id: jobId },
      });
      const durableJobs = yield* readCoreBackupJobs;
      const durable = durableJobs.find((job) => job.job_id === jobId);
      if (!durable) {
        return yield* error(
          "cancel-backup",
          new Error("Core cancelled a Snapshot job without returning its durable state"),
        );
      }
      const cancelled = mapCoreBackupJob(durable);
      yield* Ref.update(backupJobs, (current) => {
        const next = new Map(current);
        next.set(jobId, cancelled);
        return trimBackupJobs(next);
      });
      return cancelled;
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
      retainBytes: number,
    ) {
      yield* apply("prune-backups", {
        operationId: operationId("prune-backups"),
        intent: {
          kind: "prune_backups",
          retain_count: Math.max(0, Math.trunc(retainCount)),
          retain_bytes: Math.max(0, Math.trunc(retainBytes)),
        },
      });
    });

    const runMaintenance = Effect.fn("StoreAdministration.runMaintenance")(function* (
      input: StoreMaintenanceInput,
    ) {
      yield* apply("run-maintenance", {
        operationId: input.workToken
          ? createDueWorkOperationId("administration.run-maintenance", input.workToken, {
              tasks: input.tasks,
              blockRetentionCount: input.blockRetentionCount ?? null,
            })
          : operationId("run-maintenance"),
        intent: {
          kind: "run_maintenance",
          tasks: [...input.tasks],
          work_token: input.workToken ?? null,
          ...(input.blockRetentionCount === undefined
            ? {}
            : { block_retention_count: Math.max(0, Math.trunc(input.blockRetentionCount)) }),
        },
      });
    });

    const planMaintenance = Effect.fn("StoreAdministration.planMaintenance")(function* (
      input: StoreMaintenanceInput,
    ) {
      const snapshot = yield* core.administration
        .read({
          kind: "maintenance_plan",
          tasks: [...input.tasks],
          block_retention_count:
            input.blockRetentionCount === undefined
              ? null
              : Math.max(0, Math.trunc(input.blockRetentionCount)),
        })
        .pipe(Effect.mapError((cause) => error("plan-maintenance", cause)));
      if (snapshot.value.kind !== "maintenance_plan") {
        return yield* error(
          "plan-maintenance",
          new Error("Core returned a non-MaintenancePlan Store Administration read"),
        );
      }
      return {
        dueTasks: snapshot.value.plan.due_tasks,
        nextWakeAt: snapshot.value.plan.next_wake_at_ms ?? null,
        workToken: snapshot.value.plan.work_token ?? null,
      };
    });

    const recoveredJobs = yield* readCoreBackupJobs.pipe(
      Effect.catchCause(() => Effect.succeed([])),
    );
    for (const job of recoveredJobs) {
      if (job.state !== "cancelling") continue;
      yield* cancelBackup(job.job_id).pipe(Effect.catchCause(() => Effect.void));
    }
    const settledRecoveredJobs = recoveredJobs.some((job) => job.state === "cancelling")
      ? yield* readCoreBackupJobs.pipe(Effect.catchCause(() => Effect.succeed(recoveredJobs)))
      : recoveredJobs;
    if (settledRecoveredJobs.length > 0) {
      const readyBackups = settledRecoveredJobs.some((job) => job.state === "ready")
        ? yield* listBackups.pipe(Effect.catchCause(() => Effect.succeed([])))
        : [];
      const recovered = new Map<string, BackupJobStatus>();
      for (const job of settledRecoveredJobs) {
        const ready = readyBackups.find((backup) => backup.id === job.backup_id) ?? null;
        recovered.set(job.job_id, mapCoreBackupJob(job, ready));
      }
      yield* Ref.set(backupJobs, trimBackupJobs(recovered));
      yield* Ref.set(latestBackupJobId, settledRecoveredJobs[0]?.job_id ?? null);
      for (const job of settledRecoveredJobs) {
        if (job.state !== "running" || job.trigger === "pre-restore") continue;
        yield* launchBackup(job.job_id, job.operation_id, {
          trigger: job.trigger,
          ...(job.label ? { label: job.label } : {}),
        });
      }
    }

    return StoreAdministration.of({
      listBackups,
      backupCapacity,
      snapshotStorageOptimization,
      createBackup,
      startBackup,
      backupJob,
      cancelBackup,
      deleteBackup,
      restoreBackup,
      pruneBackups,
      planMaintenance,
      runMaintenance,
    });
  }),
);
