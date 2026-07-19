use nodex_core_contracts::BoundModuleContext;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

use serde_json::{Map, Value, json};

use crate::domain::block_materialization::MaterializedBlockNode;
use crate::domain::block_materialization::dematerialize_block_tree;
use crate::domain::rich_text::{RichTextItem, rich_text_to_delta};
use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};

use super::canvas_scene::{CanvasScene, parse_canvas_scene};
use super::persistence::{DocumentAuthorityRow, sha256};
use super::{
    BlockDocumentKind, BlockDocumentSchema, DocumentMaterialization,
    PreparedDocumentOperationUpdate, YrsDocumentEngine, decode_block_document,
    encode_block_document, materialize_decoded_document,
};

const CHECKPOINT_FORMAT: &str = "block_tree_snapshot_v2";
const CANVAS_CHECKPOINT_FORMAT: &str = "canvas_scene_json_v1";
const DEFAULT_HISTORY_LIMIT: u32 = 50;
const MAX_HISTORY_LIMIT: u32 = 200;

#[derive(Debug, Clone)]
pub(crate) struct NewDocumentCheckpoint<'a> {
    pub(crate) operation_id: &'a str,
    pub(crate) cause: &'a str,
    pub(crate) label: Option<&'a str>,
    pub(crate) revision_kind: &'a str,
    pub(crate) source_change_seq: Option<i64>,
    pub(crate) context: &'a BoundModuleContext,
    pub(crate) now: &'a str,
}

#[derive(Debug, Clone)]
pub(crate) struct StoredDocumentVersion {
    pub(crate) version_id: String,
    pub(crate) summary: Value,
    pub(crate) materialization: Value,
    pub(crate) block_materialization: Option<DocumentMaterialization>,
    pub(crate) canvas_scene: Option<CanvasScene>,
}

#[derive(Debug)]
pub(super) struct DocumentVersionRetentionEvidence {
    pub(super) document_id: String,
    pub(super) block_ids: BTreeSet<String>,
    pub(super) referenced_block_ids: BTreeSet<String>,
    pub(super) database_view_ids: BTreeSet<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BlockTreeSnapshotV2 {
    format_version: u32,
    kind: BlockDocumentKind,
    block_tree: Vec<MaterializedBlockNode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    rich_title: Option<Vec<RichTextItem>>,
}

#[derive(Debug)]
struct StoredVersionRow {
    version_id: String,
    document_id: String,
    project_id: String,
    generation: i64,
    base_head_seq: i64,
    schema_key: String,
    schema_version: i64,
    cause: String,
    label: Option<String>,
    actor_json: String,
    revision_kind: String,
    source_mutation_id: Option<String>,
    source_change_seq: Option<i64>,
    pinned: i64,
    checkpoint_format: String,
    checkpoint_bytes: Vec<u8>,
    state_vector: Vec<u8>,
    checkpoint_hash: String,
    byte_length: i64,
    created_at: String,
}

pub(crate) fn insert_document_checkpoint(
    connection: &Connection,
    authority: &DocumentAuthorityRow,
    materialization: &DocumentMaterialization,
    input: NewDocumentCheckpoint<'_>,
) -> Result<StoredDocumentVersion, StoreError> {
    validate_checkpoint_input(&input)?;
    let snapshot = BlockTreeSnapshotV2 {
        format_version: 2,
        kind: materialization.kind,
        block_tree: materialization.block_tree.clone(),
        rich_title: authority
            .head
            .schema_key
            .eq("nodex.page")
            .then(|| materialization.rich_title.clone()),
    };
    let snapshot_value = serde_json::to_value(&snapshot)
        .map_err(|_| internal("Document checkpoint could not be encoded"))?;
    let checkpoint_bytes = canonical_json_bytes(snapshot_value)?;
    let checkpoint_hash = sha256(&checkpoint_bytes);
    let actor = json!({
        "adapter": input.context.adapter,
        "connectionId": input.context.connection_id,
    });
    let actor_json = String::from_utf8(canonical_json_bytes(actor.clone())?)
        .map_err(|_| internal("Checkpoint actor encoding is invalid"))?;
    let links_mutation = matches!(input.revision_kind, "operation" | "restore");
    let source_mutation_id = links_mutation.then_some(input.operation_id);
    let source_change_seq = links_mutation.then_some(input.source_change_seq).flatten();
    let pinned = i64::from(matches!(input.revision_kind, "manual" | "restore"));
    let identity = json!({
        "documentId": authority.head.id,
        "projectId": authority.head.project_id,
        "generation": authority.head.generation,
        "baseHeadSeq": authority.head.head_seq,
        "schemaKey": authority.head.schema_key,
        "schemaVersion": authority.head.schema_version,
        "cause": input.cause,
        "label": input.label,
        "revisionKind": input.revision_kind,
        "sourceMutationId": source_mutation_id,
        "sourceChangeSeq": source_change_seq,
        "checkpointHash": checkpoint_hash,
    });
    let version_id = format!(
        "document-version:{}",
        sha256(&canonical_json_bytes(identity)?)
    );
    let byte_length = i64::try_from(checkpoint_bytes.len())
        .map_err(|_| internal("Checkpoint byte length overflowed"))?;
    connection.execute(
        "INSERT INTO document_versions (\
           version_id, document_id, project_id, generation, base_head_seq, schema_key, \
           schema_version, cause, label, actor_json, revision_kind, source_mutation_id, \
           source_change_seq, pinned, checkpoint_format, full_update_blob, state_vector, \
           checkpoint_hash, byte_length, created_at\
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, \
                   ?15, ?16, X'', ?17, ?18, ?19) \
         ON CONFLICT(version_id) DO NOTHING",
        params![
            version_id,
            authority.head.id,
            authority.head.project_id,
            authority.head.generation,
            authority.head.head_seq,
            authority.head.schema_key,
            authority.head.schema_version,
            input.cause,
            input.label,
            actor_json,
            input.revision_kind,
            source_mutation_id,
            source_change_seq,
            pinned,
            CHECKPOINT_FORMAT,
            checkpoint_bytes,
            checkpoint_hash,
            byte_length,
            input.now,
        ],
    )?;
    let stored = read_document_version(
        connection,
        &authority.head.project_id,
        &authority.head.id,
        &version_id,
    )?
    .ok_or_else(|| corrupt("Inserted Document checkpoint could not be read"))?;
    if stored.generation != authority.head.generation
        || stored.base_head_seq != authority.head.head_seq
        || stored.checkpoint_hash != checkpoint_hash
        || stored.cause != input.cause
        || stored.label.as_deref() != input.label
    {
        return Err(StoreError::new(
            StoreErrorCode::IdempotencyKeyReused,
            "Document checkpoint identity collides with different immutable content",
            false,
        ));
    }
    let version = decode_document_version(stored)?;
    prune_document_history(connection, &authority.head.id, input.now)?;
    Ok(version)
}

pub(crate) fn insert_canvas_checkpoint(
    connection: &Connection,
    authority: &DocumentAuthorityRow,
    scene: &CanvasScene,
    input: NewDocumentCheckpoint<'_>,
) -> Result<StoredDocumentVersion, StoreError> {
    validate_checkpoint_input(&input)?;
    let checkpoint_bytes = canonical_json_bytes(scene.canonical_value())?;
    let checkpoint_hash = sha256(&checkpoint_bytes);
    let actor = json!({
        "adapter": input.context.adapter,
        "connectionId": input.context.connection_id,
    });
    let actor_json = String::from_utf8(canonical_json_bytes(actor)?)
        .map_err(|_| internal("Checkpoint actor encoding is invalid"))?;
    let links_mutation = matches!(input.revision_kind, "operation" | "restore");
    let source_mutation_id = links_mutation.then_some(input.operation_id);
    let source_change_seq = links_mutation.then_some(input.source_change_seq).flatten();
    let pinned = i64::from(matches!(input.revision_kind, "manual" | "restore"));
    let identity = json!({
        "documentId": authority.head.id,
        "projectId": authority.head.project_id,
        "generation": authority.head.generation,
        "baseHeadSeq": authority.head.head_seq,
        "schemaKey": authority.head.schema_key,
        "schemaVersion": authority.head.schema_version,
        "cause": input.cause,
        "label": input.label,
        "revisionKind": input.revision_kind,
        "sourceMutationId": source_mutation_id,
        "sourceChangeSeq": source_change_seq,
        "checkpointHash": checkpoint_hash,
    });
    let version_id = format!(
        "document-version:{}",
        sha256(&canonical_json_bytes(identity)?)
    );
    let byte_length = i64::try_from(checkpoint_bytes.len())
        .map_err(|_| internal("Checkpoint byte length overflowed"))?;
    connection.execute(
        "INSERT INTO document_versions (\
           version_id, document_id, project_id, generation, base_head_seq, schema_key, \
           schema_version, cause, label, actor_json, revision_kind, source_mutation_id, \
           source_change_seq, pinned, checkpoint_format, full_update_blob, state_vector, \
           checkpoint_hash, byte_length, created_at\
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, \
                   ?15, ?16, X'', ?17, ?18, ?19) \
         ON CONFLICT(version_id) DO NOTHING",
        params![
            version_id,
            authority.head.id,
            authority.head.project_id,
            authority.head.generation,
            authority.head.head_seq,
            authority.head.schema_key,
            authority.head.schema_version,
            input.cause,
            input.label,
            actor_json,
            input.revision_kind,
            source_mutation_id,
            source_change_seq,
            pinned,
            CANVAS_CHECKPOINT_FORMAT,
            checkpoint_bytes,
            checkpoint_hash,
            byte_length,
            input.now,
        ],
    )?;
    let stored = read_document_version(
        connection,
        &authority.head.project_id,
        &authority.head.id,
        &version_id,
    )?
    .ok_or_else(|| corrupt("Inserted Canvas checkpoint could not be read"))?;
    if stored.generation != authority.head.generation
        || stored.base_head_seq != authority.head.head_seq
        || stored.checkpoint_hash != checkpoint_hash
        || stored.checkpoint_format != CANVAS_CHECKPOINT_FORMAT
        || stored.cause != input.cause
        || stored.label.as_deref() != input.label
    {
        return Err(StoreError::new(
            StoreErrorCode::IdempotencyKeyReused,
            "Canvas checkpoint identity collides with different immutable content",
            false,
        ));
    }
    let version = decode_document_version(stored)?;
    prune_document_history(connection, &authority.head.id, input.now)?;
    Ok(version)
}

pub(crate) fn get_document_version(
    connection: &Connection,
    authority: &DocumentAuthorityRow,
    version_id: &str,
) -> Result<Option<StoredDocumentVersion>, StoreError> {
    validate_identity(version_id, "version_id")?;
    read_document_version(
        connection,
        &authority.head.project_id,
        &authority.head.id,
        version_id,
    )?
    .map(decode_document_version)
    .transpose()
}

pub(crate) fn list_document_versions(
    connection: &Connection,
    authority: &DocumentAuthorityRow,
    before_version_id: Option<&str>,
    limit: Option<u32>,
) -> Result<(Vec<Value>, Option<String>), StoreError> {
    let limit = limit.unwrap_or(DEFAULT_HISTORY_LIMIT);
    if limit == 0 || limit > MAX_HISTORY_LIMIT {
        return Err(invalid(format!(
            "Document history limit must be between 1 and {MAX_HISTORY_LIMIT}"
        )));
    }
    let before = before_version_id
        .map(|version_id| {
            validate_identity(version_id, "before_version_id")?;
            read_document_version(
                connection,
                &authority.head.project_id,
                &authority.head.id,
                version_id,
            )?
            .map(|row| (row.base_head_seq, row.created_at, row.version_id))
            .ok_or_else(|| not_found("Document history cursor was not found"))
        })
        .transpose()?;
    let query_limit = i64::from(limit) + 1;
    let mut statement = connection.prepare(
        "SELECT version_id, document_id, project_id, generation, base_head_seq, schema_key, \
                schema_version, cause, label, actor_json, revision_kind, source_mutation_id, \
                source_change_seq, pinned, checkpoint_format, full_update_blob, state_vector, \
                checkpoint_hash, byte_length, created_at \
         FROM document_versions \
         WHERE project_id = ?1 AND document_id = ?2 \
           AND (?3 IS NULL OR base_head_seq < ?4 \
             OR (base_head_seq = ?4 AND created_at < ?5) \
             OR (base_head_seq = ?4 AND created_at = ?5 AND version_id < ?3)) \
         ORDER BY base_head_seq DESC, created_at DESC, version_id DESC LIMIT ?6",
    )?;
    let rows = statement
        .query_map(
            params![
                authority.head.project_id,
                authority.head.id,
                before.as_ref().map(|value| &value.2),
                before.as_ref().map(|value| value.0),
                before.as_ref().map(|value| &value.1),
                query_limit,
            ],
            decode_row,
        )?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|_| corrupt("Document history row has invalid column types"))?;
    let has_more = rows.len() > usize::try_from(limit).unwrap_or(usize::MAX);
    let rows = rows
        .into_iter()
        .take(usize::try_from(limit).unwrap_or_default())
        .map(decode_document_version)
        .collect::<Result<Vec<_>, _>>()?;
    let next = has_more
        .then(|| rows.last().map(|version| version.version_id.clone()))
        .flatten();
    Ok((
        rows.into_iter().map(|version| version.summary).collect(),
        next,
    ))
}

pub(crate) fn prepare_version_restore(
    connection: &Connection,
    authority: &DocumentAuthorityRow,
    engine: &YrsDocumentEngine,
    version_id: &str,
) -> Result<Option<PreparedDocumentOperationUpdate>, StoreError> {
    let version = get_document_version(connection, authority, version_id)?
        .ok_or_else(|| not_found("Document version was not found"))?;
    let materialization = version.block_materialization.ok_or_else(|| {
        StoreError::new(
            StoreErrorCode::UnsupportedSchema,
            "Canvas version cannot restore into a Yjs Document",
            false,
        )
    })?;
    if materialization.schema.schema_key != authority.head.schema_key
        || i64::from(materialization.schema.schema_version) != authority.head.schema_version
    {
        return Err(StoreError::new(
            StoreErrorCode::UnsupportedSchema,
            "Document version schema cannot restore into the current authority",
            false,
        ));
    }
    let schema = BlockDocumentSchema::from_identity(
        &authority.head.schema_key,
        authority.head.schema_version,
    )
    .ok_or_else(|| {
        StoreError::new(
            StoreErrorCode::UnsupportedSchema,
            "Owned Document schema is unsupported",
            false,
        )
    })?;
    let prepared = super::operations::prepare_document_snapshot_restore_update(
        &authority.head.id,
        schema,
        &engine.full_state_v1(),
        &engine.state_vector_v1(),
        &materialization.block_tree,
        schema
            .has_title()
            .then_some(materialization.rich_title.as_slice()),
    );
    match prepared {
        Ok(prepared) => Ok(Some(prepared)),
        Err(error) if error.code() == super::DocumentOperationErrorCode::NoChange => Ok(None),
        Err(error) => Err(invalid(error.to_string())),
    }
}

pub(crate) fn prepare_document_revision(
    connection: &Connection,
    authority: &DocumentAuthorityRow,
    materialization: &DocumentMaterialization,
    context: &BoundModuleContext,
    now: &str,
) -> Result<(), StoreError> {
    prepare_revision(
        connection,
        authority,
        RevisionContent::Block(materialization),
        context,
        now,
    )
}

pub(crate) fn prepare_canvas_revision(
    connection: &Connection,
    authority: &DocumentAuthorityRow,
    scene: &CanvasScene,
    context: &BoundModuleContext,
    now: &str,
) -> Result<(), StoreError> {
    prepare_revision(
        connection,
        authority,
        RevisionContent::Canvas(scene),
        context,
        now,
    )
}

#[derive(Clone, Copy)]
enum RevisionContent<'a> {
    Block(&'a DocumentMaterialization),
    Canvas(&'a CanvasScene),
}

fn prepare_revision(
    connection: &Connection,
    authority: &DocumentAuthorityRow,
    content: RevisionContent<'_>,
    context: &BoundModuleContext,
    now: &str,
) -> Result<(), StoreError> {
    let session = connection
        .query_row(
            "SELECT generation, last_edit_at FROM document_revision_sessions \
             WHERE document_id = ?1",
            [&authority.head.id],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;
    if let Some((session_generation, last_edit_at)) = session {
        if session_generation != authority.head.generation {
            connection.execute(
                "DELETE FROM document_revision_sessions WHERE document_id = ?1",
                [&authority.head.id],
            )?;
        } else {
            let idle = connection
                .query_row(
                    "SELECT (julianday(?1) - julianday(?2)) * 86400000 >= 120000",
                    params![now, last_edit_at],
                    |row| row.get::<_, bool>(0),
                )
                .map_err(|_| corrupt("Document revision session timestamp is invalid"))?;
            if !idle {
                return Ok(());
            }
            let operation_id = format!(
                "revision-idle:{}:{}:{}",
                authority.head.id, authority.head.generation, authority.head.head_seq
            );
            insert_revision_checkpoint(
                connection,
                authority,
                content,
                NewDocumentCheckpoint {
                    operation_id: &operation_id,
                    cause: "idle_edit",
                    label: None,
                    revision_kind: "automatic",
                    source_change_seq: None,
                    context,
                    now,
                },
            )?;
            connection.execute(
                "DELETE FROM document_revision_sessions WHERE document_id = ?1",
                [&authority.head.id],
            )?;
            return Ok(());
        }
    }
    let covered = connection
        .query_row(
            "SELECT 1 FROM document_versions \
             WHERE document_id = ?1 AND generation = ?2 AND base_head_seq = ?3 LIMIT 1",
            params![
                authority.head.id,
                authority.head.generation,
                authority.head.head_seq
            ],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if covered {
        return Ok(());
    }
    let operation_id = format!(
        "revision-safety:{}:{}:{}",
        authority.head.id, authority.head.generation, authority.head.head_seq
    );
    insert_revision_checkpoint(
        connection,
        authority,
        content,
        NewDocumentCheckpoint {
            operation_id: &operation_id,
            cause: "before_edit_burst",
            label: None,
            revision_kind: "safety",
            source_change_seq: None,
            context,
            now,
        },
    )?;
    Ok(())
}

fn insert_revision_checkpoint(
    connection: &Connection,
    authority: &DocumentAuthorityRow,
    content: RevisionContent<'_>,
    input: NewDocumentCheckpoint<'_>,
) -> Result<(), StoreError> {
    match content {
        RevisionContent::Block(materialization) => {
            insert_document_checkpoint(connection, authority, materialization, input)?;
        }
        RevisionContent::Canvas(scene) => {
            insert_canvas_checkpoint(connection, authority, scene, input)?;
        }
    }
    Ok(())
}

pub(crate) fn record_document_revision_edit(
    connection: &Connection,
    document_id: &str,
    generation: i64,
    head_seq: i64,
    client_session_id: &str,
    committed_at: &str,
) -> Result<(), StoreError> {
    let existing = connection
        .query_row(
            "SELECT generation, burst_started_at, last_edit_at, last_checkpoint_at \
             FROM document_revision_sessions WHERE document_id = ?1",
            [document_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            },
        )
        .optional()?;
    let continues_burst = if let Some(existing) = existing
        .as_ref()
        .filter(|existing| existing.0 == generation)
    {
        connection
            .query_row(
                "SELECT (julianday(?1) - julianday(?2)) * 86400000 < 120000",
                params![committed_at, existing.2],
                |row| row.get::<_, bool>(0),
            )
            .map_err(|_| corrupt("Document revision session timestamp is invalid"))?
    } else {
        false
    };
    let burst_started_at = existing
        .as_ref()
        .filter(|_| continues_burst)
        .map(|existing| existing.1.as_str())
        .unwrap_or(committed_at);
    let last_checkpoint_at = existing
        .as_ref()
        .filter(|_| continues_burst)
        .and_then(|existing| existing.3.as_deref());
    connection.execute(
        "INSERT INTO document_revision_sessions (\
           document_id, generation, dirty_head_seq, burst_started_at, last_edit_at, \
           last_checkpoint_at, client_session_id\
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) \
         ON CONFLICT(document_id) DO UPDATE SET \
           generation = excluded.generation, dirty_head_seq = excluded.dirty_head_seq, \
           burst_started_at = excluded.burst_started_at, last_edit_at = excluded.last_edit_at, \
           last_checkpoint_at = excluded.last_checkpoint_at, \
           client_session_id = excluded.client_session_id",
        params![
            document_id,
            generation,
            head_seq,
            burst_started_at,
            committed_at,
            last_checkpoint_at,
            client_session_id,
        ],
    )?;
    Ok(())
}

fn read_document_version(
    connection: &Connection,
    project_id: &str,
    document_id: &str,
    version_id: &str,
) -> Result<Option<StoredVersionRow>, StoreError> {
    connection
        .query_row(
            "SELECT version_id, document_id, project_id, generation, base_head_seq, schema_key, \
                    schema_version, cause, label, actor_json, revision_kind, source_mutation_id, \
                    source_change_seq, pinned, checkpoint_format, full_update_blob, state_vector, \
                    checkpoint_hash, byte_length, created_at \
             FROM document_versions WHERE project_id = ?1 AND document_id = ?2 AND version_id = ?3",
            params![project_id, document_id, version_id],
            decode_row,
        )
        .optional()
        .map_err(StoreError::from)
}

fn decode_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<StoredVersionRow> {
    Ok(StoredVersionRow {
        version_id: row.get(0)?,
        document_id: row.get(1)?,
        project_id: row.get(2)?,
        generation: row.get(3)?,
        base_head_seq: row.get(4)?,
        schema_key: row.get(5)?,
        schema_version: row.get(6)?,
        cause: row.get(7)?,
        label: row.get(8)?,
        actor_json: row.get(9)?,
        revision_kind: row.get(10)?,
        source_mutation_id: row.get(11)?,
        source_change_seq: row.get(12)?,
        pinned: row.get(13)?,
        checkpoint_format: row.get(14)?,
        checkpoint_bytes: row.get(15)?,
        state_vector: row.get(16)?,
        checkpoint_hash: row.get(17)?,
        byte_length: row.get(18)?,
        created_at: row.get(19)?,
    })
}

pub(super) fn read_document_version_retention_evidence(
    connection: &Connection,
    maximum_versions: usize,
) -> Result<Vec<DocumentVersionRetentionEvidence>, StoreError> {
    let version_count =
        connection.query_row("SELECT count(*) FROM document_versions", [], |row| {
            row.get::<_, i64>(0)
        })?;
    if version_count < 0 || usize::try_from(version_count).unwrap_or(usize::MAX) > maximum_versions
    {
        return Err(corrupt(
            "Retained Document history exceeds the bounded Block retention scan",
        ));
    }
    let rows = connection
        .prepare(
            "SELECT version_id, document_id, project_id, generation, base_head_seq, schema_key, \
                    schema_version, cause, label, actor_json, revision_kind, source_mutation_id, \
                    source_change_seq, pinned, checkpoint_format, full_update_blob, state_vector, \
                    checkpoint_hash, byte_length, created_at \
             FROM document_versions ORDER BY version_id",
        )?
        .query_map([], decode_row)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|_| corrupt("Document history row has invalid column types"))?;
    rows.into_iter()
        .map(|row| {
            let document_id = row.document_id.clone();
            let decoded = decode_document_version(row)?;
            let mut block_ids = BTreeSet::new();
            let mut referenced_block_ids = BTreeSet::new();
            let mut database_view_ids = BTreeSet::new();
            if let Some(materialization) = decoded.block_materialization {
                collect_materialized_block_ids(&materialization.block_tree, &mut block_ids);
                for reference in &materialization.references {
                    if let Some(block_id) = reference.target_block_id() {
                        referenced_block_ids.insert(block_id.to_owned());
                    }
                    if let Some(view_id) = reference.database_view_id() {
                        database_view_ids.insert(view_id.to_owned());
                    }
                }
            }
            if let Some(scene) = decoded.canvas_scene {
                referenced_block_ids.extend(
                    scene
                        .page_references
                        .into_iter()
                        .map(|reference| reference.target_block_id),
                );
            }
            Ok(DocumentVersionRetentionEvidence {
                document_id,
                block_ids,
                referenced_block_ids,
                database_view_ids,
            })
        })
        .collect()
}

fn collect_materialized_block_ids(blocks: &[MaterializedBlockNode], output: &mut BTreeSet<String>) {
    for block in blocks {
        output.insert(block.id.clone());
        collect_materialized_block_ids(&block.children, output);
    }
}

fn decode_document_version(row: StoredVersionRow) -> Result<StoredDocumentVersion, StoreError> {
    validate_stored_version(&row)?;
    let (materialization, block_materialization, canvas_scene, kind, title, preview, block_count) =
        if row.checkpoint_format == CANVAS_CHECKPOINT_FORMAT {
            if row.schema_key != super::canvas_scene::CANVAS_SCHEMA_KEY
                || row.schema_version != super::canvas_scene::CANVAS_SCHEMA_VERSION
                || !row.state_vector.is_empty()
            {
                return Err(corrupt("Canvas Document checkpoint schema diverges"));
            }
            let value = serde_json::from_slice::<Value>(&row.checkpoint_bytes)
                .map_err(|_| corrupt("Canvas Document checkpoint JSON is invalid"))?;
            if canonical_json_bytes(value.clone())? != row.checkpoint_bytes {
                return Err(corrupt("Canvas Document checkpoint JSON is not canonical"));
            }
            let scene = parse_canvas_scene(&value)?;
            let preview = scene.preview.clone();
            let block_count = scene.elements.len();
            (
                value,
                None,
                Some(scene),
                json!("canvas_scene"),
                Value::Null,
                preview,
                block_count,
            )
        } else {
            let schema = BlockDocumentSchema::from_identity(&row.schema_key, row.schema_version)
                .ok_or_else(|| corrupt("Document version uses an unsupported schema"))?;
            let block = match row.checkpoint_format.as_str() {
                CHECKPOINT_FORMAT => decode_block_tree_checkpoint(&row, schema)?,
                "yjs_update_v1" => decode_yjs_checkpoint(&row, schema)?,
                _ => return Err(corrupt("Document version checkpoint format is invalid")),
            };
            let value = serde_json::to_value(&block)
                .map_err(|_| internal("Version materialization could not be encoded"))?;
            let kind = serde_json::to_value(block.kind)
                .map_err(|_| internal("Version kind could not be encoded"))?;
            let title = if schema.has_title() {
                Value::String(block.title.clone())
            } else {
                Value::Null
            };
            let preview = block.preview.clone();
            let block_count = count_blocks(&block.block_tree);
            (value, Some(block), None, kind, title, preview, block_count)
        };
    let actor = serde_json::from_str::<Value>(&row.actor_json)
        .ok()
        .filter(Value::is_object)
        .ok_or_else(|| corrupt("Document version actor JSON is invalid"))?;
    let materialization_hash = sha256(&canonical_json_bytes(materialization.clone())?);
    let summary = json!({
        "versionId": row.version_id,
        "documentId": row.document_id,
        "projectId": row.project_id,
        "generation": row.generation,
        "baseHeadSeq": row.base_head_seq,
        "schemaKey": row.schema_key,
        "schemaVersion": row.schema_version,
        "cause": row.cause,
        "label": row.label,
        "actor": actor,
        "revisionKind": row.revision_kind,
        "sourceMutationId": row.source_mutation_id,
        "sourceChangeSeq": row.source_change_seq,
        "pinned": row.pinned == 1,
        "checkpointHash": row.checkpoint_hash,
        "checkpointMetadata": { "format": row.checkpoint_format },
        "materializationHash": materialization_hash,
        "byteLength": row.byte_length,
        "materializationKind": kind,
        "title": title,
        "preview": preview,
        "blockCount": block_count,
        "createdAt": row.created_at,
    });
    Ok(StoredDocumentVersion {
        version_id: summary["versionId"].as_str().unwrap_or_default().to_owned(),
        summary,
        materialization,
        block_materialization,
        canvas_scene,
    })
}

fn decode_block_tree_checkpoint(
    row: &StoredVersionRow,
    schema: BlockDocumentSchema,
) -> Result<DocumentMaterialization, StoreError> {
    if !row.state_vector.is_empty() {
        return Err(corrupt(
            "BlockTree Document checkpoint contains causal Yjs state",
        ));
    }
    let value = serde_json::from_slice::<Value>(&row.checkpoint_bytes)
        .map_err(|_| corrupt("BlockTree Document checkpoint JSON is invalid"))?;
    if canonical_json_bytes(value.clone())? != row.checkpoint_bytes {
        return Err(corrupt(
            "BlockTree Document checkpoint JSON is not canonical",
        ));
    }
    let snapshot = serde_json::from_value::<BlockTreeSnapshotV2>(value)
        .map_err(|_| corrupt("BlockTree Document checkpoint payload is invalid"))?;
    if snapshot.format_version != 2 || snapshot.kind != super::schema_metadata(schema).kind {
        return Err(corrupt(
            "BlockTree Document checkpoint schema identity diverges",
        ));
    }
    if schema.has_title() != snapshot.rich_title.is_some() {
        return Err(corrupt(
            "BlockTree Document checkpoint title capability diverges",
        ));
    }
    let block_tree = dematerialize_block_tree(&snapshot.block_tree).map_err(|error| {
        StoreError::new(
            StoreErrorCode::StoreCorrupt,
            format!("BlockTree Document checkpoint has invalid Blocks: {error}"),
            false,
        )
    })?;
    let title = snapshot
        .rich_title
        .as_deref()
        .map(rich_text_to_delta)
        .transpose()
        .map_err(|error| {
            StoreError::new(
                StoreErrorCode::StoreCorrupt,
                format!("BlockTree Document checkpoint has an invalid title: {error}"),
                false,
            )
        })?;
    let document = encode_block_document(&row.document_id, schema, title.as_deref(), &block_tree)
        .map_err(|error| {
        StoreError::new(
            StoreErrorCode::StoreCorrupt,
            format!("BlockTree Document checkpoint cannot reconstruct: {error}"),
            false,
        )
    })?;
    let decoded = decode_block_document(&document, schema)
        .map_err(|_| corrupt("BlockTree Document checkpoint schema is invalid"))?;
    materialize_decoded_document(&decoded)
        .map_err(|_| corrupt("BlockTree Document checkpoint materialization is invalid"))
}

fn decode_yjs_checkpoint(
    row: &StoredVersionRow,
    schema: BlockDocumentSchema,
) -> Result<DocumentMaterialization, StoreError> {
    let engine = YrsDocumentEngine::from_full_state_v1(&row.document_id, &row.checkpoint_bytes)
        .map_err(|_| corrupt("Yjs Document checkpoint cannot reconstruct"))?;
    if engine.state_vector_v1() != row.state_vector {
        return Err(corrupt("Yjs Document checkpoint state vector diverges"));
    }
    let decoded = decode_block_document(engine.document(), schema)
        .map_err(|_| corrupt("Yjs Document checkpoint schema is invalid"))?;
    materialize_decoded_document(&decoded)
        .map_err(|_| corrupt("Yjs Document checkpoint materialization is invalid"))
}

fn validate_stored_version(row: &StoredVersionRow) -> Result<(), StoreError> {
    validate_identity(&row.version_id, "version_id")?;
    validate_identity(&row.document_id, "document_id")?;
    validate_identity(&row.project_id, "project_id")?;
    if row.generation < 1
        || row.base_head_seq < 0
        || row.schema_version < 1
        || row.byte_length != i64::try_from(row.checkpoint_bytes.len()).unwrap_or(-1)
        || row.checkpoint_bytes.is_empty()
        || sha256(&row.checkpoint_bytes) != row.checkpoint_hash
        || !matches!(row.pinned, 0 | 1)
        || !matches!(
            row.revision_kind.as_str(),
            "automatic" | "manual" | "operation" | "restore" | "safety"
        )
        || row.created_at.is_empty()
    {
        return Err(corrupt("Document version row is invalid"));
    }
    Ok(())
}

fn validate_checkpoint_input(input: &NewDocumentCheckpoint<'_>) -> Result<(), StoreError> {
    validate_identity(input.operation_id, "operation_id")?;
    if input.cause.is_empty()
        || input.cause.len() > 128
        || input.label.is_some_and(|label| label.len() > 512)
        || !matches!(
            input.revision_kind,
            "automatic" | "manual" | "operation" | "restore" | "safety"
        )
        || input.source_change_seq.is_some_and(|sequence| sequence < 1)
        || input.now.is_empty()
    {
        return Err(invalid(
            "Document checkpoint metadata is invalid".to_owned(),
        ));
    }
    Ok(())
}

pub(super) fn prune_document_history(
    connection: &Connection,
    document_id: &str,
    now: &str,
) -> Result<usize, StoreError> {
    const DAY_MS: i64 = 24 * 60 * 60 * 1_000;
    const KEEP_ALL_MS: i64 = 7 * DAY_MS;
    const KEEP_HOURLY_MS: i64 = 30 * DAY_MS;
    const KEEP_DAILY_MS: i64 = 90 * DAY_MS;
    const MAX_UNPINNED: usize = 500;
    let rows = connection
        .prepare(
            "SELECT version_id, created_at, pinned, \
                    CAST(MAX(0, (julianday(?2) - julianday(created_at)) * 86400000) AS INTEGER) \
             FROM document_versions WHERE document_id = ?1 \
             ORDER BY created_at DESC, version_id DESC",
        )?
        .query_map(params![document_id, now], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, Option<i64>>(3)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|_| corrupt("Document revision retention row is invalid"))?;
    let mut hourly = std::collections::HashSet::new();
    let mut daily = std::collections::HashSet::new();
    let mut retained_unpinned = 0usize;
    let mut deleted = 0usize;
    for (version_id, created_at, pinned, age) in rows {
        if pinned == 1 {
            continue;
        }
        let age = age.ok_or_else(|| corrupt("Document revision timestamp is invalid"))?;
        let retain = if age < KEEP_ALL_MS {
            true
        } else if age < KEEP_HOURLY_MS {
            created_at
                .get(..13)
                .is_some_and(|bucket| hourly.insert(bucket.to_owned()))
        } else if age < KEEP_DAILY_MS {
            created_at
                .get(..10)
                .is_some_and(|bucket| daily.insert(bucket.to_owned()))
        } else {
            false
        };
        if retain && retained_unpinned < MAX_UNPINNED {
            retained_unpinned += 1;
            continue;
        }
        deleted = deleted
            .checked_add(connection.execute(
                "DELETE FROM document_versions \
             WHERE version_id = ?1 AND document_id = ?2 AND pinned = 0",
                params![version_id, document_id],
            )?)
            .ok_or_else(|| corrupt("Document revision deletion count overflowed"))?;
    }
    Ok(deleted)
}

fn validate_identity(value: &str, field: &str) -> Result<(), StoreError> {
    if !value.is_empty() && value.len() <= 512 && value.trim() == value {
        return Ok(());
    }
    Err(invalid(format!("{field} is invalid")))
}

fn canonical_json_bytes(value: Value) -> Result<Vec<u8>, StoreError> {
    serde_json::to_vec(&canonical_json(value))
        .map_err(|_| internal("Canonical JSON could not be encoded"))
}

fn canonical_json(value: Value) -> Value {
    match value {
        Value::Array(items) => Value::Array(items.into_iter().map(canonical_json).collect()),
        Value::Object(entries) => {
            let mut keys = entries.keys().cloned().collect::<Vec<_>>();
            keys.sort();
            let mut output = Map::new();
            for key in keys {
                if let Some(value) = entries.get(&key) {
                    output.insert(key, canonical_json(value.clone()));
                }
            }
            Value::Object(output)
        }
        value => value,
    }
}

fn count_blocks(blocks: &[MaterializedBlockNode]) -> usize {
    blocks
        .iter()
        .map(|block| 1 + count_blocks(&block.children))
        .sum()
}

fn invalid(message: String) -> StoreError {
    StoreError::new(StoreErrorCode::InvalidInput, message, false)
}

fn not_found(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::NotFound, message, false)
}

fn corrupt(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message, false)
}

fn internal(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::Internal, message, false)
}
