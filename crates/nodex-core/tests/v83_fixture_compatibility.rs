use std::fs;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::thread;

use nodex_core::document::{create_compatible_document, has_pending_dependencies};
use nodex_core::infrastructure::schema::{install_v83_schema, read_schema_inventory};
use nodex_core::infrastructure::sqlite::StoreError;
use nodex_core::infrastructure::store::SqliteStoreKernel;
use rusqlite::types::ValueRef;
use rusqlite::{Connection, MAIN_DB, OpenFlags, OptionalExtension, params};
use sha2::{Digest, Sha256};
use tempfile::tempdir;
use yrs::updates::decoder::Decode;
use yrs::{ReadTxn, StateVector, Transact, Update};

const FIXTURE_MARKER: &str = ".nodex-rust-core-v83-fixture";
const FIXTURE_MARKER_CONTENTS: &str = "Nodex disposable Rust Core v83 compatibility fixture\n";

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

#[derive(Debug, Clone, PartialEq, Eq)]
struct PreservationEvidence {
    store_metadata: String,
    documents: String,
    updates: String,
    receipts: String,
    snapshots: String,
    materializations: String,
    change_log: String,
}

fn fixture_home() -> PathBuf {
    let configured = std::env::var_os("NODEX_V83_FIXTURE")
        .expect("NODEX_V83_FIXTURE must point at the generated TypeScript profile");
    let configured = PathBuf::from(configured);
    let repository_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let configured = if configured.is_absolute() {
        configured
    } else {
        repository_root.join(configured)
    };
    let canonical = configured
        .canonicalize()
        .expect("v83 fixture directory must exist");
    assert!(canonical.is_dir(), "v83 fixture path must be a directory");
    let generated_root = repository_root
        .join(".generated/rust-core-migration")
        .canonicalize()
        .expect("generated Rust Core migration directory must exist");
    assert!(
        canonical.starts_with(generated_root),
        "v83 fixture must remain under .generated/rust-core-migration"
    );

    let marker = canonical.join(FIXTURE_MARKER);
    assert_eq!(
        fs::read_to_string(marker).expect("v83 fixture marker must be readable"),
        FIXTURE_MARKER_CONTENTS,
        "v83 probe only accepts its disposable generated fixture"
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
             WHERE block_search_units_fts MATCH 'rustcorev83token'",
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

fn query_digest(connection: &Connection, sql: &str) -> String {
    let mut statement = connection.prepare(sql).expect("evidence query prepares");
    let column_count = statement.column_count();
    let mut rows = statement.query([]).expect("evidence query runs");
    let mut digest = Sha256::new();
    let mut row_count = 0_u64;
    while let Some(row) = rows.next().expect("evidence row reads") {
        row_count += 1;
        digest.update(b"row\0");
        for column in 0..column_count {
            match row.get_ref(column).expect("evidence value reads") {
                ValueRef::Null => digest.update([0]),
                ValueRef::Integer(value) => {
                    digest.update([1]);
                    digest.update(value.to_le_bytes());
                }
                ValueRef::Real(value) => {
                    digest.update([2]);
                    digest.update(value.to_bits().to_le_bytes());
                }
                ValueRef::Text(value) => {
                    digest.update([3]);
                    digest.update((value.len() as u64).to_le_bytes());
                    digest.update(value);
                }
                ValueRef::Blob(value) => {
                    digest.update([4]);
                    digest.update((value.len() as u64).to_le_bytes());
                    digest.update(value);
                }
            }
        }
    }
    digest.update(row_count.to_le_bytes());
    format!("{:x}", digest.finalize())
}

fn preservation_evidence(connection: &Connection) -> PreservationEvidence {
    PreservationEvidence {
        store_metadata: query_digest(connection, "SELECT * FROM block_store_metadata ORDER BY id"),
        documents: query_digest(connection, "SELECT * FROM documents ORDER BY id"),
        updates: query_digest(
            connection,
            "SELECT * FROM document_updates ORDER BY document_id, generation, seq",
        ),
        receipts: query_digest(
            connection,
            "SELECT * FROM document_update_receipts ORDER BY document_id, generation, seq",
        ),
        snapshots: query_digest(
            connection,
            "SELECT * FROM document_snapshots ORDER BY document_id, generation, snapshot_seq",
        ),
        materializations: query_digest(
            connection,
            "SELECT * FROM document_materializations ORDER BY document_id",
        ),
        change_log: query_digest(connection, "SELECT * FROM change_log ORDER BY seq"),
    }
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
#[ignore = "requires a TypeScript-generated v83 profile"]
fn opens_and_reconstructs_a_typescript_created_v83_profile() {
    let fixture = fixture_home();
    let temporary = tempdir().expect("disposable v83 probe directory");
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
    assert_eq!(user_version, 83);
    assert_store_is_valid(&source);
    assert_search_and_json_projections(&source);

    let artifact_path = temporary.path().join("artifact.db");
    let artifact = Connection::open(&artifact_path).expect("artifact database opens");
    install_v83_schema(&artifact).expect("checked-in v83 schema installs");
    assert_eq!(
        read_schema_inventory(&artifact).expect("artifact inventory"),
        read_schema_inventory(&source).expect("TypeScript inventory"),
        "checked-in Rust schema artifact must exactly match TypeScript v83"
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
    let live_yjs_documents: usize = source
        .query_row(
            "SELECT count(*) FROM documents WHERE readiness = 'ready' \
             AND authority = 'ydoc_primary' AND sync_engine = 'yjs'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .expect("live Yjs count")
        .try_into()
        .expect("non-negative Yjs count");
    let source_evidence = preservation_evidence(&source);

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

    let migrated_home = temporary.path().join("migrated-profile");
    fs::create_dir(&migrated_home).expect("migrated Profile directory");
    copy_fixture_database(&fixture, &migrated_home.join("nodex.db"));
    let kernel = SqliteStoreKernel::open(&migrated_home).expect("v83 migrates to v84");
    assert_eq!(kernel.preparation().schema_version, 84);
    assert_eq!(kernel.preparation().migrated_from_version, Some(83));
    assert_eq!(
        kernel.preparation().validated_yjs_documents,
        live_yjs_documents
    );
    assert!(
        kernel
            .preparation()
            .migration_backup_path
            .as_ref()
            .is_some_and(|path| path.is_file())
    );
    let migrated_evidence = kernel
        .readers()
        .read_default(|connection| Ok::<_, StoreError>(preservation_evidence(connection)))
        .expect("migration preservation evidence");
    assert_eq!(
        migrated_evidence, source_evidence,
        "v84 ownership publication must not rewrite authoritative rows, updates, receipts, snapshots, projections, or event history"
    );
    kernel
        .readers()
        .read_default(|connection| {
            assert_store_is_valid(connection);
            assert_search_and_json_projections(connection);
            let version: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;
            assert_eq!(version, 84);
            Ok::<_, StoreError>(())
        })
        .expect("migrated store remains queryable");

    let v84_backup_path = temporary.path().join("v84-online-backup.db");
    let readers = kernel.readers();
    let (reader_ready_tx, reader_ready_rx) = mpsc::sync_channel(1);
    let (reader_release_tx, reader_release_rx) = mpsc::sync_channel(1);
    let reader = thread::spawn(move || {
        readers.read_default(|connection| {
            connection.execute_batch("BEGIN")?;
            let _: i64 =
                connection.query_row("SELECT count(*) FROM documents", [], |row| row.get(0))?;
            reader_ready_tx.send(()).expect("reader announces snapshot");
            reader_release_rx.recv().expect("reader snapshot releases");
            connection.execute_batch("COMMIT")?;
            Ok::<_, StoreError>(())
        })
    });
    reader_ready_rx.recv().expect("read traffic is active");
    kernel
        .writer()
        .call({
            let v84_backup_path = v84_backup_path.clone();
            move |connection| {
                connection.backup(MAIN_DB, &v84_backup_path, None)?;
                Ok(())
            }
        })
        .expect("v84 online backup succeeds while a reader holds a snapshot");
    reader_release_tx.send(()).expect("release read traffic");
    reader
        .join()
        .expect("reader thread joins")
        .expect("concurrent read succeeds");

    let v84_backup = Connection::open_with_flags(
        &v84_backup_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .expect("v84 backup reopens read-only");
    assert_store_is_valid(&v84_backup);
    assert_search_and_json_projections(&v84_backup);
    assert_eq!(preservation_evidence(&v84_backup), source_evidence);
    drop(v84_backup);

    let restored_v84_home = temporary.path().join("restored-v84-profile");
    fs::create_dir(&restored_v84_home).expect("restored v84 Profile directory");
    let v84_backup_source = Connection::open(&v84_backup_path).expect("v84 backup opens");
    v84_backup_source
        .backup(MAIN_DB, restored_v84_home.join("nodex.db"), None)
        .expect("v84 backup restores through SQLite");
    drop(v84_backup_source);
    let restored_v84 =
        SqliteStoreKernel::open(&restored_v84_home).expect("restored v84 store opens in Core");
    restored_v84
        .readers()
        .read_default(|connection| {
            assert_store_is_valid(connection);
            assert_search_and_json_projections(connection);
            assert_eq!(preservation_evidence(connection), source_evidence);
            Ok::<_, StoreError>(())
        })
        .expect("restored v84 store remains exact and queryable");
}
