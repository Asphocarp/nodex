import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type Database from "better-sqlite3";
import { afterEach, describe, expect, test } from "vitest";
import {
  makeBlockPropertyFieldPath,
  parseBlockPropertyMutationRequest,
  stableStringifyBlockPropertyJson,
} from "../../shared/block-property-mutations";
import {
  parseBlockPropertyMutationRequestV2,
  parseBlockPropertyMutationResultV2,
} from "../../shared/block-property-mutations-v2";
import { parseDatabaseViewConfigV2 } from "../../shared/database-kernel";
import { PAGE_HISTORY_CONTRACT_VERSION } from "../../shared/page-history";
import { createUuidV7 } from "../../shared/uuid-v7";
import { resetAssetPathCacheForTests } from "./assets";
import { closeDatabase, getDb } from "./database";
import { listPageHistory } from "./page-history";
import { createHistoricalReleaseSchemaFixture } from "./schema";
import {
  migrateDatabaseIdentityAuthorityV80ToV81,
  type DatabaseIdentityCutoverFaultPoint,
} from "./database-identity-cutover-sqlite";

const tempDirectories: string[] = [];
const OLD_TAG_OPTION_A = "legacy-option-release";
const OLD_TAG_OPTION_B = "legacy-option-i18n";
const TAG_NAME_A = "release train";
const TAG_NAME_B = "国际化";

const useTempStore = (): void => {
  closeDatabase();
  resetAssetPathCacheForTests();
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "nodex-database-identity-cutover-"),
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

interface FixtureCoordinates {
  readonly projectId: string;
  readonly databaseId: string;
  readonly dataSourceId: string;
  readonly viewId: string;
  readonly pageId: string;
  readonly membershipId: string;
  readonly oldTagsPropertyId: string;
  readonly oldCustomPropertyId: string;
  readonly propertyMutationId: string;
  readonly databaseOperationMutationId: string;
  readonly databaseModuleChangeSeq: number;
  readonly previousEpoch: string;
}

const insertCommittedPropertyEvidence = (input: {
  readonly projectId: string;
  readonly databaseId: string;
  readonly pageId: string;
  readonly propertyId: string;
  readonly storeEpoch: string;
}): { readonly mutationId: string; readonly changeLogSeq: number } => {
  const database = getDb();
  const mutationId = "property-cutover-evidence";
  const request = parseBlockPropertyMutationRequest({
    version: 1,
    mutationId,
    projectId: input.projectId,
    storeEpoch: input.storeEpoch,
    actor: { kind: "test" },
    fields: [
      {
        scope: "database",
        pageId: input.pageId,
        databaseBlockId: input.databaseId,
        propertyId: input.propertyId,
        operation: "add_remove",
        add: [OLD_TAG_OPTION_B],
        remove: [OLD_TAG_OPTION_A],
      },
    ],
  });
  const requestJson = stableStringifyBlockPropertyJson({
    ...request,
    fields: request.fields.map((field) => {
      if (field.scope !== "database") return field;
      const { pageId, ...rest } = field;
      return { ...rest, cardBlockId: pageId };
    }),
  });
  const requestHash = createHash("sha256").update(requestJson).digest("hex");
  const field = request.fields[0];
  if (!field) throw new Error("Missing Property evidence field");
  const fieldPath = makeBlockPropertyFieldPath(field);
  const fieldIntents = [
    {
      path: fieldPath,
      operation: "add_remove",
      scope: "database",
      add: [OLD_TAG_OPTION_B],
      remove: [OLD_TAG_OPTION_A],
    },
  ];
  const result = {
    version: 1,
    mutationId,
    projectId: input.projectId,
    storeEpoch: input.storeEpoch,
    duplicate: false,
    fields: [
      {
        path: fieldPath,
        scope: "database",
        blockId: input.pageId,
        databaseBlockId: input.databaseId,
        propertyId: input.propertyId,
        operation: "add_remove",
        revision: 3,
        value: [OLD_TAG_OPTION_B],
      },
    ],
    blockMetadataRevisions: { [input.pageId]: 4 },
    changeLogSeq: 0,
    committedAt: "2026-07-18T00:00:00.000Z",
  };
  const payload = {
    version: 1,
    requestHash,
    fieldPaths: [fieldPath],
    fieldChanges: [
      {
        path: fieldPath,
        scope: "database",
        operation: "add_remove",
        before: { exists: true, revision: 2, value: [OLD_TAG_OPTION_A] },
        after: { exists: true, revision: 3, value: [OLD_TAG_OPTION_B] },
      },
    ],
    committedRevisions: { [fieldPath]: 3 },
    blockMetadataRevisions: { [input.pageId]: 4 },
  };
  const inserted = database.prepare(`
    INSERT INTO change_log (
      project_id, store_epoch, kind, operation_id, block_ids_json,
      document_ids_json, database_block_ids_json, payload_json, committed_at
    ) VALUES (?, ?, 'block_mutation', ?, ?, '[]', ?, ?, ?)
  `).run(
    input.projectId,
    input.storeEpoch,
    mutationId,
    stableStringifyBlockPropertyJson([input.pageId]),
    stableStringifyBlockPropertyJson([input.databaseId]),
    stableStringifyBlockPropertyJson(payload),
    "2026-07-18T00:00:00.000Z",
  );
  const changeLogSeq = Number(inserted.lastInsertRowid);
  const committedResult = { ...result, changeLogSeq };
  database.prepare(`
    INSERT INTO block_mutations (
      mutation_id, project_id, store_epoch, mutation_kind, actor_json,
      client_session_id, request_hash, request_json, target_block_ids_json,
      affected_document_ids_json, affected_database_block_ids_json,
      field_intents_json, expected_revisions_json, outcome, result_json,
      committed_revisions_json, document_heads_json, change_log_seq, recorded_at
    ) VALUES (
      ?, ?, ?, 'property_batch', '{}', NULL, ?, ?, ?, '[]', ?, ?, '{}',
      'committed', ?, ?, '{}', ?, ?
    )
  `).run(
    mutationId,
    input.projectId,
    input.storeEpoch,
    requestHash,
    requestJson,
    stableStringifyBlockPropertyJson([input.pageId]),
    stableStringifyBlockPropertyJson([input.databaseId]),
    stableStringifyBlockPropertyJson(fieldIntents),
    stableStringifyBlockPropertyJson(committedResult),
    stableStringifyBlockPropertyJson({ [fieldPath]: 3 }),
    changeLogSeq,
    "2026-07-18T00:00:00.000Z",
  );
  return { mutationId, changeLogSeq };
};

const insertCommittedDatabaseOperationEvidence = (input: {
  readonly projectId: string;
  readonly databaseId: string;
  readonly pageId: string;
  readonly membershipId: string;
  readonly statusPropertyId: string;
  readonly tagsPropertyId: string;
  readonly storeEpoch: string;
}): { readonly mutationId: string; readonly changeLogSeq: number } => {
  const database = getDb();
  const mutationId = "database-operation-cutover-evidence";
  const operationKinds = ["transfer_membership", "set_values"] as const;
  const requestJson = stableStringifyBlockPropertyJson({
    version: 1,
    operationId: mutationId,
    projectId: input.projectId,
    storeEpoch: input.storeEpoch,
    operations: [
      {
        kind: "transfer_membership",
        cardBlockId: input.pageId,
        expectedMembership: null,
        target: {
          databaseBlockId: input.databaseId,
          membershipId: input.membershipId,
        },
      },
      {
        kind: "set_values",
        databaseBlockId: input.databaseId,
        entries: [
          {
            cardBlockId: input.pageId,
            propertyId: input.statusPropertyId,
            expectedValueRevision: 1,
            value: "draft",
          },
          {
            cardBlockId: input.pageId,
            propertyId: input.tagsPropertyId,
            expectedValueRevision: 2,
            value: [OLD_TAG_OPTION_A, OLD_TAG_OPTION_B],
          },
        ],
      },
    ],
  });
  const requestHash = createHash("sha256").update(requestJson).digest("hex");
  const propertyPath = (propertyId: string): string =>
    `database/${encodeURIComponent(input.databaseId)}/card/${encodeURIComponent(input.pageId)}/property/${encodeURIComponent(propertyId)}`;
  const fieldIntents = [
    {
      operation: "transfer_membership",
      path: `card/${encodeURIComponent(input.pageId)}/membership`,
    },
    {
      operation: "set_values",
      path: propertyPath(input.statusPropertyId),
    },
    {
      operation: "set_values",
      path: propertyPath(input.tagsPropertyId),
    },
  ];
  const expectedRevisions = {
    "operations[0].membership": 0,
    "operations[1].values[0]": 1,
    "operations[1].values[1]": 2,
  };
  const payload = {
    operationResults: [
      {
        index: 0,
        kind: "transfer_membership",
        payload: {
          cardBlockId: input.pageId,
          cardMetadataRevision: 3,
          databaseBlockId: input.databaseId,
          membershipId: input.membershipId,
          membershipRevision: 3,
          positionRankKey: null,
          positionRevision: null,
          previousMembershipId: null,
          previousMembershipRevision: null,
          rebalancedPositions: 0,
          viewId: null,
        },
      },
      {
        index: 1,
        kind: "set_values",
        payload: {
          databaseBlockId: input.databaseId,
          values: [
            {
              index: 0,
              payload: {
                cardBlockId: input.pageId,
                cardMetadataRevision: 4,
                databaseBlockId: input.databaseId,
                groupedPositionRevisions: {},
                membershipId: input.membershipId,
                propertyId: input.statusPropertyId,
                value: "draft",
                valueRevision: 2,
              },
            },
            {
              index: 1,
              payload: {
                cardBlockId: input.pageId,
                cardMetadataRevision: 5,
                databaseBlockId: input.databaseId,
                groupedPositionRevisions: {},
                membershipId: input.membershipId,
                propertyId: input.tagsPropertyId,
                value: [OLD_TAG_OPTION_A, OLD_TAG_OPTION_B],
                valueRevision: 3,
              },
            },
          ],
        },
      },
    ],
  };
  const committedRevisions = {
    "operations[0].cardMetadata": 3,
    "operations[0].membership": 1,
    "operations[1].values[0].cardMetadata": 4,
    "operations[1].values[0].value": 2,
    "operations[1].values[1].cardMetadata": 5,
    "operations[1].values[1].value": 3,
  };
  const changePayload = stableStringifyBlockPropertyJson({
    version: 1,
    mutationKind: "database_operation",
    requestHash,
    operationKinds,
    payload,
    committedRevisions,
  });
  const inserted = database.prepare(`
    INSERT INTO change_log (
      project_id, store_epoch, kind, operation_id, block_ids_json,
      document_ids_json, database_block_ids_json, payload_json, committed_at
    ) VALUES (?, ?, 'block_mutation', ?, ?, '[]', ?, ?, ?)
  `).run(
    input.projectId,
    input.storeEpoch,
    mutationId,
    stableStringifyBlockPropertyJson([input.pageId]),
    stableStringifyBlockPropertyJson([input.databaseId]),
    changePayload,
    "2026-07-18T00:00:00.000Z",
  );
  const changeLogSeq = Number(inserted.lastInsertRowid);
  const resultJson = stableStringifyBlockPropertyJson({
    version: 1,
    operationId: mutationId,
    projectId: input.projectId,
    storeEpoch: input.storeEpoch,
    operationKinds,
    affectedDatabaseBlockIds: [input.databaseId],
    duplicate: false,
    payload,
    changeLogSeq,
    committedAt: "2026-07-18T00:00:00.000Z",
  });
  database.prepare(`
    INSERT INTO block_mutations (
      mutation_id, project_id, store_epoch, mutation_kind, actor_json,
      client_session_id, request_hash, request_json, target_block_ids_json,
      affected_document_ids_json, affected_database_block_ids_json,
      field_intents_json, expected_revisions_json, outcome, result_json,
      committed_revisions_json, document_heads_json, change_log_seq, recorded_at
    ) VALUES (
      ?, ?, ?, 'database_operation', '{"kind":"test"}', NULL, ?, ?, ?, '[]',
      ?, ?, ?, 'committed', ?, ?, '{}', ?, ?
    )
  `).run(
    mutationId,
    input.projectId,
    input.storeEpoch,
    requestHash,
    requestJson,
    stableStringifyBlockPropertyJson([input.pageId]),
    stableStringifyBlockPropertyJson([input.databaseId]),
    stableStringifyBlockPropertyJson(fieldIntents),
    stableStringifyBlockPropertyJson(expectedRevisions),
    resultJson,
    stableStringifyBlockPropertyJson(committedRevisions),
    changeLogSeq,
    "2026-07-18T00:00:00.000Z",
  );
  return { mutationId, changeLogSeq };
};

const insertHistoricalV80Page = (
  database: Database.Database,
  input: {
    readonly projectId: string;
    readonly databaseId: string;
    readonly viewId: string;
    readonly title: string;
  },
): { readonly pageId: string; readonly membershipId: string } => {
  const pageId = createUuidV7();
  const documentId = `document:${pageId}`;
  const membershipId = createUuidV7();
  const now = "2026-07-18T00:00:00.000Z";
  const richTitleJson = stableStringifyBlockPropertyJson([
    { type: "text", text: input.title, styles: {} },
  ]);
  const databaseValues = {
    status: "draft",
    priority: null,
    estimate: null,
    tags: [],
    due_date: null,
    scheduled_start: null,
    scheduled_end: null,
    assignee: null,
  } as const;
  const intrinsicValues = {
    "run.target": "localProject",
    "run.localPath": null,
    "run.baseBranch": null,
    "run.worktreePath": null,
    "run.environmentPath": null,
    "schedule.isAllDay": false,
    "schedule.timezone": null,
    "recurrence.config": null,
    "reminders.config": [],
  } as const;

  database.transaction(() => {
    database.prepare(`
      INSERT INTO blocks (
        id, project_id, type, lifecycle, location_kind,
        containing_document_id, containing_database_id,
        location_revision, metadata_revision, created_at, updated_at
      ) VALUES (?, ?, 'page', 'active', 'database', NULL, ?, 1, 1, ?, ?)
    `).run(pageId, input.projectId, input.databaseId, now, now);
    database.prepare(`
      INSERT INTO documents (
        id, project_id, generation, head_seq, schema_key, schema_version,
        state_vector, state_hash, readiness, authority,
        genesis_source_revision, created_at, updated_at
      ) VALUES (?, ?, 1, 0, 'nodex.page', 2, X'', ?, 'ready',
        'ydoc_primary', 1, ?, ?)
    `).run(documentId, input.projectId, "0".repeat(64), now, now);
    database.prepare(`
      INSERT INTO block_documents (block_id, document_id, project_id, created_at)
      VALUES (?, ?, ?, ?)
    `).run(pageId, documentId, input.projectId, now);
    database.prepare(`
      INSERT INTO document_materializations (
        document_id, generation, projected_seq, schema_version,
        title, title_rich_json, title_rich_hash, nfm, plain_text, preview,
        block_tree_json, references_json, asset_refs_json, updated_at
      ) VALUES (?, 1, 0, 2, ?, ?, ?, '', '', '', '[]', '[]', '[]', ?)
    `).run(
      documentId,
      input.title,
      richTitleJson,
      createHash("sha256").update(richTitleJson).digest("hex"),
      now,
    );
    database.prepare(`
      INSERT INTO database_memberships (
        id, database_block_id, page_block_id, project_id,
        revision, created_at, removed_at
      ) VALUES (?, ?, ?, ?, 1, ?, NULL)
    `).run(
      membershipId,
      input.databaseId,
      pageId,
      input.projectId,
      now,
    );
    const properties = database.prepare(`
      SELECT id, key, value_type AS valueType
      FROM database_properties
      WHERE database_block_id = ? AND project_id = ? AND lifecycle = 'active'
    `).all(input.databaseId, input.projectId) as readonly {
      readonly id: string;
      readonly key: keyof typeof databaseValues;
      readonly valueType: string;
    }[];
    const insertValue = database.prepare(`
      INSERT INTO database_property_values (
        membership_id, property_id, database_block_id, project_id,
        value_type, value_json, revision, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
    `);
    for (const property of properties) {
      insertValue.run(
        membershipId,
        property.id,
        input.databaseId,
        input.projectId,
        property.valueType,
        stableStringifyBlockPropertyJson(databaseValues[property.key]),
        now,
      );
    }
    const insertIntrinsic = database.prepare(`
      INSERT INTO block_properties (
        block_id, project_id, property_key, value_type, value_json,
        revision, updated_at
      ) VALUES (?, ?, ?, ?, ?, 1, ?)
    `);
    for (const [key, value] of Object.entries(intrinsicValues)) {
      const valueType = key === "schedule.isAllDay"
        ? "boolean"
        : key === "recurrence.config" || key === "reminders.config"
          ? "json"
          : "string";
      insertIntrinsic.run(
        pageId,
        input.projectId,
        key,
        valueType,
        stableStringifyBlockPropertyJson(value),
        now,
      );
    }
    database.prepare(`
      INSERT INTO database_view_positions (
        view_id, block_id, project_id, group_key, rank_key,
        revision, created_at, updated_at
      ) VALUES (?, ?, ?, 'draft', '80000000000000000000000000000000', 1, ?, ?)
    `).run(input.viewId, pageId, input.projectId, now, now);
    database.prepare(`
      INSERT INTO page_read_model (
        page_block_id, project_id, lifecycle, location_kind,
        containing_document_id, containing_database_id, top_level_rank_key,
        location_revision, metadata_revision, document_id,
        document_generation, document_projected_seq, document_schema_version,
        document_authority, membership_id, database_block_id,
        view_id, view_group_key, view_rank_key,
        title, description_preview, description_length, has_description,
        database_values_json, intrinsic_properties_json,
        property_revisions_json, projection_version, created_at, updated_at
      ) VALUES (
        ?, ?, 'active', 'database', NULL, ?, NULL,
        1, 1, ?, 1, 0, 2, 'ydoc_primary', ?, ?, ?, 'draft',
        '80000000000000000000000000000000', ?, '', 0, 0,
        ?, ?, ?, 1, ?, ?
      )
    `).run(
      pageId,
      input.projectId,
      input.databaseId,
      documentId,
      membershipId,
      input.databaseId,
      input.viewId,
      input.title,
      stableStringifyBlockPropertyJson(databaseValues),
      stableStringifyBlockPropertyJson(intrinsicValues),
      stableStringifyBlockPropertyJson({
        database: Object.fromEntries(
          Object.keys(databaseValues).map((key) => [key, 1]),
        ),
        intrinsic: Object.fromEntries(
          Object.keys(intrinsicValues).map((key) => [key, 1]),
        ),
      }),
      now,
      now,
    );
  })();

  return { pageId, membershipId };
};

const createV80Fixture = async (): Promise<FixtureCoordinates> => {
  useTempStore();
  const database = getDb();
  createHistoricalReleaseSchemaFixture(database, 80);
  const root = database.prepare(`
    SELECT
      project.id AS projectId,
      project.database_block_id AS databaseId,
      source.id AS dataSourceId,
      container.default_view_id AS viewId,
      metadata.store_epoch AS storeEpoch
    FROM projects project
    INNER JOIN database_containers container
      ON container.block_id = project.database_block_id
    INNER JOIN data_sources source
      ON source.home_database_block_id = container.block_id
    CROSS JOIN block_store_metadata metadata
    WHERE metadata.id = 1
    ORDER BY project.created, source.rank_key
    LIMIT 1
  `).get() as {
    readonly projectId: string;
    readonly databaseId: string;
    readonly dataSourceId: string;
    readonly viewId: string;
    readonly storeEpoch: string;
  };
  const historicalPage = insertHistoricalV80Page(database, {
    projectId: root.projectId,
    databaseId: root.databaseId,
    viewId: root.viewId,
    title: "Identity migration fixture",
  });
  const page = { id: historicalPage.pageId };
  const membership = { id: historicalPage.membershipId };
  const properties = database.prepare(`
    SELECT id, key FROM database_properties
    WHERE database_block_id = ? AND lifecycle = 'active'
  `).all(root.databaseId) as readonly {
    readonly id: string;
    readonly key: string;
  }[];
  const tags = properties.find((property) => property.key === "tags");
  const status = properties.find((property) => property.key === "status");
  if (!tags) throw new Error("Fixture has no tags Property");
  if (!status) throw new Error("Fixture has no status Property");

  const tagsConfig = stableStringifyBlockPropertyJson({
    options: [
      { id: OLD_TAG_OPTION_A, name: TAG_NAME_A, color: "blue" },
      { id: OLD_TAG_OPTION_B, name: TAG_NAME_B },
    ],
  });
  database.prepare(`
    UPDATE database_properties
    SET config_json = ?, schema_revision = schema_revision + 1,
      updated_at = ?
    WHERE id = ?
  `).run(tagsConfig, "2026-07-18T00:00:00.000Z", tags.id);
  database.prepare(`
    UPDATE database_property_values
    SET value_json = ?, revision = 2, updated_at = ?
    WHERE membership_id = ? AND property_id = ?
  `).run(
    stableStringifyBlockPropertyJson([OLD_TAG_OPTION_A, OLD_TAG_OPTION_B]),
    "2026-07-18T00:00:00.000Z",
    membership.id,
    tags.id,
  );

  const oldCustomPropertyId = `database:${root.databaseId}:property:team`;
  const customConfig = stableStringifyBlockPropertyJson({
    options: [{ id: "legacy-option-platform", name: "Platform" }],
  });
  database.prepare(`
    INSERT INTO database_properties (
      id, database_block_id, project_id, key, name, value_type, config_json,
      rank_key, lifecycle, schema_revision, created_at, updated_at
    ) VALUES (?, ?, ?, 'team', 'Team', 'select', ?, ?, 'active', 1, ?, ?)
  `).run(
    oldCustomPropertyId,
    root.databaseId,
    root.projectId,
    customConfig,
    "zzzzzzzz",
    "2026-07-18T00:00:00.000Z",
    "2026-07-18T00:00:00.000Z",
  );

  const oldViewConfig = {
    schemaKey: "nodex.database-view",
    schemaVersion: 1,
    filter: {
      kind: "group",
      operator: "and",
      children: [
        {
          kind: "clause",
          propertyId: tags.id,
          operator: "contains",
          value: OLD_TAG_OPTION_B,
        },
      ],
    },
    sort: [
      {
        field: { kind: "property", propertyId: tags.id },
        direction: "asc",
        nulls: "last",
      },
    ],
    group: { propertyId: tags.id },
    display: { propertyIds: properties.map((property) => property.id), showTitle: true },
  };
  database.prepare(`
    UPDATE database_views SET config_json = ?, updated_at = ? WHERE id = ?
  `).run(
    stableStringifyBlockPropertyJson(oldViewConfig),
    "2026-07-18T00:00:00.000Z",
    root.viewId,
  );
  const oldGroupKey = stableStringifyBlockPropertyJson([
    OLD_TAG_OPTION_A,
    OLD_TAG_OPTION_B,
  ]);
  database.prepare(`
    UPDATE database_view_positions
    SET group_key = ?, updated_at = ?
    WHERE view_id = ? AND block_id = ?
  `).run(
    oldGroupKey,
    "2026-07-18T00:00:00.000Z",
    root.viewId,
    page.id,
  );
  const pageValues = database.prepare(`
    SELECT database_values_json FROM page_read_model WHERE page_block_id = ?
  `).get(page.id) as { readonly database_values_json: string };
  database.prepare(`
    UPDATE page_read_model
    SET database_values_json = ?, view_group_key = ?
    WHERE page_block_id = ?
  `).run(
    stableStringifyBlockPropertyJson({
      ...(JSON.parse(pageValues.database_values_json) as object),
      tags: [OLD_TAG_OPTION_A, OLD_TAG_OPTION_B],
    }),
    oldGroupKey,
    page.id,
  );

  const propertyEvidence = insertCommittedPropertyEvidence({
    projectId: root.projectId,
    databaseId: root.databaseId,
    pageId: page.id,
    propertyId: tags.id,
    storeEpoch: root.storeEpoch,
  });
  const databaseOperationEvidence = insertCommittedDatabaseOperationEvidence({
    projectId: root.projectId,
    databaseId: root.databaseId,
    pageId: page.id,
    membershipId: membership.id,
    statusPropertyId: status.id,
    tagsPropertyId: tags.id,
    storeEpoch: root.storeEpoch,
  });
  database.prepare(`
    INSERT INTO nodex_agent_call_receipts (
      call_identity, thread_id, turn_id, call_id, project_id, tool,
      request_hash, mutation_id, authority_fingerprint, provenance_version,
      allocations_json, result_metadata_json, status, created_at, updated_at
    ) VALUES (?, 'identity-cutover-thread', NULL, 'identity-cutover-call', ?,
      'create', ?, 'identity-cutover-agent-mutation', NULL, NULL, '[]', ?,
      'committed', ?, ?)
  `).run(
    "c".repeat(64),
    root.projectId,
    "d".repeat(64),
    stableStringifyBlockPropertyJson({
      output: {
        schemaVersion: 1,
        data: {
          database: {
            valueRevisions: {
              [status.id]: "opaque-pre-cutover-revision",
            },
          },
        },
      },
    }),
    "2026-07-18T00:00:00.000Z",
    "2026-07-18T00:00:00.000Z",
  );
  const moduleOperationId = "database-module-v1-receipt";
  const modulePayload = stableStringifyBlockPropertyJson({
    version: 1,
    mutationKind: "database_module_apply",
    operationKinds: ["set_value"],
    requestHash: "a".repeat(64),
    affectedDataSourceIds: [root.dataSourceId],
    committedRevisions: {
      [`property:${tags.id}`]: 2,
      [`value:${membership.id}:${tags.id}`]: 2,
    },
  });
  const moduleChange = database.prepare(`
    INSERT INTO change_log (
      project_id, store_epoch, kind, operation_id, block_ids_json,
      document_ids_json, database_block_ids_json, payload_json, committed_at
    ) VALUES (?, ?, 'block_mutation', ?, ?, '[]', ?, ?, ?)
  `).run(
    root.projectId,
    root.storeEpoch,
    moduleOperationId,
    stableStringifyBlockPropertyJson([page.id]),
    stableStringifyBlockPropertyJson([root.databaseId]),
    modulePayload,
    "2026-07-18T00:00:00.000Z",
  );
  const moduleChangeSeq = Number(moduleChange.lastInsertRowid);
  database.prepare(`
    INSERT INTO database_module_receipts (
      operation_id, project_id, library_id, store_epoch, request_hash,
      request_json, outcome, result_json, change_log_seq, created_at
    )
    SELECT ?, project.id, project.library_id, ?, ?, ?, 'committed', ?, ?, ?
    FROM projects project WHERE project.id = ?
  `).run(
    moduleOperationId,
    root.storeEpoch,
    "a".repeat(64),
    stableStringifyBlockPropertyJson({
      version: 1,
      operationId: moduleOperationId,
      projectId: root.projectId,
      storeEpoch: root.storeEpoch,
      actor: {},
      operations: [],
    }),
    stableStringifyBlockPropertyJson({ ok: true }),
    moduleChangeSeq,
    "2026-07-18T00:00:00.000Z",
    root.projectId,
  );

  expect(database.pragma("foreign_key_check")).toEqual([]);
  return {
    projectId: root.projectId,
    databaseId: root.databaseId,
    dataSourceId: root.dataSourceId,
    viewId: root.viewId,
    pageId: page.id,
    membershipId: membership.id,
    oldTagsPropertyId: tags.id,
    oldCustomPropertyId,
    propertyMutationId: propertyEvidence.mutationId,
    databaseOperationMutationId: databaseOperationEvidence.mutationId,
    databaseModuleChangeSeq: moduleChangeSeq,
    previousEpoch: root.storeEpoch,
  };
};

const schemaObjectExists = (
  type: "table" | "trigger",
  name: string,
): boolean =>
  getDb()
    .prepare("SELECT 1 FROM sqlite_schema WHERE type = ? AND name = ?")
    .get(type, name) !== undefined;

describe("dormant v80 to v81 Database identity transaction", () => {
  test("rebuilds scoped authority, evidence, projections, and physical dependencies", async () => {
    const fixture = await createV80Fixture();
    const database = getDb();
    const report = migrateDatabaseIdentityAuthorityV80ToV81(database, {
      nextStoreEpoch: "epoch-v81",
      now: "2026-07-18T01:00:00.000Z",
    });

    expect(report).toMatchObject({
      sourceVersion: 80,
      targetVersion: 81,
      previousStoreEpoch: fixture.previousEpoch,
      nextStoreEpoch: "epoch-v81",
      clearedDatabaseModuleReceipts: 1,
      clearedAgentCallReceipts: 1,
    });
    expect(database.pragma("user_version", { simple: true })).toBe(81);
    expect(database.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(database.pragma("foreign_key_check")).toEqual([]);

    for (const table of [
      "database_capabilities",
      "database_properties",
      "database_memberships",
      "database_property_values",
      "database_view_positions",
    ]) {
      expect(schemaObjectExists("table", table)).toBe(false);
    }
    const propertyColumns = database.pragma(
      "table_info(data_source_properties)",
    ) as readonly { readonly name: string; readonly pk: number }[];
    expect(propertyColumns.some((column) => column.name === "key")).toBe(false);
    expect(
      propertyColumns
        .filter((column) => column.pk > 0)
        .sort((left, right) => left.pk - right.pk)
        .map((column) => column.name),
    ).toEqual(["data_source_id", "id"]);

    const properties = database.prepare(`
      SELECT id, name, config_json FROM data_source_properties
      WHERE data_source_id = ? ORDER BY id
    `).all(fixture.dataSourceId) as readonly {
      readonly id: string;
      readonly name: string;
      readonly config_json: string;
    }[];
    const tags = properties.find((property) => property.id === "tags");
    const custom = properties.find((property) => property.name === "Team");
    expect(tags).toBeDefined();
    expect(custom?.id).toMatch(/^p_[A-Za-z0-9_-]{8}$/u);
    expect(properties.some((property) => property.id === fixture.oldCustomPropertyId))
      .toBe(false);
    const tagOptions = (JSON.parse(tags?.config_json ?? "{}") as {
      readonly options: readonly { readonly id: string; readonly name: string }[];
    }).options;
    expect(tagOptions.map((option) => option.name)).toEqual([
      TAG_NAME_A,
      TAG_NAME_B,
    ]);
    expect(tagOptions.every((option) => /^o_[A-Za-z0-9_-]{8}$/u.test(option.id)))
      .toBe(true);
    const newTagIds = tagOptions
      .map((option) => option.id)
      .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));

    const rawValue = database.prepare(`
      SELECT value_json FROM data_source_property_values
      WHERE data_source_id = ? AND membership_id = ? AND property_id = 'tags'
    `).get(fixture.dataSourceId, fixture.membershipId) as {
      readonly value_json: string;
    };
    expect(JSON.parse(rawValue.value_json)).toEqual(newTagIds);

    const view = database.prepare(`
      SELECT config_json FROM database_views WHERE id = ?
    `).get(fixture.viewId) as { readonly config_json: string };
    const viewConfig = parseDatabaseViewConfigV2(JSON.parse(view.config_json));
    expect(viewConfig.group?.propertyId).toBe("tags");
    expect(viewConfig.display.propertyIds).toContain("tags");
    expect(JSON.stringify(viewConfig)).not.toContain(fixture.oldTagsPropertyId);
    const position = database.prepare(`
      SELECT group_key FROM database_view_page_positions
      WHERE view_id = ? AND page_block_id = ?
    `).get(fixture.viewId, fixture.pageId) as {
      readonly group_key: string;
    };
    expect(JSON.parse(position.group_key)).toEqual(newTagIds);

    const projection = database.prepare(`
      SELECT database_values_json, view_group_key
      FROM page_read_model WHERE page_block_id = ?
    `).get(fixture.pageId) as {
      readonly database_values_json: string;
      readonly view_group_key: string;
    };
    expect(
      (JSON.parse(projection.database_values_json) as { readonly tags: string[] })
        .tags,
    ).toEqual([TAG_NAME_A, TAG_NAME_B]);
    expect(JSON.parse(projection.view_group_key)).toEqual(newTagIds);

    const evidence = database.prepare(`
      SELECT request_json, request_hash, result_json
      FROM block_mutations WHERE mutation_id = ?
    `).get(fixture.propertyMutationId) as {
      readonly request_json: string;
      readonly request_hash: string;
      readonly result_json: string;
    };
    expect(createHash("sha256").update(evidence.request_json).digest("hex"))
      .toBe(evidence.request_hash);
    expect(parseBlockPropertyMutationRequestV2(JSON.parse(evidence.request_json)))
      .toMatchObject({ fields: [{ dataSourceId: fixture.dataSourceId, propertyId: "tags" }] });
    expect(parseBlockPropertyMutationResultV2(JSON.parse(evidence.result_json)))
      .toMatchObject({ fields: [{ dataSourceId: fixture.dataSourceId, propertyId: "tags" }] });
    const databaseOperationEvidence = database.prepare(`
      SELECT mutation.request_json, mutation.request_hash,
        mutation.field_intents_json, mutation.result_json,
        change.payload_json AS change_payload_json
      FROM block_mutations mutation
      INNER JOIN change_log change ON change.seq = mutation.change_log_seq
      WHERE mutation.mutation_id = ?
    `).get(fixture.databaseOperationMutationId) as {
      readonly request_json: string;
      readonly request_hash: string;
      readonly field_intents_json: string;
      readonly result_json: string;
      readonly change_payload_json: string;
    };
    expect(
      createHash("sha256")
        .update(databaseOperationEvidence.request_json)
        .digest("hex"),
    ).toBe(databaseOperationEvidence.request_hash);
    const rewrittenDatabaseEvidence = [
      databaseOperationEvidence.request_json,
      databaseOperationEvidence.field_intents_json,
      databaseOperationEvidence.result_json,
      databaseOperationEvidence.change_payload_json,
    ].join("\n");
    expect(rewrittenDatabaseEvidence).toContain('"propertyId":"status"');
    expect(rewrittenDatabaseEvidence).toContain('"propertyId":"tags"');
    expect(rewrittenDatabaseEvidence).not.toContain(fixture.oldTagsPropertyId);
    expect(rewrittenDatabaseEvidence).not.toContain(OLD_TAG_OPTION_A);
    expect(rewrittenDatabaseEvidence).not.toContain(OLD_TAG_OPTION_B);
    expect(
      (JSON.parse(databaseOperationEvidence.change_payload_json) as {
        readonly requestHash: string;
      }).requestHash,
    ).toBe(databaseOperationEvidence.request_hash);
    const pageHistory = listPageHistory(database, {
      version: PAGE_HISTORY_CONTRACT_VERSION,
      requestingProjectId: fixture.projectId,
      pageId: fixture.pageId,
      pageSize: 100,
    });
    const migratedPropertyEntry = pageHistory.entries.find(
      (entry) =>
        entry.kind === "block_mutation" &&
        entry.mutationId === fixture.propertyMutationId,
    );
    expect(migratedPropertyEntry?.evidence).toEqual({ status: "verified" });
    const migratedDatabaseOperationEntry = pageHistory.entries.find(
      (entry) =>
        entry.kind === "block_mutation" &&
        entry.mutationId === fixture.databaseOperationMutationId,
    );
    expect(migratedDatabaseOperationEntry?.evidence).toEqual({
      status: "verified",
    });

    const moduleChange = database.prepare(`
      SELECT payload_json FROM change_log WHERE seq = ?
    `).get(fixture.databaseModuleChangeSeq) as { readonly payload_json: string };
    const modulePayload = JSON.parse(moduleChange.payload_json) as {
      readonly version: number;
      readonly committedRevisions: Readonly<Record<string, number>>;
    };
    expect(modulePayload.version).toBe(2);
    expect(Object.keys(modulePayload.committedRevisions)).toEqual([
      "property:tags",
      `value:${fixture.membershipId}:tags`,
    ]);
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM database_module_receipts").get(),
    ).toEqual({ count: 0 });
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM nodex_agent_call_receipts").get(),
    ).toEqual({ count: 0 });
    expect(
      database.prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1").get(),
    ).toEqual({ store_epoch: "epoch-v81" });

    expect(() =>
      database.prepare(`
        UPDATE block_mutations SET recorded_at = recorded_at
        WHERE mutation_id = ?
      `).run(fixture.propertyMutationId),
    ).toThrow("block mutations are immutable");
    expect(() =>
      database.prepare(`
        UPDATE change_log SET committed_at = committed_at WHERE seq = ?
      `).run(fixture.databaseModuleChangeSeq),
    ).toThrow("change log entries are immutable");
    expect(
      schemaObjectExists(
        "trigger",
        "nodex_agent_committed_call_receipts_cannot_delete",
      ),
    ).toBe(true);
    expect(schemaObjectExists("trigger", "page_read_model_validate_insert"))
      .toBe(true);
    expect(() =>
      database.prepare(`
        UPDATE database_containers SET default_view_id = 'missing-view'
        WHERE block_id = ?
      `).run(fixture.databaseId),
    ).toThrow("default View must be active and owned");
    expect(() =>
      database.prepare("UPDATE blocks SET type = 'text' WHERE id = ?")
        .run(fixture.databaseId),
    ).toThrow("Database Block type cannot change");
    expect(() =>
      database.prepare(`
        UPDATE blocks
        SET location_kind = 'space', containing_database_id = NULL
        WHERE id = ?
      `).run(fixture.pageId),
    ).toThrow("Page location cannot diverge");
    expect(() =>
      database.prepare(`
        UPDATE data_source_property_values SET value_type = 'text'
        WHERE data_source_id = ? AND membership_id = ? AND property_id = 'tags'
      `).run(fixture.dataSourceId, fixture.membershipId),
    ).toThrow("must match an active Property type");
  });

  test("rolls schema, data, receipts, epoch, and immutable guards back on a fault", async () => {
    const fixture = await createV80Fixture();
    const database = getDb();
    const faultPoint: DatabaseIdentityCutoverFaultPoint =
      "before_publish";

    expect(() =>
      migrateDatabaseIdentityAuthorityV80ToV81(database, {
        nextStoreEpoch: "epoch-that-must-roll-back",
        injectFault: (point) => {
          if (point === faultPoint) throw new Error("injected cutover fault");
        },
      }),
    ).toThrow("injected cutover fault");

    expect(database.pragma("user_version", { simple: true })).toBe(80);
    expect(database.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(database.pragma("legacy_alter_table", { simple: true })).toBe(0);
    expect(database.pragma("foreign_key_check")).toEqual([]);
    expect(schemaObjectExists("table", "database_capabilities")).toBe(true);
    expect(schemaObjectExists("table", "database_properties")).toBe(true);
    expect(schemaObjectExists("trigger", "block_mutations_are_immutable"))
      .toBe(true);
    expect(schemaObjectExists("trigger", "change_log_is_immutable")).toBe(true);
    expect(
      schemaObjectExists(
        "trigger",
        "nodex_agent_committed_call_receipts_cannot_delete",
      ),
    ).toBe(true);
    expect(
      database.prepare(`
        SELECT id FROM data_source_properties WHERE id = ?
      `).get(fixture.oldTagsPropertyId),
    ).toEqual({ id: fixture.oldTagsPropertyId });
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM database_module_receipts").get(),
    ).toEqual({ count: 1 });
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM nodex_agent_call_receipts").get(),
    ).toEqual({ count: 1 });
    expect(
      database.prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1").get(),
    ).toEqual({ store_epoch: fixture.previousEpoch });
    expect(schemaObjectExists("table", "data_source_properties_v81")).toBe(false);
    expect(schemaObjectExists("table", "blocks_v81")).toBe(false);
  });

  test("requires an exact v80 source schema", async () => {
    await createV80Fixture();
    const database = getDb();
    database.pragma("user_version = 79");
    expect(() => migrateDatabaseIdentityAuthorityV80ToV81(database)).toThrow(
      "requires schema v80, received v79",
    );
    expect(schemaObjectExists("table", "database_capabilities")).toBe(true);
  });
});
