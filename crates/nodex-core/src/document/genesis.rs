use std::collections::BTreeMap;

use serde_json::{Value, json};
use yrs::updates::encoder::Encode;
use yrs::{ReadTxn, Transact};

use crate::domain::block_materialization::{MaterializedBlockNode, dematerialize_block_tree};
use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};

use super::operations::{DocumentBlockOperation, PreparedDocumentOperationUpdate};
use super::{
    BlockDocumentSchema, DocumentMaterialization, YrsDocumentEngine, decode_block_document,
    encode_block_document, materialize_decoded_document, prepare_document_operation_update,
};

pub(crate) struct PreparedYjsGenesis {
    pub(crate) engine: YrsDocumentEngine,
    pub(crate) materialization: DocumentMaterialization,
    pub(crate) update_v1: Vec<u8>,
    pub(crate) state_vector_v1: Vec<u8>,
}

pub(crate) fn prepare_yjs_genesis(
    document_id: &str,
    owner_type: &str,
    schema: BlockDocumentSchema,
    root_block_id: &str,
) -> Result<PreparedYjsGenesis, StoreError> {
    let tree = dematerialize_block_tree(&[empty_paragraph(root_block_id)])
        .map_err(|error| invalid(format!("Document genesis Block is invalid: {error}")))?;
    let document = encode_block_document(document_id, schema, None, &tree)
        .map_err(|error| invalid(format!("Document genesis is invalid: {error}")))?;
    let decoded = decode_block_document(&document, schema)
        .map_err(|error| invalid(format!("Document genesis schema is invalid: {error}")))?;
    let materialization = materialize_decoded_document(&decoded)
        .map_err(|error| invalid(format!("Document genesis cannot materialize: {error}")))?;
    if materialization.schema.owner_type != owner_type {
        return Err(StoreError::new(
            StoreErrorCode::UnsupportedSchema,
            "Document owner type does not match its registered schema",
            false,
        ));
    }
    let transaction = document.transact();
    let state_vector_v1 = transaction.state_vector().encode_v1();
    let update_v1 = transaction.encode_state_as_update_v1(&yrs::StateVector::default());
    drop(transaction);
    let engine = YrsDocumentEngine::from_full_state_v1(document_id, &update_v1)
        .map_err(|error| invalid(format!("Document genesis update is invalid: {error}")))?;
    Ok(PreparedYjsGenesis {
        engine,
        materialization,
        update_v1,
        state_vector_v1,
    })
}

pub(crate) fn prepare_yjs_genesis_with_blocks(
    document_id: &str,
    owner_type: &str,
    schema: BlockDocumentSchema,
    blocks: &[MaterializedBlockNode],
) -> Result<PreparedYjsGenesis, StoreError> {
    let tree = dematerialize_block_tree(blocks)
        .map_err(|error| invalid(format!("Document genesis Blocks are invalid: {error}")))?;
    let document = encode_block_document(document_id, schema, None, &tree)
        .map_err(|error| invalid(format!("Document genesis is invalid: {error}")))?;
    let decoded = decode_block_document(&document, schema)
        .map_err(|error| invalid(format!("Document genesis schema is invalid: {error}")))?;
    let materialization = materialize_decoded_document(&decoded)
        .map_err(|error| invalid(format!("Document genesis cannot materialize: {error}")))?;
    if materialization.schema.owner_type != owner_type {
        return Err(StoreError::new(
            StoreErrorCode::UnsupportedSchema,
            "Document owner type does not match its registered schema",
            false,
        ));
    }
    let transaction = document.transact();
    let state_vector_v1 = transaction.state_vector().encode_v1();
    let update_v1 = transaction.encode_state_as_update_v1(&yrs::StateVector::default());
    drop(transaction);
    let engine = YrsDocumentEngine::from_full_state_v1(document_id, &update_v1)
        .map_err(|error| invalid(format!("Document genesis update is invalid: {error}")))?;
    Ok(PreparedYjsGenesis {
        engine,
        materialization,
        update_v1,
        state_vector_v1,
    })
}

pub(crate) fn prepare_editable_root(
    document_id: &str,
    schema: BlockDocumentSchema,
    engine: &YrsDocumentEngine,
    root_block_id: &str,
) -> Result<Option<PreparedDocumentOperationUpdate>, StoreError> {
    let decoded = decode_block_document(engine.document(), schema)
        .map_err(|error| corrupt(format!("Owned Document schema is invalid: {error}")))?;
    if !decoded.block_tree.blocks.is_empty() {
        return Ok(None);
    }
    prepare_document_operation_update(
        document_id,
        schema,
        &engine.full_state_v1(),
        &engine.state_vector_v1(),
        &[DocumentBlockOperation::InsertBlock {
            block: empty_paragraph(root_block_id),
            parent_block_id: None,
            before_block_id: None,
        }],
        false,
    )
    .map(Some)
    .map_err(|error| {
        invalid(format!(
            "Editable Document root could not be prepared: {error}"
        ))
    })
}

fn empty_paragraph(block_id: &str) -> MaterializedBlockNode {
    MaterializedBlockNode {
        id: block_id.to_owned(),
        block_type: "paragraph".to_owned(),
        props: BTreeMap::from([
            ("backgroundColor".to_owned(), json!("default")),
            ("textColor".to_owned(), json!("default")),
            ("textAlignment".to_owned(), json!("left")),
        ]),
        content: Some(Value::Array(Vec::new())),
        children: Vec::new(),
    }
}

fn invalid(message: String) -> StoreError {
    StoreError::new(StoreErrorCode::InvalidInput, message, false)
}

fn corrupt(message: String) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message, false)
}
