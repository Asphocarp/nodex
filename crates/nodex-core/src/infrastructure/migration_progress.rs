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

#[cfg(test)]
mod tests {
    use super::report_bounded_progress;

    #[test]
    fn ignores_empty_work() {
        let mut calls = Vec::new();
        let mut reported_step = 0;
        report_bounded_progress(
            &mut |completed, total| calls.push((completed, total)),
            0,
            0,
            &mut reported_step,
        );
        assert!(calls.is_empty());
    }

    #[test]
    fn always_reports_completion() {
        let mut calls = Vec::new();
        let mut reported_step = 0;
        report_bounded_progress(
            &mut |completed, total| calls.push((completed, total)),
            100,
            100,
            &mut reported_step,
        );
        assert_eq!(calls, vec![(100, 100)]);
    }

    #[test]
    fn reports_each_progress_step_once() {
        let mut calls = Vec::new();
        let mut reported_step = 0;
        for completed in 0..=100 {
            report_bounded_progress(
                &mut |value, total| calls.push((value, total)),
                completed,
                100,
                &mut reported_step,
            );
        }
        assert_eq!(calls.first(), Some(&(5, 100)));
        assert_eq!(calls.last(), Some(&(100, 100)));
        assert!(calls.windows(2).all(|window| window[0].0 < window[1].0));
        assert!(calls.len() <= 21);
    }
}
