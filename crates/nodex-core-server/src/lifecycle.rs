use std::env;
use std::io;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use tokio::sync::{Notify, watch};

const DEFAULT_IDLE_TIMEOUT: Duration = Duration::from_secs(15 * 60);
const MAX_IDLE_TIMEOUT: Duration = Duration::from_secs(24 * 60 * 60);
const MAX_IDLE_POLL_INTERVAL: Duration = Duration::from_secs(1);
const MIN_IDLE_POLL_INTERVAL: Duration = Duration::from_millis(10);
const IDLE_TIMEOUT_ENV: &str = "NODEX_CORE_IDLE_TIMEOUT_MS";

struct LifecycleInner {
    draining: AtomicBool,
    activity_generation: Mutex<u64>,
    shutdown: Notify,
    stream_shutdown: watch::Sender<bool>,
}

#[derive(Clone)]
pub(crate) struct LifecycleCoordinator {
    inner: Arc<LifecycleInner>,
}

impl LifecycleCoordinator {
    pub(crate) fn new() -> Self {
        let (stream_shutdown, _) = watch::channel(false);
        Self {
            inner: Arc::new(LifecycleInner {
                draining: AtomicBool::new(false),
                activity_generation: Mutex::new(0),
                shutdown: Notify::new(),
                stream_shutdown,
            }),
        }
    }

    pub(crate) fn is_draining(&self) -> bool {
        self.inner.draining.load(Ordering::Acquire)
    }

    pub(crate) fn begin_drain(&self) -> bool {
        let Ok(_generation) = self.inner.activity_generation.lock() else {
            return false;
        };
        self.begin_drain_locked()
    }

    pub(crate) fn record_activity(&self) -> bool {
        let Ok(mut generation) = self.inner.activity_generation.lock() else {
            return false;
        };
        if self.is_draining() {
            return false;
        }
        let Some(next) = generation.checked_add(1) else {
            return false;
        };
        *generation = next;
        true
    }

    fn activity_generation(&self) -> Option<u64> {
        self.inner
            .activity_generation
            .lock()
            .ok()
            .map(|value| *value)
    }

    fn try_begin_idle_drain(&self, expected_generation: u64) -> bool {
        let Ok(generation) = self.inner.activity_generation.lock() else {
            return false;
        };
        if *generation != expected_generation {
            return false;
        }
        self.begin_drain_locked()
    }

    pub(crate) fn try_begin_idle_drain_if(&self, is_idle: impl FnOnce() -> bool) -> bool {
        let Ok(_generation) = self.inner.activity_generation.lock() else {
            return false;
        };
        if self.is_draining() || !is_idle() {
            return false;
        }
        self.begin_drain_locked()
    }

    fn begin_drain_locked(&self) -> bool {
        if self
            .inner
            .draining
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return false;
        }
        self.inner.stream_shutdown.send_replace(true);
        self.inner.shutdown.notify_one();
        true
    }

    pub(crate) fn subscribe_stream_shutdown(&self) -> watch::Receiver<bool> {
        self.inner.stream_shutdown.subscribe()
    }

    pub(crate) async fn wait_for_stream_shutdown(receiver: &mut watch::Receiver<bool>) {
        if *receiver.borrow() {
            return;
        }
        let _ = receiver.changed().await;
    }

    pub(crate) async fn wait_for_drain(&self) {
        if self.is_draining() {
            return;
        }
        self.inner.shutdown.notified().await;
    }
}

pub(crate) fn configured_idle_timeout() -> io::Result<Option<Duration>> {
    let Some(value) = env::var_os(IDLE_TIMEOUT_ENV) else {
        return Ok(Some(DEFAULT_IDLE_TIMEOUT));
    };
    let value = value
        .to_str()
        .ok_or_else(|| invalid_idle_timeout("must be valid UTF-8"))?;
    let milliseconds = value
        .parse::<u64>()
        .map_err(|_| invalid_idle_timeout("must be a non-negative integer"))?;
    if milliseconds == 0 {
        return Ok(None);
    }
    let timeout = Duration::from_millis(milliseconds);
    if timeout > MAX_IDLE_TIMEOUT {
        return Err(invalid_idle_timeout("exceeds the 24-hour maximum"));
    }
    Ok(Some(timeout))
}

pub(crate) async fn monitor_idle(
    coordinator: LifecycleCoordinator,
    timeout: Duration,
    mut is_idle: impl FnMut() -> bool,
) {
    let poll_interval = timeout
        .checked_div(4)
        .unwrap_or(MIN_IDLE_POLL_INTERVAL)
        .clamp(MIN_IDLE_POLL_INTERVAL, MAX_IDLE_POLL_INTERVAL);
    let mut interval = tokio::time::interval(poll_interval);
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut idle_since = None::<(Instant, u64)>;
    loop {
        interval.tick().await;
        if coordinator.is_draining() {
            return;
        }
        let Some(generation) = coordinator.activity_generation() else {
            idle_since = None;
            continue;
        };
        if !is_idle() {
            idle_since = None;
            continue;
        }
        let (since, observed_generation) = idle_since.get_or_insert((Instant::now(), generation));
        if *observed_generation != generation {
            idle_since = Some((Instant::now(), generation));
            continue;
        }
        if since.elapsed() < timeout {
            continue;
        }
        if coordinator.try_begin_idle_drain(generation) {
            tracing::info!(reason = "idle_timeout", "Core drain began");
            return;
        }
        idle_since = None;
    }
}

fn invalid_idle_timeout(reason: &str) -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidInput,
        format!("{IDLE_TIMEOUT_ENV} {reason}"),
    )
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicUsize;

    use super::*;

    #[tokio::test]
    async fn idle_monitor_resets_the_full_period_after_activity() {
        let coordinator = LifecycleCoordinator::new();
        let checks = Arc::new(AtomicUsize::new(0));
        let observed = Arc::clone(&checks);
        let task = tokio::spawn(monitor_idle(
            coordinator.clone(),
            Duration::from_millis(60),
            move || {
                let check = observed.fetch_add(1, Ordering::AcqRel);
                check != 2
            },
        ));
        tokio::time::sleep(Duration::from_millis(80)).await;
        assert!(!coordinator.is_draining());
        tokio::time::sleep(Duration::from_millis(80)).await;
        assert!(coordinator.is_draining());
        task.await.expect("idle monitor");
    }

    #[tokio::test]
    async fn stream_subscriber_created_after_drain_observes_shutdown() {
        let coordinator = LifecycleCoordinator::new();
        assert!(coordinator.begin_drain());
        let mut receiver = coordinator.subscribe_stream_shutdown();

        tokio::time::timeout(
            Duration::from_millis(20),
            LifecycleCoordinator::wait_for_stream_shutdown(&mut receiver),
        )
        .await
        .expect("already-draining stream shutdown remains observable");
    }
}
