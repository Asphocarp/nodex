use std::collections::{BTreeMap, BTreeSet};
use std::sync::LazyLock;

use regex::Regex;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::sqlite::{StoreError, StoreErrorCode};

pub const TYPESCRIPT_SCHEMA_VERSION: i64 = 84;
pub const CORE_SCHEMA_VERSION: i64 = 120;
pub const V84_SCHEMA_SQL: &str = include_str!("../../schema/v84.sql");

pub fn v84_schema_objects_sql() -> &'static str {
    let start_marker = "BEGIN IMMEDIATE;\n\n";
    let end_marker = "\nPRAGMA user_version = 84;";
    let start = V84_SCHEMA_SQL
        .find(start_marker)
        .expect("v84 schema artifact start marker")
        + start_marker.len();
    let end = V84_SCHEMA_SQL
        .rfind(end_marker)
        .expect("v84 schema artifact end marker");
    &V84_SCHEMA_SQL[start..end]
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaObjectKey {
    pub object_type: String,
    pub name: String,
    pub table_name: String,
}

pub type SchemaInventory = BTreeMap<SchemaObjectKey, String>;

pub fn install_v84_schema(connection: &Connection) -> Result<(), StoreError> {
    let current: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    let object_count: i64 = connection.query_row(
        "SELECT count(*) FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'",
        [],
        |row| row.get(0),
    )?;
    if current != 0 || object_count != 0 {
        return Err(StoreError::new(
            StoreErrorCode::UnsupportedSchema,
            "v84 schema installation requires an empty SQLite database",
            false,
        ));
    }
    connection.execute_batch(V84_SCHEMA_SQL)?;
    let installed: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if installed != TYPESCRIPT_SCHEMA_VERSION {
        return Err(StoreError::new(
            StoreErrorCode::StoreCorrupt,
            format!("v84 schema artifact published v{installed}"),
            false,
        ));
    }
    Ok(())
}

pub fn read_schema_inventory(connection: &Connection) -> Result<SchemaInventory, StoreError> {
    let shadow_tables = connection
        .prepare("SELECT name FROM pragma_table_list WHERE schema = 'main' AND type = 'shadow'")?
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<BTreeSet<_>>>()?;
    let objects = connection
        .prepare(
            "SELECT type, name, tbl_name, sql FROM sqlite_schema \
             WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' \
             ORDER BY type, name, tbl_name",
        )?
        .query_map([], |row| {
            Ok((
                SchemaObjectKey {
                    object_type: row.get(0)?,
                    name: row.get(1)?,
                    table_name: row.get(2)?,
                },
                row.get::<_, String>(3)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(objects
        .into_iter()
        .filter(|(key, _)| {
            !shadow_tables.contains(&key.name) && !shadow_tables.contains(&key.table_name)
        })
        .map(|(key, sql)| (key, normalize_sql(&sql)))
        .collect())
}

pub fn schema_inventory_fingerprint(inventory: &SchemaInventory) -> String {
    let mut digest = Sha256::new();
    for (key, sql) in inventory {
        for value in [
            key.object_type.as_str(),
            key.name.as_str(),
            key.table_name.as_str(),
            sql.as_str(),
        ] {
            digest.update(value.as_bytes());
            digest.update([0]);
        }
    }
    format!("{:x}", digest.finalize())
}

pub fn validate_exact_v84_schema(connection: &Connection) -> Result<(), StoreError> {
    let retired_thread_search_objects: i64 = connection.query_row(
        "SELECT count(*) FROM sqlite_schema WHERE name LIKE 'thread_search%'",
        [],
        |row| row.get(0),
    )?;
    if retired_thread_search_objects != 0 {
        return Err(StoreError::new(
            StoreErrorCode::UnsupportedSchema,
            "TypeScript v84 import contains the retired Thread search projection",
            false,
        ));
    }

    let expected_connection = Connection::open_in_memory()?;
    install_v84_schema(&expected_connection)?;
    let expected = read_schema_inventory(&expected_connection)?;
    let actual = read_schema_inventory(connection)?;
    if actual == expected {
        return Ok(());
    }

    let missing = expected
        .keys()
        .filter(|key| !actual.contains_key(*key))
        .count();
    let unexpected = actual
        .keys()
        .filter(|key| !expected.contains_key(*key))
        .count();
    let changed = expected
        .iter()
        .filter(|(key, sql)| {
            actual
                .get(*key)
                .is_some_and(|actual_sql| actual_sql != *sql)
        })
        .map(|(key, _)| key.name.as_str())
        .collect::<Vec<_>>();
    Err(StoreError::new(
        StoreErrorCode::UnsupportedSchema,
        format!(
            "TypeScript v84 physical schema does not match the frozen import artifact ({missing} missing, {unexpected} unexpected, {} changed objects: {})",
            changed.len(),
            changed.join(", ")
        ),
        false,
    ))
}

fn normalize_sql(sql: &str) -> String {
    static SIMPLE_QUOTED_IDENTIFIER: LazyLock<Regex> = LazyLock::new(|| {
        Regex::new(r#"\"([A-Za-z_][A-Za-z0-9_]*)\""#).expect("quoted identifier regex")
    });
    let whitespace_normalized = sql
        .trim_end_matches(';')
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    SIMPLE_QUOTED_IDENTIFIER
        .replace_all(&whitespace_normalized, "$1")
        .into_owned()
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use crate::infrastructure::sqlite::{open_writer, validate_store};

    use super::*;

    #[test]
    fn checked_in_v84_artifact_installs_the_complete_physical_schema() {
        let directory = tempdir().expect("schema store");
        let connection = open_writer(&directory.path().join("nodex.db")).expect("writer");
        install_v84_schema(&connection).expect("v84 schema");
        validate_store(&connection).expect("valid fresh schema");
        let inventory = read_schema_inventory(&connection).expect("schema inventory");
        assert_eq!(inventory.len(), 231);
        for (object_type, name) in [
            ("table", "documents"),
            ("table", "document_updates"),
            ("table", "block_search_units_fts"),
            ("trigger", "block_search_units_ai"),
            ("index", "idx_document_updates_tail"),
        ] {
            assert!(
                inventory
                    .keys()
                    .any(|key| key.object_type == object_type && key.name == name),
                "missing {object_type} {name}"
            );
        }
        let foreign_keys: i64 = connection
            .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
            .expect("foreign key mode");
        assert_eq!(foreign_keys, 1);
        validate_exact_v84_schema(&connection).expect("exact frozen schema");
    }

    #[test]
    fn schema_inventory_ignores_fts_shadow_implementation_objects() {
        let directory = tempdir().expect("schema store");
        let connection = open_writer(&directory.path().join("nodex.db")).expect("writer");
        install_v84_schema(&connection).expect("v84 schema");
        let inventory = read_schema_inventory(&connection).expect("inventory");
        assert!(
            inventory
                .keys()
                .all(|key| !key.name.starts_with("block_search_units_fts_"))
        );
        assert!(
            inventory
                .keys()
                .all(|key| !key.name.starts_with("thread_search"))
        );
    }
}
