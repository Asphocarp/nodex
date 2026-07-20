use nodex_core_contracts::document::{DocumentSemanticAnchor, DocumentSemanticCommand};
use rusqlite::{Connection, OptionalExtension};
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::domain::block_materialization::MaterializedBlockNode;
use crate::domain::nfm::{NfmBlock, NfmInlineContent, NfmStyleSet};
use crate::domain::nfm_parser::{parse_nfm, parse_nfm_with_ids};
use crate::domain::rich_text::{RichTextItem, RichTextStyles, canonicalize_rich_text};

use super::{
    BlockDocumentSchema, DocumentBlockOperation, DocumentMaterialization, DocumentOperationError,
    DocumentOperationErrorCode, ExactNfmPatch, prepare_document_operation_update,
    prepare_exact_nfm_patch_update, prepare_nfm_replacement_update,
};

const ETAG_PREFIX: &str = "nxe1";
const ETAG_KEY_BYTES: usize = 32;
const ETAG_DIGEST_BYTES: usize = 32;
const MAX_SEMANTIC_COMMANDS: usize = 512;

#[derive(Debug, Error)]
pub(crate) enum SemanticMutationError {
    #[error("semantic mutation is invalid: {0}")]
    Invalid(String),
    #[error("semantic mutation guard no longer matches current authority")]
    RevisionConflict,
    #[error("semantic mutation makes no change")]
    NoChange,
    #[error("semantic mutation could not read ETag authority: {0}")]
    EtagAuthority(String),
    #[error(transparent)]
    Operation(#[from] DocumentOperationError),
}

#[derive(Debug)]
pub(crate) struct PreparedSemanticMutation {
    pub(crate) update_v1: Vec<u8>,
    pub(crate) materialization: DocumentMaterialization,
    pub(crate) write_fence_block_ids: Vec<String>,
    pub(crate) title_write_fence_required: bool,
}

pub(crate) struct SemanticMutationContext<'a> {
    pub(crate) document_id: &'a str,
    pub(crate) project_id: &'a str,
    pub(crate) store_epoch: &'a str,
    pub(crate) schema: BlockDocumentSchema,
    pub(crate) full_state_v1: &'a [u8],
    pub(crate) state_vector_v1: &'a [u8],
    pub(crate) materialization: &'a DocumentMaterialization,
}

pub(crate) fn prepare_semantic_mutation(
    connection: &Connection,
    context: SemanticMutationContext<'_>,
    commands: &[DocumentSemanticCommand],
    allocate_block_id: &mut impl FnMut() -> String,
) -> Result<PreparedSemanticMutation, SemanticMutationError> {
    if commands.is_empty() || commands.len() > MAX_SEMANTIC_COMMANDS {
        return Err(SemanticMutationError::Invalid(format!(
            "semantic command batch must contain 1 to {MAX_SEMANTIC_COMMANDS} commands"
        )));
    }
    let (title_etag, body_etag) = mint_document_semantic_etags(
        connection,
        context.project_id,
        context.store_epoch,
        context.document_id,
        context.materialization,
    )?;
    let mut title = None::<Vec<RichTextItem>>;
    let mut replacement = None::<String>;
    let mut patches = Vec::<ExactNfmPatch>::new();
    let mut structural = Vec::<DocumentBlockOperation>::new();
    for command in commands {
        match command {
            DocumentSemanticCommand::SetTitle {
                inline_markdown,
                expected_etag,
            } => {
                if title.is_some() {
                    return Err(SemanticMutationError::Invalid(
                        "semantic command batch contains more than one title replacement"
                            .to_owned(),
                    ));
                }
                assert_etag(expected_etag, &title_etag)?;
                title = Some(parse_inline_markdown_title(inline_markdown)?);
            }
            DocumentSemanticCommand::PatchBody {
                old_fragment,
                new_fragment,
                expected_matches,
            } => patches.push(ExactNfmPatch {
                old_nfm: old_fragment.clone(),
                new_nfm: new_fragment.clone(),
                expected_matches: expected_matches.map(|value| value as usize).or(Some(1)),
            }),
            DocumentSemanticCommand::InsertBody {
                anchor,
                nested_markdown,
            } => {
                let (parent_block_id, before_block_id) =
                    resolve_semantic_anchor(&context.materialization.block_tree, anchor)?;
                let blocks = parse_nfm_with_ids(nested_markdown, allocate_block_id)
                    .map_err(|error| SemanticMutationError::Invalid(error.to_string()))?;
                structural.extend(blocks.into_iter().map(|block| {
                    DocumentBlockOperation::InsertBlock {
                        block,
                        parent_block_id: parent_block_id.clone(),
                        before_block_id: before_block_id.clone(),
                    }
                }));
            }
            DocumentSemanticCommand::ReplaceBody {
                nested_markdown,
                expected_etag,
            } => {
                if replacement.is_some() {
                    return Err(SemanticMutationError::Invalid(
                        "semantic command batch contains more than one body replacement".to_owned(),
                    ));
                }
                assert_etag(expected_etag, &body_etag)?;
                replacement = Some(nested_markdown.clone());
            }
            DocumentSemanticCommand::DeleteBlock { block_id } => {
                structural.push(DocumentBlockOperation::DeleteBlock {
                    block_id: block_id.clone(),
                });
            }
            DocumentSemanticCommand::MoveBlock {
                block_id,
                parent_block_id,
                before_block_id,
            } => {
                structural.push(DocumentBlockOperation::MoveBlock {
                    block_id: block_id.clone(),
                    parent_block_id: parent_block_id.clone(),
                    before_block_id: before_block_id.clone(),
                });
            }
        }
    }
    if replacement.is_some() && !patches.is_empty() {
        return Err(SemanticMutationError::Invalid(
            "body replacement and exact body patches cannot share one mutation".to_owned(),
        ));
    }
    if (!patches.is_empty() || replacement.is_some()) && !structural.is_empty() {
        return Err(SemanticMutationError::Invalid(
            "whole-body semantic commands cannot be combined with stable Block commands".to_owned(),
        ));
    }

    let prepared = if let Some(nfm) = replacement {
        prepare_nfm_replacement_update(
            context.document_id,
            context.schema,
            context.full_state_v1,
            context.state_vector_v1,
            &nfm,
            title.as_deref(),
            allocate_block_id,
        )
    } else if !patches.is_empty() {
        prepare_exact_nfm_patch_update(
            context.document_id,
            context.schema,
            context.full_state_v1,
            context.state_vector_v1,
            &patches,
            title.as_deref(),
            allocate_block_id,
        )
    } else {
        if let Some(title) = title {
            structural.insert(
                0,
                DocumentBlockOperation::SetRichTitle { rich_title: title },
            );
        }
        prepare_document_operation_update(
            context.document_id,
            context.schema,
            context.full_state_v1,
            context.state_vector_v1,
            &structural,
            false,
        )
    };
    let prepared = match prepared {
        Ok(prepared) => prepared,
        Err(error) if error.code() == DocumentOperationErrorCode::NoChange => {
            return Err(SemanticMutationError::NoChange);
        }
        Err(error) => return Err(SemanticMutationError::Operation(error)),
    };
    Ok(PreparedSemanticMutation {
        update_v1: prepared.update_v1,
        materialization: prepared.materialization,
        write_fence_block_ids: prepared.write_fence_block_ids,
        title_write_fence_required: prepared.title_write_fence_required,
    })
}

fn resolve_semantic_anchor(
    blocks: &[MaterializedBlockNode],
    anchor: &DocumentSemanticAnchor,
) -> Result<(Option<String>, Option<String>), SemanticMutationError> {
    match anchor {
        DocumentSemanticAnchor::Start { parent_block_id }
        | DocumentSemanticAnchor::End { parent_block_id } => {
            let siblings = match parent_block_id {
                Some(parent_block_id) => find_block(blocks, parent_block_id)
                    .map(|parent| parent.children.as_slice())
                    .ok_or_else(|| {
                        SemanticMutationError::Invalid(format!(
                            "semantic insertion parent Block {parent_block_id} does not exist"
                        ))
                    })?,
                None => blocks,
            };
            let before_block_id = if matches!(anchor, DocumentSemanticAnchor::Start { .. }) {
                siblings.first().map(|block| block.id.clone())
            } else {
                None
            };
            Ok((parent_block_id.clone(), before_block_id))
        }
        DocumentSemanticAnchor::Before { block_id }
        | DocumentSemanticAnchor::After { block_id } => {
            let (parent_block_id, sibling_index, siblings) =
                find_block_coordinate(blocks, block_id, None).ok_or_else(|| {
                    SemanticMutationError::Invalid(format!(
                        "semantic insertion anchor Block {block_id} does not exist"
                    ))
                })?;
            let before_block_id = if matches!(anchor, DocumentSemanticAnchor::Before { .. }) {
                Some(block_id.clone())
            } else {
                siblings
                    .get(sibling_index + 1)
                    .map(|block| block.id.clone())
            };
            Ok((parent_block_id, before_block_id))
        }
    }
}

fn find_block<'a>(
    blocks: &'a [MaterializedBlockNode],
    block_id: &str,
) -> Option<&'a MaterializedBlockNode> {
    blocks.iter().find_map(|block| {
        (block.id == block_id)
            .then_some(block)
            .or_else(|| find_block(&block.children, block_id))
    })
}

fn find_block_coordinate<'a>(
    blocks: &'a [MaterializedBlockNode],
    block_id: &str,
    parent_block_id: Option<&str>,
) -> Option<(Option<String>, usize, &'a [MaterializedBlockNode])> {
    for (sibling_index, block) in blocks.iter().enumerate() {
        if block.id == block_id {
            return Some((parent_block_id.map(str::to_owned), sibling_index, blocks));
        }
        if let Some(coordinate) = find_block_coordinate(&block.children, block_id, Some(&block.id))
        {
            return Some(coordinate);
        }
    }
    None
}

fn parse_inline_markdown_title(markdown: &str) -> Result<Vec<RichTextItem>, SemanticMutationError> {
    if markdown.contains(['\n', '\r', '\t']) {
        return Err(SemanticMutationError::Invalid(
            "title Markdown must be one line and cannot contain tabs".to_owned(),
        ));
    }
    let blocks =
        parse_nfm(markdown).map_err(|error| SemanticMutationError::Invalid(error.to_string()))?;
    let inline = match blocks.as_slice() {
        [] if markdown.trim().is_empty() => Vec::new(),
        [
            NfmBlock::Paragraph {
                content,
                color: None,
                children,
            },
        ] if children.is_empty() => content.clone(),
        _ => {
            return Err(SemanticMutationError::Invalid(
                "title Markdown accepts inline content, not Block syntax".to_owned(),
            ));
        }
    };
    let items = inline
        .iter()
        .map(rich_text_item)
        .collect::<Result<Vec<_>, _>>()?;
    canonicalize_rich_text(&items)
        .map(|value| value.rich_text)
        .map_err(|error| SemanticMutationError::Invalid(error.to_string()))
}

fn rich_text_item(item: &NfmInlineContent) -> Result<RichTextItem, SemanticMutationError> {
    let styles = |styles: &NfmStyleSet| RichTextStyles {
        bold: styles.bold,
        italic: styles.italic,
        underline: styles.underline,
        strikethrough: styles.strikethrough,
        code: styles.code,
        color: styles.color.clone(),
    };
    match item {
        NfmInlineContent::Text {
            text,
            styles: item_styles,
        } => Ok(RichTextItem::Text {
            text: text.clone(),
            styles: styles(item_styles),
        }),
        NfmInlineContent::Link {
            text,
            href,
            styles: item_styles,
        } => Ok(RichTextItem::Link {
            text: text.clone(),
            href: href.clone(),
            styles: styles(item_styles),
        }),
        NfmInlineContent::ThreadMention { uuid } => {
            Ok(RichTextItem::ThreadMention { uuid: uuid.clone() })
        }
        NfmInlineContent::DateMention(date) => Ok(RichTextItem::DateMention {
            start: date.start.clone(),
            end: date.end.clone(),
            tz: date.tz.clone(),
            format: date.format.clone(),
            time_format: date.time_format.clone(),
            reminder: date.reminder.clone(),
        }),
        NfmInlineContent::LineBreak
        | NfmInlineContent::Attachment { .. }
        | NfmInlineContent::AgentConfig { .. } => Err(SemanticMutationError::Invalid(
            "title Markdown contains unsupported inline content".to_owned(),
        )),
    }
}

fn assert_etag(supplied: &str, expected: &str) -> Result<(), SemanticMutationError> {
    let supplied = decode_etag(supplied)?;
    let expected = decode_etag(expected)?;
    let difference = supplied
        .iter()
        .zip(expected)
        .fold(0_u8, |difference, (left, right)| {
            difference | (left ^ right)
        });
    if difference == 0 {
        return Ok(());
    }
    Err(SemanticMutationError::RevisionConflict)
}

pub(crate) fn mint_etag(
    connection: &Connection,
    kind: &str,
    project_id: &str,
    store_epoch: &str,
    subject: &[&str],
    state: Value,
) -> Result<String, SemanticMutationError> {
    let key = connection
        .query_row(
            "SELECT key_material FROM nodex_agent_token_keys WHERE id = 1",
            [],
            |row| row.get::<_, Vec<u8>>(0),
        )
        .optional()
        .map_err(|error| SemanticMutationError::EtagAuthority(error.to_string()))?
        .filter(|key| key.len() == ETAG_KEY_BYTES)
        .ok_or_else(|| {
            SemanticMutationError::EtagAuthority("signing key is unavailable".to_owned())
        })?;
    let value = json!([1, kind, project_id, store_epoch, subject, state]);
    let canonical = canonical_json(value);
    let bytes = serde_json::to_vec(&canonical)
        .map_err(|error| SemanticMutationError::EtagAuthority(error.to_string()))?;
    let digest = hmac_sha256(&key, &bytes);
    Ok(format!("{ETAG_PREFIX}.{}", base64_url_no_pad(&digest)))
}

pub(crate) fn mint_document_semantic_etags(
    connection: &Connection,
    project_id: &str,
    store_epoch: &str,
    document_id: &str,
    materialization: &DocumentMaterialization,
) -> Result<(String, String), SemanticMutationError> {
    let title = mint_etag(
        connection,
        "title",
        project_id,
        store_epoch,
        &[document_id],
        json!({ "richTitle": materialization.rich_title }),
    )?;
    let body = mint_etag(
        connection,
        "document_body",
        project_id,
        store_epoch,
        &[document_id],
        json!({ "nfm": materialization.nfm }),
    )?;
    Ok((title, body))
}

fn canonical_json(value: Value) -> Value {
    match value {
        Value::Array(items) => Value::Array(items.into_iter().map(canonical_json).collect()),
        Value::Object(entries) => {
            let mut keys = entries.keys().cloned().collect::<Vec<_>>();
            keys.sort();
            let mut canonical = Map::new();
            for key in keys {
                if let Some(value) = entries.get(&key) {
                    canonical.insert(key, canonical_json(value.clone()));
                }
            }
            Value::Object(canonical)
        }
        value => value,
    }
}

fn hmac_sha256(key: &[u8], message: &[u8]) -> [u8; ETAG_DIGEST_BYTES] {
    const BLOCK_BYTES: usize = 64;
    let mut inner_pad = [0x36_u8; BLOCK_BYTES];
    let mut outer_pad = [0x5c_u8; BLOCK_BYTES];
    for (index, byte) in key.iter().enumerate() {
        inner_pad[index] ^= byte;
        outer_pad[index] ^= byte;
    }
    let mut inner = Sha256::new();
    inner.update(inner_pad);
    inner.update(message);
    let inner = inner.finalize();
    let mut outer = Sha256::new();
    outer.update(outer_pad);
    outer.update(inner);
    outer.finalize().into()
}

fn base64_url_no_pad(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut output = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let value = (u32::from(chunk[0]) << 16)
            | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8)
            | u32::from(*chunk.get(2).unwrap_or(&0));
        output.push(char::from(ALPHABET[((value >> 18) & 63) as usize]));
        output.push(char::from(ALPHABET[((value >> 12) & 63) as usize]));
        if chunk.len() > 1 {
            output.push(char::from(ALPHABET[((value >> 6) & 63) as usize]));
        }
        if chunk.len() > 2 {
            output.push(char::from(ALPHABET[(value & 63) as usize]));
        }
    }
    output
}

fn decode_etag(value: &str) -> Result<[u8; ETAG_DIGEST_BYTES], SemanticMutationError> {
    let encoded = value
        .strip_prefix("nxe1.")
        .ok_or_else(|| SemanticMutationError::Invalid("semantic ETag is malformed".to_owned()))?;
    if encoded.len() != 43 {
        return Err(SemanticMutationError::Invalid(
            "semantic ETag is malformed".to_owned(),
        ));
    }
    let mut output = Vec::with_capacity(ETAG_DIGEST_BYTES);
    let bytes = encoded.as_bytes();
    for chunk in bytes.chunks(4) {
        let mut value = 0_u32;
        for byte in chunk {
            let decoded = decode_base64_url(*byte).ok_or_else(|| {
                SemanticMutationError::Invalid("semantic ETag is malformed".to_owned())
            })?;
            value = (value << 6) | u32::from(decoded);
        }
        value <<= 6 * (4 - chunk.len());
        output.push(((value >> 16) & 0xff) as u8);
        if chunk.len() > 2 {
            output.push(((value >> 8) & 0xff) as u8);
        }
        if chunk.len() > 3 {
            output.push((value & 0xff) as u8);
        }
    }
    let decoded: [u8; ETAG_DIGEST_BYTES] = output
        .try_into()
        .map_err(|_| SemanticMutationError::Invalid("semantic ETag is malformed".to_owned()))?;
    if base64_url_no_pad(&decoded) == encoded {
        return Ok(decoded);
    }
    Err(SemanticMutationError::Invalid(
        "semantic ETag is malformed".to_owned(),
    ))
}

fn decode_base64_url(value: u8) -> Option<u8> {
    match value {
        b'A'..=b'Z' => Some(value - b'A'),
        b'a'..=b'z' => Some(value - b'a' + 26),
        b'0'..=b'9' => Some(value - b'0' + 52),
        b'-' => Some(62),
        b'_' => Some(63),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn manual_hmac_matches_the_rfc_4231_sha256_vector() {
        let key = [0x0b; 20];
        assert_eq!(
            hex(&hmac_sha256(&key, b"Hi There")),
            "b0344c61d8db38535ca8afceaf0bf12b\
             881dc200c9833da726e9376c2e32cff7"
        );
    }

    #[test]
    fn base64_url_etags_round_trip_without_padding() {
        let digest = hmac_sha256(&[7; 32], b"semantic authority");
        let encoded = format!("nxe1.{}", base64_url_no_pad(&digest));
        assert_eq!(decode_etag(&encoded).unwrap(), digest);
    }

    #[test]
    fn etag_matches_the_typescript_authority_vector() {
        let connection = Connection::open_in_memory().unwrap();
        connection
            .execute_batch(
                "CREATE TABLE nodex_agent_token_keys(\
                   id INTEGER PRIMARY KEY, key_material BLOB NOT NULL\
                 );",
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO nodex_agent_token_keys(id, key_material) VALUES (1, ?1)",
                [vec![0x11_u8; 32]],
            )
            .unwrap();
        assert_eq!(
            mint_etag(
                &connection,
                "title",
                "project:test",
                "epoch:test",
                &["document:test"],
                json!({
                    "richTitle": [{
                        "type": "text",
                        "text": "Hello",
                        "styles": { "bold": true },
                    }],
                }),
            )
            .unwrap(),
            "nxe1.NeZS7_17LKIgmH87yqTDVA5mm9gP9Atq3ACGpOgzpp4"
        );
    }

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|byte| format!("{byte:02x}")).collect()
    }
}
