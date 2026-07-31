use std::collections::{HashMap, VecDeque};
use std::sync::OnceLock;
use std::time::Instant;

use rusqlite::Connection;
use sha2::{Digest, Sha256};

use crate::infrastructure::document_repository::{DocumentHeadRow, DocumentReadRepository};
use crate::infrastructure::metrics::{DurationMetric, DurationMetricSnapshot};
use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};

use super::{
    BlockDocumentSchema, MAX_DOCUMENT_UPDATE_BYTES, YrsDocumentEngine, decode_block_document,
    materialize_decoded_document,
};

const DEFAULT_MAX_DOCUMENTS: usize = 64;
const DEFAULT_MAX_STATE_BYTES: usize = 64 * 1024 * 1024;
static RECONSTRUCTION_DURATION: OnceLock<DurationMetric> = OnceLock::new();

pub(crate) struct DocumentRuntimeCache {
    entries: HashMap<String, CacheEntry>,
    lru: VecDeque<String>,
    total_state_bytes: usize,
    maximum_documents: usize,
    maximum_state_bytes: usize,
    hits: u64,
    misses: u64,
}

struct CacheEntry {
    generation: i64,
    head_seq: i64,
    state_vector: Vec<u8>,
    state_bytes: usize,
    engine: YrsDocumentEngine,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct DocumentCacheStats {
    pub entries: usize,
    pub state_bytes: usize,
    pub hits: u64,
    pub misses: u64,
}

impl DocumentRuntimeCache {
    pub(crate) fn new() -> Self {
        Self::with_limits(DEFAULT_MAX_DOCUMENTS, DEFAULT_MAX_STATE_BYTES)
    }

    #[cfg(test)]
    pub(crate) fn with_limits(maximum_documents: usize, maximum_state_bytes: usize) -> Self {
        Self {
            entries: HashMap::new(),
            lru: VecDeque::new(),
            total_state_bytes: 0,
            maximum_documents,
            maximum_state_bytes,
            hits: 0,
            misses: 0,
        }
    }

    #[cfg(not(test))]
    fn with_limits(maximum_documents: usize, maximum_state_bytes: usize) -> Self {
        Self {
            entries: HashMap::new(),
            lru: VecDeque::new(),
            total_state_bytes: 0,
            maximum_documents,
            maximum_state_bytes,
            hits: 0,
            misses: 0,
        }
    }

    pub(crate) fn clone_engine(
        &mut self,
        connection: &Connection,
        head: &DocumentHeadRow,
    ) -> Result<YrsDocumentEngine, StoreError> {
        if let Some(entry) = self.entries.get(&head.id)
            && entry_matches(entry, head)
        {
            let full_state = entry.engine.full_state_v1();
            self.hits += 1;
            self.touch(&head.id);
            return YrsDocumentEngine::from_full_state_v1(&head.id, &full_state)
                .map_err(|error| corrupt(format!("Cached Document clone failed: {error}")));
        }
        self.remove(&head.id);
        self.misses += 1;
        reconstruct_yjs_engine(connection, head)
    }

    pub(crate) fn sync_diff(
        &mut self,
        connection: &Connection,
        head: &DocumentHeadRow,
        remote_state_vector: &[u8],
    ) -> Result<Vec<u8>, StoreError> {
        if let Some(entry) = self.entries.get(&head.id)
            && entry_matches(entry, head)
        {
            let update = entry
                .engine
                .diff_v1(remote_state_vector)
                .map_err(|error| invalid_input(format!("Invalid client state vector: {error}")))?;
            self.hits += 1;
            self.touch(&head.id);
            return Ok(update);
        }
        self.remove(&head.id);
        self.misses += 1;
        let engine = reconstruct_yjs_engine(connection, head)?;
        let update = engine
            .diff_v1(remote_state_vector)
            .map_err(|error| invalid_input(format!("Invalid client state vector: {error}")))?;
        self.install(head, engine);
        Ok(update)
    }

    pub(crate) fn install(&mut self, head: &DocumentHeadRow, engine: YrsDocumentEngine) {
        self.remove(&head.id);
        let state_bytes = engine.full_state_v1().len();
        if self.maximum_documents == 0
            || self.maximum_state_bytes == 0
            || state_bytes > self.maximum_state_bytes
        {
            return;
        }
        while self.entries.len() >= self.maximum_documents
            || self.total_state_bytes + state_bytes > self.maximum_state_bytes
        {
            let Some(oldest) = self.lru.pop_front() else {
                break;
            };
            if let Some(entry) = self.entries.remove(&oldest) {
                self.total_state_bytes = self.total_state_bytes.saturating_sub(entry.state_bytes);
            }
        }
        self.total_state_bytes += state_bytes;
        self.lru.push_back(head.id.clone());
        self.entries.insert(
            head.id.clone(),
            CacheEntry {
                generation: head.generation,
                head_seq: head.head_seq,
                state_vector: head.state_vector.clone(),
                state_bytes,
                engine,
            },
        );
    }

    pub(crate) fn invalidate(&mut self, document_id: &str) {
        self.remove(document_id);
    }

    pub(crate) fn stats(&self) -> DocumentCacheStats {
        DocumentCacheStats {
            entries: self.entries.len(),
            state_bytes: self.total_state_bytes,
            hits: self.hits,
            misses: self.misses,
        }
    }

    fn touch(&mut self, document_id: &str) {
        self.lru.retain(|candidate| candidate != document_id);
        self.lru.push_back(document_id.to_owned());
    }

    fn remove(&mut self, document_id: &str) {
        self.lru.retain(|candidate| candidate != document_id);
        if let Some(entry) = self.entries.remove(document_id) {
            self.total_state_bytes = self.total_state_bytes.saturating_sub(entry.state_bytes);
        }
    }
}

pub(crate) fn reconstruct_yjs_engine(
    connection: &Connection,
    head: &DocumentHeadRow,
) -> Result<YrsDocumentEngine, StoreError> {
    let started_at = Instant::now();
    let result = reconstruct_yjs_engine_inner(connection, head);
    RECONSTRUCTION_DURATION
        .get_or_init(DurationMetric::default)
        .record(started_at.elapsed());
    result
}

pub(crate) fn reconstruction_duration_metrics() -> DurationMetricSnapshot {
    RECONSTRUCTION_DURATION
        .get_or_init(DurationMetric::default)
        .snapshot()
}

fn reconstruct_yjs_engine_inner(
    connection: &Connection,
    head: &DocumentHeadRow,
) -> Result<YrsDocumentEngine, StoreError> {
    if !head.is_live_yjs_authority() {
        return Err(corrupt(format!(
            "Document {} is not live Yjs authority",
            head.id
        )));
    }
    let schema = BlockDocumentSchema::from_identity(&head.schema_key, head.schema_version)
        .ok_or_else(|| corrupt(format!("Document {} schema is unsupported", head.id)))?;
    let repository = DocumentReadRepository::new(connection);
    let snapshot = repository.latest_snapshot(&head.id, head.generation, head.head_seq)?;
    let snapshot_seq = snapshot
        .as_ref()
        .map_or(0, |snapshot| snapshot.snapshot_seq);
    let mut engine = match snapshot {
        Some(snapshot) => {
            if snapshot.schema_version != head.schema_version
                || sha256(&snapshot.snapshot_update) != snapshot.snapshot_hash
            {
                return Err(corrupt(format!(
                    "Document {} snapshot evidence is invalid",
                    head.id
                )));
            }
            let engine = YrsDocumentEngine::from_full_state_v1(&head.id, &snapshot.snapshot_update)
                .map_err(|error| {
                    corrupt(format!("Document {} snapshot failed: {error}", head.id))
                })?;
            if !engine
                .state_vector_equals_v1(&snapshot.state_vector)
                .map_err(|error| {
                    corrupt(format!("Document {} snapshot vector: {error}", head.id))
                })?
            {
                return Err(corrupt(format!(
                    "Document {} snapshot vector does not match",
                    head.id
                )));
            }
            engine
        }
        None => YrsDocumentEngine::new(&head.id),
    };
    let updates =
        repository.updates_between(&head.id, head.generation, snapshot_seq, head.head_seq)?;
    let mut expected_seq = snapshot_seq + 1;
    for update in updates {
        if update.seq != expected_seq || sha256(&update.update_blob) != update.update_hash {
            return Err(corrupt(format!(
                "Document {} update tail is invalid at sequence {expected_seq}",
                head.id
            )));
        }
        let candidate = engine
            .prepare_update_v1(&update.update_blob)
            .map_err(|error| corrupt(format!("Document {} update failed: {error}", head.id)))?;
        engine.commit_candidate(candidate).map_err(|error| {
            corrupt(format!(
                "Document {} update commit failed: {error}",
                head.id
            ))
        })?;
        expected_seq += 1;
    }
    if expected_seq - 1 != head.head_seq
        || !engine
            .state_vector_equals_v1(&head.state_vector)
            .map_err(|error| corrupt(format!("Document {} head vector: {error}", head.id)))?
    {
        return Err(corrupt(format!(
            "Document {} reconstructed head does not match SQLite",
            head.id
        )));
    }
    if engine.full_state_v1().len() > MAX_DOCUMENT_UPDATE_BYTES {
        return Err(corrupt(format!(
            "Document {} state exceeds the runtime bound",
            head.id
        )));
    }
    let decoded = decode_block_document(engine.document(), schema)
        .map_err(|error| corrupt(format!("Document {} schema: {error}", head.id)))?;
    let actual = materialize_decoded_document(&decoded)
        .map_err(|error| corrupt(format!("Document {} materialization: {error}", head.id)))?;
    let persisted = repository
        .materialization(&head.id)?
        .ok_or_else(|| corrupt(format!("Document {} has no materialization", head.id)))?;
    if persisted.generation != head.generation
        || persisted.projected_seq != head.head_seq
        || persisted.schema_version != i64::from(actual.schema_version)
        || persisted.title != actual.title
        || persisted.rich_title != serde_json::to_value(&actual.rich_title).map_err(json_error)?
        || persisted.nfm != actual.nfm
        || persisted.plain_text != actual.plain_text
        || persisted.preview != actual.preview
        || persisted.block_tree != serde_json::to_value(&actual.block_tree).map_err(json_error)?
        || persisted.references != serde_json::to_value(&actual.references).map_err(json_error)?
        || persisted.asset_refs != serde_json::to_value(&actual.asset_refs).map_err(json_error)?
    {
        return Err(corrupt(format!(
            "Document {} materialization does not match its head",
            head.id
        )));
    }
    Ok(engine)
}

fn entry_matches(entry: &CacheEntry, head: &DocumentHeadRow) -> bool {
    entry.generation == head.generation
        && entry.head_seq == head.head_seq
        && entry.state_vector == head.state_vector
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn corrupt(message: String) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message, false)
}

fn invalid_input(message: String) -> StoreError {
    StoreError::new(StoreErrorCode::InvalidInput, message, false)
}

fn json_error(error: serde_json::Error) -> StoreError {
    StoreError::new(
        StoreErrorCode::Internal,
        format!("Document materialization could not be encoded: {error}"),
        false,
    )
}
