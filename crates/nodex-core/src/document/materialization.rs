use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::domain::block_materialization::{
    BlockMaterializationError, MaterializedBlockNode, materialize_block_tree,
};
use crate::domain::block_tree::scan_block_tree;
use crate::domain::derived_records::{
    BlockDocumentAssetReference, BlockDocumentReference, DerivedRecordsError,
    derive_block_document_records,
};
use crate::domain::nfm::{NfmMaterializationError, materialize_nfm};
use crate::domain::rich_text::{
    RichTextError, RichTextItem, RichTextMaterialization, materialize_rich_text,
};

use super::{
    BlockDocumentSchema, DecodedBlockDocument, PAGE_SCHEMA_KEY, REUSABLE_TEMPLATE_SCHEMA_KEY,
    SYNCED_BLOCK_SCHEMA_KEY,
};

const PAGE_OWNER_TYPE: &str = "page";
const SYNCED_BLOCK_OWNER_TYPE: &str = "synced_block_source";
const REUSABLE_TEMPLATE_OWNER_TYPE: &str = "reusable_template_source";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BlockDocumentKind {
    Page,
    SyncedBlock,
    ReusableTemplate,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DocumentSearchMarkerKind {
    DocumentTitle,
    DocumentMarker,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockDocumentSchemaMetadata {
    pub kind: BlockDocumentKind,
    pub owner_type: String,
    pub schema_key: String,
    pub schema_version: u32,
    pub title: bool,
    pub nfm_genesis: bool,
    pub nfm_replace: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentBlockSearchUnit {
    pub block_id: String,
    pub parent_block_id: Option<String>,
    pub ordinal: usize,
    pub block_type: String,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentMaterialization {
    pub kind: BlockDocumentKind,
    pub schema: BlockDocumentSchemaMetadata,
    pub schema_version: u32,
    pub title: String,
    pub rich_title: Vec<RichTextItem>,
    pub block_tree: Vec<MaterializedBlockNode>,
    pub nfm: String,
    pub plain_text: String,
    pub preview: String,
    pub references: Vec<BlockDocumentReference>,
    pub asset_refs: Vec<BlockDocumentAssetReference>,
    pub search_marker_kind: DocumentSearchMarkerKind,
    pub search_units: Vec<DocumentBlockSearchUnit>,
}

#[derive(Debug, Error, PartialEq)]
pub enum DocumentMaterializationError {
    #[error(transparent)]
    Blocks(#[from] BlockMaterializationError),
    #[error(transparent)]
    Nfm(#[from] NfmMaterializationError),
    #[error(transparent)]
    RichTitle(#[from] RichTextError),
    #[error(transparent)]
    DerivedRecords(#[from] DerivedRecordsError),
    #[error(
        "Reusable Template content cannot own nested document-bearing Block {block_id} ({block_type})"
    )]
    NestedDocumentBearingBlock {
        block_id: String,
        block_type: String,
    },
}

pub fn materialize_decoded_document(
    document: &DecodedBlockDocument,
) -> Result<DocumentMaterialization, DocumentMaterializationError> {
    validate_schema_specific_body(document)?;
    let block_tree = materialize_block_tree(&document.block_tree)?;
    let nfm = materialize_nfm(&block_tree)?;
    let records = derive_block_document_records(&block_tree, &nfm.blocks)?;
    let title = match &document.title {
        Some(title) => materialize_rich_text(title)?,
        None => RichTextMaterialization {
            rich_text: Vec::new(),
            plain_text: String::new(),
        },
    };
    let search_units = scan_block_tree(&document.block_tree)
        .into_iter()
        .enumerate()
        .map(|(ordinal, block)| DocumentBlockSearchUnit {
            block_id: block.id,
            parent_block_id: block.parent_block_id,
            ordinal,
            block_type: block.block_type,
            text: block.text,
        })
        .collect();
    let schema = schema_metadata(document.schema);

    Ok(DocumentMaterialization {
        kind: schema.kind,
        schema_version: schema.schema_version,
        title: title.plain_text,
        rich_title: title.rich_text,
        block_tree,
        nfm: nfm.nfm,
        plain_text: nfm.plain_text,
        preview: nfm.preview,
        references: records.references,
        asset_refs: records.asset_refs,
        search_marker_kind: if schema.title {
            DocumentSearchMarkerKind::DocumentTitle
        } else {
            DocumentSearchMarkerKind::DocumentMarker
        },
        search_units,
        schema,
    })
}

pub fn schema_metadata(schema: BlockDocumentSchema) -> BlockDocumentSchemaMetadata {
    match schema {
        BlockDocumentSchema::PageV1 | BlockDocumentSchema::PageV2 => BlockDocumentSchemaMetadata {
            kind: BlockDocumentKind::Page,
            owner_type: PAGE_OWNER_TYPE.to_owned(),
            schema_key: PAGE_SCHEMA_KEY.to_owned(),
            schema_version: schema.schema_version(),
            title: true,
            nfm_genesis: true,
            nfm_replace: true,
        },
        BlockDocumentSchema::SyncedBlockV1 => BlockDocumentSchemaMetadata {
            kind: BlockDocumentKind::SyncedBlock,
            owner_type: SYNCED_BLOCK_OWNER_TYPE.to_owned(),
            schema_key: SYNCED_BLOCK_SCHEMA_KEY.to_owned(),
            schema_version: schema.schema_version(),
            title: false,
            nfm_genesis: true,
            nfm_replace: false,
        },
        BlockDocumentSchema::ReusableTemplateV1 => BlockDocumentSchemaMetadata {
            kind: BlockDocumentKind::ReusableTemplate,
            owner_type: REUSABLE_TEMPLATE_OWNER_TYPE.to_owned(),
            schema_key: REUSABLE_TEMPLATE_SCHEMA_KEY.to_owned(),
            schema_version: schema.schema_version(),
            title: false,
            nfm_genesis: true,
            nfm_replace: false,
        },
    }
}

fn validate_schema_specific_body(
    document: &DecodedBlockDocument,
) -> Result<(), DocumentMaterializationError> {
    if document.schema != BlockDocumentSchema::ReusableTemplateV1 {
        return Ok(());
    }
    let block = scan_block_tree(&document.block_tree)
        .into_iter()
        .find(|block| {
            matches!(
                block.block_type.as_str(),
                "page" | SYNCED_BLOCK_OWNER_TYPE | REUSABLE_TEMPLATE_OWNER_TYPE
            )
        });
    let Some(block) = block else {
        return Ok(());
    };
    Err(DocumentMaterializationError::NestedDocumentBearingBlock {
        block_id: block.id,
        block_type: block.block_type,
    })
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use serde_json::Value;
    use yrs::updates::decoder::Decode;
    use yrs::{Transact, Update};

    use crate::document::{BlockDocumentSchema, create_compatible_document, decode_block_document};

    use super::*;

    fn page_matrix() -> (DocumentMaterialization, Value) {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/yjs-yrs");
        let document = create_compatible_document("document-materialization-matrix");
        let update = std::fs::read(root.join("matrix-base.bin")).expect("matrix fixture");
        document
            .transact_mut()
            .apply_update(Update::decode_v1(&update).expect("valid fixture"))
            .expect("fixture applies");
        let decoded = decode_block_document(&document, BlockDocumentSchema::PageV2)
            .expect("decoded Page document");
        let actual = materialize_decoded_document(&decoded).expect("materialization");
        let expected = serde_json::from_slice(
            &std::fs::read(root.join("matrix-materialization.json")).expect("oracle fixture"),
        )
        .expect("valid oracle fixture");
        (actual, expected)
    }

    #[test]
    fn atomically_matches_every_typescript_page_materialization_field() {
        let (actual, expected) = page_matrix();
        let actual = serde_json::to_value(actual).expect("serialize materialization");

        for field in [
            "schemaVersion",
            "title",
            "richTitle",
            "blockTree",
            "nfm",
            "plainText",
            "preview",
            "references",
            "assetRefs",
            "searchUnits",
        ] {
            assert_eq!(actual[field], expected[field], "field {field}");
        }
    }

    #[test]
    fn body_only_metadata_has_no_invented_title_capability() {
        let metadata = schema_metadata(BlockDocumentSchema::SyncedBlockV1);

        assert_eq!(metadata.kind, BlockDocumentKind::SyncedBlock);
        assert!(!metadata.title);
        assert!(!metadata.nfm_replace);
        assert_eq!(metadata.schema_key, "nodex.synced-block");
    }
}
