use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;
use yrs::sync::{Awareness, AwarenessUpdate};
use yrs::updates::decoder::Decode;
use yrs::updates::encoder::Encode;
use yrs::{
    ClientID, Doc, GetString, OffsetKind, Options, ReadTxn, Snapshot, StateVector, Transact,
    TransactionMut, Update,
};

pub const MAX_DOCUMENT_UPDATE_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_STATE_VECTOR_BYTES: usize = 64 * 1024;
pub const MAX_AWARENESS_UPDATE_BYTES: usize = 256 * 1024;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum YrsEngineError {
    #[error("document update is empty")]
    EmptyUpdate,
    #[error("document update is too large: {actual} bytes exceeds {maximum}")]
    UpdateTooLarge { actual: usize, maximum: usize },
    #[error("state vector is too large: {actual} bytes exceeds {maximum}")]
    StateVectorTooLarge { actual: usize, maximum: usize },
    #[error("awareness update is too large: {actual} bytes exceeds {maximum}")]
    AwarenessUpdateTooLarge { actual: usize, maximum: usize },
    #[error("invalid V1 document update: {0}")]
    InvalidUpdate(String),
    #[error("invalid V1 state vector: {0}")]
    InvalidStateVector(String),
    #[error("invalid V1 awareness update: {0}")]
    InvalidAwarenessUpdate(String),
    #[error("document update has unresolved causal dependencies")]
    MissingDependencies,
    #[error("candidate was prepared from a stale document state")]
    CandidateStale,
    #[error("could not observe document update: {0}")]
    Observation(String),
    #[error("awareness operation failed: {0}")]
    Awareness(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YrsDiagnostic {
    pub document_id: String,
    pub title: Option<String>,
    pub body_xml: Option<String>,
    pub state_vector: Vec<(u64, u32)>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CandidateCommit {
    pub did_change: bool,
    pub incoming_update_v1: Vec<u8>,
    pub observed_update_v1: Option<Vec<u8>>,
    pub state_vector_v1: Vec<u8>,
}

pub struct YrsUpdateCandidate {
    base_snapshot: Snapshot,
    document: Doc,
    did_change: bool,
    incoming_update_v1: Vec<u8>,
    observed_update_v1: Option<Vec<u8>>,
}

pub struct YrsDocumentEngine {
    document_id: String,
    document: Doc,
}

impl YrsDocumentEngine {
    pub fn new(document_id: impl Into<String>) -> Self {
        let document_id = document_id.into();
        let document = create_compatible_document(&document_id);
        Self {
            document_id,
            document,
        }
    }

    pub fn from_full_state_v1(
        document_id: impl Into<String>,
        full_state_v1: &[u8],
    ) -> Result<Self, YrsEngineError> {
        let mut engine = Self::new(document_id);
        if is_empty_v1_update(full_state_v1) {
            return Ok(engine);
        }

        let candidate = engine.prepare_update_v1(full_state_v1)?;
        engine.commit_candidate(candidate)?;
        Ok(engine)
    }

    pub fn document_id(&self) -> &str {
        &self.document_id
    }

    pub(crate) fn document(&self) -> &Doc {
        &self.document
    }

    pub fn state_vector_v1(&self) -> Vec<u8> {
        self.document.transact().state_vector().encode_v1()
    }

    pub fn full_state_v1(&self) -> Vec<u8> {
        self.document
            .transact()
            .encode_state_as_update_v1(&StateVector::default())
    }

    pub fn diff_v1(&self, remote_state_vector_v1: &[u8]) -> Result<Vec<u8>, YrsEngineError> {
        let remote = decode_state_vector_v1(remote_state_vector_v1)?;
        Ok(self.document.transact().encode_diff_v1(&remote))
    }

    pub fn state_vector_equals_v1(
        &self,
        other_state_vector_v1: &[u8],
    ) -> Result<bool, YrsEngineError> {
        let other = decode_state_vector_v1(other_state_vector_v1)?;
        Ok(self.document.transact().state_vector() == other)
    }

    pub fn prepare_update_v1(
        &self,
        incoming_update_v1: &[u8],
    ) -> Result<YrsUpdateCandidate, YrsEngineError> {
        validate_update_bounds(incoming_update_v1)?;
        let incoming = decode_update_v1(incoming_update_v1)?;
        let base_snapshot = self.document.transact().snapshot();
        let candidate_document =
            create_compatible_document_with_client_id(&self.document_id, self.document.client_id());

        let full_state = self.full_state_v1();
        if !is_empty_v1_update(&full_state) {
            let full_update = decode_update_v1(&full_state)?;
            let mut transaction = candidate_document.transact_mut();
            transaction
                .apply_update(full_update)
                .map_err(|error| YrsEngineError::InvalidUpdate(error.to_string()))?;
            if has_pending_dependencies(&transaction) {
                return Err(YrsEngineError::MissingDependencies);
            }
        }

        let observed_updates = Arc::new(Mutex::new(Vec::<Vec<u8>>::new()));
        let observed_updates_for_callback = Arc::clone(&observed_updates);
        let _subscription = candidate_document
            .observe_update_v1(move |_, event| {
                observed_updates_for_callback
                    .lock()
                    .expect("Yrs update observer mutex must not be poisoned")
                    .push(event.update.clone());
            })
            .map_err(|error| YrsEngineError::Observation(error.to_string()))?;

        {
            let mut transaction = candidate_document.transact_mut();
            transaction
                .apply_update(incoming)
                .map_err(|error| YrsEngineError::InvalidUpdate(error.to_string()))?;
            if has_pending_dependencies(&transaction) {
                return Err(YrsEngineError::MissingDependencies);
            }
        }

        let candidate_snapshot = candidate_document.transact().snapshot();
        let did_change = candidate_snapshot != base_snapshot;
        let observed_update_v1 = if did_change {
            Some(take_observed_update(&observed_updates)?)
        } else {
            None
        };

        Ok(YrsUpdateCandidate {
            base_snapshot,
            document: candidate_document,
            did_change,
            incoming_update_v1: incoming_update_v1.to_vec(),
            observed_update_v1,
        })
    }

    pub fn commit_candidate(
        &mut self,
        candidate: YrsUpdateCandidate,
    ) -> Result<CandidateCommit, YrsEngineError> {
        if self.document.transact().snapshot() != candidate.base_snapshot {
            return Err(YrsEngineError::CandidateStale);
        }

        if candidate.did_change {
            self.document = candidate.document;
        }

        Ok(CandidateCommit {
            did_change: candidate.did_change,
            incoming_update_v1: candidate.incoming_update_v1,
            observed_update_v1: candidate.observed_update_v1,
            state_vector_v1: self.state_vector_v1(),
        })
    }

    pub fn diagnostic(&self) -> YrsDiagnostic {
        let transaction = self.document.transact();
        let title = transaction
            .get_text("title")
            .map(|text| text.get_string(&transaction));
        let body_xml = transaction
            .get_xml_fragment("body")
            .map(|body| normalize_xml_attributes(&body.get_string(&transaction)));
        let mut state_vector: Vec<_> = transaction
            .state_vector()
            .iter()
            .map(|(client, clock)| (client.get(), *clock))
            .collect();
        state_vector.sort_unstable();

        YrsDiagnostic {
            document_id: self.document_id.clone(),
            title,
            body_xml,
            state_vector,
        }
    }
}

impl YrsUpdateCandidate {
    pub(crate) fn document(&self) -> &Doc {
        &self.document
    }

    pub(crate) fn did_change(&self) -> bool {
        self.did_change
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AwarenessChange {
    pub added: Vec<u64>,
    pub updated: Vec<u64>,
    pub removed: Vec<u64>,
}

pub struct DocumentAwareness {
    awareness: Awareness,
}

impl DocumentAwareness {
    pub fn new(document_id: &str) -> Self {
        Self {
            awareness: Awareness::new(create_compatible_document(document_id)),
        }
    }

    pub fn client_id(&self) -> u64 {
        self.awareness.client_id().get()
    }

    pub fn set_local_state(&mut self, state: &Value) -> Result<(), YrsEngineError> {
        self.awareness
            .set_local_state(state)
            .map_err(|error| YrsEngineError::Awareness(error.to_string()))
    }

    pub fn clear_local_state(&mut self) {
        self.awareness.clean_local_state();
    }

    pub fn local_update_v1(&self) -> Result<Vec<u8>, YrsEngineError> {
        self.awareness
            .update_with_clients([self.awareness.client_id()])
            .map(|update| update.encode_v1())
            .map_err(|error| YrsEngineError::Awareness(error.to_string()))
    }

    pub fn full_update_v1(&self) -> Result<Vec<u8>, YrsEngineError> {
        self.awareness
            .update()
            .map(|update| update.encode_v1())
            .map_err(|error| YrsEngineError::Awareness(error.to_string()))
    }

    pub fn live_client_ids(&self) -> Vec<u64> {
        self.awareness
            .iter()
            .filter_map(|(client_id, state)| state.data.is_some().then_some(client_id.get()))
            .collect()
    }

    pub fn inspect_update_v1(update_v1: &[u8]) -> Result<Vec<(u64, bool)>, YrsEngineError> {
        if update_v1.len() > MAX_AWARENESS_UPDATE_BYTES {
            return Err(YrsEngineError::AwarenessUpdateTooLarge {
                actual: update_v1.len(),
                maximum: MAX_AWARENESS_UPDATE_BYTES,
            });
        }
        let update = AwarenessUpdate::decode_v1(update_v1)
            .map_err(|error| YrsEngineError::InvalidAwarenessUpdate(error.to_string()))?;
        Ok(update
            .clients
            .into_iter()
            .map(|(client_id, entry)| (client_id.get(), entry.json.as_ref() != "null"))
            .collect())
    }

    pub fn remove_clients_v1(&mut self, client_ids: &[u64]) -> Result<Vec<u8>, YrsEngineError> {
        let client_ids = client_ids
            .iter()
            .copied()
            .map(ClientID::new)
            .collect::<Vec<_>>();
        for client_id in &client_ids {
            self.awareness.remove_state(*client_id);
        }
        self.awareness
            .update_with_clients(client_ids)
            .map(|update| update.encode_v1())
            .map_err(|error| YrsEngineError::Awareness(error.to_string()))
    }

    pub fn apply_update_v1(
        &mut self,
        update_v1: &[u8],
    ) -> Result<Option<AwarenessChange>, YrsEngineError> {
        if update_v1.len() > MAX_AWARENESS_UPDATE_BYTES {
            return Err(YrsEngineError::AwarenessUpdateTooLarge {
                actual: update_v1.len(),
                maximum: MAX_AWARENESS_UPDATE_BYTES,
            });
        }
        let update = AwarenessUpdate::decode_v1(update_v1)
            .map_err(|error| YrsEngineError::InvalidAwarenessUpdate(error.to_string()))?;
        let summary = self
            .awareness
            .apply_update_summary(update)
            .map_err(|error| YrsEngineError::Awareness(error.to_string()))?;
        Ok(summary.map(|summary| AwarenessChange {
            added: client_ids(summary.added),
            updated: client_ids(summary.updated),
            removed: client_ids(summary.removed),
        }))
    }

    pub fn state(&self, client_id: u64) -> Option<Value> {
        self.awareness.state(ClientID::new(client_id))
    }
}

pub fn create_compatible_document(guid: &str) -> Doc {
    create_compatible_document_with_options(guid, None)
}

pub fn has_pending_dependencies(transaction: &TransactionMut<'_>) -> bool {
    transaction.store().pending_update().is_some() || transaction.store().pending_ds().is_some()
}

pub fn decode_state_vector_v1(encoded: &[u8]) -> Result<StateVector, YrsEngineError> {
    if encoded.len() > MAX_STATE_VECTOR_BYTES {
        return Err(YrsEngineError::StateVectorTooLarge {
            actual: encoded.len(),
            maximum: MAX_STATE_VECTOR_BYTES,
        });
    }
    if encoded.is_empty() {
        return Ok(StateVector::default());
    }
    StateVector::decode_v1(encoded)
        .map_err(|error| YrsEngineError::InvalidStateVector(error.to_string()))
}

fn create_compatible_document_with_client_id(guid: &str, client_id: ClientID) -> Doc {
    create_compatible_document_with_options(guid, Some(client_id))
}

fn create_compatible_document_with_options(guid: &str, client_id: Option<ClientID>) -> Doc {
    let defaults = Options::default();
    let options = Options {
        client_id: client_id.unwrap_or(defaults.client_id),
        guid: guid.into(),
        offset_kind: OffsetKind::Utf16,
        ..defaults
    };
    Doc::with_options(options)
}

fn validate_update_bounds(update_v1: &[u8]) -> Result<(), YrsEngineError> {
    if update_v1.is_empty() {
        return Err(YrsEngineError::EmptyUpdate);
    }
    if update_v1.len() > MAX_DOCUMENT_UPDATE_BYTES {
        return Err(YrsEngineError::UpdateTooLarge {
            actual: update_v1.len(),
            maximum: MAX_DOCUMENT_UPDATE_BYTES,
        });
    }
    Ok(())
}

fn decode_update_v1(update_v1: &[u8]) -> Result<Update, YrsEngineError> {
    Update::decode_v1(update_v1).map_err(|error| YrsEngineError::InvalidUpdate(error.to_string()))
}

fn is_empty_v1_update(update_v1: &[u8]) -> bool {
    update_v1.is_empty() || update_v1 == [0, 0]
}

fn take_observed_update(
    observed_updates: &Arc<Mutex<Vec<Vec<u8>>>>,
) -> Result<Vec<u8>, YrsEngineError> {
    let updates = observed_updates
        .lock()
        .map_err(|error| YrsEngineError::Observation(error.to_string()))?;
    if updates.len() != 1 {
        return Err(YrsEngineError::Observation(format!(
            "expected one committed update event, observed {}",
            updates.len()
        )));
    }
    Ok(updates[0].clone())
}

fn client_ids(ids: Vec<ClientID>) -> Vec<u64> {
    ids.into_iter().map(|client_id| client_id.get()).collect()
}

fn normalize_xml_attributes(xml: &str) -> String {
    let mut normalized = String::with_capacity(xml.len());
    let mut remaining = xml;
    while let Some(start) = remaining.find('<') {
        normalized.push_str(&remaining[..start]);
        let after_start = &remaining[start..];
        let Some(end) = after_start.find('>') else {
            normalized.push_str(after_start);
            return normalized;
        };
        let tag = &after_start[1..end];
        if tag.starts_with('/') {
            normalized.push('<');
            normalized.push_str(tag);
            normalized.push('>');
            remaining = &after_start[end + 1..];
            continue;
        }

        let name_end = tag.find(char::is_whitespace).unwrap_or(tag.len());
        let name = &tag[..name_end];
        let mut attributes = Vec::new();
        let mut source = &tag[name_end..];
        loop {
            source = source.trim_start();
            if source.is_empty() {
                break;
            }
            let Some(equals) = source.find('=') else {
                break;
            };
            let key = source[..equals].trim();
            let value_source = &source[equals + 1..];
            if !value_source.starts_with('"') {
                break;
            }
            let Some(quote_end) = value_source[1..].find('"') else {
                break;
            };
            let value = &value_source[..quote_end + 2];
            attributes.push(format!("{key}={value}"));
            source = &value_source[quote_end + 2..];
        }
        attributes.sort();
        normalized.push('<');
        normalized.push_str(name);
        for attribute in attributes {
            normalized.push(' ');
            normalized.push_str(&attribute);
        }
        normalized.push('>');
        remaining = &after_start[end + 1..];
    }
    normalized.push_str(remaining);
    normalized
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use yrs::{GetString, Text, Transact};

    use super::*;

    fn fixture(name: &str) -> Vec<u8> {
        std::fs::read(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("tests/fixtures/yjs-yrs")
                .join(name),
        )
        .expect("fixture exists")
    }

    fn update_with_title(document_id: &str, title: &str) -> Vec<u8> {
        let document = create_compatible_document(document_id);
        let text = document.get_or_insert_text("title");
        text.insert(&mut document.transact_mut(), 0, title);
        document
            .transact()
            .encode_state_as_update_v1(&StateVector::default())
    }

    #[test]
    fn document_offsets_are_utf16_code_units() {
        let document = create_compatible_document("nodex-test");
        let text = document.get_or_insert_text("title");
        let mut transaction = document.transact_mut();
        text.insert(&mut transaction, 0, "A😀中");
        drop(transaction);

        let transaction = document.transact();
        assert_eq!(text.len(&transaction), 4);
        assert_eq!(text.get_string(&transaction), "A😀中");
    }

    #[test]
    fn incomplete_candidate_does_not_mutate_authority() {
        let engine = YrsDocumentEngine::new("pending-candidate");
        let before = engine.full_state_v1();
        let error = engine
            .prepare_update_v1(&fixture("missing-dependency.bin"))
            .err()
            .expect("missing dependency must be rejected");
        assert_eq!(error, YrsEngineError::MissingDependencies);
        assert_eq!(engine.full_state_v1(), before);
        assert!(engine.diagnostic().title.is_none());
    }

    #[test]
    fn duplicate_update_is_a_semantic_noop_without_observed_event() {
        let update = update_with_title("duplicate-source", "Nodex");
        let mut engine = YrsDocumentEngine::new("duplicate-target");
        let first = engine
            .commit_candidate(engine.prepare_update_v1(&update).expect("candidate"))
            .expect("commit");
        assert!(first.did_change);
        assert!(first.observed_update_v1.is_some());

        let duplicate = engine
            .commit_candidate(engine.prepare_update_v1(&update).expect("candidate"))
            .expect("commit");
        assert!(!duplicate.did_change);
        assert!(duplicate.observed_update_v1.is_none());
    }

    #[test]
    fn deletion_is_detected_and_observed_even_without_a_new_client_clock() {
        let source = create_compatible_document("delete-source");
        let title = source.get_or_insert_text("title");
        title.insert(&mut source.transact_mut(), 0, "Nodex");
        let base_vector = source.transact().state_vector();
        let base = source
            .transact()
            .encode_state_as_update_v1(&StateVector::default());
        title.remove_range(&mut source.transact_mut(), 0, 1);
        let deletion = source.transact().encode_diff_v1(&base_vector);

        let mut engine =
            YrsDocumentEngine::from_full_state_v1("delete-target", &base).expect("base document");
        let before_vector = engine.state_vector_v1();
        let commit = engine
            .commit_candidate(engine.prepare_update_v1(&deletion).expect("candidate"))
            .expect("commit");

        assert!(commit.did_change);
        assert!(commit.observed_update_v1.is_some());
        assert_eq!(commit.state_vector_v1, before_vector);
        assert_eq!(engine.diagnostic().title.as_deref(), Some("odex"));
    }

    #[test]
    fn candidate_commit_rejects_an_authority_that_advanced() {
        let first = update_with_title("stale-source-one", "one");
        let second = update_with_title("stale-source-two", "two");
        let mut engine = YrsDocumentEngine::new("stale-target");
        let first_candidate = engine.prepare_update_v1(&first).expect("first candidate");
        let stale_candidate = engine.prepare_update_v1(&second).expect("second candidate");
        engine
            .commit_candidate(first_candidate)
            .expect("first candidate commits");

        let error = engine
            .commit_candidate(stale_candidate)
            .expect_err("second candidate is stale");
        assert_eq!(error, YrsEngineError::CandidateStale);
    }

    #[test]
    fn state_vectors_compare_semantically_and_accept_zero_byte_default() {
        let engine = YrsDocumentEngine::new("empty-vector");
        assert!(engine.state_vector_equals_v1(&[]).expect("empty vector"));
        assert!(
            engine
                .state_vector_equals_v1(&StateVector::default().encode_v1())
                .expect("encoded empty vector")
        );
    }

    #[test]
    fn awareness_add_update_and_remove_are_y_protocol_compatible() {
        let mut source = DocumentAwareness::new("awareness-source");
        let mut target = DocumentAwareness::new("awareness-target");
        let source_client = source.client_id();

        source
            .set_local_state(&serde_json::json!({"name": "Nodex"}))
            .expect("set state");
        let added = target
            .apply_update_v1(&source.local_update_v1().expect("join update"))
            .expect("apply join")
            .expect("join changes state");
        assert_eq!(added.added, vec![source_client]);
        assert_eq!(
            target.state(source_client),
            Some(serde_json::json!({"name": "Nodex"}))
        );

        source
            .set_local_state(&serde_json::json!({"name": "Nodex Core"}))
            .expect("update state");
        let updated = target
            .apply_update_v1(&source.local_update_v1().expect("state update"))
            .expect("apply state update")
            .expect("state update changes state");
        assert_eq!(updated.updated, vec![source_client]);

        source.clear_local_state();
        let removed = target
            .apply_update_v1(&source.local_update_v1().expect("leave update"))
            .expect("apply leave")
            .expect("leave changes state");
        assert_eq!(removed.removed, vec![source_client]);
        assert_eq!(target.state(source_client), None);
    }
}
