use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::http::HeaderMap;
use nodex_core::infrastructure::metrics::{DurationMetric, DurationMetricSnapshot};
use nodex_core::infrastructure::request_execution::{
    RequestExecutionContext, within_request_execution,
};
use nodex_core::infrastructure::sqlite::QueryCancellation;
use nodex_core_contracts::{CoreError, CoreErrorCode, CoreErrorRecovery};
use nodex_core_protocol::{
    BACKGROUND_REQUEST_DEADLINE_MS, CoreRequestClass as RequestClass,
    INTERACTIVE_REQUEST_DEADLINE_MS, MAINTENANCE_REQUEST_DEADLINE_MS, MAX_REQUEST_DEADLINE_MS,
    MIN_REQUEST_DEADLINE_MS,
};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

pub(crate) const REQUEST_ID_HEADER: &str = "x-nodex-request-id";
pub(crate) const REQUEST_CLASS_HEADER: &str = "x-nodex-request-class";
pub(crate) const REQUEST_DEADLINE_HEADER: &str = "x-nodex-request-deadline-ms";

const TOTAL_EXECUTION_CAPACITY: usize = 4;
const BACKGROUND_EXECUTION_CAPACITY: usize = TOTAL_EXECUTION_CAPACITY - 1;
const MAINTENANCE_EXECUTION_CAPACITY: usize = 1;
const ADMISSION_CAPACITY: usize = 128;
const CANCELLATION_POLL_INTERVAL: Duration = Duration::from_millis(10);
const CANCELLATION_TOMBSTONE_TTL: Duration = Duration::from_secs(60);
const MAX_CANCELLATION_TOMBSTONES: usize = 4_096;

static NEXT_REQUEST_ID: AtomicU64 = AtomicU64::new(1);

fn parse_request_class(value: &str) -> Option<RequestClass> {
    match value {
        "interactive" => Some(RequestClass::Interactive),
        "background" => Some(RequestClass::Background),
        "maintenance" => Some(RequestClass::Maintenance),
        _ => None,
    }
}

fn default_deadline(class: RequestClass) -> Duration {
    match class {
        RequestClass::Interactive => Duration::from_millis(INTERACTIVE_REQUEST_DEADLINE_MS),
        RequestClass::Background => Duration::from_millis(BACKGROUND_REQUEST_DEADLINE_MS),
        RequestClass::Maintenance => Duration::from_millis(MAINTENANCE_REQUEST_DEADLINE_MS),
    }
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct RequestKey {
    connection_id: String,
    request_id: String,
}

struct ActiveRequestGuard {
    registry: Arc<Mutex<RequestRegistry>>,
    key: RequestKey,
}

impl Drop for ActiveRequestGuard {
    fn drop(&mut self) {
        let Ok(mut registry) = self.registry.lock() else {
            return;
        };
        registry.active.remove(&self.key);
    }
}

#[derive(Default)]
struct RequestRegistry {
    active: HashMap<RequestKey, QueryCancellation>,
    cancellation_tombstones: HashMap<RequestKey, Instant>,
}

impl RequestRegistry {
    fn prune_tombstones(&mut self, now: Instant) {
        self.cancellation_tombstones
            .retain(|_, expires_at| *expires_at > now);
    }
}

struct ExecutionPermits {
    _admission: OwnedSemaphorePermit,
    _class: Option<OwnedSemaphorePermit>,
    _maintenance: Option<OwnedSemaphorePermit>,
    _total: OwnedSemaphorePermit,
}

#[derive(Clone)]
pub(crate) struct RequestExecutor {
    total: Arc<Semaphore>,
    background: Arc<Semaphore>,
    maintenance: Arc<Semaphore>,
    admission: Arc<Semaphore>,
    registry: Arc<Mutex<RequestRegistry>>,
    metrics: Arc<RequestExecutorMetrics>,
    total_capacity: usize,
}

#[derive(Default)]
struct RequestExecutorMetrics {
    admission_wait: DurationMetric,
    execution_duration: DurationMetric,
    deadline_exceeded: AtomicU64,
    cancelled: AtomicU64,
    overloaded: AtomicU64,
}

pub(crate) struct RequestExecutorSnapshot {
    pub(crate) active: u64,
    pub(crate) queued: u64,
    pub(crate) admission_wait: DurationMetricSnapshot,
    pub(crate) execution_duration: DurationMetricSnapshot,
    pub(crate) deadline_exceeded: u64,
    pub(crate) cancelled: u64,
    pub(crate) overloaded: u64,
}

impl RequestExecutor {
    pub(crate) fn new() -> Self {
        Self::with_capacities(
            TOTAL_EXECUTION_CAPACITY,
            BACKGROUND_EXECUTION_CAPACITY,
            MAINTENANCE_EXECUTION_CAPACITY,
            ADMISSION_CAPACITY,
        )
    }

    fn with_capacities(
        total: usize,
        background: usize,
        maintenance: usize,
        admission: usize,
    ) -> Self {
        Self {
            total: Arc::new(Semaphore::new(total)),
            background: Arc::new(Semaphore::new(background)),
            maintenance: Arc::new(Semaphore::new(maintenance)),
            admission: Arc::new(Semaphore::new(admission)),
            registry: Arc::new(Mutex::new(RequestRegistry::default())),
            metrics: Arc::new(RequestExecutorMetrics::default()),
            total_capacity: total,
        }
    }

    pub(crate) async fn execute<T>(
        &self,
        connection_id: &str,
        headers: &HeaderMap,
        default_class: RequestClass,
        operation: impl FnOnce() -> Result<T, CoreError> + Send + 'static,
    ) -> Result<T, CoreError>
    where
        T: Send + 'static,
    {
        let spec = RequestSpec::from_headers(connection_id, headers, default_class)?;
        let cancellation = QueryCancellation::new();
        let guard = self.register(&spec.key, &cancellation)?;
        if cancellation.is_cancelled() {
            let error = cancelled();
            self.record_error(&error);
            return Err(error);
        }
        let admitted_at = Instant::now();
        let admission = self.admission.clone().try_acquire_owned().map_err(|_| {
            self.metrics.overloaded.fetch_add(1, Ordering::Relaxed);
            overloaded()
        })?;
        let permits = match self
            .acquire_permits(spec.class, spec.deadline, &cancellation, admission)
            .await
        {
            Ok(permits) => permits,
            Err(error) => {
                self.record_error(&error);
                return Err(error);
            }
        };
        if cancellation.is_cancelled() {
            let error = cancelled();
            self.record_error(&error);
            return Err(error);
        }
        self.metrics.admission_wait.record(admitted_at.elapsed());
        let context = RequestExecutionContext::new(cancellation.clone(), spec.deadline);
        let metrics = Arc::clone(&self.metrics);
        let request_span = tracing::Span::current();
        let mut worker = tokio::task::spawn_blocking(move || {
            let _guard = guard;
            let _permits = permits;
            let started_at = Instant::now();
            // Tokio blocking workers do not inherit the async task's tracing
            // span. Carry it explicitly so SQLite work remains correlated with
            // the request, operation, and receipt that caused it.
            let result = request_span.in_scope(|| within_request_execution(context, operation));
            metrics.execution_duration.record(started_at.elapsed());
            result
        });

        loop {
            let remaining = spec.deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                cancellation.cancel();
                let error = deadline_exceeded();
                self.record_error(&error);
                return Err(error);
            }
            tokio::select! {
                result = &mut worker => {
                    let result = result.map_err(|error| worker_failed(&error.to_string()))?;
                    if let Err(error) = &result {
                        self.record_error(error);
                    }
                    return result;
                }
                () = tokio::time::sleep(remaining) => {
                    cancellation.cancel();
                    let error = deadline_exceeded();
                    self.record_error(&error);
                    return Err(error);
                }
                () = tokio::time::sleep(CANCELLATION_POLL_INTERVAL) => {
                    if cancellation.is_cancelled() {
                        let error = cancelled();
                        self.record_error(&error);
                        return Err(error);
                    }
                }
            }
        }
    }

    pub(crate) fn cancel(&self, connection_id: &str, request_id: &str) -> bool {
        let key = RequestKey {
            connection_id: connection_id.to_owned(),
            request_id: request_id.to_owned(),
        };
        let Ok(mut registry) = self.registry.lock() else {
            return false;
        };
        registry.prune_tombstones(Instant::now());
        if let Some(cancellation) = registry.active.get(&key) {
            cancellation.cancel();
            return true;
        }
        if registry.cancellation_tombstones.len() >= MAX_CANCELLATION_TOMBSTONES {
            return false;
        }
        registry
            .cancellation_tombstones
            .insert(key, Instant::now() + CANCELLATION_TOMBSTONE_TTL);
        true
    }

    pub(crate) fn snapshot(&self) -> RequestExecutorSnapshot {
        let active = self
            .total_capacity
            .saturating_sub(self.total.available_permits());
        let registered = self
            .registry
            .lock()
            .map_or(0, |registry| registry.active.len());
        RequestExecutorSnapshot {
            active: u64::try_from(active).unwrap_or(u64::MAX),
            queued: u64::try_from(registered.saturating_sub(active)).unwrap_or(u64::MAX),
            admission_wait: self.metrics.admission_wait.snapshot(),
            execution_duration: self.metrics.execution_duration.snapshot(),
            deadline_exceeded: self.metrics.deadline_exceeded.load(Ordering::Relaxed),
            cancelled: self.metrics.cancelled.load(Ordering::Relaxed),
            overloaded: self.metrics.overloaded.load(Ordering::Relaxed),
        }
    }

    fn record_error(&self, error: &CoreError) {
        let counter = match error.code {
            CoreErrorCode::DeadlineExceeded => Some(&self.metrics.deadline_exceeded),
            CoreErrorCode::Cancelled => Some(&self.metrics.cancelled),
            CoreErrorCode::Overloaded => Some(&self.metrics.overloaded),
            _ => None,
        };
        if let Some(counter) = counter {
            counter.fetch_add(1, Ordering::Relaxed);
        }
    }

    fn register(
        &self,
        key: &RequestKey,
        cancellation: &QueryCancellation,
    ) -> Result<ActiveRequestGuard, CoreError> {
        let mut registry = self
            .registry
            .lock()
            .map_err(|_| worker_failed("registry"))?;
        registry.prune_tombstones(Instant::now());
        if registry.active.contains_key(key) {
            return Err(active_request_conflict());
        }
        let cancelled_before_registration = registry.cancellation_tombstones.remove(key).is_some();
        registry.active.insert(key.clone(), cancellation.clone());
        if cancelled_before_registration {
            cancellation.cancel();
        }
        Ok(ActiveRequestGuard {
            registry: Arc::clone(&self.registry),
            key: key.clone(),
        })
    }

    async fn acquire_permits(
        &self,
        class: RequestClass,
        deadline: Instant,
        cancellation: &QueryCancellation,
        admission: OwnedSemaphorePermit,
    ) -> Result<ExecutionPermits, CoreError> {
        let maintenance = match class {
            RequestClass::Maintenance => {
                Some(acquire(Arc::clone(&self.maintenance), deadline, cancellation).await?)
            }
            RequestClass::Interactive | RequestClass::Background => None,
        };
        let class_permit = match class {
            RequestClass::Interactive => None,
            RequestClass::Background | RequestClass::Maintenance => {
                Some(acquire(Arc::clone(&self.background), deadline, cancellation).await?)
            }
        };
        let total = acquire(Arc::clone(&self.total), deadline, cancellation).await?;
        Ok(ExecutionPermits {
            _admission: admission,
            _class: class_permit,
            _maintenance: maintenance,
            _total: total,
        })
    }
}

struct RequestSpec {
    key: RequestKey,
    class: RequestClass,
    deadline: Instant,
}

impl RequestSpec {
    fn from_headers(
        connection_id: &str,
        headers: &HeaderMap,
        default_class: RequestClass,
    ) -> Result<Self, CoreError> {
        let request_id = header(headers, REQUEST_ID_HEADER)?
            .map(str::to_owned)
            .unwrap_or_else(|| format!("core-{}", NEXT_REQUEST_ID.fetch_add(1, Ordering::Relaxed)));
        if request_id.is_empty() || request_id.len() > 128 || request_id.trim() != request_id {
            return Err(invalid_request("Core request ID is invalid"));
        }
        let class = header(headers, REQUEST_CLASS_HEADER)?
            .map(|value| {
                parse_request_class(value)
                    .ok_or_else(|| invalid_request("Core request class is invalid"))
            })
            .transpose()?
            .unwrap_or(default_class);
        let deadline_duration = header(headers, REQUEST_DEADLINE_HEADER)?
            .map(|value| {
                value
                    .parse::<u64>()
                    .ok()
                    .map(Duration::from_millis)
                    .filter(|value| {
                        *value >= Duration::from_millis(MIN_REQUEST_DEADLINE_MS)
                            && *value <= Duration::from_millis(MAX_REQUEST_DEADLINE_MS)
                    })
                    .ok_or_else(|| invalid_request("Core request deadline is invalid"))
            })
            .transpose()?
            .unwrap_or_else(|| default_deadline(class));
        Ok(Self {
            key: RequestKey {
                connection_id: connection_id.to_owned(),
                request_id,
            },
            class,
            deadline: Instant::now() + deadline_duration,
        })
    }
}

async fn acquire(
    semaphore: Arc<Semaphore>,
    deadline: Instant,
    cancellation: &QueryCancellation,
) -> Result<OwnedSemaphorePermit, CoreError> {
    loop {
        if cancellation.is_cancelled() {
            return Err(cancelled());
        }
        if Instant::now() >= deadline {
            return Err(deadline_exceeded());
        }
        match semaphore.clone().try_acquire_owned() {
            Ok(permit) => return Ok(permit),
            Err(tokio::sync::TryAcquireError::Closed) => {
                return Err(worker_failed("execution semaphore closed"));
            }
            Err(tokio::sync::TryAcquireError::NoPermits) => {
                tokio::time::sleep(CANCELLATION_POLL_INTERVAL).await;
            }
        }
    }
}

fn header<'a>(headers: &'a HeaderMap, name: &str) -> Result<Option<&'a str>, CoreError> {
    headers
        .get(name)
        .map(|value| {
            value
                .to_str()
                .map_err(|_| invalid_request("Core request header is invalid"))
        })
        .transpose()
}

fn invalid_request(message: &str) -> CoreError {
    CoreError {
        code: CoreErrorCode::InvalidInput,
        message: message.to_owned(),
        retryable: false,
        recovery: CoreErrorRecovery::None,
    }
}

fn active_request_conflict() -> CoreError {
    CoreError {
        code: CoreErrorCode::Conflict,
        message: "Core request ID is already active".to_owned(),
        retryable: true,
        recovery: CoreErrorRecovery::None,
    }
}

fn overloaded() -> CoreError {
    CoreError {
        code: CoreErrorCode::Overloaded,
        message: "Core request admission capacity is exhausted".to_owned(),
        retryable: true,
        recovery: CoreErrorRecovery::None,
    }
}

fn deadline_exceeded() -> CoreError {
    CoreError {
        code: CoreErrorCode::DeadlineExceeded,
        message: "Core request deadline was exceeded".to_owned(),
        retryable: true,
        recovery: CoreErrorRecovery::None,
    }
}

fn cancelled() -> CoreError {
    CoreError {
        code: CoreErrorCode::Cancelled,
        message: "Core request was cancelled".to_owned(),
        retryable: true,
        recovery: CoreErrorRecovery::None,
    }
}

fn worker_failed(detail: &str) -> CoreError {
    CoreError {
        code: CoreErrorCode::CoreUnavailable,
        message: format!("Core request worker failed: {detail}"),
        retryable: true,
        recovery: CoreErrorRecovery::None,
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::mpsc;

    use super::*;

    fn headers(request_id: &str, class: &str) -> HeaderMap {
        let mut headers = HeaderMap::new();
        headers.insert(REQUEST_ID_HEADER, request_id.parse().unwrap());
        headers.insert(REQUEST_CLASS_HEADER, class.parse().unwrap());
        headers.insert(REQUEST_DEADLINE_HEADER, "2000".parse().unwrap());
        headers
    }

    #[tokio::test]
    async fn reserves_execution_capacity_for_interactive_work() {
        let executor = RequestExecutor::with_capacities(2, 1, 1, 8);
        let (release_tx, release_rx) = mpsc::channel::<()>();
        let (started_tx, started_rx) = mpsc::channel::<()>();
        let background_executor = executor.clone();
        let background = tokio::spawn(async move {
            background_executor
                .execute(
                    "connection",
                    &headers("background", "background"),
                    RequestClass::Interactive,
                    move || {
                        started_tx.send(()).unwrap();
                        release_rx.recv().unwrap();
                        Ok(())
                    },
                )
                .await
        });
        tokio::time::timeout(Duration::from_secs(1), async {
            loop {
                if started_rx.try_recv().is_ok() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .unwrap();

        let result = executor
            .execute(
                "connection",
                &headers("interactive", "interactive"),
                RequestClass::Interactive,
                || Ok("ready"),
            )
            .await;

        assert_eq!(result.unwrap(), "ready");
        release_tx.send(()).unwrap();
        background.await.unwrap().unwrap();
    }

    #[tokio::test]
    async fn explicit_cancellation_reaches_running_sqlite_context() {
        let executor = RequestExecutor::with_capacities(1, 1, 1, 8);
        let worker_executor = executor.clone();
        let worker = tokio::spawn(async move {
            worker_executor
                .execute(
                    "connection",
                    &headers("cancel-me", "interactive"),
                    RequestClass::Interactive,
                    || {
                        while !nodex_core::infrastructure::request_execution::request_is_cancelled()
                        {
                            std::thread::yield_now();
                        }
                        Err::<(), _>(cancelled())
                    },
                )
                .await
        });
        tokio::time::sleep(Duration::from_millis(20)).await;

        assert!(executor.cancel("connection", "cancel-me"));
        assert_eq!(
            worker.await.unwrap().unwrap_err().code,
            CoreErrorCode::Cancelled
        );
    }

    #[tokio::test]
    async fn cancellation_before_request_registration_is_honored() {
        let executor = RequestExecutor::with_capacities(1, 1, 1, 8);
        let operation_ran = Arc::new(AtomicBool::new(false));
        let operation_ran_in_worker = Arc::clone(&operation_ran);
        assert!(executor.cancel("connection", "cancel-before-register"));

        let result = executor
            .execute(
                "connection",
                &headers("cancel-before-register", "interactive"),
                RequestClass::Interactive,
                move || {
                    operation_ran_in_worker.store(true, Ordering::Relaxed);
                    Ok::<_, CoreError>(())
                },
            )
            .await;

        assert_eq!(result.unwrap_err().code, CoreErrorCode::Cancelled);
        assert!(!operation_ran.load(Ordering::Relaxed));
    }

    #[test]
    fn duplicate_active_request_is_a_retryable_conflict() {
        let executor = RequestExecutor::with_capacities(1, 1, 1, 8);
        let key = RequestKey {
            connection_id: "connection".to_owned(),
            request_id: "duplicate".to_owned(),
        };
        let first_cancellation = QueryCancellation::new();
        let _first_guard = executor
            .register(&key, &first_cancellation)
            .expect("first request registration");

        let error = match executor.register(&key, &QueryCancellation::new()) {
            Ok(_) => panic!("duplicate request identity was accepted"),
            Err(error) => error,
        };

        assert_eq!(error.code, CoreErrorCode::Conflict);
        assert!(error.retryable);
    }
}
