import { describe, expect, test } from "vitest";
import { startDocumentRevisionMaintenanceScheduler } from "./document-revision-maintenance-scheduler";

const emptyResult = {
  scannedDocumentCount: 0,
  finalizedDocumentCount: 0,
  alreadyCoveredDocumentCount: 0,
  staleSessionCount: 0,
  deferredDocumentCount: 0,
  failedDocumentCount: 0,
} as const;

const settleAsyncChain = async (): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
};

describe("Document revision maintenance scheduler", () => {
  test("runs non-overlapping epoch-fenced idle passes", async () => {
    const callbacks: Array<() => void> = [];
    const delays: number[] = [];
    const requests: string[] = [];
    const pending: { release?: () => void } = {};
    const scheduler = startDocumentRevisionMaintenanceScheduler({
      writer: {
        maintainDocumentRevisionHistory: async (input) => {
          requests.push(`${input.storeEpoch}:${input.now}`);
          await new Promise<void>((resolve) => {
            pending.release = resolve;
          });
          return { result: emptyResult };
        },
      },
      readStoreEpoch: () => "epoch-1",
      now: () => "2026-07-16T00:00:00.000Z",
      initialDelayMs: 5,
      intervalMs: 10,
      setTimeoutImpl: ((callback: () => void, delay: number) => {
        callbacks.push(callback);
        delays.push(delay);
        return { unref: () => undefined };
      }) as unknown as typeof setTimeout,
      clearTimeoutImpl: (() => undefined) as typeof clearTimeout,
    });

    expect(delays).toEqual([5]);
    callbacks.shift()?.();
    await Promise.resolve();
    expect(requests).toEqual(["epoch-1:2026-07-16T00:00:00.000Z"]);
    expect(callbacks).toHaveLength(0);
    pending.release?.();
    await settleAsyncChain();
    expect(delays).toEqual([5, 10]);
    scheduler.dispose();
  });
});

