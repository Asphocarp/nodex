const MIGRATION_PROGRESS_STEPS: u64 = 20;

/// Emits bounded progress while preserving the caller's completed/total coordinate.
pub(crate) fn report_bounded_progress(
    progress: &mut dyn FnMut(u64, u64),
    completed: u64,
    total: u64,
    reported_step: &mut u64,
) {
    if total == 0 {
        return;
    }
    let step = completed.saturating_mul(MIGRATION_PROGRESS_STEPS) / total;
    if completed < total && step <= *reported_step {
        return;
    }
    *reported_step = step;
    progress(completed.min(total), total);
}
