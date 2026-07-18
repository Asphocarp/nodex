mod block_document;
mod canvas;
mod canvas_scene;
mod compaction;
mod event_log;
mod genesis;
mod history;
mod materialization;
mod module;
mod operations;
mod owners;
mod persistence;
mod realtime;
mod recovery;
mod runtime;
mod semantic;
mod yrs_engine;

pub use block_document::{
    BlockDocumentError, BlockDocumentSchema, DecodedBlockDocument, PAGE_SCHEMA_KEY,
    PAGE_SCHEMA_VERSION, REUSABLE_TEMPLATE_SCHEMA_KEY, REUSABLE_TEMPLATE_SCHEMA_VERSION,
    SYNCED_BLOCK_SCHEMA_KEY, SYNCED_BLOCK_SCHEMA_VERSION, decode_block_document,
    encode_block_document,
};
pub use compaction::DocumentCompactionResult;
pub use materialization::{
    BlockDocumentKind, BlockDocumentSchemaMetadata, DocumentBlockSearchUnit,
    DocumentMaterialization, DocumentMaterializationError, DocumentSearchMarkerKind,
    materialize_decoded_document, schema_metadata,
};
pub use module::{DocumentCacheMetrics, OwnedDocumentApplyOutcome, OwnedDocumentModule};
pub use operations::{
    DocumentBlockOperation, DocumentBlockUpdatePatch, DocumentOperationError,
    DocumentOperationErrorCode, ExactNfmPatch, MAX_DOCUMENT_OPERATION_BATCH_SIZE,
    PortableSubtreeDocumentHead, PortableSubtreeTransferKind, PortableSubtreeTransferRequest,
    PreparedDocumentOperationUpdate, PreparedPortableSubtreeTransfer, apply_exact_nfm_patches,
    prepare_document_operation_update, prepare_exact_nfm_patch_update,
    prepare_nfm_replacement_update, prepare_portable_subtree_transfer_updates,
    prepare_reference_hint_finalization_update,
};
pub use realtime::{
    AwarenessPublication, DocumentRealtimeEvent, DocumentRealtimeReplay, DocumentSubscriptionAck,
    DocumentSubscriptionEngine, OwnedDocumentRealtimeAdapter,
};
pub use yrs_engine::{
    AwarenessChange, CandidateCommit, DocumentAwareness, MAX_AWARENESS_UPDATE_BYTES,
    MAX_DOCUMENT_UPDATE_BYTES, MAX_STATE_VECTOR_BYTES, YrsDiagnostic, YrsDocumentEngine,
    YrsEngineError, YrsUpdateCandidate, create_compatible_document, decode_state_vector_v1,
    has_pending_dependencies,
};

pub(crate) use genesis::prepare_page_yjs_genesis;
pub(crate) use persistence::{
    PersistYjsGenesis, persist_yjs_genesis, read_document_authority, read_store_epoch, sha256,
};
