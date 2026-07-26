use std::collections::BTreeMap;

use nodex_core_contracts::BoundModuleContext;
use nodex_core_contracts::automation::{
    AutomationIntent, ReminderLease, ReminderLeaseStatus, ReminderSnooze,
};
use nodex_core_contracts::collection::{
    CollectionWindow, CollectionWindowAuthority, CollectionWindowRequest,
};
use rusqlite::{Connection, OptionalExtension, params};
use sha2::{Digest, Sha256};

use crate::infrastructure::collection_window::{WindowCandidate, assemble, normalize_request};
use crate::infrastructure::cursor::{
    self, CollectionCursorSubject, CursorDirection, KeysetCoordinate, KeysetValue,
};
use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};

const CATCH_UP_WINDOW_MS: i64 = 7 * 24 * 60 * 60 * 1_000;
const LOOK_AHEAD_WINDOW_MS: i64 = 24 * 60 * 60 * 1_000;
const MAX_CLAIM_LIMIT: u32 = 100;
const MIN_LEASE_DURATION_MS: u64 = 1_000;
const MAX_LEASE_DURATION_MS: u64 = 24 * 60 * 60 * 1_000;
const MAX_RETRY_DELAY_MS: u64 = 7 * 24 * 60 * 60 * 1_000;
const MAX_SNOOZE_MINUTES: u32 = 365 * 24 * 60;
const MAX_REASON_CODE_BYTES: usize = 128;

pub(super) struct ReminderMutationEffects {
    pub operation_kind: &'static str,
    pub leases: Vec<ReminderLease>,
    pub snoozes: Vec<ReminderSnooze>,
    pub lease_ids: Vec<String>,
    pub snooze_ids: Vec<i64>,
    pub committed_at: String,
}

#[derive(Clone)]
struct ReminderCandidate {
    project_id: String,
    receipt_project_id: String,
    page_id: String,
    occurrence_start_ms: i64,
    reminder_offset_minutes: i32,
    due_at_ms: i64,
    title: String,
    snooze_id: Option<i64>,
}

type ReminderCoordinate = (String, String, i64, i32);
type ReminderCandidates = BTreeMap<ReminderCoordinate, ReminderCandidate>;

impl ReminderCandidate {
    fn coordinate(&self) -> ReminderCoordinate {
        (
            self.receipt_project_id.clone(),
            self.page_id.clone(),
            self.occurrence_start_ms,
            self.reminder_offset_minutes,
        )
    }
}

pub(super) fn read_lease_window(
    connection: &Connection,
    library_id: &str,
    event_head: i64,
    project_id: Option<&str>,
    include_settled: bool,
    request: &CollectionWindowRequest,
) -> Result<CollectionWindow<ReminderLease>, StoreError> {
    let normalized = normalize_request(request)?;
    let fingerprint =
        cursor::query_fingerprint(&("reminder_leases_v1", project_id, include_settled))?;
    let subject = CollectionCursorSubject {
        kind: "reminder_leases",
        library_id,
        query_fingerprint: &fingerprint,
    };
    let after = normalized
        .after
        .map(|encoded| cursor::decode(connection, encoded, subject))
        .transpose()?
        .map(|(direction, coordinate)| {
            if direction != CursorDirection::Forward || coordinate.values.len() != 2 {
                return Err(invalid("Reminder lease cursor is incompatible"));
            }
            let [
                KeysetValue::Integer { value: due_at_ms },
                KeysetValue::Integer { value: attempt },
            ] = coordinate.values.as_slice()
            else {
                return Err(invalid("Reminder lease cursor coordinate is invalid"));
            };
            Ok((*due_at_ms, *attempt, coordinate.stable_id))
        })
        .transpose()?;
    let mut statement = connection.prepare(
        "SELECT lease_id, project_id, receipt_project_id, page_id, occurrence_start_ms, \
           reminder_offset_minutes, due_at_ms, title, snooze_id, attempt, status, \
           claimed_at_ms, expires_at_ms, settled_at_ms, retry_at_ms, reason_code \
         FROM core_reminder_leases \
         WHERE (?1 IS NULL OR project_id = ?1) AND (?2 OR status = 'claimed') \
           AND (?3 IS NULL OR due_at_ms < ?3 \
             OR (due_at_ms = ?3 AND attempt < ?4) \
             OR (due_at_ms = ?3 AND attempt = ?4 AND lease_id < ?5)) \
         ORDER BY due_at_ms DESC, attempt DESC, lease_id DESC LIMIT ?6",
    )?;
    let rows = statement
        .query_map(
            params![
                project_id,
                include_settled,
                after.as_ref().map(|value| value.0),
                after.as_ref().map(|value| value.1),
                after.as_ref().map(|value| value.2.as_str()),
                i64::try_from(normalized.first + 1)
                    .map_err(|_| invalid("Reminder lease window size is invalid"))?,
            ],
            lease_from_row,
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?
        .into_iter()
        .map(validate_lease)
        .collect::<Result<Vec<_>, _>>()?;
    let candidates = rows.into_iter().map(|item| WindowCandidate {
        coordinate: KeysetCoordinate {
            values: vec![
                KeysetValue::Integer {
                    value: item.due_at_ms,
                },
                KeysetValue::Integer {
                    value: i64::from(item.attempt),
                },
            ],
            stable_id: item.lease_id.clone(),
        },
        item,
    });
    assemble(
        candidates,
        normalized.first,
        CollectionWindowAuthority {
            projection_revision: event_head,
        },
        |coordinate| {
            cursor::mint(
                connection,
                subject,
                CursorDirection::Forward,
                coordinate.clone(),
            )
        },
    )
}

pub(super) fn read_snooze_window(
    connection: &Connection,
    library_id: &str,
    event_head: i64,
    project_id: Option<&str>,
    include_consumed: bool,
    request: &CollectionWindowRequest,
) -> Result<CollectionWindow<ReminderSnooze>, StoreError> {
    let normalized = normalize_request(request)?;
    let fingerprint =
        cursor::query_fingerprint(&("reminder_snoozes_v1", project_id, include_consumed))?;
    let subject = CollectionCursorSubject {
        kind: "reminder_snoozes",
        library_id,
        query_fingerprint: &fingerprint,
    };
    let after = normalized
        .after
        .map(|encoded| cursor::decode(connection, encoded, subject))
        .transpose()?
        .map(|(direction, coordinate)| {
            if direction != CursorDirection::Forward || coordinate.values.len() != 1 {
                return Err(invalid("Reminder snooze cursor is incompatible"));
            }
            let [KeysetValue::Text { value: due_at }] = coordinate.values.as_slice() else {
                return Err(invalid("Reminder snooze cursor coordinate is invalid"));
            };
            let snooze_id = coordinate
                .stable_id
                .parse::<i64>()
                .map_err(|_| invalid("Reminder snooze cursor identity is invalid"))?;
            Ok((due_at.clone(), snooze_id))
        })
        .transpose()?;
    let mut statement = connection.prepare(
        "SELECT id, project_id, page_id, occurrence_start, due_at, created_at, consumed_at \
         FROM reminder_snoozes \
         WHERE (?1 IS NULL OR project_id = ?1) AND (?2 OR consumed_at IS NULL) \
           AND (?3 IS NULL OR due_at < ?3 OR (due_at = ?3 AND id < ?4)) \
         ORDER BY due_at DESC, id DESC LIMIT ?5",
    )?;
    let rows = statement
        .query_map(
            params![
                project_id,
                include_consumed,
                after.as_ref().map(|value| value.0.as_str()),
                after.as_ref().map(|value| value.1),
                i64::try_from(normalized.first + 1)
                    .map_err(|_| invalid("Reminder snooze window size is invalid"))?,
            ],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, Option<String>>(6)?,
                ))
            },
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?
        .into_iter()
        .map(
            |(id, project_id, page_id, occurrence, due, created, consumed)| {
                Ok(ReminderSnooze {
                    snooze_id: id,
                    project_id,
                    page_id,
                    occurrence_start_ms: parse_timestamp(&occurrence)?,
                    due_at_ms: parse_timestamp(&due)?,
                    created_at_ms: parse_timestamp(&created)?,
                    consumed_at_ms: consumed.as_deref().map(parse_timestamp).transpose()?,
                })
            },
        )
        .collect::<Result<Vec<_>, StoreError>>()?;
    let candidates = rows.into_iter().map(|item| WindowCandidate {
        coordinate: KeysetCoordinate {
            values: vec![KeysetValue::Text {
                value: timestamp_to_iso(item.due_at_ms)
                    .expect("validated reminder snooze timestamp"),
            }],
            stable_id: item.snooze_id.to_string(),
        },
        item,
    });
    assemble(
        candidates,
        normalized.first,
        CollectionWindowAuthority {
            projection_revision: event_head,
        },
        |coordinate| {
            cursor::mint(
                connection,
                subject,
                CursorDirection::Forward,
                coordinate.clone(),
            )
        },
    )
}

pub(super) fn apply(
    connection: &Connection,
    library_id: &str,
    context: &BoundModuleContext,
    operation_id: &str,
    intent: &AutomationIntent,
) -> Result<ReminderMutationEffects, StoreError> {
    match intent {
        AutomationIntent::SnoozeReminder {
            page_id,
            occurrence_start_ms,
            snooze_minutes,
        } => snooze(
            connection,
            library_id,
            context,
            page_id,
            *occurrence_start_ms,
            *snooze_minutes,
        ),
        AutomationIntent::ClaimDueReminders {
            limit,
            lease_duration_ms,
        } => claim_due(
            connection,
            library_id,
            operation_id,
            *limit,
            *lease_duration_ms,
        ),
        AutomationIntent::CompleteReminderLease { lease_id } => {
            settle(connection, lease_id, None, None)
        }
        AutomationIntent::FailReminderLease {
            lease_id,
            retry_delay_ms,
            reason_code,
        } => settle(connection, lease_id, *retry_delay_ms, Some(reason_code)),
        _ => Err(internal("Automation intent is not a reminder mutation")),
    }
}

fn snooze(
    connection: &Connection,
    library_id: &str,
    context: &BoundModuleContext,
    page_id: &str,
    occurrence_start_ms: i64,
    snooze_minutes: u32,
) -> Result<ReminderMutationEffects, StoreError> {
    if occurrence_start_ms < 0 || page_id.trim().is_empty() {
        return Err(invalid("Reminder snooze coordinate is invalid"));
    }
    let project_id = context
        .project_id
        .as_ref()
        .map(|value| value.0.as_str())
        .ok_or_else(|| unauthorized("Reminder snooze requires a bound Project"))?;
    let active = connection
        .query_row(
            "SELECT 1 FROM projects WHERE id = ?1 AND library_id = ?2 AND lifecycle = 'active'",
            params![project_id, library_id],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if !active {
        return Err(unauthorized(
            "Reminder snooze requires an active bound Project",
        ));
    }
    crate::library::require_page_read_access(connection, library_id, project_id, page_id)?;
    if snooze_minutes > MAX_SNOOZE_MINUTES {
        return Err(invalid("Reminder snooze duration exceeds its bound"));
    }
    let (now_ms, committed_at) = core_now(connection)?;
    let minutes = i64::from(snooze_minutes.max(1));
    let due_at_ms = now_ms
        .checked_add(
            minutes
                .checked_mul(60_000)
                .ok_or_else(|| invalid("Reminder snooze duration exceeds the timestamp range"))?,
        )
        .ok_or_else(|| invalid("Reminder snooze time exceeds the timestamp range"))?;
    connection.execute(
        "INSERT INTO reminder_snoozes( \
           project_id, page_id, occurrence_start, due_at, created_at, consumed_at \
         ) VALUES (?1, ?2, ?3, ?4, ?5, NULL)",
        params![
            project_id,
            page_id,
            timestamp_to_iso(occurrence_start_ms)?,
            timestamp_to_iso(due_at_ms)?,
            timestamp_to_iso(now_ms)?,
        ],
    )?;
    let snooze_id = connection.last_insert_rowid();
    let snooze = read_snooze(connection, snooze_id)?
        .ok_or_else(|| corrupt("Created reminder snooze is unavailable"))?;
    Ok(ReminderMutationEffects {
        operation_kind: "snooze_reminder",
        leases: Vec::new(),
        snoozes: vec![snooze],
        lease_ids: Vec::new(),
        snooze_ids: vec![snooze_id],
        committed_at,
    })
}

fn claim_due(
    connection: &Connection,
    library_id: &str,
    operation_id: &str,
    limit: u32,
    lease_duration_ms: u64,
) -> Result<ReminderMutationEffects, StoreError> {
    if !(1..=MAX_CLAIM_LIMIT).contains(&limit) {
        return Err(invalid("Reminder claim limit is invalid"));
    }
    if !(MIN_LEASE_DURATION_MS..=MAX_LEASE_DURATION_MS).contains(&lease_duration_ms) {
        return Err(invalid("Reminder lease duration is invalid"));
    }
    let (now_ms, committed_at) = core_now(connection)?;
    let expires_at_ms = now_ms
        .checked_add(
            i64::try_from(lease_duration_ms)
                .map_err(|_| invalid("Reminder lease duration exceeds the timestamp range"))?,
        )
        .ok_or_else(|| invalid("Reminder lease expiry exceeds the timestamp range"))?;
    let expired_ids = expire_claims(connection, now_ms)?;
    let mut candidates = collect_regular_candidates(connection, library_id, now_ms)?;
    let consumed_snooze_ids =
        collect_snooze_candidates(connection, library_id, now_ms, &mut candidates)?;
    let mut candidates = candidates.into_values().collect::<Vec<_>>();
    candidates.sort_by(|left, right| {
        left.due_at_ms
            .cmp(&right.due_at_ms)
            .then_with(|| left.page_id.cmp(&right.page_id))
            .then_with(|| left.occurrence_start_ms.cmp(&right.occurrence_start_ms))
            .then_with(|| {
                left.reminder_offset_minutes
                    .cmp(&right.reminder_offset_minutes)
            })
    });

    let mut leases = Vec::new();
    let mut affected_ids = expired_ids;
    for candidate in candidates {
        if leases.len() >= limit as usize {
            break;
        }
        if coordinate_is_blocked(connection, &candidate, now_ms)? {
            continue;
        }
        let attempt: i64 = connection.query_row(
            "SELECT COALESCE(max(attempt), 0) + 1 FROM core_reminder_leases \
             WHERE receipt_project_id = ?1 AND page_id = ?2 AND occurrence_start_ms = ?3 \
               AND reminder_offset_minutes = ?4",
            params![
                candidate.receipt_project_id,
                candidate.page_id,
                candidate.occurrence_start_ms,
                candidate.reminder_offset_minutes,
            ],
            |row| row.get(0),
        )?;
        let attempt = u32::try_from(attempt)
            .map_err(|_| corrupt("Reminder lease attempt exceeds its bound"))?;
        let lease_id = lease_id(operation_id, &candidate, attempt);
        connection.execute(
            "INSERT INTO core_reminder_leases( \
               lease_id, project_id, receipt_project_id, page_id, occurrence_start_ms, \
               reminder_offset_minutes, due_at_ms, title, snooze_id, attempt, status, \
               claimed_at_ms, expires_at_ms, settled_at_ms, retry_at_ms, reason_code \
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'claimed', \
               ?11, ?12, NULL, NULL, NULL)",
            params![
                lease_id,
                candidate.project_id,
                candidate.receipt_project_id,
                candidate.page_id,
                candidate.occurrence_start_ms,
                candidate.reminder_offset_minutes,
                candidate.due_at_ms,
                candidate.title,
                candidate.snooze_id,
                attempt,
                now_ms,
                expires_at_ms,
            ],
        )?;
        let lease = read_lease(connection, &lease_id)?
            .ok_or_else(|| corrupt("Claimed reminder lease is unavailable"))?;
        affected_ids.push(lease_id);
        leases.push(lease);
    }
    affected_ids.sort();
    affected_ids.dedup();
    let consumed_snoozes = consumed_snooze_ids
        .iter()
        .map(|snooze_id| {
            read_snooze(connection, *snooze_id)?
                .ok_or_else(|| corrupt("Consumed reminder snooze is unavailable"))
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(ReminderMutationEffects {
        operation_kind: "claim_due_reminders",
        leases,
        snoozes: consumed_snoozes,
        lease_ids: affected_ids,
        snooze_ids: consumed_snooze_ids,
        committed_at,
    })
}

fn collect_regular_candidates(
    connection: &Connection,
    library_id: &str,
    now_ms: i64,
) -> Result<ReminderCandidates, StoreError> {
    let window_start = now_ms
        .checked_sub(CATCH_UP_WINDOW_MS)
        .ok_or_else(|| corrupt("Reminder catch-up window exceeds the timestamp range"))?;
    let window_end = now_ms
        .checked_add(LOOK_AHEAD_WINDOW_MS)
        .ok_or_else(|| corrupt("Reminder look-ahead window exceeds the timestamp range"))?;
    let projects = {
        let mut statement = connection.prepare(
            "SELECT id FROM projects WHERE library_id = ?1 AND lifecycle = 'active' ORDER BY id",
        )?;
        statement
            .query_map([library_id], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };
    let mut global = BTreeMap::new();
    for project_id in projects {
        let occurrences = super::occurrence::read_occurrences_for_reminders(
            connection,
            library_id,
            &project_id,
            window_start,
            window_end,
        )?;
        let mut by_occurrence = BTreeMap::<(String, i64), ReminderCandidate>::new();
        for occurrence in occurrences {
            let (receipt_project_id, _) =
                super::occurrence::read_current_page_title(connection, &occurrence.page_id)?;
            for reminder in &occurrence.reminders {
                let due_at_ms = occurrence
                    .occurrence_start_ms
                    .checked_sub(i64::from(reminder.offset_minutes) * 60_000)
                    .ok_or_else(|| corrupt("Reminder due time exceeds the timestamp range"))?;
                if due_at_ms > now_ms || due_at_ms < window_start {
                    continue;
                }
                if receipt_exists(
                    connection,
                    &receipt_project_id,
                    &occurrence.page_id,
                    occurrence.occurrence_start_ms,
                    reminder.offset_minutes,
                )? {
                    continue;
                }
                let candidate = ReminderCandidate {
                    project_id: project_id.clone(),
                    receipt_project_id: receipt_project_id.clone(),
                    page_id: occurrence.page_id.clone(),
                    occurrence_start_ms: occurrence.occurrence_start_ms,
                    reminder_offset_minutes: reminder.offset_minutes,
                    due_at_ms,
                    title: occurrence.title.clone(),
                    snooze_id: None,
                };
                let key = (occurrence.page_id.clone(), occurrence.occurrence_start_ms);
                let current = by_occurrence.get(&key);
                if current.is_none_or(|current| candidate.due_at_ms > current.due_at_ms) {
                    by_occurrence.insert(key, candidate);
                }
            }
        }
        for candidate in by_occurrence.into_values() {
            let coordinate = candidate.coordinate();
            let current = global.get(&coordinate);
            let prefer_owner = candidate.project_id == candidate.receipt_project_id
                && current.is_some_and(|value: &ReminderCandidate| {
                    value.project_id != value.receipt_project_id
                });
            if current.is_none() || prefer_owner {
                global.insert(coordinate, candidate);
            }
        }
    }
    Ok(global)
}

fn collect_snooze_candidates(
    connection: &Connection,
    library_id: &str,
    now_ms: i64,
    candidates: &mut ReminderCandidates,
) -> Result<Vec<i64>, StoreError> {
    let now_iso = timestamp_to_iso(now_ms)?;
    let rows = {
        let mut statement = connection.prepare(
            "SELECT snooze.id, snooze.project_id, snooze.page_id, \
               snooze.occurrence_start, snooze.due_at \
             FROM reminder_snoozes snooze \
             JOIN projects project ON project.id = snooze.project_id \
               AND project.library_id = ?1 AND project.lifecycle = 'active' \
             WHERE snooze.consumed_at IS NULL AND snooze.due_at <= ?2 \
             ORDER BY snooze.due_at, snooze.id",
        )?;
        statement
            .query_map(params![library_id, now_iso], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };
    let mut consumed_ids = Vec::new();
    for (snooze_id, project_id, page_id, occurrence, due) in rows {
        match crate::library::require_page_read_access(
            connection,
            library_id,
            &project_id,
            &page_id,
        ) {
            Ok(()) => {}
            Err(error)
                if matches!(
                    error.code,
                    StoreErrorCode::NotFound | StoreErrorCode::Unauthorized
                ) =>
            {
                continue;
            }
            Err(error) => return Err(error),
        }
        let occurrence_start_ms = parse_timestamp(&occurrence)?;
        let due_at_ms = parse_timestamp(&due)?;
        let (receipt_project_id, title) =
            super::occurrence::read_current_page_title(connection, &page_id)?;
        if receipt_exists(
            connection,
            &receipt_project_id,
            &page_id,
            occurrence_start_ms,
            -1,
        )? {
            connection.execute(
                "UPDATE reminder_snoozes SET consumed_at = ?1 WHERE id = ?2",
                params![now_iso, snooze_id],
            )?;
            consumed_ids.push(snooze_id);
            continue;
        }
        let candidate = ReminderCandidate {
            project_id,
            receipt_project_id,
            page_id,
            occurrence_start_ms,
            reminder_offset_minutes: -1,
            due_at_ms,
            title,
            snooze_id: Some(snooze_id),
        };
        candidates
            .entry(candidate.coordinate())
            .or_insert(candidate);
    }
    Ok(consumed_ids)
}

fn settle(
    connection: &Connection,
    lease_id: &str,
    retry_delay_ms: Option<u64>,
    reason_code: Option<&str>,
) -> Result<ReminderMutationEffects, StoreError> {
    let lease = read_lease(connection, lease_id)?
        .ok_or_else(|| not_found("Reminder lease is unavailable"))?;
    if lease.status != ReminderLeaseStatus::Claimed {
        return Err(conflict("Reminder lease is already settled"));
    }
    let failed = reason_code.is_some();
    if !failed && retry_delay_ms.is_some() {
        return Err(invalid("Completed reminder lease cannot own a retry delay"));
    }
    let reason_code = reason_code.map(normalize_reason_code).transpose()?;
    let delay = retry_delay_ms.unwrap_or(0);
    if delay > MAX_RETRY_DELAY_MS {
        return Err(invalid("Reminder retry delay exceeds its bound"));
    }
    let (now_ms, committed_at) = core_now(connection)?;
    if lease.expires_at_ms <= now_ms {
        return Err(conflict("Reminder lease expired before settlement"));
    }
    let consumed_snooze_ids = if !failed && lease.reminder_offset_minutes == -1 {
        let occurrence_start = timestamp_to_iso(lease.occurrence_start_ms)?;
        let now = timestamp_to_iso(now_ms)?;
        let mut statement = connection.prepare(
            "SELECT id FROM reminder_snoozes \
             WHERE page_id = ?1 AND occurrence_start = ?2 AND consumed_at IS NULL \
               AND due_at <= ?3 ORDER BY id",
        )?;
        statement
            .query_map(params![lease.page_id, occurrence_start, now], |row| {
                row.get::<_, i64>(0)
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?
    } else {
        Vec::new()
    };
    let retry_at_ms = failed
        .then(|| {
            now_ms
                .checked_add(
                    i64::try_from(delay)
                        .map_err(|_| invalid("Reminder retry delay exceeds the timestamp range"))?,
                )
                .ok_or_else(|| invalid("Reminder retry time exceeds the timestamp range"))
        })
        .transpose()?;
    if !failed {
        connection.execute(
            "INSERT OR IGNORE INTO reminder_receipts( \
               project_id, page_id, occurrence_start, reminder_offset_minutes, delivered_at \
             ) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                lease.receipt_project_id,
                lease.page_id,
                timestamp_to_iso(lease.occurrence_start_ms)?,
                lease.reminder_offset_minutes,
                timestamp_to_iso(now_ms)?,
            ],
        )?;
        if lease.reminder_offset_minutes == -1 {
            connection.execute(
                "UPDATE reminder_snoozes SET consumed_at = ?1 \
                 WHERE page_id = ?2 AND occurrence_start = ?3 AND consumed_at IS NULL \
                   AND due_at <= ?1",
                params![
                    timestamp_to_iso(now_ms)?,
                    lease.page_id,
                    timestamp_to_iso(lease.occurrence_start_ms)?,
                ],
            )?;
        }
    }
    connection.execute(
        "UPDATE core_reminder_leases SET status = ?1, settled_at_ms = ?2, \
           retry_at_ms = ?3, reason_code = ?4 WHERE lease_id = ?5 AND status = 'claimed'",
        params![
            if failed { "failed" } else { "completed" },
            now_ms,
            retry_at_ms,
            reason_code,
            lease_id,
        ],
    )?;
    let stored = read_lease(connection, lease_id)?
        .ok_or_else(|| corrupt("Settled reminder lease is unavailable"))?;
    let snoozes = consumed_snooze_ids
        .iter()
        .map(|snooze_id| {
            read_snooze(connection, *snooze_id)?
                .ok_or_else(|| corrupt("Consumed reminder snooze is unavailable"))
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(ReminderMutationEffects {
        operation_kind: if failed {
            "fail_reminder_lease"
        } else {
            "complete_reminder_lease"
        },
        leases: vec![stored],
        snoozes,
        lease_ids: vec![lease_id.to_owned()],
        snooze_ids: consumed_snooze_ids,
        committed_at,
    })
}

fn expire_claims(connection: &Connection, now_ms: i64) -> Result<Vec<String>, StoreError> {
    let ids = {
        let mut statement = connection.prepare(
            "SELECT lease_id FROM core_reminder_leases \
             WHERE status = 'claimed' AND expires_at_ms <= ?1 ORDER BY lease_id",
        )?;
        statement
            .query_map([now_ms], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };
    connection.execute(
        "UPDATE core_reminder_leases SET status = 'failed', settled_at_ms = ?1, \
           retry_at_ms = ?1, reason_code = 'lease_expired' \
         WHERE status = 'claimed' AND expires_at_ms <= ?1",
        [now_ms],
    )?;
    Ok(ids)
}

fn coordinate_is_blocked(
    connection: &Connection,
    candidate: &ReminderCandidate,
    now_ms: i64,
) -> Result<bool, StoreError> {
    let row = connection
        .query_row(
            "SELECT status, retry_at_ms FROM core_reminder_leases \
             WHERE receipt_project_id = ?1 AND page_id = ?2 AND occurrence_start_ms = ?3 \
               AND reminder_offset_minutes = ?4 \
             ORDER BY attempt DESC LIMIT 1",
            params![
                candidate.receipt_project_id,
                candidate.page_id,
                candidate.occurrence_start_ms,
                candidate.reminder_offset_minutes,
            ],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<i64>>(1)?)),
        )
        .optional()?;
    Ok(match row {
        None => false,
        Some((status, _)) if status == "claimed" || status == "completed" => true,
        Some((_, Some(retry_at_ms))) => retry_at_ms > now_ms,
        Some((_, None)) => false,
    })
}

fn receipt_exists(
    connection: &Connection,
    project_id: &str,
    page_id: &str,
    occurrence_start_ms: i64,
    offset_minutes: i32,
) -> Result<bool, StoreError> {
    Ok(connection
        .query_row(
            "SELECT 1 FROM reminder_receipts WHERE project_id = ?1 AND page_id = ?2 \
               AND occurrence_start = ?3 AND reminder_offset_minutes = ?4",
            params![
                project_id,
                page_id,
                timestamp_to_iso(occurrence_start_ms)?,
                offset_minutes,
            ],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

fn read_snooze(
    connection: &Connection,
    snooze_id: i64,
) -> Result<Option<ReminderSnooze>, StoreError> {
    connection
        .query_row(
            "SELECT id, project_id, page_id, occurrence_start, due_at, created_at, consumed_at \
             FROM reminder_snoozes WHERE id = ?1",
            [snooze_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, Option<String>>(6)?,
                ))
            },
        )
        .optional()?
        .map(
            |(id, project_id, page_id, occurrence, due, created, consumed)| {
                Ok(ReminderSnooze {
                    snooze_id: id,
                    project_id,
                    page_id,
                    occurrence_start_ms: parse_timestamp(&occurrence)?,
                    due_at_ms: parse_timestamp(&due)?,
                    created_at_ms: parse_timestamp(&created)?,
                    consumed_at_ms: consumed.as_deref().map(parse_timestamp).transpose()?,
                })
            },
        )
        .transpose()
}

fn read_lease(
    connection: &Connection,
    lease_id: &str,
) -> Result<Option<ReminderLease>, StoreError> {
    connection
        .query_row(
            "SELECT lease_id, project_id, receipt_project_id, page_id, occurrence_start_ms, \
               reminder_offset_minutes, due_at_ms, title, snooze_id, attempt, status, \
               claimed_at_ms, expires_at_ms, settled_at_ms, retry_at_ms, reason_code \
             FROM core_reminder_leases WHERE lease_id = ?1",
            [lease_id],
            lease_from_row,
        )
        .optional()?
        .map(validate_lease)
        .transpose()
}

fn lease_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ReminderLease> {
    let attempt = u32::try_from(row.get::<_, i64>(9)?).map_err(|_| {
        rusqlite::Error::FromSqlConversionFailure(
            9,
            rusqlite::types::Type::Integer,
            "Reminder lease attempt is invalid".into(),
        )
    })?;
    Ok(ReminderLease {
        lease_id: row.get(0)?,
        project_id: row.get(1)?,
        receipt_project_id: row.get(2)?,
        page_id: row.get(3)?,
        occurrence_start_ms: row.get(4)?,
        reminder_offset_minutes: row.get(5)?,
        due_at_ms: row.get(6)?,
        title: row.get(7)?,
        snooze_id: row.get(8)?,
        attempt,
        status: parse_status(&row.get::<_, String>(10)?).map_err(|message| {
            rusqlite::Error::FromSqlConversionFailure(
                10,
                rusqlite::types::Type::Text,
                message.into(),
            )
        })?,
        claimed_at_ms: row.get(11)?,
        expires_at_ms: row.get(12)?,
        settled_at_ms: row.get(13)?,
        retry_at_ms: row.get(14)?,
        reason_code: row.get(15)?,
    })
}

fn validate_lease(lease: ReminderLease) -> Result<ReminderLease, StoreError> {
    if lease.lease_id.is_empty()
        || lease.project_id.is_empty()
        || lease.receipt_project_id.is_empty()
        || lease.page_id.is_empty()
        || lease.occurrence_start_ms < 0
        || lease.due_at_ms < 0
        || lease.attempt == 0
        || lease.claimed_at_ms < 0
        || lease.expires_at_ms <= lease.claimed_at_ms
    {
        return Err(corrupt("Stored reminder lease is invalid"));
    }
    Ok(lease)
}

fn parse_status(value: &str) -> Result<ReminderLeaseStatus, String> {
    match value {
        "claimed" => Ok(ReminderLeaseStatus::Claimed),
        "completed" => Ok(ReminderLeaseStatus::Completed),
        "failed" => Ok(ReminderLeaseStatus::Failed),
        "cancelled" => Ok(ReminderLeaseStatus::Cancelled),
        _ => Err("Reminder lease status is invalid".to_owned()),
    }
}

fn core_now(connection: &Connection) -> Result<(i64, String), StoreError> {
    connection
        .query_row(
            "SELECT CAST(unixepoch('subsec') * 1000 AS INTEGER), \
                    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
            [],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
        )
        .map_err(Into::into)
}

fn timestamp_to_iso(timestamp_ms: i64) -> Result<String, StoreError> {
    super::occurrence::timestamp_to_iso(timestamp_ms)
}

fn parse_timestamp(value: &str) -> Result<i64, StoreError> {
    chrono::DateTime::parse_from_rfc3339(value)
        .map(|value| value.timestamp_millis())
        .map_err(|_| corrupt("Reminder timestamp is invalid"))
}

fn lease_id(operation_id: &str, candidate: &ReminderCandidate, attempt: u32) -> String {
    let digest = Sha256::digest(
        format!(
            "{operation_id}:{}:{}:{}:{}:{attempt}",
            candidate.receipt_project_id,
            candidate.page_id,
            candidate.occurrence_start_ms,
            candidate.reminder_offset_minutes,
        )
        .as_bytes(),
    );
    format!("reminder-lease:{}", hex_digest(&digest))
}

fn hex_digest(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut result = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        result.push(char::from(HEX[usize::from(byte >> 4)]));
        result.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    result
}

fn normalize_reason_code(value: &str) -> Result<String, StoreError> {
    let value = value.trim();
    if value.is_empty() || value.len() > MAX_REASON_CODE_BYTES {
        return Err(invalid("Reminder failure reason code is invalid"));
    }
    Ok(value.to_owned())
}

fn invalid(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::InvalidInput, message, false)
}

fn unauthorized(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::Unauthorized, message, false)
}

fn not_found(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::NotFound, message, false)
}

fn conflict(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::RevisionConflict, message, true)
}

fn corrupt(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message, false)
}

fn internal(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::Internal, message, false)
}
