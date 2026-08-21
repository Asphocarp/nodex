import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FiberHandle from "effect/FiberHandle";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";
import * as SubscriptionRef from "effect/SubscriptionRef";
import type { DesktopStoreAdministrationPort } from "../core-client";
import { CoreAuthority } from "../core-runtime/CoreAuthority";
import { getLogger } from "../logging/logger";
import { SchedulerOperationError, fromSchedulerPromise } from "./SchedulerOperation";
import {
  STORE_MAINTENANCE_SCHEDULES,
  maintenanceInput,
  type StoreMaintenanceLane,
} from "./StoreAdministrationSchedulerPolicy";

export interface BackupSchedulerSettings {
  readonly autoEnabled: boolean;
  readonly intervalHours: number;
  readonly retentionCount: number;
}

export interface StoreAdministrationSchedulerTiming {
  readonly maintenance?: Partial<
    Record<StoreMaintenanceLane, { readonly initial: number; readonly interval: number }>
  >;
}

export interface StoreAdministrationSchedulerRuntimeOptions {
  readonly administration: DesktopStoreAdministrationPort;
  readonly readBackupSettings: () => BackupSchedulerSettings;
  readonly readBlockRetentionCount: () => number;
  readonly timing?: StoreAdministrationSchedulerTiming;
}

export class StoreAdministrationSchedulerRuntime extends Context.Service<
  StoreAdministrationSchedulerRuntime,
  {
    readonly activate: Effect.Effect<void>;
    readonly configureBackup: (settings: BackupSchedulerSettings) => Effect.Effect<void>;
  }
>()("nodex/main/host-runtime/StoreAdministrationSchedulerRuntime") {}

export const live = (
  options: StoreAdministrationSchedulerRuntimeOptions,
): Layer.Layer<StoreAdministrationSchedulerRuntime, never, CoreAuthority> =>
  Layer.effect(
    StoreAdministrationSchedulerRuntime,
    Effect.gen(function* () {
      const authority = yield* CoreAuthority;
      const activation = yield* Deferred.make<void>();
      const backupLock = yield* Semaphore.make(1);
      const maintenanceLock = yield* Semaphore.make(1);
      const backupHandle = yield* FiberHandle.make<void, never>();
      const logger = getLogger({ component: "store-administration-scheduler-runtime" });
      const authorityReady = SubscriptionRef.get(authority.state).pipe(
        Effect.map((state) => state.kind === "ready"),
      );
      const operationCause = (error: SchedulerOperationError): unknown => error.cause;

      const runBackup = (settings: BackupSchedulerSettings): Effect.Effect<void> =>
        backupLock
          .withPermitsIfAvailable(1)(
            Effect.gen(function* () {
              if (!(yield* authorityReady)) return;
              yield* fromSchedulerPromise("create-automatic-backup", () =>
                options.administration.createBackup({ trigger: "auto" }),
              );
              if (!(yield* authorityReady)) return;
              yield* fromSchedulerPromise("prune-automatic-backups", () =>
                options.administration.pruneBackups(
                  Math.max(0, Math.trunc(settings.retentionCount)),
                ),
              );
            }).pipe(
              Effect.catch((error) =>
                Effect.sync(() => {
                  logger.error("Automatic backup run failed", {
                    error: operationCause(error),
                    intervalHours: settings.intervalHours,
                    retentionCount: settings.retentionCount,
                  });
                }),
              ),
            ),
          )
          .pipe(Effect.asVoid);

      const backupSchedule = (settings: BackupSchedulerSettings): Effect.Effect<void> =>
        Deferred.await(activation).pipe(
          Effect.andThen(
            settings.autoEnabled
              ? Effect.forever(
                  Effect.sleep(`${Math.max(1, Math.trunc(settings.intervalHours))} hours`).pipe(
                    Effect.andThen(runBackup(settings)),
                  ),
                )
              : Effect.void,
          ),
        );

      const runMaintenance = (lane: StoreMaintenanceLane): Effect.Effect<void> =>
        maintenanceLock
          .withPermitsIfAvailable(1)(
            Effect.gen(function* () {
              if (!(yield* authorityReady)) return;
              const input = yield* Effect.try({
                try: () => maintenanceInput(lane, options.readBlockRetentionCount()),
                catch: (cause) =>
                  new SchedulerOperationError({
                    operation: `build-${lane}-maintenance-input`,
                    cause,
                  }),
              });
              yield* fromSchedulerPromise(`run-${lane}-maintenance`, () =>
                options.administration.runMaintenance(input),
              );
            }).pipe(
              Effect.catch((error) =>
                Effect.sync(() => {
                  logger.warn("Store Administration maintenance pass deferred", {
                    lane,
                    error: operationCause(error),
                  });
                }),
              ),
            ),
          )
          .pipe(Effect.asVoid);

      for (const lane of ["revision", "document", "block"] as const) {
        const schedule = options.timing?.maintenance?.[lane] ?? STORE_MAINTENANCE_SCHEDULES[lane];
        yield* Deferred.await(activation).pipe(
          Effect.andThen(Effect.sleep(Math.max(0, schedule.initial))),
          Effect.andThen(
            Effect.forever(
              runMaintenance(lane).pipe(
                Effect.andThen(Effect.sleep(Math.max(0, schedule.interval))),
              ),
            ),
          ),
          Effect.forkScoped,
        );
      }
      yield* FiberHandle.run(backupHandle, backupSchedule(options.readBackupSettings()), {
        startImmediately: true,
      });

      return StoreAdministrationSchedulerRuntime.of({
        activate: Deferred.succeed(activation, undefined).pipe(Effect.asVoid),
        configureBackup: (settings) =>
          FiberHandle.run(backupHandle, backupSchedule(settings), {
            startImmediately: true,
          }).pipe(Effect.asVoid),
      });
    }),
  );
