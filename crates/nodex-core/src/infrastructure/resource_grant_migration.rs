//! Store-v118 support for Canvas roots in the generic Project resource-grant graph.
//!
//! Before v118, a Project in a Library could implicitly open every top-level
//! Canvas in that Library. The migration materializes that effective access as
//! ordinary grants, then closes the implicit authorization path. Embedded
//! Canvases remain authorized through their owning Page and receive no direct
//! grants.

use rusqlite::{Connection, OptionalExtension, params};
use sha2::{Digest, Sha256};

use super::sqlite::{StoreError, StoreErrorCode};

const V118_GRANT_TABLE_SQL: &str = r#"
CREATE TABLE project_resource_grants_v118 (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE RESTRICT,
  root_kind TEXT NOT NULL,
  root_id TEXT NOT NULL,
  access TEXT NOT NULL,
  recursive INTEGER NOT NULL DEFAULT 1 CHECK (recursive = 1),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
  lifecycle TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (project_id, root_kind, root_id),
  CHECK (root_kind IN ('page', 'database', 'canvas')),
  CHECK (access IN ('read', 'read_write')),
  CHECK (lifecycle IN ('active', 'revoked'))
) WITHOUT ROWID, STRICT;

INSERT INTO project_resource_grants_v118(
  id, project_id, library_id, root_kind, root_id, access, recursive,
  revision, lifecycle, created_at, updated_at
)
SELECT id, project_id, library_id, root_kind, root_id, access, recursive,
       revision, lifecycle, created_at, updated_at
FROM project_resource_grants;

DROP TABLE project_resource_grants;
ALTER TABLE project_resource_grants_v118 RENAME TO project_resource_grants;
"#;

const V118_GRANT_INDEXES_AND_TRIGGERS_SQL: &str = r#"
CREATE INDEX idx_project_resource_grants_active
  ON project_resource_grants(project_id, lifecycle, root_kind, root_id);

CREATE TRIGGER project_resource_grants_validate_active_root_insert
BEFORE INSERT ON project_resource_grants
WHEN NEW.lifecycle = 'active' AND (
  NOT EXISTS (
    SELECT 1 FROM projects project
    WHERE project.id = NEW.project_id AND project.library_id = NEW.library_id
  ) OR NOT EXISTS (
    SELECT 1 FROM blocks block
    WHERE block.id = NEW.root_id AND block.library_id = NEW.library_id
      AND block.type = NEW.root_kind
  ) OR (
    NEW.root_kind = 'canvas' AND EXISTS (
      SELECT 1 FROM blocks block
      WHERE block.id = NEW.root_id AND block.lifecycle <> 'deleted'
    ) AND (
      NOT EXISTS (
        SELECT 1 FROM library_block_placements placement
        WHERE placement.block_id = NEW.root_id AND placement.library_id = NEW.library_id
      ) OR EXISTS (
        SELECT 1 FROM document_block_index containing
        WHERE containing.block_id = NEW.root_id
      )
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'Active Project resource grant requires a matching Library root');
END;

CREATE TRIGGER project_resource_grants_validate_active_root_update
BEFORE UPDATE OF project_id, library_id, root_kind, root_id, lifecycle
ON project_resource_grants
WHEN NEW.lifecycle = 'active' AND (
  NOT EXISTS (
    SELECT 1 FROM projects project
    WHERE project.id = NEW.project_id AND project.library_id = NEW.library_id
  ) OR NOT EXISTS (
    SELECT 1 FROM blocks block
    WHERE block.id = NEW.root_id AND block.library_id = NEW.library_id
      AND block.type = NEW.root_kind
  ) OR (
    NEW.root_kind = 'canvas' AND EXISTS (
      SELECT 1 FROM blocks block
      WHERE block.id = NEW.root_id AND block.lifecycle <> 'deleted'
    ) AND (
      NOT EXISTS (
        SELECT 1 FROM library_block_placements placement
        WHERE placement.block_id = NEW.root_id AND placement.library_id = NEW.library_id
      ) OR EXISTS (
        SELECT 1 FROM document_block_index containing
        WHERE containing.block_id = NEW.root_id
      )
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'Active Project resource grant requires a matching Library root');
END;
"#;

#[derive(Debug)]
struct LegacyCanvasAccess {
    project_id: String,
    library_id: String,
    canvas_id: String,
    created_at: String,
}

pub(super) fn ensure_v118_canvas_resource_grants(
    connection: &Connection,
) -> Result<(), StoreError> {
    let table_sql = connection
        .query_row(
            "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'project_resource_grants'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or_else(|| corrupt("Project resource-grant authority is unavailable"))?;
    if table_sql.contains("'canvas'") {
        return validate_v118_canvas_resource_grants(connection);
    }

    super::visibility_delta_journal::with_maintenance_context(connection, |connection| {
        let legacy_access = legacy_top_level_canvas_access(connection)?;
        connection.execute_batch(V118_GRANT_TABLE_SQL)?;
        materialize_legacy_canvas_access(connection, &legacy_access)?;
        connection.execute_batch(V118_GRANT_INDEXES_AND_TRIGGERS_SQL)?;
        super::visibility_delta_journal::refresh_authority_relation_triggers(
            connection,
            &["project_resource_grants"],
        )?;
        validate_v118_canvas_resource_grants(connection)
    })
}

fn legacy_top_level_canvas_access(
    connection: &Connection,
) -> Result<Vec<LegacyCanvasAccess>, StoreError> {
    connection
        .prepare(
            "SELECT project.id, project.library_id, canvas.block_id, block.created_at \
             FROM projects project \
             JOIN canvas_owners canvas ON canvas.library_id = project.library_id \
             JOIN blocks block ON block.id = canvas.block_id \
               AND block.library_id = canvas.library_id \
             JOIN library_block_placements placement ON placement.block_id = block.id \
               AND placement.library_id = block.library_id \
             LEFT JOIN document_block_index containing ON containing.block_id = block.id \
             WHERE project.lifecycle = 'active' AND block.lifecycle <> 'deleted' \
               AND block.type = 'canvas' AND containing.block_id IS NULL \
             ORDER BY project.id, canvas.block_id",
        )?
        .query_map([], |row| {
            Ok(LegacyCanvasAccess {
                project_id: row.get(0)?,
                library_id: row.get(1)?,
                canvas_id: row.get(2)?,
                created_at: row.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(StoreError::from)
}

fn materialize_legacy_canvas_access(
    connection: &Connection,
    access_rows: &[LegacyCanvasAccess],
) -> Result<(), StoreError> {
    for access in access_rows {
        let grant_id = stable_grant_id(&access.project_id, "canvas", &access.canvas_id);
        connection.execute(
            "INSERT INTO project_resource_grants( \
               id, project_id, library_id, root_kind, root_id, access, recursive, revision, \
               lifecycle, created_at, updated_at \
             ) VALUES (?1, ?2, ?3, 'canvas', ?4, 'read_write', 1, 1, 'active', ?5, ?5)",
            params![
                grant_id,
                access.project_id,
                access.library_id,
                access.canvas_id,
                access.created_at,
            ],
        )?;
    }
    Ok(())
}

fn stable_grant_id(project_id: &str, root_kind: &str, root_id: &str) -> String {
    let encoded = serde_json::to_vec(&[project_id, root_kind, root_id])
        .expect("grant identity is always serializable");
    format!("grant:{:x}", Sha256::digest(encoded))
}

pub(super) fn validate_v118_canvas_resource_grants(
    connection: &Connection,
) -> Result<(), StoreError> {
    let table_sql = connection
        .query_row(
            "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'project_resource_grants'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or_else(|| corrupt("Project resource-grant authority is unavailable"))?;
    if !table_sql.contains("'canvas'") {
        return Err(corrupt(
            "Project resource-grant authority does not support Canvas roots",
        ));
    }

    let invalid_active_grants = connection.query_row(
        "SELECT count(*) FROM project_resource_grants grant_row \
         LEFT JOIN projects project ON project.id = grant_row.project_id \
         LEFT JOIN blocks block ON block.id = grant_row.root_id \
         WHERE grant_row.lifecycle = 'active' AND ( \
           project.id IS NULL OR project.library_id <> grant_row.library_id \
           OR block.id IS NULL OR block.library_id <> grant_row.library_id \
           OR block.type <> grant_row.root_kind \
           OR (grant_row.root_kind = 'canvas' AND block.lifecycle <> 'deleted' AND ( \
             NOT EXISTS(SELECT 1 FROM library_block_placements placement \
               WHERE placement.block_id = grant_row.root_id \
                 AND placement.library_id = grant_row.library_id) \
             OR EXISTS(SELECT 1 FROM document_block_index containing \
               WHERE containing.block_id = grant_row.root_id) \
           )) \
         )",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    if invalid_active_grants != 0 {
        return Err(corrupt(format!(
            "{invalid_active_grants} active Project resource grants do not match a Library root"
        )));
    }
    Ok(())
}

fn corrupt(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message, false)
}
