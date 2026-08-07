use nodex_core_contracts::StoreEpoch;
use serde::{Deserialize, Serialize};

/// Private writer result persisted in a module receipt.
///
/// This carries physical reconstruction coordinates needed inside Core. It is
/// deliberately not part of the public protocol; adapters receive the closed
/// `ApplyResponse` assembled after commit and post-state authorization.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct ModuleWriterResult<T, R> {
    pub value: T,
    pub receipt: R,
    pub commit_seq: i64,
    pub event_sequence: i64,
    pub store_epoch: StoreEpoch,
}
