mod yrs_engine;

pub use yrs_engine::{
    AwarenessChange, CandidateCommit, DocumentAwareness, MAX_AWARENESS_UPDATE_BYTES,
    MAX_DOCUMENT_UPDATE_BYTES, MAX_STATE_VECTOR_BYTES, YrsDiagnostic, YrsDocumentEngine,
    YrsEngineError, YrsUpdateCandidate, create_compatible_document, decode_state_vector_v1,
    has_pending_dependencies,
};

#[derive(Default)]
pub struct OwnedDocumentModule;
