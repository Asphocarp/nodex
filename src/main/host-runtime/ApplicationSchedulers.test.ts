import { assert, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as TestClock from "effect/testing/TestClock";
import type { CodexScheduledAutomation } from "../../shared/types";
import type { DesktopAutomationModulePort, DesktopStoreAdministrationPort } from "../core-client";
import { CoreAuthority, type CoreAuthorityState } from "../core-runtime/CoreAuthority";
import {
  ElectronDesktop,
  type ElectronNotificationInput,
} from "../platform/electron/ElectronDesktop";
import {
  CodexScheduledAutomationRetryError,
  type CodexScheduledAutomationRunContext,
} from "./ScheduledAutomationPolicy";
import {
  ReminderSchedulerRuntime,
  live as reminderSchedulerLive,
} from "./ReminderSchedulerRuntime";
import {
  ScheduledAutomationRuntime,
  live as scheduledAutomationLive,
} from "./ScheduledAutomationRuntime";
import {
  StoreAdministrationSchedulerRuntime,
  live as storeAdministrationSchedulerLive,
  type StoreAdministrationSchedulerTiming,
} from "./StoreAdministrationSchedulerRuntime";

const reminderClaim = {
  leaseId: "reminder-lease:1",
  projectId: "project:one",
  pageId: "page:one",
  occurrenceStart: Date.parse("2026-07-20T01:00:00.000Z"),
  reminderOffsetMinutes: 30,
  dueAt: Date.parse("2026-07-20T00:30:00.000Z"),
  title: "Planning session",
  attempt: 1,
  expiresAt: Date.parse("2026-07-20T00:32:00.000Z"),
};

const automationDefinition = (
  id: string,
  kind: "cron" | "heartbeat" = "cron",
): CodexScheduledAutomation => ({
  id,
  definitionRevision: 1,
  kind,
  status: "ACTIVE",
  targetThreadId: kind === "heartbeat" ? "thread-follow-up" : null,
  name: id,
  prompt: "Run.",
  rrule: "FREQ=MINUTELY;INTERVAL=5",
  model: null,
  modelProvider: null,
  harnessId: null,
  reasoningEffort: null,
  serviceTier: null,
  cwds: kind === "heartbeat" ? [] : ["/repo/project"],
  executionEnvironment: kind === "heartbeat" ? "local" : "worktree",
  localEnvironmentConfigPath: null,
  nextRunAt: 100,
  lastRunAt: null,
  createdAt: 1,
  updatedAt: 1,
});

const defaultAutomation = (): DesktopAutomationModulePort =>
  ({
    claimDueReminders: async () => [],
    completeReminderLease: async () => undefined,
    failReminderLease: async () => undefined,
    snoozeReminder: async () => ({ success: true }),
    settleInterruptedRuns: async () => ({ archivedPendingCount: 0, pendingReviewCount: 0 }),
    claimDueDefinitions: async () => [],
    completeLease: async () => undefined,
    failLease: async () => undefined,
  }) as unknown as DesktopAutomationModulePort;

const defaultAdministration = (): DesktopStoreAdministrationPort =>
  ({
    createBackup: async () => ({
      version: 2,
      id: "backup:auto",
      createdAt: "2026-07-19T20:00:00.000Z",
      trigger: "auto",
      label: null,
      includesAssets: true,
      dbBytes: 100,
      assetsBytes: 20,
      totalBytes: 120,
    }),
    pruneBackups: async () => undefined,
    runMaintenance: async () => undefined,
  }) as unknown as DesktopStoreAdministrationPort;

const waitUntil = (label: string, predicate: () => boolean): Effect.Effect<void> =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (predicate()) return;
      yield* Effect.promise(() => new Promise<void>((resolve) => setImmediate(resolve)));
    }
    return yield* Effect.die(new Error(`Timed out waiting for ${label}`));
  });

const buildHarness = (input: {
  readonly automation?: DesktopAutomationModulePort;
  readonly administration?: DesktopStoreAdministrationPort;
  readonly runScheduledAutomation?: (
    automation: CodexScheduledAutomation,
    context: CodexScheduledAutomationRunContext,
    signal: AbortSignal,
  ) => Promise<void>;
  readonly settled?: () => void;
  readonly readBlockRetentionCount?: () => number;
  readonly reminder?: {
    readonly intervalMs?: number;
    readonly maxPerTick?: number;
    readonly leaseDurationMs?: number;
    readonly retryDelayMs?: number;
  };
  readonly scheduled?: { readonly intervalMs?: number; readonly maxPerTick?: number };
  readonly storeTiming?: StoreAdministrationSchedulerTiming;
  readonly initialBackup?: {
    readonly autoEnabled: boolean;
    readonly intervalHours: number;
    readonly retentionCount: number;
  };
  readonly showNotification?: (notification: ElectronNotificationInput) => Effect.Effect<boolean>;
}) =>
  Effect.gen(function* () {
    const authorityState = yield* SubscriptionRef.make<CoreAuthorityState>({
      kind: "ready",
      generation: "generation-1",
    });
    const authority = CoreAuthority.of({
      identity: { profileId: "profile", libraryId: "library", storeEpoch: "epoch" },
      initialLaunch: {} as CoreAuthority["Service"]["initialLaunch"],
      state: authorityState,
      retry: Effect.void,
      requestRelaunch: Effect.void,
    });
    const notifications: ElectronNotificationInput[] = [];
    let powerResume: Effect.Effect<void> | null = null;
    const desktop = ElectronDesktop.of({
      showNotification: (notification) => {
        notifications.push(notification);
        return input.showNotification?.(notification) ?? Effect.succeed(true);
      },
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
    const platformLayer = Layer.merge(
      Layer.succeed(CoreAuthority, authority),
      Layer.succeed(ElectronDesktop, desktop),
    );
    const automation = input.automation ?? defaultAutomation();
    const reminderContext = yield* Layer.buildWithScope(
      reminderSchedulerLive({ automation, ...input.reminder }).pipe(Layer.provide(platformLayer)),
      scope,
    );
    const scheduledContext = yield* Layer.buildWithScope(
      scheduledAutomationLive({
        automation,
        run: input.runScheduledAutomation ?? (async () => undefined),
        notifyRunsUpdated: input.settled ?? (() => undefined),
        ...input.scheduled,
      }).pipe(Layer.provide(Layer.succeed(CoreAuthority, authority))),
      scope,
    );
    const storeContext = yield* Layer.buildWithScope(
      storeAdministrationSchedulerLive({
        administration: input.administration ?? defaultAdministration(),
        readBackupSettings: () =>
          input.initialBackup ?? {
            autoEnabled: false,
            intervalHours: 24,
            retentionCount: 5,
          },
        readBlockRetentionCount: input.readBlockRetentionCount ?? (() => 100),
        timing: input.storeTiming,
      }).pipe(Layer.provide(Layer.succeed(CoreAuthority, authority))),
      scope,
    );
    return {
      authorityState,
      notifications,
      powerResume: () => powerResume,
      reminders: Context.get(reminderContext, ReminderSchedulerRuntime),
      scheduled: Context.get(scheduledContext, ScheduledAutomationRuntime),
      store: Context.get(storeContext, StoreAdministrationSchedulerRuntime),
      scope,
    };
  });

it.effect("delivers reminder leases and routes notification actions through scoped callbacks", () =>
  Effect.gen(function* () {
    const completed: string[] = [];
    const snoozes: number[] = [];
    let claims = 0;
    let opened = 0;
    const automation = {
      ...defaultAutomation(),
      claimDueReminders: async () => {
        claims += 1;
        return claims <= 2 ? [reminderClaim] : [];
      },
      completeReminderLease: async (leaseId: string) => {
        completed.push(leaseId);
      },
      snoozeReminder: async (
        _projectId: string,
        _pageId: string,
        _occurrenceStart: string,
        minutes: number,
      ) => {
        snoozes.push(minutes);
        return { success: true };
      },
    } as unknown as DesktopAutomationModulePort;
    const harness = yield* buildHarness({ automation });

    yield* harness.reminders.activate({
      openReminder: () => {
        opened += 1;
      },
    });
    yield* waitUntil("initial reminder", () => harness.notifications.length === 1);
    assert.deepEqual(completed, ["reminder-lease:1"]);
    assert.deepEqual(harness.notifications[0]?.actions, ["Snooze 10m", "Snooze 1h"]);

    yield* harness.notifications[0]?.onClick ?? Effect.void;
    yield* harness.notifications[0]?.onAction?.(0) ?? Effect.void;
    yield* waitUntil("reminder snooze", () => snoozes.length === 1);
    assert.strictEqual(opened, 1);
    assert.deepEqual(snoozes, [10]);

    const powerResume = harness.powerResume();
    assert.isNotNull(powerResume);
    yield* powerResume ?? Effect.void;
    yield* waitUntil("resume reminder", () => harness.notifications.length === 2);
    yield* Scope.close(harness.scope, Exit.void);
    assert.isNull(harness.powerResume());
  }),
);

it.effect("defers reminder claims when Core authority is lost during the claim", () =>
  Effect.gen(function* () {
    const failed: Array<{ leaseId: string; delay: number; reason: string }> = [];
    let resolveClaims: ((claims: (typeof reminderClaim)[]) => void) | null = null;
    const automation = {
      ...defaultAutomation(),
      claimDueReminders: () =>
        new Promise<(typeof reminderClaim)[]>((resolve) => {
          resolveClaims = resolve;
        }),
      failReminderLease: async (leaseId: string, delay: number, reason: string) => {
        failed.push({ leaseId, delay, reason });
      },
    } as DesktopAutomationModulePort;
    const harness = yield* buildHarness({
      automation,
      reminder: { retryDelayMs: 9_000 },
    });
    yield* harness.reminders.activate({ openReminder: () => undefined });
    yield* waitUntil("reminder claim admission", () => resolveClaims !== null);

    yield* SubscriptionRef.set(harness.authorityState, {
      kind: "recovering",
      attempt: 1,
      previousGeneration: "generation-1",
    });
    const releaseClaims = resolveClaims as ((claims: (typeof reminderClaim)[]) => void) | null;
    releaseClaims?.([reminderClaim]);
    yield* waitUntil("reminder deferral", () => failed.length === 1);
    assert.deepEqual(failed, [
      { leaseId: "reminder-lease:1", delay: 9_000, reason: "core_authority_unavailable" },
    ]);
    assert.deepEqual(harness.notifications, []);
    yield* Scope.close(harness.scope, Exit.void);
  }),
);

it.effect("settles scheduled claims once and preserves explicit retry intent", () =>
  Effect.gen(function* () {
    const completed: string[] = [];
    const failed: Array<{ leaseId: string; delay: number | null; reason: string }> = [];
    let claimCalls = 0;
    let settlementRuns = 0;
    const automation = {
      ...defaultAutomation(),
      settleInterruptedRuns: async () => ({ archivedPendingCount: 1, pendingReviewCount: 0 }),
      claimDueDefinitions: async () => {
        claimCalls += 1;
        if (claimCalls > 1) return [];
        return ["complete", "retry", "deferred"].map((id) => ({
          leaseId: `lease:${id}`,
          definition: automationDefinition(id),
        }));
      },
      completeLease: async (leaseId: string) => {
        completed.push(leaseId);
      },
      failLease: async (leaseId: string, delay: number | null, reason: string) => {
        failed.push({ leaseId, delay, reason });
      },
    } as unknown as DesktopAutomationModulePort;
    const harness = yield* buildHarness({
      automation,
      settled: () => {
        settlementRuns += 1;
      },
      runScheduledAutomation: async (item) => {
        if (item.id === "retry") {
          throw new CodexScheduledAutomationRetryError(
            "Renderer owner is unavailable",
            60_000,
            "renderer_owner_unavailable",
          );
        }
        if (item.id === "deferred") {
          throw new CodexScheduledAutomationRetryError(
            "Heartbeat automations are disabled",
            null,
            "heartbeat_disabled",
          );
        }
      },
    });
    yield* harness.scheduled.activate;
    yield* waitUntil("scheduled claim settlement", () => completed.length + failed.length === 3);

    assert.deepEqual(completed, ["lease:complete"]);
    assert.deepEqual(failed, [
      { leaseId: "lease:retry", delay: 60_000, reason: "renderer_owner_unavailable" },
      { leaseId: "lease:deferred", delay: null, reason: "heartbeat_disabled" },
    ]);
    assert.strictEqual(settlementRuns, 1);

    yield* SubscriptionRef.set(harness.authorityState, {
      kind: "recovering",
      attempt: 1,
      previousGeneration: "generation-1",
    });
    yield* SubscriptionRef.set(harness.authorityState, {
      kind: "ready",
      generation: "generation-2",
    });
    yield* waitUntil("recovery tick", () => claimCalls === 2);
    assert.strictEqual(settlementRuns, 1);
    yield* Scope.close(harness.scope, Exit.void);
  }),
);

it.effect("skips overlapping scheduled ticks while a claimed run is active", () =>
  Effect.gen(function* () {
    let claimCalls = 0;
    let completions = 0;
    let releaseRun: (() => void) | null = null;
    let shouldBlock = true;
    const automation = {
      ...defaultAutomation(),
      claimDueDefinitions: async () => {
        claimCalls += 1;
        return [{ leaseId: `lease:${claimCalls}`, definition: automationDefinition("slow") }];
      },
      completeLease: async () => {
        completions += 1;
      },
    } as unknown as DesktopAutomationModulePort;
    const harness = yield* buildHarness({
      automation,
      runScheduledAutomation: () => {
        if (!shouldBlock) return Promise.resolve();
        return new Promise<void>((resolve) => {
          releaseRun = () => {
            shouldBlock = false;
            resolve();
          };
        });
      },
    });
    yield* harness.scheduled.activate;
    yield* waitUntil("active scheduled run", () => releaseRun !== null);

    yield* harness.scheduled.setHeartbeatAutomationsEnabled(true);
    assert.strictEqual(claimCalls, 1);
    const completeRun = releaseRun as (() => void) | null;
    completeRun?.();
    yield* waitUntil("first scheduled completion", () => completions === 1);
    yield* harness.scheduled.setHeartbeatAutomationsEnabled(true);
    yield* waitUntil("second scheduled tick", () => claimCalls === 2);
    yield* Scope.close(harness.scope, Exit.void);
  }),
);

it.effect("returns an admitted automation lease when its Main Scope closes", () =>
  Effect.gen(function* () {
    const failures: Array<{ leaseId: string; reason: string }> = [];
    let runStarted = false;
    const runSignals: AbortSignal[] = [];
    const automation = {
      ...defaultAutomation(),
      claimDueDefinitions: async () => [
        { leaseId: "lease:shutdown", definition: automationDefinition("shutdown") },
      ],
      failLease: async (leaseId: string, _delay: number | null, reason: string) => {
        failures.push({ leaseId, reason });
      },
    } as unknown as DesktopAutomationModulePort;
    const harness = yield* buildHarness({
      automation,
      runScheduledAutomation: (_automation, _context, signal) => {
        runStarted = true;
        runSignals.push(signal);
        return new Promise<void>(() => undefined);
      },
    });
    yield* harness.scheduled.activate;
    yield* waitUntil("scheduled shutdown run", () => runStarted);

    yield* Scope.close(harness.scope, Exit.void);
    assert.isTrue(runSignals[0]?.aborted ?? false);
    assert.deepEqual(failures, [{ leaseId: "lease:shutdown", reason: "scheduler_stopped" }]);
  }),
);

it.effect("projects heartbeat state with a TestClock-owned freshness deadline", () =>
  Effect.gen(function* () {
    const contexts: CodexScheduledAutomationRunContext[] = [];
    const automation = {
      ...defaultAutomation(),
      claimDueDefinitions: async () => [
        { leaseId: "lease:heartbeat", definition: automationDefinition("heartbeat", "heartbeat") },
      ],
    } as unknown as DesktopAutomationModulePort;
    const harness = yield* buildHarness({
      automation,
      runScheduledAutomation: async (_item, context) => {
        contexts.push(context);
      },
    });
    yield* harness.scheduled.activate;
    yield* waitUntil("initial heartbeat context", () => contexts.length === 1);
    assert.isFalse(contexts[0]?.heartbeat?.automationsEnabled ?? true);

    yield* harness.scheduled.setHeartbeatThreadRendererState({
      threadId: "thread-follow-up",
      rendererClientId: "renderer-owner",
      streamRole: "owner",
      isEligible: true,
      reason: null,
      collaborationMode: "plan",
      permissions: {
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        sandboxPolicy: {
          type: "workspaceWrite",
          writableRoots: ["/repo/project"],
          networkAccess: false,
          excludeTmpdirEnvVar: false,
          excludeSlashTmp: false,
        },
      },
    });
    yield* harness.scheduled.setHeartbeatAutomationsEnabled(true);
    yield* waitUntil("enabled heartbeat context", () => contexts.length >= 2);
    const enabled = contexts.at(-1)?.heartbeat;
    assert.isTrue(enabled?.automationsEnabled ?? false);
    assert.isTrue(enabled?.rendererState?.isEligible ?? false);
    assert.strictEqual(enabled?.collaborationMode, "plan");
    assert.strictEqual(enabled?.permissions?.approvalPolicy, "on-request");

    const beforeExpiryTick = contexts.length;
    yield* TestClock.adjust("121 seconds");
    yield* harness.scheduled.setHeartbeatAutomationsEnabled(true);
    yield* waitUntil("expired heartbeat context", () => contexts.length > beforeExpiryTick);
    const stale = contexts.at(-1)?.heartbeat;
    assert.isNull(stale?.rendererState ?? null);
    assert.strictEqual(stale?.collaborationMode, "plan");
    yield* Scope.close(harness.scope, Exit.void);
  }),
);

it.effect("replaces backup schedules and runs semantic maintenance lanes", () =>
  Effect.gen(function* () {
    const backups: string[] = [];
    const prunes: number[] = [];
    const maintenance: unknown[] = [];
    let retentionCount = 17;
    const administration = {
      ...defaultAdministration(),
      createBackup: async () => {
        backups.push("auto");
        return await defaultAdministration().createBackup({ trigger: "auto" });
      },
      pruneBackups: async (count: number) => {
        prunes.push(count);
      },
      runMaintenance: async (input: unknown) => {
        maintenance.push(input);
      },
    } as DesktopStoreAdministrationPort;
    const harness = yield* buildHarness({
      administration,
      readBlockRetentionCount: () => retentionCount,
      storeTiming: {
        maintenance: {
          revision: { initial: 10, interval: 10 * 60_000 },
          document: { initial: 20, interval: 10 * 60_000 },
          block: { initial: 30, interval: 10 * 60_000 },
        },
      },
    });
    yield* harness.store.activate;
    yield* harness.store.configureBackup({
      autoEnabled: true,
      intervalHours: 1,
      retentionCount: 4,
    });

    yield* TestClock.adjust(10);
    yield* Effect.yieldNow;
    yield* TestClock.adjust(10);
    yield* Effect.yieldNow;
    retentionCount = 3;
    yield* TestClock.adjust(10);
    yield* Effect.yieldNow;
    assert.deepEqual(maintenance.slice(0, 3), [
      { tasks: ["document_revision_finalize"] },
      { tasks: ["document_compaction", "history_retention"] },
      { tasks: ["block_retention"], blockRetentionCount: 3 },
    ]);

    yield* TestClock.adjust("1 hour");
    yield* Effect.yieldNow;
    assert.deepEqual(backups, ["auto"]);
    assert.deepEqual(prunes, [4]);

    yield* harness.store.configureBackup({
      autoEnabled: false,
      intervalHours: 1,
      retentionCount: 4,
    });
    yield* TestClock.adjust("2 hours");
    assert.deepEqual(backups, ["auto"]);
    yield* Scope.close(harness.scope, Exit.void);
  }),
);

it.effect("serializes maintenance lanes and interrupts every schedule on Scope close", () =>
  Effect.gen(function* () {
    let runs = 0;
    let release: (() => void) | null = null;
    const administration = {
      ...defaultAdministration(),
      runMaintenance: () => {
        runs += 1;
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      },
    } as DesktopStoreAdministrationPort;
    const harness = yield* buildHarness({
      administration,
      storeTiming: {
        maintenance: {
          revision: { initial: 1, interval: 10 },
          document: { initial: 1, interval: 10 },
          block: { initial: 1, interval: 10 },
        },
      },
    });
    yield* harness.store.activate;
    yield* TestClock.adjust(1);
    yield* waitUntil("one maintenance lane", () => runs === 1);
    yield* TestClock.adjust(100);
    assert.strictEqual(runs, 1);

    yield* Scope.close(harness.scope, Exit.void);
    const completeMaintenance = release as (() => void) | null;
    completeMaintenance?.();
    yield* TestClock.adjust("1 day");
    assert.strictEqual(runs, 1);
  }),
);
