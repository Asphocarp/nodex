import { describe, expect, test } from "vitest";

import {
  createDesktopStoreAdministrationBridge,
  mapCoreStoreAdministrationEvent,
} from "./desktop-store-administration-bridge";
import type { RustDataAuthorityRuntime } from "./desktop-data-authority";
import { createFakeCoreHandshake, FakeCoreClient } from "./testing/fake-core-client";
import { createCoreLocalCommitFixture } from "./testing/local-commit-fixture";
import type { StoreAdministrationApplyResult, StoreAdministrationReadSnapshot } from "./types";

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
  contract_version: 2,
  store_epoch: "epoch:test",
  commit_head: 4,
  value,
});

const committed = (
  value: Partial<StoreAdministrationApplyResult["outcome"]>,
): StoreAdministrationApplyResult => ({
  status: "committed",
  commit: {
    store_epoch: "epoch:test",
    commit_seq: 5,
    manifest_hash: "f".repeat(64),
  },
  receipt: {
    operation_id: "operation:test",
    duplicate: false,
    backup_id: value.backup_id ?? null,
    safety_backup_id: value.safety_backup_id ?? null,
  },
  outcome: {
    backup_id: null,
    safety_backup_id: null,
    completed_tasks: [],
    ...value,
  },
});

const rustRuntime = (client: FakeCoreClient): RustDataAuthorityRuntime =>
  ({
    backend: "rust",
    rootClient: Object.assign(client, {
      handshake: createFakeCoreHandshake({
        libraryId: "library:test",
        profileId: "profile:test",
        storeEpoch: "epoch:test",
      }),
    }),
    clientForProject: () => client,
  }) as unknown as RustDataAuthorityRuntime;

describe("Desktop Store Administration bridge", () => {
  test("maps complete Backup records and trusted backup mutations through Core", async () => {
    const client = new FakeCoreClient();
    const bridge = createDesktopStoreAdministrationBridge({
      authority: Promise.resolve(rustRuntime(client)),
    });
    client.enqueueAdministrationApply(committed({ backup_id: backup.backup_id }));
    client.enqueueAdministrationRead(
      readSnapshot({
        kind: "backups",
        backups: {
          items: [backup],
          next_cursor: null,
          authority: {
            projection_revision: 4,
          },
        },
      }),
    );

    await expect(
      bridge.createBackup({
        trigger: "auto",
        label: "  Before refactor  ",
      }),
    ).resolves.toEqual({
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

  test("maps Store Administration events", () => {
    const packet = createCoreLocalCommitFixture({
      commitSeq: 5,
      storeEpoch: "epoch:test",
      operationId: "operation:backup",
      committedAt: "2026-07-19T20:00:00.000Z",
      payload: {
        module: "store_administration",
        library_id: "library-1",
        event: {
          kind: "store_administration_changed",
          operation: "create_backup",
          backup_ids: ["core-backup"],
          readiness_changed: false,
        },
      },
      canonicalHash: "0".repeat(64),
    });
    expect(mapCoreStoreAdministrationEvent(packet.atoms[0]!)).toEqual({
      backupIds: ["core-backup"],
      readinessChanged: false,
    });
  });
});
