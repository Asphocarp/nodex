use base64::prelude::{BASE64_STANDARD, Engine as _};
use nodex_core_contracts::document::{
    OwnedDocumentCommitValue, OwnedDocumentReadValue, OwnedDocumentReceipt,
};
use nodex_core_contracts::{CommittedModuleValue, CoreError, ModuleReadSnapshot};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::Value;

const MAGIC: [u8; 4] = [0x4e, 0x44, 0x58, 0x01];
const HEADER_BYTES: usize = MAGIC.len() + size_of::<u32>();
const MAX_METADATA_BYTES: usize = 8 * 1024 * 1024;
const MAX_TRANSPORT_UPDATE_BYTES: usize = 2 * 1024 * 1024;
const MAX_TRANSPORT_AWARENESS_BYTES: usize = 64 * 1024;
pub(crate) const CONTENT_TYPE: &str = "application/vnd.nodex.document-sync.v1+octet-stream";
pub(crate) const MAX_SYNC_FRAME_BYTES: usize = MAX_METADATA_BYTES + 64 * 1024 + HEADER_BYTES;
pub(crate) const MAX_APPLY_FRAME_BYTES: usize =
    MAX_METADATA_BYTES + MAX_TRANSPORT_UPDATE_BYTES + HEADER_BYTES;
pub(crate) const MAX_AWARENESS_FRAME_BYTES: usize =
    MAX_METADATA_BYTES + MAX_TRANSPORT_AWARENESS_BYTES + HEADER_BYTES;
pub(crate) const MAX_DOCUMENT_FRAME_BYTES: usize = MAX_APPLY_FRAME_BYTES;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct SyncRequestMetadata {
    pub(crate) version: u32,
    pub(crate) client_session_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ApplyRequestMetadata {
    pub(crate) version: u32,
    pub(crate) store_epoch: String,
    pub(crate) generation: i64,
    pub(crate) update_id: String,
    pub(crate) client_session_id: String,
    pub(crate) base_head_seq: i64,
    pub(crate) touched_block_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct AwarenessRequestMetadata {
    pub(crate) version: u32,
    pub(crate) client_session_id: String,
    pub(crate) store_epoch: String,
    pub(crate) generation: i64,
}

pub(crate) enum ApplyFrame {
    Update(ApplyRequestMetadata, Vec<u8>),
    Awareness(AwarenessRequestMetadata, Vec<u8>),
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncResponseMetadata<'a> {
    version: u32,
    document_id: &'a str,
    store_epoch: &'a str,
    generation: i64,
    head_seq: i64,
    state_vector: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ApplyAckMetadata<'a> {
    version: u32,
    document_id: &'a str,
    store_epoch: &'a str,
    generation: i64,
    update_id: &'a str,
    committed_seq: i64,
    head_seq: i64,
    duplicate: bool,
}

#[derive(Debug)]
pub(crate) struct YjsSyncValue {
    pub(crate) document_id: String,
    pub(crate) store_epoch: String,
    pub(crate) generation: i64,
    pub(crate) head_seq: i64,
    pub(crate) state_vector: Vec<u8>,
    pub(crate) update: Vec<u8>,
}

pub(crate) fn decode_sync(bytes: &[u8]) -> Result<(SyncRequestMetadata, Vec<u8>), CoreError> {
    decode_envelope(bytes, nodex_core::document::MAX_STATE_VECTOR_BYTES)
}

pub(crate) fn decode_apply(bytes: &[u8]) -> Result<ApplyFrame, CoreError> {
    let metadata = decode_metadata(bytes)?;
    if metadata.get("updateId").is_some() {
        let (metadata, payload) =
            decode_envelope::<ApplyRequestMetadata>(bytes, MAX_TRANSPORT_UPDATE_BYTES)?;
        return Ok(ApplyFrame::Update(metadata, payload));
    }
    let (metadata, payload) =
        decode_envelope::<AwarenessRequestMetadata>(bytes, MAX_TRANSPORT_AWARENESS_BYTES)?;
    Ok(ApplyFrame::Awareness(metadata, payload))
}

pub(crate) fn parse_yjs_sync(
    snapshot: ModuleReadSnapshot<OwnedDocumentReadValue>,
) -> Result<YjsSyncValue, CoreError> {
    let OwnedDocumentReadValue::YjsSync { descriptor, update } = snapshot.value else {
        return Err(invalid("Core returned a non-Yjs Document sync value"));
    };
    let sync = descriptor
        .get("sync")
        .and_then(Value::as_object)
        .ok_or_else(|| invalid("Core Yjs descriptor has no sync value"))?;
    if sync.get("kind").and_then(Value::as_str) != Some("yjs") {
        return Err(invalid("Core Document descriptor is not Yjs"));
    }
    Ok(YjsSyncValue {
        document_id: string_field(&descriptor, "documentId")?,
        store_epoch: string_field(&descriptor, "storeEpoch")?,
        generation: integer_field(&descriptor, "generation")?,
        head_seq: integer_field(&descriptor, "headSeq")?,
        state_vector: byte_array_field(sync, "stateVector")?,
        update,
    })
}

pub(crate) fn encode_sync(value: &YjsSyncValue) -> Result<Vec<u8>, CoreError> {
    encode_envelope(
        &SyncResponseMetadata {
            version: 1,
            document_id: &value.document_id,
            store_epoch: &value.store_epoch,
            generation: value.generation,
            head_seq: value.head_seq,
            state_vector: BASE64_STANDARD.encode(&value.state_vector),
        },
        &value.update,
    )
}

pub(crate) fn encode_apply_ack(
    committed: &CommittedModuleValue<OwnedDocumentCommitValue, OwnedDocumentReceipt>,
    update_id: &str,
    sync: &YjsSyncValue,
) -> Result<Vec<u8>, CoreError> {
    encode_envelope(
        &ApplyAckMetadata {
            version: 1,
            document_id: &committed.receipt.document_id,
            store_epoch: &committed.store_epoch.0,
            generation: committed.receipt.generation,
            update_id,
            committed_seq: committed.receipt.head_seq,
            head_seq: sync.head_seq,
            duplicate: committed.receipt.mutation.duplicate,
        },
        &sync.state_vector,
    )
}

pub(crate) fn encode_realtime_event(
    event: &nodex_core::document::DocumentRealtimeEvent,
) -> Result<String, CoreError> {
    let nodex_core::document::DocumentRealtimeEvent::Awareness {
        document_id,
        store_epoch,
        generation,
        client_session_id,
        update,
    } = event
    else {
        return Err(invalid(
            "Only ephemeral Document events use the transport frame",
        ));
    };
    serde_json::to_string(&serde_json::json!({
        "version": 1,
        "kind": "awareness",
        "documentId": document_id,
        "storeEpoch": store_epoch,
        "generation": generation,
        "clientSessionId": client_session_id,
        "update": BASE64_STANDARD.encode(update),
    }))
    .map_err(|_| invalid("Document realtime event cannot be encoded"))
}

fn decode_envelope<T: DeserializeOwned>(
    bytes: &[u8],
    maximum_payload_bytes: usize,
) -> Result<(T, Vec<u8>), CoreError> {
    let metadata = decode_metadata_bytes(bytes)?;
    let payload_offset = HEADER_BYTES + metadata.len();
    let payload = bytes
        .get(payload_offset..)
        .ok_or_else(|| invalid("Document binary frame is truncated"))?;
    if payload.len() > maximum_payload_bytes {
        return Err(invalid("Document binary payload exceeds its bound"));
    }
    let metadata = serde_json::from_slice(metadata)
        .map_err(|_| invalid("Document binary metadata is invalid"))?;
    Ok((metadata, payload.to_vec()))
}

fn decode_metadata(bytes: &[u8]) -> Result<Value, CoreError> {
    serde_json::from_slice(decode_metadata_bytes(bytes)?)
        .map_err(|_| invalid("Document binary metadata is invalid"))
}

fn decode_metadata_bytes(bytes: &[u8]) -> Result<&[u8], CoreError> {
    if bytes.len() < HEADER_BYTES || bytes.get(..MAGIC.len()) != Some(MAGIC.as_slice()) {
        return Err(invalid("Document binary frame has an invalid version"));
    }
    let length = u32::from_be_bytes(
        bytes[MAGIC.len()..HEADER_BYTES]
            .try_into()
            .map_err(|_| invalid("Document binary frame is truncated"))?,
    ) as usize;
    if length > MAX_METADATA_BYTES {
        return Err(invalid("Document binary metadata exceeds its bound"));
    }
    bytes
        .get(HEADER_BYTES..HEADER_BYTES + length)
        .ok_or_else(|| invalid("Document binary metadata is truncated"))
}

fn encode_envelope<T: Serialize>(metadata: &T, payload: &[u8]) -> Result<Vec<u8>, CoreError> {
    let metadata = serde_json::to_vec(metadata)
        .map_err(|_| invalid("Document binary metadata cannot be encoded"))?;
    if metadata.len() > MAX_METADATA_BYTES {
        return Err(invalid("Document binary metadata exceeds its bound"));
    }
    let length = u32::try_from(metadata.len())
        .map_err(|_| invalid("Document binary metadata exceeds its bound"))?;
    let mut frame = Vec::with_capacity(HEADER_BYTES + metadata.len() + payload.len());
    frame.extend_from_slice(&MAGIC);
    frame.extend_from_slice(&length.to_be_bytes());
    frame.extend_from_slice(&metadata);
    frame.extend_from_slice(payload);
    Ok(frame)
}

fn string_field(value: &Value, name: &str) -> Result<String, CoreError> {
    value
        .get(name)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| invalid("Core Yjs descriptor has an invalid string field"))
}

fn integer_field(value: &Value, name: &str) -> Result<i64, CoreError> {
    value
        .get(name)
        .and_then(Value::as_i64)
        .ok_or_else(|| invalid("Core Yjs descriptor has an invalid integer field"))
}

fn byte_array_field(
    value: &serde_json::Map<String, Value>,
    name: &str,
) -> Result<Vec<u8>, CoreError> {
    value
        .get(name)
        .and_then(Value::as_array)
        .ok_or_else(|| invalid("Core Yjs descriptor has an invalid byte array"))?
        .iter()
        .map(|item| {
            item.as_u64()
                .and_then(|byte| u8::try_from(byte).ok())
                .ok_or_else(|| invalid("Core Yjs descriptor has an invalid byte array"))
        })
        .collect()
}

fn invalid(message: &str) -> CoreError {
    CoreError {
        code: nodex_core_contracts::CoreErrorCode::InvalidInput,
        message: message.to_owned(),
        retryable: false,
        recovery: nodex_core_contracts::CoreErrorRecovery::None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sync_frame_round_trips_raw_state_vector_bytes() {
        let frame = encode_envelope(
            &serde_json::json!({
                "version": 1,
                "clientSessionId": "renderer:one",
            }),
            &[0, 1, 2, 255],
        )
        .expect("frame");
        let (metadata, payload) = decode_sync(&frame).expect("decode");
        assert_eq!(metadata.version, 1);
        assert_eq!(metadata.client_session_id, "renderer:one");
        assert_eq!(payload, [0, 1, 2, 255]);
    }

    #[test]
    fn apply_frame_distinguishes_durable_updates_from_awareness() {
        let update = encode_envelope(
            &serde_json::json!({
                "version": 1,
                "storeEpoch": "epoch:one",
                "generation": 1,
                "updateId": "update:one",
                "clientSessionId": "renderer:one",
                "baseHeadSeq": 2,
                "touchedBlockIds": [],
            }),
            &[1, 2, 3],
        )
        .expect("update frame");
        assert!(
            matches!(decode_apply(&update), Ok(ApplyFrame::Update(_, payload)) if payload == [1, 2, 3])
        );

        let awareness = encode_envelope(
            &serde_json::json!({
                "version": 1,
                "clientSessionId": "renderer:one",
                "storeEpoch": "epoch:one",
                "generation": 1,
            }),
            &[4, 5, 6],
        )
        .expect("Awareness frame");
        assert!(
            matches!(decode_apply(&awareness), Ok(ApplyFrame::Awareness(_, payload)) if payload == [4, 5, 6])
        );
    }

    #[test]
    fn frame_decoder_rejects_claimed_metadata_and_payload_overflow() {
        let mut oversized_metadata = MAGIC.to_vec();
        oversized_metadata.extend_from_slice(
            &u32::try_from(MAX_METADATA_BYTES + 1)
                .expect("bounded test length")
                .to_be_bytes(),
        );
        assert_eq!(
            decode_sync(&oversized_metadata)
                .expect_err("oversized metadata")
                .message,
            "Document binary metadata exceeds its bound",
        );

        let oversized_payload = encode_envelope(
            &serde_json::json!({
                "version": 1,
                "clientSessionId": "renderer:one",
            }),
            &vec![0; nodex_core::document::MAX_STATE_VECTOR_BYTES + 1],
        )
        .expect("oversized payload frame");
        assert_eq!(
            decode_sync(&oversized_payload)
                .expect_err("oversized payload")
                .message,
            "Document binary payload exceeds its bound",
        );
    }
}
