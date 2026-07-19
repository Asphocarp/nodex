use std::path::PathBuf;

use nodex_core::infrastructure::sqlite::validate_store;
use nodex_core::infrastructure::store::SqliteStoreKernel;
use serde_json::json;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let home = std::env::args_os()
        .nth(1)
        .map(PathBuf::from)
        .ok_or("usage: verify_core_profile <absolute-profile-home>")?;
    let kernel = SqliteStoreKernel::open(&home)?;
    let (integrity, foreign_key_violations, final_committed_sequence) =
        kernel.readers().read_default(|connection| {
            validate_store(connection)?;
            let integrity = connection
                .query_row("PRAGMA integrity_check", [], |row| row.get::<_, String>(0))?;
            let foreign_key_violations = connection.query_row(
                "SELECT count(*) FROM pragma_foreign_key_check",
                [],
                |row| row.get::<_, i64>(0),
            )?;
            let final_committed_sequence = connection.query_row(
                "SELECT coalesce(max(seq), 0) FROM change_log",
                [],
                |row| row.get::<_, i64>(0),
            )?;
            Ok((integrity, foreign_key_violations, final_committed_sequence))
        })?;
    println!(
        "{}",
        json!({
            "recovered": true,
            "schemaVersion": kernel.preparation().schema_version,
            "finalCommittedSequence": final_committed_sequence,
            "integrityCheck": integrity,
            "foreignKeyViolations": foreign_key_violations,
        })
    );
    Ok(())
}
