use std::collections::BTreeMap;

use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

use nodex_core_contracts::events::{PageDocumentHeadImpact, ProjectionImpact};

use super::projection_impact::{canonicalize, decode, encode};
use super::sqlite::{StoreError, StoreErrorCode};

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct LocalCommitRow {
    pub commit_seq: i64,
    pub store_epoch: String,
    pub operation_id: String,
    pub committed_at: String,
    pub projection_impact: ProjectionImpact,
    pub canonical_hash: String,
}

#[derive(Serialize)]
struct CanonicalCommit {
    hash_version: u32,
    store_epoch: String,
    commit_seq: i64,
    operation_id: String,
    committed_at: String,
    projection_impact: ProjectionImpact,
    effects: Vec<CanonicalEffect>,
    document_refs: Vec<CanonicalDocumentRef>,
}

#[derive(Serialize)]
struct CanonicalEffect {
    effect_order: i64,
    change_log_seq: i64,
    project_id: String,
    store_epoch: String,
    kind: String,
    operation_id: Option<String>,
    block_ids_json: String,
    document_ids_json: String,
    database_block_ids_json: String,
    payload_json: String,
    projection_impact_json: Option<String>,
    committed_at: String,
}

#[derive(Serialize)]
struct CanonicalDocumentRef {
    store_epoch: String,
    commit_seq: i64,
    document_id: String,
    generation: i64,
    head_seq: i64,
    update_id: Option<String>,
    update_hash: Option<String>,
}

const CANONICAL_HASH_VERSION: u32 = 2;

/// Associates one physical change-log effect with its semantic LocalCommit.
/// Every writer calls this immediately after inserting its change-log row,
/// while the enclosing SQLite transaction is still open.
#[allow(clippy::too_many_arguments)]
pub(crate) fn record_effect(
    connection: &Connection,
    store_epoch: &str,
    operation_id: Option<&str>,
    attached_commit_seq: Option<i64>,
    committed_at: &str,
    projection_impact: &ProjectionImpact,
    change_log_seq: i64,
    document_ids: &[String],
    payload_json: &str,
) -> Result<i64, StoreError> {
    if change_log_seq < 1 {
        return Err(corrupt("LocalCommit effect sequence is invalid"));
    }
    let operation_id = operation_id
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| format!("change-log:{change_log_seq}"));
    validate_identity(store_epoch, "LocalCommit Store epoch")?;
    validate_identity(&operation_id, "LocalCommit operation")?;
    if committed_at.is_empty() || committed_at.len() > 64 {
        return Err(corrupt("LocalCommit timestamp is invalid"));
    }

    let projection_impact = canonicalize(projection_impact.clone())?;
    let projection_impact_json = encode(&projection_impact)?;
    let commit_seq = if let Some(commit_seq) = attached_commit_seq {
        if commit_seq < 1 {
            return Err(corrupt("Attached LocalCommit sequence is invalid"));
        }
        let attached_exists = connection
            .query_row(
                "SELECT 1 FROM local_commits
                 WHERE store_epoch = ?1 AND commit_seq = ?2",
                params![store_epoch, commit_seq],
                |row| row.get::<_, i64>(0),
            )
            .optional()?
            .is_some();
        if !attached_exists {
            return Err(corrupt(
                "Change-log effect is attached to the wrong LocalCommit",
            ));
        }
        commit_seq
    } else {
        connection.execute(
            "INSERT OR IGNORE INTO local_commits(
               store_epoch, operation_id, committed_at, projection_impact_json,
               canonical_hash
             ) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                store_epoch,
                operation_id,
                committed_at,
                projection_impact_json,
                empty_hash(),
            ],
        )?;
        connection.query_row(
            "SELECT commit_seq FROM local_commits
             WHERE store_epoch = ?1 AND operation_id = ?2",
            params![store_epoch, operation_id],
            |row| row.get::<_, i64>(0),
        )?
    };
    let effect_order: i64 = connection.query_row(
        "SELECT COALESCE(MAX(effect_order), -1) + 1
         FROM local_commit_effects WHERE commit_seq = ?1",
        [commit_seq],
        |row| row.get(0),
    )?;
    connection.execute(
        "INSERT INTO local_commit_effects(
           store_epoch, commit_seq, effect_order, change_log_seq
         ) VALUES (?1, ?2, ?3, ?4)",
        params![store_epoch, commit_seq, effect_order, change_log_seq],
    )?;
    record_document_refs(
        connection,
        store_epoch,
        commit_seq,
        document_ids,
        payload_json,
    )?;
    refresh_commit(connection, commit_seq)
}

/// Allocates the semantic parent before a multi-effect mutation starts.
/// Physical change-log rows must explicitly attach to this identity; their
/// operation IDs remain independent effect/history coordinates.
pub(crate) fn begin(
    connection: &Connection,
    store_epoch: &str,
    operation_id: &str,
    committed_at: &str,
) -> Result<i64, StoreError> {
    validate_identity(store_epoch, "LocalCommit Store epoch")?;
    validate_identity(operation_id, "LocalCommit operation")?;
    if committed_at.is_empty() || committed_at.len() > 64 {
        return Err(corrupt("LocalCommit timestamp is invalid"));
    }
    connection.execute(
        "INSERT INTO local_commits(
           store_epoch, operation_id, committed_at, projection_impact_json,
           canonical_hash
         ) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            store_epoch,
            operation_id,
            committed_at,
            encode(&ProjectionImpact::None)?,
            empty_hash(),
        ],
    )?;
    let commit_seq = connection.last_insert_rowid();
    if commit_seq < 1 {
        return Err(corrupt("LocalCommit sequence allocation failed"));
    }
    refresh_commit(connection, commit_seq)?;
    Ok(commit_seq)
}

pub(crate) fn commit_seq_for_effect(
    connection: &Connection,
    change_log_seq: i64,
) -> Result<Option<i64>, StoreError> {
    connection
        .query_row(
            "SELECT commit_seq FROM local_commit_effects WHERE change_log_seq = ?1",
            [change_log_seq],
            |row| row.get(0),
        )
        .optional()
        .map_err(StoreError::from)
}

pub(crate) fn head(connection: &Connection) -> Result<i64, StoreError> {
    let head = connection.query_row(
        "SELECT COALESCE(max(commit_seq), 0) FROM local_commits",
        [],
        |row| row.get::<_, i64>(0),
    )?;
    if head < 0 {
        return Err(corrupt("LocalCommit head is invalid"));
    }
    Ok(head)
}

pub(crate) fn read_commit(
    connection: &Connection,
    commit_seq: i64,
) -> Result<Option<LocalCommitRow>, StoreError> {
    let Some(row) = read_commit_row(connection, commit_seq)? else {
        return Ok(None);
    };
    if !is_sha256(&row.canonical_hash) {
        return Err(corrupt("LocalCommit canonical hash is invalid"));
    }
    Ok(Some(row))
}

pub(crate) fn effect_sequences(
    connection: &Connection,
    commit_seq: i64,
) -> Result<Vec<i64>, StoreError> {
    connection
        .prepare(
            "SELECT change_log_seq FROM local_commit_effects
             WHERE commit_seq = ?1 ORDER BY effect_order ASC",
        )?
        .query_map([commit_seq], |row| row.get::<_, i64>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|_| corrupt("LocalCommit effect identity is invalid"))
}

/// Backfills old physical events when a v102 store is first opened. Rows with
/// the same durable operation identity become one historical LocalCommit.
pub(crate) fn backfill(connection: &Connection) -> Result<(), StoreError> {
    let rows = connection
        .prepare(
            "SELECT seq, store_epoch, operation_id, committed_at,
                    projection_impact_json, document_ids_json, payload_json
             FROM change_log ORDER BY seq ASC",
        )?
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, String>(6)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|_| corrupt("Change log historical rows are invalid"))?;
    for (
        sequence,
        store_epoch,
        operation_id,
        committed_at,
        impact_json,
        document_ids_json,
        payload_json,
    ) in rows
    {
        let impact = impact_json
            .as_deref()
            .map(decode)
            .transpose()?
            .unwrap_or(ProjectionImpact::None);
        let document_ids =
            serde_json::from_str::<Vec<String>>(document_ids_json.as_deref().unwrap_or("[]"))
                .map_err(|_| corrupt("Change log document identities are invalid"))?;
        record_effect(
            connection,
            &store_epoch,
            operation_id.as_deref(),
            None,
            &committed_at,
            &impact,
            sequence,
            &document_ids,
            &payload_json,
        )?;
    }
    Ok(())
}

fn refresh_commit(connection: &Connection, commit_seq: i64) -> Result<i64, StoreError> {
    let Some(row) = read_commit_row(connection, commit_seq)? else {
        return Err(corrupt("LocalCommit parent row is missing"));
    };
    let (impact, hash) = canonical_digest(connection, &row)?;
    let impact_json = encode(&impact)?;
    connection.execute(
        "UPDATE local_commits
         SET projection_impact_json = ?1, canonical_hash = ?2
         WHERE commit_seq = ?3",
        params![impact_json, hash, commit_seq],
    )?;
    Ok(commit_seq)
}

pub(crate) fn rebuild_canonical_hashes(connection: &Connection) -> Result<(), StoreError> {
    let commit_sequences = connection
        .prepare("SELECT commit_seq FROM local_commits ORDER BY commit_seq ASC")?
        .query_map([], |row| row.get::<_, i64>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|_| corrupt("LocalCommit hash rebuild sequence is invalid"))?;
    for commit_seq in commit_sequences {
        refresh_commit(connection, commit_seq)?;
    }
    Ok(())
}

pub(crate) fn verify_commit(connection: &Connection, commit_seq: i64) -> Result<(), StoreError> {
    let Some(row) = read_commit(connection, commit_seq)? else {
        return Err(corrupt("LocalCommit parent is missing"));
    };
    let (impact, hash) = canonical_digest(connection, &row)?;
    if row.projection_impact != impact || row.canonical_hash != hash {
        return Err(corrupt(
            "LocalCommit canonical evidence does not match its effects",
        ));
    }
    Ok(())
}

fn canonical_digest(
    connection: &Connection,
    row: &LocalCommitRow,
) -> Result<(ProjectionImpact, String), StoreError> {
    let effects = connection
        .prepare(
            "SELECT effect.effect_order, change.seq, change.project_id,
                    change.store_epoch, change.kind, change.operation_id,
                    change.block_ids_json, change.document_ids_json,
                    change.database_block_ids_json, change.payload_json,
                    change.projection_impact_json, change.committed_at
             FROM local_commit_effects effect
             JOIN change_log change ON change.seq = effect.change_log_seq
             WHERE effect.commit_seq = ?1
             ORDER BY effect.effect_order ASC",
        )?
        .query_map([row.commit_seq], |query_row| {
            Ok(CanonicalEffect {
                effect_order: query_row.get(0)?,
                change_log_seq: query_row.get(1)?,
                project_id: query_row.get(2)?,
                store_epoch: query_row.get(3)?,
                kind: query_row.get(4)?,
                operation_id: query_row.get(5)?,
                block_ids_json: query_row.get(6)?,
                document_ids_json: query_row.get(7)?,
                database_block_ids_json: query_row.get(8)?,
                payload_json: query_row.get(9)?,
                projection_impact_json: query_row.get(10)?,
                committed_at: query_row.get(11)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|_| corrupt("LocalCommit effect evidence is invalid"))?;
    let mut impact = ProjectionImpact::None;
    for effect in &effects {
        impact = merge_projection_impact(
            impact,
            effect
                .projection_impact_json
                .as_deref()
                .map(decode)
                .transpose()?
                .unwrap_or(ProjectionImpact::None),
        )?;
    }
    let impact = canonicalize(impact)?;
    let document_refs = connection
        .prepare(
            "SELECT store_epoch, commit_seq, document_id, generation, head_seq,
                    update_id, update_hash
             FROM local_commit_documents
             WHERE commit_seq = ?1
             ORDER BY document_id ASC, generation ASC, head_seq ASC",
        )?
        .query_map([row.commit_seq], |query_row| {
            Ok(CanonicalDocumentRef {
                store_epoch: query_row.get(0)?,
                commit_seq: query_row.get(1)?,
                document_id: query_row.get(2)?,
                generation: query_row.get(3)?,
                head_seq: query_row.get(4)?,
                update_id: query_row.get(5)?,
                update_hash: query_row.get(6)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|_| corrupt("LocalCommit Document references are invalid"))?;
    let hash_input = CanonicalCommit {
        hash_version: CANONICAL_HASH_VERSION,
        store_epoch: row.store_epoch.clone(),
        commit_seq: row.commit_seq,
        operation_id: row.operation_id.clone(),
        committed_at: row.committed_at.clone(),
        projection_impact: impact.clone(),
        effects,
        document_refs,
    };
    let encoded = serde_json::to_vec(&hash_input)
        .map_err(|_| corrupt("LocalCommit canonical hash input is invalid"))?;
    Ok((impact, format!("{:x}", Sha256::digest(encoded))))
}

fn read_commit_row(
    connection: &Connection,
    commit_seq: i64,
) -> Result<Option<LocalCommitRow>, StoreError> {
    let row = connection
        .query_row(
            "SELECT commit_seq, store_epoch, operation_id, committed_at,
                    projection_impact_json, canonical_hash
             FROM local_commits WHERE commit_seq = ?1",
            [commit_seq],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                ))
            },
        )
        .optional()?;
    let Some((commit_seq, store_epoch, operation_id, committed_at, impact, hash)) = row else {
        return Ok(None);
    };
    Ok(Some(LocalCommitRow {
        commit_seq,
        store_epoch,
        operation_id,
        committed_at,
        projection_impact: decode(&impact)?,
        canonical_hash: hash,
    }))
}

/// Rebinds the immutable local-commit ledger when a validated Store restore
/// installs the candidate under a fresh Store epoch. Child rows and receipts
/// carry the epoch in their foreign-key identity, so the update must happen
/// as one deferred-FK transaction; hashes are then recomputed because the
/// epoch is part of the canonical envelope identity.
pub(crate) fn rebase_store_epoch(
    connection: &Connection,
    store_epoch: &str,
) -> Result<(), StoreError> {
    validate_identity(store_epoch, "LocalCommit Store epoch")?;
    connection.execute_batch("PRAGMA defer_foreign_keys = ON;")?;
    connection.execute(
        "UPDATE local_commit_effects SET store_epoch = ?1 WHERE store_epoch <> ?1",
        [store_epoch],
    )?;
    connection.execute(
        "UPDATE local_commit_documents SET store_epoch = ?1 WHERE store_epoch <> ?1",
        [store_epoch],
    )?;
    connection.execute(
        "UPDATE local_commits SET store_epoch = ?1 WHERE store_epoch <> ?1",
        [store_epoch],
    )?;
    let commit_sequences = connection
        .prepare("SELECT commit_seq FROM local_commits ORDER BY commit_seq ASC")?
        .query_map([], |row| row.get::<_, i64>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|_| corrupt("LocalCommit epoch rebase sequence is invalid"))?;
    for commit_seq in commit_sequences {
        refresh_commit(connection, commit_seq)?;
    }
    Ok(())
}

fn record_document_refs(
    connection: &Connection,
    store_epoch: &str,
    commit_seq: i64,
    document_ids: &[String],
    payload_json: &str,
) -> Result<(), StoreError> {
    let payload = serde_json::from_str::<Value>(payload_json)
        .map_err(|_| corrupt("LocalCommit effect payload is invalid"))?;
    let Some(object) = payload.as_object() else {
        return Err(corrupt("LocalCommit effect payload is not an object"));
    };
    let document_id = object.get("documentId").and_then(Value::as_str);
    let generation = object.get("generation").and_then(Value::as_i64);
    let head_seq = object.get("headSeq").and_then(Value::as_i64);
    let update_id = object.get("updateId").and_then(Value::as_str);
    let update_hash = object.get("updateHash").and_then(Value::as_str);
    if let (Some(document_id), Some(generation), Some(head_seq)) =
        (document_id, generation, head_seq)
        && document_ids
            .iter()
            .any(|candidate| candidate == document_id)
    {
        connection.execute(
            "INSERT OR IGNORE INTO local_commit_documents(
               store_epoch, commit_seq, document_id, generation, head_seq,
               update_id, update_hash
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                store_epoch,
                commit_seq,
                document_id,
                generation,
                head_seq,
                update_id,
                update_hash,
            ],
        )?;
    }
    Ok(())
}

fn merge_projection_impact(
    left: ProjectionImpact,
    right: ProjectionImpact,
) -> Result<ProjectionImpact, StoreError> {
    if matches!(left, ProjectionImpact::All) || matches!(right, ProjectionImpact::All) {
        return Ok(ProjectionImpact::All);
    }
    let (mut page_ids, mut database_ids, mut data_source_ids, mut view_ids, left_heads) = match left
    {
        ProjectionImpact::None => (Vec::new(), Vec::new(), Vec::new(), Vec::new(), Vec::new()),
        ProjectionImpact::Resources {
            page_ids,
            database_ids,
            data_source_ids,
            view_ids,
            document_heads,
        } => (
            page_ids,
            database_ids,
            data_source_ids,
            view_ids,
            document_heads,
        ),
        ProjectionImpact::All => unreachable!(),
    };
    let right_heads = if let ProjectionImpact::Resources {
        page_ids: right_page_ids,
        database_ids: right_database_ids,
        data_source_ids: right_data_source_ids,
        view_ids: right_view_ids,
        document_heads: right_document_heads,
    } = right
    {
        page_ids.extend(right_page_ids);
        database_ids.extend(right_database_ids);
        data_source_ids.extend(right_data_source_ids);
        view_ids.extend(right_view_ids);
        right_document_heads
    } else {
        Vec::new()
    };
    let document_heads = merge_document_head_impacts(left_heads, right_heads)?;
    canonicalize(ProjectionImpact::Resources {
        page_ids,
        database_ids,
        data_source_ids,
        view_ids,
        document_heads,
    })
}

fn merge_document_head_impacts(
    left: Vec<PageDocumentHeadImpact>,
    right: Vec<PageDocumentHeadImpact>,
) -> Result<Vec<PageDocumentHeadImpact>, StoreError> {
    let mut heads = BTreeMap::<(String, String), PageDocumentHeadImpact>::new();
    for head in left.into_iter().chain(right) {
        let key = (head.page_id.clone(), head.document_id.clone());
        let Some(existing) = heads.get_mut(&key) else {
            heads.insert(key, head);
            continue;
        };
        if existing.generation != head.generation {
            return Err(corrupt(
                "LocalCommit contains multiple generations for one Document head",
            ));
        }
        if head.head_seq > existing.head_seq {
            *existing = head;
        }
    }
    Ok(heads.into_values().collect())
}

fn validate_identity(value: &str, label: &str) -> Result<(), StoreError> {
    if !value.is_empty() && value.len() <= 512 && value.trim() == value {
        return Ok(());
    }
    Err(corrupt(&format!("{label} identity is invalid")))
}

fn empty_hash() -> String {
    "0".repeat(64)
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn corrupt(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message, false)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn head(generation: i64, head_seq: i64) -> PageDocumentHeadImpact {
        PageDocumentHeadImpact {
            page_id: "page-a".to_owned(),
            document_id: "document-a".to_owned(),
            generation,
            head_seq,
        }
    }

    #[test]
    fn local_commit_merges_repeated_document_effects_at_the_latest_head() {
        let merged = merge_projection_impact(
            ProjectionImpact::Resources {
                page_ids: vec!["page-a".to_owned()],
                database_ids: Vec::new(),
                data_source_ids: Vec::new(),
                view_ids: Vec::new(),
                document_heads: vec![head(1, 2)],
            },
            ProjectionImpact::Resources {
                page_ids: vec!["page-a".to_owned()],
                database_ids: Vec::new(),
                data_source_ids: Vec::new(),
                view_ids: Vec::new(),
                document_heads: vec![head(1, 3)],
            },
        )
        .expect("repeated Document effects should coalesce");

        assert_eq!(
            merged,
            ProjectionImpact::Resources {
                page_ids: vec!["page-a".to_owned()],
                database_ids: Vec::new(),
                data_source_ids: Vec::new(),
                view_ids: Vec::new(),
                document_heads: vec![head(1, 3)],
            }
        );
    }

    #[test]
    fn local_commit_rejects_repeated_document_identity_across_generations() {
        let error = merge_projection_impact(
            ProjectionImpact::Resources {
                page_ids: vec!["page-a".to_owned()],
                database_ids: Vec::new(),
                data_source_ids: Vec::new(),
                view_ids: Vec::new(),
                document_heads: vec![head(1, 2)],
            },
            ProjectionImpact::Resources {
                page_ids: vec!["page-a".to_owned()],
                database_ids: Vec::new(),
                data_source_ids: Vec::new(),
                view_ids: Vec::new(),
                document_heads: vec![head(2, 1)],
            },
        )
        .expect_err("one LocalCommit cannot span Document generations");

        assert_eq!(error.code, StoreErrorCode::StoreCorrupt);
    }
}
