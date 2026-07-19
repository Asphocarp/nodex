import { describe, expect, test, vi } from "vitest";

import {
  createDesktopStoreAdministrationBridge,
  mapCoreStoreAdministrationEvent,
  type DesktopStoreAdministrationPort,
} from "./desktop-store-administration-bridge";
import type { RustDataAuthorityRuntime } from "./desktop-data-authority";
import { FakeCoreClient } from "./testing/fake-core-client";
import type {
  StoreAdministrationCommittedValue,
  StoreAdministrationReadSnapshot,
} from "./types";

const backup = {
  version: 2,
  backup_id: "core-backup",
  trigger: "auto" as const,
  label: "Before refactor",
  created_at: "2026-07-19T20:00:00.000Z",
  includes_assets: true,
  db_bytes: 100,
  assets_bytes: 20,
  total_bytes: 120,
  byte_length: 120,
};

const readSnapshot = (
  value: StoreAdministrationReadSnapshot["value"],
): StoreAdministrationReadSnapshot => ({
  version: 1,
  store_epoch: "epoch:test",
  event_head: 4,
  value,
});

const committed = (
  value: Partial<StoreAdministrationCommittedValue["value"]>,
): StoreAdministrationCommittedValue => ({
  store_epoch: "epoch:test",
  event_sequence: 5,
  receipt: {
    operation_id: "operation:test",
    duplicate: false,
    backup_id: value.backup_id ?? null,
    safety_backup_id: value.safety_backup_id ?? null,
  },
  value: {
    backup_id: null,
    safety_backup_id: null,
    completed_tasks: [],
    ...value,
  },
});

const rustRuntime = (client: FakeCoreClient): RustDataAuthorityRuntime => ({
  backend: "rust",
  rootClient: Object.assign(client, {
    handshake: {
      library_id: "library:test",
      profile_id: "profile:test",
      store_epoch: "epoch:test",
      event_head: 0,
    },
  }),
  clientForProject: () => client,
}) as unknown as RustDataAuthorityRuntime;

const fallback = (): DesktopStoreAdministrationPort => ({
  listBackups: vi.fn(() => Promise.reject(new Error("TypeScript fallback ran"))),
  createBackup: vi.fn(() => Promise.reject(new Error("TypeScript fallback ran"))),
  deleteBackup: vi.fn(() => Promise.reject(new Error("TypeScript fallback ran"))),
  restoreBackup: vi.fn(() => Promise.reject(new Error("TypeScript fallback ran"))),
  pruneBackups: vi.fn(() => Promise.reject(new Error("TypeScript fallback ran"))),
  runMaintenance: vi.fn(() => Promise.reject(new Error("TypeScript fallback ran"))),
});

describe("Desktop Store Administration bridge", () => {
  test("maps complete Backup records and trusted backup mutations through Core", async () => {
    const client = new FakeCoreClient();
    const bridge = createDesktopStoreAdministrationBridge({
      authority: Promise.resolve(rustRuntime(client)),
      typescript: fallback(),
    });
    client.enqueueAdministrationApply(committed({ backup_id: backup.backup_id }));
    client.enqueueAdministrationRead(readSnapshot({
      kind: "backups",
      items: [backup],
    }));

    await expect(bridge.createBackup({
      trigger: "auto",
      label: "  Before refactor  ",
    })).resolves.toEqual({
      version: 2,
      id: "core-backup",
      trigger: "auto",
      label: "Before refactor",
      createdAt: "2026-07-19T20:00:00.000Z",
      includesAssets: true,
      dbBytes: 100,
      assetsBytes: 20,
      totalBytes: 120,
    });
    expect(client.administrationApplies[0]?.intent).toEqual({
      kind: "create_backup",
      label: "Before refactor",
      include_assets: true,
      trigger: "auto",
    });

    client.enqueueAdministrationApply(committed({ backup_id: backup.backup_id }));
    await expect(bridge.deleteBackup(backup.backup_id)).resolves.toEqual({
      success: true,
      deletedBackupId: backup.backup_id,
    });
    expect(client.administrationApplies[1]?.intent).toEqual({
      kind: "delete_backup",
      backup_id: backup.backup_id,
    });

    client.enqueueAdministrationApply(committed({}));
    await bridge.runMaintenance({
      tasks: ["document_revision_finalize", "block_retention"],
      blockRetentionCount: 37,
    });
    expect(client.administrationApplies[2]?.intent).toEqual({
      kind: "run_maintenance",
      tasks: ["document_revision_finalize", "block_retention"],
      block_retention_count: 37,
    });
  });

  test("maps Store Administration events and selects the explicit fallback", async () => {
    expect(mapCoreStoreAdministrationEvent({
      protocol_version: 1,
      event: {
        version: 1,
        sequence: 5,
        store_epoch: "epoch:test",
        operation_id: "operation:backup",
        committed_at: "2026-07-19T20:00:00.000Z",
        payload: {
          module: "store_administration",
          event: {
            kind: "store_administration_changed",
            operation: "create_backup",
            backup_ids: ["core-backup"],
            readiness_changed: false,
          },
        },
      },
    })).toEqual({
      backupIds: ["core-backup"],
      readinessChanged: false,
    });

    const typescript = fallback();
    vi.mocked(typescript.listBackups).mockResolvedValue([]);
    const bridge = createDesktopStoreAdministrationBridge({
      authority: Promise.resolve({ backend: "typescript" } as never),
      typescript,
    });
    await expect(bridge.listBackups()).resolves.toEqual([]);
    expect(typescript.listBackups).toHaveBeenCalledOnce();
  });
});
