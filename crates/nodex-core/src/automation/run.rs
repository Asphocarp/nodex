use std::collections::BTreeSet;

use nodex_core_contracts::automation::{
    AutomationInboxItem, AutomationIntent, AutomationRun, AutomationRunBulkResult,
    AutomationRunStatus, AutomationRunUnreadCounts, AutomationUnreadRun,
};
use rusqlite::{Connection, OptionalExtension, params};

use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};

const MAX_ID_LENGTH: usize = 512;
const MAX_RUN_READ_LIMIT: u32 = 1_000;
const MAX_BULK_RUNS: usize = 1_000;
const MAX_TITLE_BYTES: usize = 16 * 1024;
const MAX_INBOX_SUMMARY_BYTES: usize = 64 * 1024;
const MAX_ARCHIVE_MESSAGE_BYTES: usize = 1024 * 1024;
const MAX_ARCHIVE_REASON_BYTES: usize = 512;

pub(super) struct RunMutationEffects {
    pub operation_kind: &'static str,
    pub automation_ids: Vec<String>,
    pub runs: Vec<AutomationRun>,
    pub deleted_run_ids: Vec<String>,
    pub run_ids: Vec<String>,
    pub bulk: Option<AutomationRunBulkResult>,
    pub committed_at: String,
}

pub(super) fn read_run(
    connection: &Connection,
    thread_id: &str,
) -> Result<Option<AutomationRun>, StoreError> {
    validate_id("thread_id", thread_id)?;
    let run = connection
        .query_row(
            "SELECT thread_id, automation_id, run_revision, status, read_at, thread_title, \
                    source_cwd, inbox_title, inbox_summary, archived_user_message, \
                    archived_assistant_message, archived_reason, created_at, updated_at \
             FROM codex_automation_runs WHERE thread_id = ?1",
            [thread_id],
            run_from_row,
        )
        .optional()
        .map_err(|_| corrupt("Automation run column types are invalid"))?;
    run.map(|run| validate_run(connection, run)).transpose()
}

pub(super) fn read_runs(
    connection: &Connection,
    automation_id: Option<&str>,
    include_archived: bool,
    limit: u32,
) -> Result<Vec<AutomationRun>, StoreError> {
    if let Some(automation_id) = automation_id {
        validate_id("automation_id", automation_id)?;
    }
    if !(1..=MAX_RUN_READ_LIMIT).contains(&limit) {
        return Err(invalid("Automation run read limit is invalid"));
    }
    let mut statement = connection.prepare(
        "SELECT thread_id, automation_id, run_revision, status, read_at, thread_title, \
                source_cwd, inbox_title, inbox_summary, archived_user_message, \
                archived_assistant_message, archived_reason, created_at, updated_at \
         FROM codex_automation_runs \
         WHERE (?1 IS NULL OR automation_id = ?1) AND (?2 OR status <> 'ARCHIVED') \
         ORDER BY created_at DESC, thread_id LIMIT ?3",
    )?;
    statement
        .query_map(
            params![automation_id, include_archived, limit],
            run_from_row,
        )?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|_| corrupt("Automation run column types are invalid"))?
        .into_iter()
        .map(|run| validate_run(connection, run))
        .collect()
}

pub(super) fn read_inbox(
    connection: &Connection,
    limit: u32,
) -> Result<(Vec<AutomationInboxItem>, AutomationRunUnreadCounts), StoreError> {
    if !(1..=MAX_RUN_READ_LIMIT).contains(&limit) {
        return Err(invalid("Automation inbox read limit is invalid"));
    }
    let mut statement = connection.prepare(
        "SELECT runs.automation_id, automations.name, \
                COALESCE(automations.name, NULLIF(runs.inbox_title, ''), runs.thread_title), \
                COALESCE(NULLIF(runs.inbox_summary, ''), runs.archived_assistant_message, \
                         runs.archived_user_message, automations.prompt), \
                runs.archived_assistant_message, runs.archived_user_message, \
                runs.archived_reason, runs.source_cwd, runs.thread_id, runs.read_at, \
                runs.created_at, runs.status \
         FROM codex_automation_runs runs \
         JOIN codex_scheduled_automations automations \
           ON automations.automation_id = runs.automation_id \
         ORDER BY runs.status = 'IN_PROGRESS' DESC, \
                  runs.status = 'PENDING_REVIEW' DESC, runs.created_at DESC, runs.thread_id \
         LIMIT ?1",
    )?;
    let items = statement
        .query_map([limit], inbox_from_row)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|_| corrupt("Automation inbox column types are invalid"))?
        .into_iter()
        .map(validate_inbox_item)
        .collect::<Result<Vec<_>, _>>()?;
    Ok((items, unread_counts(connection)?))
}

pub(super) fn apply(
    connection: &Connection,
    intent: &AutomationIntent,
) -> Result<RunMutationEffects, StoreError> {
    match intent {
        AutomationIntent::BeginRun {
            thread_id,
            automation_id,
            thread_title,
            source_cwd,
        } => begin_run(
            connection,
            thread_id,
            automation_id,
            thread_title.as_deref(),
            source_cwd.as_deref(),
        ),
        AutomationIntent::ReplacePendingRunThread {
            pending_thread_id,
            thread_id,
            expected_revision,
        } => replace_pending_thread(connection, pending_thread_id, thread_id, *expected_revision),
        AutomationIntent::SetRunThreadTitle {
            thread_id,
            expected_revision,
            thread_title,
        } => set_thread_title(
            connection,
            thread_id,
            *expected_revision,
            thread_title.as_deref(),
        ),
        AutomationIntent::CompleteRunForReview {
            thread_id,
            expected_revision,
            inbox_title,
            inbox_summary,
        } => complete_for_review(
            connection,
            thread_id,
            *expected_revision,
            inbox_title.as_deref(),
            inbox_summary.as_deref(),
        ),
        AutomationIntent::SetRunInboxItem {
            thread_id,
            expected_revision,
            inbox_title,
            inbox_summary,
        } => set_inbox_item(
            connection,
            thread_id,
            *expected_revision,
            inbox_title.as_deref(),
            inbox_summary.as_deref(),
        ),
        AutomationIntent::AcceptRun {
            thread_id,
            expected_revision,
        } => accept_run(connection, thread_id, *expected_revision),
        AutomationIntent::SetRunReadState {
            thread_id,
            expected_revision,
            read,
        } => set_read_state(connection, thread_id, *expected_revision, *read),
        AutomationIntent::MarkAllRunsRead => mark_all_read(connection),
        AutomationIntent::ArchiveRun {
            thread_id,
            expected_revision,
            archived_user_message,
            archived_assistant_message,
            archived_reason,
        } => archive_run(
            connection,
            thread_id,
            *expected_revision,
            archived_user_message.as_deref(),
            archived_assistant_message.as_deref(),
            archived_reason.as_deref(),
        ),
        AutomationIntent::UnarchiveRun {
            thread_id,
            expected_revision,
        } => unarchive_run(connection, thread_id, *expected_revision),
        AutomationIntent::DeleteRun {
            thread_id,
            expected_revision,
        } => delete_run(connection, thread_id, *expected_revision),
        AutomationIntent::SettleInterruptedRuns => settle_interrupted(connection),
        _ => Err(internal("Automation intent is not a run mutation")),
    }
}

pub(super) fn delete_for_automation(
    connection: &Connection,
    automation_id: &str,
) -> Result<Vec<String>, StoreError> {
    let mut statement = connection.prepare(
        "SELECT thread_id FROM codex_automation_runs \
         WHERE automation_id = ?1 ORDER BY thread_id",
    )?;
    let ids = statement
        .query_map([automation_id], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    drop(statement);
    connection.execute(
        "DELETE FROM codex_automation_runs WHERE automation_id = ?1",
        [automation_id],
    )?;
    Ok(ids)
}

fn begin_run(
    connection: &Connection,
    thread_id: &str,
    automation_id: &str,
    thread_title: Option<&str>,
    source_cwd: Option<&str>,
) -> Result<RunMutationEffects, StoreError> {
    validate_id("thread_id", thread_id)?;
    validate_id("automation_id", automation_id)?;
    require_definition(connection, automation_id)?;
    if read_run(connection, thread_id)?.is_some() {
        return Err(conflict("Automation run Thread already exists"));
    }
    if thread_id.starts_with("pending:") {
        validate_pending_thread_id(thread_id)?;
    } else {
        require_thread(connection, thread_id)?;
    }
    let thread_title = normalize_text(thread_title, MAX_TITLE_BYTES, "run thread title")?;
    let source_cwd = source_cwd
        .map(|value| super::mutation::normalize_absolute_path(value, "run source cwd"))
        .transpose()?;
    let (now_ms, committed_at) = core_now(connection)?;
    connection.execute(
        "INSERT INTO codex_automation_runs(\
           thread_id, automation_id, status, thread_title, source_cwd, created_at, updated_at, \
           run_revision\
         ) VALUES (?1, ?2, 'IN_PROGRESS', ?3, ?4, ?5, ?5, 1)",
        params![thread_id, automation_id, thread_title, source_cwd, now_ms],
    )?;
    single_run_effects(connection, "begin_run", thread_id, committed_at)
}

fn replace_pending_thread(
    connection: &Connection,
    pending_thread_id: &str,
    thread_id: &str,
    expected_revision: i64,
) -> Result<RunMutationEffects, StoreError> {
    validate_expected_revision(expected_revision)?;
    validate_id("pending_thread_id", pending_thread_id)?;
    validate_id("thread_id", thread_id)?;
    validate_pending_thread_id(pending_thread_id)?;
    if thread_id.starts_with("pending:") {
        return Err(invalid("Automation pending Thread replacement is invalid"));
    }
    require_thread(connection, thread_id)?;
    require_run_revision(connection, pending_thread_id, expected_revision)?;
    if read_run(connection, thread_id)?.is_some() {
        return Err(conflict("Automation run target Thread already exists"));
    }
    let (now_ms, committed_at) = core_now(connection)?;
    let changed = connection.execute(
        "UPDATE codex_automation_runs SET thread_id = ?1, updated_at = ?2, \
           run_revision = run_revision + 1 \
         WHERE thread_id = ?3 AND run_revision = ?4 AND status = 'IN_PROGRESS'",
        params![thread_id, now_ms, pending_thread_id, expected_revision],
    )?;
    if changed != 1 {
        return Err(conflict("Pending Automation run changed concurrently"));
    }
    let mut effects = single_run_effects(
        connection,
        "replace_pending_run_thread",
        thread_id,
        committed_at,
    )?;
    effects.run_ids.push(pending_thread_id.to_owned());
    effects.run_ids.sort();
    Ok(effects)
}

fn set_thread_title(
    connection: &Connection,
    thread_id: &str,
    expected_revision: i64,
    thread_title: Option<&str>,
) -> Result<RunMutationEffects, StoreError> {
    require_run_revision(connection, thread_id, expected_revision)?;
    let title = normalize_text(thread_title, MAX_TITLE_BYTES, "run thread title")?;
    let (now_ms, committed_at) = core_now(connection)?;
    update_one(
        connection,
        "UPDATE codex_automation_runs SET thread_title = ?1, updated_at = ?2, \
           run_revision = run_revision + 1 WHERE thread_id = ?3 AND run_revision = ?4",
        params![title, now_ms, thread_id, expected_revision],
        "Automation run changed concurrently",
    )?;
    single_run_effects(connection, "set_run_thread_title", thread_id, committed_at)
}

fn complete_for_review(
    connection: &Connection,
    thread_id: &str,
    expected_revision: i64,
    inbox_title: Option<&str>,
    inbox_summary: Option<&str>,
) -> Result<RunMutationEffects, StoreError> {
    let current = require_run_revision(connection, thread_id, expected_revision)?;
    if current.status != AutomationRunStatus::InProgress {
        return Err(conflict(
            "Only an in-progress Automation run can complete for review",
        ));
    }
    let title = normalize_text(inbox_title, MAX_TITLE_BYTES, "run inbox title")?;
    let summary = normalize_text(inbox_summary, MAX_INBOX_SUMMARY_BYTES, "run inbox summary")?;
    let (now_ms, committed_at) = core_now(connection)?;
    update_one(
        connection,
        "UPDATE codex_automation_runs SET status = 'PENDING_REVIEW', inbox_title = ?1, \
           inbox_summary = ?2, updated_at = ?3, run_revision = run_revision + 1 \
         WHERE thread_id = ?4 AND run_revision = ?5 AND status = 'IN_PROGRESS'",
        params![title, summary, now_ms, thread_id, expected_revision],
        "Automation run changed before review completion",
    )?;
    single_run_effects(
        connection,
        "complete_run_for_review",
        thread_id,
        committed_at,
    )
}

fn set_inbox_item(
    connection: &Connection,
    thread_id: &str,
    expected_revision: i64,
    inbox_title: Option<&str>,
    inbox_summary: Option<&str>,
) -> Result<RunMutationEffects, StoreError> {
    let current = require_run_revision(connection, thread_id, expected_revision)?;
    if current.status == AutomationRunStatus::Archived {
        return Err(conflict(
            "Archived Automation run inbox content is immutable",
        ));
    }
    let title = normalize_text(inbox_title, MAX_TITLE_BYTES, "run inbox title")?;
    let summary = normalize_text(inbox_summary, MAX_INBOX_SUMMARY_BYTES, "run inbox summary")?;
    let (now_ms, committed_at) = core_now(connection)?;
    update_one(
        connection,
        "UPDATE codex_automation_runs SET inbox_title = ?1, inbox_summary = ?2, \
           status = CASE WHEN status = 'IN_PROGRESS' THEN 'PENDING_REVIEW' ELSE status END, \
           updated_at = ?3, run_revision = run_revision + 1 \
         WHERE thread_id = ?4 AND run_revision = ?5 AND status <> 'ARCHIVED'",
        params![title, summary, now_ms, thread_id, expected_revision],
        "Automation run changed before inbox update",
    )?;
    single_run_effects(connection, "set_run_inbox_item", thread_id, committed_at)
}

fn accept_run(
    connection: &Connection,
    thread_id: &str,
    expected_revision: i64,
) -> Result<RunMutationEffects, StoreError> {
    let current = require_run_revision(connection, thread_id, expected_revision)?;
    if current.status == AutomationRunStatus::Archived {
        return Err(conflict("Archived Automation run cannot be accepted"));
    }
    let (now_ms, committed_at) = core_now(connection)?;
    update_one(
        connection,
        "UPDATE codex_automation_runs SET status = 'ACCEPTED', updated_at = ?1, \
           run_revision = run_revision + 1 \
         WHERE thread_id = ?2 AND run_revision = ?3 AND status <> 'ARCHIVED'",
        params![now_ms, thread_id, expected_revision],
        "Automation run changed before acceptance",
    )?;
    single_run_effects(connection, "accept_run", thread_id, committed_at)
}

fn set_read_state(
    connection: &Connection,
    thread_id: &str,
    expected_revision: i64,
    read: bool,
) -> Result<RunMutationEffects, StoreError> {
    require_run_revision(connection, thread_id, expected_revision)?;
    let (now_ms, committed_at) = core_now(connection)?;
    let read_at = read.then_some(now_ms);
    update_one(
        connection,
        "UPDATE codex_automation_runs SET read_at = ?1, run_revision = run_revision + 1 \
         WHERE thread_id = ?2 AND run_revision = ?3",
        params![read_at, thread_id, expected_revision],
        "Automation run changed before read-state update",
    )?;
    single_run_effects(connection, "set_run_read_state", thread_id, committed_at)
}

fn mark_all_read(connection: &Connection) -> Result<RunMutationEffects, StoreError> {
    let (now_ms, committed_at) = core_now(connection)?;
    let selected = select_run_ids(
        connection,
        "SELECT thread_id FROM codex_automation_runs \
         WHERE read_at IS NULL AND status IN ('PENDING_REVIEW', 'ACCEPTED', 'ARCHIVED') \
           AND updated_at <= ?1 \
         ORDER BY updated_at, thread_id LIMIT ?2",
        params![
            now_ms,
            i64::try_from(MAX_BULK_RUNS).expect("bound fits i64")
        ],
    )?;
    for thread_id in &selected {
        connection.execute(
            "UPDATE codex_automation_runs SET read_at = ?1, run_revision = run_revision + 1 \
             WHERE thread_id = ?2 AND read_at IS NULL",
            params![now_ms, thread_id],
        )?;
    }
    let runs = read_selected_runs(connection, &selected)?;
    let has_more = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM codex_automation_runs \
         WHERE read_at IS NULL AND status IN ('PENDING_REVIEW', 'ACCEPTED', 'ARCHIVED') \
           AND updated_at <= ?1)",
        [now_ms],
        |row| row.get::<_, bool>(0),
    )?;
    bulk_effects(
        "mark_all_runs_read",
        runs,
        AutomationRunBulkResult {
            changed_count: u32::try_from(selected.len()).expect("bounded selection fits u32"),
            archived_pending_count: 0,
            pending_review_count: 0,
            has_more,
        },
        committed_at,
    )
}

fn archive_run(
    connection: &Connection,
    thread_id: &str,
    expected_revision: i64,
    archived_user_message: Option<&str>,
    archived_assistant_message: Option<&str>,
    archived_reason: Option<&str>,
) -> Result<RunMutationEffects, StoreError> {
    require_run_revision(connection, thread_id, expected_revision)?;
    let user_message = normalize_text(
        archived_user_message,
        MAX_ARCHIVE_MESSAGE_BYTES,
        "archived user message",
    )?;
    let assistant_message = normalize_text(
        archived_assistant_message,
        MAX_ARCHIVE_MESSAGE_BYTES,
        "archived assistant message",
    )?;
    let reason = normalize_text(archived_reason, MAX_ARCHIVE_REASON_BYTES, "archive reason")?;
    let (now_ms, committed_at) = core_now(connection)?;
    update_one(
        connection,
        "UPDATE codex_automation_runs SET status = 'ARCHIVED', archived_user_message = ?1, \
           archived_assistant_message = ?2, archived_reason = COALESCE(archived_reason, ?3), \
           updated_at = ?4, run_revision = run_revision + 1 \
         WHERE thread_id = ?5 AND run_revision = ?6",
        params![
            user_message,
            assistant_message,
            reason,
            now_ms,
            thread_id,
            expected_revision
        ],
        "Automation run changed before archive",
    )?;
    single_run_effects(connection, "archive_run", thread_id, committed_at)
}

fn unarchive_run(
    connection: &Connection,
    thread_id: &str,
    expected_revision: i64,
) -> Result<RunMutationEffects, StoreError> {
    let current = require_run_revision(connection, thread_id, expected_revision)?;
    if current.status != AutomationRunStatus::Archived {
        return Err(conflict("Only an archived Automation run can be restored"));
    }
    let (now_ms, committed_at) = core_now(connection)?;
    update_one(
        connection,
        "UPDATE codex_automation_runs SET status = 'ACCEPTED', read_at = COALESCE(read_at, ?1), \
           archived_reason = NULL, updated_at = ?1, run_revision = run_revision + 1 \
         WHERE thread_id = ?2 AND run_revision = ?3 AND status = 'ARCHIVED'",
        params![now_ms, thread_id, expected_revision],
        "Automation run changed before restore",
    )?;
    single_run_effects(connection, "unarchive_run", thread_id, committed_at)
}

fn delete_run(
    connection: &Connection,
    thread_id: &str,
    expected_revision: i64,
) -> Result<RunMutationEffects, StoreError> {
    let current = require_run_revision(connection, thread_id, expected_revision)?;
    let (_, committed_at) = core_now(connection)?;
    let changed = connection.execute(
        "DELETE FROM codex_automation_runs WHERE thread_id = ?1 AND run_revision = ?2",
        params![thread_id, expected_revision],
    )?;
    if changed != 1 {
        return Err(conflict("Automation run changed before deletion"));
    }
    Ok(RunMutationEffects {
        operation_kind: "delete_run",
        automation_ids: vec![current.automation_id],
        runs: Vec::new(),
        deleted_run_ids: vec![thread_id.to_owned()],
        run_ids: vec![thread_id.to_owned()],
        bulk: None,
        committed_at,
    })
}

fn settle_interrupted(connection: &Connection) -> Result<RunMutationEffects, StoreError> {
    let (now_ms, committed_at) = core_now(connection)?;
    let selected = select_run_ids(
        connection,
        "SELECT thread_id FROM codex_automation_runs WHERE status = 'IN_PROGRESS' \
         ORDER BY created_at, thread_id LIMIT ?1",
        [i64::try_from(MAX_BULK_RUNS).expect("bound fits i64")],
    )?;
    let mut archived_pending_count = 0_u32;
    let mut pending_review_count = 0_u32;
    for thread_id in &selected {
        if thread_id.starts_with("pending:") {
            connection.execute(
                "UPDATE codex_automation_runs SET status = 'ARCHIVED', \
                   archived_reason = COALESCE(archived_reason, 'auto'), updated_at = ?1, \
                   run_revision = run_revision + 1 \
                 WHERE thread_id = ?2 AND status = 'IN_PROGRESS'",
                params![now_ms, thread_id],
            )?;
            archived_pending_count += 1;
        } else {
            connection.execute(
                "UPDATE codex_automation_runs SET status = 'PENDING_REVIEW', updated_at = ?1, \
                   run_revision = run_revision + 1 \
                 WHERE thread_id = ?2 AND status = 'IN_PROGRESS'",
                params![now_ms, thread_id],
            )?;
            pending_review_count += 1;
        }
    }
    let runs = read_selected_runs(connection, &selected)?;
    let has_more = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM codex_automation_runs WHERE status = 'IN_PROGRESS')",
        [],
        |row| row.get::<_, bool>(0),
    )?;
    bulk_effects(
        "settle_interrupted_runs",
        runs,
        AutomationRunBulkResult {
            changed_count: u32::try_from(selected.len()).expect("bounded selection fits u32"),
            archived_pending_count,
            pending_review_count,
            has_more,
        },
        committed_at,
    )
}

fn single_run_effects(
    connection: &Connection,
    operation_kind: &'static str,
    thread_id: &str,
    committed_at: String,
) -> Result<RunMutationEffects, StoreError> {
    let run = read_run(connection, thread_id)?
        .ok_or_else(|| corrupt("Committed Automation run is unavailable"))?;
    Ok(RunMutationEffects {
        operation_kind,
        automation_ids: vec![run.automation_id.clone()],
        runs: vec![run],
        deleted_run_ids: Vec::new(),
        run_ids: vec![thread_id.to_owned()],
        bulk: None,
        committed_at,
    })
}

fn bulk_effects(
    operation_kind: &'static str,
    runs: Vec<AutomationRun>,
    bulk: AutomationRunBulkResult,
    committed_at: String,
) -> Result<RunMutationEffects, StoreError> {
    let automation_ids = runs
        .iter()
        .map(|run| run.automation_id.clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    let run_ids = runs.iter().map(|run| run.thread_id.clone()).collect();
    Ok(RunMutationEffects {
        operation_kind,
        automation_ids,
        runs,
        deleted_run_ids: Vec::new(),
        run_ids,
        bulk: Some(bulk),
        committed_at,
    })
}

fn require_run_revision(
    connection: &Connection,
    thread_id: &str,
    expected_revision: i64,
) -> Result<AutomationRun, StoreError> {
    validate_id("thread_id", thread_id)?;
    validate_expected_revision(expected_revision)?;
    let run = read_run(connection, thread_id)?
        .ok_or_else(|| not_found("Automation run is unavailable"))?;
    if run.run_revision != expected_revision {
        return Err(conflict("Automation run revision changed"));
    }
    Ok(run)
}

fn require_definition(connection: &Connection, automation_id: &str) -> Result<(), StoreError> {
    let status = connection
        .query_row(
            "SELECT status FROM codex_scheduled_automations WHERE automation_id = ?1",
            [automation_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    match status.as_deref() {
        Some("ACTIVE" | "PAUSED") => Ok(()),
        Some("DELETED") => Err(conflict("Deleted Automation cannot start a run")),
        Some(_) => Err(corrupt("Scheduled Automation status is invalid")),
        None => Err(not_found("Scheduled Automation is unavailable")),
    }
}

fn require_thread(connection: &Connection, thread_id: &str) -> Result<(), StoreError> {
    let exists = connection
        .query_row(
            "SELECT 1 FROM codex_threads WHERE thread_id = ?1",
            [thread_id],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if exists {
        return Ok(());
    }
    Err(not_found("Automation run target Thread is unavailable"))
}

fn read_selected_runs(
    connection: &Connection,
    thread_ids: &[String],
) -> Result<Vec<AutomationRun>, StoreError> {
    thread_ids
        .iter()
        .map(|thread_id| {
            read_run(connection, thread_id)?
                .ok_or_else(|| corrupt("Selected Automation run disappeared"))
        })
        .collect()
}

fn select_run_ids<P: rusqlite::Params>(
    connection: &Connection,
    sql: &str,
    params: P,
) -> Result<Vec<String>, StoreError> {
    let mut statement = connection.prepare(sql)?;
    statement
        .query_map(params, |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(Into::into)
}

fn unread_counts(connection: &Connection) -> Result<AutomationRunUnreadCounts, StoreError> {
    let mut statement = connection.prepare(
        "SELECT runs.automation_id, runs.thread_id \
         FROM codex_automation_runs runs \
         JOIN codex_scheduled_automations automations \
           ON automations.automation_id = runs.automation_id \
         WHERE runs.read_at IS NULL AND runs.status IN ('PENDING_REVIEW', 'ACCEPTED') \
         ORDER BY runs.automation_id, runs.thread_id",
    )?;
    let unread_runs = statement
        .query_map([], |row| {
            Ok(AutomationUnreadRun {
                automation_id: row.get(0)?,
                thread_id: row.get(1)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let automation_ids = unread_runs
        .iter()
        .map(|run| run.automation_id.clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();
    let total = u32::try_from(unread_runs.len())
        .map_err(|_| corrupt("Automation unread count exceeds its bound"))?;
    Ok(AutomationRunUnreadCounts {
        total,
        automation_ids,
        unread_runs,
    })
}

fn run_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AutomationRun> {
    Ok(AutomationRun {
        thread_id: row.get(0)?,
        automation_id: row.get(1)?,
        run_revision: row.get(2)?,
        status: parse_status(&row.get::<_, String>(3)?).map_err(conversion)?,
        read_at_ms: row.get(4)?,
        thread_title: row.get(5)?,
        source_cwd: row.get(6)?,
        inbox_title: row.get(7)?,
        inbox_summary: row.get(8)?,
        archived_user_message: row.get(9)?,
        archived_assistant_message: row.get(10)?,
        archived_reason: row.get(11)?,
        created_at_ms: row.get(12)?,
        updated_at_ms: row.get(13)?,
    })
}

fn inbox_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AutomationInboxItem> {
    Ok(AutomationInboxItem {
        automation_id: row.get(0)?,
        automation_name: row.get(1)?,
        title: row.get(2)?,
        description: row.get(3)?,
        archived_assistant_message: row.get(4)?,
        archived_user_message: row.get(5)?,
        archived_reason: row.get(6)?,
        source_cwd: row.get(7)?,
        thread_id: row.get(8)?,
        read_at_ms: row.get(9)?,
        created_at_ms: row.get(10)?,
        status: parse_status(&row.get::<_, String>(11)?).map_err(conversion)?,
    })
}

fn validate_run(connection: &Connection, run: AutomationRun) -> Result<AutomationRun, StoreError> {
    if run.run_revision < 1
        || run.created_at_ms < 0
        || run.updated_at_ms < run.created_at_ms
        || run.read_at_ms.is_some_and(|value| value < 0)
    {
        return Err(corrupt("Stored Automation run is invalid"));
    }
    validate_id("stored Automation run Thread", &run.thread_id)
        .map_err(|_| corrupt("Stored Automation run Thread is invalid"))?;
    validate_id("stored Automation id", &run.automation_id)
        .map_err(|_| corrupt("Stored Automation run definition id is invalid"))?;
    let definition_exists = connection
        .query_row(
            "SELECT 1 FROM codex_scheduled_automations WHERE automation_id = ?1",
            [&run.automation_id],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if !definition_exists {
        return Err(corrupt("Automation run definition is unavailable"));
    }
    Ok(run)
}

fn validate_inbox_item(item: AutomationInboxItem) -> Result<AutomationInboxItem, StoreError> {
    validate_id("stored Automation inbox Thread", &item.thread_id)
        .map_err(|_| corrupt("Stored Automation inbox Thread is invalid"))?;
    validate_id("stored Automation inbox definition", &item.automation_id)
        .map_err(|_| corrupt("Stored Automation inbox definition is invalid"))?;
    if item.created_at_ms < 0 || item.read_at_ms.is_some_and(|value| value < 0) {
        return Err(corrupt("Stored Automation inbox item is invalid"));
    }
    Ok(item)
}

fn parse_status(value: &str) -> Result<AutomationRunStatus, String> {
    match value {
        "IN_PROGRESS" => Ok(AutomationRunStatus::InProgress),
        "PENDING_REVIEW" => Ok(AutomationRunStatus::PendingReview),
        "ACCEPTED" => Ok(AutomationRunStatus::Accepted),
        "ARCHIVED" => Ok(AutomationRunStatus::Archived),
        _ => Err("Automation run status is invalid".to_owned()),
    }
}

fn normalize_text(
    value: Option<&str>,
    max_bytes: usize,
    label: &str,
) -> Result<Option<String>, StoreError> {
    let value = value.unwrap_or_default().trim();
    if value.is_empty() {
        return Ok(None);
    }
    if value.len() > max_bytes {
        return Err(invalid(&format!("Automation {label} exceeds its bound")));
    }
    Ok(Some(value.to_owned()))
}

fn validate_expected_revision(value: i64) -> Result<(), StoreError> {
    if value >= 1 {
        return Ok(());
    }
    Err(invalid("expected_revision must be positive"))
}

fn validate_pending_thread_id(value: &str) -> Result<(), StoreError> {
    let suffix = value
        .strip_prefix("pending:")
        .ok_or_else(|| invalid("Automation pending Thread identity is invalid"))?;
    validate_id("pending Thread suffix", suffix)
}

fn validate_id(label: &str, value: &str) -> Result<(), StoreError> {
    if !value.trim().is_empty()
        && value.trim() == value
        && value.len() <= MAX_ID_LENGTH
        && value != "."
        && value != ".."
        && !value.contains('/')
        && !value.contains('\\')
    {
        return Ok(());
    }
    Err(invalid(&format!("{label} is invalid")))
}

fn update_one<P: rusqlite::Params>(
    connection: &Connection,
    sql: &str,
    params: P,
    conflict_message: &str,
) -> Result<(), StoreError> {
    if connection.execute(sql, params)? == 1 {
        return Ok(());
    }
    Err(conflict(conflict_message))
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

fn conversion(message: String) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        0,
        rusqlite::types::Type::Text,
        Box::new(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            message,
        )),
    )
}

fn invalid(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::InvalidInput, message, false)
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
