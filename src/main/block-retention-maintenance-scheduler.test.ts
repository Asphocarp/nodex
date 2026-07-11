import { describe, expect, test } from "vitest";

import type { MaintainStoreBlockRetentionResult } from "./local-store/block-retention-maintenance-store";
import { startBlockRetentionMaintenanceScheduler } from "./block-retention-maintenance-scheduler";

const emptyResult = (
  storeEpoch: string,
  retainNewestDeletedBlocks: number,
): MaintainStoreBlockRetentionResult => ({
  storeEpoch,
  retainNewestDeletedBlocks,
  projectResults: [],
  collectedCandidateCount: 0,
  coveredCandidateCount: 0,
  retainedCandidateCount: 0,
  failedCandidateCount: 0,
  collectedBlockCount: 0,
});

const settleAsyncChain = async (): Promise<void> => {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
};

describe("Block retention maintenance scheduler", () => {
  test("samples epoch and policy for each non-overlapping FIFO pass", async () => {
    const callbacks: Array<() => void> = [];
    const delays: number[] = [];
    const requests: string[] = [];
    const pending: { release?: () => void } = {};
    const scheduler = startBlockRetentionMaintenanceScheduler({
      writer: {
        maintainStoreBlockRetention: async (input) => {
          requests.push(
            `${input.storeEpoch}:${input.retainNewestDeletedBlocks}`,
          );
          await new Promise<void>((resolve) => {
            pending.release = resolve;
          });
          return {
            result: emptyResult(
              input.storeEpoch,
              input.retainNewestDeletedBlocks,
            ),
          };
        },
      },
      readStoreEpoch: () => `epoch-${requests.length + 1}`,
      readRetentionCount: () => 250 + requests.length,
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
    expect(requests.join(",")).toBe("epoch-1:250");
    expect(callbacks.length).toBe(0);
    const release = pending.release;
    if (!release) throw new Error("Retention pass did not start");
    release();
    await settleAsyncChain();
    expect(delays.join(",")).toBe("5,10");
    scheduler.dispose();
  });

  test("reports rejected maintenance and schedules a later pass", async () => {
    const callbacks: Array<() => void> = [];
    const errors: string[] = [];
    const scheduler = startBlockRetentionMaintenanceScheduler({
      writer: {
        maintainStoreBlockRetention: async () => {
          throw new Error("store epoch changed");
        },
      },
      readStoreEpoch: () => "epoch-before-restore",
      readRetentionCount: () => 100,
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
    expect(errors.join(",")).toBe("store epoch changed");
    expect(callbacks.length).toBe(1);
    scheduler.dispose();
  });

  test("fails closed while store or policy settings are unavailable", () => {
    const callbacks: Array<() => void> = [];
    const errors: string[] = [];
    let calls = 0;
    const scheduler = startBlockRetentionMaintenanceScheduler({
      writer: {
        maintainStoreBlockRetention: async () => {
          calls += 1;
          return { result: emptyResult("never", 0) };
        },
      },
      readStoreEpoch: () => "epoch",
      readRetentionCount: () => -1,
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
    expect(errors.join(",")).toBe(
      "history retention must be a non-negative integer",
    );
    expect(callbacks.length).toBe(1);
    scheduler.dispose();
  });
});
