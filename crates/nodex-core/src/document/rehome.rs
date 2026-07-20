use std::path::Path;

use rusqlite::Connection;

use crate::infrastructure::document_repository::DocumentSyncEngine;
use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};

use super::{
    BlockDocumentSchema, canvas, decode_block_document, materialize_decoded_document, persistence,
    read_document_authority, reconstruct_yjs_engine,
};

pub(crate) fn rebuild_rehomed_document_projections(
    connection: &Connection,
    document_id: &str,
    now: &str,
    assets_root: &Path,
) -> Result<(), StoreError> {
    let authority = read_document_authority(connection, document_id)?
        .ok_or_else(|| corrupt("Rehomed Document authority is unavailable"))?;
    match authority.head.sync_engine {
        DocumentSyncEngine::CanvasScene => {
            let loaded = canvas::load_canvas_scene(connection, &authority)?;
            canvas::replace_canvas_projections(
                connection,
                &authority,
                &loaded.scene,
                now,
                assets_root,
            )
        }
        DocumentSyncEngine::Yjs => {
            let schema = BlockDocumentSchema::from_identity(
                &authority.head.schema_key,
                authority.head.schema_version,
            )
            .ok_or_else(|| {
                StoreError::new(
                    StoreErrorCode::UnsupportedSchema,
                    "Rehomed Document has an unsupported schema",
                    false,
                )
            })?;
            let engine = reconstruct_yjs_engine(connection, &authority.head)?;
            let decoded = decode_block_document(engine.document(), schema)
                .map_err(|error| corrupt(format!("Rehomed Document schema is invalid: {error}")))?;
            let materialization = materialize_decoded_document(&decoded).map_err(|error| {
                corrupt(format!("Rehomed Document cannot materialize: {error}"))
            })?;
            persistence::replace_secondary_projections(
                connection,
                &authority,
                &materialization,
                authority.head.head_seq,
                now,
            )
        }
    }
}

fn corrupt(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message, false)
}
