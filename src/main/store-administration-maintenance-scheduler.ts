import type {
  DesktopStoreAdministrationPort,
  DesktopStoreMaintenanceInput,
} from "./core-client/desktop-store-administration-bridge";
import { getLogger } from "./logging/logger";

const REVISION_INITIAL_DELAY_MS = 15_000;
const REVISION_INTERVAL_MS = 30_000;
const DOCUMENT_INITIAL_DELAY_MS = 30_000;
const DEEP_MAINTENANCE_INTERVAL_MS = 15 * 60_000;
const BLOCK_INITIAL_DELAY_MS = 45_000;

type MaintenanceLane = "revision" | "document" | "block";
type MaintenanceTimer = ReturnType<typeof setTimeout> & {
  unref?: () => void;
};

interface MaintenanceSchedulerLogger {
  warn(message: string, fields?: Record<string, unknown>): void;
}

export interface StartStoreAdministrationMaintenanceSchedulerOptions {
  readonly administration: DesktopStoreAdministrationPort;
  readonly readBlockRetentionCount: () => number;
  readonly isAuthorityAvailable?: () => boolean;
  readonly setTimeoutImpl?: (callback: () => void, milliseconds: number) => MaintenanceTimer;
  readonly clearTimeoutImpl?: (timer: MaintenanceTimer) => void;
  readonly delays?: Partial<
    Record<
      MaintenanceLane,
      {
        readonly initial: number;
        readonly interval: number;
      }
    >
  >;
  readonly logger?: MaintenanceSchedulerLogger;
}

export interface StoreAdministrationMaintenanceScheduler {
  readonly runNow: (lane: MaintenanceLane) => Promise<void>;
  readonly dispose: () => void;
}

const requireNonNegativeInteger = (value: number, field: string): number => {
  if (Number.isSafeInteger(value) && value >= 0) return value;
  throw new TypeError(`${field} must be a non-negative safe integer`);
};

const laneInput = (
  lane: MaintenanceLane,
  readBlockRetentionCount: () => number,
): DesktopStoreMaintenanceInput => {
  if (lane === "revision") {
    return { tasks: ["document_revision_finalize"] };
  }
  if (lane === "document") {
    return { tasks: ["document_compaction", "history_retention"] };
  }
  return {
    tasks: ["block_retention"],
    blockRetentionCount: requireNonNegativeInteger(readBlockRetentionCount(), "history retention"),
  };
};

export function startStoreAdministrationMaintenanceScheduler(
  options: StartStoreAdministrationMaintenanceSchedulerOptions,
): StoreAdministrationMaintenanceScheduler {
  const logger = options.logger ?? getLogger({ subsystem: "maintenance" });
  const setTimeoutImpl =
    options.setTimeoutImpl ?? ((callback, milliseconds) => setTimeout(callback, milliseconds));
  const clearTimeoutImpl = options.clearTimeoutImpl ?? ((timer) => clearTimeout(timer));
  const isAuthorityAvailable = options.isAuthorityAvailable ?? (() => true);
  const schedules: Record<MaintenanceLane, { initial: number; interval: number }> = {
    revision: options.delays?.revision ?? {
      initial: REVISION_INITIAL_DELAY_MS,
      interval: REVISION_INTERVAL_MS,
    },
    document: options.delays?.document ?? {
      initial: DOCUMENT_INITIAL_DELAY_MS,
      interval: DEEP_MAINTENANCE_INTERVAL_MS,
    },
    block: options.delays?.block ?? {
      initial: BLOCK_INITIAL_DELAY_MS,
      interval: DEEP_MAINTENANCE_INTERVAL_MS,
    },
  };
  const timers = new Map<MaintenanceLane, MaintenanceTimer>();
  let runningLane: MaintenanceLane | null = null;
  let disposed = false;

  const runNow = async (lane: MaintenanceLane): Promise<void> => {
    if (disposed || runningLane !== null || !isAuthorityAvailable()) return;
    runningLane = lane;
    try {
      await options.administration.runMaintenance(laneInput(lane, options.readBlockRetentionCount));
    } catch (error) {
      logger.warn("Store Administration maintenance pass deferred", {
        lane,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      runningLane = null;
    }
  };

  const schedule = (lane: MaintenanceLane, delay: number): void => {
    if (disposed) return;
    const normalizedDelay = requireNonNegativeInteger(delay, `${lane} maintenance delay`);
    const timer = setTimeoutImpl(() => {
      timers.delete(lane);
      void runNow(lane).finally(() => {
        schedule(lane, schedules[lane].interval);
      });
    }, normalizedDelay);
    timer.unref?.();
    timers.set(lane, timer);
  };

  for (const lane of ["revision", "document", "block"] as const) {
    schedule(lane, schedules[lane].initial);
  }

  return {
    runNow,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      for (const timer of timers.values()) clearTimeoutImpl(timer);
      timers.clear();
    },
  };
}
