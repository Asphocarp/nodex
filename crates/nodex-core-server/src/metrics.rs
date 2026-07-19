use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use nodex_core::infrastructure::metrics::{DurationMetric, DurationMetricSnapshot};

#[derive(Default)]
struct ServerMetricsInner {
    event_replay_lag: AtomicU64,
    event_replay_lag_max: AtomicU64,
    backup_duration: DurationMetric,
}

#[derive(Clone, Default)]
pub(crate) struct ServerMetrics {
    inner: Arc<ServerMetricsInner>,
}

impl ServerMetrics {
    pub(crate) fn record_event_replay_lag(&self, event_head: i64, requested_after: i64) {
        let lag =
            u64::try_from(event_head.saturating_sub(requested_after).max(0)).unwrap_or(u64::MAX);
        self.inner.event_replay_lag.store(lag, Ordering::Relaxed);
        self.inner
            .event_replay_lag_max
            .fetch_max(lag, Ordering::Relaxed);
    }

    pub(crate) fn event_replay_lag(&self) -> (u64, u64) {
        (
            self.inner.event_replay_lag.load(Ordering::Relaxed),
            self.inner.event_replay_lag_max.load(Ordering::Relaxed),
        )
    }

    pub(crate) fn record_backup_duration(&self, duration: Duration) {
        self.inner.backup_duration.record(duration);
    }

    pub(crate) fn backup_duration(&self) -> DurationMetricSnapshot {
        self.inner.backup_duration.snapshot()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn health_metrics_track_latest_and_max_event_lag_and_backup_timing() {
        let metrics = ServerMetrics::default();
        metrics.record_event_replay_lag(20, 5);
        metrics.record_event_replay_lag(22, 21);
        assert_eq!(metrics.event_replay_lag(), (1, 15));
        metrics.record_backup_duration(Duration::from_micros(9));
        assert_eq!(
            metrics.backup_duration(),
            DurationMetricSnapshot {
                count: 1,
                total_micros: 9,
                last_micros: 9,
                max_micros: 9,
            }
        );
    }
}
