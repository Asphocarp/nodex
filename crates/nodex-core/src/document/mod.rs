mod block_document;
mod canvas;
mod canvas_scene;
mod compaction;
pub(crate) mod event_log;
mod genesis;
mod history;
mod maintenance;
mod materialization;
mod module;
mod nfm_input;
mod operations;
mod owners;
mod persistence;
mod primary_canvas;
mod realtime;
mod recovery;
mod retention;
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
pub(crate) use maintenance::{
    compact_eligible_documents, finalize_idle_document_revisions, prune_document_history_pass,
};
pub use materialization::{
    BlockDocumentKind, BlockDocumentSchemaMetadata, DocumentBlockSearchUnit,
    DocumentMaterialization, DocumentMaterializationError, DocumentSearchMarkerKind,
    materialize_decoded_document, schema_metadata,
};
pub(crate) use materialization::{
    derive_document_node_delta, derive_document_placement_delta,
    exact_moves_explain_document_placement,
};
pub(crate) use module::require_owned_document_read_access;
pub use module::{
    CanvasSceneSyncSnapshot, DocumentCacheMetrics, OwnedDocumentApplyOutcome, OwnedDocumentModule,
};
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
    AwarenessPublication, DocumentRealtimeEvent, DocumentSubscriptionAck,
    DocumentSubscriptionEngine, OwnedDocumentRealtimeAdapter,
};
pub(crate) use retention::run_block_retention_pass;
pub(crate) use runtime::DocumentRuntimeCache;
pub use yrs_engine::{
    AwarenessChange, CandidateCommit, DocumentAwareness, MAX_AWARENESS_UPDATE_BYTES,
    MAX_DOCUMENT_UPDATE_BYTES, MAX_STATE_VECTOR_BYTES, YrsDiagnostic, YrsDocumentEngine,
    YrsEngineError, YrsUpdateCandidate, create_compatible_document, decode_state_vector_v1,
    has_pending_dependencies,
};

pub(crate) use canvas::{
    clone_canvas_genesis, ensure_canvas_scene, load_canvas_scene, load_v94_canvas_scene,
};
pub(crate) use canvas_scene::{
    CANVAS_OWNER_TYPE, CANVAS_SCENE_HASH_VERSION, CANVAS_SCHEMA_KEY, CANVAS_SCHEMA_VERSION,
    CanvasHashItemKind, CanvasScene, canvas_hash_bucket, canvas_semantic_intent_fingerprint,
    compute_canvas_scene_incremental_metadata, derive_canvas_element,
};
pub(crate) use genesis::{
    PreparedYjsGenesis, prepare_page_yjs_genesis, prepare_page_yjs_genesis_with_content,
    prepare_yjs_clone_genesis,
};
pub(crate) use history::{NewDocumentCheckpoint, insert_document_checkpoint};
#[cfg(test)]
pub(crate) use persistence::persist_yjs_genesis;
pub(crate) use persistence::{
    DocumentAuthorityRow, DocumentPlacementEvidence, PersistYjsCommit, PersistYjsGenesis,
    persist_yjs_commit_with_local_commit, persist_yjs_genesis_with_local_commit,
    read_document_authority, read_legacy_project_owned_document_authority, read_store_epoch,
    rebuild_legacy_import_projections, sha256,
};
pub(crate) use primary_canvas::{
    PrimaryCanvasIdentity, create_primary_canvas, is_primary_canvas_block_id,
    primary_canvas_block_id, primary_canvas_document_id,
};
pub(crate) use runtime::reconstruct_yjs_engine;
pub(crate) use semantic::{
    mint_document_projection_etags, mint_document_semantic_etags, mint_etag,
    parse_inline_markdown_title,
};
