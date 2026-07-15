import {
  DOCUMENT_REVISION_MAINTENANCE_VERSION,
  type MaintainDocumentRevisionHistoryInput,
  type MaintainDocumentRevisionHistoryResult,
} from "../shared/block-documents/document-revision-maintenance";

const DEFAULT_INITIAL_DELAY_MS = 15_000;
const DEFAULT_INTERVAL_MS = 30_000;

interface ResultEnvelope<T> {
  readonly result: T;
}

export interface DocumentRevisionMaintenanceWriter {
  readonly maintainDocumentRevisionHistory: (
    input: MaintainDocumentRevisionHistoryInput,
  ) => Promise<ResultEnvelope<MaintainDocumentRevisionHistoryResult>>;
}

export interface DocumentRevisionMaintenanceSchedulerOptions {
  readonly writer: DocumentRevisionMaintenanceWriter;
  readonly readStoreEpoch: () => string | null;
  readonly initialDelayMs?: number;
  readonly intervalMs?: number;
  readonly now?: () => string;
  readonly onResult?: (result: MaintainDocumentRevisionHistoryResult) => void;
  readonly onError?: (error: unknown) => void;
  readonly setTimeoutImpl?: typeof setTimeout;
  readonly clearTimeoutImpl?: typeof clearTimeout;
}

export interface DocumentRevisionMaintenanceScheduler {
  readonly dispose: () => void;
}

const requireDelay = (value: number, field: string): number => {
  if (Number.isSafeInteger(value) && value >= 0) return value;
  throw new TypeError(`${field} must be a non-negative integer`);
};

export const startDocumentRevisionMaintenanceScheduler = (
  options: DocumentRevisionMaintenanceSchedulerOptions,
): DocumentRevisionMaintenanceScheduler => {
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
  const now = options.now ?? (() => new Date().toISOString());
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const schedule = (delayMs: number): void => {
    if (disposed) return;
    timer = setTimeoutImpl(() => {
      timer = null;
      let storeEpoch: string | null;
      try {
        storeEpoch = options.readStoreEpoch();
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
        .maintainDocumentRevisionHistory({
          version: DOCUMENT_REVISION_MAINTENANCE_VERSION,
          storeEpoch,
          now: now(),
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

