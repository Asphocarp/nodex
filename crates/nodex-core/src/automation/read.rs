use nodex_core_contracts::automation::{
    AutomationDefinition, AutomationDefinitionKind, AutomationDefinitionStatus,
    AutomationExecutionEnvironment, AutomationLease, AutomationLeaseStatus, AutomationRead,
    AutomationReadValue, AutomationReasoningEffort,
};
use rusqlite::{Connection, OptionalExtension, params};

use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};

const MAX_ID_LENGTH: usize = 512;
const MAX_LEASE_READ_LIMIT: u32 = 1_000;

pub(super) fn read(
    connection: &Connection,
    request: AutomationRead,
) -> Result<AutomationReadValue, StoreError> {
    match request {
        AutomationRead::Definitions { include_deleted } => Ok(AutomationReadValue::Definitions {
            items: read_definitions(connection, include_deleted.unwrap_or(false))?,
        }),
        AutomationRead::Definition { automation_id } => {
            validate_id("automation_id", &automation_id)?;
            Ok(AutomationReadValue::Definition {
                item: read_definition(connection, &automation_id)?.map(Box::new),
            })
        }
        AutomationRead::Leases {
            automation_id,
            include_settled,
            limit,
        } => {
            if let Some(automation_id) = automation_id.as_deref() {
                validate_id("automation_id", automation_id)?;
            }
            let limit = limit.unwrap_or(100);
            if !(1..=MAX_LEASE_READ_LIMIT).contains(&limit) {
                return Err(invalid("Automation lease read limit is invalid"));
            }
            Ok(AutomationReadValue::Leases {
                items: read_leases(
                    connection,
                    automation_id.as_deref(),
                    include_settled.unwrap_or(false),
                    limit,
                )?,
            })
        }
    }
}

pub(super) fn read_definitions(
    connection: &Connection,
    include_deleted: bool,
) -> Result<Vec<AutomationDefinition>, StoreError> {
    let mut statement = connection.prepare(
        "SELECT automation_id, definition_revision, kind, status, target_thread_id, name, \
                prompt, rrule, model, reasoning_effort, cwds_json, execution_environment, \
                local_environment_config_path, next_run_at, last_run_at, created_at, updated_at \
         FROM codex_scheduled_automations \
         WHERE ?1 OR status <> 'DELETED' \
         ORDER BY created_at, automation_id",
    )?;
    statement
        .query_map([include_deleted], definition_from_row)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|_| corrupt("Scheduled Automation definition column types are invalid"))?
        .into_iter()
        .map(validate_definition)
        .collect()
}

pub(super) fn read_definition(
    connection: &Connection,
    automation_id: &str,
) -> Result<Option<AutomationDefinition>, StoreError> {
    let definition = connection
        .query_row(
            "SELECT automation_id, definition_revision, kind, status, target_thread_id, name, \
                    prompt, rrule, model, reasoning_effort, cwds_json, execution_environment, \
                    local_environment_config_path, next_run_at, last_run_at, created_at, updated_at \
             FROM codex_scheduled_automations WHERE automation_id = ?1",
            [automation_id],
            definition_from_row,
        )
        .optional()
        .map_err(|_| corrupt("Scheduled Automation definition column types are invalid"))?;
    definition.map(validate_definition).transpose()
}

fn definition_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AutomationDefinition> {
    let kind = parse_kind(row.get::<_, String>(2)?).map_err(rusqlite_conversion)?;
    let status = parse_status(row.get::<_, String>(3)?).map_err(rusqlite_conversion)?;
    let reasoning = row
        .get::<_, Option<String>>(9)?
        .map(parse_reasoning)
        .transpose()
        .map_err(rusqlite_conversion)?;
    let environment = parse_environment(row.get::<_, String>(11)?).map_err(rusqlite_conversion)?;
    let cwds_json = row.get::<_, String>(10)?;
    let cwds = serde_json::from_str::<Vec<String>>(&cwds_json)
        .map_err(|_| rusqlite_conversion("Scheduled Automation cwd JSON is invalid".to_owned()))?;
    Ok(AutomationDefinition {
        automation_id: row.get(0)?,
        definition_revision: row.get(1)?,
        kind,
        status,
        target_thread_id: row.get(4)?,
        name: row.get(5)?,
        prompt: row.get(6)?,
        rrule: row.get(7)?,
        model: row.get(8)?,
        reasoning_effort: reasoning,
        cwds,
        execution_environment: environment,
        local_environment_config_path: row.get(12)?,
        next_run_at_ms: row.get(13)?,
        last_run_at_ms: row.get(14)?,
        created_at_ms: row.get(15)?,
        updated_at_ms: row.get(16)?,
    })
}

fn validate_definition(
    definition: AutomationDefinition,
) -> Result<AutomationDefinition, StoreError> {
    validate_id("stored automation_id", &definition.automation_id)
        .map_err(|_| corrupt("Stored Scheduled Automation id is invalid"))?;
    if definition.definition_revision < 1
        || definition.name.trim().is_empty()
        || definition.created_at_ms < 0
        || definition.updated_at_ms < definition.created_at_ms
        || definition.next_run_at_ms.is_some_and(|value| value < 0)
        || definition.last_run_at_ms.is_some_and(|value| value < 0)
    {
        return Err(corrupt("Stored Scheduled Automation definition is invalid"));
    }
    Ok(definition)
}

fn read_leases(
    connection: &Connection,
    automation_id: Option<&str>,
    include_settled: bool,
    limit: u32,
) -> Result<Vec<AutomationLease>, StoreError> {
    let mut statement = connection.prepare(
        "SELECT lease_id, automation_id, scheduled_for_ms, attempt, status, claimed_at_ms, \
                expires_at_ms, settled_at_ms, retry_at_ms, reason_code \
         FROM core_automation_leases \
         WHERE (?1 IS NULL OR automation_id = ?1) AND (?2 OR status = 'claimed') \
         ORDER BY scheduled_for_ms DESC, attempt DESC, lease_id DESC LIMIT ?3",
    )?;
    statement
        .query_map(
            params![automation_id, include_settled, limit],
            lease_from_row,
        )?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|_| corrupt("Automation lease column types are invalid"))?
        .into_iter()
        .map(validate_lease)
        .collect()
}

pub(super) fn read_lease(
    connection: &Connection,
    lease_id: &str,
) -> Result<Option<AutomationLease>, StoreError> {
    connection
        .query_row(
            "SELECT lease_id, automation_id, scheduled_for_ms, attempt, status, claimed_at_ms, \
                    expires_at_ms, settled_at_ms, retry_at_ms, reason_code \
             FROM core_automation_leases WHERE lease_id = ?1",
            [lease_id],
            lease_from_row,
        )
        .optional()
        .map_err(|_| corrupt("Automation lease column types are invalid"))?
        .map(validate_lease)
        .transpose()
}

fn lease_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AutomationLease> {
    let attempt = row.get::<_, i64>(3)?;
    let attempt = u32::try_from(attempt)
        .map_err(|_| rusqlite_conversion("Automation lease attempt is invalid".to_owned()))?;
    Ok(AutomationLease {
        lease_id: row.get(0)?,
        automation_id: row.get(1)?,
        scheduled_for_ms: row.get(2)?,
        attempt,
        status: parse_lease_status(row.get::<_, String>(4)?).map_err(rusqlite_conversion)?,
        claimed_at_ms: row.get(5)?,
        expires_at_ms: row.get(6)?,
        settled_at_ms: row.get(7)?,
        retry_at_ms: row.get(8)?,
        reason_code: row.get(9)?,
    })
}

fn validate_lease(lease: AutomationLease) -> Result<AutomationLease, StoreError> {
    if lease.lease_id.is_empty()
        || lease.lease_id.len() > MAX_ID_LENGTH
        || lease.automation_id.is_empty()
        || lease.automation_id.len() > MAX_ID_LENGTH
        || lease.scheduled_for_ms < 0
        || lease.attempt == 0
        || lease.claimed_at_ms < 0
        || lease.expires_at_ms <= lease.claimed_at_ms
    {
        return Err(corrupt("Stored Automation lease is invalid"));
    }
    Ok(lease)
}

pub(super) fn kind_string(value: AutomationDefinitionKind) -> &'static str {
    match value {
        AutomationDefinitionKind::Cron => "cron",
        AutomationDefinitionKind::Heartbeat => "heartbeat",
    }
}

pub(super) fn status_string(value: AutomationDefinitionStatus) -> &'static str {
    match value {
        AutomationDefinitionStatus::Active => "ACTIVE",
        AutomationDefinitionStatus::Paused => "PAUSED",
        AutomationDefinitionStatus::Deleted => "DELETED",
    }
}

pub(super) fn environment_string(value: AutomationExecutionEnvironment) -> &'static str {
    match value {
        AutomationExecutionEnvironment::Local => "local",
        AutomationExecutionEnvironment::Worktree => "worktree",
    }
}

pub(super) fn reasoning_string(value: AutomationReasoningEffort) -> &'static str {
    match value {
        AutomationReasoningEffort::None => "none",
        AutomationReasoningEffort::Minimal => "minimal",
        AutomationReasoningEffort::Low => "low",
        AutomationReasoningEffort::Medium => "medium",
        AutomationReasoningEffort::High => "high",
        AutomationReasoningEffort::Xhigh => "xhigh",
        AutomationReasoningEffort::Max => "max",
    }
}

fn parse_kind(value: String) -> Result<AutomationDefinitionKind, String> {
    match value.as_str() {
        "cron" => Ok(AutomationDefinitionKind::Cron),
        "heartbeat" => Ok(AutomationDefinitionKind::Heartbeat),
        _ => Err("Scheduled Automation kind is invalid".to_owned()),
    }
}

fn parse_status(value: String) -> Result<AutomationDefinitionStatus, String> {
    match value.as_str() {
        "ACTIVE" => Ok(AutomationDefinitionStatus::Active),
        "PAUSED" => Ok(AutomationDefinitionStatus::Paused),
        "DELETED" => Ok(AutomationDefinitionStatus::Deleted),
        _ => Err("Scheduled Automation status is invalid".to_owned()),
    }
}

fn parse_environment(value: String) -> Result<AutomationExecutionEnvironment, String> {
    match value.as_str() {
        "local" => Ok(AutomationExecutionEnvironment::Local),
        "worktree" => Ok(AutomationExecutionEnvironment::Worktree),
        _ => Err("Scheduled Automation execution environment is invalid".to_owned()),
    }
}

fn parse_reasoning(value: String) -> Result<AutomationReasoningEffort, String> {
    match value.as_str() {
        "none" => Ok(AutomationReasoningEffort::None),
        "minimal" => Ok(AutomationReasoningEffort::Minimal),
        "low" => Ok(AutomationReasoningEffort::Low),
        "medium" => Ok(AutomationReasoningEffort::Medium),
        "high" => Ok(AutomationReasoningEffort::High),
        "xhigh" => Ok(AutomationReasoningEffort::Xhigh),
        "max" => Ok(AutomationReasoningEffort::Max),
        _ => Err("Scheduled Automation reasoning effort is invalid".to_owned()),
    }
}

fn parse_lease_status(value: String) -> Result<AutomationLeaseStatus, String> {
    match value.as_str() {
        "claimed" => Ok(AutomationLeaseStatus::Claimed),
        "completed" => Ok(AutomationLeaseStatus::Completed),
        "failed" => Ok(AutomationLeaseStatus::Failed),
        "cancelled" => Ok(AutomationLeaseStatus::Cancelled),
        _ => Err("Automation lease status is invalid".to_owned()),
    }
}

fn validate_id(label: &str, value: &str) -> Result<(), StoreError> {
    if !value.trim().is_empty()
        && value.trim() == value
        && value.len() <= MAX_ID_LENGTH
        && value != "."
        && value != ".."
        && !value.contains(['/', '\\'])
    {
        return Ok(());
    }
    Err(invalid(&format!("{label} is invalid")))
}

fn rusqlite_conversion(message: String) -> rusqlite::Error {
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

fn corrupt(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message, false)
}
