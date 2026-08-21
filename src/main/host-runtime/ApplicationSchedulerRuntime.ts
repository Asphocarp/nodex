import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { Notification } from "electron";
import type { CodexScheduledAutomation } from "../../shared/types";
import { CoreAuthority } from "../core-runtime/CoreAuthority";
import type { DesktopAutomationModulePort, DesktopStoreAdministrationPort } from "../core-client";
import {
  startAutomationReminderScheduler,
  type AutomationReminderScheduler,
} from "../automation-reminder-scheduler";
import {
  startCodexScheduledAutomationScheduler,
  type CodexScheduledAutomationHeartbeatThreadStateInput,
  type CodexScheduledAutomationRunContext,
  type CodexScheduledAutomationScheduler,
} from "../codex-scheduled-automation-scheduler";
import { getLogger } from "../logging/logger";
import type { ReminderNotificationPayload } from "../reminder-notification";
import {
  startStoreAdministrationBackupScheduler,
  type StoreAdministrationBackupScheduler,
} from "../store-administration-backup-scheduler";
import {
  startStoreAdministrationMaintenanceScheduler,
  type StoreAdministrationMaintenanceScheduler,
} from "../store-administration-maintenance-scheduler";
import { ElectronDesktop } from "../platform/electron/ElectronDesktop";

export interface BackupSchedulerSettings {
  readonly autoEnabled: boolean;
  readonly intervalHours: number;
  readonly retentionCount: number;
}

export interface ApplicationSchedulerRuntimeOptions {
  readonly automation: DesktopAutomationModulePort;
  readonly storeAdministration: DesktopStoreAdministrationPort;
  readonly readBackupSettings: () => BackupSchedulerSettings;
  readonly readBlockRetentionCount: () => number;
  readonly runScheduledAutomation: (
    automation: CodexScheduledAutomation,
    context: CodexScheduledAutomationRunContext,
  ) => Promise<void>;
  readonly notifyAutomationRunsUpdated: () => void;
}

export interface ApplicationSchedulerActivation {
  readonly openReminder: (payload: ReminderNotificationPayload) => void;
}

export class ApplicationSchedulerRuntime extends Context.Service<
  ApplicationSchedulerRuntime,
  {
    readonly activate: (options: ApplicationSchedulerActivation) => void;
    readonly configureBackup: (settings: BackupSchedulerSettings) => void;
    readonly setHeartbeatAutomationsEnabled: (enabled: boolean) => void;
    readonly setHeartbeatThreadRendererState: (
      input: CodexScheduledAutomationHeartbeatThreadStateInput,
    ) => void;
  }
>()("nodex/main/host-runtime/ApplicationSchedulerRuntime") {}

export const live = (
  options: ApplicationSchedulerRuntimeOptions,
): Layer.Layer<ApplicationSchedulerRuntime, never, CoreAuthority | ElectronDesktop> =>
  Layer.effect(
    ApplicationSchedulerRuntime,
    Effect.gen(function* () {
      const authority = yield* CoreAuthority;
      const desktop = yield* ElectronDesktop;
      const initialAuthority = yield* SubscriptionRef.get(authority.state);
      const logger = getLogger({ component: "application-scheduler-runtime" });
      const activeNotifications = new Set<Notification>();
      let authorityAvailable = initialAuthority.kind === "ready";
      let activation: ApplicationSchedulerActivation | null = null;
      let reminder: AutomationReminderScheduler | null = null;
      let scheduled: CodexScheduledAutomationScheduler | null = null;
      let backup: StoreAdministrationBackupScheduler | null = null;
      let maintenance: StoreAdministrationMaintenanceScheduler | null = null;

      const showReminder = (payload: ReminderNotificationPayload): void => {
        if (!Notification.isSupported()) return;
        const notification = new Notification({
          title: payload.title,
          body: payload.body,
          actions: [
            { type: "button", text: "Snooze 10m" },
            { type: "button", text: "Snooze 1h" },
          ],
        });
        const release = () => {
          activeNotifications.delete(notification);
        };
        notification.once("close", release);
        notification.on("click", () => activation?.openReminder(payload));
        notification.on("action", (_event, index) => {
          const minutes = index === 0 ? 10 : 60;
          void options.automation
            .snoozeReminder(payload.projectId, payload.pageId, payload.occurrenceStart, minutes)
            .catch((error) => {
              logger.warn("Failed to snooze reminder", {
                projectId: payload.projectId,
                pageId: payload.pageId,
                error,
              });
            });
        });
        activeNotifications.add(notification);
        notification.show();
      };

      const configureBackup = (settings: BackupSchedulerSettings): void => {
        backup?.dispose();
        backup = startStoreAdministrationBackupScheduler({
          administration: options.storeAdministration,
          enabled: settings.autoEnabled,
          isAuthorityAvailable: () => authorityAvailable,
          intervalHours: settings.intervalHours,
          retentionCount: settings.retentionCount,
        });
      };

      const activate = (next: ApplicationSchedulerActivation): void => {
        if (activation) return;
        activation = next;
        reminder = startAutomationReminderScheduler({
          automation: options.automation,
          isAuthorityAvailable: () => authorityAvailable,
          onReminder: showReminder,
        });
        maintenance = startStoreAdministrationMaintenanceScheduler({
          administration: options.storeAdministration,
          isAuthorityAvailable: () => authorityAvailable,
          readBlockRetentionCount: options.readBlockRetentionCount,
        });
        scheduled = startCodexScheduledAutomationScheduler({
          isAuthorityAvailable: () => authorityAvailable,
          claimDueAutomations: (limit) =>
            options.automation.claimDueDefinitions(limit, 15 * 60_000),
          completeClaim: (leaseId) => options.automation.completeLease(leaseId),
          failClaim: (leaseId, retryDelayMs, reasonCode) =>
            options.automation.failLease(leaseId, retryDelayMs, reasonCode),
          settleInterruptedRuns: () => options.automation.settleInterruptedRuns(),
          runAutomation: options.runScheduledAutomation,
          onAutomationRunsUpdated: options.notifyAutomationRunsUpdated,
        });
        configureBackup(options.readBackupSettings());
      };

      const tickAfterRecovery = (): void => {
        void reminder?.runNow();
        void scheduled?.tick();
      };

      yield* desktop.onPowerEvent(
        "resume",
        Effect.sync(() => {
          void reminder?.runNow();
        }),
      );
      yield* SubscriptionRef.changes(authority.state).pipe(
        Stream.runForEach((state) =>
          Effect.sync(() => {
            const wasAvailable = authorityAvailable;
            authorityAvailable = state.kind === "ready";
            if (!wasAvailable && authorityAvailable) tickAfterRecovery();
          }),
        ),
        Effect.forkScoped,
      );
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          backup?.dispose();
          maintenance?.dispose();
          reminder?.dispose();
          scheduled?.dispose();
          backup = null;
          maintenance = null;
          reminder = null;
          scheduled = null;
          activation = null;
          for (const notification of activeNotifications) {
            notification.removeAllListeners();
            notification.close();
          }
          activeNotifications.clear();
        }),
      );

      return ApplicationSchedulerRuntime.of({
        activate,
        configureBackup,
        setHeartbeatAutomationsEnabled: (enabled) =>
          scheduled?.setHeartbeatAutomationsEnabled(enabled),
        setHeartbeatThreadRendererState: (input) =>
          scheduled?.setHeartbeatThreadRendererState(input),
      });
    }),
  );
