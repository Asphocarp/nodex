use serde::{Deserialize, Serialize};
use thiserror::Error;

use super::block_materialization::MaterializedBlockNode;
use super::block_tree::MAX_BLOCK_ID_LENGTH;
use super::nfm::{NfmBlock, NfmInlineContent, parse_page_deep_link};

const MAX_REFERENCE_DISPLAY_HINT_LENGTH: usize = 512;
const NODEX_ASSET_SCHEME: &str = "nodex://assets/";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum BlockDocumentReference {
    #[serde(rename = "page")]
    Page {
        #[serde(rename = "sourceBlockId")]
        source_block_id: String,
        #[serde(rename = "targetPageId")]
        target_page_id: String,
        presentation: PageReferencePresentation,
        #[serde(rename = "occurrenceCount")]
        occurrence_count: u32,
    },
    #[serde(rename = "block")]
    Block {
        #[serde(rename = "sourceBlockId")]
        source_block_id: String,
        #[serde(rename = "targetBlockId")]
        target_block_id: String,
        #[serde(rename = "displayHint", skip_serializing_if = "Option::is_none")]
        display_hint: Option<String>,
    },
    #[serde(rename = "database_view")]
    DatabaseView {
        #[serde(rename = "sourceBlockId")]
        source_block_id: String,
        #[serde(rename = "databaseViewId")]
        database_view_id: String,
        #[serde(rename = "displayHint", skip_serializing_if = "Option::is_none")]
        display_hint: Option<String>,
    },
    #[serde(rename = "thread")]
    Thread {
        #[serde(rename = "sourceBlockId")]
        source_block_id: String,
        #[serde(rename = "targetThreadId")]
        target_thread_id: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PageReferencePresentation {
    Mention,
    ReferenceBlock,
    Link,
}

impl BlockDocumentReference {
    pub(crate) fn target_block_id(&self) -> Option<&str> {
        match self {
            Self::Page { target_page_id, .. } => Some(target_page_id),
            Self::Block {
                target_block_id, ..
            } => Some(target_block_id),
            Self::DatabaseView { .. } | Self::Thread { .. } => None,
        }
    }

    pub(crate) fn database_view_id(&self) -> Option<&str> {
        match self {
            Self::DatabaseView {
                database_view_id, ..
            } => Some(database_view_id),
            Self::Page { .. } | Self::Block { .. } | Self::Thread { .. } => None,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BlockDocumentAssetKind {
    Image,
    Attachment,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockDocumentAssetReference {
    pub source_block_id: String,
    pub kind: BlockDocumentAssetKind,
    pub source: String,
    pub managed_file_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockDocumentDerivedRecords {
    pub references: Vec<BlockDocumentReference>,
    pub asset_refs: Vec<BlockDocumentAssetReference>,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum DerivedRecordsError {
    #[error("NFM projection does not match the materialized Block tree")]
    ShapeMismatch,
    #[error(
        "{label} must be a non-empty stable identity no longer than {MAX_BLOCK_ID_LENGTH} characters"
    )]
    InvalidReferenceId { label: &'static str },
    #[error(
        "Reference display hints must not exceed {MAX_REFERENCE_DISPLAY_HINT_LENGTH} characters"
    )]
    DisplayHintTooLong,
    #[error("Owning {block_type} NFM uuid {uuid} does not match Block {block_id}")]
    OwningBlockIdentity {
        block_type: &'static str,
        uuid: String,
        block_id: String,
    },
}

pub fn derive_block_document_records(
    block_tree: &[MaterializedBlockNode],
    nfm_blocks: &[NfmBlock],
) -> Result<BlockDocumentDerivedRecords, DerivedRecordsError> {
    let mut records = BlockDocumentDerivedRecords {
        references: Vec::new(),
        asset_refs: Vec::new(),
    };
    collect_records(block_tree, nfm_blocks, &mut records)?;
    Ok(records)
}

fn collect_records(
    block_tree: &[MaterializedBlockNode],
    nfm_blocks: &[NfmBlock],
    records: &mut BlockDocumentDerivedRecords,
) -> Result<(), DerivedRecordsError> {
    if block_tree.len() != nfm_blocks.len() {
        return Err(DerivedRecordsError::ShapeMismatch);
    }
    for (block, nfm) in block_tree.iter().zip(nfm_blocks) {
        if let Some(content) = nfm_content(nfm) {
            collect_inline_records(&block.id, content, records);
        }
        match nfm {
            NfmBlock::Table { rows, .. } => {
                for row in rows {
                    for cell in &row.cells {
                        collect_inline_records(&block.id, &cell.content, records);
                    }
                }
            }
            NfmBlock::Image {
                source, caption, ..
            } => {
                collect_inline_records(&block.id, caption, records);
                append_asset_reference(
                    &mut records.asset_refs,
                    &block.id,
                    BlockDocumentAssetKind::Image,
                    source,
                );
            }
            NfmBlock::Page { uuid } if uuid != &block.id => {
                return Err(DerivedRecordsError::OwningBlockIdentity {
                    block_type: "Page",
                    uuid: uuid.clone(),
                    block_id: block.id.clone(),
                });
            }
            NfmBlock::Database { uuid } if uuid != &block.id => {
                return Err(DerivedRecordsError::OwningBlockIdentity {
                    block_type: "Database",
                    uuid: uuid.clone(),
                    block_id: block.id.clone(),
                });
            }
            NfmBlock::PageRef { target_block_id } => {
                assert_reference_id(target_block_id, "targetBlockId")?;
                append_page_reference(
                    &mut records.references,
                    block.id.clone(),
                    target_block_id.clone(),
                    PageReferencePresentation::ReferenceBlock,
                );
            }
            NfmBlock::DatabaseViewRef {
                database_view_id,
                display_hint,
            } => {
                assert_reference_id(database_view_id, "databaseViewId")?;
                records
                    .references
                    .push(BlockDocumentReference::DatabaseView {
                        source_block_id: block.id.clone(),
                        database_view_id: database_view_id.clone(),
                        display_hint: read_display_hint(display_hint)?,
                    });
            }
            NfmBlock::SyncedBlockRef { source_block_id } => {
                assert_reference_id(source_block_id, "sourceBlockId")?;
                records.references.push(BlockDocumentReference::Block {
                    source_block_id: block.id.clone(),
                    target_block_id: source_block_id.clone(),
                    display_hint: None,
                });
            }
            NfmBlock::TemplateRef {
                source_block_id,
                display_hint,
            } => {
                assert_reference_id(source_block_id, "sourceBlockId")?;
                records.references.push(BlockDocumentReference::Block {
                    source_block_id: block.id.clone(),
                    target_block_id: source_block_id.clone(),
                    display_hint: read_display_hint(display_hint)?,
                });
            }
            _ => {}
        }

        collect_records(&block.children, nfm_children(nfm), records)?;
    }
    Ok(())
}

fn nfm_content(block: &NfmBlock) -> Option<&[NfmInlineContent]> {
    match block {
        NfmBlock::Paragraph { content, .. }
        | NfmBlock::Heading { content, .. }
        | NfmBlock::BulletListItem { content, .. }
        | NfmBlock::NumberedListItem { content, .. }
        | NfmBlock::CheckListItem { content, .. }
        | NfmBlock::Toggle { content, .. }
        | NfmBlock::Blockquote { content, .. }
        | NfmBlock::Callout { content, .. } => Some(content),
        _ => None,
    }
}

fn nfm_children(block: &NfmBlock) -> &[NfmBlock] {
    match block {
        NfmBlock::Paragraph { children, .. }
        | NfmBlock::EmptyBlock { children }
        | NfmBlock::Heading { children, .. }
        | NfmBlock::BulletListItem { children, .. }
        | NfmBlock::NumberedListItem { children, .. }
        | NfmBlock::CheckListItem { children, .. }
        | NfmBlock::Toggle { children, .. }
        | NfmBlock::Blockquote { children, .. }
        | NfmBlock::CodeBlock { children, .. }
        | NfmBlock::Callout { children, .. }
        | NfmBlock::Image { children, .. }
        | NfmBlock::ThreadSection { children, .. }
        | NfmBlock::Divider { children } => children,
        _ => &[],
    }
}

fn collect_inline_records(
    source_block_id: &str,
    content: &[NfmInlineContent],
    records: &mut BlockDocumentDerivedRecords,
) {
    for item in content {
        match item {
            NfmInlineContent::PageMention { target_page_id } => {
                append_page_reference(
                    &mut records.references,
                    source_block_id.to_owned(),
                    target_page_id.clone(),
                    PageReferencePresentation::Mention,
                );
            }
            NfmInlineContent::Link { href, .. } => {
                if let Some(target_page_id) = parse_page_deep_link(href) {
                    append_page_reference(
                        &mut records.references,
                        source_block_id.to_owned(),
                        target_page_id,
                        PageReferencePresentation::Link,
                    );
                }
            }
            NfmInlineContent::ThreadMention { uuid } => {
                records.references.push(BlockDocumentReference::Thread {
                    source_block_id: source_block_id.to_owned(),
                    target_thread_id: uuid.clone(),
                });
            }
            NfmInlineContent::Attachment { source, .. } => append_asset_reference(
                &mut records.asset_refs,
                source_block_id,
                BlockDocumentAssetKind::Attachment,
                source,
            ),
            _ => {}
        }
    }
}

fn append_page_reference(
    references: &mut Vec<BlockDocumentReference>,
    source_block_id: String,
    target_page_id: String,
    presentation: PageReferencePresentation,
) {
    if let Some(BlockDocumentReference::Page {
        occurrence_count, ..
    }) = references.iter_mut().find(|reference| {
        matches!(
            reference,
            BlockDocumentReference::Page {
                source_block_id: existing_source,
                target_page_id: existing_target,
                presentation: existing_presentation,
                ..
            } if existing_source == &source_block_id
                && existing_target == &target_page_id
                && *existing_presentation == presentation
        )
    }) {
        *occurrence_count = occurrence_count.saturating_add(1);
        return;
    }
    references.push(BlockDocumentReference::Page {
        source_block_id,
        target_page_id,
        presentation,
        occurrence_count: 1,
    });
}

fn append_asset_reference(
    output: &mut Vec<BlockDocumentAssetReference>,
    source_block_id: &str,
    kind: BlockDocumentAssetKind,
    source: &str,
) {
    if source.is_empty() {
        return;
    }
    output.push(BlockDocumentAssetReference {
        source_block_id: source_block_id.to_owned(),
        kind,
        source: source.to_owned(),
        managed_file_name: parse_asset_source(source),
    });
}

fn assert_reference_id(value: &str, label: &'static str) -> Result<(), DerivedRecordsError> {
    if value.is_empty() || value.trim() != value || value.len() > MAX_BLOCK_ID_LENGTH {
        return Err(DerivedRecordsError::InvalidReferenceId { label });
    }
    Ok(())
}

fn read_display_hint(value: &Option<String>) -> Result<Option<String>, DerivedRecordsError> {
    let Some(value) = value.as_ref().filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    if value.len() > MAX_REFERENCE_DISPLAY_HINT_LENGTH {
        return Err(DerivedRecordsError::DisplayHintTooLong);
    }
    Ok(Some(value.clone()))
}

pub(crate) fn parse_asset_source(source: &str) -> Option<String> {
    let encoded = source.strip_prefix(NODEX_ASSET_SCHEME)?;
    if encoded.is_empty() || encoded.contains('/') {
        return None;
    }
    let decoded = percent_decode(encoded)?;
    decoded
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-'))
        .then_some(decoded)
}

fn percent_decode(input: &str) -> Option<String> {
    let bytes = input.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0usize;
    while index < bytes.len() {
        if bytes[index] != b'%' {
            output.push(bytes[index]);
            index += 1;
            continue;
        }
        let high = *bytes.get(index + 1)?;
        let low = *bytes.get(index + 2)?;
        output.push(hex_value(high)? * 16 + hex_value(low)?);
        index += 3;
    }
    String::from_utf8(output).ok()
}

fn hex_value(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use serde_json::Value;
    use yrs::updates::decoder::Decode;
    use yrs::{ReadTxn, Transact, Update};

    use crate::document::create_compatible_document;
    use crate::domain::block_materialization::materialize_block_tree;
    use crate::domain::block_tree::decode_block_tree;
    use crate::domain::nfm::materialize_nfm;

    use super::*;

    #[test]
    fn matches_the_typescript_reference_and_asset_oracle() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/yjs-yrs");
        let document = create_compatible_document("derived-record-matrix");
        let update = std::fs::read(root.join("matrix-base.bin")).expect("matrix fixture");
        document
            .transact_mut()
            .apply_update(Update::decode_v1(&update).expect("valid fixture"))
            .expect("fixture applies");
        let transaction = document.transact();
        let body = transaction.get_xml_fragment("body").expect("body root");
        let tree = decode_block_tree(&body, &transaction).expect("BlockTree");
        let blocks = materialize_block_tree(&tree).expect("BlockNote materialization");
        let nfm = materialize_nfm(&blocks).expect("NFM materialization");
        let actual = serde_json::to_value(
            derive_block_document_records(&blocks, &nfm.blocks).expect("derived records"),
        )
        .expect("serialize derived records");
        let expected: Value = serde_json::from_slice(
            &std::fs::read(root.join("matrix-materialization.json")).expect("oracle fixture"),
        )
        .expect("valid oracle fixture");

        assert_eq!(actual["references"], expected["references"]);
        assert_eq!(actual["assetRefs"], expected["assetRefs"]);
    }

    #[test]
    fn accepts_only_safe_managed_asset_sources() {
        assert_eq!(
            parse_asset_source("nodex://assets/example%2Etxt"),
            Some("example.txt".to_owned())
        );
        assert_eq!(parse_asset_source("nodex://assets/../secret"), None);
        assert_eq!(parse_asset_source("https://nodex.local/example.txt"), None);
    }
}
