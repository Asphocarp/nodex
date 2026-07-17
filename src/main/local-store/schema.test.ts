import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { closeDatabase, getDb, initializeDatabase } from "./database";
import { getDatabasePath } from "./config";
import { resetAssetPathCacheForTests } from "./assets";
import { LEGACY_BLOCK_FIRST_TABLES_IN_DROP_ORDER } from "./block-first-legacy-schema";
import { makeDefaultBrowserSidebarTabId } from "../../shared/browser-sidebar";
import { initialDataSourceId } from "../../shared/library";
import {
  CURRENT_SCHEMA_VERSION,
  SHIPPED_SCHEMA_VERSION,
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
  migrateSchema67To68,
  migrateSchema68To69,
  migrateSchema69To70,
  migrateSchema70To71,
  migrateSchema72To73,
  migrateSchema73To74,
  migrateSchema74To75,
  migrateSchema75To76,
  migrateSchema76To77,
  migrateSchema77To78,
  migrateSchema78To79,
} from "./schema";
import {
  createProjectSession,
  createProjectSessionTab,
  upsertProjectSessionThreadLink,
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

const tempDirectories: string[] = [];

const useTempStore = (): string => {
  closeDatabase();
  resetAssetPathCacheForTests();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-schema-v68-"));
  tempDirectories.push(directory);
  process.env.NODEX_DIR = directory;
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

const renameSchemaObjectForV76Fixture = (
  database: Database.Database,
  type: "index" | "trigger",
  currentName: string,
  v76Name: string,
): void => {
  const row = database.prepare(`
    SELECT sql FROM sqlite_schema WHERE type = ? AND name = ?
  `).get(type, currentName) as { readonly sql: string | null } | undefined;
  if (!row?.sql) return;
  database.exec(`DROP ${type.toUpperCase()} "${currentName}"`);
  database.exec(row.sql.replace(currentName, v76Name));
};

/** Reconstruct the physical naming boundary that existed immediately before v77. */
const useSchema76PhysicalNames = (database: Database.Database): void => {
  if (tableNames(database).has("page_read_model")) {
    database.exec(`
      ALTER TABLE page_read_model RENAME COLUMN page_block_id TO card_block_id;
      ALTER TABLE page_read_model RENAME TO card_read_model;
      ALTER TABLE scheduled_page_index RENAME COLUMN page_block_id TO card_block_id;
      ALTER TABLE scheduled_page_index RENAME TO scheduled_card_index;
      ALTER TABLE canvas_page_references RENAME TO canvas_card_references;
      ALTER TABLE database_memberships RENAME COLUMN page_block_id TO card_block_id;
      ALTER TABLE recurrence_exceptions RENAME COLUMN page_id TO card_id;
      ALTER TABLE reminder_receipts RENAME COLUMN page_id TO card_id;
      ALTER TABLE reminder_snoozes RENAME COLUMN page_id TO card_id;
    `);
  }

  for (const [type, currentName, v76Name] of [
    ["trigger", "page_read_model_validate_insert", "card_read_model_validate_insert"],
    ["trigger", "page_read_model_validate_update", "card_read_model_validate_update"],
    ["trigger", "database_memberships_require_page_block", "database_memberships_require_card_block"],
    ["trigger", "database_memberships_updates_require_page_block", "database_memberships_updates_require_card_block"],
    ["trigger", "page_behavior_records_guard_block_retype", "card_behavior_records_guard_block_retype"],
    ["index", "idx_page_read_model_project_lifecycle", "idx_card_read_model_project_lifecycle"],
    ["index", "idx_page_read_model_view_order", "idx_card_read_model_view_order"],
    ["index", "idx_page_read_model_document_freshness", "idx_card_read_model_document_freshness"],
    ["index", "idx_scheduled_page_index_due", "idx_scheduled_card_index_due"],
    ["index", "idx_canvas_page_references_target", "idx_canvas_card_references_target"],
    ["index", "idx_database_memberships_active_page", "idx_database_memberships_active_card"],
  ] as const) {
    renameSchemaObjectForV76Fixture(database, type, currentName, v76Name);
  }

  expect(hasColumn(database, "database_memberships", "card_block_id")).toBe(true);
};

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

afterEach(() => {
  closeDatabase();
  resetAssetPathCacheForTests();
  delete process.env.NODEX_DIR;
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

describe("schema v79 release boundary", () => {
  test("derives supported versions and targets from one ordered release chain", () => {
    const releaseVersions = getReleaseSchemaVersions();
    expect(releaseVersions).toEqual([
      58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79,
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
      "database_capabilities",
      "database_containers",
      "data_sources",
      "data_source_properties",
      "data_source_page_memberships",
      "data_source_property_values",
      "database_memberships",
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
      "nodex_agent_token_keys",
      "nodex_agent_call_receipts",
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
    expect(database.pragma("foreign_key_check")).toEqual([]);
    expect(database.pragma("quick_check")).toEqual([{ quick_check: "ok" }]);
  });

  test("publishes the acyclic Page hierarchy guard at v79", async () => {
    useTempStore();
    await initializeDatabase();
    const project = createProject({ name: "Page hierarchy migration" });
    const parent = await createPage(project.id, "draft", { title: "Parent" });
    const child = await createPage(project.id, "draft", { title: "Child" });
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

  test("refuses to guess a repair for a corrupt v78 Page hierarchy", async () => {
    useTempStore();
    await initializeDatabase();
    const project = createProject({ name: "Corrupt Page hierarchy" });
    const first = await createPage(project.id, "draft", { title: "First" });
    const second = await createPage(project.id, "draft", { title: "Second" });
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

  test("creates one Profile Library and deterministic initial Data Source per Database", async () => {
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
    expect(row?.dataSourceId).toBe(initialDataSourceId(row?.databaseId ?? ""));
    expect(row?.viewDataSourceId).toBe(row?.dataSourceId);

    const page = await createPage(row?.projectId ?? "", "draft", {
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
        AND property.key = 'status'
      WHERE membership.page_block_id = ?
        AND membership.removed_at IS NULL
    `).get(row?.defaultViewId, page.id)).toEqual({
      dataSourceId: row?.dataSourceId,
      positionedPageId: page.id,
      statusValue: '"draft"',
    });

    useSchema76PhysicalNames(database);
    database.pragma("user_version = 67");
    migrateSchema67To68(database);
    expect(database.pragma("user_version", { simple: true })).toBe(68);
    expect(database.prepare("SELECT COUNT(*) AS count FROM profiles").get())
      .toEqual({ count: 1 });
    expect(database.prepare("SELECT COUNT(*) AS count FROM libraries").get())
      .toEqual({ count: 1 });
    expect(database.pragma("foreign_key_check")).toEqual([]);
  });

  test("projects every document-bearing Card into one exclusively parented Library Page", async () => {
    useTempStore();
    await initializeDatabase();
    const database = getDb();
    const project = createProject({ name: "Page parent projection" });
    const created = await createPage(project.id, "draft", {
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
      parentId: initialDataSourceId(project.databaseId),
      membershipSourceId: initialDataSourceId(project.databaseId),
    });

    dropTriggersContainingPageLiteral(database);
    database.exec("DROP TRIGGER IF EXISTS blocks_type_updates_preserve_document_ownership");
    database.prepare("UPDATE blocks SET type = 'card' WHERE id = ?").run(created.id);
    database.prepare("DELETE FROM pages WHERE block_id = ?").run(created.id);
    expect(database.prepare(`
      SELECT block.type, page.block_id AS pageId
      FROM blocks block
      LEFT JOIN pages page ON page.block_id = block.id
      WHERE block.id = ?
    `).get(created.id)).toEqual({ type: "card", pageId: null });

    useSchema76PhysicalNames(database);
    database.pragma("user_version = 68");
    migrateSchema68To69(database);
    expect(database.pragma("user_version", { simple: true })).toBe(69);
    expect(database.prepare(`
      SELECT page.block_id AS pageId, page.library_id AS libraryId,
        page.document_id AS documentId, page.parent_kind AS parentKind,
        page.parent_id AS parentId
      FROM pages page
      WHERE page.block_id = ?
    `).get(created.id)).toEqual({
      pageId: created.id,
      libraryId: project.libraryId,
      documentId: `document:${created.id}`,
      parentKind: "data_source",
      parentId: initialDataSourceId(project.databaseId),
    });
    expect(database.pragma("foreign_key_check")).toEqual([]);
  });

  test("creates immutable Database Module receipt storage", async () => {
    useTempStore();
    await initializeDatabase();
    const database = getDb();
    useSchema76PhysicalNames(database);
    database.pragma("user_version = 69");
    migrateSchema69To70(database);
    expect(database.pragma("user_version", { simple: true })).toBe(70);
    expect(tableNames(database).has("database_module_receipts")).toBe(true);
  });

  test("migrates persisted Card Block and Document literals to Page", async () => {
    useTempStore();
    await initializeDatabase();
    const database = getDb();
    const project = createProject({ name: "Page noun migration" });
    const page = await createPage(project.id, "draft", {
      title: "Migrated Page",
    });
    const document = database.prepare(`
      SELECT document.id, document.generation, document.head_seq AS headSeq
      FROM documents document
      INNER JOIN block_documents ownership ON ownership.document_id = document.id
      WHERE ownership.block_id = ?
    `).get(page.id) as {
      readonly id: string;
      readonly generation: number;
      readonly headSeq: number;
    };
    const storeEpoch = (
      database
        .prepare("SELECT store_epoch FROM block_store_metadata WHERE id = 1")
        .get() as { readonly store_epoch: string }
    ).store_epoch;
    createDocumentVersionCheckpoint(database, {
      version: DOCUMENT_VERSION_CONTRACT_VERSION,
      projectId: project.id,
      storeEpoch,
      documentId: document.id,
      expectedGeneration: document.generation,
      expectedHeadSeq: document.headSeq,
      cause: "manual",
      revisionKind: "manual",
      actor: { kind: "schema-migration-test" },
    });

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
    useSchema76PhysicalNames(database);
    database.pragma("user_version = 70");

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
      await initializeDatabase();
      useSchema76PhysicalNames(getDb());
      getDb().pragma(`user_version = ${sourceVersion}`);
      closeDatabase();

      await initializeDatabase();

      expect(getDb().pragma("user_version", { simple: true })).toBe(
        CURRENT_SCHEMA_VERSION,
      );
    },
  );

  test("migrates reminder snoozes from Project-owned Cards to Library Page targets", async () => {
    useTempStore();
    await initializeDatabase();
    const owner = createProject({ name: "Reminder owner" });
    const actor = createProject({ name: "Reminder actor" });
    const page = await createPage(owner.id, "draft", {
      title: "Granted reminder target",
    });
    const database = getDb();
    useSchema76PhysicalNames(database);
    database.pragma("user_version = 72");

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
    await initializeDatabase();
    const database = getDb();
    useSchema76PhysicalNames(database);
    database.pragma("user_version = 73");

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
    await initializeDatabase();
    const database = getDb();
    database.prepare(`
      UPDATE database_views
      SET config_json = json_set(
        json_remove(config_json, '$.options.includeHostPage'),
        '$.options.includeHostCard',
        json('true')
      )
      WHERE is_primary = 1
    `).run();
    useSchema76PhysicalNames(database);
    database.pragma("user_version = 74");

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

  test("migrates durable Page Stage tab identities and ancestor trails", async () => {
    useTempStore();
    await initializeDatabase();
    const database = getDb();
    const project = createProject({ name: "Page Stage migration" });
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
        ancestors: [{ pageId: "page:root" }],
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
    useSchema76PhysicalNames(database);
    database.pragma("user_version = 75");

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
      ancestors: [{ pageId: "page:root" }],
    });
    expect(database.pragma("foreign_key_check")).toEqual([]);
  });

  test("publishes Page-named relational projections and coordinates", async () => {
    useTempStore();
    await initializeDatabase();
    const database = getDb();

    useSchema76PhysicalNames(database);
    database.pragma("user_version = 76");

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
    await initializeDatabase();
    const database = getDb();
    database.exec("DROP TABLE codex_thread_dynamic_tool_catalogs");
    useSchema76PhysicalNames(database);
    database.pragma("user_version = 63");

    migrateSchema63To64(database);

    expect(database.pragma("user_version", { simple: true })).toBe(64);
    expect(tableNames(database).has("codex_thread_dynamic_tool_catalogs")).toBe(true);
    expect(database.pragma("foreign_key_check")).toEqual([]);
  });

  test("migrates v64 stores with one durable Agent token signing key", async () => {
    useTempStore();
    await initializeDatabase();
    const database = getDb();
    database.exec("DROP TABLE nodex_agent_token_keys");
    useSchema76PhysicalNames(database);
    database.pragma("user_version = 64");

    migrateSchema64To65(database);

    const row = database.prepare(
      "SELECT length(key_material) AS key_length FROM nodex_agent_token_keys WHERE id = 1",
    ).get() as { readonly key_length: number };
    expect(database.pragma("user_version", { simple: true })).toBe(65);
    expect(row.key_length).toBe(32);
  });

  test("migrates v65 stores with bounded Agent call preparation receipts", async () => {
    useTempStore();
    await initializeDatabase();
    const database = getDb();
    database.exec("DROP TABLE nodex_agent_call_receipts");
    useSchema76PhysicalNames(database);
    database.pragma("user_version = 65");

    migrateSchema65To66(database);

    expect(database.pragma("user_version", { simple: true })).toBe(66);
    expect(tableNames(database).has("nodex_agent_call_receipts")).toBe(true);
    expect(database.pragma("foreign_key_check")).toEqual([]);
  });

  test("publishes v66 stores with Document revision sessions", async () => {
    useTempStore();
    await initializeDatabase();
    const database = getDb();
    database.exec("DROP TABLE document_revision_sessions");
    useSchema76PhysicalNames(database);
    database.pragma("user_version = 66");

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
    await initializeDatabase();
    const project = createProject({ name: "Revision migration" });
    const card = await createPage(project.id, "draft", {
      title: "Migrated Card",
    });
    const database = getDb();
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
      DROP TABLE document_revision_sessions;
      DROP TRIGGER document_versions_validate_insert;
      DROP TRIGGER document_versions_are_immutable;
      DROP TRIGGER document_versions_validate_checkpoint_format;
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
    useSchema76PhysicalNames(database);
    database.pragma("user_version = 66");

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
    await initializeDatabase();
    const database = getDb();
    useSchema76PhysicalNames(database);
    database.pragma("user_version = 59");

    migrateSchema59To60(database);

    expect(database.pragma("user_version", { simple: true })).toBe(60);
  });

  test("publishes a clean v60 store as v61", async () => {
    useTempStore();
    await initializeDatabase();
    const database = getDb();
    useSchema76PhysicalNames(database);
    database.pragma("user_version = 60");

    migrateSchema60To61(database);

    expect(database.pragma("user_version", { simple: true })).toBe(61);
  });

  test("repairs duplicate thread owners before enforcing one session owner per thread", async () => {
    useTempStore();
    await initializeDatabase();

    const database = getDb();
    const project = database
      .prepare("SELECT id FROM projects ORDER BY created ASC, id ASC LIMIT 1")
      .get() as { id: string };
    const canonicalSession = createProjectSession({
      projectId: project.id,
      noThreadFallbackTitle: "Original session",
    });
    upsertProjectSessionThreadLink({
      sessionId: canonicalSession.id,
      projectId: project.id,
      threadId: "thread:duplicate-owner",
      threadName: "Duplicate owner thread",
    });
    createProjectSessionTab({
      sessionId: canonicalSession.id,
      projectId: project.id,
      panelId: "right",
      kind: "terminal",
      title: "Terminal",
      config: {
        projectId: project.id,
        terminalSessionId: "terminal:canonical-owner",
      },
    });
    const redundantSession = createProjectSession({
      projectId: project.id,
      noThreadFallbackTitle: "Materialized shell",
    });

    database.exec("DROP INDEX idx_project_session_threads_thread");
    database.prepare(`
      INSERT INTO project_session_threads (session_id, thread_id, linked_at)
      VALUES (?, 'thread:duplicate-owner', '2026-01-01T00:00:00.000Z')
    `).run(redundantSession.id);
    useSchema76PhysicalNames(database);
    database.pragma("user_version = 61");

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
    await initializeDatabase();
    const project = createProject({ name: "Retired Agent properties" });
    const card = await createPage(project.id, "draft", { title: "Legacy Card" });
    const database = getDb();
    useSchema76PhysicalNames(database);
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
    database.pragma("user_version = 62");

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
    await initializeDatabase();
    const project = createProject({ name: "UTF-16 Card projection" });
    const card = await createPage(project.id, "draft", {
      title: "Emoji Card",
    });
    const database = getDb();
    useSchema76PhysicalNames(database);
    const documentId = (
      database
        .prepare("SELECT document_id FROM block_documents WHERE block_id = ?")
        .get(card.id) as { readonly document_id: string }
    ).document_id;

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
    database.pragma("user_version = 62");

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
