use thiserror::Error;

use crate::domain::block_materialization::MaterializedBlockNode;
use crate::domain::nfm::NfmBlock;
use crate::domain::nfm_parser::{
    NfmBlockMaterializationError, NfmParseError, materialize_nfm_blocks_with_ids, parse_nfm,
};

#[derive(Debug, Error, PartialEq, Eq)]
pub(crate) enum DocumentNfmInputError {
    #[error(transparent)]
    Parse(#[from] NfmParseError),
    #[error(transparent)]
    Materialization(#[from] NfmBlockMaterializationError),
    #[error(
        "Nested Markdown insertion must contain at least one Block; use <empty-block/> to insert an intentional empty Block"
    )]
    EmptyFragment,
}

pub(crate) fn materialize_document_nfm(
    input: &str,
    allocate_block_id: &mut impl FnMut() -> String,
) -> Result<Vec<MaterializedBlockNode>, DocumentNfmInputError> {
    let mut blocks = parse_nfm(input)?;
    if blocks.is_empty() {
        blocks.push(NfmBlock::EmptyBlock {
            children: Vec::new(),
        });
    }
    Ok(materialize_nfm_blocks_with_ids(&blocks, allocate_block_id)?)
}

pub(crate) fn materialize_nfm_fragment(
    input: &str,
    allocate_block_id: &mut impl FnMut() -> String,
) -> Result<Vec<MaterializedBlockNode>, DocumentNfmInputError> {
    let blocks = parse_nfm(input)?;
    if blocks.is_empty() {
        return Err(DocumentNfmInputError::EmptyFragment);
    }
    Ok(materialize_nfm_blocks_with_ids(&blocks, allocate_block_id)?)
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;

    use super::*;

    #[test]
    fn document_boundary_materializes_whitespace_as_one_editable_block() {
        let calls = Cell::new(0);
        let blocks = materialize_document_nfm("\n \t\n", &mut || {
            calls.set(calls.get() + 1);
            "seed".to_owned()
        })
        .expect("empty Document");

        assert_eq!(blocks.len(), 1);
        assert_eq!(calls.get(), 1);
        assert_eq!(blocks[0].id, "seed");
        assert_eq!(blocks[0].block_type, "paragraph");
        assert_eq!(blocks[0].content, Some(serde_json::json!([])));
        assert_eq!(
            crate::domain::nfm::materialize_nfm(&blocks)
                .expect("canonical NFM")
                .nfm,
            ""
        );
    }

    #[test]
    fn fragment_boundary_rejects_whitespace_without_allocating_an_identity() {
        let calls = Cell::new(0);
        let error = materialize_nfm_fragment("\n \t\n", &mut || {
            calls.set(calls.get() + 1);
            "unused".to_owned()
        })
        .expect_err("empty Fragment");

        assert_eq!(error, DocumentNfmInputError::EmptyFragment);
        assert_eq!(calls.get(), 0);
        assert!(error.to_string().contains("<empty-block/>"));
    }

    #[test]
    fn explicit_empty_block_is_a_valid_fragment() {
        let blocks = materialize_nfm_fragment("<empty-block/>", &mut || "empty".to_owned())
            .expect("explicit empty Block");

        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].id, "empty");
        assert_eq!(blocks[0].content, Some(serde_json::json!([])));
    }
}
