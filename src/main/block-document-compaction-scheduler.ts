import type {
  BlockDocumentCompactionPolicy,
  CompactEligibleBlockDocumentsInput,
  CompactEligibleBlockDocumentsResult,
} from "./local-store/block-document-compaction";

const DEFAULT_INITIAL_DELAY_MS = 30_000;
const DEFAULT_INTERVAL_MS = 15 * 60_000;

interface ResultEnvelope<T> {
  readonly result: T;
}

export interface BlockDocumentCompactionWriter {
  readonly compactEligibleBlockDocuments: (
    input: CompactEligibleBlockDocumentsInput,
  ) => Promise<ResultEnvelope<CompactEligibleBlockDocumentsResult>>;
}

export interface BlockDocumentCompactionSchedulerOptions {
  readonly writer: BlockDocumentCompactionWriter;
  readonly readStoreEpoch: () => string | null;
  readonly policy?: Partial<BlockDocumentCompactionPolicy>;
  readonly initialDelayMs?: number;
  readonly intervalMs?: number;
  readonly onResult?: (result: CompactEligibleBlockDocumentsResult) => void;
  readonly onError?: (error: unknown) => void;
  readonly setTimeoutImpl?: typeof setTimeout;
  readonly clearTimeoutImpl?: typeof clearTimeout;
}

export interface BlockDocumentCompactionScheduler {
  readonly dispose: () => void;
}

const requireDelay = (value: number, field: string): number => {
  if (Number.isSafeInteger(value) && value >= 0) return value;
  throw new TypeError(`${field} must be a non-negative integer`);
};

/**
 * Schedule one FIFO compaction pass at a time. The epoch is sampled before
 * every enqueue, so a request accepted before whole-store restore cannot
 * silently compact the restored store if it resumes after the epoch rotates.
 */
export const startBlockDocumentCompactionScheduler = (
  options: BlockDocumentCompactionSchedulerOptions,
): BlockDocumentCompactionScheduler => {
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
        .compactEligibleBlockDocuments({
          storeEpoch,
          ...(options.policy === undefined ? {} : { policy: options.policy }),
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
