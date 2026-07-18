use std::collections::{BTreeMap, BTreeSet};

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

use super::sqlite::{StoreError, StoreErrorCode};

pub const TYPESCRIPT_SCHEMA_VERSION: i64 = 82;
pub const CORE_SCHEMA_VERSION: i64 = 83;
pub const V82_SCHEMA_SQL: &str = include_str!("../../schema/v82.sql");

pub fn v82_schema_objects_sql() -> &'static str {
    let start_marker = "BEGIN IMMEDIATE;\n\n";
    let end_marker = "\nPRAGMA user_version = 82;";
    let start = V82_SCHEMA_SQL
        .find(start_marker)
        .expect("v82 schema artifact start marker")
        + start_marker.len();
    let end = V82_SCHEMA_SQL
        .rfind(end_marker)
        .expect("v82 schema artifact end marker");
    &V82_SCHEMA_SQL[start..end]
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaObjectKey {
    pub object_type: String,
    pub name: String,
    pub table_name: String,
}

pub type SchemaInventory = BTreeMap<SchemaObjectKey, String>;

pub fn install_v82_schema(connection: &Connection) -> Result<(), StoreError> {
    let current: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    let object_count: i64 = connection.query_row(
        "SELECT count(*) FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'",
        [],
        |row| row.get(0),
    )?;
    if current != 0 || object_count != 0 {
        return Err(StoreError::new(
            StoreErrorCode::UnsupportedSchema,
            "v82 schema installation requires an empty SQLite database",
            false,
        ));
    }
    connection.execute_batch(V82_SCHEMA_SQL)?;
    let installed: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if installed != TYPESCRIPT_SCHEMA_VERSION {
        return Err(StoreError::new(
            StoreErrorCode::StoreCorrupt,
            format!("v82 schema artifact published v{installed}"),
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

fn normalize_sql(sql: &str) -> String {
    sql.trim_end_matches(';')
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use crate::infrastructure::sqlite::{open_writer, validate_store};

    use super::*;

    #[test]
    fn checked_in_v82_artifact_installs_the_complete_physical_schema() {
        let directory = tempdir().expect("schema store");
        let connection = open_writer(&directory.path().join("nodex.db")).expect("writer");
        install_v82_schema(&connection).expect("v82 schema");
        validate_store(&connection).expect("valid fresh schema");
        let inventory = read_schema_inventory(&connection).expect("schema inventory");
        assert_eq!(inventory.len(), 240);
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
    }

    #[test]
    fn schema_inventory_ignores_fts_shadow_implementation_objects() {
        let directory = tempdir().expect("schema store");
        let connection = open_writer(&directory.path().join("nodex.db")).expect("writer");
        install_v82_schema(&connection).expect("v82 schema");
        let inventory = read_schema_inventory(&connection).expect("inventory");
        assert!(
            inventory
                .keys()
                .all(|key| !key.name.starts_with("block_search_units_fts_"))
        );
        assert!(
            inventory
                .keys()
                .all(|key| !key.name.starts_with("thread_search_units_fts_"))
        );
    }
}
