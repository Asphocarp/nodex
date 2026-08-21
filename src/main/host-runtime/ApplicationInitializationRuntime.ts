import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { performance } from "node:perf_hooks";
import type { AppInitializationStep } from "../../shared/app-startup";
import type { CoreAuthorityProcessExit, CoreStartupEvent } from "../core-client/core-launcher";
import { safeBroadcastToWindows } from "../ipc-safe-send";
import { getLogger } from "../logging/logger";
import type { WindowRuntimeService } from "../window-runtime/WindowRuntime";

export class ApplicationInitializationRuntime extends Context.Service<
  ApplicationInitializationRuntime,
  {
    readonly current: Effect.Effect<AppInitializationStep>;
    readonly markDone: Effect.Effect<void>;
    readonly observeAuthorityExit: (event: CoreAuthorityProcessExit) => Effect.Effect<void>;
    readonly observeCoreStartup: (event: CoreStartupEvent) => Effect.Effect<void>;
    readonly reportRenderer: (
      webContentsId: number,
      report: { readonly durationMs: number; readonly outcome: "ready" | "failed" },
    ) => Effect.Effect<void>;
    readonly state: SubscriptionRef.SubscriptionRef<AppInitializationStep>;
  }
>()("nodex/main/host-runtime/ApplicationInitializationRuntime") {}

export const live = (
  windows: WindowRuntimeService,
): Layer.Layer<ApplicationInitializationRuntime> =>
  Layer.effect(
    ApplicationInitializationRuntime,
    Effect.gen(function* () {
      const state = yield* SubscriptionRef.make<AppInitializationStep>({ phase: "opening" });
      const logger = getLogger({ component: "application-initialization-runtime" });
      let changedAt = performance.now();
      const setStep = (step: AppInitializationStep): Effect.Effect<void> =>
        SubscriptionRef.modify(state, (current) => {
          if (current.phase === "done") return [false, current];
          if (current.phase === "migrating" && step.phase === "opening") return [false, current];
          if (
            current.phase === step.phase &&
            (step.phase !== "migrating" ||
              (current.phase === "migrating" &&
                current.fromVersion === step.fromVersion &&
                current.toVersion === step.toVersion &&
                current.completed === step.completed &&
                current.total === step.total))
          ) {
            return [false, current];
          }
          return [true, step];
        }).pipe(
          Effect.tap((changed) =>
            changed
              ? Effect.sync(() => {
                  const now = performance.now();
                  logger.info("App initialization phase changed", {
                    phase: step.phase,
                    previousPhaseDurationMs: Math.round(now - changedAt),
                  });
                  changedAt = now;
                  safeBroadcastToWindows(windows.all(), "app:init-step", [step]);
                })
              : Effect.void,
          ),
          Effect.asVoid,
        );

      return ApplicationInitializationRuntime.of({
        current: SubscriptionRef.get(state),
        markDone: setStep({ phase: "done" }),
        observeAuthorityExit: (event) =>
          Effect.sync(() => {
            logger.error("Native Core authority process exited", {
              code: event.code,
              processId: event.processId,
              signal: event.signal,
              stderr: event.stderr || undefined,
            });
          }),
        observeCoreStartup: (event) => {
          if (event.kind === "migration_started") {
            return Effect.sync(() => {
              logger.info("Native Core Store migration started", {
                fromVersion: event.fromVersion,
                toVersion: event.toVersion,
              });
            }).pipe(
              Effect.andThen(
                setStep({
                  phase: "migrating",
                  fromVersion: event.fromVersion,
                  toVersion: event.toVersion,
                }),
              ),
            );
          }
          if (event.kind === "candidate_checked") {
            return Effect.sync(() =>
              logger.info("Native Core candidate checked", {
                artifactHashMs: event.artifactHashMs,
              }),
            );
          }
          if (event.kind === "migration_progress") {
            return SubscriptionRef.get(state).pipe(
              Effect.flatMap((current) =>
                current.phase === "migrating"
                  ? setStep({ ...current, completed: event.completed, total: event.total })
                  : Effect.void,
              ),
            );
          }
          if (event.kind === "migration_heartbeat") return Effect.void;
          return Effect.sync(() => {
            logger.info("Native Core Store ready", {
              createdFresh: event.createdFresh,
              migratedFromVersion: event.migratedFromVersion,
              storeOpenMs: event.storeOpenMs,
            });
          }).pipe(Effect.andThen(setStep({ phase: "opening_workspace" })));
        },
        reportRenderer: (webContentsId, report) =>
          Effect.sync(() => {
            if (!windows.markRendererInitialized(webContentsId)) return;
            logger.info("Renderer initialization finished", {
              durationMs: Math.round(report.durationMs),
              outcome: report.outcome,
              webContentsId,
            });
          }),
        state,
      });
    }),
  );
