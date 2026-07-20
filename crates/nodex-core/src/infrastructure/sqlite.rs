use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};
use std::{os::unix::ffi::OsStrExt, path::Path};

use rusqlite::limits::Limit;
use rusqlite::{Connection, ErrorCode, OpenFlags, TransactionBehavior};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use super::metrics::{DurationMetric, DurationMetricSnapshot};

pub const SQLITE_BUSY_TIMEOUT: Duration = Duration::from_secs(5);
pub const DEFAULT_QUERY_BUDGET: Duration = Duration::from_secs(10);
pub const MAX_SQL_BYTES: i32 = 2 * 1024 * 1024;
pub const MAX_VALUE_BYTES: i32 = 64 * 1024 * 1024;
pub const MIN_SQLITE_VERSION: i32 = 3_045_000;
const PROGRESS_HANDLER_OPS: i32 = 1_000;
static TRANSACTION_DURATION: OnceLock<DurationMetric> = OnceLock::new();

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StoreErrorCode {
    AlreadyOwned,
    Conflict,
    GenerationConflict,
    HeadConflict,
    IdempotencyKeyReused,
    ProtectedOwnerDeletion,
    InvalidInput,
    InvalidProfile,
    MissingDependencies,
    NotFound,
    RevisionConflict,
    StaleStoreEpoch,
    Unauthorized,
    ResourceExhausted,
    WriterQueueFull,
    WriterClosed,
    ReaderPoolTimeout,
    QueryCancelled,
    SqliteBusy,
    SqliteFailure,
    RuntimeIncompatible,
    UnsupportedSchema,
    StoreCorrupt,
    MaintenanceInProgress,
    Internal,
}

#[derive(Debug, Error, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[error("{message}")]
#[serde(rename_all = "camelCase")]
pub struct StoreError {
    pub code: StoreErrorCode,
    pub message: String,
    pub retryable: bool,
}

impl StoreError {
    pub fn new(code: StoreErrorCode, message: impl Into<String>, retryable: bool) -> Self {
        Self {
            code,
            message: message.into(),
            retryable,
        }
    }

    pub fn from_sqlite(error: rusqlite::Error) -> Self {
        let sqlite_code = error.sqlite_error_code();
        let busy = matches!(
            sqlite_code,
            Some(ErrorCode::DatabaseBusy | ErrorCode::DatabaseLocked)
        );
        let cancelled = matches!(sqlite_code, Some(ErrorCode::OperationInterrupted));
        if cancelled {
            return Self::new(
                StoreErrorCode::QueryCancelled,
                "SQLite work exceeded its budget or was cancelled",
                true,
            );
        }
        if busy {
            return Self::new(StoreErrorCode::SqliteBusy, "SQLite store is busy", true);
        }
        Self::new(
            StoreErrorCode::SqliteFailure,
            format!("SQLite operation failed: {error}"),
            false,
        )
    }
}

impl From<rusqlite::Error> for StoreError {
    fn from(value: rusqlite::Error) -> Self {
        Self::from_sqlite(value)
    }
}

#[derive(Debug, Clone)]
pub struct QueryCancellation {
    cancelled: Arc<AtomicBool>,
}

impl QueryCancellation {
    pub fn new() -> Self {
        Self {
            cancelled: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
    }

    fn flag(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.cancelled)
    }
}

impl Default for QueryCancellation {
    fn default() -> Self {
        Self::new()
    }
}

pub fn open_writer(path: &std::path::Path) -> Result<Connection, StoreError> {
    let flags = OpenFlags::SQLITE_OPEN_READ_WRITE
        | OpenFlags::SQLITE_OPEN_CREATE
        | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    let connection = Connection::open_with_flags(path, flags)?;
    configure_writer(&connection)?;
    Ok(connection)
}

pub fn open_reader(path: &std::path::Path) -> Result<Connection, StoreError> {
    let flags = OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX;
    let connection = Connection::open_with_flags(path, flags)?;
    configure_reader(&connection)?;
    Ok(connection)
}

pub fn open_immutable_reader(path: &Path) -> Result<Connection, StoreError> {
    let canonical = path.canonicalize().map_err(|error| {
        StoreError::new(
            StoreErrorCode::InvalidProfile,
            format!("Immutable SQLite path is unavailable: {error}"),
            false,
        )
    })?;
    let encoded = canonical
        .as_os_str()
        .as_bytes()
        .iter()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'/' | b'.' | b'_' | b'-' => {
                char::from(*byte).to_string()
            }
            _ => format!("%{byte:02X}"),
        })
        .collect::<String>();
    let flags = OpenFlags::SQLITE_OPEN_READ_ONLY
        | OpenFlags::SQLITE_OPEN_NO_MUTEX
        | OpenFlags::SQLITE_OPEN_URI;
    let connection = Connection::open_with_flags(format!("file:{encoded}?immutable=1"), flags)?;
    configure_reader(&connection)?;
    Ok(connection)
}

pub fn configure_writer(connection: &Connection) -> Result<(), StoreError> {
    verify_sqlite_runtime(connection)?;
    connection.busy_timeout(SQLITE_BUSY_TIMEOUT)?;
    connection.pragma_update(None, "foreign_keys", true)?;
    connection.pragma_update(None, "journal_mode", "WAL")?;
    connection.pragma_update(None, "synchronous", "NORMAL")?;
    connection.pragma_update(None, "wal_autocheckpoint", 1_000)?;
    apply_runtime_limits(connection)?;
    Ok(())
}

pub fn configure_reader(connection: &Connection) -> Result<(), StoreError> {
    verify_sqlite_runtime(connection)?;
    connection.busy_timeout(SQLITE_BUSY_TIMEOUT)?;
    connection.pragma_update(None, "foreign_keys", true)?;
    connection.pragma_update(None, "query_only", true)?;
    apply_runtime_limits(connection)?;
    Ok(())
}

pub fn verify_sqlite_runtime(connection: &Connection) -> Result<(), StoreError> {
    if rusqlite::version_number() < MIN_SQLITE_VERSION {
        return Err(StoreError::new(
            StoreErrorCode::RuntimeIncompatible,
            format!(
                "SQLite {} is older than the required runtime {}",
                rusqlite::version(),
                MIN_SQLITE_VERSION
            ),
            false,
        ));
    }
    let compile_options = connection
        .prepare("PRAGMA compile_options")?
        .query_map([], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if !compile_options.iter().any(|option| option == "ENABLE_FTS5") {
        return Err(StoreError::new(
            StoreErrorCode::RuntimeIncompatible,
            "SQLite runtime does not include FTS5",
            false,
        ));
    }
    let json_valid: i64 = connection.query_row("SELECT json_valid('{}')", [], |row| row.get(0))?;
    if json_valid != 1 {
        return Err(StoreError::new(
            StoreErrorCode::RuntimeIncompatible,
            "SQLite runtime does not provide JSON functions",
            false,
        ));
    }
    Ok(())
}

pub fn apply_runtime_limits(connection: &Connection) -> Result<(), StoreError> {
    connection.set_limit(Limit::SQLITE_LIMIT_SQL_LENGTH, MAX_SQL_BYTES)?;
    connection.set_limit(Limit::SQLITE_LIMIT_LENGTH, MAX_VALUE_BYTES)?;
    connection.set_limit(Limit::SQLITE_LIMIT_ATTACHED, 0)?;
    connection.set_limit(Limit::SQLITE_LIMIT_COLUMN, 2_000)?;
    connection.set_limit(Limit::SQLITE_LIMIT_COMPOUND_SELECT, 100)?;
    connection.set_limit(Limit::SQLITE_LIMIT_VARIABLE_NUMBER, 32_766)?;
    Ok(())
}

pub fn with_query_budget<T>(
    connection: &Connection,
    budget: Duration,
    cancellation: &QueryCancellation,
    operation: impl FnOnce(&Connection) -> Result<T, StoreError>,
) -> Result<T, StoreError> {
    let deadline = Instant::now() + budget;
    let cancelled = cancellation.flag();
    connection.progress_handler(
        PROGRESS_HANDLER_OPS,
        Some(move || cancelled.load(Ordering::Acquire) || Instant::now() >= deadline),
    )?;
    let result = operation(connection);
    connection.progress_handler(0, None::<fn() -> bool>)?;
    result
}

pub fn with_mut_query_budget<T>(
    connection: &mut Connection,
    budget: Duration,
    cancellation: &QueryCancellation,
    operation: impl FnOnce(&mut Connection) -> Result<T, StoreError>,
) -> Result<T, StoreError> {
    let deadline = Instant::now() + budget;
    let cancelled = cancellation.flag();
    connection.progress_handler(
        PROGRESS_HANDLER_OPS,
        Some(move || cancelled.load(Ordering::Acquire) || Instant::now() >= deadline),
    )?;
    let result = operation(connection);
    connection.progress_handler(0, None::<fn() -> bool>)?;
    result
}

pub fn with_immediate_transaction<T>(
    connection: &mut Connection,
    operation: impl FnOnce(&rusqlite::Transaction<'_>) -> Result<T, StoreError>,
) -> Result<T, StoreError> {
    let started_at = Instant::now();
    let result = (|| {
        let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let value = operation(&transaction)?;
        transaction.commit()?;
        Ok(value)
    })();
    TRANSACTION_DURATION
        .get_or_init(DurationMetric::default)
        .record(started_at.elapsed());
    let transaction_micros = u64::try_from(started_at.elapsed().as_micros()).unwrap_or(u64::MAX);
    if result.is_ok() {
        tracing::debug!(
            transactionMicros = transaction_micros,
            status = "committed",
            "SQLite immediate transaction completed"
        );
    } else {
        tracing::debug!(
            transactionMicros = transaction_micros,
            status = "rolled_back",
            "SQLite immediate transaction completed"
        );
    }
    result
}

pub fn transaction_duration_metrics() -> DurationMetricSnapshot {
    TRANSACTION_DURATION
        .get_or_init(DurationMetric::default)
        .snapshot()
}

pub fn validate_store(connection: &Connection) -> Result<(), StoreError> {
    let integrity: String = connection.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
    if integrity != "ok" {
        return Err(StoreError::new(
            StoreErrorCode::StoreCorrupt,
            format!("SQLite integrity_check failed: {integrity}"),
            false,
        ));
    }
    let foreign_key_violations: i64 =
        connection.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |row| {
            row.get(0)
        })?;
    if foreign_key_violations != 0 {
        return Err(StoreError::new(
            StoreErrorCode::StoreCorrupt,
            format!("SQLite foreign_key_check found {foreign_key_violations} violations"),
            false,
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, Ordering};

    use tempfile::tempdir;

    use super::*;

    #[test]
    fn immediate_transactions_record_bounded_duration_metrics() {
        let directory = tempdir().expect("store");
        let mut connection = open_writer(&directory.path().join("metrics.db")).expect("writer");
        let before = transaction_duration_metrics();
        with_immediate_transaction(&mut connection, |transaction| {
            transaction.execute_batch("CREATE TABLE metric_probe(value INTEGER NOT NULL);")?;
            Ok(())
        })
        .expect("transaction");
        let after = transaction_duration_metrics();
        assert!(after.count > before.count);
        assert!(after.total_micros >= before.total_micros);
        assert!(after.max_micros >= after.last_micros);
    }

    #[test]
    fn writer_reader_limits_and_immediate_transactions_are_centralized() {
        let directory = tempdir().expect("store directory");
        let path = directory.path().join("nodex.db");
        let mut writer = open_writer(&path).expect("writer");
        assert_eq!(
            writer.limit(Limit::SQLITE_LIMIT_SQL_LENGTH).unwrap(),
            MAX_SQL_BYTES
        );
        assert_eq!(writer.limit(Limit::SQLITE_LIMIT_ATTACHED).unwrap(), 0);
        with_immediate_transaction(&mut writer, |transaction| {
            transaction.execute_batch(
                "CREATE TABLE values_table(value TEXT NOT NULL);\n\
                 INSERT INTO values_table(value) VALUES ('committed');",
            )?;
            Ok(())
        })
        .expect("immediate transaction");

        let reader = open_reader(&path).expect("reader");
        let query_only: i64 = reader
            .query_row("PRAGMA query_only", [], |row| row.get(0))
            .expect("query_only");
        assert_eq!(query_only, 1);
        assert!(reader.execute("DELETE FROM values_table", []).is_err());
        let value: String = reader
            .query_row("SELECT value FROM values_table", [], |row| row.get(0))
            .expect("read value");
        assert_eq!(value, "committed");
    }

    #[test]
    fn progress_budget_supports_explicit_cancellation() {
        let connection = Connection::open_in_memory().expect("memory database");
        let cancellation = QueryCancellation::new();
        cancellation.cancel();
        let error = with_query_budget(
            &connection,
            DEFAULT_QUERY_BUDGET,
            &cancellation,
            |connection| {
                connection.query_row(
                    "WITH RECURSIVE values_cte(value) AS (\
                       SELECT 1 UNION ALL SELECT value + 1 FROM values_cte WHERE value < 100000\
                     ) SELECT sum(value) FROM values_cte",
                    [],
                    |row| row.get::<_, i64>(0),
                )?;
                Ok(())
            },
        )
        .expect_err("cancelled query");
        assert_eq!(error.code, StoreErrorCode::QueryCancelled);

        let observed = Arc::new(AtomicBool::new(false));
        let observed_by_query = Arc::clone(&observed);
        with_query_budget(
            &connection,
            DEFAULT_QUERY_BUDGET,
            &QueryCancellation::new(),
            move |connection| {
                let value: i64 = connection.query_row("SELECT 1", [], |row| row.get(0))?;
                observed_by_query.store(value == 1, Ordering::Release);
                Ok(())
            },
        )
        .expect("later query");
        assert!(observed.load(Ordering::Acquire));
    }
}
