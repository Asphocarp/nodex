use std::path::Path;

use rusqlite::{Connection, OptionalExtension, params};

use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};

use super::canvas::ensure_canvas_scene;
use super::canvas_scene::{CANVAS_OWNER_TYPE, CANVAS_SCHEMA_KEY, CANVAS_SCHEMA_VERSION};
use super::persistence::read_document_authority;

const PRIMARY_CANVAS_RANK_KEY: &str = "e0000000000000000000000000000000";

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct PrimaryCanvasIdentity {
    pub(crate) block_id: String,
    pub(crate) document_id: String,
}

pub(crate) fn create_primary_canvas(
    connection: &Connection,
    project_id: &str,
    now: &str,
    assets_root: &Path,
) -> Result<PrimaryCanvasIdentity, StoreError> {
    let identity = PrimaryCanvasIdentity {
        block_id: format!("canvas:primary:{project_id}"),
        document_id: format!("document:canvas:primary:{project_id}"),
    };
    let collision = connection
        .query_row(
            "SELECT 1 WHERE EXISTS (SELECT 1 FROM blocks WHERE id = ?1) \
             OR EXISTS (SELECT 1 FROM documents WHERE id = ?2)",
            params![identity.block_id, identity.document_id],
            |_| Ok(()),
        )
        .optional()?;
    if collision.is_some() {
        return Err(StoreError::new(
            StoreErrorCode::AlreadyOwned,
            "The deterministic primary Canvas identity already exists",
            false,
        ));
    }
    connection.execute(
        "INSERT INTO blocks(\
           id, project_id, type, lifecycle, location_kind, containing_document_id, \
           containing_database_id, location_revision, metadata_revision, created_at, updated_at\
         ) VALUES (?1, ?2, ?3, 'active', 'space', NULL, NULL, 1, 1, ?4, ?4)",
        params![identity.block_id, project_id, CANVAS_OWNER_TYPE, now],
    )?;
    connection.execute(
        "INSERT INTO block_properties(\
           block_id, project_id, property_key, value_type, value_json, revision, updated_at\
         ) VALUES (?1, ?2, 'document.display_name', 'string', ?3, 1, ?4)",
        params![
            identity.block_id,
            project_id,
            serde_json::to_string("Canvas").map_err(|_| internal("Canvas display name"))?,
            now
        ],
    )?;
    connection.execute(
        "INSERT INTO top_level_block_placements(\
           block_id, project_id, rank_key, created_at, updated_at\
         ) VALUES (?1, ?2, ?3, ?4, ?4)",
        params![identity.block_id, project_id, PRIMARY_CANVAS_RANK_KEY, now],
    )?;
    connection.execute(
        "INSERT INTO documents(\
           id, project_id, generation, head_seq, schema_key, schema_version, state_vector, \
           state_hash, sync_engine, readiness, authority, genesis_source_revision, \
           created_at, updated_at\
         ) VALUES (?1, ?2, 1, 0, ?3, ?4, X'', ?5, 'canvas_scene', 'ready', \
           'ydoc_primary', NULL, ?6, ?6)",
        params![
            identity.document_id,
            project_id,
            CANVAS_SCHEMA_KEY,
            CANVAS_SCHEMA_VERSION,
            "0".repeat(64),
            now
        ],
    )?;
    connection.execute(
        "INSERT INTO block_documents(block_id, document_id, project_id, created_at) \
         VALUES (?1, ?2, ?3, ?4)",
        params![identity.block_id, identity.document_id, project_id, now],
    )?;
    let authority = read_document_authority(connection, &identity.document_id)?
        .ok_or_else(|| corrupt("Primary Canvas has no Document authority"))?;
    let (_, created) = ensure_canvas_scene(connection, &authority, assets_root)?;
    if !created {
        return Err(corrupt("Primary Canvas reused existing scene authority"));
    }
    Ok(identity)
}

fn corrupt(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message, false)
}

fn internal(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::Internal, message, false)
}
