use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use nodex_core::infrastructure::metrics::{DurationMetric, DurationMetricSnapshot};

#[derive(Default)]
struct ServerMetricsInner {
    event_replay_lag: AtomicU64,
    event_replay_lag_max: AtomicU64,
    backup_duration: DurationMetric,
    local_commit_publication_duration: DurationMetric,
    canvas_sync_initial_snapshots: AtomicU64,
    canvas_sync_repair_snapshots: AtomicU64,
    canvas_sync_up_to_date: AtomicU64,
    canvas_sync_snapshot_bytes: AtomicU64,
}

#[derive(Clone, Default)]
pub(crate) struct ServerMetrics {
    inner: Arc<ServerMetricsInner>,
}

impl ServerMetrics {
    pub(crate) fn record_event_replay_lag(&self, commit_head: i64, requested_after: i64) {
        let lag =
            u64::try_from(commit_head.saturating_sub(requested_after).max(0)).unwrap_or(u64::MAX);
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

    pub(crate) fn record_local_commit_publication(&self, duration: Duration) {
        self.inner
            .local_commit_publication_duration
            .record(duration);
    }

    pub(crate) fn local_commit_publication_duration(&self) -> DurationMetricSnapshot {
        self.inner.local_commit_publication_duration.snapshot()
    }

    pub(crate) fn record_canvas_sync(&self, initial_snapshot: bool, snapshot_bytes: Option<usize>) {
        match snapshot_bytes {
            Some(bytes) => {
                let counter = if initial_snapshot {
                    &self.inner.canvas_sync_initial_snapshots
                } else {
                    &self.inner.canvas_sync_repair_snapshots
                };
                counter.fetch_add(1, Ordering::Relaxed);
                self.inner
                    .canvas_sync_snapshot_bytes
                    .fetch_add(u64::try_from(bytes).unwrap_or(u64::MAX), Ordering::Relaxed);
            }
            None => {
                self.inner
                    .canvas_sync_up_to_date
                    .fetch_add(1, Ordering::Relaxed);
            }
        }
    }

    pub(crate) fn canvas_sync(&self) -> (u64, u64, u64, u64) {
        (
            self.inner
                .canvas_sync_initial_snapshots
                .load(Ordering::Relaxed),
            self.inner
                .canvas_sync_repair_snapshots
                .load(Ordering::Relaxed),
            self.inner.canvas_sync_up_to_date.load(Ordering::Relaxed),
            self.inner
                .canvas_sync_snapshot_bytes
                .load(Ordering::Relaxed),
        )
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
        metrics.record_local_commit_publication(Duration::from_micros(4));
        assert_eq!(
            metrics.local_commit_publication_duration(),
            DurationMetricSnapshot {
                count: 1,
                total_micros: 4,
                last_micros: 4,
                max_micros: 4,
            }
        );
        metrics.record_canvas_sync(true, Some(12));
        metrics.record_canvas_sync(false, Some(8));
        metrics.record_canvas_sync(false, None);
        assert_eq!(metrics.canvas_sync(), (1, 1, 1, 20));
    }
}
