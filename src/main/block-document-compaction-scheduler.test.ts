import { describe, expect, test } from "vitest";
import type { CompactEligibleBlockDocumentsResult } from "./local-store/block-document-compaction";
import { startBlockDocumentCompactionScheduler } from "./block-document-compaction-scheduler";

const emptyResult = (
  storeEpoch: string,
): CompactEligibleBlockDocumentsResult => ({
  storeEpoch,
  selectedDocumentCount: 0,
  selectedUpdateCount: 0,
  selectedUpdateBytes: 0,
  documents: [],
});

const settleAsyncChain = async (): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
};

describe("Block Document compaction scheduler", () => {
  test("samples the epoch per pass and never overlaps FIFO maintenance", async () => {
    const callbacks: Array<() => void> = [];
    const delays: number[] = [];
    const requests: string[] = [];
    const pending: { release?: () => void } = {};
    const scheduler = startBlockDocumentCompactionScheduler({
      writer: {
        compactEligibleBlockDocuments: async (input) => {
          requests.push(input.storeEpoch);
          await new Promise<void>((resolve) => {
            pending.release = resolve;
          });
          return { result: emptyResult(input.storeEpoch) };
        },
      },
      readStoreEpoch: () => `epoch-${requests.length + 1}`,
      initialDelayMs: 5,
      intervalMs: 10,
      setTimeoutImpl: ((callback: () => void, delay: number) => {
        callbacks.push(callback);
        delays.push(delay);
        return { unref: () => undefined };
      }) as unknown as typeof setTimeout,
      clearTimeoutImpl: (() => undefined) as typeof clearTimeout,
    });

    expect(delays.join(",")).toBe("5");
    callbacks.shift()?.();
    await Promise.resolve();
    expect(requests.join(",")).toBe("epoch-1");
    expect(callbacks.length).toBe(0);
    const release = pending.release;
    if (!release) throw new Error("Compaction pass did not start");
    release();
    await settleAsyncChain();
    expect(delays.join(",")).toBe("5,10");
    scheduler.dispose();
  });

  test("reports a failed pass and schedules the next epoch instead of stopping", async () => {
    const callbacks: Array<() => void> = [];
    const errors: string[] = [];
    const scheduler = startBlockDocumentCompactionScheduler({
      writer: {
        compactEligibleBlockDocuments: async () => {
          throw new Error("stale epoch");
        },
      },
      readStoreEpoch: () => "epoch-before-restore",
      initialDelayMs: 0,
      intervalMs: 10,
      onError: (error) =>
        errors.push(error instanceof Error ? error.message : String(error)),
      setTimeoutImpl: ((callback: () => void) => {
        callbacks.push(callback);
        return { unref: () => undefined };
      }) as unknown as typeof setTimeout,
      clearTimeoutImpl: (() => undefined) as typeof clearTimeout,
    });
    callbacks.shift()?.();
    await settleAsyncChain();
    expect(errors.join(",")).toBe("stale epoch");
    expect(callbacks.length).toBe(1);
    scheduler.dispose();
  });

  test("does not enqueue while the store is unavailable", () => {
    const callbacks: Array<() => void> = [];
    let calls = 0;
    const scheduler = startBlockDocumentCompactionScheduler({
      writer: {
        compactEligibleBlockDocuments: async () => {
          calls += 1;
          return { result: emptyResult("never") };
        },
      },
      readStoreEpoch: () => null,
      initialDelayMs: 0,
      intervalMs: 10,
      setTimeoutImpl: ((callback: () => void) => {
        callbacks.push(callback);
        return { unref: () => undefined };
      }) as unknown as typeof setTimeout,
      clearTimeoutImpl: (() => undefined) as typeof clearTimeout,
    });
    callbacks.shift()?.();
    expect(calls).toBe(0);
    expect(callbacks.length).toBe(1);
    scheduler.dispose();
  });

  test("survives a maintenance-window epoch read failure", () => {
    const callbacks: Array<() => void> = [];
    const errors: string[] = [];
    let calls = 0;
    const scheduler = startBlockDocumentCompactionScheduler({
      writer: {
        compactEligibleBlockDocuments: async () => {
          calls += 1;
          return { result: emptyResult("never") };
        },
      },
      readStoreEpoch: () => {
        throw new Error("store suspended");
      },
      initialDelayMs: 0,
      intervalMs: 10,
      onError: (error) =>
        errors.push(error instanceof Error ? error.message : String(error)),
      setTimeoutImpl: ((callback: () => void) => {
        callbacks.push(callback);
        return { unref: () => undefined };
      }) as unknown as typeof setTimeout,
      clearTimeoutImpl: (() => undefined) as typeof clearTimeout,
    });
    callbacks.shift()?.();
    expect(calls).toBe(0);
    expect(errors.join(",")).toBe("store suspended");
    expect(callbacks.length).toBe(1);
    scheduler.dispose();
  });
});
