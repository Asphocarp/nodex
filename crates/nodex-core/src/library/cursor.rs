use base64::prelude::{BASE64_URL_SAFE_NO_PAD, Engine as _};
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};

const PREFIX: &str = "nxl1";
const MAX_CURSOR_BYTES: usize = 2_048;
const HMAC_BLOCK_BYTES: usize = 64;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CursorPayload {
    version: u32,
    kind: String,
    library_id: String,
    store_epoch: String,
    subject: Vec<String>,
    offset: usize,
    change_log_seq: i64,
}

pub(crate) struct DecodedCursor {
    pub(crate) offset: usize,
    pub(crate) change_log_seq: i64,
}

pub(crate) fn mint(
    connection: &Connection,
    library_id: &str,
    subject: &[String],
    offset: usize,
    change_log_seq: i64,
) -> Result<String, StoreError> {
    let payload = CursorPayload {
        version: 1,
        kind: "library_cursor".to_owned(),
        library_id: library_id.to_owned(),
        store_epoch: store_epoch(connection)?,
        subject: subject.to_vec(),
        offset,
        change_log_seq,
    };
    let encoded = BASE64_URL_SAFE_NO_PAD.encode(
        serde_json::to_vec(&payload).map_err(|_| invalid("Library cursor cannot be encoded"))?,
    );
    let signature = BASE64_URL_SAFE_NO_PAD.encode(sign(connection, &encoded)?);
    let cursor = format!("{PREFIX}.{encoded}.{signature}");
    if cursor.len() > MAX_CURSOR_BYTES {
        return Err(invalid("Library cursor exceeds its bound"));
    }
    Ok(cursor)
}

pub(crate) fn decode(
    connection: &Connection,
    cursor: &str,
    library_id: &str,
    subject: &[String],
) -> Result<DecodedCursor, StoreError> {
    if cursor.is_empty() || cursor.len() > MAX_CURSOR_BYTES {
        return Err(invalid("Library cursor is malformed"));
    }
    let parts = cursor.split('.').collect::<Vec<_>>();
    if parts.len() != 3 || parts[0] != PREFIX || parts[1].is_empty() || parts[2].len() != 43 {
        return Err(invalid("Library cursor is malformed"));
    }
    let supplied = BASE64_URL_SAFE_NO_PAD
        .decode(parts[2])
        .map_err(|_| invalid("Library cursor signature is invalid"))?;
    let expected = sign(connection, parts[1])?;
    if supplied.len() != expected.len() || !constant_time_equal(&supplied, &expected) {
        return Err(invalid("Library cursor signature is invalid"));
    }
    let payload = BASE64_URL_SAFE_NO_PAD
        .decode(parts[1])
        .map_err(|_| invalid("Library cursor payload is malformed"))?;
    let payload = serde_json::from_slice::<CursorPayload>(&payload)
        .map_err(|_| invalid("Library cursor payload is invalid"))?;
    if payload.version != 1
        || payload.kind != "library_cursor"
        || payload.library_id != library_id
        || payload.subject != subject
        || payload.subject.is_empty()
        || payload.subject.len() > 8
        || payload.subject.iter().any(|part| part.len() > 512)
    {
        return Err(invalid("Library cursor belongs to another query"));
    }
    if payload.store_epoch != store_epoch(connection)? {
        return Err(conflict("Library cursor belongs to another store epoch"));
    }
    Ok(DecodedCursor {
        offset: payload.offset,
        change_log_seq: payload.change_log_seq,
    })
}

fn sign(connection: &Connection, payload: &str) -> Result<[u8; 32], StoreError> {
    let key = connection
        .query_row(
            "SELECT key_material FROM nodex_agent_token_keys WHERE id = 1",
            [],
            |row| row.get::<_, Vec<u8>>(0),
        )
        .optional()?
        .filter(|key| key.len() == 32)
        .ok_or_else(|| invalid("Library cursor signing key is unavailable"))?;
    Ok(hmac_sha256(&key, format!("{PREFIX}.{payload}").as_bytes()))
}

fn store_epoch(connection: &Connection) -> Result<String, StoreError> {
    connection
        .query_row(
            "SELECT store_epoch FROM block_store_metadata WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .optional()?
        .ok_or_else(|| corrupt("Block store epoch is unavailable"))
}

fn hmac_sha256(key: &[u8], input: &[u8]) -> [u8; 32] {
    let mut normalized = [0_u8; HMAC_BLOCK_BYTES];
    if key.len() > HMAC_BLOCK_BYTES {
        normalized[..32].copy_from_slice(&Sha256::digest(key));
    } else {
        normalized[..key.len()].copy_from_slice(key);
    }
    let mut inner_pad = [0x36_u8; HMAC_BLOCK_BYTES];
    let mut outer_pad = [0x5c_u8; HMAC_BLOCK_BYTES];
    for index in 0..HMAC_BLOCK_BYTES {
        inner_pad[index] ^= normalized[index];
        outer_pad[index] ^= normalized[index];
    }
    let mut inner = Sha256::new();
    inner.update(inner_pad);
    inner.update(input);
    let inner = inner.finalize();
    let mut outer = Sha256::new();
    outer.update(outer_pad);
    outer.update(inner);
    outer.finalize().into()
}

fn constant_time_equal(left: &[u8], right: &[u8]) -> bool {
    left.iter()
        .zip(right)
        .fold(0_u8, |difference, (left, right)| {
            difference | (left ^ right)
        })
        == 0
}

fn invalid(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::InvalidInput, message, false)
}

fn conflict(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::Conflict, message, false)
}

fn corrupt(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message, false)
}
