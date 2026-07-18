import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { WORKFLOW_STATUS_COLUMNS } from "../../shared/workflow-status";
import {
  LEGACY_WORKFLOW_STATUS_ORDER,
  WORKFLOW_STATUS_CUTOVER_MAP,
} from "../../shared/workflow-status-cutover";
import { stableStringifyBlockPropertyJson } from "../../shared/block-property-mutations";
import { resetAssetPathCacheForTests } from "./assets";
import { closeDatabase, getDb } from "./database";
import { createHistoricalReleaseSchemaFixture } from "./schema";
import { migrateDatabaseIdentityAuthorityV80ToV81 } from "./database-identity-cutover-sqlite";
import {
  migrateWorkflowStatusesV81ToV82,
  WORKFLOW_STATUS_CUTOVER_FAULT_POINTS,
} from "./workflow-status-cutover-sqlite";

const tempDirectories: string[] = [];

const useTempStore = (): void => {
  closeDatabase();
  resetAssetPathCacheForTests();
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "nodex-workflow-status-cutover-"),
  );
  tempDirectories.push(directory);
  process.env.NODEX_HOME = directory;
};

afterEach(() => {
  closeDatabase();
  resetAssetPathCacheForTests();
  delete process.env.NODEX_HOME;
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const createV81Fixture = () => {
  useTempStore();
  const database = getDb();
  createHistoricalReleaseSchemaFixture(database, 80);
  migrateDatabaseIdentityAuthorityV80ToV81(database);
  const root = database.prepare(`
    SELECT
      project.id AS project_id,
      project.database_block_id AS database_id,
      source.id AS data_source_id,
      container.default_view_id AS view_id
    FROM projects project
    INNER JOIN database_containers container
      ON container.block_id = project.database_block_id
    INNER JOIN data_sources source
      ON source.home_database_block_id = container.block_id
    ORDER BY project.created, source.rank_key
    LIMIT 1
  `).get() as {
    readonly project_id: string;
    readonly database_id: string;
    readonly data_source_id: string;
    readonly view_id: string;
  };
  const now = "2026-07-18T00:00:00.000Z";
  const insertBlock = database.prepare(`
    INSERT INTO blocks (
      id, project_id, type, lifecycle, location_kind,
      containing_document_id, containing_database_id,
      location_revision, metadata_revision, created_at, updated_at
    ) VALUES (?, ?, 'page', 'active', 'database', NULL, ?, 1, 1, ?, ?)
  `);
  const insertMembership = database.prepare(`
    INSERT INTO data_source_page_memberships (
      id, data_source_id, page_block_id, revision, created_at, removed_at
    ) VALUES (?, ?, ?, 1, ?, NULL)
  `);
  const insertValue = database.prepare(`
    INSERT INTO data_source_property_values (
      data_source_id, membership_id, property_id, value_type,
      value_json, revision, updated_at
    ) VALUES (?, ?, 'status', 'select', ?, 1, ?)
  `);
  const insertPosition = database.prepare(`
    INSERT INTO database_view_page_positions (
      view_id, page_block_id, group_key, rank_key, revision, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 1, ?, ?)
  `);
  LEGACY_WORKFLOW_STATUS_ORDER.forEach((status, index) => {
    const pageId = `status-cutover-page-${status}`;
    const membershipId = `status-cutover-membership-${status}`;
    insertBlock.run(pageId, root.project_id, root.database_id, now, now);
    insertMembership.run(
      membershipId,
      root.data_source_id,
      pageId,
      now,
    );
    insertValue.run(
      root.data_source_id,
      membershipId,
      stableStringifyBlockPropertyJson(status),
      now,
    );
    insertPosition.run(
      root.view_id,
      pageId,
      status,
      String(index + 1).padStart(32, "0"),
      now,
      now,
    );
  });
  const viewConfigRow = database.prepare(`
    SELECT config_json FROM database_views WHERE id = ?
  `).get(root.view_id) as { readonly config_json: string };
  const viewConfig = JSON.parse(viewConfigRow.config_json) as Record<string, unknown>;
  database.prepare(`
    UPDATE database_views SET config_json = ? WHERE id = ?
  `).run(
    stableStringifyBlockPropertyJson({
      ...viewConfig,
      filter: {
        kind: "clause",
        propertyId: "status",
        operator: "equals",
        value: "in_review",
      },
    }),
    root.view_id,
  );
  const metadata = database.prepare(`
    SELECT store_epoch FROM block_store_metadata WHERE id = 1
  `).get() as { readonly store_epoch: string };

  const mutationId = "status-cutover-evidence";
  const request = {
    version: 2,
    operationId: mutationId,
    projectId: root.project_id,
    storeEpoch: metadata.store_epoch,
    actor: { status: "done", source: "test" },
    operation: {
      kind: "create_page",
      pageId: "status-cutover-page-draft",
      status: "draft",
    },
  };
  const requestJson = stableStringifyBlockPropertyJson(request);
  const requestHash = createHash("sha256").update(requestJson).digest("hex");
  const inserted = database.prepare(`
    INSERT INTO change_log (
      project_id, store_epoch, kind, operation_id, block_ids_json,
      document_ids_json, database_block_ids_json, payload_json, committed_at
    ) VALUES (?, ?, 'block_mutation', ?, ?, '[]', ?, ?, ?)
  `).run(
    root.project_id,
    metadata.store_epoch,
    mutationId,
    stableStringifyBlockPropertyJson(["status-cutover-page-draft"]),
    stableStringifyBlockPropertyJson([root.database_id]),
    stableStringifyBlockPropertyJson({
      version: 2,
      mutationKind: "page_lifecycle_v2",
      requestHash,
      status: "draft",
    }),
    now,
  );
  database.prepare(`
    INSERT INTO block_mutations (
      mutation_id, project_id, store_epoch, mutation_kind, actor_json,
      client_session_id, request_hash, request_json, target_block_ids_json,
      affected_document_ids_json, affected_database_block_ids_json,
      field_intents_json, expected_revisions_json, outcome, result_json,
      committed_revisions_json, document_heads_json, change_log_seq, recorded_at
    ) VALUES (
      ?, ?, ?, 'page_lifecycle_v2', '{}', NULL, ?, ?, ?, '[]', ?, '[]', '{}',
      'committed', ?, '{}', '{}', ?, ?
    )
  `).run(
    mutationId,
    root.project_id,
    metadata.store_epoch,
    requestHash,
    requestJson,
    stableStringifyBlockPropertyJson(["status-cutover-page-draft"]),
    stableStringifyBlockPropertyJson([root.database_id]),
    stableStringifyBlockPropertyJson({ status: "done" }),
    Number(inserted.lastInsertRowid),
    now,
  );
  return {
    database,
    previousStoreEpoch: metadata.store_epoch,
    mutationId,
  };
};

describe("workflow status v81 to v82 cutover", () => {
  test("publishes the canonical status registry and rotates the store epoch", () => {
    const { database, previousStoreEpoch, mutationId } = createV81Fixture();

    const report = migrateWorkflowStatusesV81ToV82(database, {
      nextStoreEpoch: "status-cutover-epoch",
      now: "2026-07-18T00:00:00.000Z",
    });

    expect(report.sourceVersion).toBe(81);
    expect(report.targetVersion).toBe(82);
    expect(report.previousStoreEpoch).toBe(previousStoreEpoch);
    expect(report.nextStoreEpoch).toBe("status-cutover-epoch");
    expect(report).toMatchObject({
      migratedStatusProperties: 1,
      migratedStatusValues: 5,
      rewrittenViews: 1,
      rewrittenPositions: 5,
      rewrittenEvidenceAggregates: 1,
    });
    expect(database.pragma("user_version", { simple: true })).toBe(82);
    const rows = database.prepare(`
      SELECT config_json FROM data_source_properties
      WHERE id = 'status'
      ORDER BY data_source_id
    `).all() as readonly { readonly config_json: string }[];
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect((JSON.parse(row.config_json) as { options: unknown }).options)
        .toEqual(WORKFLOW_STATUS_COLUMNS);
    }
    const values = database.prepare(`
      SELECT value_json FROM data_source_property_values
      WHERE property_id = 'status'
      ORDER BY membership_id
    `).all() as readonly { readonly value_json: string }[];
    expect(new Set(values.map((row) => JSON.parse(row.value_json))))
      .toEqual(new Set(Object.values(WORKFLOW_STATUS_CUTOVER_MAP)));
    const positions = database.prepare(`
      SELECT group_key FROM database_view_page_positions
      ORDER BY page_block_id
    `).all() as readonly { readonly group_key: string }[];
    expect(new Set(positions.map((row) => row.group_key)))
      .toEqual(new Set(Object.values(WORKFLOW_STATUS_CUTOVER_MAP)));
    const viewConfig = JSON.parse((database.prepare(`
      SELECT config_json FROM database_views LIMIT 1
    `).get() as { readonly config_json: string }).config_json) as {
      readonly filter: { readonly value: string };
    };
    expect(viewConfig.filter.value).toBe("review");

    const evidence = database.prepare(`
      SELECT request_json, request_hash, result_json
      FROM block_mutations WHERE mutation_id = ?
    `).get(mutationId) as {
      readonly request_json: string;
      readonly request_hash: string;
      readonly result_json: string;
    };
    const rewrittenRequest = JSON.parse(evidence.request_json) as {
      readonly actor: { readonly status: string };
      readonly operation: { readonly status: string };
    };
    expect(rewrittenRequest.actor.status).toBe("done");
    expect(rewrittenRequest.operation.status).toBe("triage");
    expect(createHash("sha256").update(evidence.request_json).digest("hex"))
      .toBe(evidence.request_hash);
    expect((JSON.parse(evidence.result_json) as { readonly status: string }).status)
      .toBe("ship");
    expect(() => migrateWorkflowStatusesV81ToV82(database))
      .toThrow("requires schema v81, received v82");
  });

  test.each(WORKFLOW_STATUS_CUTOVER_FAULT_POINTS)(
    "rolls back completely at %s",
    (faultPoint) => {
      const { database, previousStoreEpoch } = createV81Fixture();

      expect(() => migrateWorkflowStatusesV81ToV82(database, {
        nextStoreEpoch: "status-cutover-epoch",
        injectFault: (point) => {
          if (point === faultPoint) throw new Error(`fault:${point}`);
        },
      })).toThrow(`fault:${faultPoint}`);

      expect(database.pragma("user_version", { simple: true })).toBe(81);
      expect((database.prepare(`
        SELECT store_epoch FROM block_store_metadata WHERE id = 1
      `).get() as { readonly store_epoch: string }).store_epoch)
        .toBe(previousStoreEpoch);
      const statusConfig = database.prepare(`
        SELECT config_json FROM data_source_properties
        WHERE id = 'status' LIMIT 1
      `).get() as { readonly config_json: string };
      expect((JSON.parse(statusConfig.config_json) as {
        options: readonly { readonly id: string }[];
      }).options.map((option) => option.id)).toEqual([
        "draft",
        "backlog",
        "in_progress",
        "in_review",
        "done",
      ]);
    },
  );
});
