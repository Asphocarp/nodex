use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use axum::extract::connect_info::Connected;
use axum::serve::IncomingStream;
use nodex_core_contracts::AdapterKind;
use tokio::net::UnixListener;

const MAX_CONNECTIONS: usize = 1_024;
const STALE_CONNECTION_AGE: Duration = Duration::from_secs(24 * 60 * 60);

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct PeerIdentity {
    pub(crate) uid: u32,
    pub(crate) gid: u32,
    pub(crate) pid: Option<u32>,
}

impl Connected<IncomingStream<'_, UnixListener>> for PeerIdentity {
    fn connect_info(stream: IncomingStream<'_, UnixListener>) -> Self {
        let credential = stream
            .io()
            .peer_cred()
            .expect("accepted Unix stream exposes peer credentials");
        Self {
            uid: credential.uid(),
            gid: credential.gid(),
            pid: credential.pid().and_then(|pid| u32::try_from(pid).ok()),
        }
    }
}

#[derive(Clone)]
pub(crate) struct BoundConnection {
    pub(crate) id: String,
    pub(crate) adapter: AdapterKind,
}

struct ConnectionRecord {
    binding: String,
    adapter: AdapterKind,
    peer: PeerIdentity,
    build_id: String,
    protocol_version: u32,
    last_seen: Instant,
}

pub(crate) struct ConnectionRegistry {
    records: Mutex<HashMap<String, ConnectionRecord>>,
}

impl ConnectionRegistry {
    pub(crate) fn new() -> Self {
        Self {
            records: Mutex::new(HashMap::new()),
        }
    }

    pub(crate) fn register(
        &self,
        connection_id: &str,
        binding: String,
        adapter: AdapterKind,
        peer: &PeerIdentity,
        build_id: &str,
        protocol_version: u32,
    ) -> Result<(), &'static str> {
        let mut records = self
            .records
            .lock()
            .map_err(|_| "connection registry failed")?;
        let now = Instant::now();
        records.retain(|_, record| now.duration_since(record.last_seen) <= STALE_CONNECTION_AGE);
        if let Some(record) = records.get_mut(connection_id) {
            if record.adapter != adapter
                || record.peer != *peer
                || record.build_id != build_id
                || record.protocol_version != protocol_version
                || !constant_time_equal(record.binding.as_bytes(), binding.as_bytes())
            {
                return Err("connection identity is already bound");
            }
            record.last_seen = now;
            return Ok(());
        }
        if records.len() >= MAX_CONNECTIONS {
            return Err("connection registry is full");
        }
        records.insert(
            connection_id.to_owned(),
            ConnectionRecord {
                binding,
                adapter,
                peer: peer.clone(),
                build_id: build_id.to_owned(),
                protocol_version,
                last_seen: now,
            },
        );
        Ok(())
    }

    pub(crate) fn bind(
        &self,
        connection_id: &str,
        binding: &str,
        peer: &PeerIdentity,
    ) -> Result<BoundConnection, &'static str> {
        let mut records = self
            .records
            .lock()
            .map_err(|_| "connection registry failed")?;
        let Some(record) = records.get_mut(connection_id) else {
            return Err("connection has not completed a compatible Core handshake");
        };
        if record.peer != *peer
            || !constant_time_equal(record.binding.as_bytes(), binding.as_bytes())
        {
            return Err("connection binding does not match its authenticated peer");
        }
        record.last_seen = Instant::now();
        Ok(BoundConnection {
            id: connection_id.to_owned(),
            adapter: record.adapter.clone(),
        })
    }
}

fn constant_time_equal(left: &[u8], right: &[u8]) -> bool {
    if left.len() != right.len() {
        return false;
    }
    left.iter()
        .zip(right)
        .fold(0_u8, |difference, (left, right)| {
            difference | (left ^ right)
        })
        == 0
}

#[cfg(test)]
mod tests {
    use super::*;

    fn peer(pid: u32) -> PeerIdentity {
        PeerIdentity {
            uid: 501,
            gid: 20,
            pid: Some(pid),
        }
    }

    #[test]
    fn connection_binding_is_single_identity_and_peer_bound() {
        let registry = ConnectionRegistry::new();
        registry
            .register(
                "connection:one",
                "binding:one".to_owned(),
                AdapterKind::ElectronHost,
                &peer(10),
                "host-build",
                1,
            )
            .expect("first registration");
        assert!(
            registry
                .bind("connection:one", "binding:one", &peer(10))
                .is_ok()
        );
        assert!(
            registry
                .bind("connection:one", "binding:one", &peer(11))
                .is_err()
        );
        assert!(
            registry
                .register(
                    "connection:one",
                    "binding:two".to_owned(),
                    AdapterKind::NativeCli,
                    &peer(10),
                    "cli-build",
                    1,
                )
                .is_err()
        );
    }
}
