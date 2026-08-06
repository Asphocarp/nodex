//! SQLite adapter for the BlockRecord/placement authority.
//!
//! The adapter is intentionally small: graph validation lives in the domain
//! Module, while this seam owns table layout, encoding, and transaction-safe
//! persistence.  It is not a projection of the Page Yjs Document.

use std::collections::{BTreeMap, BTreeSet};

use rusqlite::{Connection, OptionalExtension, Row, Transaction, params, params_from_iter};
use serde_json::{Map, Value};

use crate::content_store::{self, ContentSlot};
use crate::domain::block_materialization::MaterializedBlockNode;
use crate::domain::block_record::{
    BlockLifecycle, BlockPlacement, BlockRecord, BlockViewPosition, PlacementParent, RecordGraph,
};
use crate::domain::fractional_rank::materialize_order;
use crate::domain::rich_text::{RichTextItem, RichTextStyles};
use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};

pub const MAX_BLOCK_RECORD_WINDOW: usize = 100_000;
pub const ARCHIVED_RANK_PREFIX: &str = "__nodex_archived__";
pub const RETIRED_RANK_PREFIX: &str = "__nodex_retired__";

pub fn archived_rank_key(block_id: &str, rank_key: &str) -> String {
    format!("{ARCHIVED_RANK_PREFIX}{block_id}__{rank_key}")
}

pub fn active_rank_key_from_archived(block_id: &str, rank_key: &str) -> Option<String> {
    active_rank_key_from_inactive_with_prefix(block_id, rank_key, ARCHIVED_RANK_PREFIX)
}

pub fn retired_rank_key(block_id: &str, rank_key: &str) -> String {
    format!("{RETIRED_RANK_PREFIX}{block_id}__{rank_key}")
}

pub fn active_rank_key_from_retired(block_id: &str, rank_key: &str) -> Option<String> {
    active_rank_key_from_inactive_with_prefix(block_id, rank_key, RETIRED_RANK_PREFIX)
}

pub fn active_rank_key_from_inactive(block_id: &str, rank_key: &str) -> Option<String> {
    active_rank_key_from_archived(block_id, rank_key)
        .or_else(|| active_rank_key_from_retired(block_id, rank_key))
}

fn active_rank_key_from_inactive_with_prefix(
    block_id: &str,
    rank_key: &str,
    prefix: &str,
) -> Option<String> {
    let prefix = format!("{prefix}{block_id}__");
    rank_key.strip_prefix(&prefix).map(ToOwned::to_owned)
}

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS block_record_data_sources (
    data_source_id TEXT PRIMARY KEY NOT NULL,
    library_id TEXT NOT NULL,
    CHECK (length(trim(data_source_id)) > 0),
    CHECK (length(trim(library_id)) > 0)
) WITHOUT ROWID, STRICT;

CREATE TABLE IF NOT EXISTS block_records (
    id TEXT PRIMARY KEY NOT NULL,
    library_id TEXT NOT NULL,
    kind_json TEXT NOT NULL,
    lifecycle TEXT NOT NULL CHECK (lifecycle IN ('active', 'archived', 'retired')),
    properties_json TEXT NOT NULL,
    content_shard_id TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK (revision >= 0)
);

CREATE TABLE IF NOT EXISTS block_placements (
    block_id TEXT PRIMARY KEY NOT NULL
        REFERENCES block_records(id) ON DELETE RESTRICT,
    parent_kind TEXT NOT NULL CHECK (parent_kind IN ('library', 'block', 'data_source')),
    parent_id TEXT,
    rank_key TEXT NOT NULL CHECK (length(trim(rank_key)) > 0),
    revision INTEGER NOT NULL CHECK (revision >= 0),
    UNIQUE (parent_kind, parent_id, rank_key),
    CHECK (
        (parent_kind = 'library' AND parent_id IS NULL)
        OR (parent_kind IN ('block', 'data_source') AND parent_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_block_records_library
    ON block_records(library_id, id);

CREATE INDEX IF NOT EXISTS idx_block_placements_parent_order
    ON block_placements(parent_kind, parent_id, rank_key, block_id);

CREATE TRIGGER IF NOT EXISTS block_placements_block_parent_exists
BEFORE INSERT ON block_placements
WHEN NEW.parent_kind = 'block'
BEGIN
    SELECT RAISE(ABORT, 'block placement parent does not exist')
    WHERE NOT EXISTS (
        SELECT 1 FROM block_records WHERE id = NEW.parent_id AND lifecycle = 'active'
    );
END;

CREATE TRIGGER IF NOT EXISTS block_placements_block_parent_exists_update
BEFORE UPDATE OF parent_kind, parent_id ON block_placements
WHEN NEW.parent_kind = 'block'
BEGIN
    SELECT RAISE(ABORT, 'block placement parent does not exist')
    WHERE NOT EXISTS (
        SELECT 1 FROM block_records WHERE id = NEW.parent_id AND lifecycle = 'active'
    );
END;

CREATE TRIGGER IF NOT EXISTS block_placements_data_source_requires_page
BEFORE INSERT ON block_placements
WHEN NEW.parent_kind = 'data_source'
BEGIN
    SELECT RAISE(ABORT, 'block placement data source does not exist')
    WHERE NOT EXISTS (
        SELECT 1
        FROM block_record_data_sources source
        JOIN block_records block ON block.id = NEW.block_id
        WHERE source.data_source_id = NEW.parent_id
          AND source.library_id = block.library_id
    );
    SELECT RAISE(ABORT, 'only Page records may be placed in a data source')
    WHERE NOT EXISTS (
        SELECT 1
        FROM block_records
        WHERE id = NEW.block_id AND kind_json = '"page"'
    );
END;

CREATE TRIGGER IF NOT EXISTS block_placements_data_source_requires_page_update
BEFORE UPDATE OF parent_kind, parent_id ON block_placements
WHEN NEW.parent_kind = 'data_source'
BEGIN
    SELECT RAISE(ABORT, 'block placement data source does not exist')
    WHERE NOT EXISTS (
        SELECT 1
        FROM block_record_data_sources source
        JOIN block_records block ON block.id = NEW.block_id
        WHERE source.data_source_id = NEW.parent_id
          AND source.library_id = block.library_id
    );
    SELECT RAISE(ABORT, 'only Page records may be placed in a data source')
    WHERE NOT EXISTS (
        SELECT 1
        FROM block_records
        WHERE id = NEW.block_id AND kind_json = '"page"'
    );
END;
"#;

const VIEW_POSITION_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS block_record_view_positions (
    view_id TEXT NOT NULL,
    data_source_id TEXT NOT NULL,
    block_id TEXT NOT NULL REFERENCES block_records(id) ON DELETE RESTRICT,
    library_id TEXT NOT NULL,
    group_key TEXT NOT NULL DEFAULT '',
    rank_key TEXT NOT NULL CHECK (length(trim(rank_key)) > 0),
    revision INTEGER NOT NULL CHECK (revision >= 0),
    PRIMARY KEY (view_id, block_id),
    UNIQUE (view_id, group_key, rank_key),
    CHECK (length(trim(view_id)) > 0),
    CHECK (length(trim(data_source_id)) > 0),
    CHECK (length(trim(library_id)) > 0)
) WITHOUT ROWID, STRICT;

CREATE INDEX IF NOT EXISTS idx_block_record_view_positions_window
    ON block_record_view_positions(data_source_id, view_id, group_key, rank_key, block_id);

CREATE TRIGGER IF NOT EXISTS block_record_view_position_valid_insert
BEFORE INSERT ON block_record_view_positions
BEGIN
    SELECT RAISE(ABORT, 'View position library does not match BlockRecord')
    WHERE NOT EXISTS (
        SELECT 1 FROM block_records
        WHERE id = NEW.block_id AND library_id = NEW.library_id
    );
    SELECT RAISE(ABORT, 'View position Data Source does not match BlockRecord')
    WHERE NOT EXISTS (
        SELECT 1
        FROM block_record_data_sources source
        WHERE source.data_source_id = NEW.data_source_id
          AND source.library_id = NEW.library_id
    );
    SELECT RAISE(ABORT, 'View position requires a Page placement in the Data Source')
    WHERE NOT EXISTS (
        SELECT 1 FROM block_placements placement
        WHERE placement.block_id = NEW.block_id
          AND placement.parent_kind = 'data_source'
          AND placement.parent_id = NEW.data_source_id
    );
    SELECT RAISE(ABORT, 'View position requires a Page Block')
    WHERE NOT EXISTS (
        SELECT 1 FROM block_records
        WHERE id = NEW.block_id AND kind_json = '"page"'
    );
END;

CREATE TRIGGER IF NOT EXISTS block_record_view_position_valid_update
BEFORE UPDATE OF view_id, data_source_id, block_id, library_id ON block_record_view_positions
BEGIN
    SELECT RAISE(ABORT, 'View position library does not match BlockRecord')
    WHERE NOT EXISTS (
        SELECT 1 FROM block_records
        WHERE id = NEW.block_id AND library_id = NEW.library_id
    );
    SELECT RAISE(ABORT, 'View position Data Source does not match BlockRecord')
    WHERE NOT EXISTS (
        SELECT 1
        FROM block_record_data_sources source
        WHERE source.data_source_id = NEW.data_source_id
          AND source.library_id = NEW.library_id
    );
    SELECT RAISE(ABORT, 'View position requires a Page placement in the Data Source')
    WHERE NOT EXISTS (
        SELECT 1 FROM block_placements placement
        WHERE placement.block_id = NEW.block_id
          AND placement.parent_kind = 'data_source'
          AND placement.parent_id = NEW.data_source_id
    );
    SELECT RAISE(ABORT, 'View position requires a Page Block')
    WHERE NOT EXISTS (
        SELECT 1 FROM block_records
        WHERE id = NEW.block_id AND kind_json = '"page"'
    );
END;
"#;

pub fn install_schema(connection: &Connection) -> Result<(), StoreError> {
    connection.execute_batch(SCHEMA)?;
    connection
        .execute_batch(RETIREMENT_SCHEMA)
        .map_err(StoreError::from)
}

const RETIREMENT_SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS block_record_retirements (
    block_id TEXT PRIMARY KEY NOT NULL
        REFERENCES block_records(id) ON DELETE RESTRICT,
    library_id TEXT NOT NULL,
    operation_id TEXT NOT NULL,
    retired_revision INTEGER NOT NULL CHECK (retired_revision >= 0),
    retired_at TEXT NOT NULL,
    CHECK (length(trim(library_id)) > 0),
    CHECK (length(trim(operation_id)) > 0),
    CHECK (length(trim(retired_at)) > 0)
) WITHOUT ROWID, STRICT;

CREATE INDEX IF NOT EXISTS idx_block_record_retirements_operation
    ON block_record_retirements(library_id, operation_id, block_id);
"#;

/// Installs the frozen v102/v103/v104 BlockRecord tables. The historical
/// schema intentionally has no archived lifecycle value; v105 rebuilds it
/// once before publishing the current store.
pub fn install_legacy_schema(connection: &Connection) -> Result<(), StoreError> {
    let legacy = SCHEMA.replace(
        "lifecycle TEXT NOT NULL CHECK (lifecycle IN ('active', 'archived', 'retired'))",
        "lifecycle TEXT NOT NULL CHECK (lifecycle = 'active')",
    );
    connection.execute_batch(&legacy).map_err(StoreError::from)
}

pub fn install_view_position_schema(connection: &Connection) -> Result<(), StoreError> {
    connection
        .execute_batch(VIEW_POSITION_SCHEMA)
        .map_err(StoreError::from)
}

/// Rebuilds the small BlockRecord/content table family when upgrading a
/// v104 store. SQLite cannot alter a CHECK constraint in place; keeping this
/// one-time rewrite at the schema boundary keeps lifecycle and retirement
/// evidence inside the terminal BlockRecord schema.
pub fn ensure_lifecycle_schema(connection: &Connection) -> Result<(), StoreError> {
    let block_records_sql = connection
        .query_row(
            "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'block_records'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    let Some(sql) = block_records_sql else {
        return install_schema(connection);
    };
    if sql.contains("'archived'") && sql.contains("'retired'") {
        install_schema(connection)?;
        return Ok(());
    }

    connection.execute_batch(
        "PRAGMA defer_foreign_keys = ON;
         CREATE TEMP TABLE block_record_lifecycle_backup AS
           SELECT id, library_id, kind_json, lifecycle, properties_json,
                  content_shard_id, revision FROM block_records;
         CREATE TEMP TABLE block_placement_lifecycle_backup AS
           SELECT block_id, parent_kind, parent_id, rank_key, revision
           FROM block_placements;
         CREATE TEMP TABLE block_view_position_lifecycle_backup AS
           SELECT view_id, data_source_id, block_id, library_id, group_key,
                  rank_key, revision FROM block_record_view_positions;
         CREATE TEMP TABLE block_content_lifecycle_backup AS
           SELECT block_id, slot, library_id, shard_id, revision, state_vector,
                  full_state, state_hash FROM block_contents;
         CREATE TEMP TABLE content_update_lifecycle_backup AS
           SELECT shard_id, update_seq, block_id, slot, update_id, update_blob,
                  update_hash, resulting_state_vector, resulting_state_hash,
                  committed_at FROM content_updates;
         CREATE TEMP TABLE content_materialization_lifecycle_backup AS
           SELECT block_id, slot, materialized_json
           FROM block_content_materializations;
         DROP TABLE block_record_view_positions;
         DROP TABLE block_content_materializations;
         DROP TABLE content_updates;
         DROP TABLE block_contents;
         DROP TABLE block_placements;
         DROP TABLE block_records;",
    )?;
    install_schema(connection)?;
    install_view_position_schema(connection)?;
    content_store::install_legacy_schema(connection)?;
    content_store::install_materialization_schema(connection)?;
    connection.execute_batch(
        "INSERT INTO block_records(
           id, library_id, kind_json, lifecycle, properties_json,
           content_shard_id, revision
         ) SELECT id, library_id, kind_json, lifecycle, properties_json,
                  content_shard_id, revision
           FROM block_record_lifecycle_backup;
         INSERT INTO block_placements(
           block_id, parent_kind, parent_id, rank_key, revision
         ) SELECT block_id, parent_kind, parent_id, rank_key, revision
           FROM block_placement_lifecycle_backup;
         INSERT INTO block_contents(
           block_id, slot, library_id, shard_id, revision, state_vector,
           full_state, state_hash
         ) SELECT block_id, slot, library_id, shard_id, revision, state_vector,
                  full_state, state_hash
           FROM block_content_lifecycle_backup;
         INSERT INTO content_updates(
           shard_id, update_seq, block_id, slot, update_id, update_blob,
           update_hash, resulting_state_vector, resulting_state_hash, committed_at
         ) SELECT shard_id, update_seq, block_id, slot, update_id, update_blob,
                  update_hash, resulting_state_vector, resulting_state_hash,
                  committed_at FROM content_update_lifecycle_backup;
         INSERT INTO block_content_materializations(block_id, slot, materialized_json)
           SELECT block_id, slot, materialized_json
           FROM content_materialization_lifecycle_backup;
         INSERT INTO block_record_view_positions(
           view_id, data_source_id, block_id, library_id, group_key, rank_key,
           revision
         ) SELECT view_id, data_source_id, block_id, library_id, group_key,
                  rank_key, revision FROM block_view_position_lifecycle_backup;
         DROP TABLE block_record_lifecycle_backup;
         DROP TABLE block_placement_lifecycle_backup;
         DROP TABLE block_view_position_lifecycle_backup;
         DROP TABLE block_content_lifecycle_backup;
         DROP TABLE content_update_lifecycle_backup;
         DROP TABLE content_materialization_lifecycle_backup;",
    )?;
    let violation = connection
        .prepare("PRAGMA foreign_key_check")?
        .query_row([], |_| Ok(()))
        .optional()?;
    if violation.is_some() {
        return Err(corrupt(
            "BlockRecord lifecycle schema rebuild produced a foreign-key violation",
        ));
    }
    Ok(())
}

/// Converts the legacy relational/document index into the terminal
/// BlockRecord graph exactly once while the store is already inside the
/// v103 migration transaction.
///
/// This is intentionally a migration primitive, not a runtime fallback.  The
/// old tables remain available to the rest of the migration validator, but
/// after this function succeeds every active legacy Block has one canonical
/// BlockRecord, one owning placement, and one local content slot.
pub fn backfill_legacy_records(transaction: &Transaction<'_>) -> Result<(), StoreError> {
    let legacy_count: i64 = transaction
        .query_row(
            "SELECT count(*) FROM blocks AS legacy
             WHERE legacy.lifecycle = 'active'
               AND NOT EXISTS (
                 SELECT 1 FROM block_records AS canonical
                 WHERE canonical.id = legacy.id
               )",
            [],
            |row| row.get(0),
        )
        .map_err(StoreError::from)?;
    if legacy_count == 0 {
        return Ok(());
    }

    transaction
        .execute_batch(
            "CREATE TEMP TABLE block_record_legacy_map(
               block_id TEXT PRIMARY KEY,
               library_id TEXT NOT NULL,
               kind TEXT NOT NULL,
               properties_json TEXT NOT NULL,
               content_shard_id TEXT NOT NULL,
               parent_kind TEXT NOT NULL,
               parent_id TEXT,
               rank_key TEXT NOT NULL
             ) STRICT;",
        )
        .map_err(StoreError::from)?;
    let result = (|| {
        transaction
            .execute(
                r#"
                WITH base AS (
                  SELECT
                    block.id AS block_id,
                    COALESCE(
                      page.library_id,
                      project.library_id,
                      (SELECT id FROM libraries ORDER BY id LIMIT 1)
                    ) AS library_id,
                    CASE
                      WHEN page.block_id IS NOT NULL THEN 'page'
                      WHEN lower(replace(replace(block.type, '-', '_'), ' ', '_'))
                        IN ('paragraph', 'text', 'text_block') THEN 'paragraph'
                      WHEN lower(block.type) LIKE '%heading%' THEN 'heading'
                      WHEN lower(block.type) LIKE '%list%' THEN 'list_item'
                      WHEN lower(block.type) LIKE '%toggle%' THEN 'toggle'
                      WHEN lower(block.type) LIKE '%quote%' THEN 'quote'
                      WHEN lower(block.type) LIKE '%code%' THEN 'code'
                      WHEN lower(block.type) LIKE '%media%'
                        OR lower(block.type) IN ('image', 'file', 'video', 'audio') THEN 'media'
                      WHEN lower(block.type) LIKE '%database%' THEN 'database'
                      WHEN lower(block.type) LIKE '%canvas%' THEN 'canvas'
                      WHEN lower(block.type) LIKE '%reference%' THEN 'reference'
                      ELSE 'paragraph'
                    END AS kind,
                    json_patch(
                      json_object(
                        'legacyType', block.type,
                        'title', coalesce(materialization.title, index_row.text, '')
                      ),
                      coalesce((
                        SELECT json_group_object(
                          property.property_key,
                          CASE
                            WHEN json_valid(property.value_json) THEN json(property.value_json)
                            ELSE json_quote(property.value_json)
                          END
                        )
                        FROM block_properties property
                        WHERE property.block_id = block.id
                      ), '{}')
                    ) AS properties_json,
                    'block-record-shard:' || COALESCE(
                      page.library_id,
                      project.library_id,
                      (SELECT id FROM libraries ORDER BY id LIMIT 1)
                    ) AS content_shard_id,
                    page.parent_kind AS page_parent_kind,
                    page.parent_id AS page_parent_id,
                    index_row.parent_block_id AS indexed_parent_id,
                    index_row.ordinal AS indexed_ordinal,
                    library_placement.rank_key AS library_rank_key,
                    block.type AS legacy_type
                  FROM blocks block
                  JOIN projects project ON project.id = block.project_id
                  LEFT JOIN pages page ON page.block_id = block.id
                  LEFT JOIN document_block_index index_row
                    ON index_row.block_id = block.id
                  LEFT JOIN document_materializations materialization
                    ON materialization.document_id = page.document_id
                  LEFT JOIN library_block_placements library_placement
                    ON library_placement.block_id = block.id
                  WHERE block.lifecycle = 'active'
                ), selected AS (
                  SELECT
                    base.*,
                    CASE
                      WHEN base.page_parent_kind = 'data_source'
                        AND EXISTS (
                          SELECT 1 FROM data_sources source
                          WHERE source.id = base.page_parent_id
                            AND source.library_id = base.library_id
                            AND source.lifecycle = 'active'
                        ) THEN 'data_source'
                      WHEN base.page_parent_kind = 'page'
                        AND EXISTS (
                          SELECT 1 FROM blocks parent
                          JOIN projects parent_project ON parent_project.id = parent.project_id
                          WHERE parent.id = base.page_parent_id
                            AND parent.lifecycle = 'active'
                            AND parent_project.library_id = base.library_id
                        ) THEN 'block'
                      WHEN base.page_parent_kind = 'page'
                        AND EXISTS (
                          SELECT 1 FROM block_records parent
                          WHERE parent.id = base.page_parent_id
                            AND parent.library_id = base.library_id
                            AND parent.lifecycle = 'active'
                        ) THEN 'block'
                      WHEN base.indexed_parent_id IS NOT NULL
                        AND EXISTS (
                          SELECT 1 FROM blocks parent
                          JOIN projects parent_project ON parent_project.id = parent.project_id
                          WHERE parent.id = base.indexed_parent_id
                            AND parent.lifecycle = 'active'
                            AND parent_project.library_id = base.library_id
                        ) THEN 'block'
                      WHEN base.indexed_parent_id IS NOT NULL
                        AND EXISTS (
                          SELECT 1 FROM block_records parent
                          WHERE parent.id = base.indexed_parent_id
                            AND parent.library_id = base.library_id
                            AND parent.lifecycle = 'active'
                        ) THEN 'block'
                      ELSE 'library'
                    END AS selected_parent_kind
                  FROM base
                  WHERE base.library_id IS NOT NULL
                    AND NOT EXISTS (
                      SELECT 1 FROM block_records canonical
                      WHERE canonical.id = base.block_id
                    )
                )
                INSERT INTO block_record_legacy_map(
                  block_id, library_id, kind, properties_json, content_shard_id,
                  parent_kind, parent_id, rank_key
                )
                SELECT
                  selected.block_id,
                  selected.library_id,
                  selected.kind,
                  selected.properties_json,
                  selected.content_shard_id,
                  selected.selected_parent_kind,
                  CASE selected.selected_parent_kind
                    WHEN 'data_source' THEN selected.page_parent_id
                    WHEN 'block' THEN coalesce(selected.page_parent_id, selected.indexed_parent_id)
                    ELSE NULL
                  END,
                  CASE selected.selected_parent_kind
                    WHEN 'data_source' THEN coalesce((
                      SELECT position.rank_key || ':' || selected.block_id
                      FROM database_view_page_positions position
                      JOIN database_views view ON view.id = position.view_id
                      WHERE position.page_block_id = selected.block_id
                        AND view.data_source_id = selected.page_parent_id
                        AND view.lifecycle = 'active'
                      ORDER BY view.rank_key, view.id
                      LIMIT 1
                    ), 'z:' || selected.block_id)
                    WHEN 'block' THEN printf(
                      '%020d:%s',
                      coalesce(selected.indexed_ordinal, 0),
                      selected.block_id
                    )
                    ELSE coalesce(selected.library_rank_key || ':' || selected.block_id,
                                  'z:' || selected.block_id)
                  END
                FROM selected
                "#,
                [],
            )
            .map_err(StoreError::from)?;

        transaction
            .execute(
                "INSERT INTO block_record_data_sources(data_source_id, library_id)
                 SELECT id, library_id FROM data_sources
                 WHERE lifecycle = 'active'
                 ON CONFLICT(data_source_id) DO NOTHING",
                [],
            )
            .map_err(StoreError::from)?;

        canonicalize_legacy_placement_ranks(transaction)?;
        transaction
            .execute(
                "INSERT INTO block_records(
                   id, library_id, kind_json, lifecycle, properties_json,
                   content_shard_id, revision
                 )
                 SELECT block_id, library_id, json_quote(kind), 'active',
                        properties_json, content_shard_id, 0
                 FROM block_record_legacy_map
                 ORDER BY block_id",
                [],
            )
            .map_err(StoreError::from)?;
        transaction
            .execute(
                "INSERT INTO block_placements(
                   block_id, parent_kind, parent_id, rank_key, revision
                 )
                 SELECT block_id, parent_kind, parent_id, rank_key, 0
                 FROM block_record_legacy_map
                 ORDER BY parent_kind, parent_id, rank_key, block_id",
                [],
            )
            .map_err(StoreError::from)?;

        let legacy_rows = transaction
            .prepare(
                "SELECT block_id, kind, library_id, content_shard_id
                 FROM block_record_legacy_map ORDER BY block_id",
            )?
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for (block_id, kind, library_id, shard_id) in legacy_rows {
            content_store::ensure_shard(
                transaction,
                &shard_id,
                &library_id,
                "1970-01-01T00:00:00.000Z",
            )?;
            let slot = if kind == "page" {
                ContentSlot::Title
            } else {
                ContentSlot::Inline
            };
            let snapshot = content_store::empty_snapshot(&block_id, slot, &library_id, &shard_id)?;
            content_store::write_snapshot(transaction, &snapshot)?;
        }

        let legacy_ids = transaction
            .prepare("SELECT block_id FROM block_record_legacy_map ORDER BY block_id")?
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<BTreeSet<_>>>()?;
        backfill_legacy_view_positions_for_ids(transaction, &legacy_ids)?;
        backfill_legacy_content_for_ids(transaction, Some(&legacy_ids))?;
        Ok::<(), StoreError>(())
    })();
    transaction
        .execute_batch("DROP TABLE block_record_legacy_map;")
        .map_err(StoreError::from)?;
    result
}

/// Rebuilds the disposable BlockNote content projection from the legacy
/// materialization once the ownership graph already exists. The old
/// Page-owned Yjs document is not retained as a runtime authority: its
/// validated materialization becomes fresh per-record Yrs state, which keeps
/// the cutover deterministic and lets every future edit use the new content
/// transaction path.
pub fn backfill_legacy_content(transaction: &Transaction<'_>) -> Result<(), StoreError> {
    backfill_legacy_content_for_ids(transaction, None)
}

fn backfill_legacy_content_for_ids(
    transaction: &Transaction<'_>,
    block_ids: Option<&BTreeSet<String>>,
) -> Result<(), StoreError> {
    let filter_ids =
        |block_id: &str| block_ids.map_or(true, |selected| selected.contains(block_id));
    let records = transaction
        .prepare(
            "SELECT id, kind_json, library_id, content_shard_id
             FROM block_records ORDER BY id",
        )?
        .query_map([], |row| {
            let kind_json: String = row.get(1)?;
            Ok((
                row.get::<_, String>(0)?,
                serde_json::from_str::<String>(&kind_json).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        1,
                        rusqlite::types::Type::Text,
                        Box::new(error),
                    )
                })?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let records = records
        .into_iter()
        .map(|(id, kind, library_id, shard_id)| (id, (kind, library_id, shard_id)))
        .collect::<BTreeMap<_, _>>();

    let page_titles = transaction
        .prepare(
            "SELECT page.block_id, materialization.title_rich_json
             FROM pages AS page
             JOIN document_materializations AS materialization
               ON materialization.document_id = page.document_id
             WHERE page.lifecycle = 'active'
             ORDER BY page.block_id",
        )?
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (block_id, rich_title_json) in page_titles {
        if !filter_ids(&block_id) {
            continue;
        }
        let Some((kind, library_id, shard_id)) = records.get(&block_id) else {
            continue;
        };
        if kind != "page" {
            continue;
        }
        let rich_title =
            serde_json::from_str::<Vec<RichTextItem>>(&rich_title_json).map_err(|error| {
                corrupt(format!("Legacy Page {block_id} title is invalid: {error}"))
            })?;
        let value = rich_title_to_portable_rich_text(&rich_title);
        let snapshot = content_store::materialized_snapshot(
            &block_id,
            ContentSlot::Title,
            library_id,
            shard_id,
            &value,
        )?;
        content_store::write_snapshot(transaction, &snapshot)?;
    }

    let materializations = transaction
        .prepare(
            "SELECT document_id, block_tree_json
             FROM document_materializations ORDER BY document_id",
        )?
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (document_id, block_tree_json) in materializations {
        let tree = serde_json::from_str::<Vec<MaterializedBlockNode>>(&block_tree_json).map_err(
            |error| {
                corrupt(format!(
                    "Legacy Document {document_id} tree is invalid: {error}"
                ))
            },
        )?;
        let mut nodes = Vec::new();
        collect_materialized_nodes(&tree, &mut nodes);
        for node in nodes {
            if !filter_ids(&node.id) {
                continue;
            }
            let Some((kind, library_id, shard_id)) = records.get(&node.id) else {
                continue;
            };
            if kind == "page" {
                continue;
            }
            let value = node
                .content
                .clone()
                .unwrap_or_else(|| Value::Array(Vec::new()));
            let snapshot = content_store::materialized_snapshot(
                &node.id,
                ContentSlot::Inline,
                library_id,
                shard_id,
                &value,
            )?;
            content_store::write_snapshot(transaction, &snapshot)?;
        }
    }
    Ok(())
}

fn collect_materialized_nodes<'a>(
    nodes: &'a [MaterializedBlockNode],
    output: &mut Vec<&'a MaterializedBlockNode>,
) {
    for node in nodes {
        output.push(node);
        collect_materialized_nodes(&node.children, output);
    }
}

fn rich_title_to_portable_rich_text(items: &[RichTextItem]) -> Value {
    Value::Array(
        items
            .iter()
            .map(|item| match item {
                RichTextItem::Text { text, styles } => {
                    serde_json::json!({"type": "text", "text": text, "styles": rich_styles(styles)})
                }
                RichTextItem::Link { text, href, styles } => serde_json::json!({
                    "type": "link",
                    "text": text,
                    "href": href,
                    "styles": rich_styles(styles),
                }),
                RichTextItem::LineBreak => {
                    serde_json::json!({"type": "text", "text": "\n", "styles": {}})
                }
                RichTextItem::ThreadMention { uuid } => {
                    serde_json::json!({"type": "threadMention", "uuid": uuid})
                }
                RichTextItem::DateMention {
                    start,
                    end,
                    tz,
                    format,
                    time_format,
                    reminder,
                } => serde_json::json!({
                    "type": "dateMention",
                    "start": start,
                    "end": end,
                    "tz": tz,
                    "format": format,
                    "timeFormat": time_format,
                    "reminder": reminder,
                }),
            })
            .collect(),
    )
}

fn rich_styles(styles: &RichTextStyles) -> Value {
    let mut output = Map::new();
    if styles.bold {
        output.insert("bold".to_owned(), Value::Bool(true));
    }
    if styles.italic {
        output.insert("italic".to_owned(), Value::Bool(true));
    }
    if styles.underline {
        output.insert("underline".to_owned(), Value::Bool(true));
    }
    if styles.strikethrough {
        output.insert("strike".to_owned(), Value::Bool(true));
    }
    if styles.code {
        output.insert("code".to_owned(), Value::Bool(true));
    }
    if let Some(color) = &styles.color {
        let key = if color.ends_with("_bg") {
            "backgroundColor"
        } else {
            "textColor"
        };
        output.insert(key.to_owned(), Value::String(color.clone()));
    }
    Value::Object(output)
}

fn canonicalize_legacy_placement_ranks(transaction: &Transaction<'_>) -> Result<(), StoreError> {
    let rows = transaction
        .prepare(
            "SELECT block_id, parent_kind, parent_id, rank_key
             FROM block_record_legacy_map
             ORDER BY parent_kind, parent_id, rank_key, block_id",
        )?
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, String>(3)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut groups: BTreeMap<(String, Option<String>), Vec<(String, String)>> = BTreeMap::new();
    for (block_id, parent_kind, parent_id, rank_key) in rows {
        groups
            .entry((parent_kind, parent_id))
            .or_default()
            .push((block_id, rank_key));
    }
    for items in groups.values() {
        let ids = items.iter().map(|(id, _)| id.clone()).collect::<Vec<_>>();
        let ranks = materialize_order(&ids).map_err(|error| {
            StoreError::new(
                StoreErrorCode::ResourceExhausted,
                format!(
                    "Legacy placement rank materialization failed: {}",
                    error.message
                ),
                false,
            )
        })?;
        for (block_id, _) in items {
            let rank_key = ranks.get(block_id).ok_or_else(|| {
                StoreError::new(
                    StoreErrorCode::StoreCorrupt,
                    "Legacy placement rank materialization omitted a Block",
                    false,
                )
            })?;
            transaction.execute(
                "UPDATE block_record_legacy_map SET rank_key = ?1 WHERE block_id = ?2",
                params![rank_key, block_id],
            )?;
        }
    }
    Ok(())
}

fn backfill_legacy_view_positions_for_ids(
    transaction: &Transaction<'_>,
    block_ids: &BTreeSet<String>,
) -> Result<(), StoreError> {
    let rows = transaction
        .prepare(
            r##"SELECT
                   view.id,
                   view.data_source_id,
                   membership.page_block_id,
                   source.library_id,
                   coalesce(position.group_key, ''),
                   coalesce(position.rank_key, 'z:' || membership.page_block_id),
                   coalesce(position.revision, 0)
                 FROM database_views view
                 JOIN data_sources source ON source.id = view.data_source_id
                 JOIN data_source_page_memberships membership
                   ON membership.data_source_id = view.data_source_id
                  AND membership.removed_at IS NULL
                 JOIN block_records record ON record.id = membership.page_block_id
                 JOIN block_placements placement
                   ON placement.block_id = record.id
                  AND placement.parent_kind = 'data_source'
                  AND placement.parent_id = view.data_source_id
                 LEFT JOIN database_view_page_positions position
                   ON position.view_id = view.id
                  AND position.page_block_id = membership.page_block_id
                 WHERE view.lifecycle = 'active'
                   AND source.lifecycle = 'active'
                   AND record.kind_json = '"page"'
                 ORDER BY view.id, coalesce(position.group_key, ''),
                   coalesce(position.rank_key, 'z:' || membership.page_block_id),
                   membership.page_block_id"##,
        )?
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, i64>(6)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut groups: BTreeMap<(String, String), Vec<(String, String, String, String, i64)>> =
        BTreeMap::new();
    for (view_id, data_source_id, block_id, library_id, group_key, rank_key, revision) in rows {
        if !block_ids.contains(&block_id) {
            continue;
        }
        groups.entry((view_id, group_key)).or_default().push((
            block_id,
            data_source_id,
            library_id,
            rank_key,
            revision,
        ));
    }
    for ((view_id, group_key), items) in groups {
        let ids = items
            .iter()
            .map(|(block_id, ..)| block_id.clone())
            .collect::<Vec<_>>();
        let ranks = materialize_order(&ids).map_err(|error| {
            StoreError::new(
                StoreErrorCode::ResourceExhausted,
                format!("Legacy View rank materialization failed: {}", error.message),
                false,
            )
        })?;
        for (block_id, data_source_id, library_id, _, revision) in items {
            let rank_key = ranks.get(&block_id).ok_or_else(|| {
                StoreError::new(
                    StoreErrorCode::StoreCorrupt,
                    "Legacy View rank materialization omitted a Page",
                    false,
                )
            })?;
            upsert_view_position(
                transaction,
                &BlockViewPosition {
                    view_id: view_id.clone(),
                    data_source_id,
                    block_id,
                    group_key: if group_key.is_empty() {
                        None
                    } else {
                        Some(group_key.clone())
                    },
                    rank_key: rank_key.clone(),
                    revision: u64::try_from(revision).map_err(|_| {
                        StoreError::new(
                            StoreErrorCode::StoreCorrupt,
                            "Legacy View revision is negative",
                            false,
                        )
                    })?,
                },
                &library_id,
            )?;
        }
    }
    Ok(())
}

pub fn ensure_data_source(
    transaction: &Transaction<'_>,
    data_source_id: &str,
    library_id: &str,
) -> Result<(), StoreError> {
    if data_source_id.trim().is_empty() || library_id.trim().is_empty() {
        return Err(StoreError::new(
            StoreErrorCode::InvalidInput,
            "BlockRecord Data Source identity is invalid",
            false,
        ));
    }
    let changed = transaction
        .execute(
            "INSERT INTO block_record_data_sources(data_source_id, library_id)
             VALUES (?1, ?2)
             ON CONFLICT(data_source_id) DO NOTHING",
            params![data_source_id, library_id],
        )
        .map_err(StoreError::from)?;
    if changed == 0 {
        let existing_library = transaction
            .query_row(
                "SELECT library_id FROM block_record_data_sources
                 WHERE data_source_id = ?1",
                [data_source_id],
                |row| row.get::<_, String>(0),
            )
            .map_err(StoreError::from)?;
        if existing_library != library_id {
            return Err(StoreError::new(
                StoreErrorCode::Conflict,
                "BlockRecord Data Source belongs to another Library",
                false,
            ));
        }
    }
    Ok(())
}

pub fn upsert_view_position(
    transaction: &Transaction<'_>,
    position: &BlockViewPosition,
    library_id: &str,
) -> Result<(), StoreError> {
    if position.view_id.trim().is_empty()
        || position.data_source_id.trim().is_empty()
        || position.block_id.trim().is_empty()
        || library_id.trim().is_empty()
        || position.rank_key.trim().is_empty()
    {
        return Err(StoreError::new(
            StoreErrorCode::InvalidInput,
            "BlockRecord View position identity is invalid",
            false,
        ));
    }
    transaction
        .execute(
            "INSERT INTO block_record_view_positions
             (view_id, data_source_id, block_id, library_id, group_key, rank_key, revision)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(view_id, block_id) DO UPDATE SET
               data_source_id = excluded.data_source_id,
               library_id = excluded.library_id,
               group_key = excluded.group_key,
               rank_key = excluded.rank_key,
               revision = excluded.revision",
            params![
                position.view_id,
                position.data_source_id,
                position.block_id,
                library_id,
                position.group_key.as_deref().unwrap_or(""),
                position.rank_key,
                i64::try_from(position.revision)
                    .map_err(|_| corrupt("View position revision exceeds SQLite range"))?,
            ],
        )
        .map_err(StoreError::from)?;
    Ok(())
}

pub fn delete_view_positions_for_block(
    transaction: &Transaction<'_>,
    block_id: &str,
    library_id: &str,
) -> Result<Vec<BlockViewPosition>, StoreError> {
    let positions = transaction
        .prepare(
            "SELECT view_id, data_source_id, block_id, group_key, rank_key, revision
             FROM block_record_view_positions
             WHERE block_id = ?1 AND library_id = ?2
             ORDER BY view_id",
        )?
        .query_map(params![block_id, library_id], |row| {
            let group_key = row.get::<_, String>(3)?;
            let revision = row.get::<_, i64>(5)?;
            Ok(BlockViewPosition {
                view_id: row.get(0)?,
                data_source_id: row.get(1)?,
                block_id: row.get(2)?,
                group_key: (!group_key.is_empty()).then_some(group_key),
                rank_key: row.get(4)?,
                revision: u64::try_from(revision)
                    .map_err(|_| rusqlite::Error::IntegralValueOutOfRange(5, revision))?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    transaction.execute(
        "DELETE FROM block_record_view_positions WHERE block_id = ?1 AND library_id = ?2",
        params![block_id, library_id],
    )?;
    Ok(positions)
}

pub fn read_view_positions(
    connection: &Connection,
    library_id: &str,
    view_id: &str,
    data_source_id: &str,
    block_ids: Option<&[String]>,
) -> Result<Vec<BlockViewPosition>, StoreError> {
    if library_id.trim().is_empty() || view_id.trim().is_empty() || data_source_id.trim().is_empty()
    {
        return Err(StoreError::new(
            StoreErrorCode::InvalidInput,
            "BlockRecord View read identity is invalid",
            false,
        ));
    }
    if block_ids.is_some_and(|ids| ids.len() > 10_000) {
        return Err(StoreError::new(
            StoreErrorCode::ResourceExhausted,
            "BlockRecord View selection contains too many IDs",
            false,
        ));
    }
    let mut sql = String::from(
        "SELECT view_id, data_source_id, block_id, group_key, rank_key, revision
         FROM block_record_view_positions
         WHERE library_id = ?1 AND view_id = ?2 AND data_source_id = ?3",
    );
    let mut values = vec![
        rusqlite::types::Value::Text(library_id.to_owned()),
        rusqlite::types::Value::Text(view_id.to_owned()),
        rusqlite::types::Value::Text(data_source_id.to_owned()),
    ];
    if let Some(ids) = block_ids {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let start = values.len() + 1;
        let placeholders = (start..start + ids.len())
            .map(|index| format!("?{index}"))
            .collect::<Vec<_>>()
            .join(", ");
        sql.push_str(&format!(" AND block_id IN ({placeholders})"));
        values.extend(ids.iter().cloned().map(rusqlite::types::Value::Text));
    }
    sql.push_str(" ORDER BY group_key, rank_key, block_id");
    let mut statement = connection.prepare(&sql).map_err(StoreError::from)?;
    statement
        .query_map(params_from_iter(values), |row| {
            Ok(BlockViewPosition {
                view_id: row.get(0)?,
                data_source_id: row.get(1)?,
                block_id: row.get(2)?,
                group_key: match row.get::<_, String>(3)?.as_str() {
                    "" => None,
                    value => Some(value.to_owned()),
                },
                rank_key: row.get(4)?,
                revision: u64::try_from(row.get::<_, i64>(5)?).map_err(|error| {
                    rusqlite::Error::FromSqlConversionFailure(
                        5,
                        rusqlite::types::Type::Integer,
                        Box::new(error),
                    )
                })?,
            })
        })
        .map_err(StoreError::from)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(StoreError::from)
}

pub fn insert_block(
    transaction: &Transaction<'_>,
    block: &BlockRecord,
    placement: &BlockPlacement,
) -> Result<(), StoreError> {
    if block.id != placement.block_id || block.library_id.trim().is_empty() {
        return Err(corrupt("BlockRecord insert identity is invalid"));
    }
    insert_record(transaction, block)?;
    insert_placement(transaction, placement)
}

pub fn insert_record(transaction: &Transaction<'_>, block: &BlockRecord) -> Result<(), StoreError> {
    if block.id.trim().is_empty() || block.library_id.trim().is_empty() {
        return Err(corrupt("BlockRecord identity is invalid"));
    }
    transaction
        .execute(
            "INSERT INTO block_records
             (id, library_id, kind_json, lifecycle, properties_json, content_shard_id, revision)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                block.id,
                block.library_id,
                serde_json::to_string(&block.kind).map_err(encode_error)?,
                lifecycle_to_sql(&block.lifecycle),
                serde_json::to_string(&block.properties).map_err(encode_error)?,
                block.content_shard_id,
                i64::try_from(block.revision)
                    .map_err(|_| corrupt("BlockRecord revision exceeds SQLite range"))?,
            ],
        )
        .map_err(StoreError::from)?;
    Ok(())
}

pub fn insert_placement(
    transaction: &Transaction<'_>,
    placement: &BlockPlacement,
) -> Result<(), StoreError> {
    let (parent_kind, parent_id) = parent_to_sql(&placement.parent);
    transaction
        .execute(
            "INSERT INTO block_placements
             (block_id, parent_kind, parent_id, rank_key, revision)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                placement.block_id,
                parent_kind,
                parent_id,
                placement.rank_key,
                i64::try_from(placement.revision)
                    .map_err(|_| corrupt("Placement revision exceeds SQLite range"))?,
            ],
        )
        .map_err(StoreError::from)?;
    Ok(())
}

pub fn write_graph(transaction: &Transaction<'_>, graph: &RecordGraph) -> Result<(), StoreError> {
    graph
        .validate()
        .map_err(|error| corrupt(format!("Cannot persist invalid BlockRecord graph: {error}")))?;

    for block in graph.blocks() {
        insert_record(transaction, block)?;
    }
    for placement in graph.placements() {
        insert_placement(transaction, placement)?;
    }
    Ok(())
}

/// Replaces a graph inside the caller's transaction. This is deliberately a
/// transaction primitive for the first cutover kernel; production callers must
/// keep the graph replacement and LocalCommit append in the same transaction.
pub fn replace_graph(transaction: &Transaction<'_>, graph: &RecordGraph) -> Result<(), StoreError> {
    graph
        .validate()
        .map_err(|error| corrupt(format!("Cannot persist invalid BlockRecord graph: {error}")))?;
    transaction
        .execute(
            "DELETE FROM block_placements WHERE block_id IN \
             (SELECT id FROM block_records WHERE library_id = ?1)",
            [graph.library_id()],
        )
        .map_err(StoreError::from)?;
    transaction
        .execute(
            "DELETE FROM block_records WHERE library_id = ?1",
            [graph.library_id()],
        )
        .map_err(StoreError::from)?;
    write_graph(transaction, graph)
}

pub fn update_block_record(
    transaction: &Transaction<'_>,
    previous: &BlockRecord,
    next: &BlockRecord,
) -> Result<(), StoreError> {
    if previous.id != next.id || previous.library_id != next.library_id {
        return Err(corrupt("BlockRecord delta changed identity or Library"));
    }
    let changed = transaction
        .execute(
            "UPDATE block_records SET kind_json = ?1, lifecycle = ?2, properties_json = ?3,
             content_shard_id = ?4, revision = ?5
             WHERE id = ?6 AND library_id = ?7 AND revision = ?8",
            params![
                serde_json::to_string(&next.kind).map_err(encode_error)?,
                lifecycle_to_sql(&next.lifecycle),
                serde_json::to_string(&next.properties).map_err(encode_error)?,
                next.content_shard_id,
                i64::try_from(next.revision)
                    .map_err(|_| corrupt("BlockRecord revision exceeds SQLite range"))?,
                next.id,
                next.library_id,
                i64::try_from(previous.revision)
                    .map_err(|_| corrupt("BlockRecord revision exceeds SQLite range"))?,
            ],
        )
        .map_err(StoreError::from)?;
    if changed != 1 {
        return Err(StoreError::new(
            StoreErrorCode::RevisionConflict,
            format!("BlockRecord {} changed while applying its delta", next.id),
            true,
        ));
    }
    Ok(())
}

/// Archives an active record while retaining its identity, ownership edge and
/// content history for recovery/history tooling. The placement is parked under
/// a Block-specific rank token instead of being deleted, so a restore can
/// recover the complete owned subtree without a second placement authority.
pub fn archive_block(
    transaction: &Transaction<'_>,
    previous: &BlockRecord,
) -> Result<BlockRecord, StoreError> {
    transition_active_block(
        transaction,
        previous,
        BlockLifecycle::Archived,
        ARCHIVED_RANK_PREFIX,
        "archiving",
    )
}

/// Retires an active record while retaining the same recovery placement as an
/// archive. Retirement is the canonical tombstone used by Page deletion; it
/// must not be conflated with the user-visible archived lifecycle.
pub fn retire_block(
    transaction: &Transaction<'_>,
    previous: &BlockRecord,
    operation_id: &str,
    retired_at: &str,
) -> Result<BlockRecord, StoreError> {
    if operation_id.trim().is_empty() || retired_at.trim().is_empty() {
        return Err(StoreError::new(
            StoreErrorCode::InvalidInput,
            "BlockRecord retirement evidence is invalid",
            false,
        ));
    }
    transition_active_block(
        transaction,
        previous,
        BlockLifecycle::Retired,
        RETIRED_RANK_PREFIX,
        "retiring",
    )
    .and_then(|next| {
        transaction.execute(
            "INSERT INTO block_record_retirements(
               block_id, library_id, operation_id, retired_revision, retired_at
            ) VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(block_id) DO UPDATE SET
               library_id = excluded.library_id,
               operation_id = excluded.operation_id,
               retired_revision = excluded.retired_revision,
               retired_at = excluded.retired_at",
            params![
                &next.id,
                &next.library_id,
                operation_id,
                i64::try_from(next.revision)
                    .map_err(|_| corrupt("Retired revision exceeds SQLite range"))?,
                retired_at,
            ],
        )?;
        Ok(next)
    })
}

pub fn retirement_operation_id(
    connection: &Connection,
    library_id: &str,
    block_id: &str,
) -> Result<Option<String>, StoreError> {
    connection
        .query_row(
            "SELECT operation_id FROM block_record_retirements
             WHERE block_id = ?1 AND library_id = ?2",
            params![block_id, library_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(StoreError::from)
}

pub fn clear_retirement(
    transaction: &Transaction<'_>,
    library_id: &str,
    block_id: &str,
) -> Result<(), StoreError> {
    transaction.execute(
        "DELETE FROM block_record_retirements
         WHERE block_id = ?1 AND library_id = ?2",
        params![block_id, library_id],
    )?;
    Ok(())
}

fn transition_active_block(
    transaction: &Transaction<'_>,
    previous: &BlockRecord,
    lifecycle: BlockLifecycle,
    rank_prefix: &str,
    action: &str,
) -> Result<BlockRecord, StoreError> {
    if !previous.lifecycle.is_active() {
        return Err(corrupt(format!(
            "Only an active BlockRecord can be {action}"
        )));
    }
    let revision = previous
        .revision
        .checked_add(1)
        .ok_or_else(|| corrupt(format!("BlockRecord revision overflow while {action}")))?;
    let (placement_revision, rank_key): (i64, String) = transaction
        .query_row(
            "SELECT revision, rank_key FROM block_placements WHERE block_id = ?1",
            [previous.id.as_str()],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?
        .ok_or_else(|| {
            corrupt(format!(
                "Active BlockRecord has no placement while {action}"
            ))
        })?;
    let archived_placement_revision = placement_revision
        .checked_add(1)
        .ok_or_else(|| corrupt(format!("Placement revision overflow while {action}")))?;
    let changed = transaction.execute(
        "UPDATE block_placements SET rank_key = ?1, revision = ?2
         WHERE block_id = ?3 AND revision = ?4",
        params![
            format!("{rank_prefix}{}__{rank_key}", previous.id),
            archived_placement_revision,
            previous.id,
            placement_revision,
        ],
    )?;
    if changed != 1 {
        return Err(StoreError::new(
            StoreErrorCode::RevisionConflict,
            format!("Block {} placement changed while {action}", previous.id),
            true,
        ));
    }
    let changed = transaction.execute(
        "UPDATE block_records SET lifecycle = ?1, revision = ?2
         WHERE id = ?3 AND library_id = ?4 AND lifecycle = 'active' AND revision = ?5",
        params![
            lifecycle_to_sql(&lifecycle),
            i64::try_from(revision)
                .map_err(|_| corrupt("BlockRecord revision exceeds SQLite range"))?,
            previous.id,
            previous.library_id,
            i64::try_from(previous.revision)
                .map_err(|_| corrupt("BlockRecord revision exceeds SQLite range"))?,
        ],
    )?;
    if changed != 1 {
        return Err(StoreError::new(
            StoreErrorCode::RevisionConflict,
            format!("BlockRecord {} changed while {action}", previous.id),
            true,
        ));
    }
    Ok(BlockRecord {
        lifecycle,
        revision,
        ..previous.clone()
    })
}

/// Persists a validated placement batch without exposing intermediate sibling
/// ranks to SQLite's UNIQUE constraint. Every changed row is first parked at
/// a private temporary rank under its old parent; only then are the final
/// parent/rank values installed. This makes reorder swaps and cross-parent
/// moves one atomic SQL operation rather than an order-dependent sequence of
/// updates.
pub fn update_placements_atomically(
    transaction: &Transaction<'_>,
    changes: &[(BlockPlacement, BlockPlacement)],
) -> Result<(), StoreError> {
    if changes.is_empty() {
        return Ok(());
    }
    let mut seen = BTreeSet::new();
    for (previous, next) in changes {
        if previous.block_id != next.block_id || !seen.insert(previous.block_id.as_str()) {
            return Err(corrupt(
                "Placement batch contains duplicate or mismatched Block ids",
            ));
        }
        if previous == next {
            return Err(corrupt("Placement batch contains an unchanged placement"));
        }
        let next_revision = i64::try_from(next.revision)
            .map_err(|_| corrupt("Placement revision exceeds SQLite range"))?;
        let previous_revision = i64::try_from(previous.revision)
            .map_err(|_| corrupt("Placement revision exceeds SQLite range"))?;
        let temporary_rank = format!("__nodex_pending__{:08}__{}", seen.len(), next.block_id);
        let changed = transaction.execute(
            "UPDATE block_placements
             SET rank_key = ?1, revision = ?2
             WHERE block_id = ?3 AND revision = ?4",
            params![
                temporary_rank,
                next_revision,
                next.block_id,
                previous_revision
            ],
        )?;
        if changed != 1 {
            return Err(StoreError::new(
                StoreErrorCode::RevisionConflict,
                format!(
                    "Placement {} changed while staging its delta",
                    next.block_id
                ),
                true,
            ));
        }
    }
    for (_, next) in changes {
        let (parent_kind, parent_id) = parent_to_sql(&next.parent);
        let changed = transaction.execute(
            "UPDATE block_placements
             SET parent_kind = ?1, parent_id = ?2, rank_key = ?3
             WHERE block_id = ?4 AND revision = ?5",
            params![
                parent_kind,
                parent_id,
                next.rank_key,
                next.block_id,
                i64::try_from(next.revision)
                    .map_err(|_| corrupt("Placement revision exceeds SQLite range"))?,
            ],
        )?;
        if changed != 1 {
            return Err(StoreError::new(
                StoreErrorCode::RevisionConflict,
                format!(
                    "Placement {} changed while publishing its delta",
                    next.block_id
                ),
                true,
            ));
        }
    }
    Ok(())
}

pub fn update_placement(
    transaction: &Transaction<'_>,
    previous: &BlockPlacement,
    next: &BlockPlacement,
) -> Result<(), StoreError> {
    if previous.block_id != next.block_id {
        return Err(corrupt("Placement delta changed Block identity"));
    }
    let (parent_kind, parent_id) = parent_to_sql(&next.parent);
    let changed = transaction
        .execute(
            "UPDATE block_placements SET parent_kind = ?1, parent_id = ?2, rank_key = ?3,
             revision = ?4 WHERE block_id = ?5 AND revision = ?6",
            params![
                parent_kind,
                parent_id,
                next.rank_key,
                i64::try_from(next.revision)
                    .map_err(|_| corrupt("Placement revision exceeds SQLite range"))?,
                next.block_id,
                i64::try_from(previous.revision)
                    .map_err(|_| corrupt("Placement revision exceeds SQLite range"))?,
            ],
        )
        .map_err(StoreError::from)?;
    if changed != 1 {
        return Err(StoreError::new(
            StoreErrorCode::RevisionConflict,
            format!(
                "Placement {} changed while applying its delta",
                next.block_id
            ),
            true,
        ));
    }
    Ok(())
}

pub fn read_graph(connection: &Connection, library_id: &str) -> Result<RecordGraph, StoreError> {
    let mut block_statement = connection
        .prepare(
            "SELECT id, library_id, kind_json, lifecycle, properties_json, \
                    content_shard_id, revision
             FROM block_records
             WHERE library_id = ?1 AND lifecycle = 'active'
             ORDER BY id",
        )
        .map_err(StoreError::from)?;
    let blocks = block_statement
        .query_map([library_id], read_block)
        .map_err(StoreError::from)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(StoreError::from)?;

    let mut placement_statement = connection
        .prepare(
            "SELECT p.block_id, p.parent_kind, p.parent_id, p.rank_key, p.revision
             FROM block_placements p
             JOIN block_records b ON b.id = p.block_id
             WHERE b.library_id = ?1 AND b.lifecycle = 'active'
             ORDER BY p.parent_kind, p.parent_id, p.rank_key, p.block_id",
        )
        .map_err(StoreError::from)?;
    let placements = placement_statement
        .query_map([library_id], read_placement)
        .map_err(StoreError::from)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(StoreError::from)?;

    RecordGraph::from_parts(library_id.to_owned(), blocks, placements).map_err(|error| {
        corrupt(format!(
            "Persisted BlockRecord graph failed validation: {error}"
        ))
    })
}

/// Reads only placements matching a bounded window and then batch-loads the
/// corresponding records. The parent edge is the selection index; callers do
/// not need to scan the whole Library graph just to render one Page or Board.
pub fn read_selection(
    connection: &Connection,
    library_id: &str,
    parent: Option<&PlacementParent>,
    block_ids: Option<&[String]>,
) -> Result<(Vec<BlockRecord>, Vec<BlockPlacement>), StoreError> {
    read_selection_with_descendants(connection, library_id, parent, block_ids, false)
}

pub fn read_selection_with_descendants(
    connection: &Connection,
    library_id: &str,
    parent: Option<&PlacementParent>,
    block_ids: Option<&[String]>,
    include_descendants: bool,
) -> Result<(Vec<BlockRecord>, Vec<BlockPlacement>), StoreError> {
    read_selection_with_descendants_and_lifecycle(
        connection,
        library_id,
        parent,
        block_ids,
        include_descendants,
        false,
        false,
    )
}

pub fn read_selection_with_descendants_and_lifecycle(
    connection: &Connection,
    library_id: &str,
    parent: Option<&PlacementParent>,
    block_ids: Option<&[String]>,
    include_descendants: bool,
    include_archived: bool,
    include_retired: bool,
) -> Result<(Vec<BlockRecord>, Vec<BlockPlacement>), StoreError> {
    if library_id.trim().is_empty() {
        return Err(StoreError::new(
            StoreErrorCode::InvalidInput,
            "BlockRecord library identity is invalid",
            false,
        ));
    }
    if block_ids.is_some_and(|ids| ids.len() > 10_000) {
        return Err(StoreError::new(
            StoreErrorCode::ResourceExhausted,
            "BlockRecord selection contains too many IDs",
            false,
        ));
    }
    if block_ids.is_some_and(|ids| ids.is_empty()) {
        return Ok((Vec::new(), Vec::new()));
    }
    if parent.is_none() && block_ids.is_none() && !include_archived && !include_retired {
        let graph = read_graph(connection, library_id)?;
        if graph.blocks().count() > MAX_BLOCK_RECORD_WINDOW {
            return Err(StoreError::new(
                StoreErrorCode::ResourceExhausted,
                "BlockRecord graph exceeds the Core window bound",
                false,
            ));
        }
        return Ok((
            graph.blocks().cloned().collect(),
            graph.placements().cloned().collect(),
        ));
    }

    let (parent_kind, parent_id) = parent.map(parent_to_sql).unwrap_or(("", None));
    let lifecycle_filter = match (include_archived, include_retired) {
        (false, false) => "b.lifecycle = 'active'",
        (true, false) => "b.lifecycle IN ('active', 'archived')",
        (false, true) => "b.lifecycle IN ('active', 'retired')",
        (true, true) => "b.lifecycle IN ('active', 'archived', 'retired')",
    };
    let record_lifecycle_filter = match (include_archived, include_retired) {
        (false, false) => "lifecycle = 'active'",
        (true, false) => "lifecycle IN ('active', 'archived')",
        (false, true) => "lifecycle IN ('active', 'retired')",
        (true, true) => "lifecycle IN ('active', 'archived', 'retired')",
    };
    let mut placement_sql = String::from(format!(
        "SELECT p.block_id, p.parent_kind, p.parent_id, p.rank_key, p.revision
         FROM block_placements p
         JOIN block_records b ON b.id = p.block_id
         WHERE b.library_id = ?1 AND {lifecycle_filter}"
    ));
    let mut values = vec![rusqlite::types::Value::Text(library_id.to_owned())];
    if parent.is_some() {
        placement_sql.push_str(" AND p.parent_kind = ?2");
        values.push(rusqlite::types::Value::Text(parent_kind.to_owned()));
        if let Some(parent_id) = parent_id {
            placement_sql.push_str(" AND p.parent_id = ?3");
            values.push(rusqlite::types::Value::Text(parent_id.to_owned()));
        } else {
            placement_sql.push_str(" AND p.parent_id IS NULL");
        }
    }
    if let Some(ids) = block_ids {
        let start = values.len() + 1;
        let placeholders = (start..start + ids.len())
            .map(|index| format!("?{index}"))
            .collect::<Vec<_>>()
            .join(", ");
        placement_sql.push_str(&format!(" AND p.block_id IN ({placeholders})"));
        values.extend(ids.iter().cloned().map(rusqlite::types::Value::Text));
    }
    placement_sql.push_str(" ORDER BY p.parent_kind, p.parent_id, p.rank_key, p.block_id");
    let mut placement_statement = connection
        .prepare(&placement_sql)
        .map_err(StoreError::from)?;
    let mut placements = placement_statement
        .query_map(params_from_iter(values), read_placement)
        .map_err(StoreError::from)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(StoreError::from)?;
    if placements.len() > MAX_BLOCK_RECORD_WINDOW {
        return Err(StoreError::new(
            StoreErrorCode::ResourceExhausted,
            "BlockRecord selection exceeds the Core window bound",
            false,
        ));
    }
    // A child window rooted at a Block also carries the root anchor. This
    // keeps the renderer graph-valid without hydrating siblings or body
    // content outside the requested parent.
    if let Some(PlacementParent::Block(parent_id)) = parent {
        let anchor_sql = format!(
            "SELECT p.block_id, p.parent_kind, p.parent_id, p.rank_key, p.revision
             FROM block_placements p
             JOIN block_records b ON b.id = p.block_id
             WHERE b.library_id = ?1 AND {lifecycle_filter} AND p.block_id = ?2"
        );
        let anchor_placement = connection
            .query_row(&anchor_sql, params![library_id, parent_id], read_placement)
            .optional()
            .map_err(StoreError::from)?
            .ok_or_else(|| corrupt("BlockRecord selection root parent has no placement"))?;
        if !placements
            .iter()
            .any(|candidate| candidate.block_id == *parent_id)
        {
            placements.push(anchor_placement);
        }
    }
    if include_descendants {
        let mut frontier = placements
            .iter()
            .map(|placement| placement.block_id.clone())
            .collect::<Vec<_>>();
        let mut seen = placements
            .iter()
            .map(|placement| placement.block_id.clone())
            .collect::<std::collections::BTreeSet<_>>();
        while !frontier.is_empty() {
            let mut next_frontier = Vec::new();
            for chunk in frontier.chunks(900) {
                let placeholders = (0..chunk.len())
                    .map(|index| format!("?{}", index + 2))
                    .collect::<Vec<_>>()
                    .join(", ");
                let sql = format!(
                    "SELECT p.block_id, p.parent_kind, p.parent_id, p.rank_key, p.revision
                     FROM block_placements p
                     JOIN block_records b ON b.id = p.block_id
                     WHERE b.library_id = ?1 AND {lifecycle_filter} AND p.parent_kind = 'block'
                       AND p.parent_id IN ({placeholders})
                     ORDER BY p.parent_id, p.rank_key, p.block_id"
                );
                let mut values = vec![rusqlite::types::Value::Text(library_id.to_owned())];
                values.extend(chunk.iter().cloned().map(rusqlite::types::Value::Text));
                let mut statement = connection.prepare(&sql).map_err(StoreError::from)?;
                let children = statement
                    .query_map(params_from_iter(values), read_placement)
                    .map_err(StoreError::from)?
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(StoreError::from)?;
                for child in children {
                    if seen.insert(child.block_id.clone()) {
                        next_frontier.push(child.block_id.clone());
                        placements.push(child);
                        if placements.len() > MAX_BLOCK_RECORD_WINDOW {
                            return Err(StoreError::new(
                                StoreErrorCode::ResourceExhausted,
                                "BlockRecord descendant window exceeds the Core bound",
                                false,
                            ));
                        }
                    }
                }
            }
            frontier = next_frontier;
        }
    }
    let selected_ids = placements
        .iter()
        .map(|placement| placement.block_id.clone())
        .collect::<Vec<_>>();
    if selected_ids.is_empty() {
        return Ok((Vec::new(), Vec::new()));
    }

    // Keep each IN-list below SQLite's default variable limit. This is a
    // bounded batch read, not one query per Block.
    let mut blocks = Vec::with_capacity(selected_ids.len());
    for chunk in selected_ids.chunks(900) {
        let placeholders = (0..chunk.len())
            .map(|index| format!("?{}", index + 2))
            .collect::<Vec<_>>()
            .join(", ");
        let sql = format!(
            "SELECT id, library_id, kind_json, lifecycle, properties_json,
                    content_shard_id, revision
             FROM block_records
             WHERE library_id = ?1 AND {record_lifecycle_filter} AND id IN ({placeholders})
             ORDER BY id"
        );
        let mut block_statement = connection.prepare(&sql).map_err(StoreError::from)?;
        let mut block_values = vec![rusqlite::types::Value::Text(library_id.to_owned())];
        block_values.extend(chunk.iter().cloned().map(rusqlite::types::Value::Text));
        let chunk_blocks = block_statement
            .query_map(params_from_iter(block_values), read_block)
            .map_err(StoreError::from)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(StoreError::from)?;
        blocks.extend(chunk_blocks);
    }
    Ok((blocks, placements))
}

fn read_block(row: &Row<'_>) -> rusqlite::Result<BlockRecord> {
    let lifecycle: String = row.get(3)?;
    Ok(BlockRecord {
        id: row.get(0)?,
        library_id: row.get(1)?,
        kind: serde_json::from_str(&row.get::<_, String>(2)?).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                2,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?,
        lifecycle: lifecycle_from_sql(&lifecycle).ok_or_else(|| {
            rusqlite::Error::FromSqlConversionFailure(
                3,
                rusqlite::types::Type::Text,
                Box::new(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    format!("unknown BlockRecord lifecycle {lifecycle}"),
                )),
            )
        })?,
        properties: serde_json::from_str(&row.get::<_, String>(4)?).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                4,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?,
        content_shard_id: row.get(5)?,
        revision: u64::try_from(row.get::<_, i64>(6)?).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                6,
                rusqlite::types::Type::Integer,
                Box::new(error),
            )
        })?,
    })
}

fn read_placement(row: &Row<'_>) -> rusqlite::Result<BlockPlacement> {
    let parent_kind: String = row.get(1)?;
    let parent_id: Option<String> = row.get(2)?;
    Ok(BlockPlacement {
        block_id: row.get(0)?,
        parent: parent_from_sql(&parent_kind, parent_id.as_deref()).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                1,
                rusqlite::types::Type::Text,
                Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, error)),
            )
        })?,
        rank_key: row.get(3)?,
        revision: u64::try_from(row.get::<_, i64>(4)?).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                4,
                rusqlite::types::Type::Integer,
                Box::new(error),
            )
        })?,
    })
}

fn parent_to_sql(parent: &PlacementParent) -> (&'static str, Option<&str>) {
    match parent {
        PlacementParent::Library => ("library", None),
        PlacementParent::Block(id) => ("block", Some(id.as_str())),
        PlacementParent::DataSource(id) => ("data_source", Some(id.as_str())),
    }
}

fn parent_from_sql(kind: &str, id: Option<&str>) -> Result<PlacementParent, String> {
    match (kind, id) {
        ("library", None) => Ok(PlacementParent::Library),
        ("block", Some(id)) => Ok(PlacementParent::Block(id.to_owned())),
        ("data_source", Some(id)) => Ok(PlacementParent::DataSource(id.to_owned())),
        _ => Err(format!("invalid placement parent ({kind}, {id:?})")),
    }
}

fn lifecycle_to_sql(lifecycle: &BlockLifecycle) -> &'static str {
    match lifecycle {
        BlockLifecycle::Active => "active",
        BlockLifecycle::Archived => "archived",
        BlockLifecycle::Retired => "retired",
    }
}

fn lifecycle_from_sql(value: &str) -> Option<BlockLifecycle> {
    match value {
        "active" => Some(BlockLifecycle::Active),
        "archived" => Some(BlockLifecycle::Archived),
        "retired" => Some(BlockLifecycle::Retired),
        _ => None,
    }
}

fn encode_error(error: serde_json::Error) -> StoreError {
    corrupt(format!("Cannot encode BlockRecord value: {error}"))
}

fn corrupt(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message, false)
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;
    use serde_json::json;

    use super::*;
    use crate::domain::block_record::BlockKind;
    use crate::infrastructure::schema::v84_schema_objects_sql;

    fn graph() -> RecordGraph {
        let mut graph = RecordGraph::new("library-a").expect("graph");
        graph
            .insert(
                BlockRecord {
                    id: "page".to_owned(),
                    library_id: "library-a".to_owned(),
                    kind: BlockKind::Page,
                    lifecycle: BlockLifecycle::Active,
                    properties: json!({"title": "Page"}),
                    content_shard_id: "shard-page".to_owned(),
                    revision: 1,
                },
                BlockPlacement {
                    block_id: "page".to_owned(),
                    parent: PlacementParent::Library,
                    rank_key: "a".to_owned(),
                    revision: 2,
                },
            )
            .expect("page");
        graph
            .insert(
                BlockRecord {
                    id: "heading".to_owned(),
                    library_id: "library-a".to_owned(),
                    kind: BlockKind::Heading,
                    lifecycle: BlockLifecycle::Active,
                    properties: json!({"level": 1}),
                    content_shard_id: "shard-heading".to_owned(),
                    revision: 3,
                },
                BlockPlacement {
                    block_id: "heading".to_owned(),
                    parent: PlacementParent::Block("page".to_owned()),
                    rank_key: "a".to_owned(),
                    revision: 4,
                },
            )
            .expect("heading");
        graph
    }

    #[test]
    fn round_trips_a_graph_through_sqlite() {
        let connection = Connection::open_in_memory().expect("sqlite");
        install_schema(&connection).expect("schema");
        let transaction = connection.unchecked_transaction().expect("transaction");
        write_graph(&transaction, &graph()).expect("write");
        transaction.commit().expect("commit");

        assert_eq!(read_graph(&connection, "library-a").expect("read"), graph());
    }

    #[test]
    fn reads_only_the_requested_parent_window() {
        let connection = Connection::open_in_memory().expect("sqlite");
        install_schema(&connection).expect("schema");
        let transaction = connection.unchecked_transaction().expect("transaction");
        write_graph(&transaction, &graph()).expect("write");
        transaction.commit().expect("commit");

        let (blocks, placements) = read_selection(
            &connection,
            "library-a",
            Some(&PlacementParent::Block("page".to_owned())),
            None,
        )
        .expect("bounded selection");
        assert_eq!(
            blocks
                .iter()
                .map(|block| block.id.as_str())
                .collect::<Vec<_>>(),
            vec!["heading", "page"]
        );
        assert_eq!(placements.len(), 2);
        assert!(
            placements
                .iter()
                .any(|placement| placement.block_id == "heading")
        );
        assert!(
            placements
                .iter()
                .any(|placement| placement.block_id == "page")
        );
    }

    #[test]
    fn block_parent_trigger_rejects_missing_parent() {
        let connection = Connection::open_in_memory().expect("sqlite");
        install_schema(&connection).expect("schema");
        let error = connection
            .execute(
                "INSERT INTO block_records \
                 (id, library_id, kind_json, lifecycle, properties_json, content_shard_id, revision) \
                 VALUES ('child', 'library-a', '\"paragraph\"', 'active', '{}', 'shard', 0)",
                [],
            )
            .and_then(|_| {
                connection.execute(
                    "INSERT INTO block_placements \
                     (block_id, parent_kind, parent_id, rank_key, revision) \
                     VALUES ('child', 'block', 'missing', 'a', 0)",
                    [],
                )
            })
            .expect_err("missing parent");
        assert!(error.to_string().contains("parent does not exist"));
    }

    #[test]
    fn transaction_rollback_leaves_no_partial_graph() {
        let connection = Connection::open_in_memory().expect("sqlite");
        install_schema(&connection).expect("schema");
        {
            let transaction = connection.unchecked_transaction().expect("transaction");
            write_graph(&transaction, &graph()).expect("write");
            transaction.rollback().expect("rollback");
        }
        let count: i64 = connection
            .query_row("SELECT count(*) FROM block_records", [], |row| row.get(0))
            .expect("count");
        assert_eq!(count, 0);
    }

    #[test]
    fn data_source_parent_must_exist_and_share_the_library() {
        let mut connection = Connection::open_in_memory().expect("SQLite");
        install_schema(&connection).expect("schema");
        let mut graph = RecordGraph::new("library-a").expect("graph");
        graph
            .insert(
                BlockRecord {
                    id: "page-a".to_owned(),
                    library_id: "library-a".to_owned(),
                    kind: BlockKind::Page,
                    lifecycle: BlockLifecycle::Active,
                    properties: json!({}),
                    content_shard_id: "shard:a".to_owned(),
                    revision: 0,
                },
                BlockPlacement {
                    block_id: "page-a".to_owned(),
                    parent: PlacementParent::DataSource("board-a".to_owned()),
                    rank_key: "a".to_owned(),
                    revision: 0,
                },
            )
            .expect("page");

        let transaction = connection.transaction().expect("transaction");
        let missing = write_graph(&transaction, &graph).expect_err("missing data source");
        assert_eq!(missing.code, StoreErrorCode::SqliteFailure);
        transaction.rollback().expect("rollback");

        let transaction = connection.transaction().expect("transaction");
        ensure_data_source(&transaction, "board-a", "library-a").expect("data source");
        write_graph(&transaction, &graph).expect("same-library data source");
        transaction.commit().expect("commit");
        assert_eq!(read_graph(&connection, "library-a").expect("read"), graph);
    }

    #[test]
    fn backfills_legacy_page_tree_and_view_position_once() {
        let mut connection = Connection::open_in_memory().expect("SQLite");
        connection
            .execute_batch("PRAGMA foreign_keys = ON;")
            .expect("foreign keys");
        connection
            .execute_batch(v84_schema_objects_sql())
            .expect("legacy schema");
        install_schema(&connection).expect("BlockRecord schema");
        install_view_position_schema(&connection).expect("view schema");
        content_store::install_schema(&connection).expect("content schema");

        let legacy_seed = "INSERT INTO profiles(id, created_at, updated_at)
                   VALUES ('profile:test', '2026-08-06', '2026-08-06');
                 INSERT INTO libraries(id, profile_id, created_at, updated_at)
                   VALUES ('library:test', 'profile:test', '2026-08-06', '2026-08-06');
                 INSERT INTO projects(
                   id, name, description, icon, created, updated, library_id,
                   database_block_id, lifecycle, binding_revision
                 ) VALUES (
                   'project:test', 'Test', '', '', '2026-08-06', '2026-08-06',
                   'library:test', 'database:test', 'active', 1
                 );
                 INSERT INTO documents(
                   id, project_id, generation, head_seq, schema_key, schema_version,
                   state_vector, state_hash, readiness, authority, genesis_source_revision,
                   created_at, updated_at, sync_engine
                 ) VALUES (
                   'document:test', 'project:test', 1, 0, 'blocknote', 1,
                   X'', '', 'ready', 'ydoc_primary', NULL,
                   '2026-08-06', '2026-08-06', 'yjs'
                 );
                 INSERT INTO blocks(
                   id, project_id, type, lifecycle, location_kind,
                   containing_document_id, containing_database_id,
                   location_revision, metadata_revision, created_at, updated_at
                 ) VALUES
                   ('database:test', 'project:test', 'database', 'active', 'space', NULL, NULL, 1, 1, '2026-08-06', '2026-08-06');
                 INSERT INTO database_containers(
                   block_id, library_id, name, lifecycle, default_view_id,
                   access_revision, metadata_revision, created_at, updated_at
                 ) VALUES (
                   'database:test', 'library:test', 'Board', 'active', NULL,
                   1, 1, '2026-08-06', '2026-08-06'
                 );
                 INSERT INTO blocks(
                   id, project_id, type, lifecycle, location_kind,
                   containing_document_id, containing_database_id,
                   location_revision, metadata_revision, created_at, updated_at
                 ) VALUES
                   ('page:test', 'project:test', 'page', 'active', 'database', NULL, 'database:test', 1, 1, '2026-08-06', '2026-08-06'),
                   ('container:test', 'project:test', 'toggle', 'active', 'document', 'document:test', NULL, 1, 1, '2026-08-06', '2026-08-06'),
                   ('child:test', 'project:test', 'paragraph', 'active', 'document', 'document:test', NULL, 1, 1, '2026-08-06', '2026-08-06');
                 INSERT INTO block_documents(
                   block_id, document_id, project_id, created_at
                 ) VALUES (
                   'page:test', 'document:test', 'project:test', '2026-08-06'
                 );
                 INSERT INTO data_sources(
                   id, library_id, home_database_block_id, name, schema_key,
                   schema_revision, lifecycle, rank_key, created_at, updated_at
                 ) VALUES (
                   'data-source:test', 'library:test', 'database:test', 'Board',
                   'default', 1, 'active', 'a', '2026-08-06', '2026-08-06'
                 );
                 INSERT INTO pages(
                   block_id, library_id, document_id, parent_kind, parent_id,
                   lifecycle, parent_revision, metadata_revision, created_at, updated_at
                 ) VALUES (
                   'page:test', 'library:test', 'document:test', 'data_source',
                   'data-source:test', 'active', 1, 1, '2026-08-06', '2026-08-06'
                 );
                 INSERT INTO document_block_index(
                   document_id, block_id, parent_block_id, ordinal, block_type,
                   text, projected_seq
                 ) VALUES (
                   'document:test', 'container:test', NULL, 0, 'toggle', 'Container', 0
                 ), (
                   'document:test', 'child:test', 'container:test', 1, 'paragraph',
                   'Child', 0
                 );
                 INSERT INTO document_materializations(
                   document_id, generation, projected_seq, schema_version, title,
                   title_rich_json, title_rich_hash, nfm, plain_text, preview,
                   block_tree_json, references_json, asset_refs_json, updated_at
                 ) VALUES (
                   'document:test', 1, 0, 1, 'Page A', '[]',
                   '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945',
                   '', 'Page A', 'Page A', '[]', '[]', '[]', '2026-08-06'
                 );
                 INSERT INTO data_source_page_memberships(
                   id, data_source_id, page_block_id, revision, created_at, removed_at
                 ) VALUES (
                   'membership:test', 'data-source:test', 'page:test', 1,
                   '2026-08-06', NULL
                 );
                 INSERT INTO database_views(
                   id, database_block_id, data_source_id, name, kind, config_json,
                   revision, rank_key, lifecycle, created_at, updated_at
                 ) VALUES (
                   'view:test', 'database:test', 'data-source:test', 'Board',
                   'kanban', '{}', 1, 'a', 'active', '2026-08-06', '2026-08-06'
                 );
                 INSERT INTO database_view_page_positions(
                   view_id, page_block_id, group_key, rank_key, revision,
                   created_at, updated_at
                 ) VALUES (
                   'view:test', 'page:test', 'in_progress', 'm', 1,
                   '2026-08-06', '2026-08-06'
                 );
                 UPDATE database_containers
                 SET default_view_id = 'view:test'
                 WHERE block_id = 'database:test';
                 INSERT INTO library_block_placements(
                   block_id, library_id, rank_key, revision, created_at, updated_at
                 ) VALUES (
                   'database:test', 'library:test', 'a', 1, '2026-08-06', '2026-08-06'
                 );";
        for statement in legacy_seed
            .split(';')
            .filter(|value| !value.trim().is_empty())
        {
            connection.execute(statement, []).unwrap_or_else(|error| {
                panic!("legacy seed statement failed: {statement}: {error}")
            });
        }

        let transaction = connection.transaction().expect("backfill transaction");
        backfill_legacy_records(&transaction).expect("backfill");
        transaction.commit().expect("backfill commit");

        let graph = read_graph(&connection, "library:test").expect("converted graph");
        assert_eq!(graph.blocks().count(), 4);
        assert_eq!(
            graph.placement("page:test").expect("page placement").parent,
            PlacementParent::DataSource("data-source:test".to_owned())
        );
        assert_eq!(
            graph
                .placement("child:test")
                .expect("child placement")
                .parent,
            PlacementParent::Block("container:test".to_owned())
        );
        let positions = read_view_positions(
            &connection,
            "library:test",
            "view:test",
            "data-source:test",
            None,
        )
        .expect("converted view position");
        assert_eq!(positions.len(), 1);
        assert_eq!(positions[0].block_id, "page:test");
        assert_eq!(positions[0].group_key.as_deref(), Some("in_progress"));
        assert_eq!(positions[0].rank_key.len(), 32);
        assert!(
            positions[0]
                .rank_key
                .chars()
                .all(|character| character.is_ascii_hexdigit())
        );
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM block_contents", [], |row| row
                    .get::<_, i64>(0))
                .expect("content count"),
            4
        );

        let transaction = connection.transaction().expect("content edit transaction");
        content_store::replace_materialized_snapshot(
            &transaction,
            "page:test",
            ContentSlot::Title,
            0,
            &json!([{"type": "text", "text": "Edited locally"}]),
            "update:page:test",
            "2026-08-06T00:00:01.000Z",
        )
        .expect("local Page title edit");
        transaction.commit().expect("content edit commit");

        connection
            .execute_batch(
                "INSERT INTO blocks(
                   id, project_id, type, lifecycle, location_kind,
                   containing_document_id, containing_database_id,
                   location_revision, metadata_revision, created_at, updated_at
                 ) VALUES (
                   'later:block', 'project:test', 'paragraph', 'active', 'document',
                   'document:test', NULL, 1, 1, '2026-08-06', '2026-08-06'
                 );
                 INSERT INTO document_block_index(
                   document_id, block_id, parent_block_id, ordinal, block_type,
                   text, projected_seq
                 ) VALUES (
                   'document:test', 'later:block', NULL, 2, 'paragraph', 'Later', 0
                 );",
            )
            .expect("seed legacy Block after initial cutover");

        let transaction = connection.transaction().expect("idempotent transaction");
        backfill_legacy_records(&transaction).expect("second backfill");
        transaction.commit().expect("second commit");
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM block_records", [], |row| row
                    .get::<_, i64>(0))
                .expect("record count"),
            5
        );
        assert_eq!(
            read_graph(&connection, "library:test")
                .expect("incrementally converted graph")
                .placement("later:block")
                .expect("late Block placement")
                .parent,
            PlacementParent::Library
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT revision FROM block_contents
                     WHERE block_id = 'page:test' AND slot = 'title'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .expect("edited title revision"),
            1
        );
    }
}
