import { describe, expect, test, vi } from "vitest";

import type { DesktopStoreAdministrationPort } from "./core-client/desktop-store-administration-bridge";
import { startStoreAdministrationBackupScheduler } from "./store-administration-backup-scheduler";

const administration = (): DesktopStoreAdministrationPort => ({
  listBackups: vi.fn(),
  createBackup: vi.fn(async () => ({
    version: 2,
    id: "backup:auto",
    createdAt: "2026-07-19T20:00:00.000Z",
    trigger: "auto" as const,
    label: null,
    includesAssets: true,
    dbBytes: 100,
    assetsBytes: 20,
    totalBytes: 120,
  })),
  deleteBackup: vi.fn(),
  restoreBackup: vi.fn(),
  pruneBackups: vi.fn(async () => undefined),
  runMaintenance: vi.fn(),
});

describe("Store Administration backup scheduler", () => {
  test("creates and prunes automatic backups through one selected authority", async () => {
    const port = administration();
    let authorityAvailable = false;
    let intervalMs = 0;
    let cleared = false;
    const timer = { unref: vi.fn() } as unknown as ReturnType<typeof setInterval>;
    const scheduler = startStoreAdministrationBackupScheduler({
      administration: port,
      enabled: true,
      isAuthorityAvailable: () => authorityAvailable,
      intervalHours: 2,
      retentionCount: 4,
      setIntervalImpl: (_callback, milliseconds) => {
        intervalMs = milliseconds;
        return timer;
      },
      clearIntervalImpl: (candidate) => {
        cleared = candidate === timer;
      },
      logger: { error: vi.fn() },
    });

    await scheduler.runNow();
    expect(port.createBackup).not.toHaveBeenCalled();
    authorityAvailable = true;
    await scheduler.runNow();
    expect(port.createBackup).toHaveBeenCalledWith({ trigger: "auto" });
    expect(port.pruneBackups).toHaveBeenCalledWith(4);
    expect(intervalMs).toBe(2 * 60 * 60 * 1_000);

    scheduler.dispose();
    expect(cleared).toBe(true);
  });

  test("does not start retention work after authority is lost during backup", async () => {
    let authorityAvailable = true;
    let resolveBackup: () => void = () => undefined;
    const port: DesktopStoreAdministrationPort = {
      ...administration(),
      createBackup: vi.fn(
        async () =>
          await new Promise<Awaited<ReturnType<DesktopStoreAdministrationPort["createBackup"]>>>(
            (resolve) => {
              resolveBackup = () =>
                resolve({
                  version: 2,
                  id: "backup:auto",
                  createdAt: "2026-07-19T20:00:00.000Z",
                  trigger: "auto" as const,
                  label: null,
                  includesAssets: true,
                  dbBytes: 100,
                  assetsBytes: 20,
                  totalBytes: 120,
                });
            },
          ),
      ),
    };
    const scheduler = startStoreAdministrationBackupScheduler({
      administration: port,
      enabled: false,
      isAuthorityAvailable: () => authorityAvailable,
      intervalHours: 2,
      retentionCount: 4,
      logger: { error: vi.fn() },
    });

    const run = scheduler.runNow();
    await vi.waitFor(() => expect(port.createBackup).toHaveBeenCalledTimes(1));
    authorityAvailable = false;
    resolveBackup();
    await run;

    expect(port.pruneBackups).not.toHaveBeenCalled();
    scheduler.dispose();
  });
});
