import Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { createUuidV7 } from "../../shared/card-id";
import { parseGeneralDatabaseViewConfig } from "../../shared/database-kernel";
import { createCard, getCard } from "./cards";
import { getDatabasePath } from "./config";
import { closeDatabase, getDb, initializeDatabase } from "./database";
import {
  LEGACY_BLOCK_FIRST_TABLES_IN_DROP_ORDER,
} from "./block-first-legacy-schema";
import {
  createBlockFirstPreFinalizationSchema,
  CURRENT_SCHEMA_VERSION,
  ensureBlockFoundationForProject,
  getSchemaMigrationTargets,
} from "./schema";

const tempDirectories: string[] = [];

const useTempStore = (): string => {
  closeDatabase();
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "nodex-schema-v72-"),
  );
  tempDirectories.push(directory);
  process.env.NODEX_DIR = directory;
  return directory;
};

const tableNames = (database: Database.Database): readonly string[] =>
  (
    database
      .prepare(
        "SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name",
      )
      .all() as readonly { readonly name: string }[]
  ).map((row) => row.name);

const assertHealthy = (database: Database.Database): void => {
  expect(
    JSON.stringify(database.pragma("foreign_key_check") as unknown[]),
  ).toBe("[]");
  const integrity = database.pragma("integrity_check") as readonly {
    readonly integrity_check: string;
  }[];
  expect(integrity[0]?.integrity_check).toBe("ok");
};

const seedPreFinalizationStore = (): {
  readonly projectId: string;
  readonly now: string;
} => {
  useTempStore();
  const database = new Database(getDatabasePath());
  database.pragma("foreign_keys = ON");
  createBlockFirstPreFinalizationSchema(database);
  const projectId = randomUUID();
  const now = new Date().toISOString();
  database
    .prepare(
      "INSERT INTO projects (id, name, description, icon, created, updated) VALUES (?, 'Migration', '', '', ?, ?)",
    )
    .run(projectId, now, now);
  database
    .prepare(
      'INSERT INTO project_order (project_id, "order", updated) VALUES (?, 0, ?)',
    )
    .run(projectId, now);
  ensureBlockFoundationForProject(database, projectId, now);
  // The asynchronous Block-first fixed point is specifically the v69→v70
  // edge. Later schema edges have already dropped this legacy fixture shape.
  database.pragma("user_version = 69");
  database.close();
  return { projectId, now };
};

const seedLegacyCardSource = (
  projectId: string,
  now: string,
): string => {
  const cardId = createUuidV7();
  const database = getDb();
  database
    .prepare(
      `
      INSERT INTO cards (
        id, project_id, status, title, description,
        description_preview, description_length, has_description,
        tags, revision, created, "order"
      ) VALUES (?, ?, 'draft', ?, ?, ?, ?, 1, '["migration"]', 1, ?, 0)
    `,
    )
    .run(
      cardId,
      projectId,
      "Migrated title",
      "Migrated body",
      "Migrated body",
      "Migrated body".length,
      now,
    );
  return cardId;
};

afterEach(() => {
  closeDatabase();
  delete process.env.NODEX_DIR;
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("schema v70 Block-first finalization", () => {
  test("upgrades a real pre-v71 schema before installing engine triggers", async () => {
    seedPreFinalizationStore();
    const before = new Database(getDatabasePath());
    expect(
      (before.prepare("PRAGMA table_info(documents)").all() as readonly {
        readonly name: string;
      }[]).some((column) => column.name === "sync_engine"),
    ).toBe(false);
    expect(
      before
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'trigger' AND name = 'document_updates_require_yjs_engine'`,
        )
        .get(),
    ).toBeUndefined();
    before.close();

    await initializeDatabase();
    const after = getDb();
    expect(after.pragma("user_version", { simple: true })).toBe(
      CURRENT_SCHEMA_VERSION,
    );
    expect(
      (after.prepare("PRAGMA table_info(documents)").all() as readonly {
        readonly name: string;
      }[]).some((column) => column.name === "sync_engine"),
    ).toBe(true);
    expect(
      after
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'trigger' AND name = 'document_updates_require_yjs_engine'`,
        )
        .get(),
    ).toEqual({ name: "document_updates_require_yjs_engine" });
  });

  test("repairs an existing Canvas receipt table without result hashes", async () => {
    useTempStore();
    await initializeDatabase();
    closeDatabase();
    const legacy = new Database(getDatabasePath());
    legacy.pragma("foreign_keys = OFF");
    legacy.exec(`
      DROP TRIGGER IF EXISTS canvas_scene_mutation_receipts_immutable_update;
      ALTER TABLE canvas_scene_mutation_receipts
        RENAME TO canvas_scene_mutation_receipts_with_hash;
      CREATE TABLE canvas_scene_mutation_receipts (
        document_id TEXT NOT NULL REFERENCES canvas_scenes(document_id) ON DELETE CASCADE,
        generation INTEGER NOT NULL CHECK (generation >= 1),
        mutation_id TEXT NOT NULL,
        client_session_id TEXT NOT NULL,
        base_head_seq INTEGER NOT NULL CHECK (base_head_seq >= 0),
        committed_head_seq INTEGER NOT NULL CHECK (committed_head_seq >= 0),
        request_hash TEXT NOT NULL,
        request_byte_length INTEGER NOT NULL CHECK (request_byte_length > 0),
        request_json TEXT NOT NULL,
        result_json TEXT NOT NULL,
        outcome TEXT NOT NULL CHECK (outcome IN ('committed', 'no_change')),
        committed_at TEXT NOT NULL,
        PRIMARY KEY (document_id, generation, mutation_id),
        UNIQUE (document_id, mutation_id)
      ) WITHOUT ROWID;
      DROP TABLE canvas_scene_mutation_receipts_with_hash;
    `);
    const canvasDocument = legacy
      .prepare("SELECT document_id FROM canvas_scenes LIMIT 1")
      .get() as { readonly document_id: string };
    const resultJson = '{"outcome":"no_change"}';
    legacy
      .prepare(
        `INSERT INTO canvas_scene_mutation_receipts (
          document_id, generation, mutation_id, client_session_id,
          base_head_seq, committed_head_seq, request_hash,
          request_byte_length, request_json, result_json, outcome, committed_at
         ) VALUES (?, 1, 'legacy-receipt', 'legacy-client', 0, 0, ?, 2,
           '{}', ?, 'no_change', '2026-07-13T00:00:00.000Z')`,
      )
      .run(
        canvasDocument.document_id,
        createHash("sha256").update("{}").digest("hex"),
        resultJson,
      );
    legacy.pragma("foreign_keys = ON");
    legacy.close();

    await initializeDatabase();
    const repaired = getDb();
    expect(
      (repaired
        .prepare("PRAGMA table_info(canvas_scene_mutation_receipts)")
        .all() as readonly { readonly name: string }[]).some(
        (column) => column.name === "result_hash",
      ),
    ).toBe(true);
    expect(
      repaired
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'trigger'
             AND name = 'canvas_scene_mutation_receipts_immutable_update'`,
        )
        .get(),
    ).toEqual({ name: "canvas_scene_mutation_receipts_immutable_update" });
    expect(
      repaired
        .prepare(
          `SELECT result_hash FROM canvas_scene_mutation_receipts
           WHERE mutation_id = 'legacy-receipt'`,
        )
        .get(),
    ).toEqual({
      result_hash: createHash("sha256").update(resultJson).digest("hex"),
    });
    expect(() =>
      repaired
        .prepare(
          `INSERT INTO canvas_scene_mutation_receipts (
            document_id, generation, mutation_id, client_session_id,
            base_head_seq, committed_head_seq, request_hash,
            request_byte_length, request_json, result_json, result_hash,
            outcome, committed_at
           ) VALUES (?, 1, 'invalid-result-hash', 'legacy-client', 0, 0, ?,
             2, '{}', ?, 'bad', 'no_change', '2026-07-13T00:00:00.000Z')`,
        )
        .run(
          canvasDocument.document_id,
          createHash("sha256").update("{}").digest("hex"),
          resultJson,
        ),
    ).toThrow(/result hash is invalid/u);
  });

});

describe("schema v73 exclusive Card parents and stable membership history", () => {
  test("exposes the final migration edge", () => {
    expect(JSON.stringify(getSchemaMigrationTargets(CURRENT_SCHEMA_VERSION))).toBe(
      "[]",
    );
    expect(
      JSON.stringify(getSchemaMigrationTargets(CURRENT_SCHEMA_VERSION - 1)),
    ).toBe(`[${CURRENT_SCHEMA_VERSION}]`);
    expect(
      JSON.stringify(getSchemaMigrationTargets(CURRENT_SCHEMA_VERSION - 2)),
    ).toBe(
      `[${CURRENT_SCHEMA_VERSION - 1},${CURRENT_SCHEMA_VERSION}]`,
    );
    expect(getSchemaMigrationTargets(CURRENT_SCHEMA_VERSION + 1)).toBe(null);
  });

  test("creates a healthy canonical fresh store without compatibility tables", async () => {
    useTempStore();
    await initializeDatabase();
    const database = getDb();
    expect(
      database.pragma("user_version", { simple: true }) as number,
    ).toBe(CURRENT_SCHEMA_VERSION);
    const names = new Set(tableNames(database));
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
      "database_memberships",
      "database_views",
      "card_read_model",
      "retired_block_identities",
    ]) {
      expect(names.has(tableName)).toBe(true);
    }
    for (const tableName of LEGACY_BLOCK_FIRST_TABLES_IN_DROP_ORDER) {
      expect(names.has(tableName)).toBe(false);
    }
    assertHealthy(database);
  });

  test("migrates v73 Card title projections to rich schema without changing Yjs authority", async () => {
    useTempStore();
    await initializeDatabase();
    const database = getDb();
    const project = database
      .prepare("SELECT id FROM projects ORDER BY id LIMIT 1")
      .get() as { readonly id: string };
    const card = await createCard(project.id, "backlog", {
      title: "Migration title",
    });
    const before = database
      .prepare(
        `SELECT document.id, document.generation, document.head_seq,
                hex(document.state_vector) AS state_vector,
                document.state_hash
         FROM documents document
         JOIN block_documents ownership ON ownership.document_id = document.id
         WHERE ownership.block_id = ?`,
      )
      .get(card.id) as {
      readonly id: string;
      readonly generation: number;
      readonly head_seq: number;
      readonly state_vector: string;
      readonly state_hash: string;
    };
    closeDatabase();

    const legacy = new Database(getDatabasePath());
    legacy.pragma("foreign_keys = OFF");
    legacy.exec(`
      ALTER TABLE document_materializations
      RENAME TO document_materializations_v74;
      CREATE TABLE document_materializations (
        document_id TEXT PRIMARY KEY,
        generation INTEGER NOT NULL,
        projected_seq INTEGER NOT NULL,
        schema_version INTEGER NOT NULL,
        title TEXT NOT NULL,
        nfm TEXT NOT NULL,
        plain_text TEXT NOT NULL,
        preview TEXT NOT NULL,
        block_tree_json TEXT NOT NULL,
        references_json TEXT NOT NULL,
        asset_refs_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) WITHOUT ROWID;
      INSERT INTO document_materializations
      SELECT document_id, generation, projected_seq, 1, title, nfm,
             plain_text, preview, block_tree_json, references_json,
             asset_refs_json, updated_at
      FROM document_materializations_v74;
      DROP TABLE document_materializations_v74;
      UPDATE documents
      SET schema_version = 1
      WHERE schema_key = 'nodex.card';
      PRAGMA user_version = 73;
    `);
    legacy.close();

    await initializeDatabase();
    const migrated = getDb();
    const after = migrated
      .prepare(
        `SELECT document.id, document.generation, document.head_seq,
                document.schema_version,
                hex(document.state_vector) AS state_vector,
                document.state_hash,
                materialization.title_rich_json,
                materialization.title_rich_hash
         FROM documents document
         JOIN document_materializations materialization
           ON materialization.document_id = document.id
         WHERE document.id = ?`,
      )
      .get(before.id) as typeof before & {
      readonly schema_version: number;
      readonly title_rich_json: string;
      readonly title_rich_hash: string;
    };

    expect(migrated.pragma("user_version", { simple: true })).toBe(74);
    expect(after.schema_version).toBe(2);
    expect({
      generation: after.generation,
      head_seq: after.head_seq,
      state_vector: after.state_vector,
      state_hash: after.state_hash,
    }).toEqual({
      generation: before.generation,
      head_seq: before.head_seq,
      state_vector: before.state_vector,
      state_hash: before.state_hash,
    });
    expect(JSON.parse(after.title_rich_json)).toEqual([
      { type: "text", text: "Migration title", styles: {} },
    ]);
    expect(after.title_rich_hash).toMatch(/^[a-f0-9]{64}$/u);
    assertHealthy(migrated);
  });

  test("migrates a v71 Database Card from dual placement to one Database parent", async () => {
    useTempStore();
    await initializeDatabase();
    const database = getDb();
    const project = database
      .prepare("SELECT id FROM projects ORDER BY id LIMIT 1")
      .get() as { readonly id: string };
    const primary = database
      .prepare(
        "SELECT block_id FROM database_capabilities WHERE project_id = ? AND is_primary = 1",
      )
      .get(project.id) as { readonly block_id: string };
    const now = new Date().toISOString();
    const cardId = createUuidV7();
    database
      .prepare(
        `
        INSERT INTO blocks (
          id, project_id, type, lifecycle, location_kind,
          containing_document_id, containing_database_id,
          location_revision, metadata_revision, created_at, updated_at
        ) VALUES (?, ?, 'card', 'active', 'database', NULL, ?, 7, 3, ?, ?)
      `,
      )
      .run(cardId, project.id, primary.block_id, now, now);
    database
      .prepare(
        `
        INSERT INTO database_memberships (
          id, database_block_id, card_block_id, project_id,
          revision, created_at, removed_at
        ) VALUES (?, ?, ?, ?, 4, ?, NULL)
      `,
      )
      .run(`membership:${cardId}`, primary.block_id, cardId, project.id, now);

    const retainedTriggers = database
      .prepare(
        `
        SELECT name, sql
        FROM sqlite_schema
        WHERE type = 'trigger' AND tbl_name = 'blocks'
          AND name NOT IN (
            'blocks_non_space_location_has_no_top_level_placement',
            'blocks_active_membership_requires_database_location'
          )
        ORDER BY name
      `,
      )
      .all() as readonly { readonly name: string; readonly sql: string }[];
    database.pragma("foreign_keys = OFF");
    database.pragma("legacy_alter_table = ON");
    database.transaction(() => {
      database.exec(`
        DROP TABLE card_read_model;
        ALTER TABLE blocks RENAME TO blocks_v71_fixture;
        CREATE TABLE blocks (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          type TEXT NOT NULL,
          lifecycle TEXT NOT NULL DEFAULT 'active',
          location_kind TEXT NOT NULL,
          containing_document_id TEXT,
          location_revision INTEGER NOT NULL DEFAULT 1 CHECK (location_revision >= 1),
          metadata_revision INTEGER NOT NULL DEFAULT 1 CHECK (metadata_revision >= 1),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (id, project_id),
          FOREIGN KEY (containing_document_id, project_id)
            REFERENCES documents(id, project_id) ON DELETE RESTRICT,
          CHECK (lifecycle IN ('active', 'archived', 'deleted')),
          CHECK (
            (location_kind = 'space' AND containing_document_id IS NULL)
            OR (location_kind = 'document' AND containing_document_id IS NOT NULL)
          )
        );
        INSERT INTO blocks (
          id, project_id, type, lifecycle, location_kind,
          containing_document_id, location_revision, metadata_revision,
          created_at, updated_at
        )
        SELECT
          id, project_id, type, lifecycle,
          CASE WHEN id = '${cardId}' THEN 'space' ELSE location_kind END,
          CASE WHEN id = '${cardId}' THEN NULL ELSE containing_document_id END,
          location_revision, metadata_revision, created_at, updated_at
        FROM blocks_v71_fixture;
        DROP TABLE blocks_v71_fixture;
        CREATE INDEX idx_blocks_project_lifecycle_type
          ON blocks(project_id, lifecycle, type);
        CREATE INDEX idx_blocks_containing_document
          ON blocks(containing_document_id, lifecycle);
      `);
      for (const trigger of retainedTriggers) database.exec(trigger.sql);
      database
        .prepare(
          `
          INSERT INTO top_level_block_placements (
            block_id, project_id, rank_key, created_at, updated_at
          ) VALUES (?, ?, 'legacy-rank', ?, ?)
        `,
        )
        .run(cardId, project.id, now, now);
      database.pragma("user_version = 71");
    }).immediate();
    database.pragma("legacy_alter_table = OFF");
    database.pragma("foreign_keys = ON");
    closeDatabase();

    await initializeDatabase();
    const migrated = getDb();
    const block = migrated
      .prepare(
        `
        SELECT location_kind, containing_document_id, containing_database_id,
          location_revision
        FROM blocks WHERE id = ?
      `,
      )
      .get(cardId) as {
      readonly location_kind: string;
      readonly containing_document_id: string | null;
      readonly containing_database_id: string | null;
      readonly location_revision: number;
    };
    expect(block).toEqual({
      location_kind: "database",
      containing_document_id: null,
      containing_database_id: primary.block_id,
      location_revision: 8,
    });
    expect(
      migrated
        .prepare(
          "SELECT 1 FROM top_level_block_placements WHERE block_id = ?",
        )
        .get(cardId),
    ).toBeUndefined();
    expect(migrated.pragma("user_version", { simple: true })).toBe(
      CURRENT_SCHEMA_VERSION,
    );
    expect(() =>
      migrated
        .prepare(
          `
          INSERT INTO database_memberships (
            id, database_block_id, card_block_id, project_id,
            revision, created_at, removed_at
          ) VALUES ('duplicate-history', ?, ?, ?, 1, ?, ?)
        `,
        )
        .run(
          primary.block_id,
          cardId,
          project.id,
          now,
          now,
        ),
    ).toThrow();
    assertHealthy(migrated);
  });

  test("never permits a physically retired Block identity to name new content", async () => {
    useTempStore();
    await initializeDatabase();
    const database = getDb();
    const project = database
      .prepare("SELECT id FROM projects ORDER BY created, id LIMIT 1")
      .get() as { readonly id: string };
    const retiredId = "retired:block:1";
    database
      .prepare(
        `
        INSERT INTO retired_block_identities (
          block_id, project_id, block_type, retention_root_block_id, retired_at
        ) VALUES (?, ?, 'paragraph', ?, ?)
      `,
      )
      .run(retiredId, project.id, retiredId, new Date().toISOString());

    expect(() =>
      database
        .prepare(
          `
          INSERT INTO blocks (
            id, project_id, type, lifecycle, location_kind,
            containing_document_id, location_revision, metadata_revision,
            created_at, updated_at
          ) VALUES (?, ?, 'card', 'active', 'space', NULL, 1, 1, ?, ?)
        `,
        )
        .run(
          retiredId,
          project.id,
          new Date().toISOString(),
          new Date().toISOString(),
        ),
    ).toThrow("retired Block identity cannot be reused");
    expect(() =>
      database
        .prepare(
          "DELETE FROM retired_block_identities WHERE block_id = ?",
        )
        .run(retiredId),
    ).toThrow("retired Block identity evidence is immutable");

    const liveId = "live:block:cannot-be-renamed";
    const now = new Date().toISOString();
    database
      .prepare(
        `
        INSERT INTO blocks (
          id, project_id, type, lifecycle, location_kind,
          containing_document_id, location_revision, metadata_revision,
          created_at, updated_at
        ) VALUES (?, ?, 'paragraph', 'active', 'space', NULL, 1, 1, ?, ?)
      `,
      )
      .run(liveId, project.id, now, now);
    expect(() =>
      database
        .prepare("UPDATE blocks SET id = ? WHERE id = ?")
        .run(retiredId, liveId),
    ).toThrow("Block identity is immutable");
    expect(
      database.prepare("SELECT id FROM blocks WHERE id = ?").get(liveId) !==
        undefined,
    ).toBe(true);
  });

  test("repairs the unreleased v70 retired-identity invariant idempotently", async () => {
    useTempStore();
    await initializeDatabase();
    getDb().exec("DROP TABLE retired_block_identities");
    closeDatabase();

    await initializeDatabase();

    expect(new Set(tableNames(getDb())).has("retired_block_identities")).toBe(
      true,
    );
    expect(
      getDb().pragma("user_version", { simple: true }) as number,
    ).toBe(CURRENT_SCHEMA_VERSION);
  });

  test("drains one real legacy Card and drops migration storage atomically", async () => {
    const { projectId, now } = seedPreFinalizationStore();
    const cardId = seedLegacyCardSource(projectId, now);
    closeDatabase();

    await initializeDatabase();

    const database = getDb();
    const card = await getCard(projectId, cardId);
    expect(card?.title).toBe("Migrated title");
    expect(card?.description).toBe("Migrated body");
    const document = database
      .prepare(
        "SELECT readiness, authority FROM documents WHERE id = ?",
      )
      .get(`document:${cardId}`) as {
      readonly readiness: string;
      readonly authority: string;
    };
    expect(document.readiness).toBe("ready");
    expect(document.authority).toBe("ydoc_primary");
    const names = new Set(tableNames(database));
    for (const tableName of LEGACY_BLOCK_FIRST_TABLES_IN_DROP_ORDER) {
      expect(names.has(tableName)).toBe(false);
    }
    expect(
      database.pragma("user_version", { simple: true }) as number,
    ).toBe(CURRENT_SCHEMA_VERSION);
    assertHealthy(database);
  });

  test("migrates expanded legacy toggles as window-local disclosure state", async () => {
    const { projectId, now } = seedPreFinalizationStore();
    const cardId = seedLegacyCardSource(projectId, now);
    const legacyNfm = [
      '<card-toggle card="legacy-child" meta="[Draft]" project="default">',
      "\tLegacy child",
      "\t▼ Expanded nested toggle",
      "\t\tNested body",
      "</card-toggle>",
      "▼# Expanded heading",
      "\tHeading body",
    ].join("\n");
    getDb()
      .prepare(
        `
        UPDATE cards
        SET description = ?, description_preview = ?, description_length = ?,
            has_description = 1, revision = revision + 1
        WHERE id = ?
      `,
      )
      .run(legacyNfm, "Legacy child Nested body", legacyNfm.length, cardId);
    getDb()
      .prepare(
        `
        UPDATE legacy_card_shadow_jobs
        SET status = 'failed',
            last_error = ?, completed_at = updated_at
        WHERE card_id = ?
          AND source_event_seq = (
            SELECT MAX(source_event_seq)
            FROM legacy_card_shadow_jobs
            WHERE card_id = ?
          )
      `,
      )
      .run(
        `LegacyCardShadowProcessorError: Document for Card ${cardId} failed normalized title/NFM parity`,
        cardId,
        cardId,
      );
    closeDatabase();

    await initializeDatabase();

    const card = await getCard(projectId, cardId);
    expect(card?.description).toContain("▶# Expanded heading");
    expect(card?.description).not.toContain("▼");
    const recoveredCardId = card?.description.match(
      /<card-ref target-block="([^"]+)"/,
    )?.[1];
    expect(recoveredCardId).toBeTypeOf("string");
    const recoveredCard = await getCard(projectId, recoveredCardId ?? "");
    expect(recoveredCard?.description).toContain("▶ Expanded nested toggle");
    expect(recoveredCard?.description).not.toContain("▼");
    expect(
      getDb().pragma("user_version", { simple: true }) as number,
    ).toBe(CURRENT_SCHEMA_VERSION);
    assertHealthy(getDb());
  });

  test("recovers orphan foreign bodies and inline Views before removing v69 storage", async () => {
    const { projectId, now } = seedPreFinalizationStore();
    const hostCardId = seedLegacyCardSource(projectId, now);
    const legacyNfm = [
      `<card-toggle card="missing-card" meta="[P1]" project="${projectId}" status="in_progress">`,
      "\tRecovered title",
      "\tRecovered body",
      `\t<card-ref project="${projectId}" card="nested-missing" />`,
      "</card-toggle>",
      `<toggle-list-inline-view project="${projectId}" rules-v2="eyJtb2RlIjoiYWxsIn0" property-order="priority,estimate,status,tags" show-empty-estimate="false" show-empty-priority="false" />`,
    ].join("\n");
    getDb()
      .prepare(
        `
        UPDATE cards
        SET description = ?, description_preview = ?, description_length = ?,
            has_description = 1, revision = revision + 1
        WHERE id = ?
      `,
      )
      .run(legacyNfm, "Recovered title Recovered body", legacyNfm.length, hostCardId);
    closeDatabase();

    await initializeDatabase();

    const database = getDb();
    const hostMaterialization = database
      .prepare(
        `
        SELECT nfm, references_json
        FROM document_materializations
        WHERE document_id = ?
      `,
      )
      .get(`document:${hostCardId}`) as {
      readonly nfm: string;
      readonly references_json: string;
    };
    const references = JSON.parse(hostMaterialization.references_json) as Array<{
      readonly kind: string;
      readonly targetBlockId?: string;
      readonly databaseViewId?: string;
    }>;
    const recoveredReference = references.find(
      (reference) =>
        reference.kind === "block" &&
        typeof reference.targetBlockId === "string",
    );
    const databaseViewReference = references.find(
      (reference) =>
        reference.kind === "database_view" &&
        typeof reference.databaseViewId === "string",
    );
    expect(recoveredReference?.targetBlockId === undefined).toBe(false);
    expect(databaseViewReference?.databaseViewId === undefined).toBe(false);
    expect(hostMaterialization.nfm.includes("<card-toggle")).toBe(false);
    expect(hostMaterialization.nfm.includes("<toggle-list-inline-view")).toBe(false);

    const recoveredCard = await getCard(
      projectId,
      recoveredReference?.targetBlockId ?? "",
    );
    expect(recoveredCard?.title).toBe("Recovered title");
    expect(recoveredCard?.description.includes("Recovered body") ?? false).toBe(true);
    const recoveredMaterialization = database
      .prepare(
        `
        SELECT nfm, references_json
        FROM document_materializations
        WHERE document_id = ?
      `,
      )
      .get(`document:${recoveredReference?.targetBlockId}`) as {
      readonly nfm: string;
      readonly references_json: string;
    };
    expect(recoveredMaterialization.nfm.includes('project="')).toBe(false);
    expect(
      recoveredMaterialization.references_json.includes("legacy_"),
    ).toBe(false);
    const durableView = database
      .prepare(
        `
        SELECT lifecycle, config_json
        FROM database_views
        WHERE id = ? AND project_id = ?
      `,
      )
      .get(databaseViewReference?.databaseViewId, projectId) as
      | { readonly lifecycle: string; readonly config_json: string }
      | undefined;
    expect(durableView?.lifecycle).toBe("active");
    expect(
      parseGeneralDatabaseViewConfig(
        JSON.parse(durableView?.config_json ?? "null") as unknown,
      ).schemaKey,
    ).toBe("nodex.database-view");
    const names = new Set(tableNames(database));
    for (const tableName of LEGACY_BLOCK_FIRST_TABLES_IN_DROP_ORDER) {
      expect(names.has(tableName)).toBe(false);
    }
    assertHealthy(database);
  });

  test("fails closed before table removal when legacy parity is terminally broken", async () => {
    const { projectId, now } = seedPreFinalizationStore();
    const cardId = seedLegacyCardSource(projectId, now);
    getDb()
      .prepare(
        `
        UPDATE legacy_card_shadow_jobs
        SET status = 'failed', last_error = 'fixture parity failure',
            completed_at = updated_at
        WHERE card_id = ?
      `,
      )
      .run(cardId);
    closeDatabase();

    let message = "";
    try {
      await initializeDatabase();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message.includes("could not reach Y.Doc parity")).toBe(true);
    const database = getDb();
    expect(
      database.pragma("user_version", { simple: true }) as number,
    ).toBe(69);
    const names = new Set(tableNames(database));
    expect(names.has("cards")).toBe(true);
    expect(names.has("legacy_card_shadow_jobs")).toBe(true);
    assertHealthy(database);
  });
});
