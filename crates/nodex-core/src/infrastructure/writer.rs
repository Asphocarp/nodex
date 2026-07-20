use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::mpsc::{self, Receiver, SyncSender, TrySendError};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use rusqlite::Connection;

use super::metrics::{DurationMetric, DurationMetricSnapshot};
use super::sqlite::{
    DEFAULT_QUERY_BUDGET, QueryCancellation, StoreError, StoreErrorCode, open_reader, open_writer,
    with_mut_query_budget, with_query_budget,
};

pub const DEFAULT_WRITER_QUEUE_CAPACITY: usize = 64;
pub const DEFAULT_READ_CONNECTIONS: usize = 4;
const READER_WAIT_TIMEOUT: Duration = Duration::from_secs(5);
static NEXT_WRITER_COMMAND_ID: AtomicU64 = AtomicU64::new(1);

type WriterJob = Box<dyn FnOnce(&mut Connection) + Send + 'static>;

enum WriterMessage {
    Run(WriterJob),
    Shutdown,
}

#[derive(Clone)]
struct WriterEndpoint {
    sender: SyncSender<WriterMessage>,
    queued_jobs: Arc<AtomicUsize>,
}

struct WriterGeneration {
    endpoint: WriterEndpoint,
    join: Option<JoinHandle<()>>,
    shutdown: Arc<AtomicBool>,
}

impl WriterGeneration {
    fn start(path: &Path, queue_capacity: usize) -> Result<Self, StoreError> {
        let (sender, receiver) = mpsc::sync_channel(queue_capacity);
        let (ready_sender, ready_receiver) = mpsc::sync_channel(1);
        let queued_jobs = Arc::new(AtomicUsize::new(0));
        let shutdown = Arc::new(AtomicBool::new(false));
        let writer_shutdown = Arc::clone(&shutdown);
        let path = path.to_owned();
        let join = thread::Builder::new()
            .name("nodex-sqlite-writer".to_owned())
            .spawn(move || writer_loop(&path, receiver, ready_sender, &writer_shutdown))
            .map_err(|error| {
                StoreError::new(
                    StoreErrorCode::Internal,
                    format!("Could not start SQLite writer thread: {error}"),
                    false,
                )
            })?;
        ready_receiver.recv().map_err(|_| {
            StoreError::new(
                StoreErrorCode::WriterClosed,
                "SQLite writer stopped during initialization",
                false,
            )
        })??;
        Ok(Self {
            endpoint: WriterEndpoint {
                sender,
                queued_jobs,
            },
            join: Some(join),
            shutdown,
        })
    }

    fn shutdown(mut self) {
        self.shutdown.store(true, Ordering::Release);
        let _ = self.endpoint.sender.try_send(WriterMessage::Shutdown);
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
    }
}

fn writer_loop(
    path: &Path,
    receiver: Receiver<WriterMessage>,
    ready: SyncSender<Result<(), StoreError>>,
    shutdown: &AtomicBool,
) {
    let mut connection = match open_writer(path) {
        Ok(connection) => {
            let _ = ready.send(Ok(()));
            connection
        }
        Err(error) => {
            let _ = ready.send(Err(error));
            return;
        }
    };
    while !shutdown.load(Ordering::Acquire) {
        let Ok(message) = receiver.recv() else {
            return;
        };
        match message {
            WriterMessage::Run(job) => job(&mut connection),
            WriterMessage::Shutdown => return,
        }
    }
}

struct ReadPoolState {
    idle: Vec<Connection>,
    total: usize,
}

struct ReadPoolInner {
    path: PathBuf,
    max_connections: usize,
    state: Mutex<ReadPoolState>,
    available: Condvar,
}

impl ReadPoolInner {
    fn new(path: &Path, max_connections: usize) -> Self {
        Self {
            path: path.to_owned(),
            max_connections,
            state: Mutex::new(ReadPoolState {
                idle: Vec::new(),
                total: 0,
            }),
            available: Condvar::new(),
        }
    }

    fn checkout(&self) -> Result<Connection, StoreError> {
        let deadline = Instant::now() + READER_WAIT_TIMEOUT;
        let mut state = self.state.lock().map_err(|_| poisoned_pool())?;
        loop {
            if let Some(connection) = state.idle.pop() {
                return Ok(connection);
            }
            if state.total < self.max_connections {
                state.total += 1;
                drop(state);
                return match open_reader(&self.path) {
                    Ok(connection) => Ok(connection),
                    Err(error) => {
                        let mut state = self.state.lock().map_err(|_| poisoned_pool())?;
                        state.total -= 1;
                        self.available.notify_one();
                        Err(error)
                    }
                };
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(StoreError::new(
                    StoreErrorCode::ReaderPoolTimeout,
                    "Timed out waiting for a SQLite read connection",
                    true,
                ));
            }
            let (next_state, wait) = self
                .available
                .wait_timeout(state, remaining)
                .map_err(|_| poisoned_pool())?;
            state = next_state;
            if wait.timed_out() && state.idle.is_empty() {
                return Err(StoreError::new(
                    StoreErrorCode::ReaderPoolTimeout,
                    "Timed out waiting for a SQLite read connection",
                    true,
                ));
            }
        }
    }

    fn checkin(&self, connection: Connection) {
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        state.idle.push(connection);
        self.available.notify_one();
    }
}

struct RuntimeGeneration {
    writer: Option<WriterGeneration>,
    readers: Option<Arc<ReadPoolInner>>,
}

impl RuntimeGeneration {
    fn start(
        path: &Path,
        writer_queue_capacity: Option<usize>,
        read_connections: Option<usize>,
    ) -> Result<Self, StoreError> {
        let writer = writer_queue_capacity
            .map(|capacity| WriterGeneration::start(path, capacity))
            .transpose()?;
        let readers =
            read_connections.map(|connections| Arc::new(ReadPoolInner::new(path, connections)));
        Ok(Self { writer, readers })
    }

    fn shutdown(self) {
        if let Some(writer) = self.writer {
            writer.shutdown();
        }
        drop(self.readers);
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum RuntimePhase {
    Running,
    Maintenance,
    Closed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum StoreRuntimePhase {
    Running,
    Maintenance,
    Closed,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct StoreRuntimeActivity {
    pub phase: StoreRuntimePhase,
    pub active_writes: usize,
    pub active_reads: usize,
    pub queued_writes: usize,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct StoreRuntimeMetrics {
    pub command_latency: DurationMetricSnapshot,
}

struct RuntimeState {
    phase: RuntimePhase,
    active_writes: usize,
    active_reads: usize,
    generation: Option<RuntimeGeneration>,
}

struct RuntimeControl {
    path: PathBuf,
    writer_queue_capacity: Option<usize>,
    read_connections: Option<usize>,
    state: Mutex<RuntimeState>,
    drained: Condvar,
    command_latency: DurationMetric,
}

impl RuntimeControl {
    fn new(
        path: &Path,
        writer_queue_capacity: Option<usize>,
        read_connections: Option<usize>,
    ) -> Result<Arc<Self>, StoreError> {
        if writer_queue_capacity == Some(0) {
            return Err(internal("SQLite writer queue capacity must be positive"));
        }
        if read_connections == Some(0) {
            return Err(internal("SQLite reader pool size must be positive"));
        }
        let generation = RuntimeGeneration::start(path, writer_queue_capacity, read_connections)?;
        Ok(Arc::new(Self {
            path: path.to_owned(),
            writer_queue_capacity,
            read_connections,
            state: Mutex::new(RuntimeState {
                phase: RuntimePhase::Running,
                active_writes: 0,
                active_reads: 0,
                generation: Some(generation),
            }),
            drained: Condvar::new(),
            command_latency: DurationMetric::default(),
        }))
    }

    fn acquire_writer(self: &Arc<Self>) -> Result<(WriterEndpoint, RuntimeLease), StoreError> {
        let mut state = self.state.lock().map_err(|_| poisoned_runtime())?;
        match state.phase {
            RuntimePhase::Maintenance => return Err(maintenance_in_progress()),
            RuntimePhase::Closed => return Err(writer_closed()),
            RuntimePhase::Running => {}
        }
        let endpoint = state
            .generation
            .as_ref()
            .and_then(|generation| generation.writer.as_ref())
            .map(|writer| writer.endpoint.clone())
            .ok_or_else(writer_closed)?;
        state.active_writes += 1;
        Ok((endpoint, RuntimeLease::write(Arc::clone(self))))
    }

    fn acquire_reader(self: &Arc<Self>) -> Result<(Arc<ReadPoolInner>, RuntimeLease), StoreError> {
        let mut state = self.state.lock().map_err(|_| poisoned_runtime())?;
        match state.phase {
            RuntimePhase::Maintenance => return Err(maintenance_in_progress()),
            RuntimePhase::Closed => return Err(reader_closed()),
            RuntimePhase::Running => {}
        }
        let pool = state
            .generation
            .as_ref()
            .and_then(|generation| generation.readers.as_ref())
            .cloned()
            .ok_or_else(reader_closed)?;
        state.active_reads += 1;
        Ok((pool, RuntimeLease::read(Arc::clone(self))))
    }

    fn release(&self, kind: LeaseKind) {
        let Ok(mut state) = self.state.lock() else {
            return;
        };
        match kind {
            LeaseKind::Write => state.active_writes = state.active_writes.saturating_sub(1),
            LeaseKind::Read => state.active_reads = state.active_reads.saturating_sub(1),
        }
        if state.active_writes == 0 && state.active_reads == 0 {
            self.drained.notify_all();
        }
    }

    fn begin_maintenance(&self) -> Result<RuntimeGeneration, StoreError> {
        let mut state = self.state.lock().map_err(|_| poisoned_runtime())?;
        match state.phase {
            RuntimePhase::Running => state.phase = RuntimePhase::Maintenance,
            RuntimePhase::Maintenance => return Err(maintenance_in_progress()),
            RuntimePhase::Closed => return Err(writer_closed()),
        }
        while state.active_writes != 0 || state.active_reads != 0 {
            state = self.drained.wait(state).map_err(|_| poisoned_runtime())?;
        }
        state
            .generation
            .take()
            .ok_or_else(|| internal("SQLite runtime generation is unavailable"))
    }

    fn resume(&self) -> Result<(), StoreError> {
        let generation = RuntimeGeneration::start(
            &self.path,
            self.writer_queue_capacity,
            self.read_connections,
        )?;
        let mut state = self.state.lock().map_err(|_| poisoned_runtime())?;
        if state.phase != RuntimePhase::Maintenance || state.generation.is_some() {
            generation.shutdown();
            return Err(internal(
                "SQLite runtime cannot publish a replacement generation",
            ));
        }
        state.generation = Some(generation);
        state.phase = RuntimePhase::Running;
        self.drained.notify_all();
        Ok(())
    }

    fn close(&self) {
        let generation = {
            let Ok(mut state) = self.state.lock() else {
                return;
            };
            if state.phase == RuntimePhase::Closed {
                return;
            }
            state.phase = RuntimePhase::Maintenance;
            while state.active_writes != 0 || state.active_reads != 0 {
                let Ok(next) = self.drained.wait(state) else {
                    return;
                };
                state = next;
            }
            state.phase = RuntimePhase::Closed;
            state.generation.take()
        };
        if let Some(generation) = generation {
            generation.shutdown();
        }
    }

    fn activity(&self) -> StoreRuntimeActivity {
        let Ok(state) = self.state.lock() else {
            return StoreRuntimeActivity {
                phase: StoreRuntimePhase::Maintenance,
                active_writes: 1,
                active_reads: 1,
                queued_writes: 1,
            };
        };
        let phase = match state.phase {
            RuntimePhase::Running => StoreRuntimePhase::Running,
            RuntimePhase::Maintenance => StoreRuntimePhase::Maintenance,
            RuntimePhase::Closed => StoreRuntimePhase::Closed,
        };
        let queued_writes = state
            .generation
            .as_ref()
            .and_then(|generation| generation.writer.as_ref())
            .map_or(0, |writer| {
                writer.endpoint.queued_jobs.load(Ordering::Acquire)
            });
        StoreRuntimeActivity {
            phase,
            active_writes: state.active_writes,
            active_reads: state.active_reads,
            queued_writes,
        }
    }

    fn metrics(&self) -> StoreRuntimeMetrics {
        StoreRuntimeMetrics {
            command_latency: self.command_latency.snapshot(),
        }
    }
}

#[derive(Clone, Copy)]
enum LeaseKind {
    Write,
    Read,
}

struct RuntimeLease {
    control: Arc<RuntimeControl>,
    kind: LeaseKind,
}

impl RuntimeLease {
    fn write(control: Arc<RuntimeControl>) -> Self {
        Self {
            control,
            kind: LeaseKind::Write,
        }
    }

    fn read(control: Arc<RuntimeControl>) -> Self {
        Self {
            control,
            kind: LeaseKind::Read,
        }
    }
}

impl Drop for RuntimeLease {
    fn drop(&mut self) {
        self.control.release(self.kind);
    }
}

pub struct StoreRuntime {
    control: Arc<RuntimeControl>,
}

impl StoreRuntime {
    pub fn start(
        path: &Path,
        writer_queue_capacity: usize,
        read_connections: usize,
    ) -> Result<Self, StoreError> {
        Ok(Self {
            control: RuntimeControl::new(
                path,
                Some(writer_queue_capacity),
                Some(read_connections),
            )?,
        })
    }

    fn start_writer(path: &Path, writer_queue_capacity: usize) -> Result<Self, StoreError> {
        Ok(Self {
            control: RuntimeControl::new(path, Some(writer_queue_capacity), None)?,
        })
    }

    pub fn writer(&self) -> StoreWriter {
        StoreWriter {
            control: Arc::clone(&self.control),
        }
    }

    pub fn readers(&self) -> StoreReaders {
        StoreReaders {
            control: Arc::clone(&self.control),
        }
    }

    pub fn maintenance(&self) -> StoreMaintenance {
        StoreMaintenance {
            control: Arc::clone(&self.control),
        }
    }

    pub fn activity(&self) -> StoreRuntimeActivity {
        self.control.activity()
    }

    pub fn metrics(&self) -> StoreRuntimeMetrics {
        self.control.metrics()
    }
}

impl Drop for StoreRuntime {
    fn drop(&mut self) {
        self.control.close();
    }
}

#[derive(Clone)]
pub struct StoreWriter {
    control: Arc<RuntimeControl>,
}

impl StoreWriter {
    pub fn call<T: Send + 'static>(
        &self,
        operation: impl FnOnce(&mut Connection) -> Result<T, StoreError> + Send + 'static,
    ) -> Result<T, StoreError> {
        self.call_with_budget(DEFAULT_QUERY_BUDGET, QueryCancellation::new(), operation)
    }

    pub fn call_with_budget<T: Send + 'static>(
        &self,
        budget: Duration,
        cancellation: QueryCancellation,
        operation: impl FnOnce(&mut Connection) -> Result<T, StoreError> + Send + 'static,
    ) -> Result<T, StoreError> {
        let (endpoint, _lease) = self.control.acquire_writer()?;
        let started_at = Instant::now();
        let writer_command_id = format!(
            "writer:{}:{}",
            std::process::id(),
            NEXT_WRITER_COMMAND_ID.fetch_add(1, Ordering::Relaxed)
        );
        let parent = tracing::Span::current();
        let command_span = tracing::debug_span!(
            parent: &parent,
            "sqlite_writer_command",
            writerCommandId = %writer_command_id,
        );
        let rejected_span = command_span.clone();
        let (result_sender, result_receiver) = mpsc::sync_channel(1);
        let queued_jobs = Arc::clone(&endpoint.queued_jobs);
        let queued_at = Instant::now();
        let job = Box::new(move |connection: &mut Connection| {
            command_span.in_scope(|| {
                queued_jobs.fetch_sub(1, Ordering::AcqRel);
                let queue_wait_ms =
                    u64::try_from(queued_at.elapsed().as_millis()).unwrap_or(u64::MAX);
                let operation_started_at = Instant::now();
                let result = with_mut_query_budget(connection, budget, &cancellation, operation);
                let duration_ms =
                    u64::try_from(operation_started_at.elapsed().as_millis()).unwrap_or(u64::MAX);
                match &result {
                    Ok(_) => tracing::debug!(
                        queueWaitMs = queue_wait_ms,
                        durationMs = duration_ms,
                        status = "ok",
                        "SQLite writer command completed"
                    ),
                    Err(error) => tracing::debug!(
                        queueWaitMs = queue_wait_ms,
                        durationMs = duration_ms,
                        status = "error",
                        errorCode = store_error_code_name(error.code),
                        "SQLite writer command completed"
                    ),
                }
                let _ = result_sender.send(result);
            });
        });
        endpoint.queued_jobs.fetch_add(1, Ordering::AcqRel);
        endpoint
            .sender
            .try_send(WriterMessage::Run(job))
            .map_err(|error| {
                endpoint.queued_jobs.fetch_sub(1, Ordering::AcqRel);
                let error = match error {
                    TrySendError::Full(_) => StoreError::new(
                        StoreErrorCode::WriterQueueFull,
                        "SQLite writer queue is full",
                        true,
                    ),
                    TrySendError::Disconnected(_) => writer_closed(),
                };
                rejected_span.in_scope(|| {
                    tracing::warn!(
                        status = "rejected",
                        errorCode = store_error_code_name(error.code),
                        "SQLite writer command rejected"
                    );
                });
                error
            })?;
        let result = result_receiver.recv().map_err(|_| {
            StoreError::new(
                StoreErrorCode::WriterClosed,
                "SQLite writer stopped before returning a result",
                true,
            )
        });
        self.control.command_latency.record(started_at.elapsed());
        result?
    }

    pub fn queued_job_count(&self) -> usize {
        let Ok(state) = self.control.state.lock() else {
            return 0;
        };
        state
            .generation
            .as_ref()
            .and_then(|generation| generation.writer.as_ref())
            .map_or(0, |writer| {
                writer.endpoint.queued_jobs.load(Ordering::Acquire)
            })
    }
}

fn store_error_code_name(code: StoreErrorCode) -> &'static str {
    match code {
        StoreErrorCode::AlreadyOwned => "already_owned",
        StoreErrorCode::Conflict => "conflict",
        StoreErrorCode::GenerationConflict => "generation_conflict",
        StoreErrorCode::HeadConflict => "head_conflict",
        StoreErrorCode::IdempotencyKeyReused => "idempotency_key_reused",
        StoreErrorCode::ProtectedOwnerDeletion => "protected_owner_deletion",
        StoreErrorCode::InvalidInput => "invalid_input",
        StoreErrorCode::InvalidProfile => "invalid_profile",
        StoreErrorCode::MissingDependencies => "missing_dependencies",
        StoreErrorCode::NotFound => "not_found",
        StoreErrorCode::RevisionConflict => "revision_conflict",
        StoreErrorCode::StaleStoreEpoch => "stale_store_epoch",
        StoreErrorCode::Unauthorized => "unauthorized",
        StoreErrorCode::ResourceExhausted => "resource_exhausted",
        StoreErrorCode::WriterQueueFull => "writer_queue_full",
        StoreErrorCode::WriterClosed => "writer_closed",
        StoreErrorCode::ReaderPoolTimeout => "reader_pool_timeout",
        StoreErrorCode::QueryCancelled => "query_cancelled",
        StoreErrorCode::SqliteBusy => "sqlite_busy",
        StoreErrorCode::SqliteFailure => "sqlite_failure",
        StoreErrorCode::RuntimeIncompatible => "runtime_incompatible",
        StoreErrorCode::UnsupportedSchema => "unsupported_schema",
        StoreErrorCode::StoreCorrupt => "store_corrupt",
        StoreErrorCode::MaintenanceInProgress => "maintenance_in_progress",
        StoreErrorCode::Internal => "internal",
    }
}

pub struct StoreWriterRuntime {
    runtime: StoreRuntime,
}

impl StoreWriterRuntime {
    pub fn start(path: &Path, queue_capacity: usize) -> Result<Self, StoreError> {
        Ok(Self {
            runtime: StoreRuntime::start_writer(path, queue_capacity)?,
        })
    }

    pub fn handle(&self) -> StoreWriter {
        self.runtime.writer()
    }
}

#[derive(Clone)]
pub struct StoreReaders {
    control: Arc<RuntimeControl>,
}

impl StoreReaders {
    pub fn new(path: &Path, max_connections: usize) -> Result<Self, StoreError> {
        Ok(Self {
            control: RuntimeControl::new(path, None, Some(max_connections))?,
        })
    }

    pub fn read<T>(
        &self,
        budget: Duration,
        cancellation: &QueryCancellation,
        operation: impl FnOnce(&Connection) -> Result<T, StoreError>,
    ) -> Result<T, StoreError> {
        let (pool, _lease) = self.control.acquire_reader()?;
        let connection = pool.checkout()?;
        let result = with_query_budget(&connection, budget, cancellation, operation);
        pool.checkin(connection);
        result
    }

    pub fn read_default<T>(
        &self,
        operation: impl FnOnce(&Connection) -> Result<T, StoreError>,
    ) -> Result<T, StoreError> {
        self.read(DEFAULT_QUERY_BUDGET, &QueryCancellation::new(), operation)
    }
}

#[derive(Clone)]
pub struct StoreMaintenance {
    control: Arc<RuntimeControl>,
}

impl StoreMaintenance {
    pub fn run<T>(
        &self,
        operation: impl FnOnce(&Path) -> Result<T, StoreError>,
    ) -> Result<T, StoreError> {
        let generation = self.control.begin_maintenance()?;
        generation.shutdown();
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            operation(&self.control.path)
        }));
        let resume = self.control.resume();
        match result {
            Ok(operation_result) => {
                resume?;
                operation_result
            }
            Err(payload) => {
                let _ = resume;
                std::panic::resume_unwind(payload)
            }
        }
    }
}

fn poisoned_pool() -> StoreError {
    internal("SQLite read pool synchronization failed")
}

fn poisoned_runtime() -> StoreError {
    internal("SQLite runtime synchronization failed")
}

fn maintenance_in_progress() -> StoreError {
    StoreError::new(
        StoreErrorCode::MaintenanceInProgress,
        "The SQLite store is temporarily unavailable for maintenance",
        true,
    )
}

fn writer_closed() -> StoreError {
    StoreError::new(
        StoreErrorCode::WriterClosed,
        "SQLite writer is unavailable",
        true,
    )
}

fn reader_closed() -> StoreError {
    StoreError::new(
        StoreErrorCode::ReaderPoolTimeout,
        "SQLite readers are unavailable",
        true,
    )
}

fn internal(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::Internal, message, false)
}

#[cfg(test)]
mod tests {
    use std::sync::mpsc;
    use std::thread;

    use tempfile::tempdir;

    use crate::infrastructure::sqlite::with_immediate_transaction;

    use super::*;

    #[test]
    fn dedicated_writer_serializes_jobs_and_readers_are_query_only() {
        let directory = tempdir().expect("store");
        let path = directory.path().join("nodex.db");
        let runtime = StoreWriterRuntime::start(&path, DEFAULT_WRITER_QUEUE_CAPACITY)
            .expect("writer runtime");
        let caller_thread = thread::current().id();
        let writer_thread = runtime
            .handle()
            .call(move |connection| {
                assert_ne!(thread::current().id(), caller_thread);
                with_immediate_transaction(connection, |transaction| {
                    transaction.execute_batch(
                        "CREATE TABLE ordered_values(position INTEGER PRIMARY KEY, value TEXT NOT NULL);\n\
                         INSERT INTO ordered_values(position, value) VALUES (1, 'first');",
                    )?;
                    Ok(thread::current().id())
                })
            })
            .expect("writer job");
        assert_ne!(writer_thread, thread::current().id());
        runtime
            .handle()
            .call(|connection| {
                connection.execute(
                    "INSERT INTO ordered_values(position, value) VALUES (2, 'second')",
                    [],
                )?;
                Ok(())
            })
            .expect("second writer job");
        let command_latency = runtime.runtime.metrics().command_latency;
        assert_eq!(command_latency.count, 2);
        assert!(command_latency.total_micros >= command_latency.last_micros);

        let readers = StoreReaders::new(&path, 2).expect("read pool");
        let values = readers
            .read_default(|connection| {
                let values = connection
                    .prepare("SELECT value FROM ordered_values ORDER BY position")?
                    .query_map([], |row| row.get::<_, String>(0))?
                    .collect::<rusqlite::Result<Vec<_>>>()?;
                assert!(
                    connection
                        .execute("DELETE FROM ordered_values", [])
                        .is_err()
                );
                Ok(values)
            })
            .expect("read values");
        assert_eq!(values, vec!["first", "second"]);
    }

    #[test]
    fn bounded_writer_queue_rejects_excess_work() {
        let directory = tempdir().expect("store");
        let path = directory.path().join("nodex.db");
        let runtime = StoreWriterRuntime::start(&path, 1).expect("writer runtime");
        let writer = runtime.handle();
        let (entered_sender, entered_receiver) = mpsc::sync_channel(1);
        let (release_sender, release_receiver) = mpsc::sync_channel(1);
        let first_writer = writer.clone();
        let first = thread::spawn(move || {
            first_writer.call(move |_| {
                entered_sender.send(()).expect("entered signal");
                release_receiver.recv().expect("release signal");
                Ok(())
            })
        });
        entered_receiver.recv().expect("first job entered");

        let second_writer = writer.clone();
        let second = thread::spawn(move || second_writer.call(|_| Ok(())));
        while writer.queued_job_count() != 1 {
            thread::yield_now();
        }
        let saturated = writer
            .call(|_| Ok::<_, StoreError>(()))
            .expect_err("third job exceeds queue capacity");
        assert_eq!(saturated.code, StoreErrorCode::WriterQueueFull);
        release_sender.send(()).expect("release first");
        assert!(first.join().expect("first join").is_ok());
        assert!(second.join().expect("second join").is_ok());
    }

    #[test]
    fn maintenance_drains_closes_rejects_and_reuses_stable_handles() {
        let directory = tempdir().expect("store");
        let path = directory.path().join("nodex.db");
        let runtime = StoreRuntime::start(&path, 4, 2).expect("restartable runtime");
        let writer = runtime.writer();
        let readers = runtime.readers();
        let maintenance = runtime.maintenance();
        writer
            .call(|connection| {
                connection.execute_batch(
                    "CREATE TABLE generation_values(value TEXT NOT NULL);\n\
                     INSERT INTO generation_values(value) VALUES ('before');",
                )?;
                Ok(())
            })
            .expect("seed store");

        let writer_during = writer.clone();
        let readers_during = readers.clone();
        maintenance
            .run(|database_path| {
                let writer_error = writer_during
                    .call(|_| Ok(()))
                    .expect_err("writer fenced during maintenance");
                assert_eq!(writer_error.code, StoreErrorCode::MaintenanceInProgress);
                let reader_error = readers_during
                    .read_default(|_| Ok(()))
                    .expect_err("reader fenced during maintenance");
                assert_eq!(reader_error.code, StoreErrorCode::MaintenanceInProgress);

                let connection = open_writer(database_path)?;
                connection.execute(
                    "INSERT INTO generation_values(value) VALUES ('maintenance')",
                    [],
                )?;
                Ok(())
            })
            .expect("maintenance");

        writer
            .call(|connection| {
                connection.execute("INSERT INTO generation_values(value) VALUES ('after')", [])?;
                Ok(())
            })
            .expect("writer resumed");
        let values = readers
            .read_default(|connection| {
                connection
                    .prepare("SELECT value FROM generation_values ORDER BY rowid")?
                    .query_map([], |row| row.get::<_, String>(0))?
                    .collect::<rusqlite::Result<Vec<_>>>()
                    .map_err(Into::into)
            })
            .expect("read replacement generation");
        assert_eq!(values, ["before", "maintenance", "after"]);
    }

    #[test]
    fn maintenance_waits_for_every_accepted_read_and_write() {
        let directory = tempdir().expect("store");
        let path = directory.path().join("nodex.db");
        let runtime = StoreRuntime::start(&path, 4, 2).expect("restartable runtime");
        let writer = runtime.writer();
        let readers = runtime.readers();
        writer
            .call(|connection| {
                connection.execute_batch("CREATE TABLE drain_probe(value INTEGER NOT NULL);")?;
                Ok(())
            })
            .expect("probe table");

        let (write_entered_sender, write_entered_receiver) = mpsc::sync_channel(1);
        let (write_release_sender, write_release_receiver) = mpsc::sync_channel(1);
        let active_writer = writer.clone();
        let write = thread::spawn(move || {
            active_writer.call(move |_| {
                write_entered_sender.send(()).expect("write entered");
                write_release_receiver.recv().expect("write release");
                Ok(())
            })
        });
        write_entered_receiver.recv().expect("accepted writer");

        let (read_entered_sender, read_entered_receiver) = mpsc::sync_channel(1);
        let (read_release_sender, read_release_receiver) = mpsc::sync_channel(1);
        let active_readers = readers.clone();
        let read = thread::spawn(move || {
            active_readers.read_default(move |_| {
                read_entered_sender.send(()).expect("read entered");
                read_release_receiver.recv().expect("read release");
                Ok(())
            })
        });
        read_entered_receiver.recv().expect("accepted reader");

        let maintenance = runtime.maintenance();
        let maintenance_control = Arc::clone(&maintenance.control);
        let (maintenance_entered_sender, maintenance_entered_receiver) = mpsc::sync_channel(1);
        let maintenance_thread = thread::spawn(move || {
            maintenance.run(|_| {
                maintenance_entered_sender
                    .send(())
                    .expect("maintenance entered");
                Ok(())
            })
        });
        loop {
            let phase = maintenance_control
                .state
                .lock()
                .expect("runtime state")
                .phase;
            if phase == RuntimePhase::Maintenance {
                break;
            }
            thread::yield_now();
        }
        assert!(matches!(
            maintenance_entered_receiver.try_recv(),
            Err(mpsc::TryRecvError::Empty)
        ));
        assert_eq!(
            writer.call(|_| Ok(())).expect_err("new write fenced").code,
            StoreErrorCode::MaintenanceInProgress
        );
        assert_eq!(
            readers
                .read_default(|_| Ok(()))
                .expect_err("new read fenced")
                .code,
            StoreErrorCode::MaintenanceInProgress
        );

        write_release_sender.send(()).expect("release writer");
        assert!(write.join().expect("writer join").is_ok());
        assert!(matches!(
            maintenance_entered_receiver.try_recv(),
            Err(mpsc::TryRecvError::Empty)
        ));
        read_release_sender.send(()).expect("release reader");
        assert!(read.join().expect("reader join").is_ok());
        maintenance_entered_receiver
            .recv()
            .expect("maintenance starts after drain");
        assert!(maintenance_thread.join().expect("maintenance join").is_ok());
    }
}
