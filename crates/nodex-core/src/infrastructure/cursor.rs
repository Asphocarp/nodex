use base64::prelude::{BASE64_URL_SAFE_NO_PAD, Engine as _};
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use nodex_core_contracts::collection::MAX_COLLECTION_CURSOR_BYTES;

use super::sqlite::{StoreError, StoreErrorCode};

const PREFIX: &str = "nxc1";
const PAYLOAD_VERSION: u32 = 2;
const HMAC_BLOCK_BYTES: usize = 64;
const MAX_CURSOR_KIND_BYTES: usize = 128;
const MAX_IDENTITY_BYTES: usize = 512;
const MAX_KEYSET_VALUES: usize = 12;
const SHA256_HEX_BYTES: usize = 64;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CursorDirection {
    Forward,
    Backward,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum KeysetValue {
    Null,
    Integer { value: i64 },
    Real { value: String },
    Text { value: String },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct KeysetCoordinate {
    pub values: Vec<KeysetValue>,
    pub stable_id: String,
}

/// Cursor identity: a continuation stays valid while the query shape and the
/// Store epoch stay the same. Data mutations never invalidate a keyset cursor;
/// the coordinate remains a well-defined seek point in the collection's total
/// order and loaded windows converge through projection invalidation.
#[derive(Clone, Copy, Debug)]
pub struct CollectionCursorSubject<'a> {
    pub kind: &'a str,
    pub library_id: &'a str,
    pub query_fingerprint: &'a str,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CursorPayload {
    version: u32,
    kind: String,
    library_id: String,
    store_epoch: String,
    query_fingerprint: String,
    direction: CursorDirection,
    coordinate: KeysetCoordinate,
}

pub fn query_fingerprint<T: Serialize>(query: &T) -> Result<String, StoreError> {
    let canonical = serde_json::to_vec(query)
        .map_err(|_| invalid("Collection query cannot be fingerprinted"))?;
    Ok(hex::encode(Sha256::digest(canonical)))
}

pub fn mint(
    connection: &Connection,
    subject: CollectionCursorSubject<'_>,
    direction: CursorDirection,
    coordinate: KeysetCoordinate,
) -> Result<String, StoreError> {
    validate_subject(subject)?;
    validate_coordinate(&coordinate)?;
    let payload = CursorPayload {
        version: PAYLOAD_VERSION,
        kind: subject.kind.to_owned(),
        library_id: subject.library_id.to_owned(),
        store_epoch: store_epoch(connection)?,
        query_fingerprint: subject.query_fingerprint.to_owned(),
        direction,
        coordinate,
    };
    let encoded = BASE64_URL_SAFE_NO_PAD.encode(
        serde_json::to_vec(&payload).map_err(|_| invalid("Collection cursor cannot be encoded"))?,
    );
    let signature = BASE64_URL_SAFE_NO_PAD.encode(sign(connection, PREFIX, &encoded)?);
    let cursor = format!("{PREFIX}.{encoded}.{signature}");
    if cursor.len() > MAX_COLLECTION_CURSOR_BYTES {
        return Err(invalid("Collection cursor exceeds its bound"));
    }
    Ok(cursor)
}

pub fn decode(
    connection: &Connection,
    cursor: &str,
    subject: CollectionCursorSubject<'_>,
) -> Result<(CursorDirection, KeysetCoordinate), StoreError> {
    validate_subject(subject)?;
    if cursor.is_empty() || cursor.len() > MAX_COLLECTION_CURSOR_BYTES {
        return Err(invalid("Collection cursor is malformed"));
    }
    let parts = cursor.split('.').collect::<Vec<_>>();
    if parts.len() != 3 || parts[0] != PREFIX || parts[1].is_empty() || parts[2].len() != 43 {
        return Err(invalid("Collection cursor is malformed"));
    }
    verify_signature(connection, PREFIX, parts[1], parts[2])?;
    let payload = BASE64_URL_SAFE_NO_PAD
        .decode(parts[1])
        .map_err(|_| invalid("Collection cursor payload is malformed"))?;
    let payload = serde_json::from_slice::<CursorPayload>(&payload)
        .map_err(|_| invalid("Collection cursor payload is invalid"))?;
    validate_coordinate(&payload.coordinate)?;
    if payload.version != PAYLOAD_VERSION
        || payload.kind != subject.kind
        || payload.library_id != subject.library_id
        || payload.query_fingerprint != subject.query_fingerprint
    {
        return Err(invalid("Collection cursor belongs to another query"));
    }
    if payload.store_epoch != store_epoch(connection)? {
        return Err(StoreError::new(
            StoreErrorCode::StaleStoreEpoch,
            "Collection cursor belongs to another Store epoch",
            false,
        ));
    }
    Ok((payload.direction, payload.coordinate))
}

pub(crate) fn sign(
    connection: &Connection,
    prefix: &str,
    payload: &str,
) -> Result<[u8; 32], StoreError> {
    let key = connection
        .query_row(
            "SELECT key_material FROM nodex_agent_token_keys WHERE id = 1",
            [],
            |row| row.get::<_, Vec<u8>>(0),
        )
        .optional()?
        .filter(|key| key.len() == 32)
        .ok_or_else(|| invalid("Cursor signing key is unavailable"))?;
    Ok(hmac_sha256(&key, format!("{prefix}.{payload}").as_bytes()))
}

pub(crate) fn verify_signature(
    connection: &Connection,
    prefix: &str,
    encoded_payload: &str,
    encoded_signature: &str,
) -> Result<(), StoreError> {
    let supplied = BASE64_URL_SAFE_NO_PAD
        .decode(encoded_signature)
        .map_err(|_| invalid("Cursor signature is invalid"))?;
    let expected = sign(connection, prefix, encoded_payload)?;
    if supplied.len() != expected.len() || !constant_time_equal(&supplied, &expected) {
        return Err(invalid("Cursor signature is invalid"));
    }
    Ok(())
}

pub(crate) fn store_epoch(connection: &Connection) -> Result<String, StoreError> {
    connection
        .query_row(
            "SELECT store_epoch FROM block_store_metadata WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .optional()?
        .ok_or_else(|| corrupt("Block store epoch is unavailable"))
}

fn validate_subject(subject: CollectionCursorSubject<'_>) -> Result<(), StoreError> {
    if !bounded_identity(subject.kind, MAX_CURSOR_KIND_BYTES)
        || !bounded_identity(subject.library_id, MAX_IDENTITY_BYTES)
        || subject.query_fingerprint.len() != SHA256_HEX_BYTES
        || !subject
            .query_fingerprint
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(invalid("Collection cursor subject is invalid"));
    }
    Ok(())
}

fn validate_coordinate(coordinate: &KeysetCoordinate) -> Result<(), StoreError> {
    if coordinate.values.len() > MAX_KEYSET_VALUES
        || !bounded_identity(&coordinate.stable_id, MAX_IDENTITY_BYTES)
        || coordinate.values.iter().any(|value| {
            matches!(
                value,
                KeysetValue::Text { value }
                    if value.len() > MAX_IDENTITY_BYTES
            ) || matches!(
                value,
                KeysetValue::Real { value }
                    if value.len() > 64
                        || value
                            .parse::<f64>()
                            .ok()
                            .is_none_or(|number| !number.is_finite())
            )
        })
    {
        return Err(invalid("Collection cursor coordinate is invalid"));
    }
    Ok(())
}

fn bounded_identity(value: &str, maximum_bytes: usize) -> bool {
    !value.is_empty() && value.len() <= maximum_bytes && value.trim() == value
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

fn corrupt(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message, false)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn connection() -> Connection {
        let connection = Connection::open_in_memory().expect("memory Store");
        connection
            .execute_batch(
                "CREATE TABLE block_store_metadata(\
                   id INTEGER PRIMARY KEY, store_epoch TEXT NOT NULL\
                 );\
                 CREATE TABLE nodex_agent_token_keys(\
                   id INTEGER PRIMARY KEY, key_material BLOB NOT NULL\
                 );\
                 INSERT INTO block_store_metadata(id, store_epoch) VALUES (1, 'epoch-1');\
                 INSERT INTO nodex_agent_token_keys(id, key_material) VALUES (1, zeroblob(32));",
            )
            .expect("cursor authority fixture");
        connection
    }

    fn subject(fingerprint: &str) -> CollectionCursorSubject<'_> {
        CollectionCursorSubject {
            kind: "workspace_tasks",
            library_id: "library-1",
            query_fingerprint: fingerprint,
        }
    }

    #[test]
    fn signed_keyset_cursor_round_trips_without_exposing_an_offset() {
        let connection = connection();
        let fingerprint = query_fingerprint(&("project-1", "active")).expect("fingerprint");
        let coordinate = KeysetCoordinate {
            values: vec![
                KeysetValue::Integer { value: 42 },
                KeysetValue::Text {
                    value: "2026-07-25T00:00:00Z".to_owned(),
                },
                KeysetValue::Null,
            ],
            stable_id: "thread-7".to_owned(),
        };

        let cursor = mint(
            &connection,
            subject(&fingerprint),
            CursorDirection::Forward,
            coordinate.clone(),
        )
        .expect("signed cursor");
        let decoded = decode(&connection, &cursor, subject(&fingerprint)).expect("valid cursor");

        assert_eq!(decoded, (CursorDirection::Forward, coordinate));
        assert!(cursor.len() <= MAX_COLLECTION_CURSOR_BYTES);
        assert!(!cursor.contains("offset"));
    }

    #[test]
    fn cursor_rejects_tampering_and_another_query() {
        let connection = connection();
        let fingerprint = query_fingerprint(&("project-1", "active")).expect("fingerprint");
        let cursor = mint(
            &connection,
            subject(&fingerprint),
            CursorDirection::Forward,
            KeysetCoordinate {
                values: vec![KeysetValue::Integer { value: 42 }],
                stable_id: "thread-7".to_owned(),
            },
        )
        .expect("signed cursor");
        let mut tampered = cursor.into_bytes();
        let index = tampered.len() / 2;
        tampered[index] = if tampered[index] == b'a' { b'b' } else { b'a' };
        let tampered = String::from_utf8(tampered).expect("ASCII cursor");

        assert_eq!(
            decode(&connection, &tampered, subject(&fingerprint))
                .expect_err("tampering must fail")
                .code,
            StoreErrorCode::InvalidInput
        );
        let other = query_fingerprint(&("project-2", "active")).expect("other fingerprint");
        assert_eq!(
            decode(
                &connection,
                &mint(
                    &connection,
                    subject(&fingerprint),
                    CursorDirection::Forward,
                    KeysetCoordinate {
                        values: Vec::new(),
                        stable_id: "thread-7".to_owned(),
                    },
                )
                .expect("signed cursor"),
                subject(&other),
            )
            .expect_err("query mismatch must fail")
            .code,
            StoreErrorCode::InvalidInput
        );
    }

    #[test]
    fn cursor_survives_data_mutations_and_fences_store_epoch() {
        let connection = connection();
        let fingerprint = query_fingerprint(&("project-1", "active")).expect("fingerprint");
        let coordinate = KeysetCoordinate {
            values: Vec::new(),
            stable_id: "thread-7".to_owned(),
        };
        let cursor = mint(
            &connection,
            subject(&fingerprint),
            CursorDirection::Forward,
            coordinate.clone(),
        )
        .expect("signed cursor");

        // A keyset cursor is a coordinate, not a snapshot claim: arbitrary data
        // mutations between windows must not invalidate it.
        connection
            .execute_batch(
                "CREATE TABLE change_log(seq INTEGER PRIMARY KEY AUTOINCREMENT);\
                 INSERT INTO change_log DEFAULT VALUES;\
                 INSERT INTO change_log DEFAULT VALUES;",
            )
            .expect("unrelated writes");
        assert_eq!(
            decode(&connection, &cursor, subject(&fingerprint)).expect("cursor stays valid"),
            (CursorDirection::Forward, coordinate)
        );

        connection
            .execute(
                "UPDATE block_store_metadata SET store_epoch = 'epoch-2' WHERE id = 1",
                [],
            )
            .expect("rotate Store epoch");
        assert_eq!(
            decode(&connection, &cursor, subject(&fingerprint))
                .expect_err("Store epoch mismatch must fail")
                .code,
            StoreErrorCode::StaleStoreEpoch
        );
    }
}
