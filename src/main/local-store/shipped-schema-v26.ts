import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { summarizePageDescription } from "../../shared/page-summary";
import { makeProjectSessionPanelLayout } from "../../shared/project-session-panel-layout";
import { ProjectSessionPanelsSchema } from "../../shared/schemas/project-sessions";
import { insertInitialDatabaseViewSession } from "./project-session-defaults";
import { createBlockFirstPreFinalizationSchema } from "./schema";

interface LegacyProjectRow {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly icon: string;
  readonly workspace_path: string | null;
  readonly created: string;
}

interface LegacyThreadRow {
  readonly thread_id: string;
  readonly project_id: string;
  readonly linked_at: string;
  readonly thread_name: string | null;
  readonly thread_preview: string;
  readonly card_title: string | null;
}

const tableHasColumn = (
  database: Database.Database,
  tableName: string,
  columnName: string,
): boolean =>
  (
    database.prepare(`PRAGMA table_info(${tableName})`).all() as readonly {
      readonly name: string;
    }[]
  ).some((column) => column.name === columnName);

const normalizeSourceRoot = (value: string | null): string | null => {
  const trimmed = value?.trim();
  return trimmed ? path.resolve(trimmed) : null;
};

const sourceRootKey = (root: string): string => {
  const resolved = path.resolve(root);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
};

const firstPreviewLine = (value: string): string =>
  value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? "";

const importedThreadTitle = (thread: LegacyThreadRow): string =>
  thread.thread_name?.trim() ||
  firstPreviewLine(thread.thread_preview) ||
  thread.card_title?.trim() ||
  "Imported chat";

const emptyThreadPanelStateJson = (): string =>
  JSON.stringify(
    ProjectSessionPanelsSchema.parse({
      right: {
        collapsed: true,
        layout: makeProjectSessionPanelLayout([], null),
        size: { widthPx: 600, fullWidth: false },
      },
      bottom: {
        collapsed: true,
        layout: makeProjectSessionPanelLayout([], null),
        size: { heightPx: 280 },
      },
    }),
  );

const importLegacyThreads = (database: Database.Database): void => {
  database.exec(`
    INSERT OR IGNORE INTO codex_threads (
      thread_id, project_id, parent_thread_id, thread_name, thread_preview,
      model_provider, cwd, status_type, status_active_flags_json, archived,
      created_at, updated_at, linked_at
    )
    SELECT
      thread_id, project_id, parent_thread_id, thread_name, thread_preview,
      model_provider, cwd, status_type, status_active_flags_json, archived,
      created_at, updated_at, linked_at
    FROM codex_card_threads;
  `);

  const threads = database
    .prepare(
      `SELECT thread.thread_id,
              thread.project_id,
              thread.linked_at,
              thread.thread_name,
              thread.thread_preview,
              card.title AS card_title
       FROM codex_card_threads thread
       LEFT JOIN cards card ON card.id = thread.card_id
       ORDER BY thread.project_id, thread.created_at, thread.thread_id`,
    )
    .all() as readonly LegacyThreadRow[];
  const nextOrderByProject = new Map<string, number>();
  const insertSession = database.prepare(
    `INSERT INTO project_sessions (
       id, project_id, no_thread_fallback_title, "order", pinned,
       pinned_order, archived, archived_at, unread, left_pane_collapsed,
       panel_state_json, created_at, updated_at
     ) VALUES (?, ?, ?, ?, 0, NULL, 0, NULL, 0, 0, ?, ?, ?)`,
  );
  const insertThread = database.prepare(
    `INSERT INTO project_session_threads (session_id, thread_id, linked_at)
     VALUES (?, ?, ?)`,
  );
  for (const thread of threads) {
    const order = nextOrderByProject.get(thread.project_id) ?? 0;
    nextOrderByProject.set(thread.project_id, order + 1);
    const sessionId = randomUUID();
    insertSession.run(
      sessionId,
      thread.project_id,
      importedThreadTitle(thread),
      order,
      emptyThreadPanelStateJson(),
      thread.linked_at,
      thread.linked_at,
    );
    insertThread.run(sessionId, thread.thread_id, thread.linked_at);
  }
  database.exec("DROP TABLE codex_card_threads");
};

const remapLegacyProjects = (database: Database.Database): void => {
  const projects = database
    .prepare(
      `SELECT id, name, description, icon, workspace_path, created
       FROM projects
       ORDER BY created, id`,
    )
    .all() as readonly LegacyProjectRow[];
  const projectIds = new Map(
    projects.map((project) => [project.id, randomUUID()] as const),
  );

  database.exec(`
    DROP TABLE IF EXISTS projects_import_target;
    DROP TABLE project_sources;
    DROP TABLE project_order;

    CREATE TABLE projects_import_target (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      icon TEXT NOT NULL DEFAULT '',
      created TEXT NOT NULL,
      updated TEXT NOT NULL
    );

    CREATE TABLE project_sources (
      project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      root TEXT NOT NULL,
      root_key TEXT NOT NULL,
      "order" INTEGER NOT NULL,
      created TEXT NOT NULL,
      updated TEXT NOT NULL,
      PRIMARY KEY (project_id, root_key)
    );

    CREATE TABLE project_order (
      project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
      "order" INTEGER NOT NULL,
      updated TEXT NOT NULL
    );
  `);

  const insertProject = database.prepare(
    `INSERT INTO projects_import_target
       (id, name, description, icon, created, updated)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const insertSource = database.prepare(
    `INSERT INTO project_sources
       (project_id, root, root_key, "order", created, updated)
     VALUES (?, ?, ?, 0, ?, ?)`,
  );
  const insertOrder = database.prepare(
    `INSERT INTO project_order (project_id, "order", updated)
     VALUES (?, ?, ?)`,
  );
  projects.forEach((project, order) => {
    const nextProjectId = projectIds.get(project.id);
    if (!nextProjectId) {
      throw new Error(`Missing remapped Project identity for ${project.id}`);
    }
    insertProject.run(
      nextProjectId,
      project.name,
      project.description,
      project.icon,
      project.created,
      project.created,
    );
    insertOrder.run(nextProjectId, order, project.created);
    const root = normalizeSourceRoot(project.workspace_path);
    if (root) {
      insertSource.run(
        nextProjectId,
        root,
        sourceRootKey(root),
        project.created,
        project.created,
      );
    }
  });

  const projectScopedTables = [
    "cards",
    "history",
    "canvas",
    "recurrence_exceptions",
    "reminder_receipts",
    "reminder_snoozes",
    "codex_threads",
    "project_sessions",
  ].filter((tableName) => tableHasColumn(database, tableName, "project_id"));
  for (const [legacyProjectId, nextProjectId] of projectIds) {
    for (const tableName of projectScopedTables) {
      database
        .prepare(
          `UPDATE ${tableName} SET project_id = ? WHERE project_id = ?`,
        )
        .run(nextProjectId, legacyProjectId);
    }
  }

  database.exec(`
    DROP TABLE projects;
    ALTER TABLE projects_import_target RENAME TO projects;
    CREATE INDEX idx_project_sources_project_order
      ON project_sources(project_id, "order", created);
  `);
};

const backfillLegacyCardReadColumns = (
  database: Database.Database,
): void => {
  for (const [columnName, definition] of [
    ["description_preview", "TEXT NOT NULL DEFAULT ''"],
    ["description_length", "INTEGER NOT NULL DEFAULT 0"],
    ["has_description", "INTEGER NOT NULL DEFAULT 0"],
    ["description_read_model_revision", "INTEGER NOT NULL DEFAULT 0"],
  ] as const) {
    if (tableHasColumn(database, "cards", columnName)) continue;
    database.exec(`ALTER TABLE cards ADD COLUMN ${columnName} ${definition}`);
  }

  const rows = database
    .prepare("SELECT id, description, revision FROM cards ORDER BY id")
    .all() as readonly {
    readonly id: string;
    readonly description: string;
    readonly revision: number;
  }[];
  const update = database.prepare(
    `UPDATE cards
     SET description_preview = ?, description_length = ?,
         has_description = ?, description_read_model_revision = ?
     WHERE id = ?`,
  );
  for (const row of rows) {
    const summary = summarizePageDescription(row.description);
    update.run(
      summary.descriptionPreview,
      summary.descriptionLength,
      summary.hasDescription ? 1 : 0,
      row.revision,
      row.id,
    );
  }
};

const seedDatabaseViewSessions = (database: Database.Database): void => {
  const projects = database
    .prepare("SELECT id, created FROM projects ORDER BY created, id")
    .all() as readonly {
    readonly id: string;
    readonly created: string;
  }[];
  for (const project of projects) {
    insertInitialDatabaseViewSession(database, project.id, project.created);
  }
};

/** Normalize only a staging copy; the shipped v26 source remains untouched. */
export const normalizeShippedV26Import = (
  database: Database.Database,
): void => {
  const sourceVersion = database.pragma("user_version", {
    simple: true,
  }) as number;
  if (sourceVersion !== 26) {
    throw new Error(
      `The shipped v26 normalizer requires v26, received v${sourceVersion}`,
    );
  }

  database.pragma("foreign_keys = OFF");
  try {
    const normalize = database.transaction(() => {
      createBlockFirstPreFinalizationSchema(database);
      importLegacyThreads(database);
      remapLegacyProjects(database);
      backfillLegacyCardReadColumns(database);
      seedDatabaseViewSessions(database);
      database.exec("DROP TABLE IF EXISTS codex_thread_snapshots");
    });
    normalize.immediate();
  } finally {
    database.pragma("foreign_keys = ON");
  }

  const retainedVersion = database.pragma("user_version", {
    simple: true,
  }) as number;
  if (retainedVersion === 26) return;
  throw new Error(
    `The shipped v26 normalizer changed user_version to ${retainedVersion}`,
  );
};
