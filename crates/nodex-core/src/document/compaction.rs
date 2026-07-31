use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};

use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};

use super::YrsDocumentEngine;
use super::persistence::{DocumentAuthorityRow, sha256};
use super::runtime::reconstruct_yjs_engine;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentCompactionResult {
    pub document_id: String,
    pub generation: i64,
    pub snapshot_seq: i64,
    pub snapshot_bytes: usize,
    pub pruned_update_count: usize,
    pub retained_receipt_count: usize,
}

pub(crate) fn compact_yjs_document(
    connection: &Connection,
    authority: &DocumentAuthorityRow,
    engine: &YrsDocumentEngine,
) -> Result<DocumentCompactionResult, StoreError> {
    let update_count = count_rows(
        connection,
        "SELECT count(*) FROM document_updates \
         WHERE document_id = ?1 AND generation = ?2 AND seq <= ?3",
        authority,
    )?;
    let full_state = engine.full_state_v1();
    if !engine
        .state_vector_equals_v1(&authority.head.state_vector)
        .map_err(|_| corrupt("Document head state vector is invalid"))?
    {
        return Err(corrupt(
            "Document changed while preparing its compaction snapshot",
        ));
    }
    let state_vector = authority.head.state_vector.clone();
    let snapshot_hash = sha256(&full_state);
    let now = connection.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", [], |row| {
        row.get::<_, String>(0)
    })?;
    connection.execute(
        "INSERT INTO document_snapshots (\
           document_id, generation, snapshot_seq, state_vector, snapshot_update, \
           snapshot_hash, schema_version, created_at\
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) \
         ON CONFLICT(document_id, generation, snapshot_seq) DO NOTHING",
        params![
            authority.head.id,
            authority.head.generation,
            authority.head.head_seq,
            state_vector,
            full_state,
            snapshot_hash,
            authority.head.schema_version,
            now,
        ],
    )?;
    let stored = connection
        .query_row(
            "SELECT state_vector, snapshot_update, snapshot_hash, schema_version \
             FROM document_snapshots \
             WHERE document_id = ?1 AND generation = ?2 AND snapshot_seq = ?3",
            params![
                authority.head.id,
                authority.head.generation,
                authority.head.head_seq
            ],
            |row| {
                Ok((
                    row.get::<_, Vec<u8>>(0)?,
                    row.get::<_, Vec<u8>>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            },
        )
        .map_err(|_| corrupt("Stored compaction snapshot has invalid column types"))?;
    if stored.0 != authority.head.state_vector
        || stored.1 != full_state
        || stored.2 != snapshot_hash
        || stored.3 != authority.head.schema_version
    {
        return Err(corrupt(
            "Stored compaction snapshot does not match the current Document head",
        ));
    }
    let pruned = connection.execute(
        "DELETE FROM document_updates \
         WHERE document_id = ?1 AND generation = ?2 AND seq <= ?3",
        params![
            authority.head.id,
            authority.head.generation,
            authority.head.head_seq
        ],
    )?;
    connection.execute(
        "DELETE FROM document_snapshots \
         WHERE document_id = ?1 AND generation = ?2 AND snapshot_seq < ?3",
        params![
            authority.head.id,
            authority.head.generation,
            authority.head.head_seq
        ],
    )?;
    let current_head = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM documents \
         WHERE id = ?1 AND generation = ?2 AND head_seq = ?3 \
           AND state_vector = ?4 AND state_hash = '' \
           AND readiness = 'ready' AND authority = 'ydoc_primary' AND sync_engine = 'yjs')",
        params![
            authority.head.id,
            authority.head.generation,
            authority.head.head_seq,
            authority.head.state_vector,
        ],
        |row| row.get::<_, bool>(0),
    )?;
    if !current_head {
        return Err(StoreError::new(
            StoreErrorCode::HeadConflict,
            "Document head changed while finalizing compaction",
            true,
        ));
    }
    let reconstructed = reconstruct_yjs_engine(connection, &authority.head)?;
    if !reconstructed
        .state_vector_equals_v1(&authority.head.state_vector)
        .map_err(|_| corrupt("Compacted Document head vector is invalid"))?
    {
        return Err(corrupt(
            "Compacted Document did not round-trip from its retained snapshot",
        ));
    }
    result(
        connection,
        authority,
        full_state.len(),
        pruned.min(update_count),
    )
}

fn result(
    connection: &Connection,
    authority: &DocumentAuthorityRow,
    snapshot_bytes: usize,
    pruned_update_count: usize,
) -> Result<DocumentCompactionResult, StoreError> {
    let retained_receipt_count = count_rows(
        connection,
        "SELECT count(*) FROM document_update_receipts \
         WHERE document_id = ?1 AND generation = ?2 AND seq <= ?3",
        authority,
    )?;
    Ok(DocumentCompactionResult {
        document_id: authority.head.id.clone(),
        generation: authority.head.generation,
        snapshot_seq: authority.head.head_seq,
        snapshot_bytes,
        pruned_update_count,
        retained_receipt_count,
    })
}

fn count_rows(
    connection: &Connection,
    sql: &str,
    authority: &DocumentAuthorityRow,
) -> Result<usize, StoreError> {
    let count = connection.query_row(
        sql,
        params![
            authority.head.id,
            authority.head.generation,
            authority.head.head_seq
        ],
        |row| row.get::<_, i64>(0),
    )?;
    usize::try_from(count).map_err(|_| corrupt("Document maintenance count is invalid"))
}

fn corrupt(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message, false)
}
