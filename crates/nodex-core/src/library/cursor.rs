use rusqlite::Connection;

pub(crate) use crate::infrastructure::cursor::{KeysetCoordinate, KeysetValue};
use crate::infrastructure::{
    cursor::{self as signed_cursor, CollectionCursorSubject, CursorDirection},
    sqlite::{StoreError, StoreErrorCode},
};

const CURSOR_KIND: &str = "library_collection";

pub(crate) fn mint(
    connection: &Connection,
    library_id: &str,
    subject: &[String],
    coordinate: KeysetCoordinate,
    change_log_seq: i64,
) -> Result<String, StoreError> {
    let fingerprint = fingerprint(subject)?;
    signed_cursor::mint(
        connection,
        CollectionCursorSubject {
            kind: CURSOR_KIND,
            library_id,
            query_fingerprint: &fingerprint,
            projection_revision: change_log_seq,
        },
        CursorDirection::Forward,
        coordinate,
    )
}

pub(crate) fn decode(
    connection: &Connection,
    encoded: &str,
    library_id: &str,
    subject: &[String],
    change_log_seq: i64,
) -> Result<KeysetCoordinate, StoreError> {
    let fingerprint = fingerprint(subject)?;
    let (direction, coordinate) = signed_cursor::decode(
        connection,
        encoded,
        CollectionCursorSubject {
            kind: CURSOR_KIND,
            library_id,
            query_fingerprint: &fingerprint,
            projection_revision: change_log_seq,
        },
    )?;
    if direction != CursorDirection::Forward {
        return Err(invalid("Library cursor direction is invalid"));
    }
    Ok(coordinate)
}

fn fingerprint(subject: &[String]) -> Result<String, StoreError> {
    if subject.is_empty()
        || subject.len() > 8
        || subject
            .iter()
            .any(|part| part.is_empty() || part.len() > 512)
    {
        return Err(invalid("Library cursor subject is invalid"));
    }
    signed_cursor::query_fingerprint(&("library_collection_v2", subject))
}

fn invalid(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::InvalidInput, message, false)
}
