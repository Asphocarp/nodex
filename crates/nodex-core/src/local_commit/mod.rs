//! Durable local mutation results.
//!
//! A LocalCommit is not a second source of truth and is not a server queue. It
//! is the immutable result row written in the same SQLite transaction as the
//! canonical record changes. Consumers can therefore use the commit cursor for
//! delivery and recovery without waiting for a projection or a network ack.

use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use thiserror::Error;

use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS local_commits (
    store_epoch TEXT NOT NULL,
    commit_seq INTEGER NOT NULL CHECK (commit_seq >= 1),
    commit_id TEXT NOT NULL,
    operation_id TEXT NOT NULL,
    intent_hash TEXT NOT NULL,
    canonical_hash TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    committed_at TEXT NOT NULL,
    effects_json TEXT NOT NULL,
    audience_json TEXT NOT NULL,
    PRIMARY KEY (store_epoch, commit_seq),
    UNIQUE (store_epoch, commit_id),
    UNIQUE (store_epoch, operation_id),
    CHECK (length(trim(store_epoch)) > 0),
    CHECK (length(trim(commit_id)) > 0),
    CHECK (length(trim(operation_id)) > 0),
    CHECK (length(intent_hash) = 64 AND intent_hash NOT GLOB '*[^0-9a-f]*'),
    CHECK (length(canonical_hash) = 64 AND canonical_hash NOT GLOB '*[^0-9a-f]*'),
    CHECK (length(trim(actor_id)) > 0),
    CHECK (length(trim(session_id)) > 0),
    CHECK (length(trim(committed_at)) > 0),
    CHECK (json_valid(effects_json) AND json_type(effects_json) = 'array'),
    CHECK (json_valid(audience_json) AND json_type(audience_json) = 'object')
) WITHOUT ROWID, STRICT;

CREATE INDEX IF NOT EXISTS idx_local_commits_operation
    ON local_commits(store_epoch, operation_id);

CREATE TABLE IF NOT EXISTS local_commit_effects (
    store_epoch TEXT NOT NULL,
    commit_seq INTEGER NOT NULL,
    effect_index INTEGER NOT NULL CHECK (effect_index >= 0),
    effect_kind TEXT NOT NULL,
    effect_json TEXT NOT NULL,
    PRIMARY KEY (store_epoch, commit_seq, effect_index),
    FOREIGN KEY (store_epoch, commit_seq)
        REFERENCES local_commits(store_epoch, commit_seq) ON DELETE CASCADE,
    CHECK (length(trim(effect_kind)) > 0),
    CHECK (json_valid(effect_json) AND json_type(effect_json) = 'object')
) WITHOUT ROWID, STRICT;
"#;

#[derive(Clone, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
pub struct LocalCommitCursor {
    pub store_epoch: String,
    pub commit_seq: i64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct LocalCommitEnvelope {
    pub cursor: LocalCommitCursor,
    pub commit_id: String,
    pub operation_id: String,
    pub intent_hash: String,
    pub canonical_hash: String,
    pub actor_id: String,
    pub session_id: String,
    pub committed_at: String,
    pub effects: Vec<LocalCommitEffect>,
    pub audience: Value,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct LocalCommitEffect {
    pub kind: String,
    pub value: Value,
}

#[derive(Clone, Debug)]
pub struct LocalCommitDraft {
    pub store_epoch: String,
    pub commit_id: String,
    pub operation_id: String,
    pub intent_hash: String,
    pub canonical_hash: String,
    pub actor_id: String,
    pub session_id: String,
    pub committed_at: String,
    pub effects: Vec<LocalCommitEffect>,
    pub audience: Value,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AppendedLocalCommit {
    pub envelope: LocalCommitEnvelope,
    pub duplicate: bool,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum LocalCommitError {
    #[error("LocalCommit input is invalid: {0}")]
    InvalidInput(String),
    #[error("LocalCommit operation identity was reused with a different intent hash")]
    OperationConflict,
    #[error("LocalCommit canonical identity is corrupt")]
    CorruptIdentity,
    #[error("LocalCommit sequence overflowed")]
    SequenceOverflow,
}

pub fn install_schema(connection: &Connection) -> Result<(), StoreError> {
    connection.execute_batch(SCHEMA).map_err(StoreError::from)
}

pub fn append(
    transaction: &Transaction<'_>,
    draft: LocalCommitDraft,
) -> Result<AppendedLocalCommit, StoreError> {
    validate_draft(&draft).map_err(local_commit_invalid)?;

    let existing = transaction
        .query_row(
            "SELECT store_epoch, commit_seq, commit_id, operation_id, intent_hash, canonical_hash, \
                    actor_id, session_id, committed_at, effects_json, audience_json \
             FROM local_commits WHERE store_epoch = ?1 AND operation_id = ?2",
            params![draft.store_epoch, draft.operation_id],
            decode_row,
        )
        .optional()
        .map_err(StoreError::from)?;
    if let Some(existing) = existing {
        if existing.intent_hash != draft.intent_hash {
            return Err(local_commit_invalid(LocalCommitError::OperationConflict));
        }
        if existing.commit_id != draft.commit_id || existing.canonical_hash != draft.canonical_hash
        {
            return Err(local_commit_invalid(LocalCommitError::CorruptIdentity));
        }
        return Ok(AppendedLocalCommit {
            envelope: existing,
            duplicate: true,
        });
    }

    let next_seq = transaction
        .query_row(
            "SELECT COALESCE(MAX(commit_seq), 0) + 1 FROM local_commits WHERE store_epoch = ?1",
            [&draft.store_epoch],
            |row| row.get::<_, i64>(0),
        )
        .map_err(StoreError::from)?;
    if next_seq < 1 {
        return Err(local_commit_invalid(LocalCommitError::SequenceOverflow));
    }
    let effects_json = serde_json::to_string(&draft.effects).map_err(|error| {
        local_commit_invalid(LocalCommitError::InvalidInput(format!(
            "effects cannot be encoded: {error}"
        )))
    })?;
    let audience_json = serde_json::to_string(&draft.audience).map_err(|error| {
        local_commit_invalid(LocalCommitError::InvalidInput(format!(
            "audience cannot be encoded: {error}"
        )))
    })?;
    transaction
        .execute(
            "INSERT INTO local_commits(\
             store_epoch, commit_seq, commit_id, operation_id, intent_hash, canonical_hash, \
             actor_id, session_id, committed_at, effects_json, audience_json\
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                draft.store_epoch,
                next_seq,
                draft.commit_id,
                draft.operation_id,
                draft.intent_hash,
                draft.canonical_hash,
                draft.actor_id,
                draft.session_id,
                draft.committed_at,
                effects_json,
                audience_json,
            ],
        )
        .map_err(StoreError::from)?;
    for (index, effect) in draft.effects.iter().enumerate() {
        let effect_index = i64::try_from(index)
            .map_err(|_| local_commit_invalid(LocalCommitError::SequenceOverflow))?;
        let effect_json = serde_json::to_string(&effect.value).map_err(|error| {
            local_commit_invalid(LocalCommitError::InvalidInput(format!(
                "effect cannot be encoded: {error}"
            )))
        })?;
        transaction
            .execute(
                "INSERT INTO local_commit_effects(\
                 store_epoch, commit_seq, effect_index, effect_kind, effect_json\
                 ) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    draft.store_epoch,
                    next_seq,
                    effect_index,
                    effect.kind,
                    effect_json
                ],
            )
            .map_err(StoreError::from)?;
    }
    Ok(AppendedLocalCommit {
        envelope: LocalCommitEnvelope {
            cursor: LocalCommitCursor {
                store_epoch: draft.store_epoch,
                commit_seq: next_seq,
            },
            commit_id: draft.commit_id,
            operation_id: draft.operation_id,
            intent_hash: draft.intent_hash,
            canonical_hash: draft.canonical_hash,
            actor_id: draft.actor_id,
            session_id: draft.session_id,
            committed_at: draft.committed_at,
            effects: draft.effects,
            audience: draft.audience,
        },
        duplicate: false,
    })
}

pub fn find_by_operation(
    connection: &Connection,
    store_epoch: &str,
    operation_id: &str,
) -> Result<Option<LocalCommitEnvelope>, StoreError> {
    connection
        .query_row(
            "SELECT store_epoch, commit_seq, commit_id, operation_id, intent_hash, canonical_hash, \
                    actor_id, session_id, committed_at, effects_json, audience_json \
             FROM local_commits WHERE store_epoch = ?1 AND operation_id = ?2",
            params![store_epoch, operation_id],
            decode_row,
        )
        .optional()
        .map_err(StoreError::from)
}

pub fn read_after(
    connection: &Connection,
    cursor: &LocalCommitCursor,
    limit: i64,
) -> Result<Vec<LocalCommitEnvelope>, StoreError> {
    if limit < 1 || limit > 10_000 {
        return Err(local_commit_invalid(LocalCommitError::InvalidInput(
            "LocalCommit replay limit is outside 1..=10000".to_owned(),
        )));
    }
    let mut statement = connection
        .prepare(
            "SELECT store_epoch, commit_seq, commit_id, operation_id, intent_hash, canonical_hash, \
                    actor_id, session_id, committed_at, effects_json, audience_json \
             FROM local_commits WHERE store_epoch = ?1 AND commit_seq > ?2 \
             ORDER BY commit_seq LIMIT ?3",
        )
        .map_err(StoreError::from)?;
    statement
        .query_map(
            params![cursor.store_epoch, cursor.commit_seq, limit],
            decode_row,
        )
        .map_err(StoreError::from)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(StoreError::from)
}

pub fn head(
    connection: &Connection,
    store_epoch: &str,
) -> Result<Option<LocalCommitCursor>, StoreError> {
    connection
        .query_row(
            "SELECT MAX(commit_seq)\n             FROM local_commits\n             WHERE store_epoch = ?1",
            [store_epoch],
            |row| {
                let commit_seq = row.get::<_, Option<i64>>(0)?;
                Ok(commit_seq.map(|commit_seq| LocalCommitCursor {
                    store_epoch: store_epoch.to_owned(),
                    commit_seq,
                }))
            },
        )
        .map_err(StoreError::from)
}

pub fn canonical_hash(value: &Value) -> Result<String, StoreError> {
    let bytes = serde_json::to_vec(value).map_err(|error| {
        local_commit_invalid(LocalCommitError::InvalidInput(format!(
            "canonical value cannot be encoded: {error}"
        )))
    })?;
    Ok(hex::encode(Sha256::digest(bytes)))
}

fn decode_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<LocalCommitEnvelope> {
    let effects_json: String = row.get(9)?;
    let audience_json: String = row.get(10)?;
    Ok(LocalCommitEnvelope {
        cursor: LocalCommitCursor {
            store_epoch: row.get(0)?,
            commit_seq: row.get(1)?,
        },
        commit_id: row.get(2)?,
        operation_id: row.get(3)?,
        intent_hash: row.get(4)?,
        canonical_hash: row.get(5)?,
        actor_id: row.get(6)?,
        session_id: row.get(7)?,
        committed_at: row.get(8)?,
        effects: serde_json::from_str(&effects_json).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                9,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?,
        audience: serde_json::from_str(&audience_json).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                10,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?,
    })
}

fn validate_draft(draft: &LocalCommitDraft) -> Result<(), LocalCommitError> {
    for (label, value) in [
        ("store_epoch", draft.store_epoch.as_str()),
        ("commit_id", draft.commit_id.as_str()),
        ("operation_id", draft.operation_id.as_str()),
        ("actor_id", draft.actor_id.as_str()),
        ("session_id", draft.session_id.as_str()),
        ("committed_at", draft.committed_at.as_str()),
    ] {
        if value.trim().is_empty() || value.trim() != value {
            return Err(LocalCommitError::InvalidInput(format!(
                "{label} is invalid"
            )));
        }
    }
    for (label, value) in [
        ("intent_hash", draft.intent_hash.as_str()),
        ("canonical_hash", draft.canonical_hash.as_str()),
    ] {
        if !is_sha256(value) {
            return Err(LocalCommitError::InvalidInput(format!(
                "{label} is invalid"
            )));
        }
    }
    if !draft.audience.is_object() {
        return Err(LocalCommitError::InvalidInput(
            "audience must be an object".to_owned(),
        ));
    }
    for effect in &draft.effects {
        if effect.kind.trim().is_empty() || !effect.value.is_object() {
            return Err(LocalCommitError::InvalidInput(
                "each effect needs a kind and object value".to_owned(),
            ));
        }
    }
    Ok(())
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .as_bytes()
            .iter()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte))
}

fn local_commit_invalid(error: LocalCommitError) -> StoreError {
    let code = match error {
        LocalCommitError::OperationConflict => StoreErrorCode::IdempotencyKeyReused,
        LocalCommitError::CorruptIdentity => StoreErrorCode::StoreCorrupt,
        LocalCommitError::SequenceOverflow => StoreErrorCode::ResourceExhausted,
        LocalCommitError::InvalidInput(_) => StoreErrorCode::InvalidInput,
    };
    StoreError::new(code, error.to_string(), false)
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;
    use serde_json::json;

    use super::*;

    fn hash(seed: &str) -> String {
        format!("{:x}", Sha256::digest(seed.as_bytes()))
    }

    fn draft(operation_id: &str, intent_seed: &str) -> LocalCommitDraft {
        LocalCommitDraft {
            store_epoch: "epoch:test".to_owned(),
            commit_id: format!("commit:{operation_id}"),
            operation_id: operation_id.to_owned(),
            intent_hash: hash(intent_seed),
            canonical_hash: hash("canonical"),
            actor_id: "actor:test".to_owned(),
            session_id: "session:test".to_owned(),
            committed_at: "2026-08-06T00:00:00Z".to_owned(),
            effects: vec![LocalCommitEffect {
                kind: "placement".to_owned(),
                value: json!({"blockId": "title-a", "parent": "board"}),
            }],
            audience: json!({"kind": "library", "projectIds": []}),
        }
    }

    #[test]
    fn appends_in_one_transaction_and_replays_effects_in_order() {
        let mut connection = Connection::open_in_memory().expect("SQLite");
        install_schema(&connection).expect("schema");
        let first = {
            let transaction = connection.transaction().expect("transaction");
            let result = append(&transaction, draft("operation:1", "intent:1")).expect("append");
            transaction.commit().expect("commit");
            result
        };
        assert!(!first.duplicate);
        assert_eq!(first.envelope.cursor.commit_seq, 1);
        assert_eq!(first.envelope.effects.len(), 1);

        let duplicate = {
            let transaction = connection.transaction().expect("transaction");
            let result = append(&transaction, draft("operation:1", "intent:1")).expect("duplicate");
            transaction.commit().expect("commit");
            result
        };
        assert!(duplicate.duplicate);
        assert_eq!(duplicate.envelope, first.envelope);

        let replayed = read_after(
            &connection,
            &LocalCommitCursor {
                store_epoch: "epoch:test".to_owned(),
                commit_seq: 0,
            },
            10,
        )
        .expect("replay");
        assert_eq!(replayed, vec![first.envelope]);
    }

    #[test]
    fn empty_ledger_has_no_head_without_decoding_a_null_epoch() {
        let connection = Connection::open_in_memory().expect("SQLite");
        install_schema(&connection).expect("schema");

        assert_eq!(head(&connection, "epoch:test").expect("head"), None,);
    }

    #[test]
    fn same_operation_with_a_different_intent_hash_is_a_conflict() {
        let mut connection = Connection::open_in_memory().expect("SQLite");
        install_schema(&connection).expect("schema");
        let transaction = connection.transaction().expect("transaction");
        append(&transaction, draft("operation:1", "intent:1")).expect("append");
        let error =
            append(&transaction, draft("operation:1", "intent:2")).expect_err("hash conflict");
        assert_eq!(error.code, StoreErrorCode::IdempotencyKeyReused);
    }

    #[test]
    fn same_operation_with_a_different_canonical_identity_fails_closed() {
        let mut connection = Connection::open_in_memory().expect("SQLite");
        install_schema(&connection).expect("schema");
        let transaction = connection.transaction().expect("transaction");
        append(&transaction, draft("operation:1", "intent:1")).expect("append");
        let mut conflicting = draft("operation:1", "intent:1");
        conflicting.canonical_hash = hash("different-canonical");
        let error = append(&transaction, conflicting).expect_err("identity conflict");
        assert_eq!(error.code, StoreErrorCode::StoreCorrupt);
    }

    #[test]
    fn rollback_removes_the_commit_and_all_effect_rows() {
        let mut connection = Connection::open_in_memory().expect("SQLite");
        install_schema(&connection).expect("schema");
        {
            let transaction = connection.transaction().expect("transaction");
            append(&transaction, draft("operation:rollback", "intent:rollback")).expect("append");
            transaction.rollback().expect("rollback");
        }
        let counts: (i64, i64) = connection
            .query_row(
                "SELECT (SELECT count(*) FROM local_commits), \
                        (SELECT count(*) FROM local_commit_effects)",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("counts");
        assert_eq!(counts, (0, 0));
    }
}
