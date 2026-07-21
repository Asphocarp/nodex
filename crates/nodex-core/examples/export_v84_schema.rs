use std::collections::BTreeSet;
use std::env;
use std::fs;
use std::os::unix::ffi::OsStrExt;
use std::path::Path;

use rusqlite::{Connection, OpenFlags};

#[derive(Debug)]
struct SchemaObject {
    object_type: String,
    name: String,
    table_name: String,
    sql: String,
    row_id: i64,
}

fn export_schema(database_path: &Path) -> Result<String, Box<dyn std::error::Error>> {
    let canonical = database_path.canonicalize()?;
    let uri = format!(
        "file:{}?immutable=1",
        canonical
            .as_os_str()
            .as_bytes()
            .iter()
            .map(|byte| match byte {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'/' | b'.' | b'_' | b'-' => {
                    char::from(*byte).to_string()
                }
                _ => format!("%{byte:02X}"),
            })
            .collect::<String>()
    );
    let connection = Connection::open_with_flags(
        uri,
        OpenFlags::SQLITE_OPEN_READ_ONLY
            | OpenFlags::SQLITE_OPEN_NO_MUTEX
            | OpenFlags::SQLITE_OPEN_URI,
    )?;
    let user_version: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
    if user_version != 84 {
        return Err(format!("schema export requires v84, received v{user_version}").into());
    }
    let shadow_tables = connection
        .prepare("SELECT name FROM pragma_table_list WHERE schema = 'main' AND type = 'shadow'")?
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<BTreeSet<_>>>()?;
    let objects = connection
        .prepare(
            "SELECT rowid, type, name, tbl_name, sql FROM sqlite_schema \
             WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid",
        )?
        .query_map([], |row| {
            Ok(SchemaObject {
                row_id: row.get(0)?,
                object_type: row.get(1)?,
                name: row.get(2)?,
                table_name: row.get(3)?,
                sql: row.get(4)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;

    let mut retained: Vec<_> = objects
        .into_iter()
        .filter(|object| {
            !shadow_tables.contains(&object.name) && !shadow_tables.contains(&object.table_name)
        })
        .collect();
    retained.sort_by_key(|object| {
        let rank = match object.object_type.as_str() {
            "table" => 0,
            "view" => 1,
            "index" => 2,
            "trigger" => 3,
            _ => 4,
        };
        (rank, object.row_id)
    });

    let mut output = String::from(
        "-- Generated from the TypeScript-authoritative Nodex v84 schema.\n\
         -- Regenerate with: pnpm core:schema:v84:generate\n\
         PRAGMA foreign_keys = OFF;\n\
         BEGIN IMMEDIATE;\n\n",
    );
    for object in retained {
        output.push_str(object.sql.trim());
        output.push_str(";\n\n");
    }
    output.push_str("PRAGMA user_version = 84;\nCOMMIT;\nPRAGMA foreign_keys = ON;\n");
    Ok(output)
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = env::args_os().collect();
    let [_, database_path, output_path, rest @ ..] = args.as_slice() else {
        return Err("usage: export_v84_schema <v84-database> <output-sql> [--verify]".into());
    };
    let verify = match rest {
        [] => false,
        [flag] if flag == "--verify" => true,
        _ => return Err("only --verify is accepted after the output path".into()),
    };
    let schema = export_schema(Path::new(database_path))?;
    let output_path = Path::new(output_path);
    if verify {
        let checked_in = fs::read_to_string(output_path)?;
        if checked_in != schema {
            return Err(format!(
                "{} differs from the deterministic v84 schema export",
                output_path.display()
            )
            .into());
        }
        return Ok(());
    }
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(output_path, schema)?;
    Ok(())
}
