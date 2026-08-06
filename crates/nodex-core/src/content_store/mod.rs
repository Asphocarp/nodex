//! Rich content is stored per stable Block identity and grouped into physical
//! shards for batching. A shard is not an ownership or Page boundary.

use rusqlite::{Connection, OptionalExtension, Row, Transaction, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::document::{YrsDocumentEngine, YrsEngineError};
use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};

pub const MAX_CONTENT_UPDATE_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_CONTENT_WINDOW_RECORDS: usize = 100_000;
pub const MAX_CONTENT_TAIL_ROWS: i64 = 10_000;

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS content_shards (
  shard_id TEXT PRIMARY KEY NOT NULL,
  library_id TEXT NOT NULL,
  head_seq INTEGER NOT NULL CHECK (head_seq >= 0),
  shard_hash TEXT NOT NULL CHECK (length(shard_hash) = 64 AND shard_hash NOT GLOB '*[^0-9a-f]*'),
  updated_at TEXT NOT NULL,
  CHECK (length(trim(shard_id)) > 0),
  CHECK (length(trim(library_id)) > 0),
  CHECK (length(trim(updated_at)) > 0)
) WITHOUT ROWID, STRICT;

CREATE TABLE IF NOT EXISTS block_contents (
  block_id TEXT NOT NULL,
  slot TEXT NOT NULL CHECK (slot IN ('title', 'inline', 'body', 'properties')),
  library_id TEXT NOT NULL,
  shard_id TEXT NOT NULL REFERENCES content_shards(shard_id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK (revision >= 0),
  state_vector BLOB NOT NULL,
  full_state BLOB NOT NULL,
  state_hash TEXT NOT NULL CHECK (length(state_hash) = 64 AND state_hash NOT GLOB '*[^0-9a-f]*'),
  PRIMARY KEY (block_id, slot),
  FOREIGN KEY (block_id) REFERENCES block_records(id) ON DELETE RESTRICT,
  CHECK (length(trim(block_id)) > 0),
  CHECK (length(trim(library_id)) > 0)
) WITHOUT ROWID, STRICT;

CREATE TRIGGER IF NOT EXISTS block_contents_library_matches_record
BEFORE INSERT ON block_contents
BEGIN
  SELECT RAISE(ABORT, 'content Library does not match BlockRecord')
  WHERE NOT EXISTS (
    SELECT 1 FROM block_records
    WHERE id = NEW.block_id AND library_id = NEW.library_id
  );
END;

CREATE TRIGGER IF NOT EXISTS block_contents_library_matches_record_update
BEFORE UPDATE OF block_id, library_id ON block_contents
BEGIN
  SELECT RAISE(ABORT, 'content Library does not match BlockRecord')
  WHERE NOT EXISTS (
    SELECT 1 FROM block_records
    WHERE id = NEW.block_id AND library_id = NEW.library_id
  );
END;

CREATE INDEX IF NOT EXISTS idx_block_contents_library_window
  ON block_contents(library_id, block_id, slot);

CREATE INDEX IF NOT EXISTS idx_block_contents_shard
  ON block_contents(shard_id, block_id, slot);

CREATE TABLE IF NOT EXISTS content_updates (
  shard_id TEXT NOT NULL REFERENCES content_shards(shard_id) ON DELETE CASCADE,
  update_seq INTEGER NOT NULL CHECK (update_seq >= 1),
  block_id TEXT NOT NULL,
  slot TEXT NOT NULL CHECK (slot IN ('title', 'inline', 'body', 'properties')),
  update_id TEXT NOT NULL,
  update_blob BLOB NOT NULL CHECK (length(update_blob) BETWEEN 1 AND 16777216),
  update_hash TEXT NOT NULL CHECK (length(update_hash) = 64 AND update_hash NOT GLOB '*[^0-9a-f]*'),
  resulting_state_vector BLOB NOT NULL,
  resulting_state_hash TEXT NOT NULL CHECK (length(resulting_state_hash) = 64 AND resulting_state_hash NOT GLOB '*[^0-9a-f]*'),
  committed_at TEXT NOT NULL,
  PRIMARY KEY (shard_id, update_seq),
  UNIQUE (shard_id, update_id),
  FOREIGN KEY (block_id, slot) REFERENCES block_contents(block_id, slot) ON DELETE CASCADE,
  CHECK (length(trim(update_id)) > 0),
  CHECK (length(trim(committed_at)) > 0)
) WITHOUT ROWID, STRICT;

CREATE INDEX IF NOT EXISTS idx_content_updates_block_tail
  ON content_updates(block_id, slot, shard_id, update_seq);
"#;

/// v104 adds a disposable read projection of the Yrs document. It is kept
/// outside block_contents so the CRDT snapshot remains the only content
/// authority and projection rebuilds do not alter the content-record schema.
const MATERIALIZATION_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS block_content_materializations (
  block_id TEXT NOT NULL,
  slot TEXT NOT NULL CHECK (slot IN ('title', 'inline', 'body', 'properties')),
  materialized_json TEXT NOT NULL,
  PRIMARY KEY (block_id, slot),
  FOREIGN KEY (block_id, slot) REFERENCES block_contents(block_id, slot) ON DELETE CASCADE,
  CHECK (json_valid(materialized_json) AND json_type(materialized_json) IN ('array', 'object', 'string', 'number', 'true', 'false', 'null'))
) WITHOUT ROWID, STRICT;

CREATE INDEX IF NOT EXISTS idx_block_content_materializations_block
  ON block_content_materializations(block_id, slot);
"#;

#[derive(Clone, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContentSlot {
    Title,
    Inline,
    Body,
    Properties,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ContentSnapshot {
    pub block_id: String,
    pub slot: ContentSlot,
    pub library_id: String,
    pub shard_id: String,
    pub revision: u64,
    pub state_vector_v1: Vec<u8>,
    pub full_state_v1: Vec<u8>,
    pub state_hash: String,
    /// A deterministic read projection of the same Yrs state. It is not a
    /// second authority: it is regenerated whenever a snapshot/update is
    /// committed and is safe to discard and rebuild.
    pub materialized_json: Option<serde_json::Value>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ContentWindow {
    pub library_id: String,
    pub records: Vec<ContentSnapshot>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ContentUpdateRequest {
    pub shard_id: String,
    pub block_id: String,
    pub slot: ContentSlot,
    pub update_id: String,
    pub update_v1: Vec<u8>,
    pub expected_state_vector_v1: Vec<u8>,
    pub committed_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct AppendedContentUpdate {
    pub shard_id: String,
    pub update_seq: i64,
    pub block_id: String,
    pub slot: ContentSlot,
    pub state_vector_v1: Vec<u8>,
    pub state_hash: String,
    pub did_change: bool,
    pub duplicate: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct ContentTailRow {
    pub shard_id: String,
    pub update_seq: i64,
    pub block_id: String,
    pub slot: ContentSlot,
    pub update_id: String,
    pub update_v1: Vec<u8>,
    pub update_hash: String,
    pub resulting_state_vector_v1: Vec<u8>,
    pub resulting_state_hash: String,
    pub committed_at: String,
}

fn slot_sql(slot: &ContentSlot) -> &'static str {
    match slot {
        ContentSlot::Title => "title",
        ContentSlot::Inline => "inline",
        ContentSlot::Body => "body",
        ContentSlot::Properties => "properties",
    }
}

fn parse_slot(value: &str) -> Option<ContentSlot> {
    match value {
        "title" => Some(ContentSlot::Title),
        "inline" => Some(ContentSlot::Inline),
        "body" => Some(ContentSlot::Body),
        "properties" => Some(ContentSlot::Properties),
        _ => None,
    }
}

pub fn install_schema(connection: &Connection) -> Result<(), StoreError> {
    install_legacy_schema(connection)?;
    install_materialization_schema(connection)
}

/// Installs the v102/v103 content tables without the v104 projection table.
/// Migration inventory generation uses this to keep historical schema
/// fingerprints frozen while fresh runtime test stores get the complete
/// current module through install_schema.
pub fn install_legacy_schema(connection: &Connection) -> Result<(), StoreError> {
    connection.execute_batch(SCHEMA).map_err(StoreError::from)
}

pub fn install_materialization_schema(connection: &Connection) -> Result<(), StoreError> {
    connection
        .execute_batch(MATERIALIZATION_SCHEMA)
        .map_err(StoreError::from)
}

pub fn create_shard(
    transaction: &Transaction<'_>,
    shard_id: &str,
    library_id: &str,
    updated_at: &str,
) -> Result<(), StoreError> {
    validate_id(shard_id, "shard_id")?;
    validate_id(library_id, "library_id")?;
    validate_id(updated_at, "updated_at")?;
    transaction.execute(
        "INSERT INTO content_shards(shard_id, library_id, head_seq, shard_hash, updated_at)
         VALUES (?1, ?2, 0, ?3, ?4)",
        params![shard_id, library_id, sha256(&[]), updated_at],
    )?;
    Ok(())
}

/// Ensures that a physical content shard exists without allowing it to move
/// between libraries. Structural mutations use this when a new BlockRecord is
/// created because a shard may be shared by a bounded group of blocks.
pub fn ensure_shard(
    transaction: &Transaction<'_>,
    shard_id: &str,
    library_id: &str,
    updated_at: &str,
) -> Result<(), StoreError> {
    validate_id(shard_id, "shard_id")?;
    validate_id(library_id, "library_id")?;
    validate_id(updated_at, "updated_at")?;
    transaction.execute(
        "INSERT INTO content_shards(shard_id, library_id, head_seq, shard_hash, updated_at)
         VALUES (?1, ?2, 0, ?3, ?4)
         ON CONFLICT(shard_id) DO NOTHING",
        params![shard_id, library_id, sha256(&[]), updated_at],
    )?;
    let stored_library = transaction
        .query_row(
            "SELECT library_id FROM content_shards WHERE shard_id = ?1",
            [shard_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or_else(|| not_found("content shard"))?;
    if stored_library != library_id {
        return Err(invalid("content shard belongs to a different library"));
    }
    Ok(())
}

/// Builds a valid empty Yrs snapshot for a newly-created BlockRecord slot.
/// Keeping this constructor in the content Module prevents structural writers
/// from inventing incompatible state-vector/hash pairs.
pub fn empty_snapshot(
    block_id: &str,
    slot: ContentSlot,
    library_id: &str,
    shard_id: &str,
) -> Result<ContentSnapshot, StoreError> {
    validate_id(block_id, "block_id")?;
    validate_id(library_id, "library_id")?;
    validate_id(shard_id, "shard_id")?;
    let engine = YrsDocumentEngine::from_full_state_v1(
        format!("content:{}:{}", block_id, slot_sql(&slot)),
        &[],
    )
    .map_err(map_yrs_error)?;
    let full_state_v1 = engine.full_state_v1();
    Ok(ContentSnapshot {
        block_id: block_id.to_owned(),
        slot,
        library_id: library_id.to_owned(),
        shard_id: shard_id.to_owned(),
        revision: 0,
        state_vector_v1: engine.state_vector_v1(),
        state_hash: sha256(&full_state_v1),
        full_state_v1,
        materialized_json: None,
    })
}

/// Builds a BlockNote-compatible content snapshot from a JSON materialization.
/// The JSON is encoded into the same Yrs document shape used by renderer
/// content shards, so future edits still travel through the CRDT update path.
pub fn materialized_snapshot(
    block_id: &str,
    slot: ContentSlot,
    library_id: &str,
    shard_id: &str,
    value: &serde_json::Value,
) -> Result<ContentSnapshot, StoreError> {
    validate_id(block_id, "block_id")?;
    validate_id(library_id, "library_id")?;
    validate_id(shard_id, "shard_id")?;
    let engine = YrsDocumentEngine::from_materialized_json(
        format!("content:{}:{}", block_id, slot_sql(&slot)),
        value,
    )
    .map_err(map_yrs_error)?;
    let full_state_v1 = engine.full_state_v1();
    Ok(ContentSnapshot {
        block_id: block_id.to_owned(),
        slot,
        library_id: library_id.to_owned(),
        shard_id: shard_id.to_owned(),
        revision: 0,
        state_vector_v1: engine.state_vector_v1(),
        state_hash: sha256(&full_state_v1),
        full_state_v1,
        materialized_json: Some(value.clone()),
    })
}

/// Promoting an inline Block to a Page preserves its existing content while
/// giving the Page editor a title slot. The copy is still inside the same
/// structural transaction and never creates a second Block identity.
pub fn ensure_title_from_inline(
    transaction: &Transaction<'_>,
    block_id: &str,
) -> Result<ContentSnapshot, StoreError> {
    if let Some(snapshot) =
        read_snapshot_for_transaction(transaction, block_id, &ContentSlot::Title)?
    {
        return Ok(snapshot);
    }
    ensure_slot_from_slot(
        transaction,
        block_id,
        &ContentSlot::Inline,
        &ContentSlot::Title,
    )?;
    if let Some(snapshot) =
        read_snapshot_for_transaction(transaction, block_id, &ContentSlot::Title)?
    {
        return Ok(snapshot);
    }
    let (library_id, shard_id) = transaction
        .query_row(
            "SELECT library_id, content_shard_id FROM block_records WHERE id = ?1",
            [block_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?
        .ok_or_else(|| not_found("BlockRecord for title content"))?;
    let snapshot = empty_snapshot(block_id, ContentSlot::Title, &library_id, &shard_id)?;
    write_snapshot(transaction, &snapshot)?;
    Ok(snapshot)
}

/// Creates a missing content slot by copying the same Block's existing slot.
/// The copy preserves the CRDT state vector/revision and therefore does not
/// create a second content authority; it only gives a type transition the
/// slot expected by the new Block kind.
pub fn ensure_inline_from_title(
    transaction: &Transaction<'_>,
    block_id: &str,
) -> Result<ContentSnapshot, StoreError> {
    ensure_slot_from_slot(
        transaction,
        block_id,
        &ContentSlot::Title,
        &ContentSlot::Inline,
    )?;
    read_snapshot_for_transaction(transaction, block_id, &ContentSlot::Inline)?
        .ok_or_else(|| not_found("title content record"))
}

pub fn read_snapshot_for_transaction(
    transaction: &Transaction<'_>,
    block_id: &str,
    slot: &ContentSlot,
) -> Result<Option<ContentSnapshot>, StoreError> {
    validate_id(block_id, "block_id")?;
    transaction
        .query_row(
            "SELECT content.block_id, content.slot, content.library_id, content.shard_id,
                    content.revision, content.state_vector, content.full_state, content.state_hash,
                    materialization.materialized_json
             FROM block_contents AS content
             LEFT JOIN block_content_materializations AS materialization
               ON materialization.block_id = content.block_id AND materialization.slot = content.slot
             WHERE content.block_id = ?1 AND content.slot = ?2",
            params![block_id, slot_sql(slot)],
            read_snapshot,
        )
        .optional()
        .map_err(StoreError::from)
}

fn ensure_slot_from_slot(
    transaction: &Transaction<'_>,
    block_id: &str,
    from: &ContentSlot,
    to: &ContentSlot,
) -> Result<(), StoreError> {
    validate_id(block_id, "block_id")?;
    transaction.execute(
        "INSERT INTO block_contents(
           block_id, slot, library_id, shard_id, revision, state_vector, full_state, state_hash
         )
         SELECT block_id, ?2, library_id, shard_id, revision, state_vector, full_state,
                state_hash
         FROM block_contents AS source
         WHERE source.block_id = ?1 AND source.slot = ?3
           AND NOT EXISTS (
             SELECT 1 FROM block_contents AS target
             WHERE target.block_id = source.block_id AND target.slot = ?2
           )",
        params![block_id, slot_sql(to), slot_sql(from)],
    )?;
    transaction.execute(
        "INSERT INTO block_content_materializations(block_id, slot, materialized_json)
         SELECT source.block_id, ?2, materialization.materialized_json
         FROM block_contents AS source
         JOIN block_content_materializations AS materialization
           ON materialization.block_id = source.block_id AND materialization.slot = ?3
         WHERE source.block_id = ?1 AND source.slot = ?3
           AND NOT EXISTS (
             SELECT 1 FROM block_content_materializations AS target
             WHERE target.block_id = source.block_id AND target.slot = ?2
           )",
        params![block_id, slot_sql(to), slot_sql(from)],
    )?;
    Ok(())
}

/// Copies every current content slot from one Block identity to another.
/// Content history is intentionally not copied: a copy starts a new logical
/// record with the source's current CRDT state, while future updates append
/// under the new Block identity. The physical shard may remain shared.
pub fn copy_block_contents(
    transaction: &Transaction<'_>,
    source_block_id: &str,
    target_block_id: &str,
) -> Result<Vec<ContentSnapshot>, StoreError> {
    validate_id(source_block_id, "source_block_id")?;
    validate_id(target_block_id, "target_block_id")?;
    if source_block_id == target_block_id {
        return Err(invalid("content copy source and target must differ"));
    }
    transaction.execute(
        "INSERT INTO block_contents(
           block_id, slot, library_id, shard_id, revision, state_vector, full_state, state_hash
         )
         SELECT ?2, slot, library_id, shard_id, revision, state_vector, full_state, state_hash
         FROM block_contents
         WHERE block_id = ?1",
        params![source_block_id, target_block_id],
    )?;
    transaction.execute(
        "INSERT INTO block_content_materializations(block_id, slot, materialized_json)
         SELECT ?2, slot, materialized_json
         FROM block_content_materializations
         WHERE block_id = ?1",
        params![source_block_id, target_block_id],
    )?;
    [
        ContentSlot::Title,
        ContentSlot::Inline,
        ContentSlot::Body,
        ContentSlot::Properties,
    ]
    .into_iter()
    .map(|slot| read_snapshot_for_transaction(transaction, target_block_id, &slot))
    .collect::<Result<Vec<_>, _>>()
    .map(|snapshots| snapshots.into_iter().flatten().collect())
}

pub fn write_snapshot(
    transaction: &Transaction<'_>,
    snapshot: &ContentSnapshot,
) -> Result<(), StoreError> {
    validate_id(&snapshot.block_id, "block_id")?;
    validate_id(&snapshot.library_id, "library_id")?;
    validate_id(&snapshot.shard_id, "shard_id")?;
    if snapshot.state_hash != sha256(&snapshot.full_state_v1) {
        return Err(invalid("content snapshot hash does not match full state"));
    }
    let shard_library = transaction
        .query_row(
            "SELECT library_id FROM content_shards WHERE shard_id = ?1",
            [snapshot.shard_id.as_str()],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or_else(|| not_found("content shard"))?;
    if shard_library != snapshot.library_id {
        return Err(invalid("content snapshot library does not match shard"));
    }
    if let Some((existing_shard, existing_revision)) = transaction
        .query_row(
            "SELECT shard_id, revision FROM block_contents WHERE block_id = ?1 AND slot = ?2",
            params![snapshot.block_id, slot_sql(&snapshot.slot)],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
        )
        .optional()?
    {
        if existing_shard != snapshot.shard_id {
            return Err(invalid("content shard identity cannot change"));
        }
        if snapshot.revision < u64::try_from(existing_revision).unwrap_or(u64::MAX) {
            return Err(StoreError::new(
                StoreErrorCode::RevisionConflict,
                "content snapshot revision moves backwards",
                true,
            ));
        }
    }
    validate_yrs_state(
        &snapshot.block_id,
        &snapshot.full_state_v1,
        &snapshot.state_vector_v1,
    )?;
    transaction.execute(
        "INSERT INTO block_contents(
           block_id, slot, library_id, shard_id, revision, state_vector, full_state, state_hash
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(block_id, slot) DO UPDATE SET
           library_id = excluded.library_id, shard_id = excluded.shard_id,
           revision = excluded.revision, state_vector = excluded.state_vector,
           full_state = excluded.full_state, state_hash = excluded.state_hash",
        params![
            snapshot.block_id,
            slot_sql(&snapshot.slot),
            snapshot.library_id,
            snapshot.shard_id,
            i64::try_from(snapshot.revision).map_err(|_| corrupt("content revision overflow"))?,
            snapshot.state_vector_v1,
            snapshot.full_state_v1,
            snapshot.state_hash,
        ],
    )?;
    let slot = slot_sql(&snapshot.slot);
    if let Some(value) = &snapshot.materialized_json {
        let value = serde_json::to_string(value)
            .map_err(|error| invalid(format!("content materialization cannot encode: {error}")))?;
        transaction.execute(
            "INSERT INTO block_content_materializations(block_id, slot, materialized_json)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(block_id, slot) DO UPDATE SET materialized_json = excluded.materialized_json",
            params![snapshot.block_id, slot, value],
        )?;
    } else {
        transaction.execute(
            "DELETE FROM block_content_materializations WHERE block_id = ?1 AND slot = ?2",
            params![snapshot.block_id, slot],
        )?;
    }
    Ok(())
}

pub fn replace_materialized_snapshot(
    transaction: &Transaction<'_>,
    block_id: &str,
    slot: ContentSlot,
    expected_revision: u64,
    value: &serde_json::Value,
    update_id: &str,
    committed_at: &str,
) -> Result<ContentSnapshot, StoreError> {
    let current = transaction
        .query_row(
            "SELECT content.block_id, content.slot, content.library_id, content.shard_id,
                    content.revision, content.state_vector, content.full_state, content.state_hash,
                    materialization.materialized_json
             FROM block_contents AS content
             LEFT JOIN block_content_materializations AS materialization
               ON materialization.block_id = content.block_id AND materialization.slot = content.slot
             WHERE content.block_id = ?1 AND content.slot = ?2",
            params![block_id, slot_sql(&slot)],
            read_snapshot,
        )
        .optional()?
        .ok_or_else(|| not_found("content record"))?;
    if current.revision != expected_revision {
        return Err(StoreError::new(
            StoreErrorCode::RevisionConflict,
            "content materialization revision is stale",
            true,
        ));
    }
    validate_id(update_id, "content update_id")?;
    validate_id(committed_at, "content committed_at")?;
    let mut engine = YrsDocumentEngine::from_full_state_v1(
        format!("content:{}:{}", block_id, slot_sql(&slot)),
        &current.full_state_v1,
    )
    .map_err(map_yrs_error)?;
    let Some(update_v1) = engine
        .replace_materialized_json(value)
        .map_err(map_yrs_error)?
    else {
        return Err(StoreError::new(
            StoreErrorCode::Conflict,
            "content materialization produced no change",
            false,
        ));
    };
    let appended = append_update(
        transaction,
        ContentUpdateRequest {
            shard_id: current.shard_id.clone(),
            block_id: block_id.to_owned(),
            slot: slot.clone(),
            update_id: update_id.to_owned(),
            update_v1,
            expected_state_vector_v1: current.state_vector_v1,
            committed_at: committed_at.to_owned(),
        },
    )?;
    if !appended.did_change {
        return Err(StoreError::new(
            StoreErrorCode::Conflict,
            "content materialization produced no change",
            false,
        ));
    }
    transaction
        .query_row(
            "SELECT content.block_id, content.slot, content.library_id, content.shard_id,
                    content.revision, content.state_vector, content.full_state, content.state_hash,
                    materialization.materialized_json
             FROM block_contents AS content
             LEFT JOIN block_content_materializations AS materialization
               ON materialization.block_id = content.block_id AND materialization.slot = content.slot
             WHERE content.block_id = ?1 AND content.slot = ?2",
            params![block_id, slot_sql(&slot)],
            read_snapshot,
        )
        .map_err(StoreError::from)
}

pub fn read_window(
    connection: &Connection,
    library_id: &str,
    block_ids: Option<&[&str]>,
) -> Result<ContentWindow, StoreError> {
    validate_id(library_id, "library_id")?;
    if block_ids.is_some_and(|ids| ids.len() > MAX_CONTENT_WINDOW_RECORDS) {
        return Err(resource_exhausted("content window is too large"));
    }
    if block_ids.is_some_and(|ids| ids.is_empty()) {
        return Ok(ContentWindow {
            library_id: library_id.to_owned(),
            records: Vec::new(),
        });
    }
    let mut statement;
    let mut values = Vec::new();
    values.push(library_id.to_owned());
    if let Some(ids) = block_ids {
        let placeholders = (0..ids.len())
            .map(|index| format!("?{}", index + 2))
            .collect::<Vec<_>>()
            .join(", ");
        values.extend(ids.iter().map(|id| (*id).to_owned()));
        statement = connection.prepare(&format!(
            "SELECT content.block_id, content.slot, content.library_id, content.shard_id,
                    content.revision, content.state_vector, content.full_state, content.state_hash,
                    materialization.materialized_json
             FROM block_contents AS content
             LEFT JOIN block_content_materializations AS materialization
               ON materialization.block_id = content.block_id AND materialization.slot = content.slot
             WHERE content.library_id = ?1 AND content.block_id IN ({})
             ORDER BY content.block_id, content.slot",
            placeholders
        ))?;
    } else {
        statement = connection.prepare(
            "SELECT content.block_id, content.slot, content.library_id, content.shard_id,
                    content.revision, content.state_vector, content.full_state, content.state_hash,
                    materialization.materialized_json
             FROM block_contents AS content
             LEFT JOIN block_content_materializations AS materialization
               ON materialization.block_id = content.block_id AND materialization.slot = content.slot
             WHERE content.library_id = ?1 ORDER BY content.block_id, content.slot",
        )?;
    }
    let mut rows = statement.query(rusqlite::params_from_iter(values))?;
    let mut records = Vec::new();
    while let Some(row) = rows.next()? {
        records.push(read_snapshot(row)?);
        if records.len() > MAX_CONTENT_WINDOW_RECORDS {
            return Err(resource_exhausted("content window exceeds Core bound"));
        }
    }
    Ok(ContentWindow {
        library_id: library_id.to_owned(),
        records,
    })
}

pub fn append_update(
    transaction: &Transaction<'_>,
    request: ContentUpdateRequest,
) -> Result<AppendedContentUpdate, StoreError> {
    validate_id(&request.shard_id, "shard_id")?;
    validate_id(&request.block_id, "block_id")?;
    validate_id(&request.update_id, "update_id")?;
    validate_id(&request.committed_at, "committed_at")?;
    if request.update_v1.is_empty() || request.update_v1.len() > MAX_CONTENT_UPDATE_BYTES {
        return Err(invalid("content update size is outside the Core bound"));
    }
    let update_hash = sha256(&request.update_v1);
    if let Some((block_id, slot, stored_hash, seq, state_vector, resulting_state_hash)) = transaction
        .query_row(
            "SELECT block_id, slot, update_hash, update_seq, resulting_state_vector, resulting_state_hash
             FROM content_updates WHERE shard_id = ?1 AND update_id = ?2",
            params![request.shard_id, request.update_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, Vec<u8>>(4)?,
                    row.get::<_, String>(5)?,
                ))
            },
        )
        .optional()?
    {
        if block_id != request.block_id
            || slot != slot_sql(&request.slot)
            || stored_hash != update_hash
        {
            return Err(StoreError::new(
                StoreErrorCode::IdempotencyKeyReused,
                "content update id was reused with different content",
                false,
            ));
        }
        return Ok(AppendedContentUpdate {
            shard_id: request.shard_id,
            update_seq: seq,
            block_id: request.block_id,
            slot: request.slot,
            state_vector_v1: state_vector.clone(),
            state_hash: resulting_state_hash,
            did_change: true,
            duplicate: true,
        });
    }
    let (library_id, head_seq, previous_hash) = transaction
        .query_row(
            "SELECT library_id, head_seq, shard_hash FROM content_shards WHERE shard_id = ?1",
            [request.shard_id.as_str()],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()?
        .ok_or_else(|| not_found("content shard"))?;
    let current = transaction
        .query_row(
            "SELECT content.block_id, content.slot, content.library_id, content.shard_id,
                    content.revision, content.state_vector, content.full_state, content.state_hash,
                    materialization.materialized_json
             FROM block_contents AS content
             LEFT JOIN block_content_materializations AS materialization
               ON materialization.block_id = content.block_id AND materialization.slot = content.slot
             WHERE content.block_id = ?1 AND content.slot = ?2",
            params![request.block_id, slot_sql(&request.slot)],
            read_snapshot,
        )
        .optional()?
        .ok_or_else(|| not_found("content record"))?;
    if current.shard_id != request.shard_id || current.library_id != library_id {
        return Err(invalid("content record belongs to a different shard"));
    }
    if current.state_vector_v1 != request.expected_state_vector_v1 {
        return Err(StoreError::new(
            StoreErrorCode::RevisionConflict,
            "content state vector is stale",
            true,
        ));
    }
    let mut engine = YrsDocumentEngine::from_full_state_v1(
        format!("content:{}:{}", request.block_id, slot_sql(&request.slot)),
        &current.full_state_v1,
    )
    .map_err(map_yrs_error)?;
    let candidate = engine
        .prepare_update_v1(&request.update_v1)
        .map_err(map_yrs_error)?;
    let commit = engine.commit_candidate(candidate).map_err(map_yrs_error)?;
    if !commit.did_change {
        return Ok(AppendedContentUpdate {
            shard_id: request.shard_id,
            update_seq: head_seq,
            block_id: request.block_id,
            slot: request.slot,
            state_vector_v1: current.state_vector_v1,
            state_hash: current.state_hash,
            did_change: false,
            duplicate: false,
        });
    }
    let next_seq = head_seq
        .checked_add(1)
        .ok_or_else(|| corrupt("content sequence overflow"))?;
    let full_state = engine.full_state_v1();
    let state_vector = commit.state_vector_v1;
    let state_hash = sha256(&full_state);
    let materialized_json = engine
        .materialized_json()
        .map(|value| serde_json::to_string(&value))
        .transpose()
        .map_err(|error| invalid(format!("content materialization cannot encode: {error}")))?;
    let shard_hash = hash_chain(&previous_hash, &update_hash);
    let changed = transaction.execute(
        "UPDATE block_contents SET revision = revision + 1, state_vector = ?1,
         full_state = ?2, state_hash = ?3
         WHERE block_id = ?4 AND slot = ?5",
        params![
            state_vector,
            full_state,
            state_hash,
            request.block_id,
            slot_sql(&request.slot)
        ],
    )?;
    if changed != 1 {
        return Err(StoreError::new(
            StoreErrorCode::RevisionConflict,
            "content record disappeared while applying its update",
            true,
        ));
    }
    if let Some(materialized_json) = materialized_json {
        transaction.execute(
            "INSERT INTO block_content_materializations(block_id, slot, materialized_json)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(block_id, slot) DO UPDATE SET materialized_json = excluded.materialized_json",
            params![request.block_id, slot_sql(&request.slot), materialized_json],
        )?;
    } else {
        transaction.execute(
            "DELETE FROM block_content_materializations WHERE block_id = ?1 AND slot = ?2",
            params![request.block_id, slot_sql(&request.slot)],
        )?;
    }
    let changed = transaction.execute(
        "UPDATE content_shards SET head_seq = ?1, shard_hash = ?2, updated_at = ?3
         WHERE shard_id = ?4 AND head_seq = ?5",
        params![
            next_seq,
            shard_hash,
            request.committed_at,
            request.shard_id,
            head_seq
        ],
    )?;
    if changed != 1 {
        return Err(StoreError::new(
            StoreErrorCode::RevisionConflict,
            "content shard head changed while applying its update",
            true,
        ));
    }
    transaction.execute(
        "INSERT INTO content_updates(
           shard_id, update_seq, block_id, slot, update_id, update_blob, update_hash,
           resulting_state_vector, resulting_state_hash, committed_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            request.shard_id,
            next_seq,
            request.block_id,
            slot_sql(&request.slot),
            request.update_id,
            request.update_v1,
            update_hash,
            state_vector,
            state_hash,
            request.committed_at,
        ],
    )?;
    Ok(AppendedContentUpdate {
        shard_id: request.shard_id,
        update_seq: next_seq,
        block_id: request.block_id,
        slot: request.slot,
        state_vector_v1: state_vector,
        state_hash,
        did_change: true,
        duplicate: false,
    })
}

pub fn read_tail(
    connection: &Connection,
    shard_id: &str,
    after_seq: i64,
    limit: i64,
) -> Result<Vec<ContentTailRow>, StoreError> {
    validate_id(shard_id, "shard_id")?;
    if after_seq < 0 || !(1..=MAX_CONTENT_TAIL_ROWS).contains(&limit) {
        return Err(invalid("content tail limit is invalid"));
    }
    let mut statement = connection.prepare(
        "SELECT shard_id, update_seq, block_id, slot, update_id, update_blob, update_hash,
         resulting_state_vector, resulting_state_hash, committed_at FROM content_updates
         WHERE shard_id = ?1 AND update_seq > ?2 ORDER BY update_seq LIMIT ?3",
    )?;
    statement
        .query_map(params![shard_id, after_seq, limit], read_tail_row)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(StoreError::from)
}

fn read_snapshot(row: &Row<'_>) -> rusqlite::Result<ContentSnapshot> {
    let slot: String = row.get(1)?;
    Ok(ContentSnapshot {
        block_id: row.get(0)?,
        slot: parse_slot(&slot).ok_or_else(|| invalid_row("unknown content slot"))?,
        library_id: row.get(2)?,
        shard_id: row.get(3)?,
        revision: u64::try_from(row.get::<_, i64>(4)?)
            .map_err(|error| invalid_row(error.to_string()))?,
        state_vector_v1: row.get(5)?,
        full_state_v1: row.get(6)?,
        state_hash: row.get(7)?,
        materialized_json: row
            .get::<_, Option<String>>(8)?
            .map(|value| serde_json::from_str(&value))
            .transpose()
            .map_err(|error| invalid_row(format!("invalid materialized content: {error}")))?,
    })
}

fn read_tail_row(row: &Row<'_>) -> rusqlite::Result<ContentTailRow> {
    let slot: String = row.get(3)?;
    Ok(ContentTailRow {
        shard_id: row.get(0)?,
        update_seq: row.get(1)?,
        block_id: row.get(2)?,
        slot: parse_slot(&slot).ok_or_else(|| invalid_row("unknown content slot"))?,
        update_id: row.get(4)?,
        update_v1: row.get(5)?,
        update_hash: row.get(6)?,
        resulting_state_vector_v1: row.get(7)?,
        resulting_state_hash: row.get(8)?,
        committed_at: row.get(9)?,
    })
}

fn validate_yrs_state(block_id: &str, full_state: &[u8], vector: &[u8]) -> Result<(), StoreError> {
    let engine = YrsDocumentEngine::from_full_state_v1(format!("content:{}", block_id), full_state)
        .map_err(map_yrs_error)?;
    if engine.state_vector_v1() != vector {
        return Err(invalid("content state vector does not match full state"));
    }
    Ok(())
}

fn validate_id(value: &str, label: &str) -> Result<(), StoreError> {
    if value.trim().is_empty() || value.trim() != value {
        return Err(invalid(format!("invalid {}", label)));
    }
    Ok(())
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn hash_chain(previous: &str, next: &str) -> String {
    let mut digest = Sha256::new();
    digest.update(previous.as_bytes());
    digest.update([0]);
    digest.update(next.as_bytes());
    format!("{:x}", digest.finalize())
}

fn map_yrs_error(error: YrsEngineError) -> StoreError {
    let retryable = matches!(error, YrsEngineError::CandidateStale);
    let code = if matches!(error, YrsEngineError::MissingDependencies) {
        StoreErrorCode::MissingDependencies
    } else if retryable {
        StoreErrorCode::RevisionConflict
    } else {
        StoreErrorCode::InvalidInput
    };
    StoreError::new(code, error.to_string(), retryable)
}

fn invalid(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::InvalidInput, message, false)
}

fn not_found(what: &str) -> StoreError {
    StoreError::new(
        StoreErrorCode::NotFound,
        format!("{} is missing", what),
        false,
    )
}

fn resource_exhausted(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::ResourceExhausted, message, false)
}

fn corrupt(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message, false)
}

fn invalid_row(error: impl Into<String>) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        0,
        rusqlite::types::Type::Text,
        Box::new(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            error.into(),
        )),
    )
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;
    use yrs::{ReadTxn, StateVector, Text, Transact, WriteTxn};

    use super::*;
    use crate::document::create_compatible_document;
    use crate::infrastructure::sqlite::configure_writer;

    fn database() -> Connection {
        let connection = Connection::open_in_memory().expect("content database");
        configure_writer(&connection).expect("configure content database");
        crate::infrastructure::block_record_store::install_schema(&connection)
            .expect("BlockRecord schema");
        install_schema(&connection).expect("content schema");
        connection
    }

    fn seed_block(transaction: &Transaction<'_>, block_id: &str) {
        transaction
            .execute(
                "INSERT INTO block_records
                 (id, library_id, kind_json, lifecycle, properties_json, content_shard_id, revision)
                 VALUES (?1, 'library:test', 'paragraph', 'active', '{}', 'shard:a', 0)",
                [block_id],
            )
            .expect("BlockRecord");
    }

    fn empty_snapshot(block_id: &str, shard_id: &str) -> ContentSnapshot {
        let engine = YrsDocumentEngine::from_full_state_v1(format!("content:{}", block_id), &[])
            .expect("empty content engine");
        let full_state = engine.full_state_v1();
        ContentSnapshot {
            block_id: block_id.to_owned(),
            slot: ContentSlot::Inline,
            library_id: "library:test".to_owned(),
            shard_id: shard_id.to_owned(),
            revision: 0,
            state_vector_v1: engine.state_vector_v1(),
            state_hash: sha256(&full_state),
            full_state_v1: full_state,
            materialized_json: None,
        }
    }

    fn update_with_text(text: &str) -> Vec<u8> {
        let document = create_compatible_document("content:test");
        let mut transaction = document.transact_mut();
        let content = transaction.get_or_insert_text("content");
        content.insert(&mut transaction, 0, text);
        drop(transaction);
        document
            .transact()
            .encode_state_as_update_v1(&StateVector::default())
    }

    #[test]
    fn reads_a_large_block_window_in_one_bounded_query() {
        let mut connection = database();
        let transaction = connection.transaction().expect("transaction");
        create_shard(&transaction, "shard:a", "library:test", "t0").expect("shard");
        for index in 0..=200 {
            transaction
                .execute(
                    "INSERT INTO block_records
                     (id, library_id, kind_json, lifecycle, properties_json, content_shard_id, revision)
                     VALUES (?1, 'library:test', 'paragraph', 'active', '{}', 'shard:a', 0)",
                    [format!("block:{}", index)],
                )
                .expect("BlockRecord");
            let mut snapshot = empty_snapshot(&format!("block:{}", index), "shard:a");
            snapshot.slot = ContentSlot::Body;
            write_snapshot(&transaction, &snapshot).expect("snapshot");
        }
        transaction.commit().expect("commit");
        let window = read_window(&connection, "library:test", None).expect("window");
        assert_eq!(window.records.len(), 201);
        assert!(
            window
                .records
                .iter()
                .all(|record| record.shard_id == "shard:a")
        );
    }

    #[test]
    fn update_is_causally_checked_and_idempotent() {
        let mut connection = database();
        let transaction = connection.transaction().expect("transaction");
        create_shard(&transaction, "shard:a", "library:test", "t0").expect("shard");
        seed_block(&transaction, "block:a");
        let snapshot = empty_snapshot("block:a", "shard:a");
        write_snapshot(&transaction, &snapshot).expect("snapshot");
        transaction.commit().expect("commit");

        let update_v1 = update_with_text("hello");
        let request = ContentUpdateRequest {
            shard_id: "shard:a".to_owned(),
            block_id: "block:a".to_owned(),
            slot: ContentSlot::Inline,
            update_id: "update:a".to_owned(),
            update_v1: update_v1.clone(),
            expected_state_vector_v1: snapshot.state_vector_v1.clone(),
            committed_at: "t1".to_owned(),
        };
        let transaction = connection.transaction().expect("transaction");
        let appended = append_update(&transaction, request.clone()).expect("append");
        transaction.commit().expect("commit");
        assert_eq!(appended.update_seq, 1);
        assert!(!appended.duplicate);

        let transaction = connection.transaction().expect("transaction");
        let duplicate = append_update(&transaction, request).expect("duplicate");
        transaction.commit().expect("commit duplicate");
        assert_eq!(
            duplicate,
            AppendedContentUpdate {
                duplicate: true,
                ..appended.clone()
            }
        );

        let transaction = connection.transaction().expect("transaction");
        let stale = append_update(
            &transaction,
            ContentUpdateRequest {
                shard_id: "shard:a".to_owned(),
                block_id: "block:a".to_owned(),
                slot: ContentSlot::Inline,
                update_id: "update:b".to_owned(),
                update_v1,
                expected_state_vector_v1: snapshot.state_vector_v1,
                committed_at: "t2".to_owned(),
            },
        )
        .expect_err("stale vector");
        assert_eq!(stale.code, StoreErrorCode::RevisionConflict);
    }

    #[test]
    fn moving_a_block_does_not_change_content_shard_identity() {
        let mut connection = database();
        let transaction = connection.transaction().expect("transaction");
        create_shard(&transaction, "shard:a", "library:test", "t0").expect("shard");
        seed_block(&transaction, "block:a");
        let snapshot = empty_snapshot("block:a", "shard:a");
        write_snapshot(&transaction, &snapshot).expect("snapshot");
        transaction.commit().expect("commit");
        let before = read_window(&connection, "library:test", Some(&["block:a"]))
            .expect("before")
            .records[0]
            .shard_id
            .clone();
        let after = read_window(&connection, "library:test", Some(&["block:a"]))
            .expect("after")
            .records[0]
            .shard_id
            .clone();
        assert_eq!(before, "shard:a");
        assert_eq!(after, before);

        let transaction = connection.transaction().expect("transaction");
        create_shard(&transaction, "shard:b", "library:test", "t2").expect("second shard");
        let mut reassigned = empty_snapshot("block:a", "shard:b");
        reassigned.slot = ContentSlot::Inline;
        let error = write_snapshot(&transaction, &reassigned).expect_err("shard reassignment");
        assert_eq!(error.code, StoreErrorCode::InvalidInput);
    }
}
