import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { closeDatabase, getDb, initializeDatabase } from "./database";
import { getDatabasePath } from "./config";
import { resetAssetPathCacheForTests } from "./assets";
import { LEGACY_BLOCK_FIRST_TABLES_IN_DROP_ORDER } from "./block-first-legacy-schema";
import { makeDefaultBrowserSidebarTabId } from "../../shared/browser-sidebar";
import {
  CURRENT_SCHEMA_VERSION,
  SHIPPED_SCHEMA_VERSION,
  createHistoricalReleaseSchemaFixture,
  getReleaseSchemaVersions,
  getSchemaMigrationTargets,
  migrateSchema58To59,
  migrateSchema59To60,
  migrateSchema60To61,
  migrateSchema61To62,
  migrateSchema62To63,
  migrateSchema63To64,
  migrateSchema64To65,
  migrateSchema65To66,
  migrateSchema66To67,
  migrateSchema69To70,
  migrateSchema70To71,
  migrateSchema72To73,
  migrateSchema73To74,
  migrateSchema74To75,
  migrateSchema75To76,
  migrateSchema76To77,
  migrateSchema77To78,
  migrateSchema78To79,
  migrateSchema79To80,
  migrateSchema82To83,
  ensureBlockFoundationForProject,
  primaryDatabaseBlockId,
} from "./schema";
import {
  createProjectSession,
  createProjectSessionTab,
} from "./project-sessions";
import { createProject } from "./projects";
import { createPage } from "./database-pages";
import { createDocumentVersionCheckpoint } from "./document-versions";
import {
  DOCUMENT_VERSION_CONTRACT_VERSION,
  canonicalStringifyCanvasScene,
  primaryCanvasDocumentId,
} from "../../shared/block-documents";
import { syncCanvasScene } from "./canvas-scene-store";
import { createUuidV7 } from "../../shared/uuid-v7";

const tempDirectories: string[] = [];

const useTempStore = (): string => {
  closeDatabase();
  resetAssetPathCacheForTests();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-schema-v68-"));
  tempDirectories.push(directory);
  process.env.NODEX_HOME = directory;
  return directory;
};

const tableNames = (database: Database.Database): ReadonlySet<string> =>
  new Set(
    (
      database
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name",
        )
        .all() as readonly { readonly name: string }[]
    ).map((row) => row.name),
  );

const hasColumn = (
  database: Database.Database,
  tableName: string,
  columnName: string,
): boolean => (
  database.pragma(`table_info(${tableName})`) as readonly { readonly name: string }[]
).some((column) => column.name === columnName);

const dropTriggersContainingPageLiteral = (
  database: Database.Database,
): void => {
  const triggers = database.prepare(`
    SELECT name FROM sqlite_schema
    WHERE type = 'trigger' AND instr(sql, '''page''') > 0
  `).all() as readonly { readonly name: string }[];
  for (const trigger of triggers) {
    const quotedName = `"${trigger.name.replaceAll('"', '""')}"`;
    database.exec(`DROP TRIGGER ${quotedName}`);
  }
};

const createHistoricalProject = (
  database: Database.Database,
  name: string,
): { readonly id: string; readonly libraryId: string; readonly databaseId: string } => {
  const library = database.prepare(
    "SELECT id FROM libraries ORDER BY created_at, id LIMIT 1",
  ).get() as { readonly id: string } | undefined;
  if (!library) throw new Error("Historical Project fixture requires a Library");
  const id = randomUUID();
  const databaseId = primaryDatabaseBlockId(id);
  const now = new Date().toISOString();
  database.prepare(`
    INSERT INTO projects (
      id, library_id, database_block_id, lifecycle, binding_revision,
      name, description, icon, created, updated
    ) VALUES (?, ?, ?, 'active', 1, ?, '', '', ?, ?)
  `).run(id, library.id, databaseId, name, now, now);
  database.prepare(
    'INSERT INTO project_order (project_id, "order", updated) VALUES (?, 0, ?)',
  ).run(id, now);
  ensureBlockFoundationForProject(database, id, now);
  return { id, libraryId: library.id, databaseId };
};

const createPreLibraryHistoricalProject = (
  database: Database.Database,
  name: string,
): { readonly id: string; readonly databaseId: string } => {
  const id = randomUUID();
  const databaseId = primaryDatabaseBlockId(id);
  const now = "2026-07-15T00:00:00.000Z";
  database.prepare(`
    INSERT INTO projects (id, name, description, icon, created, updated)
    VALUES (?, ?, '', '', ?, ?)
  `).run(id, name, now, now);
  database.prepare(
    'INSERT INTO project_order (project_id, "order", updated) VALUES (?, 0, ?)',
  ).run(id, now);
  ensureBlockFoundationForProject(database, id, now);
  return { id, databaseId };
};

const createHistoricalPage = (
  database: Database.Database,
  projectId: string,
  title: string,
): {
  readonly id: string;
  readonly documentId: string;
  readonly membershipId: string;
  readonly databaseId: string;
} => {
  const primary = database.prepare(`
    SELECT capability.block_id AS databaseId, view.id AS viewId
    FROM database_capabilities capability
    INNER JOIN database_views view
      ON view.database_block_id = capability.block_id
      AND view.project_id = capability.project_id
      AND view.is_primary = 1
      AND view.lifecycle = 'active'
    WHERE capability.project_id = ? AND capability.is_primary = 1
  `).get(projectId) as {
    readonly databaseId: string;
    readonly viewId: string;
  } | undefined;
  if (!primary) throw new Error("Historical Page fixture requires a primary Database");

  const pageId = createUuidV7();
  const documentId = `document:${pageId}`;
  const membershipId = randomUUID();
  const now = "2026-07-15T00:00:00.000Z";
  const richTitleJson = JSON.stringify(
    title.length === 0 ? [] : [{ type: "text", text: title, styles: {} }],
  );

  database.transaction(() => {
    database.prepare(`
      INSERT INTO blocks (
        id, project_id, type, lifecycle, location_kind,
        containing_document_id, containing_database_id,
        location_revision, metadata_revision, created_at, updated_at
      ) VALUES (?, ?, 'page', 'active', 'database', NULL, ?, 1, 1, ?, ?)
    `).run(pageId, projectId, primary.databaseId, now, now);
    database.prepare(`
      INSERT INTO documents (
        id, project_id, generation, head_seq, schema_key, schema_version,
        state_vector, state_hash, readiness, authority,
        genesis_source_revision, created_at, updated_at
      ) VALUES (?, ?, 1, 0, 'nodex.page', 1, X'', ?, 'ready',
        'ydoc_primary', 1, ?, ?)
    `).run(documentId, projectId, "0".repeat(64), now, now);
    database.prepare(`
      INSERT INTO block_documents (block_id, document_id, project_id, created_at)
      VALUES (?, ?, ?, ?)
    `).run(pageId, documentId, projectId, now);
    database.prepare(`
      INSERT INTO document_materializations (
        document_id, generation, projected_seq, schema_version,
      title, title_rich_json, title_rich_hash, nfm, plain_text, preview,
        block_tree_json, references_json, asset_refs_json, updated_at
      ) VALUES (?, 1, 0, 1, ?, ?, ?, '', '', '', '[]', '[]', '[]', ?)
    `).run(
      documentId,
      title,
      richTitleJson,
      createHash("sha256").update(richTitleJson).digest("hex"),
      now,
    );
    database.prepare(`
      INSERT INTO database_memberships (
        id, database_block_id, card_block_id, project_id,
        revision, created_at, removed_at
      ) VALUES (?, ?, ?, ?, 1, ?, NULL)
    `).run(membershipId, primary.databaseId, pageId, projectId, now);
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
    const insertDatabaseValue = database.prepare(`
      INSERT INTO database_property_values (
        membership_id, property_id, database_block_id, project_id,
        value_type, value_json, revision, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
    `);
    const historicalProperties = database.prepare(`
      SELECT id, key, value_type AS valueType
      FROM database_properties
      WHERE database_block_id = ? AND project_id = ? AND lifecycle = 'active'
    `).all(primary.databaseId, projectId) as readonly {
      readonly id: string;
      readonly key: keyof typeof databaseValues;
      readonly valueType: string;
    }[];
    for (const property of historicalProperties) {
      insertDatabaseValue.run(
        membershipId,
        property.id,
        primary.databaseId,
        projectId,
        property.valueType,
        JSON.stringify(databaseValues[property.key]),
        now,
      );
    }
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
    const insertIntrinsicValue = database.prepare(`
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
      insertIntrinsicValue.run(
        pageId,
        projectId,
        key,
        valueType,
        JSON.stringify(value),
        now,
      );
    }
    database.prepare(`
      INSERT INTO database_view_positions (
        view_id, block_id, project_id, group_key, rank_key,
        revision, created_at, updated_at
      ) VALUES (?, ?, ?, 'draft', '80000000000000000000000000000000', 1, ?, ?)
    `).run(primary.viewId, pageId, projectId, now, now);
    database.prepare(`
      INSERT INTO card_read_model (
        card_block_id, project_id, lifecycle, location_kind,
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
        1, 1, ?, 1, 0, 1, 'ydoc_primary', ?, ?, ?, 'draft',
        '80000000000000000000000000000000', ?, '', 0, 0,
        ?, ?, ?, 1, ?, ?
      )
    `).run(
      pageId,
      projectId,
      primary.databaseId,
      documentId,
      membershipId,
      primary.databaseId,
      primary.viewId,
      title,
      JSON.stringify(databaseValues),
      JSON.stringify(intrinsicValues),
      JSON.stringify({
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

  return {
    id: pageId,
    documentId,
    membershipId,
    databaseId: primary.databaseId,
  };
};

const seedHistoricalMutationEvidence = (
  database: Database.Database,
  projectId: string,
  page: ReturnType<typeof createHistoricalPage>,
): void => {
  const storeEpoch = database.prepare(
    "SELECT store_epoch FROM block_store_metadata WHERE id = 1",
  ).pluck().get() as string;
  const mutationId = `historical-page:${page.id}`;
  const now = "2026-07-15T00:00:01.000Z";
  const change = database.prepare(`
    INSERT INTO change_log (
      project_id, store_epoch, kind, operation_id,
      block_ids_json, document_ids_json, database_block_ids_json,
      payload_json, committed_at
    ) VALUES (?, ?, 'page_lifecycle', ?, ?, ?, ?, '{}', ?)
  `).run(
    projectId,
    storeEpoch,
    mutationId,
    JSON.stringify([page.id]),
    JSON.stringify([page.documentId]),
    JSON.stringify([page.databaseId]),
    now,
  );
  const requestJson = JSON.stringify({ kind: "create_page", pageId: page.id });
  database.prepare(`
    INSERT INTO block_mutations (
      mutation_id, project_id, store_epoch, mutation_kind, actor_json,
      client_session_id, request_hash, request_json,
      target_block_ids_json, affected_document_ids_json,
      affected_database_block_ids_json, field_intents_json,
      expected_revisions_json, outcome, result_json,
      committed_revisions_json, document_heads_json,
      change_log_seq, recorded_at
    ) VALUES (
      ?, ?, ?, 'page_lifecycle', '{}', NULL, ?, ?, ?, ?, ?, ?, '{}',
      'committed', '{}', '{}', '{}', ?, ?
    )
  `).run(
    mutationId,
    projectId,
    storeEpoch,
    createHash("sha256").update(requestJson).digest("hex"),
    requestJson,
    JSON.stringify([page.id]),
    JSON.stringify([page.documentId]),
    JSON.stringify([page.databaseId]),
    JSON.stringify([{ path: `blocks.${page.id}`, operation: "create" }]),
    Number(change.lastInsertRowid),
    now,
  );
};

afterEach(() => {
  closeDatabase();
  resetAssetPathCacheForTests();
  delete process.env.NODEX_HOME;
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const createSchema58MigrationFixture = (
  database: Database.Database,
  options: { readonly orphanedBrowserTab?: boolean } = {},
): void => {
  database.exec(`
    CREATE TABLE projects (id TEXT PRIMARY KEY);
    CREATE TABLE codex_threads (
      thread_id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
      parent_thread_id TEXT,
      thread_name TEXT,
      thread_source TEXT
    ) WITHOUT ROWID;
    CREATE TABLE project_sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT REFERENCES projects(id) ON DELETE CASCADE
    );
    CREATE TABLE project_session_tabs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES project_sessions(id) ON DELETE CASCADE,
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      panel_id TEXT NOT NULL DEFAULT 'right',
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      config_json TEXT NOT NULL,
      state_key INTEGER NOT NULL DEFAULT 0,
      state_json TEXT NOT NULL DEFAULT '{}',
      "order" INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (kind IN ('db_view', 'page_stage', 'terminal', 'browser', 'review', 'files')),
      CHECK (panel_id IN ('right', 'bottom'))
    );
    CREATE INDEX idx_project_session_tabs_session_order
      ON project_session_tabs(session_id, panel_id, "order", created_at);
    CREATE INDEX idx_project_session_tabs_project
      ON project_session_tabs(project_id);

    INSERT INTO projects (id) VALUES ('project-1');
    INSERT INTO codex_threads (thread_id, project_id, thread_name)
      VALUES ('thread-1', 'project-1', 'Thread');
    INSERT INTO project_sessions (id, project_id)
      VALUES ('session-1', 'project-1');
  `);
  database
    .prepare(
      `INSERT INTO project_session_tabs (
         id, session_id, project_id, panel_id, kind, title, config_json,
         state_key, state_json, "order", created_at, updated_at
       ) VALUES (?, ?, 'project-1', 'right', ?, ?, '{}', 0, '{}', ?, ?, ?)`,
    )
    .run(
      "browser-a",
      options.orphanedBrowserTab ? "missing-session" : "session-1",
      "browser",
      "Browser A",
      0,
      "2026-07-14T00:00:00.000Z",
      "2026-07-14T00:00:00.000Z",
    );
  if (!options.orphanedBrowserTab) {
    const insertTab = database.prepare(
      `INSERT INTO project_session_tabs (
         id, session_id, project_id, panel_id, kind, title, config_json,
         state_key, state_json, "order", created_at, updated_at
       ) VALUES (?, 'session-1', 'project-1', 'right', ?, ?, '{}', 0, '{}', ?, ?, ?)`,
    );
    insertTab.run(
      "browser-b",
      "browser",
      "Browser B",
      1,
      "2026-07-14T00:00:01.000Z",
      "2026-07-14T00:00:01.000Z",
    );
    insertTab.run(
      "files-a",
      "files",
      "Files",
      2,
      "2026-07-14T00:00:02.000Z",
      "2026-07-14T00:00:02.000Z",
    );
  }
  database.pragma(`user_version = ${SHIPPED_SCHEMA_VERSION}`);
};

describe("schema v83 release boundary", () => {
  test("derives supported versions and targets from one ordered release chain", () => {
    const releaseVersions = getReleaseSchemaVersions();
    expect(releaseVersions).toEqual([
      58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83,
    ]);
    for (const [index, version] of releaseVersions.entries()) {
      expect(getSchemaMigrationTargets(version)).toEqual(
        releaseVersions.slice(index + 1),
      );
    }
    expect(getSchemaMigrationTargets(26)).toEqual(releaseVersions);
    expect(getSchemaMigrationTargets(57)).toEqual(releaseVersions);
    expect(getSchemaMigrationTargets(0)).toBe(null);
    expect(getSchemaMigrationTargets(999)).toBe(null);
  });

  test("creates the current store without compatibility tables", async () => {
    useTempStore();
    await initializeDatabase();
    await initializeDatabase();

    const database = getDb();
    expect(
      database.pragma("user_version", { simple: true }) as number,
    ).toBe(CURRENT_SCHEMA_VERSION);
    const names = tableNames(database);
    for (const tableName of [
      "blocks",
      "documents",
      "block_documents",
      "document_updates",
      "canvas_scenes",
      "canvas_scene_elements",
      "canvas_scene_files",
      "canvas_scene_mutation_receipts",
      "database_containers",
      "data_sources",
      "data_source_properties",
      "data_source_page_memberships",
      "data_source_property_values",
      "database_views",
      "database_view_page_positions",
      "profiles",
      "libraries",
      "project_database_bindings",
      "project_resource_grants",
      "database_module_receipts",
      "pages",
      "library_block_placements",
      "page_read_model",
      "scheduled_page_index",
      "canvas_page_references",
      "document_versions",
      "document_revision_sessions",
      "retired_block_identities",
      "codex_unread_threads",
      "codex_project_thread_orders",
      "codex_sidebar_chat_order",
      "codex_thread_dynamic_tool_catalogs",
      "codex_project_permission_mode_selections",
      "nodex_agent_token_keys",
      "nodex_agent_call_receipts",
      "nodex_agent_turn_authorities",
      "library_content_relocations",
      "library_content_relocation_members",
    ]) {
      expect(names.has(tableName)).toBe(true);
    }
    for (const tableName of LEGACY_BLOCK_FIRST_TABLES_IN_DROP_ORDER) {
      expect(names.has(tableName)).toBe(false);
    }
    const tabColumns = database.pragma(
      "table_info(project_session_tabs)",
    ) as Array<{ name: string; notnull: number }>;
    expect(tabColumns.some((column) => column.name === "browser_tab_id")).toBe(
      true,
    );
    expect(
      tabColumns.find((column) => column.name === "project_id")?.notnull,
    ).toBe(0);
    expect(hasColumn(database, "codex_threads", "agent_path")).toBe(true);
    expect(database.pragma("foreign_key_check")).toEqual([]);
    expect(database.pragma("quick_check")).toEqual([{ quick_check: "ok" }]);
  });

  test("publishes the acyclic Page hierarchy guard at v79", async () => {
    useTempStore();
    await initializeDatabase();
    const project = createProject({ name: "Page hierarchy migration" });
    const parent = await createPage(project.id, "triage", { title: "Parent" });
    const child = await createPage(project.id, "triage", { title: "Child" });
    const database = getDb();
    const now = new Date().toISOString();

    database.exec(`
      DROP TRIGGER pages_validate_hierarchy_insert;
      DROP TRIGGER pages_validate_hierarchy_update;
    `);
    database.pragma("user_version = 78");
    database.prepare(`
      UPDATE data_source_page_memberships
      SET removed_at = ?, revision = revision + 1
      WHERE page_block_id = ? AND removed_at IS NULL
    `).run(now, child.id);
    database.prepare(`
      UPDATE pages
      SET parent_kind = 'page', parent_id = ?,
        parent_revision = parent_revision + 1, updated_at = ?
      WHERE block_id = ?
    `).run(parent.id, now, child.id);

    migrateSchema78To79(database);

    expect(database.pragma("user_version", { simple: true })).toBe(79);
    database.prepare(`
      UPDATE data_source_page_memberships
      SET removed_at = ?, revision = revision + 1
      WHERE page_block_id = ? AND removed_at IS NULL
    `).run(now, parent.id);
    expect(() =>
      database.prepare(`
        UPDATE pages
        SET parent_kind = 'page', parent_id = ?,
          parent_revision = parent_revision + 1, updated_at = ?
        WHERE block_id = ?
      `).run(child.id, now, parent.id),
    ).toThrow("Page parent hierarchy must be acyclic and rooted");
  });

  test("migrates v79 stores with exact-Turn authority provenance", async () => {
    useTempStore();
    await initializeDatabase();
    const project = createProject({ name: "Turn authority migration" });
    const database = getDb();
    database.exec(`
      DROP TABLE library_content_relocation_members;
      DROP TABLE library_content_relocations;
      DROP TABLE nodex_agent_turn_authorities;
      DROP TABLE nodex_agent_call_receipts;
      CREATE TABLE nodex_agent_call_receipts (
        call_identity TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        call_id TEXT NOT NULL,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        tool TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        mutation_id TEXT NOT NULL UNIQUE,
        allocations_json TEXT NOT NULL DEFAULT '[]',
        result_metadata_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'prepared',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (thread_id, call_id)
      ) WITHOUT ROWID;
    `);
    const legacyCreatedAt = new Date().toISOString();
    database.prepare(`
      INSERT INTO nodex_agent_call_receipts (
        call_identity, thread_id, call_id, project_id, tool,
        request_hash, mutation_id, allocations_json, result_metadata_json,
        status, created_at, updated_at
      ) VALUES (?, 'thread-legacy', 'call-legacy', ?, 'update_page', ?,
        'mutation-legacy', '[]', '{"output":{}}', 'committed', ?, ?)
    `).run(
      "1".repeat(64),
      project.id,
      "2".repeat(64),
      legacyCreatedAt,
      legacyCreatedAt,
    );
    database.pragma("user_version = 79");

    migrateSchema79To80(database);

    expect(database.pragma("user_version", { simple: true })).toBe(80);
    for (const column of ["turn_id", "authority_fingerprint", "provenance_version"]) {
      expect(hasColumn(database, "nodex_agent_call_receipts", column)).toBe(true);
    }
    const names = tableNames(database);
    expect(names.has("nodex_agent_turn_authorities")).toBe(true);
    expect(names.has("library_content_relocations")).toBe(true);
    expect(names.has("library_content_relocation_members")).toBe(true);
    expect(names.has("codex_project_permission_mode_selections")).toBe(true);
    expect(database.prepare(`
      SELECT turn_id AS turnId, authority_fingerprint AS fingerprint,
        provenance_version AS provenanceVersion, status
      FROM nodex_agent_call_receipts WHERE call_identity = ?
    `).get("1".repeat(64))).toEqual({
      turnId: null,
      fingerprint: null,
      provenanceVersion: null,
      status: "committed",
    });
    expect(() => database.prepare(`
      UPDATE nodex_agent_call_receipts SET result_metadata_json = '{}'
      WHERE call_identity = ?
    `).run("1".repeat(64))).toThrow("receipt identity is immutable");
    expect(() => database.prepare(`
      DELETE FROM nodex_agent_call_receipts WHERE call_identity = ?
    `).run("1".repeat(64))).toThrow("Committed Nodex Agent call receipts are immutable");
    expect(() => database.prepare(`
      INSERT INTO nodex_agent_call_receipts (
        call_identity, thread_id, turn_id, call_id, project_id, tool,
        request_hash, mutation_id, authority_fingerprint, provenance_version,
        allocations_json, result_metadata_json, status, created_at, updated_at
      ) VALUES (?, 'thread-partial', 'turn-partial', 'call-partial', ?,
        'update_page', ?, 'mutation-partial', NULL, 1, '[]', '{}',
        'prepared', ?, ?)
    `).run(
      "3".repeat(64),
      project.id,
      "4".repeat(64),
      legacyCreatedAt,
      legacyCreatedAt,
    )).toThrow("CHECK constraint failed");
    const coordinate = database.prepare(`
      SELECT project.library_id AS libraryId, library.profile_id AS profileId,
        metadata.store_epoch AS storeEpoch
      FROM projects project
      INNER JOIN libraries library ON library.id = project.library_id
      CROSS JOIN block_store_metadata metadata
      WHERE project.id = ?
    `).get(project.id) as {
      readonly libraryId: string;
      readonly profileId: string;
      readonly storeEpoch: string;
    };
    database.prepare(`
      INSERT INTO nodex_agent_turn_authorities (
        thread_id, turn_id, root_thread_id, actor_project_id, library_id,
        profile_id, store_epoch, scope, source, permission_profile_id,
        authority_fingerprint, provenance_version, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'library', 'builtin_full_access',
        ':danger-full-access', ?, 1, ?)
    `).run(
      "thread-migration",
      "turn-migration",
      "thread-migration",
      project.id,
      coordinate.libraryId,
      coordinate.profileId,
      coordinate.storeEpoch,
      "a".repeat(64),
      new Date().toISOString(),
    );
    expect(() => database.exec(`
      UPDATE nodex_agent_turn_authorities SET scope = 'project'
    `)).toThrow("Turn authorities are immutable");
    expect(database.pragma("foreign_key_check")).toEqual([]);
    expect(database.pragma("integrity_check")).toEqual([{ integrity_check: "ok" }]);
  });

  test("refuses to guess a repair for a corrupt v78 Page hierarchy", async () => {
    useTempStore();
    await initializeDatabase();
    const project = createProject({ name: "Corrupt Page hierarchy" });
    const first = await createPage(project.id, "triage", { title: "First" });
    const second = await createPage(project.id, "triage", { title: "Second" });
    const database = getDb();
    const now = new Date().toISOString();

    database.exec(`
      DROP TRIGGER pages_validate_hierarchy_insert;
      DROP TRIGGER pages_validate_hierarchy_update;
    `);
    database.pragma("user_version = 78");
    database.prepare(`
      UPDATE data_source_page_memberships
      SET removed_at = ?, revision = revision + 1
      WHERE page_block_id IN (?, ?) AND removed_at IS NULL
    `).run(now, first.id, second.id);
    const setParent = database.prepare(`
      UPDATE pages
      SET parent_kind = 'page', parent_id = ?,
        parent_revision = parent_revision + 1, updated_at = ?
      WHERE block_id = ?
    `);
    setParent.run(first.id, now, second.id);
    setParent.run(second.id, now, first.id);

    expect(() => migrateSchema78To79(database)).toThrow(
      /Schema v79 cannot publish Page .*ownership contains a cycle/u,
    );
    expect(database.pragma("user_version", { simple: true })).toBe(78);
  });

  test("creates one Profile Library and independently identified Database authority", async () => {
    useTempStore();
    await initializeDatabase();
    const database = getDb();

    const profileLibraries = database.prepare(`
      SELECT profile.id AS profileId, library.id AS libraryId
      FROM profiles profile
      INNER JOIN libraries library ON library.profile_id = profile.id
    `).all() as Array<{ readonly profileId: string; readonly libraryId: string }>;
    expect(profileLibraries).toHaveLength(1);

    const rows = database.prepare(`
      SELECT
        project.id AS projectId,
        project.library_id AS libraryId,
        project.database_block_id AS databaseId,
        project.lifecycle AS projectLifecycle,
        binding.database_block_id AS boundDatabaseId,
        container.default_view_id AS defaultViewId,
        source.id AS dataSourceId,
        view.data_source_id AS viewDataSourceId
      FROM projects project
      INNER JOIN project_database_bindings binding
        ON binding.project_id = project.id
      INNER JOIN database_containers container
        ON container.block_id = binding.database_block_id
      INNER JOIN data_sources source
        ON source.home_database_block_id = container.block_id
      INNER JOIN database_views view
        ON view.id = container.default_view_id
      ORDER BY project.id ASC
    `).all() as Array<{
      readonly projectId: string;
      readonly libraryId: string;
      readonly databaseId: string;
      readonly projectLifecycle: string;
      readonly boundDatabaseId: string;
      readonly defaultViewId: string;
      readonly dataSourceId: string;
      readonly viewDataSourceId: string;
    }>;
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row).toBeDefined();
    expect(row?.libraryId).toBe(profileLibraries[0]?.libraryId);
    expect(row?.projectLifecycle).toBe("active");
    expect(row?.boundDatabaseId).toBe(row?.databaseId);
    expect(row?.dataSourceId).not.toBe(row?.databaseId);
    expect(row?.dataSourceId).not.toContain(row?.databaseId ?? "");
    expect(row?.defaultViewId).not.toContain(row?.databaseId ?? "");
    expect(row?.viewDataSourceId).toBe(row?.dataSourceId);

    const page = await createPage(row?.projectId ?? "", "triage", {
      title: "Projected Page",
    });
    expect(database.prepare(`
      SELECT
        membership.data_source_id AS dataSourceId,
        position.page_block_id AS positionedPageId,
        value.value_json AS statusValue
      FROM data_source_page_memberships membership
      INNER JOIN database_view_page_positions position
        ON position.page_block_id = membership.page_block_id
        AND position.view_id = ?
      INNER JOIN data_source_property_values value
        ON value.membership_id = membership.id
      INNER JOIN data_source_properties property
        ON property.id = value.property_id
        AND property.id = 'status'
      WHERE membership.page_block_id = ?
        AND membership.removed_at IS NULL
    `).get(row?.defaultViewId, page.id)).toEqual({
      dataSourceId: row?.dataSourceId,
      positionedPageId: page.id,
      statusValue: '"triage"',
    });

    expect(database.pragma("foreign_key_check")).toEqual([]);
  });

  test("projects every document-bearing Card into one exclusively parented Library Page", async () => {
    useTempStore();
    await initializeDatabase();
    const database = getDb();
    const project = createProject({ name: "Page parent projection" });
    const created = await createPage(project.id, "triage", {
      title: "Structured Page",
    });

    expect(database.prepare(`
      SELECT
        page.block_id AS pageId,
        page.library_id AS libraryId,
        page.document_id AS documentId,
        page.parent_kind AS parentKind,
        page.parent_id AS parentId,
        membership.data_source_id AS membershipSourceId
      FROM pages page
      INNER JOIN data_source_page_memberships membership
        ON membership.page_block_id = page.block_id
        AND membership.removed_at IS NULL
      WHERE page.block_id = ?
    `).get(created.id)).toEqual({
      pageId: created.id,
      libraryId: project.libraryId,
      documentId: `document:${created.id}`,
      parentKind: "data_source",
      parentId: expect.any(String),
      membershipSourceId: expect.any(String),
    });

    expect(database.pragma("foreign_key_check")).toEqual([]);
  });

  test("creates immutable Database Module receipt storage", async () => {
    useTempStore();
    const database = getDb();
    createHistoricalReleaseSchemaFixture(database, 69, { seedDefaultProject: false });
    migrateSchema69To70(database);
    expect(database.pragma("user_version", { simple: true })).toBe(70);
    expect(tableNames(database).has("database_module_receipts")).toBe(true);
  });

  test("migrates persisted Card Block and Document literals to Page", async () => {
    useTempStore();
    const database = getDb();
    createHistoricalReleaseSchemaFixture(database, 70);
    const project = createHistoricalProject(database, "Page noun migration");
    const page = createHistoricalPage(database, project.id, "Migrated Page");
    database.prepare(`
      INSERT INTO document_versions (
        version_id, document_id, project_id, generation, base_head_seq,
        schema_key, schema_version, cause, label, actor_json,
        revision_kind, source_mutation_id, source_change_seq, pinned,
        checkpoint_format, full_update_blob, state_vector, checkpoint_hash,
        byte_length, created_at
      ) VALUES (
        'version:page-noun-migration', ?, ?, 1, 0,
        'nodex.page', 1, 'manual', NULL, '{}',
        'manual', NULL, NULL, 1,
        'yjs_update_v1', X'01', X'', ?, 1, '2026-07-15T00:00:01.000Z'
      )
    `).run(
      page.documentId,
      project.id,
      createHash("sha256").update(Buffer.from([1])).digest("hex"),
    );

    dropTriggersContainingPageLiteral(database);
    const immutableVersionTrigger = database.prepare(`
      SELECT sql FROM sqlite_schema
      WHERE type = 'trigger' AND name = 'document_versions_are_immutable'
    `).get() as { readonly sql: string };
    database.exec(`
      DROP TRIGGER IF EXISTS blocks_type_updates_preserve_document_ownership;
      DROP TRIGGER document_versions_are_immutable;
      UPDATE blocks SET type = 'card' WHERE id = '${page.id}';
      UPDATE documents
      SET schema_key = 'nodex.card'
      WHERE id = 'document:${page.id}';
      UPDATE document_versions
      SET schema_key = 'nodex.card'
      WHERE document_id = 'document:${page.id}';
      CREATE TRIGGER legacy_card_block_guard
        BEFORE INSERT ON blocks
        WHEN NEW.type = 'card'
        BEGIN
          SELECT 1;
        END;
    `);
    database.exec(immutableVersionTrigger.sql);
    migrateSchema70To71(database);

    expect(database.pragma("user_version", { simple: true })).toBe(71);
    expect(
      database.prepare(`
        SELECT block.type, document.schema_key AS schemaKey,
          version.schema_key AS versionSchemaKey
        FROM blocks block
        INNER JOIN block_documents ownership ON ownership.block_id = block.id
        INNER JOIN documents document ON document.id = ownership.document_id
        INNER JOIN document_versions version ON version.document_id = document.id
        WHERE block.id = ?
      `).get(page.id),
    ).toEqual({
      type: "page",
      schemaKey: "nodex.page",
      versionSchemaKey: "nodex.page",
    });
    expect(
      database.prepare(`
        SELECT sql FROM sqlite_schema
        WHERE type = 'trigger' AND name = 'legacy_card_block_guard'
      `).get(),
    ).toEqual(expect.objectContaining({ sql: expect.stringContaining("'page'") }));
    expect(() =>
      database.exec("UPDATE document_versions SET schema_key = schema_key"),
    ).toThrow("document versions are immutable");
    expect(database.pragma("foreign_key_check")).toEqual([]);
  });

  test.each([58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74])(
    "runs the ordered release chain from schema v%i",
    async (sourceVersion) => {
      useTempStore();
      createHistoricalReleaseSchemaFixture(getDb(), sourceVersion, {
        seedDefaultProject: false,
      });
      closeDatabase();

      await initializeDatabase();

      expect(getDb().pragma("user_version", { simple: true })).toBe(
        CURRENT_SCHEMA_VERSION,
      );
    },
  );

  test("migrates reminder snoozes from Project-owned Cards to Library Page targets", async () => {
    useTempStore();
    const database = getDb();
    createHistoricalReleaseSchemaFixture(database, 72);
    const owner = createHistoricalProject(database, "Reminder owner");
    const actor = createHistoricalProject(database, "Reminder actor");
    const page = createHistoricalPage(
      database,
      owner.id,
      "Granted reminder target",
    );

    migrateSchema72To73(database);

    expect(database.pragma("user_version", { simple: true })).toBe(73);
    database.prepare(`
      INSERT INTO reminder_snoozes (
        project_id, card_id, occurrence_start, due_at, created_at, consumed_at
      ) VALUES (?, ?, ?, ?, ?, NULL)
    `).run(
      actor.id,
      page.id,
      "2031-02-03T10:00:00.000Z",
      "2031-02-03T09:00:00.000Z",
      "2031-02-03T08:00:00.000Z",
    );
    expect(
      database.prepare(`
        SELECT project_id, card_id FROM reminder_snoozes
      `).get(),
    ).toEqual({ project_id: actor.id, card_id: page.id });
    expect(database.pragma("foreign_key_check(reminder_snoozes)")).toEqual([]);
  });

  test("reinstalls Page parent projection with stable Data Source identity", async () => {
    useTempStore();
    const database = getDb();
    createHistoricalReleaseSchemaFixture(database, 73, { seedDefaultProject: false });

    migrateSchema73To74(database);

    expect(database.pragma("user_version", { simple: true })).toBe(74);
    const trigger = database.prepare(`
      SELECT sql FROM sqlite_schema
      WHERE type = 'trigger' AND name = 'blocks_page_projection_after_update'
    `).get() as { readonly sql: string };
    expect(trigger.sql).toContain("source.home_database_block_id");
    expect(trigger.sql).toContain("current_page.parent_id");
  });

  test("publishes the canonical Page-reference document boundary", async () => {
    useTempStore();
    const database = getDb();
    createHistoricalReleaseSchemaFixture(database, 74);
    database.prepare(`
      UPDATE database_views
      SET config_json = json_set(
        json_remove(config_json, '$.options.includeHostPage'),
        '$.options.includeHostCard',
        json('true')
      )
      WHERE is_primary = 1
    `).run();
    migrateSchema74To75(database);

    expect(database.pragma("user_version", { simple: true })).toBe(75);
    const migratedView = database.prepare(`
      SELECT config_json
      FROM database_views
      WHERE is_primary = 1
      LIMIT 1
    `).pluck().get() as string;
    expect(JSON.parse(migratedView)).toMatchObject({
      options: { includeHostPage: true },
    });
    expect(migratedView).not.toContain("includeHostCard");
    expect(database.pragma("foreign_key_check")).toEqual([]);
  });

  test("migrates durable Page Stage tab identities without interaction ancestry", async () => {
    useTempStore();
    const database = getDb();
    createHistoricalReleaseSchemaFixture(database, 75);
    const project = database.prepare(
      "SELECT id FROM projects ORDER BY created, id LIMIT 1",
    ).get() as { readonly id: string };
    const session = createProjectSession({
      projectId: project.id,
      noThreadFallbackTitle: "Page Stage migration",
    });
    const tab = createProjectSessionTab({
      sessionId: session.id,
      projectId: project.id,
      panelId: "right",
      kind: "page_stage",
      title: "Nested Page",
      config: {
        projectId: project.id,
        pageId: "page:nested",
      },
    });
    database.pragma("ignore_check_constraints = ON");
    database.prepare(`
      UPDATE project_session_tabs
      SET kind = 'card_stage', config_json = ?
      WHERE id = ?
    `).run(JSON.stringify({
      projectId: project.id,
      cardId: "page:nested",
      ancestors: [{ cardId: "page:root" }],
    }), tab.id);
    database.pragma("ignore_check_constraints = OFF");
    migrateSchema75To76(database);

    expect(database.pragma("user_version", { simple: true })).toBe(76);
    const migrated = database.prepare(`
      SELECT kind, config_json
      FROM project_session_tabs
      WHERE id = ?
    `).get(tab.id) as { readonly kind: string; readonly config_json: string };
    expect(migrated.kind).toBe("page_stage");
    expect(JSON.parse(migrated.config_json)).toEqual({
      projectId: project.id,
      pageId: "page:nested",
    });
    expect(database.pragma("foreign_key_check")).toEqual([]);
  });

  test("publishes Page-named relational projections and coordinates", async () => {
    useTempStore();
    const database = getDb();
    createHistoricalReleaseSchemaFixture(database, 76, { seedDefaultProject: false });

    migrateSchema76To77(database);

    expect(database.pragma("user_version", { simple: true })).toBe(77);
    const names = tableNames(database);
    expect(names.has("page_read_model")).toBe(true);
    expect(names.has("scheduled_page_index")).toBe(true);
    expect(names.has("canvas_page_references")).toBe(true);
    expect(names.has("card_read_model")).toBe(false);
    expect(names.has("scheduled_card_index")).toBe(false);
    expect(names.has("canvas_card_references")).toBe(false);

    for (const [tableName, expectedColumn, oldColumn] of [
      ["database_memberships", "page_block_id", "card_block_id"],
      ["page_read_model", "page_block_id", "card_block_id"],
      ["scheduled_page_index", "page_block_id", "card_block_id"],
      ["recurrence_exceptions", "page_id", "card_id"],
      ["reminder_receipts", "page_id", "card_id"],
      ["reminder_snoozes", "page_id", "card_id"],
    ] as const) {
      const columns = database.pragma(`table_info(${tableName})`) as readonly {
        readonly name: string;
      }[];
      expect(columns.some((column) => column.name === expectedColumn)).toBe(true);
      expect(columns.some((column) => column.name === oldColumn)).toBe(false);
    }
    expect(database.pragma("foreign_key_check")).toEqual([]);
  });

  test("migrates legacy Canvas reference hashes and retained checkpoints", async () => {
    useTempStore();
    await initializeDatabase();
    const database = getDb();
    const project = createProject({ name: "Canvas Page hash migration" });
    const documentId = primaryCanvasDocumentId(project.id);
    const synced = syncCanvasScene(database, {
      version: 1,
      projectId: project.id,
      documentId,
      clientSessionId: "schema-v78-fixture",
    });
    if (!synced.ok) throw new Error(synced.error.message);
    const checkpoint = createDocumentVersionCheckpoint(database, {
      version: DOCUMENT_VERSION_CONTRACT_VERSION,
      projectId: project.id,
      storeEpoch: synced.value.storeEpoch,
      documentId,
      expectedGeneration: synced.value.generation,
      expectedHeadSeq: synced.value.headSeq,
      cause: "manual",
      revisionKind: "manual",
      actor: { kind: "schema-v78-fixture" },
    }).checkpoint;
    const { pageReferences, ...sceneWithoutPageReferences } = synced.value.scene;
    const legacyFingerprint = canonicalStringifyCanvasScene({
      schemaVersion: synced.value.scene.schemaVersion,
      elements: synced.value.scene.elements,
      appState: synced.value.scene.appState,
      files: synced.value.scene.files,
      cardReferences: pageReferences,
    });
    const legacyHash = createHash("sha256")
      .update(legacyFingerprint)
      .digest("hex");
    const legacyCheckpoint = Buffer.from(
      canonicalStringifyCanvasScene({
        ...sceneWithoutPageReferences,
        cardReferences: pageReferences,
      }),
      "utf8",
    );
    const legacyCheckpointHash = createHash("sha256")
      .update(legacyCheckpoint)
      .digest("hex");
    database.exec("DROP TRIGGER document_versions_are_immutable");
    database.prepare(`
      UPDATE documents SET state_hash = ? WHERE id = ?
    `).run(legacyHash, documentId);
    database.prepare(`
      UPDATE canvas_scenes SET scene_hash = ? WHERE document_id = ?
    `).run(legacyHash, documentId);
    database.prepare(`
      UPDATE document_versions
      SET full_update_blob = ?, checkpoint_hash = ?, byte_length = ?
      WHERE version_id = ?
    `).run(
      legacyCheckpoint,
      legacyCheckpointHash,
      legacyCheckpoint.byteLength,
      checkpoint.versionId,
    );
    database.exec(`
      CREATE TRIGGER document_versions_are_immutable
        BEFORE UPDATE ON document_versions
        BEGIN
          SELECT RAISE(ABORT, 'document versions are immutable');
        END;
    `);
    database.pragma("user_version = 77");

    migrateSchema77To78(database);

    expect(database.pragma("user_version", { simple: true })).toBe(78);
    const migrated = syncCanvasScene(database, {
      version: 1,
      projectId: project.id,
      documentId,
      clientSessionId: "schema-v78-verification",
    });
    expect(migrated.ok).toBe(true);
    const retained = database.prepare(`
      SELECT full_update_blob, checkpoint_hash, byte_length
      FROM document_versions WHERE version_id = ?
    `).get(checkpoint.versionId) as {
      readonly full_update_blob: Buffer;
      readonly checkpoint_hash: string;
      readonly byte_length: number;
    };
    const retainedJson = JSON.parse(
      retained.full_update_blob.toString("utf8"),
    ) as Record<string, unknown>;
    expect(retainedJson.pageReferences).toEqual(pageReferences);
    expect(retainedJson).not.toHaveProperty("cardReferences");
    expect(retained.byte_length).toBe(retained.full_update_blob.byteLength);
    expect(retained.checkpoint_hash).toBe(
      createHash("sha256").update(retained.full_update_blob).digest("hex"),
    );
    expect(() =>
      database.exec("UPDATE document_versions SET schema_key = schema_key"),
    ).toThrow("document versions are immutable");
    expect(database.pragma("foreign_key_check")).toEqual([]);
  });

  test("migrates v63 stores with a durable per-thread dynamic-tool catalog", async () => {
    useTempStore();
    const database = getDb();
    createHistoricalReleaseSchemaFixture(database, 63, { seedDefaultProject: false });

    migrateSchema63To64(database);

    expect(database.pragma("user_version", { simple: true })).toBe(64);
    expect(tableNames(database).has("codex_thread_dynamic_tool_catalogs")).toBe(true);
    expect(database.pragma("foreign_key_check")).toEqual([]);
  });

  test("migrates v64 stores with one durable Agent token signing key", async () => {
    useTempStore();
    const database = getDb();
    createHistoricalReleaseSchemaFixture(database, 64, { seedDefaultProject: false });

    migrateSchema64To65(database);

    const row = database.prepare(
      "SELECT length(key_material) AS key_length FROM nodex_agent_token_keys WHERE id = 1",
    ).get() as { readonly key_length: number };
    expect(database.pragma("user_version", { simple: true })).toBe(65);
    expect(row.key_length).toBe(32);
  });

  test("migrates v65 stores with bounded Agent call preparation receipts", async () => {
    useTempStore();
    const database = getDb();
    createHistoricalReleaseSchemaFixture(database, 65, { seedDefaultProject: false });

    migrateSchema65To66(database);

    expect(database.pragma("user_version", { simple: true })).toBe(66);
    expect(tableNames(database).has("nodex_agent_call_receipts")).toBe(true);
    expect(database.pragma("foreign_key_check")).toEqual([]);
  });

  test("publishes v66 stores with Document revision sessions", async () => {
    useTempStore();
    const database = getDb();
    createHistoricalReleaseSchemaFixture(database, 66, { seedDefaultProject: false });

    migrateSchema66To67(database);

    expect(database.pragma("user_version", { simple: true })).toBe(67);
    expect(tableNames(database).has("document_revision_sessions")).toBe(true);
    const versionColumns = database.pragma(
      "table_info(document_versions)",
    ) as Array<{ readonly name: string }>;
    for (const column of [
      "revision_kind",
      "source_mutation_id",
      "source_change_seq",
      "pinned",
    ]) {
      expect(versionColumns.some((candidate) => candidate.name === column)).toBe(
        true,
      );
    }
    expect(database.pragma("foreign_key_check")).toEqual([]);
  });

  test("rebuilds the shipped v66 checkpoint table without changing bytes", async () => {
    useTempStore();
    const database = getDb();
    createHistoricalReleaseSchemaFixture(database, 66, { seedDefaultProject: false });
    const project = createPreLibraryHistoricalProject(database, "Revision migration");
    const card = createHistoricalPage(database, project.id, "Migrated Card");
    const document = database.prepare(
      `SELECT document.id, document.generation, document.head_seq,
         document.schema_key, document.schema_version
       FROM documents document
       INNER JOIN block_documents ownership ON ownership.document_id = document.id
       WHERE ownership.block_id = ?`,
    ).get(card.id) as {
      readonly id: string;
      readonly generation: number;
      readonly head_seq: number;
      readonly schema_key: string;
      readonly schema_version: number;
    };
    database.exec(`
      DROP TABLE IF EXISTS document_revision_sessions;
      DROP TRIGGER IF EXISTS document_versions_validate_insert;
      DROP TRIGGER IF EXISTS document_versions_are_immutable;
      DROP TRIGGER IF EXISTS document_versions_validate_checkpoint_format;
      DROP TABLE document_versions;

      CREATE TABLE document_versions (
        version_id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL,
        generation INTEGER NOT NULL,
        base_head_seq INTEGER NOT NULL,
        schema_key TEXT NOT NULL,
        schema_version INTEGER NOT NULL,
        cause TEXT NOT NULL,
        label TEXT,
        actor_json TEXT NOT NULL DEFAULT '{}',
        checkpoint_format TEXT NOT NULL DEFAULT 'yjs_update_v1',
        full_update_blob BLOB NOT NULL,
        state_vector BLOB NOT NULL,
        checkpoint_hash TEXT NOT NULL,
        byte_length INTEGER NOT NULL,
        created_at TEXT NOT NULL
      ) WITHOUT ROWID;
    `);
    database.prepare(
      `INSERT INTO document_versions (
         version_id, document_id, project_id, generation, base_head_seq,
         schema_key, schema_version, cause, label, actor_json,
         checkpoint_format, full_update_blob, state_vector, checkpoint_hash,
         byte_length, created_at
       ) VALUES (
         'version:v66', ?, ?, ?, ?, ?, ?, 'before_restore',
         'Safety before restore', '{}', 'yjs_update_v1', X'01', X'02', ?,
         1, '2026-07-16T00:00:00.000Z'
       )`,
    ).run(
      document.id,
      project.id,
      document.generation,
      document.head_seq,
      document.schema_key,
      document.schema_version,
      "a".repeat(64),
    );

    migrateSchema66To67(database);

    expect(database.prepare(
      `SELECT revision_kind, source_mutation_id, source_change_seq, pinned,
         checkpoint_format, hex(full_update_blob) AS checkpoint_bytes,
         hex(state_vector) AS state_vector_bytes, byte_length
       FROM document_versions
       WHERE version_id = 'version:v66'`,
    ).get()).toEqual({
      revision_kind: "restore",
      source_mutation_id: null,
      source_change_seq: null,
      pinned: 1,
      checkpoint_format: "yjs_update_v1",
      checkpoint_bytes: "01",
      state_vector_bytes: "02",
      byte_length: 1,
    });
    expect(database.pragma("user_version", { simple: true })).toBe(67);
    expect(database.pragma("foreign_key_check")).toEqual([]);
  });

  test("rejects an unreleased development schema without mutating it", async () => {
    useTempStore();
    const database = new Database(getDatabasePath());
    database.pragma("user_version = 999");
    database.close();

    await expect(initializeDatabase()).rejects.toThrow(
      "Unsupported Nodex database schema version 999",
    );
    const unchanged = new Database(getDatabasePath(), { readonly: true });
    expect(unchanged.pragma("user_version", { simple: true })).toBe(999);
    unchanged.close();
  });

  test("rejects the Rust Core v83 ownership schema without mutating it", async () => {
    useTempStore();
    const database = new Database(getDatabasePath());
    database.pragma("user_version = 83");
    database.close();

    await expect(initializeDatabase()).rejects.toThrow(
      "Unsupported Nodex database schema version 83",
    );
    const unchanged = new Database(getDatabasePath(), { readonly: true });
    expect(unchanged.pragma("user_version", { simple: true })).toBe(83);
    unchanged.close();
  });

  test("migrates v58 state to v59 without losing thread or panel identity", () => {
    const database = new Database(":memory:");
    database.pragma("foreign_keys = ON");
    createSchema58MigrationFixture(database);

    migrateSchema58To59(database);

    expect(database.pragma("user_version", { simple: true })).toBe(59);
    expect(database.pragma("foreign_keys", { simple: true })).toBe(1);
    const names = tableNames(database);
    expect(names.has("codex_unread_threads")).toBe(true);
    expect(names.has("codex_project_thread_orders")).toBe(true);
    expect(names.has("codex_sidebar_chat_order")).toBe(true);
    const threadColumns = database.pragma("table_info(codex_threads)") as Array<{
      name: string;
    }>;
    expect(threadColumns.some((column) => column.name === "forked_from_id")).toBe(
      true,
    );
    expect(threadColumns.some((column) => column.name === "service_name")).toBe(
      true,
    );
    expect(
      database
        .prepare(
          `SELECT id, project_id, browser_tab_id
           FROM project_session_tabs ORDER BY "order", id`,
        )
        .all(),
    ).toEqual([
      {
        id: "browser-a",
        project_id: "project-1",
        browser_tab_id: makeDefaultBrowserSidebarTabId("session-1"),
      },
      {
        id: "browser-b",
        project_id: "project-1",
        browser_tab_id: "browser-b",
      },
      { id: "files-a", project_id: "project-1", browser_tab_id: null },
    ]);
    expect(database.pragma("foreign_key_check")).toEqual([]);
    database.close();
  });

  test("publishes a clean v59 store as v60", async () => {
    useTempStore();
    const database = getDb();
    createHistoricalReleaseSchemaFixture(database, 59, { seedDefaultProject: false });

    migrateSchema59To60(database);

    expect(database.pragma("user_version", { simple: true })).toBe(60);
  });

  test("publishes a clean v60 store as v61", async () => {
    useTempStore();
    const database = getDb();
    createHistoricalReleaseSchemaFixture(database, 60, { seedDefaultProject: false });

    migrateSchema60To61(database);

    expect(database.pragma("user_version", { simple: true })).toBe(61);
  });

  test("migrates v82 stores with persisted subagent routing paths", () => {
    const database = new Database(":memory:");
    createHistoricalReleaseSchemaFixture(database, 82, { seedDefaultProject: false });

    expect(hasColumn(database, "codex_threads", "agent_path")).toBe(false);

    migrateSchema82To83(database);

    expect(database.pragma("user_version", { simple: true })).toBe(83);
    expect(hasColumn(database, "codex_threads", "agent_path")).toBe(true);
    database.close();
  });

  test("repairs duplicate thread owners before enforcing one session owner per thread", async () => {
    useTempStore();
    const database = getDb();
    createHistoricalReleaseSchemaFixture(database, 61, { seedDefaultProject: false });
    const project = createPreLibraryHistoricalProject(database, "Session ownership repair");
    const canonicalSession = { id: randomUUID() };
    const redundantSession = { id: randomUUID() };
    const now = "2026-01-01T00:00:00.000Z";
    database.prepare(`
      INSERT INTO codex_threads (
        thread_id, project_id, thread_name, created_at, updated_at, linked_at
      ) VALUES ('thread:duplicate-owner', ?, 'Duplicate owner thread', 1, 1, ?)
    `).run(project.id, now);
    database.prepare(`
      INSERT INTO project_sessions (
        id, project_id, no_thread_fallback_title, "order", panel_state_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, '{}', ?, ?)
    `).run(
      canonicalSession.id,
      project.id,
      "Original session",
      0,
      now,
      now,
    );
    database.prepare(`
      INSERT INTO project_sessions (
        id, project_id, no_thread_fallback_title, "order", panel_state_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, '{}', ?, ?)
    `).run(
      redundantSession.id,
      project.id,
      "Materialized shell",
      1,
      now,
      now,
    );
    database.prepare(`
      INSERT INTO project_session_threads (session_id, thread_id, linked_at)
      VALUES (?, 'thread:duplicate-owner', ?)
    `).run(canonicalSession.id, now);
    database.prepare(`
      INSERT INTO project_session_threads (session_id, thread_id, linked_at)
      VALUES (?, 'thread:duplicate-owner', '2026-01-01T00:00:00.000Z')
    `).run(redundantSession.id);
    database.prepare(`
      INSERT INTO project_session_tabs (
        id, session_id, project_id, browser_tab_id, panel_id, kind, title,
        config_json, state_key, state_json, "order", created_at, updated_at
      ) VALUES (?, ?, ?, NULL, 'right', 'terminal', 'Terminal', ?, 0, '{}', 0, ?, ?)
    `).run(
      randomUUID(),
      canonicalSession.id,
      project.id,
      JSON.stringify({
        projectId: project.id,
        terminalSessionId: "terminal:canonical-owner",
      }),
      now,
      now,
    );

    migrateSchema61To62(database);

    expect(database.pragma("user_version", { simple: true })).toBe(62);
    expect(
      database.prepare(`
        SELECT session_id AS sessionId
        FROM project_session_threads
        WHERE thread_id = 'thread:duplicate-owner'
      `).all(),
    ).toEqual([{ sessionId: canonicalSession.id }]);
    expect(
      database.prepare(`
        SELECT archived, unread, pinned
        FROM project_sessions
        WHERE id = ?
      `).get(redundantSession.id),
    ).toEqual({ archived: 1, unread: 0, pinned: 0 });
    const threadIndex = (
      database.pragma("index_list(project_session_threads)") as Array<{
        name: string;
        unique: number;
      }>
    ).find((index) => index.name === "idx_project_session_threads_thread");
    expect(threadIndex?.unique).toBe(1);
    expect(() => database.prepare(`
      INSERT INTO project_session_threads (session_id, thread_id, linked_at)
      VALUES (?, 'thread:duplicate-owner', '2026-01-02T00:00:00.000Z')
    `).run(redundantSession.id)).toThrow(/UNIQUE constraint failed/u);
  });

  test("retires Card Agent properties atomically while preserving Card revisions and immutable evidence", async () => {
    useTempStore();
    const database = getDb();
    createHistoricalReleaseSchemaFixture(database, 62, { seedDefaultProject: false });
    const project = createPreLibraryHistoricalProject(
      database,
      "Retired Agent properties",
    );
    const card = createHistoricalPage(database, project.id, "Legacy Card");
    seedHistoricalMutationEvidence(database, project.id, card);
    const metadataBefore = (
      database
        .prepare("SELECT metadata_revision FROM blocks WHERE id = ?")
        .get(card.id) as { readonly metadata_revision: number }
    ).metadata_revision;
    const evidenceBefore = {
      mutations: (
        database.prepare("SELECT COUNT(*) AS count FROM block_mutations").get() as {
          readonly count: number;
        }
      ).count,
      changes: (
        database.prepare("SELECT COUNT(*) AS count FROM change_log").get() as {
          readonly count: number;
        }
      ).count,
    };
    database.prepare(`
      INSERT INTO block_properties (
        block_id, project_id, property_key, value_type, value_json,
        revision, updated_at
      ) VALUES
        (?, ?, 'agent.blocked', 'boolean', 'true', 7, ?),
        (?, ?, 'agent.status', 'string', '"waiting"', 8, ?)
    `).run(
      card.id,
      project.id,
      "2026-07-15T00:00:00.000Z",
      card.id,
      project.id,
      "2026-07-15T00:00:00.000Z",
    );
    const projection = database.prepare(`
      SELECT intrinsic_properties_json, property_revisions_json
      FROM card_read_model
      WHERE card_block_id = ?
    `).get(card.id) as {
      readonly intrinsic_properties_json: string;
      readonly property_revisions_json: string;
    };
    const intrinsicValues = JSON.parse(
      projection.intrinsic_properties_json,
    ) as Record<string, unknown>;
    intrinsicValues["agent.blocked"] = true;
    intrinsicValues["agent.status"] = "waiting";
    const propertyRevisions = JSON.parse(
      projection.property_revisions_json,
    ) as { intrinsic: Record<string, number> };
    propertyRevisions.intrinsic["agent.blocked"] = 7;
    propertyRevisions.intrinsic["agent.status"] = 8;
    database.prepare(`
      UPDATE card_read_model
      SET intrinsic_properties_json = ?, property_revisions_json = ?
      WHERE card_block_id = ?
    `).run(
      JSON.stringify(intrinsicValues),
      JSON.stringify(propertyRevisions),
      card.id,
    );
    expect(() =>
      migrateSchema62To63(database, {
        faultInjector: (point) => {
          if (point === "after_projection_rebuild") {
            throw new Error("fault:v63-finalizer");
          }
        },
      }),
    ).toThrow("fault:v63-finalizer");
    expect(database.pragma("user_version", { simple: true })).toBe(62);
    expect(
      database
        .prepare(
          `SELECT property_key FROM block_properties
           WHERE block_id = ? AND property_key LIKE 'agent.%'
           ORDER BY property_key`,
        )
        .all(card.id),
    ).toEqual([
      { property_key: "agent.blocked" },
      { property_key: "agent.status" },
    ]);

    migrateSchema62To63(database);

    expect(database.pragma("user_version", { simple: true })).toBe(63);
    expect(
      database
        .prepare(
          `SELECT property_key FROM block_properties
           WHERE property_key IN ('agent.blocked', 'agent.status')`,
        )
        .all(),
    ).toEqual([]);
    const rebuiltProjection = database.prepare(`
      SELECT intrinsic_properties_json, property_revisions_json
      FROM card_read_model
      WHERE card_block_id = ?
    `).get(card.id) as {
      readonly intrinsic_properties_json: string;
      readonly property_revisions_json: string;
    };
    const rebuiltIntrinsicKeys = Object.keys(
      JSON.parse(rebuiltProjection.intrinsic_properties_json),
    );
    const rebuiltIntrinsicRevisionKeys = Object.keys(
      (JSON.parse(rebuiltProjection.property_revisions_json) as {
        intrinsic: Record<string, number>;
      }).intrinsic,
    );
    for (const retiredKey of ["agent.blocked", "agent.status"]) {
      expect(rebuiltIntrinsicKeys).not.toContain(retiredKey);
      expect(rebuiltIntrinsicRevisionKeys).not.toContain(retiredKey);
    }
    expect(
      (
        database
          .prepare("SELECT metadata_revision FROM blocks WHERE id = ?")
          .get(card.id) as { readonly metadata_revision: number }
      ).metadata_revision,
    ).toBe(metadataBefore);
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM block_mutations").get(),
    ).toEqual({ count: evidenceBefore.mutations });
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM change_log").get(),
    ).toEqual({ count: evidenceBefore.changes });
    expect(database.pragma("foreign_key_check")).toEqual([]);
  });

  test("replaces the v62 Card projection trigger before rebuilding UTF-16 summaries", async () => {
    useTempStore();
    const database = getDb();
    createHistoricalReleaseSchemaFixture(database, 62, { seedDefaultProject: false });
    const project = createPreLibraryHistoricalProject(
      database,
      "UTF-16 Card projection",
    );
    const card = createHistoricalPage(database, project.id, "Emoji Card");
    const documentId = card.documentId;

    database.prepare(`
      UPDATE document_materializations
      SET nfm = '😀', preview = '😀'
      WHERE document_id = ?
    `).run(documentId);
    database.exec(`
      DROP TRIGGER card_read_model_validate_update;
      CREATE TRIGGER card_read_model_validate_update
        BEFORE UPDATE ON card_read_model
        WHEN NEW.description_length <> (
          SELECT length(materialization.nfm)
          FROM document_materializations materialization
          WHERE materialization.document_id = NEW.document_id
        )
        BEGIN
          SELECT RAISE(ABORT, 'Card read model source coordinates are invalid or stale');
        END;
    `);
    expect(() =>
      migrateSchema62To63(database, {
        faultInjector: (point) => {
          if (point === "after_projection_rebuild") {
            throw new Error("fault:utf16-projection-rebuild");
          }
        },
      }),
    ).toThrow("fault:utf16-projection-rebuild");
    expect(database.pragma("user_version", { simple: true })).toBe(62);
    expect(() =>
      database.prepare(`
        UPDATE card_read_model
        SET description_length = description_length
        WHERE card_block_id = ?
      `).run(card.id),
    ).toThrow("Card read model source coordinates are invalid or stale");

    migrateSchema62To63(database);

    expect(database.pragma("user_version", { simple: true })).toBe(63);
    expect(
      database.prepare(`
        SELECT description_preview, description_length, has_description
        FROM card_read_model
        WHERE card_block_id = ?
      `).get(card.id),
    ).toEqual({
      description_preview: "😀",
      description_length: "😀".length,
      has_description: 1,
    });
    expect(() =>
      database.prepare(`
        UPDATE card_read_model
        SET metadata_revision = metadata_revision + 1
        WHERE card_block_id = ?
      `).run(card.id),
    ).toThrow("Card read model source coordinates are invalid or stale");
  });

  test("rolls back every v59 schema change when source integrity fails", () => {
    const database = new Database(":memory:");
    database.pragma("foreign_keys = OFF");
    createSchema58MigrationFixture(database, { orphanedBrowserTab: true });

    expect(() => migrateSchema58To59(database)).toThrow(
      "Schema v59 migration produced 1 foreign-key violation(s)",
    );

    expect(database.pragma("user_version", { simple: true })).toBe(
      SHIPPED_SCHEMA_VERSION,
    );
    expect(tableNames(database).has("codex_unread_threads")).toBe(false);
    const threadColumns = database.pragma("table_info(codex_threads)") as Array<{
      name: string;
    }>;
    expect(threadColumns.some((column) => column.name === "forked_from_id")).toBe(
      false,
    );
    const tabColumns = database.pragma(
      "table_info(project_session_tabs)",
    ) as Array<{ name: string }>;
    expect(tabColumns.some((column) => column.name === "browser_tab_id")).toBe(
      false,
    );
    database.close();
  });
});
