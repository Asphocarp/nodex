use std::collections::HashSet;

use nodex_core_contracts::BoundModuleContext;
use rusqlite::{Connection, OptionalExtension, params};

use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};

use super::persistence::{DocumentAuthorityRow, sha256};

pub(crate) struct StaleYjsUpdate<'a> {
    pub(crate) store_epoch: &'a str,
    pub(crate) context: &'a BoundModuleContext,
    pub(crate) generation: i64,
    pub(crate) base_head_seq: i64,
    pub(crate) update_id: &'a str,
    pub(crate) touched_block_ids: &'a [String],
    pub(crate) update: &'a [u8],
}

pub(crate) fn persist_recovery_if_barrier_crossed(
    connection: &Connection,
    authority: &DocumentAuthorityRow,
    input: StaleYjsUpdate<'_>,
) -> Result<Option<String>, StoreError> {
    if let Some(artifact) = read_artifact(connection, authority, &input)? {
        return Ok(Some(artifact));
    }
    if input.base_head_seq >= authority.head.head_seq {
        return Ok(None);
    }
    let barriers = connection
        .prepare(
            "SELECT block_ids_json, title_fence \
             FROM document_structural_barriers \
             WHERE document_id = ?1 AND generation = ?2 \
               AND head_seq > ?3 AND head_seq <= ?4 \
             ORDER BY head_seq, operation_id",
        )?
        .query_map(
            params![
                authority.head.id,
                authority.head.generation,
                input.base_head_seq,
                authority.head.head_seq,
            ],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
        )?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|_| corrupt("Document structural barrier row is invalid"))?;
    if barriers.is_empty() {
        return Ok(None);
    }
    let mut fenced = HashSet::new();
    let mut title_fence = false;
    for (block_ids, title) in barriers {
        let block_ids = serde_json::from_str::<Vec<String>>(&block_ids)
            .map_err(|_| corrupt("Document structural barrier Block IDs are invalid"))?;
        if block_ids
            .iter()
            .any(|block_id| block_id.is_empty() || block_id.len() > 512)
        {
            return Err(corrupt("Document structural barrier Block IDs are invalid"));
        }
        fenced.extend(block_ids);
        title_fence |= title == 1;
    }
    let unsafe_update = input.touched_block_ids.is_empty()
        || input
            .touched_block_ids
            .iter()
            .any(|block_id| fenced.contains(block_id))
        || (title_fence
            && input
                .touched_block_ids
                .iter()
                .any(|block_id| block_id == &authority.owner_block_id));
    if !unsafe_update {
        return Ok(None);
    }
    let artifact_id = format!(
        "document-recovery:{}",
        sha256(
            format!(
                "{}\0{}\0{}",
                authority.head.id, input.generation, input.update_id
            )
            .as_bytes()
        )
    );
    let update_hash = sha256(input.update);
    let touched_json = serde_json::to_string(input.touched_block_ids)
        .map_err(|_| internal("Recovery artifact touched Block IDs"))?;
    let update_length = i64::try_from(input.update.len())
        .map_err(|_| internal("Recovery artifact update length overflowed"))?;
    let (created_at, expires_at) = connection.query_row(
        "SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), \
                strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+30 days')",
        [],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
    )?;
    connection.execute(
        "INSERT INTO document_recovery_artifacts (\
           id, project_id, store_epoch, document_id, generation, update_id, \
           client_session_id, base_head_seq, touched_block_ids_json, \
           derived_touched_block_ids_json, update_blob, update_hash, update_byte_length, \
           reason, relocation_ids_json, status, created_at, expires_at, resolved_at\
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, NULL, ?10, ?11, ?12, \
                   'unsafe_stale_update', '[]', 'pending', ?13, ?14, NULL)",
        params![
            artifact_id,
            authority.head.project_id,
            input.store_epoch,
            authority.head.id,
            input.generation,
            input.update_id,
            input.context.connection_id,
            input.base_head_seq,
            touched_json,
            input.update,
            update_hash,
            update_length,
            created_at,
            expires_at,
        ],
    )?;
    Ok(Some(artifact_id))
}

fn read_artifact(
    connection: &Connection,
    authority: &DocumentAuthorityRow,
    input: &StaleYjsUpdate<'_>,
) -> Result<Option<String>, StoreError> {
    let stored = connection
        .query_row(
            "SELECT id, store_epoch, client_session_id, base_head_seq, \
                    touched_block_ids_json, update_blob, update_hash, update_byte_length \
             FROM document_recovery_artifacts \
             WHERE document_id = ?1 AND generation = ?2 AND update_id = ?3",
            params![authority.head.id, input.generation, input.update_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, Vec<u8>>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, i64>(7)?,
                ))
            },
        )
        .optional()?;
    let Some(stored) = stored else {
        return Ok(None);
    };
    let touched = serde_json::from_str::<Vec<String>>(&stored.4)
        .map_err(|_| corrupt("Stored recovery artifact touched Block IDs are invalid"))?;
    let exact = stored.1 == input.store_epoch
        && stored.2 == input.context.connection_id
        && stored.3 == input.base_head_seq
        && touched == input.touched_block_ids
        && stored.5 == input.update
        && stored.6 == sha256(input.update)
        && stored.7 == i64::try_from(input.update.len()).unwrap_or(-1);
    if exact {
        return Ok(Some(stored.0));
    }
    Err(StoreError::new(
        StoreErrorCode::IdempotencyKeyReused,
        "update_id is already bound to another recovery artifact request",
        false,
    ))
}

fn corrupt(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message, false)
}

fn internal(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::Internal, message, false)
}
