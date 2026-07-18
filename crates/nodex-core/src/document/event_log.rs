use nodex_core_contracts::document::{DocumentInvalidationReason, OwnedDocumentEvent};
use nodex_core_contracts::{
    CORE_CONTRACT_VERSION, CommittedCoreModuleEvent, CoreModuleEventPayload, StoreEpoch,
};
use rusqlite::{Connection, OptionalExtension, params};
use serde::Deserialize;
use serde_json::Value;

use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};

const DEFAULT_REPLAY_LIMIT: u32 = 256;
const MAX_REPLAY_LIMIT: u32 = 1_024;
const MAX_EVENT_PAYLOAD_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DocumentEventReplay {
    Events {
        events: Vec<CommittedCoreModuleEvent>,
        next_after: i64,
        event_head: i64,
    },
    ResyncRequired {
        requested_after: i64,
        oldest_available: i64,
        event_head: i64,
    },
}

#[derive(Debug)]
struct ChangeLogRow {
    sequence: i64,
    project_id: String,
    store_epoch: String,
    kind: String,
    operation_id: Option<String>,
    payload_json: String,
    committed_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DocumentEventMetadata {
    module: String,
    kind: String,
    document_id: String,
    generation: i64,
    head_seq: i64,
    #[serde(default)]
    update_id: Option<String>,
    #[serde(default)]
    update_hash: Option<String>,
    #[serde(default)]
    scene_hash: Option<String>,
    #[serde(default)]
    event_delta: Option<Value>,
}

pub(crate) fn replay_document_events(
    connection: &Connection,
    project_id: &str,
    after: i64,
    limit: Option<u32>,
) -> Result<DocumentEventReplay, StoreError> {
    if after < 0 || project_id.is_empty() || project_id.len() > 512 {
        return Err(invalid("Document event replay boundary is invalid"));
    }
    let limit = limit
        .unwrap_or(DEFAULT_REPLAY_LIMIT)
        .clamp(1, MAX_REPLAY_LIMIT);
    let (oldest_available, event_head) = connection.query_row(
        "SELECT COALESCE(min(seq), 0), COALESCE(max(seq), 0) FROM change_log",
        [],
        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
    )?;
    if oldest_available < 0 || event_head < oldest_available {
        return Err(corrupt("Change log retention boundary is invalid"));
    }
    if oldest_available > 1 && after < oldest_available - 1 {
        return Ok(DocumentEventReplay::ResyncRequired {
            requested_after: after,
            oldest_available,
            event_head,
        });
    }

    let rows = connection
        .prepare(
            "SELECT seq, project_id, store_epoch, kind, operation_id, payload_json, committed_at \
             FROM change_log WHERE seq > ?1 ORDER BY seq ASC LIMIT ?2",
        )?
        .query_map(params![after, i64::from(limit)], |row| {
            Ok(ChangeLogRow {
                sequence: row.get(0)?,
                project_id: row.get(1)?,
                store_epoch: row.get(2)?,
                kind: row.get(3)?,
                operation_id: row.get(4)?,
                payload_json: row.get(5)?,
                committed_at: row.get(6)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|_| corrupt("Change log event row has invalid column types"))?;

    let mut next_after = after;
    let mut events = Vec::new();
    for row in rows {
        validate_change_log_row(&row, next_after, event_head)?;
        next_after = row.sequence;
        if row.project_id != project_id {
            continue;
        }
        if !row.kind.starts_with("owned_document.") {
            continue;
        }
        let Some(event) = reconstruct_document_event(connection, &row)? else {
            return Ok(DocumentEventReplay::ResyncRequired {
                requested_after: after,
                oldest_available: row.sequence,
                event_head,
            });
        };
        events.push(event);
    }
    Ok(DocumentEventReplay::Events {
        events,
        next_after,
        event_head,
    })
}

fn reconstruct_document_event(
    connection: &Connection,
    row: &ChangeLogRow,
) -> Result<Option<CommittedCoreModuleEvent>, StoreError> {
    if row.payload_json.len() > MAX_EVENT_PAYLOAD_BYTES {
        return Err(corrupt("Owned Document event payload exceeds its bound"));
    }
    let metadata = serde_json::from_str::<DocumentEventMetadata>(&row.payload_json)
        .map_err(|_| corrupt("Owned Document event payload is invalid"))?;
    if metadata.module != "owned_document"
        || format!("owned_document.{}", metadata.kind) != row.kind
        || metadata.document_id.is_empty()
        || metadata.document_id.len() > 512
        || metadata.generation < 1
        || metadata.head_seq < 1
    {
        return Err(corrupt("Owned Document event metadata is inconsistent"));
    }

    let payload = match metadata.kind.as_str() {
        "document_initialized" | "document_updated" => {
            let update_id = metadata
                .update_id
                .as_deref()
                .ok_or_else(|| corrupt("Yjs event update identity is missing"))?;
            let update = connection
                .query_row(
                    "SELECT update_blob, update_hash FROM document_updates \
                     WHERE document_id = ?1 AND generation = ?2 AND seq = ?3 AND update_id = ?4",
                    params![
                        metadata.document_id,
                        metadata.generation,
                        metadata.head_seq,
                        update_id,
                    ],
                    |row| Ok((row.get::<_, Vec<u8>>(0)?, row.get::<_, String>(1)?)),
                )
                .optional()
                .map_err(|_| corrupt("Yjs event update row has invalid column types"))?;
            let Some((update, update_hash)) = update else {
                return Ok(None);
            };
            if update.is_empty()
                || metadata.update_hash.as_deref() != Some(update_hash.as_str())
                || super::persistence::sha256(&update) != update_hash
            {
                return Err(corrupt("Yjs event update evidence is inconsistent"));
            }
            OwnedDocumentEvent::DocumentUpdated {
                document_id: metadata.document_id,
                generation: metadata.generation,
                head_seq: metadata.head_seq,
                update,
            }
        }
        "canvas_scene_updated" => {
            let operation_id = row
                .operation_id
                .as_deref()
                .ok_or_else(|| corrupt("Canvas event operation identity is missing"))?;
            let receipt_exists = connection
                .query_row(
                    "SELECT 1 FROM canvas_scene_mutation_receipts \
                     WHERE document_id = ?1 AND generation = ?2 AND mutation_id = ?3 \
                       AND committed_head_seq = ?4 AND outcome = 'committed'",
                    params![
                        metadata.document_id,
                        metadata.generation,
                        operation_id,
                        metadata.head_seq,
                    ],
                    |row| row.get::<_, i64>(0),
                )
                .optional()
                .map_err(|_| corrupt("Canvas event receipt has invalid column types"))?;
            if receipt_exists != Some(1) {
                return Ok(None);
            }
            let Some(mutation) = metadata.event_delta else {
                return Ok(None);
            };
            if !mutation.is_object() {
                return Err(corrupt("Canvas event delta is invalid"));
            }
            let scene_hash = metadata
                .scene_hash
                .filter(|hash| is_sha256(hash))
                .ok_or_else(|| corrupt("Canvas event scene hash is invalid"))?;
            OwnedDocumentEvent::CanvasUpdated {
                document_id: metadata.document_id,
                generation: metadata.generation,
                head_seq: metadata.head_seq,
                scene_hash,
                mutation,
            }
        }
        "document_restored" => OwnedDocumentEvent::DocumentInvalidated {
            document_id: metadata.document_id,
            reason: DocumentInvalidationReason::Restored,
        },
        "document_invalidated" => OwnedDocumentEvent::DocumentInvalidated {
            document_id: metadata.document_id,
            reason: DocumentInvalidationReason::GenerationChanged,
        },
        _ => return Err(corrupt("Owned Document event kind is unsupported")),
    };

    Ok(Some(CommittedCoreModuleEvent {
        version: CORE_CONTRACT_VERSION,
        sequence: row.sequence,
        store_epoch: StoreEpoch(row.store_epoch.clone()),
        operation_id: row.operation_id.clone(),
        committed_at: row.committed_at.clone(),
        payload: CoreModuleEventPayload::OwnedDocument(payload),
    }))
}

fn validate_change_log_row(
    row: &ChangeLogRow,
    previous: i64,
    event_head: i64,
) -> Result<(), StoreError> {
    if row.sequence <= previous
        || row.sequence > event_head
        || row.project_id.is_empty()
        || row.project_id.len() > 512
        || row.store_epoch.is_empty()
        || row.store_epoch.len() > 512
        || row.kind.is_empty()
        || row.kind.len() > 128
        || row
            .operation_id
            .as_ref()
            .is_some_and(|value| value.is_empty() || value.len() > 512)
        || row.committed_at.is_empty()
        || row.committed_at.len() > 64
    {
        return Err(corrupt("Change log event boundary is invalid"));
    }
    Ok(())
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn invalid(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::InvalidInput, message, false)
}

fn corrupt(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message, false)
}
