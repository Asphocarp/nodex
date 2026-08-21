import { beforeAll, describe, expect, test, vi } from "vitest";

import type { DesktopStoreAdministrationPort } from "./core-client/desktop-store-administration-bridge";
import {
  registerStoreAdministrationIpcHandlers,
  type StoreAdministrationIpcChannel,
  type StoreAdministrationIpcHandler,
} from "./store-administration-ipc-handlers";

type RegisteredHandler = (event: unknown, ...args: unknown[]) => unknown;
const handlers = new Map<string, RegisteredHandler>();
const restored = vi.fn();
const backup = {
  version: 2,
  id: "backup:one",
  createdAt: "2026-07-19T20:00:00.000Z",
  trigger: "manual" as const,
  label: "Before refactor",
  includesAssets: true,
  dbBytes: 100,
  assetsBytes: 20,
  totalBytes: 120,
};
const administration: DesktopStoreAdministrationPort = {
  listBackups: vi.fn(async () => [backup]),
  createBackup: vi.fn(async () => backup),
  deleteBackup: vi.fn(async (backupId: string) => ({
    success: true as const,
    deletedBackupId: backupId,
  })),
  restoreBackup: vi.fn(async (input) => ({
    success: true,
    restoredBackupId: input.backupId,
  })),
  pruneBackups: vi.fn(),
  runMaintenance: vi.fn(),
};

const invoke = async (channel: string, ...args: unknown[]): Promise<unknown> => {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`Missing handler: ${channel}`);
  return await handler(null, ...args);
};

beforeAll(() => {
  registerStoreAdministrationIpcHandlers({
    registerHandle: <Channel extends StoreAdministrationIpcChannel>(
      channel: Channel,
      handler: StoreAdministrationIpcHandler<Channel>,
    ) => {
      handlers.set(channel, handler as RegisteredHandler);
    },
    administration,
    onStoreRestored: restored,
  });
});

describe("Store Administration IPC handlers", () => {
  test("routes the complete Backup surface through the selected authority", async () => {
    await expect(invoke("backup:list")).resolves.toEqual([backup]);
    await expect(
      invoke("backup:create", {
        label: "Before refactor",
      }),
    ).resolves.toEqual(backup);
    expect(administration.createBackup).toHaveBeenCalledWith({
      trigger: "manual",
      label: "Before refactor",
    });
    await expect(invoke("backup:delete", backup.id)).resolves.toEqual({
      success: true,
      deletedBackupId: backup.id,
    });
    await expect(
      invoke("backup:restore", {
        backupId: backup.id,
        confirm: true,
        createSafetyBackup: true,
      }),
    ).resolves.toEqual({
      success: true,
      restoredBackupId: backup.id,
    });
    expect(restored).toHaveBeenCalledOnce();
  });
});
