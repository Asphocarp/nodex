use rusqlite::{Connection, TransactionBehavior, params};

use crate::infrastructure::document_repository::DocumentSyncEngine;
use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};

use super::compaction::compact_yjs_document;
use super::history::prune_document_history;
use super::persistence::read_document_authority;
use super::runtime::reconstruct_yjs_engine;

const MINIMUM_UPDATE_COUNT: i64 = 128;
const MINIMUM_UPDATE_BYTES: i64 = 2 * 1024 * 1024;
const MAXIMUM_DOCUMENTS: usize = 8;
const MAXIMUM_TAIL_BYTES: i64 = 32 * 1024 * 1024;
const SCAN_LIMIT: i64 = 128;
const MAXIMUM_HISTORY_DOCUMENTS: usize = 10_000;

#[derive(Debug)]
struct CompactionCandidate {
    document_id: String,
    generation: i64,
    head_seq: i64,
    update_bytes: i64,
}

pub(crate) fn compact_eligible_documents(connection: &mut Connection) -> Result<usize, StoreError> {
    let candidates = connection
        .prepare(
            "SELECT document.id, document.generation, document.head_seq, \
                    COALESCE(SUM(length(update_row.update_blob)), 0) AS update_bytes \
             FROM documents document \
             JOIN block_documents ownership ON ownership.document_id = document.id \
               AND ownership.project_id = document.project_id \
             JOIN blocks owner ON owner.id = ownership.block_id \
               AND owner.project_id = document.project_id \
             JOIN document_updates update_row ON update_row.document_id = document.id \
               AND update_row.generation = document.generation \
             WHERE document.readiness = 'ready' AND document.sync_engine = 'yjs' \
             GROUP BY document.id, document.generation, document.head_seq \
             HAVING count(update_row.seq) >= ?1 \
                 OR COALESCE(SUM(length(update_row.update_blob)), 0) >= ?2 \
             ORDER BY MIN(update_row.committed_at), update_bytes DESC, document.id \
             LIMIT ?3",
        )?
        .query_map(
            params![MINIMUM_UPDATE_COUNT, MINIMUM_UPDATE_BYTES, SCAN_LIMIT],
            |row| {
                Ok(CompactionCandidate {
                    document_id: row.get(0)?,
                    generation: row.get(1)?,
                    head_seq: row.get(2)?,
                    update_bytes: row.get(3)?,
                })
            },
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut selected = Vec::new();
    let mut selected_bytes = 0i64;
    for candidate in candidates {
        if candidate.generation < 1 || candidate.head_seq < 0 || candidate.update_bytes < 0 {
            return Err(corrupt("Document compaction candidate is invalid"));
        }
        if selected.len() >= MAXIMUM_DOCUMENTS {
            break;
        }
        let next_bytes = selected_bytes
            .checked_add(candidate.update_bytes)
            .ok_or_else(|| corrupt("Document compaction byte budget overflowed"))?;
        if next_bytes > MAXIMUM_TAIL_BYTES && !selected.is_empty() {
            continue;
        }
        selected_bytes = next_bytes;
        selected.push(candidate);
    }

    for candidate in &selected {
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let authority = read_document_authority(&transaction, &candidate.document_id)?
            .ok_or_else(|| corrupt("Document compaction authority disappeared"))?;
        if authority.head.generation != candidate.generation
            || authority.head.head_seq != candidate.head_seq
            || authority.head.sync_engine != DocumentSyncEngine::Yjs
        {
            return Err(StoreError::new(
                StoreErrorCode::HeadConflict,
                "Document changed before maintenance compaction",
                true,
            ));
        }
        let engine = reconstruct_yjs_engine(&transaction, &authority.head)?;
        compact_yjs_document(&transaction, &authority, &engine)?;
        transaction.commit()?;
    }
    Ok(selected.len())
}

pub(crate) fn prune_document_history_pass(
    connection: &mut Connection,
) -> Result<usize, StoreError> {
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let now = transaction.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", [], |row| {
        row.get::<_, String>(0)
    })?;
    let document_ids = transaction
        .prepare(
            "SELECT DISTINCT document_id FROM document_versions \
             ORDER BY document_id LIMIT 10001",
        )?
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if document_ids.len() > MAXIMUM_HISTORY_DOCUMENTS {
        return Err(corrupt(
            "Document history maintenance exceeds its Document bound",
        ));
    }
    let mut deleted = 0usize;
    for document_id in document_ids {
        deleted = deleted
            .checked_add(prune_document_history(&transaction, &document_id, &now)?)
            .ok_or_else(|| corrupt("Document history deletion count overflowed"))?;
    }
    transaction.commit()?;
    Ok(deleted)
}

fn corrupt(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message, false)
}
