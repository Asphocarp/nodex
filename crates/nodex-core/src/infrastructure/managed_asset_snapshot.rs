use std::sync::{OnceLock, RwLock, RwLockReadGuard, RwLockWriteGuard, TryLockError};

use super::sqlite::{StoreError, StoreErrorCode};

static MANAGED_ASSET_LEASE: OnceLock<RwLock<()>> = OnceLock::new();

/// Pins the process-owned managed asset namespace while a staged database's
/// asset closure is copied. New assets may still be published; destructive GC
/// uses a non-blocking writer lease and yields instead of stalling a Store
/// writer behind a long snapshot.
pub(crate) struct ManagedAssetSnapshotLease {
    _guard: RwLockReadGuard<'static, ()>,
}

pub(crate) fn acquire_snapshot_lease() -> Result<ManagedAssetSnapshotLease, StoreError> {
    let guard = MANAGED_ASSET_LEASE
        .get_or_init(|| RwLock::new(()))
        .read()
        .map_err(|_| unavailable())?;
    Ok(ManagedAssetSnapshotLease { _guard: guard })
}

pub(crate) fn try_acquire_gc_lease() -> Result<Option<RwLockWriteGuard<'static, ()>>, StoreError> {
    match MANAGED_ASSET_LEASE
        .get_or_init(|| RwLock::new(()))
        .try_write()
    {
        Ok(guard) => Ok(Some(guard)),
        Err(TryLockError::WouldBlock) => Ok(None),
        Err(TryLockError::Poisoned(_)) => Err(unavailable()),
    }
}

fn unavailable() -> StoreError {
    StoreError::new(
        StoreErrorCode::Internal,
        "Managed asset snapshot lease is unavailable",
        false,
    )
}
