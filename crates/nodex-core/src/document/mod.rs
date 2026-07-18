mod block_document;
mod materialization;
mod operations;
mod yrs_engine;

pub use block_document::{
    BlockDocumentError, BlockDocumentSchema, DecodedBlockDocument, PAGE_SCHEMA_KEY,
    PAGE_SCHEMA_VERSION, REUSABLE_TEMPLATE_SCHEMA_KEY, REUSABLE_TEMPLATE_SCHEMA_VERSION,
    SYNCED_BLOCK_SCHEMA_KEY, SYNCED_BLOCK_SCHEMA_VERSION, decode_block_document,
    encode_block_document,
};
pub use materialization::{
    BlockDocumentKind, BlockDocumentSchemaMetadata, DocumentBlockSearchUnit,
    DocumentMaterialization, DocumentMaterializationError, DocumentSearchMarkerKind,
    materialize_decoded_document, schema_metadata,
};
pub use operations::{
    DocumentBlockOperation, DocumentBlockUpdatePatch, DocumentOperationError,
    DocumentOperationErrorCode, MAX_DOCUMENT_OPERATION_BATCH_SIZE, PreparedDocumentOperationUpdate,
    prepare_document_operation_update,
};
pub use yrs_engine::{
    AwarenessChange, CandidateCommit, DocumentAwareness, MAX_AWARENESS_UPDATE_BYTES,
    MAX_DOCUMENT_UPDATE_BYTES, MAX_STATE_VECTOR_BYTES, YrsDiagnostic, YrsDocumentEngine,
    YrsEngineError, YrsUpdateCandidate, create_compatible_document, decode_state_vector_v1,
    has_pending_dependencies,
};

#[derive(Default)]
pub struct OwnedDocumentModule;
