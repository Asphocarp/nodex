import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { assert, it } from "@effect/vitest";
import { createCoreLocalCommitFixture } from "../core-client/testing/local-commit-fixture";
import type {
  StoreAdministrationApplyInput,
  StoreAdministrationApplyResult,
  StoreAdministrationRead,
  StoreAdministrationReadSnapshot,
} from "../core-client/types";
import { CoreModules, type CoreModuleClients } from "./CoreModules";
import { live, mapCoreStoreAdministrationEvent, StoreAdministration } from "./StoreAdministration";

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

const makeHarness = () => {
  const reads: StoreAdministrationRead[] = [];
  const applies: StoreAdministrationApplyInput[] = [];
  const readResults: StoreAdministrationReadSnapshot[] = [];
  const applyResults: StoreAdministrationApplyResult[] = [];
  const administration: CoreModuleClients["administration"] = {
    read: (read) =>
      Effect.sync(() => {
        reads.push(read);
        const result = readResults.shift();
        if (!result) throw new Error("Missing Store Administration read result");
        return result;
      }),
    apply: (input) =>
      Effect.sync(() => {
        applies.push(input);
        const result = applyResults.shift();
        if (!result) throw new Error("Missing Store Administration apply result");
        return result;
      }),
  };
  const core = CoreModules.of({ administration } as unknown as CoreModuleClients);
  const layer = live.pipe(Layer.provide(Layer.succeed(CoreModules, core)));
  return { applies, applyResults, layer, reads, readResults };
};

it.effect("owns Backup CRUD and maintenance semantics on the typed Core Module", () =>
  Effect.gen(function* () {
    const harness = makeHarness();
    harness.applyResults.push(committed({ backup_id: backup.backup_id }));
    harness.readResults.push(
      readSnapshot({
        kind: "backups",
        backups: {
          items: [backup],
          next_cursor: null,
          authority: { projection_revision: 4 },
        },
      }),
    );
    harness.applyResults.push(committed({ backup_id: backup.backup_id }));
    harness.applyResults.push(committed({}));
    harness.applyResults.push(committed({}));
    const context = yield* Layer.build(harness.layer);
    const administration = Context.get(context, StoreAdministration);

    assert.deepStrictEqual(
      yield* administration.createBackup({ trigger: "auto", label: "  Before refactor  " }),
      {
        version: 2,
        id: "core-backup",
        trigger: "auto",
        label: "Before refactor",
        createdAt: "2026-07-19T20:00:00.000Z",
        includesAssets: true,
        dbBytes: 100,
        assetsBytes: 20,
        totalBytes: 120,
      },
    );
    assert.deepStrictEqual(yield* administration.deleteBackup("core-backup"), {
      success: true,
      deletedBackupId: "core-backup",
    });
    yield* administration.pruneBackups(-4.8);
    yield* administration.runMaintenance({
      tasks: ["document_revision_finalize", "block_retention"],
      blockRetentionCount: 37.9,
    });

    assert.deepStrictEqual(harness.reads, [
      { kind: "backups", window: { after: null, first: 200 } },
    ]);
    assert.deepStrictEqual(
      harness.applies.map((input) => input.intent),
      [
        {
          kind: "create_backup",
          label: "Before refactor",
          include_assets: true,
          trigger: "auto",
        },
        { kind: "delete_backup", backup_id: "core-backup" },
        { kind: "prune_backups", retain_count: 0 },
        {
          kind: "run_maintenance",
          tasks: ["document_revision_finalize", "block_retention"],
          block_retention_count: 37,
        },
      ],
    );
  }),
);

it.effect("requires explicit confirmation and returns the safety Backup identity", () =>
  Effect.gen(function* () {
    const harness = makeHarness();
    const context = yield* Layer.build(harness.layer);
    const administration = Context.get(context, StoreAdministration);

    const rejected = yield* administration
      .restoreBackup({ backupId: "core-backup", confirm: false })
      .pipe(Effect.result);
    assert.isTrue(rejected._tag === "Failure");
    assert.lengthOf(harness.applies, 0);

    harness.applyResults.push(
      committed({ backup_id: "core-backup", safety_backup_id: "safety-backup" }),
    );
    assert.deepStrictEqual(
      yield* administration.restoreBackup({
        backupId: "core-backup",
        confirm: true,
        createSafetyBackup: true,
      }),
      {
        success: true,
        restoredBackupId: "core-backup",
        safetyBackupId: "safety-backup",
      },
    );
    assert.deepStrictEqual(harness.applies[0]?.intent, {
      kind: "restore_backup",
      backup_id: "core-backup",
      create_safety_backup: true,
    });
  }),
);

it("maps Store Administration invalidation without another event owner", () => {
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
  assert.deepStrictEqual(mapCoreStoreAdministrationEvent(packet.atoms[0]!), {
    backupIds: ["core-backup"],
    readinessChanged: false,
  });
});
