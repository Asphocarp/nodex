use std::fs;
use std::path::{Path, PathBuf};

use nodex_core::document::{create_compatible_document, has_pending_dependencies};
use nodex_core::infrastructure::schema::{install_v82_schema, read_schema_inventory};
use rusqlite::{Connection, MAIN_DB, OpenFlags, OptionalExtension, params};
use tempfile::tempdir;
use yrs::updates::decoder::Decode;
use yrs::{ReadTxn, StateVector, Transact, Update};

const FIXTURE_MARKER: &str = ".nodex-rust-core-v82-fixture";
const FIXTURE_MARKER_CONTENTS: &str = "Nodex disposable Rust Core v82 compatibility fixture\n";

#[derive(Debug)]
struct DocumentHead {
    id: String,
    generation: i64,
    head_seq: i64,
    state_vector: Vec<u8>,
}

#[derive(Debug)]
struct Snapshot {
    seq: i64,
    state_vector: Vec<u8>,
    update: Vec<u8>,
}

fn fixture_home() -> PathBuf {
    let configured = std::env::var_os("NODEX_V82_FIXTURE")
        .expect("NODEX_V82_FIXTURE must point at the generated TypeScript profile");
    let configured = PathBuf::from(configured);
    let repository_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let configured = if configured.is_absolute() {
        configured
    } else {
        repository_root.join(configured)
    };
    let canonical = configured
        .canonicalize()
        .expect("v82 fixture directory must exist");
    assert!(canonical.is_dir(), "v82 fixture path must be a directory");
    let generated_root = repository_root
        .join(".generated/rust-core-migration")
        .canonicalize()
        .expect("generated Rust Core migration directory must exist");
    assert!(
        canonical.starts_with(generated_root),
        "v82 fixture must remain under .generated/rust-core-migration"
    );

    let marker = canonical.join(FIXTURE_MARKER);
    assert_eq!(
        fs::read_to_string(marker).expect("v82 fixture marker must be readable"),
        FIXTURE_MARKER_CONTENTS,
        "v82 probe only accepts its disposable generated fixture"
    );
    canonical
}

fn assert_store_is_valid(connection: &Connection) {
    let integrity: String = connection
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .expect("integrity_check runs");
    assert_eq!(integrity, "ok");
    let foreign_key_violations: i64 = connection
        .query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |row| {
            row.get(0)
        })
        .expect("foreign_key_check runs");
    assert_eq!(foreign_key_violations, 0);
}

fn assert_search_and_json_projections(connection: &Connection) {
    let fts_match_count: i64 = connection
        .query_row(
            "SELECT count(*) FROM block_search_units_fts \
             WHERE block_search_units_fts MATCH 'rustcorev82token'",
            [],
            |row| row.get(0),
        )
        .expect("FTS5 can read the TypeScript-created projection");
    assert!(fts_match_count > 0, "fixture search token must be indexed");

    let materialized_trees: i64 = connection
        .query_row(
            "SELECT count(*) FROM document_materializations \
             WHERE json_valid(block_tree_json) \
               AND json_type(block_tree_json) = 'array' \
               AND json_array_length(block_tree_json) > 0",
            [],
            |row| row.get(0),
        )
        .expect("JSON1 reads document materializations");
    assert!(materialized_trees > 0);

    let trigger_count: i64 = connection
        .query_row(
            "SELECT count(*) FROM sqlite_master \
             WHERE type = 'trigger' \
               AND name IN ('block_search_units_ai', 'block_search_units_ad', 'block_search_units_au')",
            [],
            |row| row.get(0),
        )
        .expect("search trigger inventory is readable");
    assert_eq!(trigger_count, 3);
}

fn load_document_heads(connection: &Connection) -> Vec<DocumentHead> {
    let mut statement = connection
        .prepare(
            "SELECT id, generation, head_seq, state_vector \
             FROM documents \
             WHERE readiness = 'ready' AND authority = 'ydoc_primary' \
             ORDER BY id",
        )
        .expect("document head query prepares");
    statement
        .query_map([], |row| {
            Ok(DocumentHead {
                id: row.get(0)?,
                generation: row.get(1)?,
                head_seq: row.get(2)?,
                state_vector: row.get(3)?,
            })
        })
        .expect("document head query runs")
        .collect::<rusqlite::Result<Vec<_>>>()
        .expect("document heads decode")
}

fn decode_stored_state_vector(bytes: &[u8]) -> StateVector {
    if bytes.is_empty() {
        return StateVector::default();
    }
    StateVector::decode_v1(bytes).expect("stored state vector is Yjs V1")
}

fn reconstruct_document(connection: &Connection, head: &DocumentHead) -> bool {
    let snapshot = connection
        .query_row(
            "SELECT snapshot_seq, state_vector, snapshot_update \
             FROM document_snapshots \
             WHERE document_id = ?1 AND generation = ?2 AND snapshot_seq <= ?3 \
             ORDER BY snapshot_seq DESC \
             LIMIT 1",
            params![head.id, head.generation, head.head_seq],
            |row| {
                Ok(Snapshot {
                    seq: row.get(0)?,
                    state_vector: row.get(1)?,
                    update: row.get(2)?,
                })
            },
        )
        .optional()
        .expect("snapshot query runs");

    let document = create_compatible_document(&head.id);
    let snapshot_seq = if let Some(snapshot) = snapshot {
        let mut transaction = document.transact_mut();
        transaction
            .apply_update(Update::decode_v1(&snapshot.update).expect("snapshot is a V1 update"))
            .expect("snapshot applies in Yrs");
        assert!(!has_pending_dependencies(&transaction));
        assert_eq!(
            transaction.state_vector(),
            decode_stored_state_vector(&snapshot.state_vector)
        );
        snapshot.seq
    } else {
        0
    };

    let mut statement = connection
        .prepare(
            "SELECT seq, update_blob \
             FROM document_updates \
             WHERE document_id = ?1 AND generation = ?2 AND seq > ?3 AND seq <= ?4 \
             ORDER BY seq",
        )
        .expect("update tail query prepares");
    let updates = statement
        .query_map(
            params![head.id, head.generation, snapshot_seq, head.head_seq],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, Vec<u8>>(1)?)),
        )
        .expect("update tail query runs")
        .collect::<rusqlite::Result<Vec<_>>>()
        .expect("update tail decodes");

    let mut expected_seq = snapshot_seq + 1;
    for (seq, update) in &updates {
        assert_eq!(
            *seq, expected_seq,
            "document update sequence must be contiguous"
        );
        let mut transaction = document.transact_mut();
        transaction
            .apply_update(Update::decode_v1(update).expect("tail entry is a V1 update"))
            .expect("tail update applies in Yrs");
        assert!(!has_pending_dependencies(&transaction));
        expected_seq += 1;
    }
    assert_eq!(expected_seq - 1, head.head_seq);
    assert_eq!(
        document.transact().state_vector(),
        decode_stored_state_vector(&head.state_vector)
    );
    !updates.is_empty()
}

fn copy_fixture_database(fixture: &Path, target: &Path) {
    assert!(
        !fixture.join("nodex.db-wal").exists(),
        "fixture WAL must be checkpointed"
    );
    assert!(
        !fixture.join("nodex.db-shm").exists(),
        "fixture SHM must be closed"
    );
    fs::copy(fixture.join("nodex.db"), target).expect("fixture database copies");
}

#[test]
#[ignore = "requires a TypeScript-generated v82 profile"]
fn opens_and_reconstructs_a_typescript_created_v82_profile() {
    let fixture = fixture_home();
    let temporary = tempdir().expect("disposable v82 probe directory");
    let source_path = temporary.path().join("source.db");
    let backup_path = temporary.path().join("backup.db");
    let restored_path = temporary.path().join("restored.db");
    copy_fixture_database(&fixture, &source_path);

    let source = Connection::open(&source_path).expect("Rust opens the TypeScript database");
    source
        .pragma_update(None, "foreign_keys", true)
        .expect("foreign keys enable");
    let user_version: i64 = source
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .expect("user_version reads");
    assert_eq!(user_version, 82);
    assert_store_is_valid(&source);
    assert_search_and_json_projections(&source);

    let artifact_path = temporary.path().join("artifact.db");
    let artifact = Connection::open(&artifact_path).expect("artifact database opens");
    install_v82_schema(&artifact).expect("checked-in v82 schema installs");
    assert_eq!(
        read_schema_inventory(&artifact).expect("artifact inventory"),
        read_schema_inventory(&source).expect("TypeScript inventory"),
        "checked-in Rust schema artifact must exactly match TypeScript v82"
    );

    let heads = load_document_heads(&source);
    assert!(
        !heads.is_empty(),
        "fixture must contain authoritative documents"
    );
    let tail_count = heads
        .iter()
        .filter(|head| reconstruct_document(&source, head))
        .count();
    assert!(
        tail_count > 0,
        "fixture must exercise an incremental update tail"
    );

    source
        .backup(MAIN_DB, &backup_path, None)
        .expect("online backup succeeds");
    let backup = Connection::open_with_flags(
        &backup_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .expect("backup reopens read-only");
    assert_store_is_valid(&backup);
    assert_search_and_json_projections(&backup);
    drop(backup);

    let backup_source = Connection::open(&backup_path).expect("backup opens for restore");
    backup_source
        .backup(MAIN_DB, &restored_path, None)
        .expect("backup restores through SQLite");
    let restored = Connection::open(&restored_path).expect("restored database opens");
    assert_store_is_valid(&restored);
    assert_search_and_json_projections(&restored);
}
