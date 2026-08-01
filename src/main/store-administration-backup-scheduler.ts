import type { DesktopStoreAdministrationPort } from "./core-client/desktop-store-administration-bridge";
import { getLogger } from "./logging/logger";

interface BackupSchedulerLogger {
  error(message: string, fields?: Record<string, unknown>): void;
}

type BackupSchedulerTimer = ReturnType<typeof setInterval> & {
  unref?: () => void;
};

export interface StartStoreAdministrationBackupSchedulerOptions {
  readonly administration: DesktopStoreAdministrationPort;
  readonly enabled: boolean;
  readonly intervalHours: number;
  readonly retentionCount: number;
  readonly isAuthorityAvailable?: () => boolean;
  readonly setIntervalImpl?: (
    callback: () => void,
    milliseconds: number,
  ) => BackupSchedulerTimer;
  readonly clearIntervalImpl?: (timer: BackupSchedulerTimer) => void;
  readonly logger?: BackupSchedulerLogger;
}

export interface StoreAdministrationBackupScheduler {
  readonly runNow: () => Promise<void>;
  readonly dispose: () => void;
}

export function startStoreAdministrationBackupScheduler(
  options: StartStoreAdministrationBackupSchedulerOptions,
): StoreAdministrationBackupScheduler {
  const logger = options.logger ?? getLogger({ subsystem: "backup" });
  const intervalHours = Math.max(1, Math.trunc(options.intervalHours));
  const retentionCount = Math.max(0, Math.trunc(options.retentionCount));
  const setIntervalImpl = options.setIntervalImpl
    ?? ((callback, milliseconds) => setInterval(callback, milliseconds));
  const clearIntervalImpl = options.clearIntervalImpl
    ?? ((timer) => clearInterval(timer));
  const isAuthorityAvailable = options.isAuthorityAvailable ?? (() => true);
  let disposed = false;
  let running = false;

  const runNow = async (): Promise<void> => {
    if (disposed || running || !isAuthorityAvailable()) return;
    running = true;
    try {
      await options.administration.createBackup({ trigger: "auto" });
      if (disposed || !isAuthorityAvailable()) return;
      await options.administration.pruneBackups(retentionCount);
    } catch (error) {
      logger.error("Automatic backup run failed", {
        error,
        intervalHours,
        retentionCount,
      });
    } finally {
      running = false;
    }
  };

  const timer = options.enabled
    ? setIntervalImpl(() => {
        void runNow();
      }, intervalHours * 60 * 60 * 1_000)
    : null;
  timer?.unref?.();

  return {
    runNow,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (timer) clearIntervalImpl(timer);
    },
  };
}
