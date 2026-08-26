use crate::domain::block_children::normalize_block_children_forest;
use crate::domain::block_materialization::{
    MaterializedBlockNode, dematerialize_block_tree_allowing_illegal_children,
    materialize_block_tree,
};
use crate::domain::rich_text::rich_text_to_delta;
use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};

use super::{
    BlockDocumentSchema, DecodedBlockDocument, DocumentMaterialization,
    materialize_decoded_document,
};

/// Resolves both current identities and the one published Block-children
/// migration baseline. Durable clipboard and Undo capabilities retain their
/// original bytes and hashes, so compatibility happens only after those bytes
/// have been authenticated.
pub(crate) fn current_schema_for_stored_identity(
    schema_key: &str,
    schema_version: i64,
) -> Result<BlockDocumentSchema, StoreError> {
    if let Some(schema) = BlockDocumentSchema::from_identity(schema_key, schema_version) {
        return Ok(schema);
    }
    match (schema_key, schema_version) {
        ("nodex.page", 2) => Ok(BlockDocumentSchema::PageV3),
        ("nodex.synced-block", 1) => Ok(BlockDocumentSchema::SyncedBlockV2),
        ("nodex.reusable-template", 1) => Ok(BlockDocumentSchema::ReusableTemplateV2),
        _ => Err(StoreError::new(
            StoreErrorCode::UnsupportedSchema,
            format!("Stored Document schema {schema_key}@{schema_version} is unsupported"),
            false,
        )),
    }
}

pub(crate) fn normalize_stored_materialized_forest(
    blocks: &[MaterializedBlockNode],
) -> Result<Vec<MaterializedBlockNode>, StoreError> {
    let tree = dematerialize_block_tree_allowing_illegal_children(blocks).map_err(corrupt)?;
    let normalized = normalize_block_children_forest(tree.blocks);
    materialize_block_tree(&crate::domain::block_tree::BlockTree {
        root_attributes: tree.root_attributes,
        blocks: normalized.blocks,
    })
    .map_err(corrupt)
}

/// Re-derives the full current materialization instead of editing only schema
/// metadata. This keeps NFM, search, references, assets, and Block coordinates
/// mutually consistent after child lifting.
pub(crate) fn normalize_stored_document_materialization(
    document_id: &str,
    schema: BlockDocumentSchema,
    stored: &DocumentMaterialization,
) -> Result<DocumentMaterialization, StoreError> {
    let blocks = normalize_stored_materialized_forest(&stored.block_tree)?;
    let block_tree =
        dematerialize_block_tree_allowing_illegal_children(&blocks).map_err(corrupt)?;
    let title = schema
        .has_title()
        .then(|| rich_text_to_delta(&stored.rich_title))
        .transpose()
        .map_err(corrupt)?;
    materialize_decoded_document(&DecodedBlockDocument {
        document_id: document_id.to_owned(),
        schema,
        title,
        block_tree,
    })
    .map_err(corrupt)
}

fn corrupt(error: impl std::fmt::Display) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, error.to_string(), false)
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use serde_json::json;

    use super::*;

    fn block(
        id: &str,
        block_type: &str,
        children: Vec<MaterializedBlockNode>,
    ) -> MaterializedBlockNode {
        MaterializedBlockNode {
            id: id.to_owned(),
            block_type: block_type.to_owned(),
            props: BTreeMap::new(),
            content: Some(json!([])),
            children,
        }
    }

    #[test]
    fn authenticated_baseline_payloads_adapt_to_the_current_schema_without_rewriting() {
        assert_eq!(
            current_schema_for_stored_identity("nodex.page", 2).expect("baseline Page"),
            BlockDocumentSchema::PageV3
        );
        assert_eq!(
            current_schema_for_stored_identity("nodex.synced-block", 1)
                .expect("baseline synced Block"),
            BlockDocumentSchema::SyncedBlockV2
        );
        assert_eq!(
            current_schema_for_stored_identity("nodex.reusable-template", 1)
                .expect("baseline template"),
            BlockDocumentSchema::ReusableTemplateV2
        );

        let stored = vec![block(
            "code",
            "codeBlock",
            vec![block("lifted", "paragraph", Vec::new())],
        )];
        let normalized =
            normalize_stored_materialized_forest(&stored).expect("current Block forest");
        assert_eq!(
            normalized
                .iter()
                .map(|block| block.id.as_str())
                .collect::<Vec<_>>(),
            ["code", "lifted"]
        );
        assert_eq!(stored[0].children[0].id, "lifted");
    }
}
