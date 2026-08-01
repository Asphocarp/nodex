import { describe, expect, it, vi } from "vitest";

import type { DesktopStoreAdministrationPort } from "./core-client/desktop-store-administration-bridge";
import { startStoreAdministrationMaintenanceScheduler } from "./store-administration-maintenance-scheduler";

const createPort = (): DesktopStoreAdministrationPort => ({
  listBackups: vi.fn(),
  createBackup: vi.fn(),
  deleteBackup: vi.fn(),
  restoreBackup: vi.fn(),
  pruneBackups: vi.fn(),
  runMaintenance: vi.fn(async () => undefined),
});

describe("Store Administration maintenance scheduler", () => {
  it("submits semantic lanes, samples retention policy, and disposes timers", async () => {
    const administration = createPort();
    const callbacks: Array<() => void> = [];
    const cleared: unknown[] = [];
    let authorityAvailable = false;
    let retentionCount = 17;
    const scheduler = startStoreAdministrationMaintenanceScheduler({
      administration,
      isAuthorityAvailable: () => authorityAvailable,
      readBlockRetentionCount: () => retentionCount,
      delays: {
        revision: { initial: 1, interval: 11 },
        document: { initial: 2, interval: 12 },
        block: { initial: 3, interval: 13 },
      },
      setTimeoutImpl: (callback) => {
        callbacks.push(callback);
        return { unref: vi.fn() } as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimeoutImpl: (timer) => {
        cleared.push(timer);
      },
      logger: { warn: vi.fn() },
    });

    await scheduler.runNow("revision");
    expect(administration.runMaintenance).not.toHaveBeenCalled();
    authorityAvailable = true;
    await scheduler.runNow("revision");
    await scheduler.runNow("document");
    await scheduler.runNow("block");
    expect(administration.runMaintenance).toHaveBeenNthCalledWith(1, {
      tasks: ["document_revision_finalize"],
    });
    expect(administration.runMaintenance).toHaveBeenNthCalledWith(2, {
      tasks: ["document_compaction", "history_retention"],
    });
    expect(administration.runMaintenance).toHaveBeenNthCalledWith(3, {
      tasks: ["block_retention"],
      blockRetentionCount: 17,
    });

    retentionCount = 3;
    await scheduler.runNow("block");
    expect(administration.runMaintenance).toHaveBeenLastCalledWith({
      tasks: ["block_retention"],
      blockRetentionCount: 3,
    });

    expect(callbacks).toHaveLength(3);
    scheduler.dispose();
    expect(cleared).toHaveLength(3);
    callbacks[0]?.();
    await Promise.resolve();
    expect(administration.runMaintenance).toHaveBeenCalledTimes(4);
  });
});
