use nodex_core_contracts::{AdapterKind, BoundModuleContext};
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use serde_json::Value;

use super::sqlite::{StoreError, StoreErrorCode};

const MAX_RECEIPT_JSON_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, PartialEq)]
pub struct StoredModuleReceipt {
    pub request_hash: String,
    pub result: Value,
    pub event_sequence: Option<i64>,
    pub committed_at: String,
}

pub struct NewModuleReceipt<'a> {
    pub module_name: &'a str,
    pub operation_id: &'a str,
    pub context: &'a BoundModuleContext,
    pub operation_kind: &'a str,
    pub store_epoch: &'a str,
    pub request_hash: &'a str,
    pub result: &'a Value,
    pub event_sequence: Option<i64>,
    pub committed_at: &'a str,
}

/// The authority fields that may participate in a durable idempotency
/// fingerprint. A physical connection authenticates a request, but it is not
/// part of the request's semantic identity and must never make a committed
/// operation unreplayable after reconnecting.
#[derive(Serialize)]
pub struct DurableModuleContext<'a> {
    profile_id: &'a str,
    library_id: &'a str,
    project_id: Option<&'a str>,
    adapter: &'static str,
}

impl<'a> From<&'a BoundModuleContext> for DurableModuleContext<'a> {
    fn from(context: &'a BoundModuleContext) -> Self {
        Self {
            profile_id: &context.profile_id.0,
            library_id: &context.library_id.0,
            project_id: context.project_id.as_ref().map(|id| id.0.as_str()),
            adapter: adapter_kind(&context.adapter),
        }
    }
}

pub fn read_module_receipt(
    connection: &Connection,
    module_name: &str,
    operation_id: &str,
) -> Result<Option<StoredModuleReceipt>, StoreError> {
    let raw = connection
        .query_row(
            "SELECT request_hash, result_json, event_sequence, committed_at \
             FROM core_module_receipts WHERE module_name = ?1 AND operation_id = ?2",
            params![module_name, operation_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<i64>>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        )
        .optional()
        .map_err(|_| corrupt("Core Module receipt column types are invalid"))?;
    let Some((request_hash, result_json, event_sequence, committed_at)) = raw else {
        return Ok(None);
    };
    if !is_sha256(&request_hash) {
        return Err(corrupt("Core Module receipt request hash is invalid"));
    }
    if result_json.len() > MAX_RECEIPT_JSON_BYTES {
        return Err(corrupt("Core Module receipt result exceeds its bound"));
    }
    let result = serde_json::from_str::<Value>(&result_json)
        .map_err(|_| corrupt("Core Module receipt result JSON is invalid"))?;
    if !result.is_object() {
        return Err(corrupt("Core Module receipt result must be an object"));
    }
    if event_sequence.is_some_and(|sequence| sequence < 1) {
        return Err(corrupt("Core Module receipt event sequence is invalid"));
    }
    if committed_at.is_empty() || committed_at.len() > 64 {
        return Err(corrupt("Core Module receipt timestamp is invalid"));
    }
    Ok(Some(StoredModuleReceipt {
        request_hash,
        result,
        event_sequence,
        committed_at,
    }))
}

pub fn insert_module_receipt(
    connection: &Connection,
    receipt: NewModuleReceipt<'_>,
) -> Result<(), StoreError> {
    let result_json = serde_json::to_string(receipt.result).map_err(|_| {
        StoreError::new(
            StoreErrorCode::Internal,
            "Core Module receipt result could not be encoded",
            false,
        )
    })?;
    if result_json.len() > MAX_RECEIPT_JSON_BYTES {
        return Err(StoreError::new(
            StoreErrorCode::Internal,
            "Core Module receipt result exceeds its bound",
            false,
        ));
    }
    connection.execute(
        "INSERT INTO core_module_receipts (\
           module_name, operation_id, profile_id, project_id, adapter_kind, operation_kind, \
           store_epoch, request_hash, result_json, event_sequence, committed_at\
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            receipt.module_name,
            receipt.operation_id,
            receipt.context.profile_id.0.as_str(),
            receipt.context.project_id.as_ref().map(|id| id.0.as_str()),
            adapter_kind(&receipt.context.adapter),
            receipt.operation_kind,
            receipt.store_epoch,
            receipt.request_hash,
            result_json,
            receipt.event_sequence,
            receipt.committed_at,
        ],
    )?;
    Ok(())
}

fn adapter_kind(kind: &AdapterKind) -> &'static str {
    match kind {
        AdapterKind::ElectronHost => "electron_host",
        AdapterKind::LoopbackHttp => "loopback_http",
        AdapterKind::NativeCli => "native_cli",
        AdapterKind::Agent => "agent",
        AdapterKind::Test => "test",
    }
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .as_bytes()
            .iter()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte))
}

fn corrupt(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message, false)
}

#[cfg(test)]
mod tests {
    use nodex_core_contracts::{LibraryId, ProfileId, ProjectId};

    use super::*;

    fn context(connection_id: &str, adapter: AdapterKind) -> BoundModuleContext {
        BoundModuleContext {
            profile_id: ProfileId("profile-1".to_owned()),
            library_id: LibraryId("library-1".to_owned()),
            project_id: Some(ProjectId("project-1".to_owned())),
            connection_id: connection_id.to_owned(),
            adapter,
        }
    }

    #[test]
    fn durable_context_ignores_physical_connections_but_retains_authority() {
        let first = serde_json::to_vec(&DurableModuleContext::from(&context(
            "connection-1",
            AdapterKind::ElectronHost,
        )))
        .expect("durable context");
        let reconnected = serde_json::to_vec(&DurableModuleContext::from(&context(
            "connection-2",
            AdapterKind::ElectronHost,
        )))
        .expect("reconnected durable context");
        let another_adapter = serde_json::to_vec(&DurableModuleContext::from(&context(
            "connection-2",
            AdapterKind::NativeCli,
        )))
        .expect("other adapter durable context");

        assert_eq!(first, reconnected);
        assert_ne!(first, another_adapter);
    }
}
