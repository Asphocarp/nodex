import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  parseDataSourceOptionId,
  type DataSourceOptionId,
} from "../../shared/database-identities";
import {
  parsePageLifecycleMutationRequestV2,
  type PageLifecycleMutationRequestV2,
} from "../../shared/page-lifecycle-v2";
import { parsePageLifecyclePreflightResultV2 } from "../../shared/page-lifecycle-v2-transport";
import {
  compilePageLifecycleCreateRequestV2,
  compilePageLifecycleRequestV2,
  type PageLifecycleCreateDisplayIntent,
  type PageLifecycleCreateMutationRequestV2,
} from "../../shared/page-lifecycle-v2-runtime";
import { PAGE_HISTORY_CONTRACT_VERSION } from "../../shared/page-history";
import { createUuidV7 } from "../../shared/uuid-v7";
import { resetAssetPathCacheForTests } from "./assets";
import { closeDatabase, getDb, initializeDatabase } from "./database";
import { listPageHistory } from "./page-history";
import {
  applyPageLifecycleMutationV2,
  readPageLifecyclePreflightSnapshotV2,
} from "./page-lifecycle-v2-store";

const EXISTING_OPTION_ID = "o_AAAAAAAA";
const NEW_OPTION_ID_ONE = "o_BBBBBBBB";
const NEW_OPTION_ID_TWO = "o_CCCCCCCC";
const COLLISION_OPTION_ID = "o_DDDDDDDD";
const TARGET_DATA_SOURCE_ID = "source-page-lifecycle-v2";
const TARGET_VIEW_ID = "view-page-lifecycle-v2";
const NOW = "2026-07-18T04:00:00.000Z";

const tempDirectories: string[] = [];

interface Fixture {
  readonly projectId: string;
  readonly databaseId: string;
  readonly dataSourceId: string;
  readonly viewId: string;
  readonly storeEpoch: string;
  readonly tagsRevision: number;
}

const optionId = (value: string): DataSourceOptionId =>
  parseDataSourceOptionId({ propertyId: "tags", value });

const useTempStore = (): void => {
  closeDatabase();
  resetAssetPathCacheForTests();
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "nodex-page-lifecycle-v2-store-"),
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

const createFixture = async (): Promise<Fixture> => {
  useTempStore();
  await initializeDatabase();
  const database = getDb();
  const schemaVersion = Number(database.pragma("user_version", { simple: true }));
  if (schemaVersion !== 83) {
    throw new Error(`Page Lifecycle v2 fixture requires schema v83, got v${schemaVersion}`);
  }
  const root = database.prepare(`
    SELECT
      project.id AS project_id,
      source.home_database_block_id AS database_id,
      source.id AS initial_data_source_id,
      container.default_view_id AS initial_view_id,
      metadata.store_epoch
    FROM projects project
    INNER JOIN project_database_bindings binding
      ON binding.project_id = project.id AND binding.lifecycle = 'active'
    INNER JOIN database_containers container
      ON container.block_id = binding.database_block_id
    INNER JOIN data_sources source
      ON source.home_database_block_id = container.block_id
     AND source.lifecycle = 'active'
    CROSS JOIN block_store_metadata metadata
    WHERE metadata.id = 1
    ORDER BY project.created, source.rank_key
    LIMIT 1
  `).get() as {
    readonly project_id: string;
    readonly database_id: string;
    readonly initial_data_source_id: string;
    readonly initial_view_id: string;
    readonly store_epoch: string;
  };
  database.prepare(`
    INSERT INTO data_sources (
      id, library_id, home_database_block_id, name, schema_key,
      schema_revision, lifecycle, rank_key, created_at, updated_at
    )
    SELECT ?, library_id, home_database_block_id, 'Secondary Source', schema_key,
      schema_revision, 'active', 'zzzzzzzz', ?, ?
    FROM data_sources WHERE id = ?
  `).run(
    TARGET_DATA_SOURCE_ID,
    NOW,
    NOW,
    root.initial_data_source_id,
  );
  database.prepare(`
    INSERT INTO data_source_properties (
      data_source_id, id, name, value_type, config_json, rank_key,
      lifecycle, schema_revision, created_at, updated_at
    )
    SELECT ?, id, name, value_type, config_json, rank_key,
      lifecycle, schema_revision, ?, ?
    FROM data_source_properties WHERE data_source_id = ?
  `).run(
    TARGET_DATA_SOURCE_ID,
    NOW,
    NOW,
    root.initial_data_source_id,
  );
  database.prepare(`
    INSERT INTO database_views (
      id, database_block_id, data_source_id, name, kind, config_json,
      revision, rank_key, lifecycle, created_at, updated_at
    )
    SELECT ?, database_block_id, ?, 'Secondary View', kind, config_json,
      revision, 'zzzzzzzz', 'active', ?, ?
    FROM database_views WHERE id = ?
  `).run(
    TARGET_VIEW_ID,
    TARGET_DATA_SOURCE_ID,
    NOW,
    NOW,
    root.initial_view_id,
  );
  const tags = database.prepare(`
    SELECT schema_revision FROM data_source_properties
    WHERE data_source_id = ? AND id = 'tags' AND lifecycle = 'active'
  `).get(TARGET_DATA_SOURCE_ID) as { readonly schema_revision: number };
  database.prepare(`
    UPDATE data_source_properties
    SET config_json = ?, schema_revision = schema_revision + 1, updated_at = ?
    WHERE data_source_id = ? AND id = 'tags'
  `).run(
    JSON.stringify({
      options: [{ id: EXISTING_OPTION_ID, name: "既有 标签", color: "blue" }],
    }),
    NOW,
    TARGET_DATA_SOURCE_ID,
  );
  return {
    projectId: root.project_id,
    databaseId: root.database_id,
    dataSourceId: TARGET_DATA_SOURCE_ID,
    viewId: TARGET_VIEW_ID,
    storeEpoch: root.store_epoch,
    tagsRevision: tags.schema_revision + 1,
  };
};

const createIntent = (input: {
  readonly fixture: Fixture;
  readonly operationId: string;
  readonly pageId?: string;
  readonly tags: readonly string[];
}): PageLifecycleCreateDisplayIntent => ({
  operationId: input.operationId,
  projectId: input.fixture.projectId,
  storeEpoch: input.fixture.storeEpoch,
  clientSessionId: "test-session",
  actor: { kind: "test" },
  operation: {
    kind: "create_page",
    pageId: input.pageId ?? createUuidV7(),
    title: "Source-owned Page",
    nfm: "A durable body",
    status: "triage",
    priority: "p1-high",
    estimate: "m",
    tags: input.tags,
    dueDate: "2026-07-31",
    scheduledStart: "2026-07-31T01:00:00.000Z",
    scheduledEnd: "2026-07-31T02:00:00.000Z",
    isAllDay: false,
    recurrence: null,
    reminders: [],
    scheduleTimezone: "Asia/Shanghai",
    assignee: null,
    runInTarget: "localProject",
    runInLocalPath: null,
    runInBaseBranch: null,
    runInWorktreePath: null,
    runInEnvironmentPath: null,
  },
});

const compileCreate = (input: {
  readonly fixture: Fixture;
  readonly operationId: string;
  readonly pageId?: string;
  readonly tags: readonly string[];
  readonly allocations?: readonly DataSourceOptionId[];
}): PageLifecycleCreateMutationRequestV2 => {
  const allocations = [...(input.allocations ?? [])];
  return compilePageLifecycleCreateRequestV2({
    request: createIntent(input),
    tagsProperty: {
      propertyId: "tags",
      dataSourceId: input.fixture.dataSourceId,
      valueType: "multi_select",
      lifecycle: "active",
      revision: input.fixture.tagsRevision,
      config: {
        options: [
          { id: EXISTING_OPTION_ID, name: "既有 标签", color: "blue" },
        ],
      },
    },
    allocateOptionId: () => {
      const allocation = allocations.shift();
      if (allocation) return allocation;
      throw new Error("Test option allocator was exhausted");
    },
  });
};

const lifecycleRequest = (
  fixture: Fixture,
  operationId: string,
  operation: Readonly<Record<string, unknown>>,
): PageLifecycleMutationRequestV2 =>
  parsePageLifecycleMutationRequestV2({
    version: 2,
    operationId,
    projectId: fixture.projectId,
    storeEpoch: fixture.storeEpoch,
    actor: { kind: "test" },
    operation,
  });

const createStoredPage = (
  fixture: Fixture,
  operationId: string,
  membershipId: string,
): { readonly pageId: string; readonly membershipId: string } => {
  const request = compileCreate({
    fixture,
    operationId,
    tags: ["既有 标签"],
  });
  const result = applyPageLifecycleMutationV2(getDb(), request, {
    now: () => NOW,
    allocateMembershipId: () => membershipId,
  });
  if (!result.ok) throw new Error(result.error.message);
  return { pageId: result.value.pageId, membershipId };
};

describe("Page Lifecycle v2 authority", () => {
  test("compiles display-name tags from one canonical v81 preflight snapshot", async () => {
    const fixture = await createFixture();
    const pageId = createUuidV7();
    const preflight = readPageLifecyclePreflightSnapshotV2(
      getDb(),
      fixture.projectId,
      pageId,
    );
    expect(preflight.ok).toBe(true);
    if (!preflight.ok) throw new Error(preflight.error.message);
    expect(parsePageLifecyclePreflightResultV2(preflight)).toEqual(preflight);
    expect(preflight.value).toMatchObject({
      version: 2,
      projectId: fixture.projectId,
      value: {
        version: 2,
        page: null,
        reservedBlockType: null,
        tagsProperty: {
          propertyId: "tags",
          valueType: "multi_select",
          lifecycle: "active",
        },
      },
    });
    expect(preflight.value.value.tagsProperty.dataSourceId).toBe(
      preflight.value.value.defaultView.dataSource.dataSourceId,
    );

    const request = compilePageLifecycleRequestV2({
      intent: {
        kind: "create",
        projectId: fixture.projectId,
        operationId: "page-lifecycle-v2-preflight-create",
        pageId,
        status: "triage",
        input: { title: "Preflight Page", tags: [" 预检 标签 "] },
      },
      preflight: preflight.value,
    });
    expect(request.operation.kind).toBe("create_page");
    if (request.operation.kind !== "create_page") return;
    expect(request.operation.dataSourceId).toBe(
      preflight.value.value.defaultView.dataSource.dataSourceId,
    );
    expect(request.operation.tagOptionIds).toHaveLength(1);
    expect(request.operation.tagOptionIds[0]).toMatch(/^o_[A-Za-z0-9_-]{8}$/u);
    expect(request.operation.newTagOptions).toEqual([
      { optionId: request.operation.tagOptionIds[0], name: "预检 标签" },
    ]);

    const created = applyPageLifecycleMutationV2(getDb(), request, {
      now: () => NOW,
      allocateMembershipId: () => "membership-page-lifecycle-v2-preflight",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error.message);
    const active = readPageLifecyclePreflightSnapshotV2(
      getDb(),
      fixture.projectId,
      pageId,
    );
    expect(active).toMatchObject({
      ok: true,
      value: {
        value: {
          page: {
            pageId,
            lifecycle: "active",
            parent: {
              kind: "data_source",
              dataSourceId: request.operation.dataSourceId,
            },
            membership: {
              membershipId: "membership-page-lifecycle-v2-preflight",
              dataSourceId: request.operation.dataSourceId,
              statusPropertyId: "status",
              status: "triage",
            },
          },
        },
      },
    });

    const deletion = lifecycleRequest(
      fixture,
      "page-lifecycle-v2-preflight-delete",
      {
        kind: "delete_page",
        pageId,
        expectedMetadataRevision: created.value.metadataRevision,
        expectedParentRevision: created.value.parentRevision,
      },
    );
    const deleted = applyPageLifecycleMutationV2(getDb(), deletion, {
      now: () => NOW,
    });
    expect(deleted.ok).toBe(true);
    const tombstone = readPageLifecyclePreflightSnapshotV2(
      getDb(),
      fixture.projectId,
      pageId,
    );
    if (!tombstone.ok) throw new Error(tombstone.error.message);
    expect(tombstone).toMatchObject({
      ok: true,
      value: {
        value: {
          page: {
            lifecycle: "deleted",
            membership: null,
            restoreEvidence: {
              deleteOperationId: deletion.operationId,
              previousLifecycle: "active",
              membership: {
                membershipId: "membership-page-lifecycle-v2-preflight",
                dataSourceId: request.operation.dataSourceId,
                status: "triage",
              },
            },
          },
        },
      },
    });
  });

  test("creates Source-owned Pages with raw option IDs and compatibility tag names", async () => {
    const fixture = await createFixture();
    const request = compileCreate({
      fixture,
      operationId: "page-lifecycle-v2-create",
      tags: ["既有 标签", " 发布 空间 ", " Cafe\u0301 "],
      allocations: [optionId(NEW_OPTION_ID_ONE), optionId(NEW_OPTION_ID_TWO)],
    });
    const database = getDb();
    const result = applyPageLifecycleMutationV2(database, request, {
      now: () => NOW,
      allocateMembershipId: () => "membership-page-lifecycle-v2",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toMatchObject({
      version: 2,
      duplicate: false,
      dataSourceId: fixture.dataSourceId,
      databaseId: fixture.databaseId,
      viewId: fixture.viewId,
      membershipId: "membership-page-lifecycle-v2",
      createdTagOptionIds: request.operation.newTagOptions.map(
        (option) => option.optionId,
      ),
    });

    expect(database.prepare(`
      SELECT parent_kind, parent_id FROM pages WHERE block_id = ?
    `).get(request.operation.pageId)).toEqual({
      parent_kind: "data_source",
      parent_id: fixture.dataSourceId,
    });
    expect(database.prepare(`
      SELECT data_source_id, page_block_id
      FROM data_source_page_memberships WHERE id = ?
    `).get("membership-page-lifecycle-v2")).toEqual({
      data_source_id: fixture.dataSourceId,
      page_block_id: request.operation.pageId,
    });

    const rawTags = database.prepare(`
      SELECT value_json FROM data_source_property_values
      WHERE data_source_id = ? AND membership_id = ? AND property_id = 'tags'
    `).get(
      fixture.dataSourceId,
      "membership-page-lifecycle-v2",
    ) as { readonly value_json: string };
    expect(JSON.parse(rawTags.value_json)).toEqual(
      request.operation.tagOptionIds,
    );

    const config = database.prepare(`
      SELECT config_json, schema_revision FROM data_source_properties
      WHERE data_source_id = ? AND id = 'tags'
    `).get(fixture.dataSourceId) as {
      readonly config_json: string;
      readonly schema_revision: number;
    };
    const options = (JSON.parse(config.config_json) as {
      readonly options: readonly { readonly id: string; readonly name: string }[];
    }).options;
    expect(config.schema_revision).toBe(fixture.tagsRevision + 1);
    expect(options.find((option) => option.id === EXISTING_OPTION_ID)?.name)
      .toBe("既有 标签");
    expect(options.map((option) => option.name)).toEqual(
      expect.arrayContaining(["Café", "发布 空间", "既有 标签"]),
    );

    const namesById = new Map(
      options.map((option) => [option.id, option.name] as const),
    );
    const projection = database.prepare(`
      SELECT database_values_json FROM page_read_model WHERE page_block_id = ?
    `).get(request.operation.pageId) as {
      readonly database_values_json: string;
    };
    expect(
      (JSON.parse(projection.database_values_json) as {
        readonly tags: readonly string[];
      }).tags,
    ).toEqual(
      request.operation.tagOptionIds.map((id) => namesById.get(id)),
    );
    expect(database.prepare(`
      SELECT scheduled_start, scheduled_end, schedule_timezone
      FROM scheduled_page_index WHERE page_block_id = ?
    `).get(request.operation.pageId)).toEqual({
      scheduled_start: "2026-07-31T01:00:00.000Z",
      scheduled_end: "2026-07-31T02:00:00.000Z",
      schedule_timezone: "Asia/Shanghai",
    });

    const history = listPageHistory(database, {
      version: PAGE_HISTORY_CONTRACT_VERSION,
      requestingProjectId: fixture.projectId,
      pageId: request.operation.pageId,
      pageSize: 20,
    });
    expect(history.entries.find(
      (entry) =>
        entry.kind === "block_mutation" &&
        entry.mutationId === request.operationId,
    )?.evidence).toEqual({ status: "verified" });

    const replay = applyPageLifecycleMutationV2(database, {
      ...request,
      actor: { kind: "retry", attempt: 2 },
      clientSessionId: "retry-session",
    });
    expect(replay).toMatchObject({
      ok: true,
      value: {
        operationId: request.operationId,
        duplicate: true,
        changeLogSeq: result.value.changeLogSeq,
      },
    });
    expect(database.prepare(`
      SELECT COUNT(*) AS count FROM change_log WHERE operation_id = ?
    `).get(request.operationId)).toEqual({ count: 1 });
  });

  test("rejects a stale tags Property revision without creating Page authority", async () => {
    const fixture = await createFixture();
    const compiled = compileCreate({
      fixture,
      operationId: "page-lifecycle-v2-stale-tags",
      tags: ["新 标签"],
      allocations: [optionId(NEW_OPTION_ID_ONE)],
    });
    const request = parsePageLifecycleMutationRequestV2({
      ...compiled,
      operation: {
        ...compiled.operation,
        expectedTagsPropertyRevision: fixture.tagsRevision - 1,
      },
    });
    const database = getDb();
    const result = applyPageLifecycleMutationV2(database, request, {
      now: () => NOW,
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "tags_property_revision_conflict",
        expectedRevision: fixture.tagsRevision - 1,
        actualRevision: fixture.tagsRevision,
      },
    });
    expect(database.prepare("SELECT 1 FROM blocks WHERE id = ?").get(
      request.operation.pageId,
    )).toBeUndefined();
    expect(database.prepare(`
      SELECT outcome FROM block_mutations WHERE mutation_id = ?
    `).get(request.operationId)).toEqual({ outcome: "rejected" });
  });

  test("keeps tag options unchanged when the preallocated Page identity collides", async () => {
    const fixture = await createFixture();
    const pageId = createUuidV7();
    const database = getDb();
    database.prepare(`
      INSERT INTO blocks (
        id, project_id, type, lifecycle, location_kind,
        containing_document_id, containing_database_id,
        location_revision, metadata_revision, created_at, updated_at
      ) VALUES (?, ?, 'text', 'active', 'space', NULL, NULL, 1, 1, ?, ?)
    `).run(pageId, fixture.projectId, NOW, NOW);
    const before = database.prepare(`
      SELECT config_json, schema_revision FROM data_source_properties
      WHERE data_source_id = ? AND id = 'tags'
    `).get(fixture.dataSourceId);
    const request = compileCreate({
      fixture,
      operationId: "page-lifecycle-v2-page-collision",
      pageId,
      tags: ["碰撞后不能出现"],
      allocations: [optionId(COLLISION_OPTION_ID)],
    });

    const result = applyPageLifecycleMutationV2(database, request, {
      now: () => NOW,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "page_identity_collision", pageId },
    });
    expect(database.prepare(`
      SELECT config_json, schema_revision FROM data_source_properties
      WHERE data_source_id = ? AND id = 'tags'
    `).get(fixture.dataSourceId)).toEqual(before);
    expect(database.prepare(`
      SELECT 1 FROM data_source_page_memberships WHERE page_block_id = ?
    `).get(pageId)).toBeUndefined();
  });

  test("archives and unarchives with metadata CAS, projections, evidence, and exact retry", async () => {
    const fixture = await createFixture();
    const page = createStoredPage(
      fixture,
      "page-lifecycle-v2-transition-create",
      "membership-page-lifecycle-v2-transition",
    );
    const archive = lifecycleRequest(
      fixture,
      "page-lifecycle-v2-archive",
      {
        kind: "archive_page",
        pageId: page.pageId,
        expectedMetadataRevision: 1,
      },
    );
    const archived = applyPageLifecycleMutationV2(getDb(), archive, {
      now: () => NOW,
    });
    expect(archived).toMatchObject({
      ok: true,
      value: {
        lifecycle: "archived",
        metadataRevision: 2,
        parentRevision: 1,
        duplicate: false,
      },
    });
    expect(getDb().prepare(`
      SELECT
        block.lifecycle AS block_lifecycle,
        page.lifecycle AS page_lifecycle,
        projection.lifecycle AS projection_lifecycle,
        schedule.lifecycle AS schedule_lifecycle,
        block.metadata_revision,
        projection.metadata_revision AS projection_revision,
        schedule.source_metadata_revision AS schedule_revision
      FROM blocks block
      INNER JOIN pages page ON page.block_id = block.id
      INNER JOIN page_read_model projection ON projection.page_block_id = block.id
      INNER JOIN scheduled_page_index schedule ON schedule.page_block_id = block.id
      WHERE block.id = ?
    `).get(page.pageId)).toEqual({
      block_lifecycle: "archived",
      page_lifecycle: "archived",
      projection_lifecycle: "archived",
      schedule_lifecycle: "archived",
      metadata_revision: 2,
      projection_revision: 2,
      schedule_revision: 2,
    });
    const archiveReplay = applyPageLifecycleMutationV2(getDb(), {
      ...archive,
      actor: { kind: "retry" },
    });
    expect(archiveReplay).toMatchObject({
      ok: true,
      value: { duplicate: true, metadataRevision: 2 },
    });

    const stale = lifecycleRequest(fixture, "page-lifecycle-v2-stale-unarchive", {
      kind: "unarchive_page",
      pageId: page.pageId,
      expectedMetadataRevision: 1,
    });
    expect(applyPageLifecycleMutationV2(getDb(), stale)).toMatchObject({
      ok: false,
      error: {
        code: "metadata_revision_conflict",
        expectedRevision: 1,
        actualRevision: 2,
      },
    });
    const unarchive = lifecycleRequest(fixture, "page-lifecycle-v2-unarchive", {
      kind: "unarchive_page",
      pageId: page.pageId,
      expectedMetadataRevision: 2,
    });
    expect(applyPageLifecycleMutationV2(getDb(), unarchive, {
      now: () => NOW,
    })).toMatchObject({
      ok: true,
      value: { lifecycle: "active", metadataRevision: 3 },
    });
    const history = listPageHistory(getDb(), {
      version: PAGE_HISTORY_CONTRACT_VERSION,
      requestingProjectId: fixture.projectId,
      pageId: page.pageId,
      pageSize: 20,
    });
    expect(history.entries.find(
      (entry) =>
        entry.kind === "block_mutation" &&
        entry.mutationId === archive.operationId,
    )?.evidence).toEqual({ status: "verified" });
  });

  test("deletes and restores exact Source membership while preserving raw values", async () => {
    const fixture = await createFixture();
    const page = createStoredPage(
      fixture,
      "page-lifecycle-v2-delete-create",
      "membership-page-lifecycle-v2-delete",
    );
    const database = getDb();
    const beforeTags = database.prepare(`
      SELECT value_json FROM data_source_property_values
      WHERE data_source_id = ? AND membership_id = ? AND property_id = 'tags'
    `).get(fixture.dataSourceId, page.membershipId) as {
      readonly value_json: string;
    };
    const deletion = lifecycleRequest(fixture, "page-lifecycle-v2-delete", {
      kind: "delete_page",
      pageId: page.pageId,
      expectedMetadataRevision: 1,
      expectedParentRevision: 1,
    });
    const deleted = applyPageLifecycleMutationV2(database, deletion, {
      now: () => NOW,
    });
    expect(deleted).toMatchObject({
      ok: true,
      value: {
        lifecycle: "deleted",
        metadataRevision: 2,
        parentRevision: 2,
        dataSourceId: fixture.dataSourceId,
        membershipId: page.membershipId,
      },
    });
    expect(database.prepare(`
      SELECT revision, removed_at FROM data_source_page_memberships WHERE id = ?
    `).get(page.membershipId)).toEqual({ revision: 2, removed_at: NOW });
    expect(database.prepare(`
      SELECT lifecycle, membership_id, database_values_json
      FROM page_read_model WHERE page_block_id = ?
    `).get(page.pageId)).toEqual({
      lifecycle: "deleted",
      membership_id: null,
      database_values_json: "{}",
    });
    expect(database.prepare(`
      SELECT value_json FROM data_source_property_values
      WHERE data_source_id = ? AND membership_id = ? AND property_id = 'tags'
    `).get(fixture.dataSourceId, page.membershipId)).toEqual(beforeTags);

    const restore = lifecycleRequest(fixture, "page-lifecycle-v2-restore", {
      kind: "restore_page",
      pageId: page.pageId,
      deleteOperationId: deletion.operationId,
      expectedMetadataRevision: 2,
      expectedParentRevision: 2,
      membership: {
        membershipId: page.membershipId,
        databaseId: fixture.databaseId,
        dataSourceId: fixture.dataSourceId,
        status: "triage",
        position: { viewId: fixture.viewId },
      },
    });
    const restored = applyPageLifecycleMutationV2(database, restore, {
      now: () => NOW,
    });
    expect(restored).toMatchObject({
      ok: true,
      value: {
        lifecycle: "active",
        metadataRevision: 3,
        parentRevision: 3,
        dataSourceId: fixture.dataSourceId,
        membershipId: page.membershipId,
        viewId: fixture.viewId,
      },
    });
    expect(database.prepare(`
      SELECT revision, removed_at FROM data_source_page_memberships WHERE id = ?
    `).get(page.membershipId)).toEqual({ revision: 3, removed_at: null });
    const projection = database.prepare(`
      SELECT lifecycle, membership_id, database_values_json
      FROM page_read_model WHERE page_block_id = ?
    `).get(page.pageId) as {
      readonly lifecycle: string;
      readonly membership_id: string;
      readonly database_values_json: string;
    };
    expect(projection.lifecycle).toBe("active");
    expect(projection.membership_id).toBe(page.membershipId);
    expect(
      (JSON.parse(projection.database_values_json) as { readonly tags: string[] })
        .tags,
    ).toEqual(["既有 标签"]);
    const restoreReplay = applyPageLifecycleMutationV2(database, {
      ...restore,
      actor: { kind: "retry" },
    });
    expect(restoreReplay).toMatchObject({
      ok: true,
      value: { duplicate: true, metadataRevision: 3 },
    });
    const history = listPageHistory(database, {
      version: PAGE_HISTORY_CONTRACT_VERSION,
      requestingProjectId: fixture.projectId,
      pageId: page.pageId,
      pageSize: 20,
    });
    for (const operationId of [deletion.operationId, restore.operationId]) {
      expect(history.entries.find(
        (entry) =>
          entry.kind === "block_mutation" && entry.mutationId === operationId,
      )?.evidence).toEqual({ status: "verified" });
    }
  });

  test("rolls back a delete fault and reorders canonical Library placements", async () => {
    const fixture = await createFixture();
    const first = createStoredPage(
      fixture,
      "page-lifecycle-v2-library-first-create",
      "membership-page-lifecycle-v2-library-first",
    );
    const second = createStoredPage(
      fixture,
      "page-lifecycle-v2-library-second-create",
      "membership-page-lifecycle-v2-library-second",
    );
    const database = getDb();
    for (const [page, rankKey] of [
      [first, "00000010"],
      [second, "00000020"],
    ] as const) {
      database.prepare(
        "DELETE FROM database_view_page_positions WHERE page_block_id = ?",
      ).run(page.pageId);
      database.prepare(`
        UPDATE data_source_page_memberships SET removed_at = ?, revision = 2
        WHERE id = ?
      `).run(NOW, page.membershipId);
      database.prepare(`
        UPDATE pages SET parent_kind = 'library', parent_id = ?, updated_at = ?
        WHERE block_id = ?
      `).run(
        database.prepare("SELECT library_id FROM projects WHERE id = ?")
          .pluck().get(fixture.projectId),
        NOW,
        page.pageId,
      );
      database.prepare(`
        UPDATE blocks
        SET location_kind = 'space', containing_database_id = NULL,
          containing_document_id = NULL, updated_at = ?
        WHERE id = ?
      `).run(NOW, page.pageId);
      database.prepare(`
        INSERT INTO library_block_placements (
          block_id, library_id, rank_key, revision, created_at, updated_at
        ) SELECT ?, library_id, ?, 1, ?, ? FROM projects WHERE id = ?
      `).run(page.pageId, rankKey, NOW, NOW, fixture.projectId);
      database.prepare(`
        UPDATE page_read_model
        SET location_kind = 'space', containing_database_id = NULL,
          membership_id = NULL, database_block_id = NULL, view_id = NULL,
          view_group_key = NULL, view_rank_key = NULL, top_level_rank_key = ?,
          database_values_json = '{}', property_revisions_json = ?, updated_at = ?
        WHERE page_block_id = ?
      `).run(
        rankKey,
        JSON.stringify({ database: {}, intrinsic: {} }),
        NOW,
        page.pageId,
      );
    }
    database.prepare(`
      INSERT INTO project_resource_grants (
        id, project_id, library_id, root_kind, root_id, access,
        recursive, revision, lifecycle, created_at, updated_at
      )
      SELECT ?, id, library_id, 'page', ?, 'read_write',
        1, 1, 'active', ?, ?
      FROM projects WHERE id = ?
    `).run(
      "grant-page-lifecycle-v2-library-first",
      first.pageId,
      NOW,
      NOW,
      fixture.projectId,
    );

    const deletion = lifecycleRequest(fixture, "page-lifecycle-v2-delete-fault", {
      kind: "delete_page",
      pageId: first.pageId,
      expectedMetadataRevision: 1,
      expectedParentRevision: 1,
    });
    expect(() => applyPageLifecycleMutationV2(database, deletion, {
      now: () => NOW,
      faultInjector: (point) => {
        if (point === "after_authority") throw new Error("delete fault");
      },
    })).toThrow("delete fault");
    expect(database.prepare(`
      SELECT lifecycle, metadata_revision, location_revision
      FROM blocks WHERE id = ?
    `).get(first.pageId)).toEqual({
      lifecycle: "active",
      metadata_revision: 1,
      location_revision: 1,
    });
    expect(database.prepare(`
      SELECT 1 FROM library_block_placements WHERE block_id = ?
    `).get(first.pageId)).toBeDefined();

    const move = lifecycleRequest(fixture, "page-lifecycle-v2-move-library", {
      kind: "move_page_in_library",
      pageId: first.pageId,
      expectedParentRevision: 1,
      beforeBlockId: second.pageId,
    });
    const moved = applyPageLifecycleMutationV2(database, move, {
      now: () => NOW,
    });
    expect(moved).toMatchObject({
      ok: true,
      value: { parentRevision: 2, libraryRankKey: expect.any(String) },
    });
    if (!moved.ok) throw new Error(moved.error.message);
    expect(database.prepare(`
      SELECT rank_key FROM library_block_placements WHERE block_id = ?
    `).get(first.pageId)).toEqual({ rank_key: moved.value.libraryRankKey });
    expect(database.prepare(`
      SELECT top_level_rank_key, location_revision
      FROM page_read_model WHERE page_block_id = ?
    `).get(first.pageId)).toEqual({
      top_level_rank_key: moved.value.libraryRankKey,
      location_revision: 2,
    });
  });
});
