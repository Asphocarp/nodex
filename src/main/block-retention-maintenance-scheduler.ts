import type {
  MaintainStoreBlockRetentionInput,
  MaintainStoreBlockRetentionResult,
} from "./local-store/block-retention-maintenance-store";

const DEFAULT_INITIAL_DELAY_MS = 45_000;
const DEFAULT_INTERVAL_MS = 15 * 60_000;

interface ResultEnvelope<T> {
  readonly result: T;
}

export interface BlockRetentionMaintenanceWriter {
  readonly maintainStoreBlockRetention: (
    input: MaintainStoreBlockRetentionInput,
  ) => Promise<ResultEnvelope<MaintainStoreBlockRetentionResult>>;
}

export interface BlockRetentionMaintenanceSchedulerOptions {
  readonly writer: BlockRetentionMaintenanceWriter;
  readonly readStoreEpoch: () => string | null;
  readonly readRetentionCount: () => number;
  readonly initialDelayMs?: number;
  readonly intervalMs?: number;
  readonly onResult?: (result: MaintainStoreBlockRetentionResult) => void;
  readonly onError?: (error: unknown) => void;
  readonly setTimeoutImpl?: typeof setTimeout;
  readonly clearTimeoutImpl?: typeof clearTimeout;
}

export interface BlockRetentionMaintenanceScheduler {
  readonly dispose: () => void;
}

const requireDelay = (value: number, field: string): number => {
  if (Number.isSafeInteger(value) && value >= 0) return value;
  throw new TypeError(`${field} must be a non-negative integer`);
};

const requireRetentionCount = (value: number): number => {
  if (Number.isSafeInteger(value) && value >= 0) return value;
  throw new TypeError("history retention must be a non-negative integer");
};

/** Schedule at most one epoch-fenced FIFO retention pass at a time. */
export const startBlockRetentionMaintenanceScheduler = (
  options: BlockRetentionMaintenanceSchedulerOptions,
): BlockRetentionMaintenanceScheduler => {
  const setTimeoutImpl = options.setTimeoutImpl ?? setTimeout;
  const clearTimeoutImpl = options.clearTimeoutImpl ?? clearTimeout;
  const initialDelayMs = requireDelay(
    options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS,
    "initialDelayMs",
  );
  const intervalMs = requireDelay(
    options.intervalMs ?? DEFAULT_INTERVAL_MS,
    "intervalMs",
  );
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const schedule = (delayMs: number): void => {
    if (disposed) return;
    timer = setTimeoutImpl(() => {
      timer = null;
      let storeEpoch: string | null;
      let retainNewestDeletedBlocks: number;
      try {
        storeEpoch = options.readStoreEpoch();
        retainNewestDeletedBlocks = requireRetentionCount(
          options.readRetentionCount(),
        );
      } catch (error) {
        options.onError?.(error);
        schedule(intervalMs);
        return;
      }
      if (!storeEpoch) {
        schedule(intervalMs);
        return;
      }
      void options.writer
        .maintainStoreBlockRetention({
          storeEpoch,
          retainNewestDeletedBlocks,
        })
        .then(({ result }) => options.onResult?.(result))
        .catch((error) => options.onError?.(error))
        .finally(() => schedule(intervalMs));
    }, delayMs);
    timer.unref?.();
  };

  schedule(initialDelayMs);
  return {
    dispose: () => {
      if (disposed) return;
      disposed = true;
      if (timer !== null) clearTimeoutImpl(timer);
      timer = null;
    },
  };
};
