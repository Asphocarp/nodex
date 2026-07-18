use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::{self, Receiver, SyncSender, TrySendError};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use rusqlite::Connection;

use super::sqlite::{
    DEFAULT_QUERY_BUDGET, QueryCancellation, StoreError, StoreErrorCode, open_reader, open_writer,
    with_mut_query_budget, with_query_budget,
};

pub const DEFAULT_WRITER_QUEUE_CAPACITY: usize = 64;
pub const DEFAULT_READ_CONNECTIONS: usize = 4;
const READER_WAIT_TIMEOUT: Duration = Duration::from_secs(5);

type WriterJob = Box<dyn FnOnce(&mut Connection) + Send + 'static>;

enum WriterMessage {
    Run(WriterJob),
    Shutdown,
}

#[derive(Clone)]
pub struct StoreWriter {
    sender: SyncSender<WriterMessage>,
    queued_jobs: Arc<AtomicUsize>,
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
        let (result_sender, result_receiver) = mpsc::sync_channel(1);
        let queued_jobs = Arc::clone(&self.queued_jobs);
        let job = Box::new(move |connection: &mut Connection| {
            queued_jobs.fetch_sub(1, Ordering::AcqRel);
            let result = with_mut_query_budget(connection, budget, &cancellation, operation);
            let _ = result_sender.send(result);
        });
        self.queued_jobs.fetch_add(1, Ordering::AcqRel);
        self.sender
            .try_send(WriterMessage::Run(job))
            .map_err(|error| {
                self.queued_jobs.fetch_sub(1, Ordering::AcqRel);
                match error {
                    TrySendError::Full(_) => StoreError::new(
                        StoreErrorCode::WriterQueueFull,
                        "SQLite writer queue is full",
                        true,
                    ),
                    TrySendError::Disconnected(_) => StoreError::new(
                        StoreErrorCode::WriterClosed,
                        "SQLite writer is unavailable",
                        true,
                    ),
                }
            })?;
        result_receiver.recv().map_err(|_| {
            StoreError::new(
                StoreErrorCode::WriterClosed,
                "SQLite writer stopped before returning a result",
                true,
            )
        })?
    }

    pub fn queued_job_count(&self) -> usize {
        self.queued_jobs.load(Ordering::Acquire)
    }
}

pub struct StoreWriterRuntime {
    handle: StoreWriter,
    join: Option<JoinHandle<()>>,
    shutdown: Arc<AtomicBool>,
}

impl StoreWriterRuntime {
    pub fn start(path: &Path, queue_capacity: usize) -> Result<Self, StoreError> {
        if queue_capacity == 0 {
            return Err(StoreError::new(
                StoreErrorCode::Internal,
                "SQLite writer queue capacity must be positive",
                false,
            ));
        }
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
            handle: StoreWriter {
                sender,
                queued_jobs,
            },
            join: Some(join),
            shutdown,
        })
    }

    pub fn handle(&self) -> StoreWriter {
        self.handle.clone()
    }
}

impl Drop for StoreWriterRuntime {
    fn drop(&mut self) {
        self.shutdown.store(true, Ordering::Release);
        let _ = self.handle.sender.try_send(WriterMessage::Shutdown);
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

#[derive(Clone)]
pub struct StoreReaders {
    inner: Arc<ReadPoolInner>,
}

impl StoreReaders {
    pub fn new(path: &Path, max_connections: usize) -> Result<Self, StoreError> {
        if max_connections == 0 {
            return Err(StoreError::new(
                StoreErrorCode::Internal,
                "SQLite reader pool size must be positive",
                false,
            ));
        }
        Ok(Self {
            inner: Arc::new(ReadPoolInner {
                path: path.to_owned(),
                max_connections,
                state: Mutex::new(ReadPoolState {
                    idle: Vec::new(),
                    total: 0,
                }),
                available: Condvar::new(),
            }),
        })
    }

    pub fn read<T>(
        &self,
        budget: Duration,
        cancellation: &QueryCancellation,
        operation: impl FnOnce(&Connection) -> Result<T, StoreError>,
    ) -> Result<T, StoreError> {
        let connection = self.checkout()?;
        let result = with_query_budget(&connection, budget, cancellation, operation);
        self.checkin(connection);
        result
    }

    pub fn read_default<T>(
        &self,
        operation: impl FnOnce(&Connection) -> Result<T, StoreError>,
    ) -> Result<T, StoreError> {
        self.read(DEFAULT_QUERY_BUDGET, &QueryCancellation::new(), operation)
    }

    fn checkout(&self) -> Result<Connection, StoreError> {
        let deadline = Instant::now() + READER_WAIT_TIMEOUT;
        let mut state = self.inner.state.lock().map_err(|_| poisoned_pool())?;
        loop {
            if let Some(connection) = state.idle.pop() {
                return Ok(connection);
            }
            if state.total < self.inner.max_connections {
                state.total += 1;
                drop(state);
                return match open_reader(&self.inner.path) {
                    Ok(connection) => Ok(connection),
                    Err(error) => {
                        let mut state = self.inner.state.lock().map_err(|_| poisoned_pool())?;
                        state.total -= 1;
                        self.inner.available.notify_one();
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
                .inner
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
        let Ok(mut state) = self.inner.state.lock() else {
            return;
        };
        state.idle.push(connection);
        self.inner.available.notify_one();
    }
}

fn poisoned_pool() -> StoreError {
    StoreError::new(
        StoreErrorCode::Internal,
        "SQLite read pool synchronization failed",
        false,
    )
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
}
