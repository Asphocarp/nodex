#![forbid(unsafe_code)]

use nodex_core_contracts::{CoreError, ModuleEvent};
use serde::{Deserialize, Serialize};

pub const PROTOCOL_MIN: u32 = 1;
pub const PROTOCOL_MAX: u32 = 1;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct RuntimeDescriptor {
    pub protocol_min: u32,
    pub protocol_max: u32,
    pub build_id: String,
    pub pid: u32,
    pub start_nonce: String,
    pub socket_path: String,
    pub profile_id: String,
    pub store_epoch: String,
    pub readiness_generation: u64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ClientKind {
    ElectronHost,
    NativeCli,
    Test,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ClientIdentity {
    pub kind: ClientKind,
    pub build_id: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct HandshakeRequest {
    pub protocol_min: u32,
    pub protocol_max: u32,
    pub client: ClientIdentity,
    pub expected_profile_id: Option<String>,
    pub expected_start_nonce: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct HandshakeResponse {
    pub protocol_version: u32,
    pub build_id: String,
    pub pid: u32,
    pub start_nonce: String,
    pub profile_id: String,
    pub library_id: String,
    pub store_epoch: String,
    pub schema_version: u32,
    pub event_head: i64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(tag = "status", content = "payload", rename_all = "snake_case")]
pub enum ResponseEnvelope<T> {
    Ok(T),
    Error(CoreError),
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
pub struct EventEnvelope {
    pub protocol_version: u32,
    pub event: ModuleEvent,
}
