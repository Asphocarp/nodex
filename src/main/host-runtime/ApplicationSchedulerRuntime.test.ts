import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { assert, it } from "@effect/vitest";
import type { DesktopAutomationModulePort, DesktopStoreAdministrationPort } from "../core-client";
import { CoreAuthority, type CoreAuthorityState } from "../core-runtime/CoreAuthority";
import { ElectronDesktop } from "../platform/electron/ElectronDesktop";
import { ApplicationSchedulerRuntime, live } from "./ApplicationSchedulerRuntime";

it.effect("owns power listeners and resumes scheduled delivery after Core recovery", () =>
  Effect.gen(function* () {
    const authorityState = yield* SubscriptionRef.make<CoreAuthorityState>({
      kind: "ready",
      generation: "generation-1",
    });
    let powerResume: Effect.Effect<void> | null = null;
    let reminderClaims = 0;
    let automationClaims = 0;
    const automation = {
      claimDueReminders: async () => {
        reminderClaims += 1;
        return [];
      },
      claimDueDefinitions: async () => {
        automationClaims += 1;
        return [];
      },
      settleInterruptedRuns: async () => ({ archivedPendingCount: 0, pendingReviewCount: 0 }),
    } as unknown as DesktopAutomationModulePort;
    const administration = {} as DesktopStoreAdministrationPort;
    const authority = CoreAuthority.of({
      identity: { profileId: "profile", libraryId: "library", storeEpoch: "epoch" },
      initialLaunch: {} as CoreAuthority["Service"]["initialLaunch"],
      state: authorityState,
      retry: Effect.void,
      requestRelaunch: Effect.void,
    });
    const desktop = ElectronDesktop.of({
      onPowerEvent: (_event, handler) =>
        Effect.acquireRelease(
          Effect.sync(() => {
            powerResume = handler;
          }),
          () =>
            Effect.sync(() => {
              powerResume = null;
            }),
        ),
    } as ElectronDesktop["Service"]);
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(
      live({
        automation,
        storeAdministration: administration,
        readBackupSettings: () => ({
          autoEnabled: false,
          intervalHours: 24,
          retentionCount: 5,
        }),
        readBlockRetentionCount: () => 100,
        runScheduledAutomation: async () => undefined,
        notifyAutomationRunsUpdated: () => undefined,
      }).pipe(
        Layer.provide(
          Layer.merge(
            Layer.succeed(CoreAuthority, authority),
            Layer.succeed(ElectronDesktop, desktop),
          ),
        ),
      ),
      scope,
    );
    const runtime = Context.get(context, ApplicationSchedulerRuntime);
    runtime.activate({ openReminder: () => undefined });
    yield* Effect.promise(() => new Promise<void>((resolve) => setImmediate(resolve)));
    assert.strictEqual(reminderClaims, 1);
    assert.strictEqual(automationClaims, 1);
    assert.isNotNull(powerResume);

    yield* SubscriptionRef.set(authorityState, {
      kind: "recovering",
      attempt: 1,
      previousGeneration: "generation-1",
    });
    yield* SubscriptionRef.set(authorityState, { kind: "ready", generation: "generation-2" });
    yield* Effect.promise(() => new Promise<void>((resolve) => setImmediate(resolve)));
    assert.strictEqual(reminderClaims, 2);
    assert.strictEqual(automationClaims, 2);

    yield* Scope.close(scope, Exit.void);
    assert.isNull(powerResume);
  }),
);
