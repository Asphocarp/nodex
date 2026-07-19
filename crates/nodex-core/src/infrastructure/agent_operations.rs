use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use nodex_core_contracts::agent::AgentEffectClass;
use sha2::{Digest, Sha256};

use super::sqlite::{StoreError, StoreErrorCode};

const DEFAULT_TOKEN_TTL: Duration = Duration::from_secs(60);
const DEFAULT_MAX_OPERATIONS: usize = 1_024;
const DEFAULT_MAX_OPERATIONS_PER_CONNECTION: usize = 32;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PreparedAgentOperationBinding {
    pub connection_id: String,
    pub request_hash: String,
    pub authority_revisions_hash: String,
    pub footprint_hash: String,
    pub effect_class: AgentEffectClass,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IssuedPreparedAgentOperation {
    pub token: String,
    pub expires_at_unix_ms: i64,
}

#[derive(Clone)]
pub struct PreparedAgentOperationRegistry {
    inner: Arc<Mutex<RegistryState>>,
    token_ttl: Duration,
    max_operations: usize,
    max_operations_per_connection: usize,
}

#[derive(Default)]
struct RegistryState {
    records: HashMap<String, PreparedRecord>,
    next_lease_id: u64,
}

struct PreparedRecord {
    binding: PreparedAgentOperationBinding,
    expires_at: Instant,
    state: PreparedRecordState,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum PreparedRecordState {
    Ready,
    InFlight(u64),
}

pub struct PreparedAgentOperationLease {
    registry: PreparedAgentOperationRegistry,
    token_hash: String,
    lease_id: u64,
    consumed: bool,
}

impl PreparedAgentOperationRegistry {
    pub fn new() -> Self {
        Self::with_limits(
            DEFAULT_TOKEN_TTL,
            DEFAULT_MAX_OPERATIONS,
            DEFAULT_MAX_OPERATIONS_PER_CONNECTION,
        )
    }

    fn with_limits(
        token_ttl: Duration,
        max_operations: usize,
        max_operations_per_connection: usize,
    ) -> Self {
        Self {
            inner: Arc::new(Mutex::new(RegistryState::default())),
            token_ttl,
            max_operations,
            max_operations_per_connection,
        }
    }

    pub fn issue(
        &self,
        binding: PreparedAgentOperationBinding,
    ) -> Result<IssuedPreparedAgentOperation, StoreError> {
        let now = Instant::now();
        let mut state = self.lock()?;
        prune_expired(&mut state, now);
        if state.records.len() >= self.max_operations {
            return Err(exhausted("Prepared Agent operation capacity is exhausted"));
        }
        let connection_count = state
            .records
            .values()
            .filter(|record| record.binding.connection_id == binding.connection_id)
            .count();
        if connection_count >= self.max_operations_per_connection {
            return Err(exhausted(
                "Prepared Agent operation capacity for this connection is exhausted",
            ));
        }

        let (token, token_hash) = loop {
            let mut bytes = [0_u8; 32];
            getrandom::fill(&mut bytes).map_err(|_| {
                StoreError::new(
                    StoreErrorCode::Internal,
                    "Prepared Agent token entropy is unavailable",
                    false,
                )
            })?;
            let token = hex::encode(bytes);
            let token_hash = digest(token.as_bytes());
            if !state.records.contains_key(&token_hash) {
                break (token, token_hash);
            }
        };
        let expires_at_unix_ms = unix_time_millis()?
            .checked_add(i64::try_from(self.token_ttl.as_millis()).map_err(|_| {
                StoreError::new(
                    StoreErrorCode::Internal,
                    "Prepared Agent token lifetime exceeds the supported range",
                    false,
                )
            })?)
            .ok_or_else(|| {
                StoreError::new(
                    StoreErrorCode::Internal,
                    "Prepared Agent token expiry overflowed",
                    false,
                )
            })?;
        state.records.insert(
            token_hash,
            PreparedRecord {
                binding,
                expires_at: now + self.token_ttl,
                state: PreparedRecordState::Ready,
            },
        );
        Ok(IssuedPreparedAgentOperation {
            token,
            expires_at_unix_ms,
        })
    }

    pub fn acquire(
        &self,
        token: &str,
        binding: &PreparedAgentOperationBinding,
    ) -> Result<PreparedAgentOperationLease, StoreError> {
        if token.len() != 64 || !token.as_bytes().iter().all(u8::is_ascii_hexdigit) {
            return Err(stale());
        }
        let token_hash = digest(token.as_bytes());
        let now = Instant::now();
        let mut state = self.lock()?;
        prune_expired(&mut state, now);
        let record = state.records.get(&token_hash).ok_or_else(stale)?;
        if &record.binding != binding {
            return Err(stale());
        }
        if record.state != PreparedRecordState::Ready {
            return Err(StoreError::new(
                StoreErrorCode::RevisionConflict,
                "Prepared Agent operation is already executing",
                true,
            ));
        }
        state.next_lease_id = state.next_lease_id.checked_add(1).ok_or_else(|| {
            StoreError::new(
                StoreErrorCode::Internal,
                "Prepared Agent operation lease identity overflowed",
                false,
            )
        })?;
        let lease_id = state.next_lease_id;
        state
            .records
            .get_mut(&token_hash)
            .expect("prepared record remains present")
            .state = PreparedRecordState::InFlight(lease_id);
        drop(state);
        Ok(PreparedAgentOperationLease {
            registry: self.clone(),
            token_hash,
            lease_id,
            consumed: false,
        })
    }

    pub fn invalidate_all(&self) -> Result<(), StoreError> {
        self.lock()?.records.clear();
        Ok(())
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, RegistryState>, StoreError> {
        self.inner.lock().map_err(|_| {
            StoreError::new(
                StoreErrorCode::Internal,
                "Prepared Agent operation registry lock failed",
                false,
            )
        })
    }
}

impl Default for PreparedAgentOperationRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl PreparedAgentOperationLease {
    pub fn consume(mut self) -> Result<(), StoreError> {
        let mut state = self.registry.lock()?;
        let matches = state
            .records
            .get(&self.token_hash)
            .is_some_and(|record| record.state == PreparedRecordState::InFlight(self.lease_id));
        if !matches {
            return Err(StoreError::new(
                StoreErrorCode::Internal,
                "Prepared Agent operation lease was lost before commit",
                false,
            ));
        }
        state.records.remove(&self.token_hash);
        self.consumed = true;
        Ok(())
    }
}

impl Drop for PreparedAgentOperationLease {
    fn drop(&mut self) {
        if self.consumed {
            return;
        }
        let Ok(mut state) = self.registry.inner.lock() else {
            return;
        };
        let Some(record) = state.records.get_mut(&self.token_hash) else {
            return;
        };
        if record.state == PreparedRecordState::InFlight(self.lease_id) {
            record.state = PreparedRecordState::Ready;
        }
    }
}

fn prune_expired(state: &mut RegistryState, now: Instant) {
    state.records.retain(|_, record| record.expires_at > now);
}

fn digest(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

fn unix_time_millis() -> Result<i64, StoreError> {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| {
            StoreError::new(
                StoreErrorCode::Internal,
                "System clock is before the Unix epoch",
                false,
            )
        })?
        .as_millis();
    i64::try_from(millis).map_err(|_| {
        StoreError::new(
            StoreErrorCode::Internal,
            "System clock exceeds the supported range",
            false,
        )
    })
}

fn stale() -> StoreError {
    StoreError::new(
        StoreErrorCode::RevisionConflict,
        "Prepared Agent operation is stale, invalid, or bound to another authority",
        true,
    )
}

fn exhausted(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::ResourceExhausted, message, true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn binding(connection_id: &str, suffix: &str) -> PreparedAgentOperationBinding {
        PreparedAgentOperationBinding {
            connection_id: connection_id.to_owned(),
            request_hash: format!("request:{suffix}"),
            authority_revisions_hash: format!("revisions:{suffix}"),
            footprint_hash: format!("footprint:{suffix}"),
            effect_class: AgentEffectClass::Write,
        }
    }

    #[test]
    fn token_is_single_use_and_exactly_bound() {
        let registry = PreparedAgentOperationRegistry::new();
        let expected = binding("connection:a", "a");
        let issued = registry.issue(expected.clone()).expect("issue token");

        assert!(
            registry
                .acquire(&issued.token, &binding("connection:b", "a"))
                .is_err()
        );
        let lease = registry
            .acquire(&issued.token, &expected)
            .expect("acquire exact token");
        assert!(registry.acquire(&issued.token, &expected).is_err());
        lease.consume().expect("consume token");
        assert!(registry.acquire(&issued.token, &expected).is_err());
    }

    #[test]
    fn failed_execution_releases_the_lease_until_expiry() {
        let registry = PreparedAgentOperationRegistry::new();
        let expected = binding("connection:a", "a");
        let issued = registry.issue(expected.clone()).expect("issue token");
        drop(
            registry
                .acquire(&issued.token, &expected)
                .expect("acquire token"),
        );
        registry
            .acquire(&issued.token, &expected)
            .expect("released token can retry");
    }

    #[test]
    fn capacity_and_expiry_are_bounded_per_connection() {
        let registry = PreparedAgentOperationRegistry::with_limits(Duration::from_millis(1), 2, 1);
        registry
            .issue(binding("connection:a", "a"))
            .expect("first token");
        assert_eq!(
            registry
                .issue(binding("connection:a", "b"))
                .expect_err("per-connection capacity")
                .code,
            StoreErrorCode::ResourceExhausted
        );
        std::thread::sleep(Duration::from_millis(5));
        registry
            .issue(binding("connection:a", "c"))
            .expect("expired token releases capacity");
        registry.invalidate_all().expect("invalidate registry");
    }
}
