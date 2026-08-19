use std::cell::RefCell;
use std::time::{Duration, Instant};

use super::sqlite::QueryCancellation;

#[derive(Clone)]
pub struct RequestExecutionContext {
    cancellation: QueryCancellation,
    deadline: Instant,
}

impl RequestExecutionContext {
    pub fn new(cancellation: QueryCancellation, deadline: Instant) -> Self {
        Self {
            cancellation,
            deadline,
        }
    }

    pub fn cancellation(&self) -> QueryCancellation {
        self.cancellation.clone()
    }

    pub fn deadline(&self) -> Instant {
        self.deadline
    }
}

thread_local! {
    static CURRENT: RefCell<Vec<RequestExecutionContext>> = const { RefCell::new(Vec::new()) };
}

/// Runs synchronous Core work inside the transport-owned execution context.
/// Store readers and the writer inherit its absolute deadline and cancellation
/// without exposing transport policy through semantic Module interfaces.
pub fn within_request_execution<T>(
    context: RequestExecutionContext,
    operation: impl FnOnce() -> T,
) -> T {
    CURRENT.with(|current| current.borrow_mut().push(context));
    let _guard = RequestExecutionGuard;
    operation()
}

/// Reports whether the transport has cancelled the synchronous request that
/// owns the current worker thread.
pub fn request_is_cancelled() -> bool {
    CURRENT.with(|current| {
        current
            .borrow()
            .last()
            .is_some_and(|context| context.cancellation.is_cancelled())
    })
}

pub(crate) fn query_control(
    fallback_budget: Duration,
    cancellation: QueryCancellation,
) -> (Instant, QueryCancellation) {
    CURRENT.with(|current| {
        let current = current.borrow();
        let Some(context) = current.last() else {
            return (Instant::now() + fallback_budget, cancellation);
        };
        (
            // A transported Module request has exactly one semantic deadline.
            // The fallback protects direct Store use, but must not become a
            // hidden, shorter timeout inside the request-execution seam.
            context.deadline,
            cancellation.combined(&context.cancellation),
        )
    })
}

struct RequestExecutionGuard;

impl Drop for RequestExecutionGuard {
    fn drop(&mut self) {
        CURRENT.with(|current| {
            current.borrow_mut().pop();
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scopes_deadline_and_cancellation_without_leaking_to_later_work() {
        let request_cancellation = QueryCancellation::new();
        let explicit_cancellation = QueryCancellation::new();
        let request_deadline = Instant::now() + Duration::from_secs(2);

        within_request_execution(
            RequestExecutionContext::new(request_cancellation.clone(), request_deadline),
            || {
                let (deadline, combined) =
                    query_control(Duration::from_secs(10), explicit_cancellation.clone());
                assert_eq!(deadline, request_deadline);
                request_cancellation.cancel();
                assert!(combined.is_cancelled());
            },
        );

        let (_, independent) = query_control(Duration::from_secs(10), explicit_cancellation);
        assert!(!independent.is_cancelled());
    }

    #[test]
    fn transported_request_deadline_replaces_the_direct_store_fallback() {
        let request_deadline = Instant::now() + Duration::from_secs(20);
        within_request_execution(
            RequestExecutionContext::new(QueryCancellation::new(), request_deadline),
            || {
                let (deadline, _) =
                    query_control(Duration::from_secs(10), QueryCancellation::new());
                assert_eq!(deadline, request_deadline);
            },
        );
    }
}
