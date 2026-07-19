use std::collections::BTreeSet;
use std::path::{Component, Path, PathBuf};

use nodex_core_contracts::automation::{
    AutomationCommitValue, AutomationDefinition, AutomationDefinitionInput,
    AutomationDefinitionKind, AutomationDefinitionStatus, AutomationEvent, AutomationEventKind,
    AutomationExecutionEnvironment, AutomationIntent, AutomationLease, AutomationLeaseStatus,
    AutomationReceipt,
};
use nodex_core_contracts::{
    AdapterKind, BoundModuleContext, CORE_CONTRACT_VERSION, CommittedCoreModuleEvent,
    CommittedModuleValue, CoreModuleEventPayload, ModuleApplyRequest, ModuleMutationReceipt,
    StoreEpoch,
};
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::json;
use sha2::{Digest, Sha256};

use crate::document::sha256;
use crate::infrastructure::module_receipts::{
    NewModuleReceipt, insert_module_receipt, read_module_receipt,
};
use crate::infrastructure::sqlite::{StoreError, StoreErrorCode, with_immediate_transaction};
use crate::infrastructure::writer::StoreWriter;

use super::read::{
    environment_string, kind_string, read_definition, read_lease, reasoning_string, status_string,
};
use super::schedule::{ScheduleError, next_run_at, normalize_rrule};
use super::{AutomationApplyOutcome, assert_identity};

const MODULE_NAME: &str = "automation";
const MAX_ID_LENGTH: usize = 512;
const MAX_NAME_CHARS: usize = 256;
const MAX_PROMPT_BYTES: usize = 1024 * 1024;
const MAX_CWDS: usize = 128;
const MAX_PATH_BYTES: usize = 16 * 1024;
const MAX_MODEL_BYTES: usize = 512;
const MAX_REASON_CODE_BYTES: usize = 128;
const MAX_CLAIM_LIMIT: u32 = 100;
const MIN_LEASE_DURATION_MS: u64 = 1_000;
const MAX_LEASE_DURATION_MS: u64 = 24 * 60 * 60 * 1_000;
const MAX_RETRY_DELAY_MS: u64 = 7 * 24 * 60 * 60 * 1_000;

struct NormalizedDefinition {
    kind: AutomationDefinitionKind,
    target_thread_id: Option<String>,
    name: String,
    prompt: String,
    rrule: String,
    model: Option<String>,
    reasoning_effort: Option<nodex_core_contracts::automation::AutomationReasoningEffort>,
    cwds: Vec<String>,
    execution_environment: AutomationExecutionEnvironment,
    local_environment_config_path: Option<String>,
}

struct MutationEffects {
    operation_kind: &'static str,
    automation_ids: Vec<String>,
    definitions: Vec<AutomationDefinition>,
    claimed_leases: Vec<AutomationLease>,
    lease_ids: Vec<String>,
    committed_at: String,
}

pub(super) fn apply(
    writer: &StoreWriter,
    profile_id: &str,
    library_id: &str,
    context: &BoundModuleContext,
    request: ModuleApplyRequest<AutomationIntent>,
) -> Result<AutomationApplyOutcome, StoreError> {
    let profile_id = profile_id.to_owned();
    let library_id = library_id.to_owned();
    let context = context.clone();
    writer.call(move |connection| {
        with_immediate_transaction(connection, |transaction| {
            assert_identity(transaction, &profile_id, &library_id)?;
            let store_epoch = transaction
                .query_row(
                    "SELECT store_epoch FROM block_store_metadata WHERE id = 1",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .optional()?
                .ok_or_else(|| corrupt("Profile store epoch is unavailable"))?;
            if request.store_epoch.0 != store_epoch {
                return Err(StoreError::new(
                    StoreErrorCode::Conflict,
                    "Automation mutation targets a stale store epoch",
                    true,
                ));
            }
            validate_id("operation_id", &request.operation_id)?;
            require_trusted_host(&context, &request.intent)?;
            let fingerprint = serde_json::to_vec(&(
                &context,
                request.version,
                &request.store_epoch,
                &request.intent,
            ))
            .map_err(|_| internal("Automation mutation cannot be fingerprinted"))?;
            let request_hash = sha256(&fingerprint);
            if let Some(stored) =
                read_module_receipt(transaction, MODULE_NAME, &request.operation_id)?
            {
                if stored.request_hash != request_hash {
                    return Err(StoreError::new(
                        StoreErrorCode::IdempotencyKeyReused,
                        "operation_id is already bound to another Automation intent",
                        false,
                    ));
                }
                let mut committed = serde_json::from_value::<
                    CommittedModuleValue<AutomationCommitValue, AutomationReceipt>,
                >(stored.result)
                .map_err(|_| corrupt("Stored Automation receipt is invalid"))?;
                committed.receipt.mutation.duplicate = true;
                return Ok(AutomationApplyOutcome {
                    committed,
                    event: None,
                });
            }

            match &request.intent {
                AutomationIntent::CreateDefinition {
                    automation_id,
                    definition,
                } => create_definition(
                    transaction,
                    &library_id,
                    &context,
                    &store_epoch,
                    &request.operation_id,
                    &request_hash,
                    automation_id,
                    definition,
                ),
                AutomationIntent::UpdateDefinition {
                    automation_id,
                    expected_revision,
                    status,
                    definition,
                } => update_definition(
                    transaction,
                    &library_id,
                    &context,
                    &store_epoch,
                    &request.operation_id,
                    &request_hash,
                    automation_id,
                    *expected_revision,
                    *status,
                    definition,
                ),
                AutomationIntent::DeleteDefinition {
                    automation_id,
                    expected_revision,
                } => delete_definition(
                    transaction,
                    &library_id,
                    &context,
                    &store_epoch,
                    &request.operation_id,
                    &request_hash,
                    automation_id,
                    *expected_revision,
                ),
                AutomationIntent::ClaimDue {
                    limit,
                    lease_duration_ms,
                } => claim_due(
                    transaction,
                    &library_id,
                    &context,
                    &store_epoch,
                    &request.operation_id,
                    &request_hash,
                    *limit,
                    *lease_duration_ms,
                ),
                AutomationIntent::CompleteLease { lease_id } => settle_lease(
                    transaction,
                    &library_id,
                    &context,
                    &store_epoch,
                    &request.operation_id,
                    &request_hash,
                    lease_id,
                    None,
                    None,
                ),
                AutomationIntent::FailLease {
                    lease_id,
                    retry_delay_ms,
                    reason_code,
                } => settle_lease(
                    transaction,
                    &library_id,
                    &context,
                    &store_epoch,
                    &request.operation_id,
                    &request_hash,
                    lease_id,
                    *retry_delay_ms,
                    Some(reason_code),
                ),
            }
        })
    })
}

#[allow(clippy::too_many_arguments)]
fn create_definition(
    connection: &Connection,
    library_id: &str,
    context: &BoundModuleContext,
    store_epoch: &str,
    operation_id: &str,
    request_hash: &str,
    automation_id: &str,
    input: &AutomationDefinitionInput,
) -> Result<AutomationApplyOutcome, StoreError> {
    validate_id("automation_id", automation_id)?;
    if read_definition(connection, automation_id)?.is_some() {
        return Err(conflict("Scheduled Automation id already exists"));
    }
    let definition = normalize_definition(connection, input)?;
    require_unique_active_heartbeat(
        connection,
        automation_id,
        AutomationDefinitionStatus::Active,
        &definition,
    )?;
    let (now_ms, committed_at) = core_now(connection)?;
    let next_run = scheduled_next(connection, automation_id, &definition, now_ms)?;
    let cwds_json = serde_json::to_string(&definition.cwds)
        .map_err(|_| internal("Scheduled Automation cwd JSON cannot be encoded"))?;
    connection.execute(
        "INSERT INTO codex_scheduled_automations(\
           automation_id, kind, status, target_thread_id, name, prompt, rrule, model, \
           reasoning_effort, cwds_json, execution_environment, local_environment_config_path, \
           next_run_at, last_run_at, created_at, updated_at, definition_revision\
         ) VALUES (?1, ?2, 'ACTIVE', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, NULL, ?13, ?13, 1)",
        params![
            automation_id,
            kind_string(definition.kind),
            definition.target_thread_id,
            definition.name,
            definition.prompt,
            definition.rrule,
            definition.model,
            definition.reasoning_effort.map(reasoning_string),
            cwds_json,
            environment_string(definition.execution_environment),
            definition.local_environment_config_path,
            next_run,
            now_ms,
        ],
    )?;
    let stored = read_definition(connection, automation_id)?
        .ok_or_else(|| corrupt("Created Scheduled Automation is unavailable"))?;
    finish_mutation(
        connection,
        library_id,
        context,
        store_epoch,
        operation_id,
        request_hash,
        MutationEffects {
            operation_kind: "create_definition",
            automation_ids: vec![automation_id.to_owned()],
            definitions: vec![stored],
            claimed_leases: Vec::new(),
            lease_ids: Vec::new(),
            committed_at,
        },
    )
}

#[allow(clippy::too_many_arguments)]
fn update_definition(
    connection: &Connection,
    library_id: &str,
    context: &BoundModuleContext,
    store_epoch: &str,
    operation_id: &str,
    request_hash: &str,
    automation_id: &str,
    expected_revision: i64,
    status: AutomationDefinitionStatus,
    input: &AutomationDefinitionInput,
) -> Result<AutomationApplyOutcome, StoreError> {
    validate_id("automation_id", automation_id)?;
    if expected_revision < 1 {
        return Err(invalid("expected_revision must be positive"));
    }
    if status == AutomationDefinitionStatus::Deleted {
        return Err(invalid("DeleteDefinition owns the DELETED transition"));
    }
    let current = read_definition(connection, automation_id)?
        .ok_or_else(|| not_found("Scheduled Automation is unavailable"))?;
    if current.definition_revision != expected_revision {
        return Err(StoreError::new(
            StoreErrorCode::RevisionConflict,
            "Scheduled Automation definition revision changed",
            true,
        ));
    }
    let definition = normalize_definition(connection, input)?;
    require_unique_active_heartbeat(connection, automation_id, status, &definition)?;
    let (now_ms, committed_at) = core_now(connection)?;
    let schedule_changed = current.kind != definition.kind
        || current.rrule != definition.rrule
        || current.status != status;
    let next_run = if status == AutomationDefinitionStatus::Active {
        if schedule_changed || current.next_run_at_ms.is_none() {
            scheduled_next(connection, automation_id, &definition, now_ms)?
        } else {
            current.next_run_at_ms
        }
    } else {
        None
    };
    let cwds_json = serde_json::to_string(&definition.cwds)
        .map_err(|_| internal("Scheduled Automation cwd JSON cannot be encoded"))?;
    let changed = connection.execute(
        "UPDATE codex_scheduled_automations SET \
           kind = ?1, status = ?2, target_thread_id = ?3, name = ?4, prompt = ?5, rrule = ?6, \
           model = ?7, reasoning_effort = ?8, cwds_json = ?9, execution_environment = ?10, \
           local_environment_config_path = ?11, next_run_at = ?12, updated_at = ?13, \
           definition_revision = definition_revision + 1 \
         WHERE automation_id = ?14 AND definition_revision = ?15",
        params![
            kind_string(definition.kind),
            status_string(status),
            definition.target_thread_id,
            definition.name,
            definition.prompt,
            definition.rrule,
            definition.model,
            definition.reasoning_effort.map(reasoning_string),
            cwds_json,
            environment_string(definition.execution_environment),
            definition.local_environment_config_path,
            next_run,
            now_ms,
            automation_id,
            expected_revision,
        ],
    )?;
    if changed != 1 {
        return Err(conflict(
            "Scheduled Automation definition changed concurrently",
        ));
    }
    let lease_ids = if status == AutomationDefinitionStatus::Paused {
        cancel_claimed_leases(connection, automation_id, now_ms, "definition_paused")?
    } else {
        Vec::new()
    };
    let stored = read_definition(connection, automation_id)?
        .ok_or_else(|| corrupt("Updated Scheduled Automation is unavailable"))?;
    finish_mutation(
        connection,
        library_id,
        context,
        store_epoch,
        operation_id,
        request_hash,
        MutationEffects {
            operation_kind: "update_definition",
            automation_ids: vec![automation_id.to_owned()],
            definitions: vec![stored],
            claimed_leases: Vec::new(),
            lease_ids,
            committed_at,
        },
    )
}

#[allow(clippy::too_many_arguments)]
fn delete_definition(
    connection: &Connection,
    library_id: &str,
    context: &BoundModuleContext,
    store_epoch: &str,
    operation_id: &str,
    request_hash: &str,
    automation_id: &str,
    expected_revision: i64,
) -> Result<AutomationApplyOutcome, StoreError> {
    validate_id("automation_id", automation_id)?;
    if expected_revision < 1 {
        return Err(invalid("expected_revision must be positive"));
    }
    let current = read_definition(connection, automation_id)?
        .ok_or_else(|| not_found("Scheduled Automation is unavailable"))?;
    if current.definition_revision != expected_revision {
        return Err(StoreError::new(
            StoreErrorCode::RevisionConflict,
            "Scheduled Automation definition revision changed",
            true,
        ));
    }
    let (now_ms, committed_at) = core_now(connection)?;
    connection.execute(
        "UPDATE codex_scheduled_automations SET status = 'DELETED', next_run_at = NULL, \
           updated_at = ?1, definition_revision = definition_revision + 1 \
         WHERE automation_id = ?2 AND definition_revision = ?3",
        params![now_ms, automation_id, expected_revision],
    )?;
    let lease_ids = cancel_claimed_leases(connection, automation_id, now_ms, "definition_deleted")?;
    let stored = read_definition(connection, automation_id)?
        .ok_or_else(|| corrupt("Deleted Scheduled Automation is unavailable"))?;
    finish_mutation(
        connection,
        library_id,
        context,
        store_epoch,
        operation_id,
        request_hash,
        MutationEffects {
            operation_kind: "delete_definition",
            automation_ids: vec![automation_id.to_owned()],
            definitions: vec![stored],
            claimed_leases: Vec::new(),
            lease_ids,
            committed_at,
        },
    )
}

#[allow(clippy::too_many_arguments)]
fn claim_due(
    connection: &Connection,
    library_id: &str,
    context: &BoundModuleContext,
    store_epoch: &str,
    operation_id: &str,
    request_hash: &str,
    limit: u32,
    lease_duration_ms: u64,
) -> Result<AutomationApplyOutcome, StoreError> {
    if !(1..=MAX_CLAIM_LIMIT).contains(&limit) {
        return Err(invalid("Automation claim limit is invalid"));
    }
    if !(MIN_LEASE_DURATION_MS..=MAX_LEASE_DURATION_MS).contains(&lease_duration_ms) {
        return Err(invalid("Automation lease duration is invalid"));
    }
    let (now_ms, committed_at) = core_now(connection)?;
    let expires_at_ms = now_ms
        .checked_add(
            i64::try_from(lease_duration_ms)
                .map_err(|_| invalid("Automation lease duration exceeds the timestamp range"))?,
        )
        .ok_or_else(|| invalid("Automation lease expiry exceeds the timestamp range"))?;
    let due = {
        let mut statement = connection.prepare(
            "SELECT automation_id, next_run_at FROM codex_scheduled_automations \
             WHERE status = 'ACTIVE' AND next_run_at IS NOT NULL AND next_run_at <= ?1 \
             ORDER BY next_run_at, automation_id LIMIT ?2",
        )?;
        statement
            .query_map(params![now_ms, limit], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };
    let mut leases = Vec::new();
    let mut affected_lease_ids = Vec::new();
    for (automation_id, scheduled_for_ms) in due {
        let expired_ids = {
            let mut statement = connection.prepare(
                "SELECT lease_id FROM core_automation_leases \
                 WHERE automation_id = ?1 AND scheduled_for_ms = ?2 AND status = 'claimed' \
                   AND expires_at_ms <= ?3 ORDER BY lease_id",
            )?;
            statement
                .query_map(params![automation_id, scheduled_for_ms, now_ms], |row| {
                    row.get::<_, String>(0)
                })?
                .collect::<rusqlite::Result<Vec<_>>>()?
        };
        connection.execute(
            "UPDATE core_automation_leases SET status = 'failed', settled_at_ms = ?1, \
               retry_at_ms = ?1, reason_code = 'lease_expired' \
             WHERE automation_id = ?2 AND scheduled_for_ms = ?3 AND status = 'claimed' \
               AND expires_at_ms <= ?1",
            params![now_ms, automation_id, scheduled_for_ms],
        )?;
        affected_lease_ids.extend(expired_ids);
        let active = connection
            .query_row(
                "SELECT 1 FROM core_automation_leases \
                 WHERE automation_id = ?1 AND scheduled_for_ms = ?2 AND status = 'claimed'",
                params![automation_id, scheduled_for_ms],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if active {
            continue;
        }
        let attempt: i64 = connection.query_row(
            "SELECT COALESCE(max(attempt), 0) + 1 FROM core_automation_leases \
             WHERE automation_id = ?1 AND scheduled_for_ms = ?2",
            params![automation_id, scheduled_for_ms],
            |row| row.get(0),
        )?;
        let attempt_u32 = u32::try_from(attempt)
            .map_err(|_| corrupt("Automation lease attempt exceeds its bound"))?;
        let lease_id = lease_id(operation_id, &automation_id, scheduled_for_ms, attempt_u32);
        connection.execute(
            "INSERT INTO core_automation_leases(\
               lease_id, automation_id, scheduled_for_ms, attempt, status, claimed_at_ms, \
               expires_at_ms, settled_at_ms, retry_at_ms, reason_code\
             ) VALUES (?1, ?2, ?3, ?4, 'claimed', ?5, ?6, NULL, NULL, NULL)",
            params![
                lease_id,
                automation_id,
                scheduled_for_ms,
                attempt,
                now_ms,
                expires_at_ms,
            ],
        )?;
        leases.push(
            read_lease(connection, &lease_id)?
                .ok_or_else(|| corrupt("Claimed Automation lease is unavailable"))?,
        );
        affected_lease_ids.push(lease_id);
    }
    let mut automation_ids = leases
        .iter()
        .map(|lease| lease.automation_id.clone())
        .collect::<Vec<_>>();
    automation_ids.sort();
    automation_ids.dedup();
    let definitions = automation_ids
        .iter()
        .map(|id| {
            read_definition(connection, id)?
                .ok_or_else(|| corrupt("Claimed Automation definition is unavailable"))
        })
        .collect::<Result<Vec<_>, _>>()?;
    affected_lease_ids.sort();
    affected_lease_ids.dedup();
    finish_mutation(
        connection,
        library_id,
        context,
        store_epoch,
        operation_id,
        request_hash,
        MutationEffects {
            operation_kind: "claim_due",
            automation_ids,
            definitions,
            claimed_leases: leases,
            lease_ids: affected_lease_ids,
            committed_at,
        },
    )
}

#[allow(clippy::too_many_arguments)]
fn settle_lease(
    connection: &Connection,
    library_id: &str,
    context: &BoundModuleContext,
    store_epoch: &str,
    operation_id: &str,
    request_hash: &str,
    lease_id: &str,
    retry_delay_ms: Option<u64>,
    reason_code: Option<&String>,
) -> Result<AutomationApplyOutcome, StoreError> {
    validate_id("lease_id", lease_id)?;
    let reason_code = reason_code
        .map(|value| normalize_reason_code(value))
        .transpose()?;
    if retry_delay_ms.is_some_and(|delay| delay > MAX_RETRY_DELAY_MS) {
        return Err(invalid("Automation retry delay exceeds its bound"));
    }
    let (now_ms, committed_at) = core_now(connection)?;
    let lease = read_lease(connection, lease_id)?
        .ok_or_else(|| not_found("Automation lease is unavailable"))?;
    if lease.status != AutomationLeaseStatus::Claimed {
        return Err(conflict("Automation lease is already settled"));
    }
    if lease.expires_at_ms <= now_ms {
        return Err(conflict("Automation lease expired before settlement"));
    }
    let definition = read_definition(connection, &lease.automation_id)?
        .ok_or_else(|| corrupt("Automation lease definition is unavailable"))?;
    let failed = reason_code.is_some();
    let retry_at_ms =
        retry_delay_ms
            .map(|delay| {
                now_ms
                    .checked_add(i64::try_from(delay).map_err(|_| {
                        invalid("Automation retry delay exceeds the timestamp range")
                    })?)
                    .ok_or_else(|| invalid("Automation retry time exceeds the timestamp range"))
            })
            .transpose()?;
    connection.execute(
        "UPDATE core_automation_leases SET status = ?1, settled_at_ms = ?2, retry_at_ms = ?3, \
           reason_code = ?4 WHERE lease_id = ?5 AND status = 'claimed'",
        params![
            if failed { "failed" } else { "completed" },
            now_ms,
            retry_at_ms,
            reason_code,
            lease_id,
        ],
    )?;
    let next_scheduled = if definition.status == AutomationDefinitionStatus::Active {
        scheduled_next_for_stored(connection, &definition, now_ms)?
    } else {
        None
    };
    let next_run = if failed {
        match (retry_at_ms, next_scheduled) {
            (Some(retry), Some(scheduled)) => Some(retry.min(scheduled)),
            (Some(retry), None) => Some(retry),
            (None, scheduled) => scheduled,
        }
    } else {
        next_scheduled
    };
    connection.execute(
        "UPDATE codex_scheduled_automations SET next_run_at = ?1, \
           last_run_at = CASE WHEN ?2 THEN last_run_at ELSE ?3 END, updated_at = ?3 \
         WHERE automation_id = ?4",
        params![next_run, failed, now_ms, lease.automation_id],
    )?;
    let stored = read_definition(connection, &lease.automation_id)?
        .ok_or_else(|| corrupt("Settled Automation definition is unavailable"))?;
    finish_mutation(
        connection,
        library_id,
        context,
        store_epoch,
        operation_id,
        request_hash,
        MutationEffects {
            operation_kind: if failed {
                "fail_lease"
            } else {
                "complete_lease"
            },
            automation_ids: vec![lease.automation_id],
            definitions: vec![stored],
            claimed_leases: Vec::new(),
            lease_ids: vec![lease_id.to_owned()],
            committed_at,
        },
    )
}

#[allow(clippy::too_many_arguments)]
fn finish_mutation(
    connection: &Connection,
    library_id: &str,
    context: &BoundModuleContext,
    store_epoch: &str,
    operation_id: &str,
    request_hash: &str,
    effects: MutationEffects,
) -> Result<AutomationApplyOutcome, StoreError> {
    let project_id = event_project_id(connection, library_id, context)?;
    let payload = json!({
        "module": MODULE_NAME,
        "operationKind": effects.operation_kind,
        "kind": "automation_changed",
        "automationIds": effects.automation_ids,
        "leaseIds": effects.lease_ids,
    });
    connection.execute(
        "INSERT INTO change_log(\
           project_id, store_epoch, kind, operation_id, block_ids_json, document_ids_json, \
           database_block_ids_json, payload_json, committed_at\
         ) VALUES (?1, ?2, 'automation.changed', ?3, '[]', '[]', '[]', ?4, ?5)",
        params![
            project_id,
            store_epoch,
            operation_id,
            serde_json::to_string(&payload)
                .map_err(|_| internal("Automation event payload cannot be encoded"))?,
            effects.committed_at,
        ],
    )?;
    let event_sequence = connection.last_insert_rowid();
    let committed = CommittedModuleValue {
        value: AutomationCommitValue {
            affected_automation_ids: effects.automation_ids.clone(),
            definitions: effects.definitions,
            claimed_leases: effects.claimed_leases,
        },
        receipt: AutomationReceipt {
            mutation: ModuleMutationReceipt {
                operation_id: operation_id.to_owned(),
                duplicate: false,
            },
            affected_automation_ids: effects.automation_ids.clone(),
            affected_lease_ids: effects.lease_ids.clone(),
        },
        event_sequence,
        store_epoch: StoreEpoch(store_epoch.to_owned()),
    };
    let result = serde_json::to_value(&committed)
        .map_err(|_| internal("Automation receipt result cannot be encoded"))?;
    insert_module_receipt(
        connection,
        NewModuleReceipt {
            module_name: MODULE_NAME,
            operation_id,
            context,
            operation_kind: effects.operation_kind,
            store_epoch,
            request_hash,
            result: &result,
            event_sequence: Some(event_sequence),
            committed_at: &effects.committed_at,
        },
    )?;
    Ok(AutomationApplyOutcome {
        committed,
        event: Some(CommittedCoreModuleEvent {
            version: CORE_CONTRACT_VERSION,
            sequence: event_sequence,
            store_epoch: StoreEpoch(store_epoch.to_owned()),
            operation_id: Some(operation_id.to_owned()),
            committed_at: effects.committed_at,
            payload: CoreModuleEventPayload::Automation(AutomationEvent {
                kind: AutomationEventKind::AutomationChanged,
                automation_ids: effects.automation_ids,
                lease_ids: effects.lease_ids,
            }),
        }),
    })
}

fn normalize_definition(
    connection: &Connection,
    input: &AutomationDefinitionInput,
) -> Result<NormalizedDefinition, StoreError> {
    let name = input.name.trim();
    if name.is_empty() || name.chars().count() > MAX_NAME_CHARS {
        return Err(invalid("Scheduled Automation name is invalid"));
    }
    let prompt = input.prompt.as_deref().unwrap_or_default().trim();
    if prompt.len() > MAX_PROMPT_BYTES {
        return Err(invalid("Scheduled Automation prompt exceeds its bound"));
    }
    let rrule = normalize_rrule(input.rrule.as_deref()).map_err(schedule_invalid)?;
    let model = normalize_optional_string(input.model.as_deref(), MAX_MODEL_BYTES, "model")?;
    let target_thread_id = normalize_optional_string(
        input.target_thread_id.as_deref(),
        MAX_ID_LENGTH,
        "target_thread_id",
    )?;
    let execution_environment = input
        .execution_environment
        .unwrap_or(AutomationExecutionEnvironment::Worktree);
    let local_environment_config_path = input
        .local_environment_config_path
        .as_deref()
        .map(|value| normalize_absolute_path(value, "local_environment_config_path"))
        .transpose()?;
    let cwds = normalize_cwds(input.cwds.as_deref().unwrap_or_default())?;

    match input.kind {
        AutomationDefinitionKind::Cron => {
            if cwds.is_empty() {
                return Err(invalid(
                    "Cron Scheduled Automation requires at least one cwd",
                ));
            }
            if target_thread_id.is_some() {
                return Err(invalid("Cron Scheduled Automation cannot target a Thread"));
            }
        }
        AutomationDefinitionKind::Heartbeat => {
            let target = target_thread_id.as_deref().ok_or_else(|| {
                invalid("Heartbeat Scheduled Automation requires a target Thread")
            })?;
            if !cwds.is_empty() || local_environment_config_path.is_some() {
                return Err(invalid(
                    "Heartbeat Scheduled Automation cannot own cron execution paths",
                ));
            }
            let exists = connection
                .query_row(
                    "SELECT 1 FROM codex_threads WHERE thread_id = ?1",
                    [target],
                    |_| Ok(()),
                )
                .optional()?
                .is_some();
            if !exists {
                return Err(not_found("Heartbeat target Thread is unavailable"));
            }
        }
    }

    Ok(NormalizedDefinition {
        kind: input.kind,
        target_thread_id,
        name: name.to_owned(),
        prompt: prompt.to_owned(),
        rrule,
        model,
        reasoning_effort: input.reasoning_effort,
        cwds,
        execution_environment,
        local_environment_config_path: if input.kind == AutomationDefinitionKind::Cron {
            local_environment_config_path
        } else {
            None
        },
    })
}

fn normalize_cwds(values: &[String]) -> Result<Vec<String>, StoreError> {
    if values.len() > MAX_CWDS {
        return Err(invalid("Scheduled Automation cwd list exceeds its bound"));
    }
    let mut seen = BTreeSet::new();
    let mut result = Vec::new();
    for value in values {
        let cwd = normalize_absolute_path(value, "cwd")?;
        if seen.insert(cwd.clone()) {
            result.push(cwd);
        }
    }
    Ok(result)
}

fn normalize_absolute_path(value: &str, label: &str) -> Result<String, StoreError> {
    let value = value.trim();
    if value.is_empty() || value.len() > MAX_PATH_BYTES || !is_absolute_path(value) {
        return Err(invalid(&format!("Scheduled Automation {label} is invalid")));
    }
    if looks_like_windows_absolute(value) {
        return Ok(value.replace('\\', "/"));
    }
    let mut normalized = PathBuf::new();
    for component in Path::new(value).components() {
        match component {
            Component::RootDir | Component::Prefix(_) | Component::Normal(_) => {
                normalized.push(component.as_os_str());
            }
            Component::CurDir => {}
            Component::ParentDir => {
                if !normalized.pop() {
                    return Err(invalid(&format!(
                        "Scheduled Automation {label} escapes its root"
                    )));
                }
            }
        }
    }
    normalized
        .to_str()
        .filter(|path| !path.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| invalid(&format!("Scheduled Automation {label} is invalid UTF-8")))
}

fn is_absolute_path(value: &str) -> bool {
    Path::new(value).is_absolute()
        || looks_like_windows_absolute(value)
        || value
            .strip_prefix("\\\\")
            .is_some_and(|rest| rest.split('\\').filter(|part| !part.is_empty()).count() >= 2)
}

fn looks_like_windows_absolute(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() >= 3
        && bytes[0].is_ascii_alphabetic()
        && bytes[1] == b':'
        && matches!(bytes[2], b'/' | b'\\')
}

fn normalize_optional_string(
    value: Option<&str>,
    max_bytes: usize,
    label: &str,
) -> Result<Option<String>, StoreError> {
    let Some(value) = value else {
        return Ok(None);
    };
    let value = value.trim();
    if value.is_empty() {
        return Ok(None);
    }
    if value.len() > max_bytes {
        return Err(invalid(&format!(
            "Scheduled Automation {label} exceeds its bound"
        )));
    }
    Ok(Some(value.to_owned()))
}

fn require_unique_active_heartbeat(
    connection: &Connection,
    automation_id: &str,
    status: AutomationDefinitionStatus,
    definition: &NormalizedDefinition,
) -> Result<(), StoreError> {
    if definition.kind != AutomationDefinitionKind::Heartbeat
        || status != AutomationDefinitionStatus::Active
    {
        return Ok(());
    }
    let duplicate = connection
        .query_row(
            "SELECT 1 FROM codex_scheduled_automations \
             WHERE automation_id <> ?1 AND kind = 'heartbeat' AND status = 'ACTIVE' \
               AND target_thread_id = ?2",
            params![automation_id, definition.target_thread_id],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if duplicate {
        return Err(conflict("Target Thread already has an active heartbeat"));
    }
    Ok(())
}

fn scheduled_next(
    connection: &Connection,
    automation_id: &str,
    definition: &NormalizedDefinition,
    now_ms: i64,
) -> Result<Option<i64>, StoreError> {
    let salt = jitter_salt(connection)?;
    next_run_at(
        automation_id,
        definition.kind,
        &definition.rrule,
        now_ms,
        &salt,
    )
    .map_err(schedule_invalid)
}

fn scheduled_next_for_stored(
    connection: &Connection,
    definition: &AutomationDefinition,
    now_ms: i64,
) -> Result<Option<i64>, StoreError> {
    let salt = jitter_salt(connection)?;
    next_run_at(
        &definition.automation_id,
        definition.kind,
        &definition.rrule,
        now_ms,
        &salt,
    )
    .map_err(|_| corrupt("Stored Scheduled Automation RRULE is invalid"))
}

fn jitter_salt(connection: &Connection) -> Result<String, StoreError> {
    connection
        .query_row(
            "SELECT jitter_salt FROM core_automation_runtime_metadata WHERE id = 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .filter(|salt| !salt.is_empty() && salt.len() <= 512)
        .ok_or_else(|| corrupt("Automation jitter salt is unavailable"))
}

fn cancel_claimed_leases(
    connection: &Connection,
    automation_id: &str,
    now_ms: i64,
    reason_code: &str,
) -> Result<Vec<String>, StoreError> {
    let lease_ids = {
        let mut statement = connection.prepare(
            "SELECT lease_id FROM core_automation_leases \
             WHERE automation_id = ?1 AND status = 'claimed' ORDER BY lease_id",
        )?;
        statement
            .query_map([automation_id], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?
    };
    connection.execute(
        "UPDATE core_automation_leases SET status = 'cancelled', settled_at_ms = ?1, \
           reason_code = ?2 WHERE automation_id = ?3 AND status = 'claimed'",
        params![now_ms, reason_code, automation_id],
    )?;
    Ok(lease_ids)
}

fn event_project_id(
    connection: &Connection,
    library_id: &str,
    context: &BoundModuleContext,
) -> Result<String, StoreError> {
    if let Some(project_id) = context.project_id.as_ref() {
        let bound = connection
            .query_row(
                "SELECT id FROM projects WHERE id = ?1 AND library_id = ?2",
                params![project_id.0, library_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        if let Some(bound) = bound {
            return Ok(bound);
        }
        return Err(StoreError::new(
            StoreErrorCode::Unauthorized,
            "bound Automation Project is unavailable in this Library",
            false,
        ));
    }
    connection
        .query_row(
            "SELECT id FROM projects WHERE library_id = ?1 \
             ORDER BY CASE lifecycle WHEN 'active' THEN 0 ELSE 1 END, created, id LIMIT 1",
            [library_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or_else(|| corrupt("Automation event has no Project scope"))
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

fn lease_id(
    operation_id: &str,
    automation_id: &str,
    scheduled_for_ms: i64,
    attempt: u32,
) -> String {
    let digest = Sha256::digest(
        format!("{operation_id}:{automation_id}:{scheduled_for_ms}:{attempt}").as_bytes(),
    );
    format!("automation-lease:{}", hex_digest(&digest))
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

fn require_trusted_host(
    context: &BoundModuleContext,
    intent: &AutomationIntent,
) -> Result<(), StoreError> {
    if !matches!(
        intent,
        AutomationIntent::ClaimDue { .. }
            | AutomationIntent::CompleteLease { .. }
            | AutomationIntent::FailLease { .. }
    ) || matches!(
        context.adapter,
        AdapterKind::ElectronHost | AdapterKind::Test
    ) {
        return Ok(());
    }
    Err(StoreError::new(
        StoreErrorCode::Unauthorized,
        "Automation lease transitions require a trusted Host Adapter",
        false,
    ))
}

fn normalize_reason_code(value: &str) -> Result<String, StoreError> {
    let value = value.trim();
    if value.is_empty() || value.len() > MAX_REASON_CODE_BYTES {
        return Err(invalid("Automation failure reason code is invalid"));
    }
    Ok(value.to_owned())
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

fn schedule_invalid(error: ScheduleError) -> StoreError {
    invalid(error.0)
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

#[cfg(test)]
mod tests {
    use nodex_core_contracts::automation::{
        AutomationDefinitionInput, AutomationDefinitionKind, AutomationDefinitionStatus,
        AutomationIntent, AutomationLeaseStatus, AutomationRead, AutomationReadValue,
    };
    use nodex_core_contracts::{
        AdapterKind, BoundModuleContext, CORE_CONTRACT_VERSION, LibraryId, ModuleApplyRequest,
        ModuleReadRequest, ProfileId, StoreEpoch,
    };
    use tempfile::{TempDir, tempdir};

    use crate::automation::AutomationModule;
    use crate::infrastructure::store::SqliteStoreKernel;
    use crate::workspace::ProjectWorkspaceModule;

    struct Harness {
        _home: TempDir,
        kernel: SqliteStoreKernel,
        module: AutomationModule,
        context: BoundModuleContext,
        store_epoch: StoreEpoch,
    }

    fn harness() -> Harness {
        let home = tempdir().expect("Profile");
        let kernel = SqliteStoreKernel::open(home.path()).expect("Core store");
        kernel
            .writer()
            .call(|connection| {
                connection.execute(
                    "INSERT INTO profiles(id, created_at, updated_at) \
                     VALUES ('profile-1', '2026-07-18', '2026-07-18')",
                    [],
                )?;
                connection.execute(
                    "INSERT INTO libraries(id, profile_id, created_at, updated_at) \
                     VALUES ('library-1', 'profile-1', '2026-07-18', '2026-07-18')",
                    [],
                )?;
                connection.execute(
                    "INSERT INTO block_store_metadata(id, store_epoch, created_at, updated_at) \
                     VALUES (1, 'epoch-1', '2026-07-18', '2026-07-18')",
                    [],
                )?;
                Ok(())
            })
            .expect("seed identity");
        ProjectWorkspaceModule::new("profile-1", "library-1", &kernel).expect("default Project");
        let module = AutomationModule::new("profile-1", "library-1", &kernel);
        Harness {
            _home: home,
            kernel,
            module,
            context: BoundModuleContext {
                profile_id: ProfileId("profile-1".to_owned()),
                library_id: LibraryId("library-1".to_owned()),
                project_id: None,
                connection_id: "test-connection".to_owned(),
                adapter: AdapterKind::Test,
            },
            store_epoch: StoreEpoch("epoch-1".to_owned()),
        }
    }

    fn definition() -> AutomationDefinitionInput {
        AutomationDefinitionInput {
            kind: AutomationDefinitionKind::Cron,
            target_thread_id: None,
            name: "Daily report".to_owned(),
            prompt: Some("Prepare the report".to_owned()),
            rrule: Some("FREQ=MINUTELY;INTERVAL=5".to_owned()),
            model: None,
            reasoning_effort: None,
            cwds: Some(vec!["/workspace/report".to_owned()]),
            execution_environment: None,
            local_environment_config_path: None,
        }
    }

    fn apply(
        harness: &Harness,
        operation_id: &str,
        intent: AutomationIntent,
    ) -> Result<crate::automation::AutomationApplyOutcome, nodex_core_contracts::CoreError> {
        harness.module.apply(
            &harness.context,
            ModuleApplyRequest {
                version: CORE_CONTRACT_VERSION,
                operation_id: operation_id.to_owned(),
                store_epoch: harness.store_epoch.clone(),
                intent,
            },
        )
    }

    fn create(harness: &Harness) {
        apply(
            harness,
            "create-automation",
            AutomationIntent::CreateDefinition {
                automation_id: "daily-report".to_owned(),
                definition: definition(),
            },
        )
        .expect("create Automation");
    }

    #[test]
    fn definitions_are_typed_revisioned_and_exactly_replayed() {
        let harness = harness();
        let created = apply(
            &harness,
            "create-automation",
            AutomationIntent::CreateDefinition {
                automation_id: "daily-report".to_owned(),
                definition: definition(),
            },
        )
        .expect("create Automation");
        assert_eq!(
            created.committed.value.definitions[0].definition_revision,
            1
        );
        assert!(
            created.committed.value.definitions[0]
                .next_run_at_ms
                .is_some()
        );

        let replay = apply(
            &harness,
            "create-automation",
            AutomationIntent::CreateDefinition {
                automation_id: "daily-report".to_owned(),
                definition: definition(),
            },
        )
        .expect("replay Automation");
        assert_eq!(
            replay.committed.event_sequence,
            created.committed.event_sequence
        );
        assert!(replay.committed.receipt.mutation.duplicate);
        assert!(replay.event.is_none());

        let snapshot = harness
            .module
            .read(
                &harness.context,
                ModuleReadRequest {
                    version: CORE_CONTRACT_VERSION,
                    read: AutomationRead::Definitions {
                        include_deleted: None,
                    },
                },
            )
            .expect("read Automations");
        let AutomationReadValue::Definitions { items } = snapshot.value else {
            panic!("definitions snapshot");
        };
        assert_eq!(items, created.committed.value.definitions);
    }

    #[test]
    fn durable_due_leases_reclaim_expiry_and_settle_once() {
        let harness = harness();
        create(&harness);
        harness
            .kernel
            .writer()
            .call(|connection| {
                connection.execute(
                    "UPDATE codex_scheduled_automations SET next_run_at = 0 \
                     WHERE automation_id = 'daily-report'",
                    [],
                )?;
                Ok(())
            })
            .expect("make Automation due");

        let first = apply(
            &harness,
            "claim-1",
            AutomationIntent::ClaimDue {
                limit: 3,
                lease_duration_ms: 60_000,
            },
        )
        .expect("claim due Automation");
        let first_lease = first.committed.value.claimed_leases[0].clone();
        assert_eq!(first_lease.attempt, 1);

        harness
            .kernel
            .writer()
            .call({
                let lease_id = first_lease.lease_id.clone();
                move |connection| {
                    connection.execute(
                        "UPDATE core_automation_leases SET claimed_at_ms = 0, expires_at_ms = 1 \
                         WHERE lease_id = ?1",
                        [lease_id],
                    )?;
                    Ok(())
                }
            })
            .expect("expire lease");
        let second = apply(
            &harness,
            "claim-2",
            AutomationIntent::ClaimDue {
                limit: 3,
                lease_duration_ms: 60_000,
            },
        )
        .expect("reclaim due Automation");
        let second_lease = second.committed.value.claimed_leases[0].clone();
        assert_eq!(second_lease.attempt, 2);

        let completed = apply(
            &harness,
            "complete-2",
            AutomationIntent::CompleteLease {
                lease_id: second_lease.lease_id.clone(),
            },
        )
        .expect("complete lease");
        assert!(
            completed.committed.value.definitions[0]
                .last_run_at_ms
                .is_some()
        );
        assert!(
            completed.committed.value.definitions[0]
                .next_run_at_ms
                .is_some()
        );
        let duplicate = apply(
            &harness,
            "complete-2",
            AutomationIntent::CompleteLease {
                lease_id: second_lease.lease_id,
            },
        )
        .expect("replay completion");
        assert!(duplicate.committed.receipt.mutation.duplicate);
    }

    #[test]
    fn untrusted_claim_does_not_consume_due_work() {
        let harness = harness();
        create(&harness);
        harness
            .kernel
            .writer()
            .call(|connection| {
                connection.execute(
                    "UPDATE codex_scheduled_automations SET next_run_at = 0 \
                     WHERE automation_id = 'daily-report'",
                    [],
                )?;
                Ok(())
            })
            .expect("make Automation due");
        let mut context = harness.context.clone();
        context.adapter = AdapterKind::Agent;
        let error = harness
            .module
            .apply(
                &context,
                ModuleApplyRequest {
                    version: CORE_CONTRACT_VERSION,
                    operation_id: "untrusted-claim".to_owned(),
                    store_epoch: harness.store_epoch.clone(),
                    intent: AutomationIntent::ClaimDue {
                        limit: 1,
                        lease_duration_ms: 60_000,
                    },
                },
            )
            .expect_err("Agent cannot claim");
        assert_eq!(
            error.code,
            nodex_core_contracts::CoreErrorCode::Unauthorized
        );
        let next_run = harness
            .kernel
            .readers()
            .read_default(|connection| {
                connection
                    .query_row(
                        "SELECT next_run_at FROM codex_scheduled_automations \
                         WHERE automation_id = 'daily-report'",
                        [],
                        |row| row.get::<_, i64>(0),
                    )
                    .map_err(Into::into)
            })
            .expect("due timestamp");
        assert_eq!(next_run, 0);
    }

    #[test]
    fn pause_cancels_claims_and_revision_fences_delete() {
        let harness = harness();
        create(&harness);
        harness
            .kernel
            .writer()
            .call(|connection| {
                connection.execute(
                    "UPDATE codex_scheduled_automations SET next_run_at = 0 \
                     WHERE automation_id = 'daily-report'",
                    [],
                )?;
                Ok(())
            })
            .expect("make Automation due");
        let claim = apply(
            &harness,
            "claim-before-pause",
            AutomationIntent::ClaimDue {
                limit: 1,
                lease_duration_ms: 60_000,
            },
        )
        .expect("claim Automation");
        let lease_id = claim.committed.value.claimed_leases[0].lease_id.clone();

        let paused = apply(
            &harness,
            "pause-automation",
            AutomationIntent::UpdateDefinition {
                automation_id: "daily-report".to_owned(),
                expected_revision: 1,
                status: AutomationDefinitionStatus::Paused,
                definition: definition(),
            },
        )
        .expect("pause Automation");
        assert_eq!(paused.committed.value.definitions[0].definition_revision, 2);
        assert_eq!(paused.committed.value.definitions[0].next_run_at_ms, None);
        assert_eq!(
            paused.committed.receipt.affected_lease_ids.as_slice(),
            std::slice::from_ref(&lease_id)
        );
        let leases = harness
            .module
            .read(
                &harness.context,
                ModuleReadRequest {
                    version: CORE_CONTRACT_VERSION,
                    read: AutomationRead::Leases {
                        automation_id: Some("daily-report".to_owned()),
                        include_settled: Some(true),
                        limit: None,
                    },
                },
            )
            .expect("read leases");
        let AutomationReadValue::Leases { items } = leases.value else {
            panic!("lease snapshot");
        };
        assert_eq!(items[0].status, AutomationLeaseStatus::Cancelled);

        let stale = apply(
            &harness,
            "stale-delete",
            AutomationIntent::DeleteDefinition {
                automation_id: "daily-report".to_owned(),
                expected_revision: 1,
            },
        )
        .expect_err("stale revision");
        assert_eq!(
            stale.code,
            nodex_core_contracts::CoreErrorCode::RevisionConflict
        );
        let deleted = apply(
            &harness,
            "delete-automation",
            AutomationIntent::DeleteDefinition {
                automation_id: "daily-report".to_owned(),
                expected_revision: 2,
            },
        )
        .expect("delete Automation");
        assert_eq!(
            deleted.committed.value.definitions[0].definition_revision,
            3
        );
        assert_eq!(
            deleted.committed.value.definitions[0].status,
            AutomationDefinitionStatus::Deleted
        );
    }

    #[test]
    fn failed_lease_records_reason_and_bounded_retry_without_last_run() {
        let harness = harness();
        create(&harness);
        harness
            .kernel
            .writer()
            .call(|connection| {
                connection.execute(
                    "UPDATE codex_scheduled_automations SET next_run_at = 0 \
                     WHERE automation_id = 'daily-report'",
                    [],
                )?;
                Ok(())
            })
            .expect("make Automation due");
        let claim = apply(
            &harness,
            "claim-before-failure",
            AutomationIntent::ClaimDue {
                limit: 1,
                lease_duration_ms: 60_000,
            },
        )
        .expect("claim Automation");
        let lease_id = claim.committed.value.claimed_leases[0].lease_id.clone();
        let failed = apply(
            &harness,
            "fail-automation",
            AutomationIntent::FailLease {
                lease_id: lease_id.clone(),
                retry_delay_ms: Some(5_000),
                reason_code: "host_unavailable".to_owned(),
            },
        )
        .expect("fail lease");
        assert_eq!(failed.committed.value.definitions[0].last_run_at_ms, None);
        assert!(
            failed.committed.value.definitions[0]
                .next_run_at_ms
                .is_some()
        );
        let lease = harness
            .kernel
            .readers()
            .read_default(move |connection| super::read_lease(connection, &lease_id))
            .expect("failed lease")
            .expect("lease exists");
        assert_eq!(lease.status, AutomationLeaseStatus::Failed);
        assert_eq!(lease.reason_code.as_deref(), Some("host_unavailable"));
        assert!(lease.retry_at_ms.is_some());
    }
}
