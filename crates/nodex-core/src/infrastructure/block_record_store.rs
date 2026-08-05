//! SQLite adapter for the BlockRecord/placement authority.
//!
//! The adapter is intentionally small: graph validation lives in the domain
//! Module, while this seam owns table layout, encoding, and transaction-safe
//! persistence.  It is not a projection of the Page Yjs Document.

use rusqlite::{Connection, Row, Transaction, params};

use crate::domain::block_record::{
    BlockLifecycle, BlockPlacement, BlockRecord, PlacementParent, RecordGraph,
};
use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};

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
    lifecycle TEXT NOT NULL CHECK (lifecycle = 'active'),
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
        SELECT 1 FROM block_records WHERE id = NEW.parent_id
    );
END;

CREATE TRIGGER IF NOT EXISTS block_placements_block_parent_exists_update
BEFORE UPDATE OF parent_kind, parent_id ON block_placements
WHEN NEW.parent_kind = 'block'
BEGIN
    SELECT RAISE(ABORT, 'block placement parent does not exist')
    WHERE NOT EXISTS (
        SELECT 1 FROM block_records WHERE id = NEW.parent_id
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

pub fn install_schema(connection: &Connection) -> Result<(), StoreError> {
    connection.execute_batch(SCHEMA).map_err(StoreError::from)
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
    transaction
        .execute(
            "INSERT INTO block_record_data_sources(data_source_id, library_id)
             VALUES (?1, ?2)
             ON CONFLICT(data_source_id) DO UPDATE SET library_id = excluded.library_id",
            params![data_source_id, library_id],
        )
        .map_err(StoreError::from)?;
    Ok(())
}

pub fn write_graph(transaction: &Transaction<'_>, graph: &RecordGraph) -> Result<(), StoreError> {
    graph
        .validate()
        .map_err(|error| corrupt(format!("Cannot persist invalid BlockRecord graph: {error}")))?;

    for block in graph.blocks() {
        transaction
            .execute(
                "INSERT INTO block_records \
                 (id, library_id, kind_json, lifecycle, properties_json, content_shard_id, revision) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    block.id,
                    block.library_id,
                    serde_json::to_string(&block.kind).map_err(encode_error)?,
                    lifecycle_to_sql(&block.lifecycle),
                    serde_json::to_string(&block.properties).map_err(encode_error)?,
                    block.content_shard_id,
                    i64::try_from(block.revision).map_err(|_| {
                        corrupt(format!("Block {} revision exceeds SQLite range", block.id))
                    })?,
                ],
            )
            .map_err(StoreError::from)?;
    }

    for placement in graph.placements() {
        let (parent_kind, parent_id) = parent_to_sql(&placement.parent);
        transaction
            .execute(
                "INSERT INTO block_placements \
                 (block_id, parent_kind, parent_id, rank_key, revision) \
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    placement.block_id,
                    parent_kind,
                    parent_id,
                    placement.rank_key,
                    i64::try_from(placement.revision).map_err(|_| {
                        corrupt(format!(
                            "Placement {} revision exceeds SQLite range",
                            placement.block_id
                        ))
                    })?,
                ],
            )
            .map_err(StoreError::from)?;
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
             WHERE library_id = ?1
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
             WHERE b.library_id = ?1
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
}
