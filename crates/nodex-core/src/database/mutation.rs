use std::collections::{BTreeMap, BTreeSet, HashSet};

use nodex_core_contracts::database::{
    DatabaseCommitValue, DatabaseEvent, DatabaseEventKind, DatabaseIntent, DatabasePagePosition,
    DatabasePagePropertyAddress, DatabasePropertyCapabilities, DatabasePropertyFilterOperator,
    DatabasePropertySchema, DatabasePropertySetDelta, DatabasePropertyValueEdit,
    DatabasePropertyValueInput, DatabasePropertyValueMutation, DatabaseReceipt,
    DatabaseTransferTarget,
};
use nodex_core_contracts::events::ResourceKey;
use nodex_core_contracts::{
    BoundModuleContext, CoreModuleEventPayload, ModuleApplyRequest, ModuleMutationReceipt,
    ModuleName, StoreEpoch,
};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use unicode_normalization::UnicodeNormalization;

use crate::document::{read_store_epoch, sha256};
use crate::domain::fractional_rank::{
    FractionalRankError, FractionalRankErrorCode, RankedItem, plan as plan_fractional_rank,
};
use crate::domain::view_position::{
    LogicalViewPositionItem, ViewPositionPlanError, ViewSiblingRankWriteKind,
    plan_view_position_run,
};
use crate::infrastructure::durable_mutation::{
    self, CommitResult, DurableMutationScope, OperationIdentity, ReceiptMetadata, SealedOutcome,
};
use crate::infrastructure::event_log::{
    NewChangeLogEntry, append_change_log, load_committed_event_by_sequence,
};
use crate::infrastructure::projection_impact::{expand_database_coordinates, impact_for_payload};
use crate::infrastructure::sqlite::{StoreError, StoreErrorCode, with_immediate_transaction};
use crate::infrastructure::writer::StoreWriter;

use super::DatabaseApplyOutcome;
use super::is_trusted_library_database_context;
use super::relation::RelationValueEdit as RelationEdit;

const MODULE_NAME: &str = "database";
const MAX_OPERATIONS: usize = 64;
const MAX_BULK_VALUES: usize = 4_096;
const MAX_ID_LENGTH: usize = 512;
const MAX_PROPERTY_ID_LENGTH: usize = 128;
const MAX_NAME_LENGTH: usize = 256;
const MAX_VIEW_SORT_RULES: usize = 4;
const MAX_VIEW_DISPLAY_PROPERTIES: usize = 64;

#[derive(Default)]
struct MutationEffects {
    database_ids: BTreeSet<String>,
    data_source_ids: BTreeSet<String>,
    page_ids: BTreeSet<String>,
    view_ids: BTreeSet<String>,
    revisions: BTreeMap<String, i64>,
}

struct DatabaseMutationAuthority {
    ledger_project_id: String,
    project_id: Option<String>,
}

impl DatabaseMutationAuthority {
    fn is_library(&self) -> bool {
        self.project_id.is_none()
    }
}

#[derive(Debug)]
struct SourceRow {
    id: String,
    database_id: String,
    lifecycle: String,
    revision: i64,
}

#[derive(Debug)]
pub(crate) struct PropertyRow {
    pub(crate) id: String,
    pub(crate) value_type: String,
    pub(crate) config_json: String,
    pub(crate) rank_key: String,
    pub(crate) lifecycle: String,
    pub(crate) revision: i64,
    pub(crate) created_at: String,
}

#[derive(Debug)]
struct ContainerRow {
    default_view_id: Option<String>,
    lifecycle: String,
}

#[derive(Debug)]
struct ViewRow {
    id: String,
    database_id: String,
    data_source_id: String,
    config_json: String,
    rank_key: String,
    lifecycle: String,
    revision: i64,
    created_at: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
struct PropertyOption {
    id: String,
    name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    color: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct OptionConfig {
    options: Vec<PropertyOption>,
}

pub(super) fn apply(
    writer: &StoreWriter,
    profile_id: &str,
    library_id: &str,
    context: &BoundModuleContext,
    request: ModuleApplyRequest<Vec<DatabaseIntent>>,
) -> Result<DatabaseApplyOutcome, StoreError> {
    validate_request(&request)?;
    let profile_id = profile_id.to_owned();
    let library_id = library_id.to_owned();
    let context = context.clone();
    writer.call(move |connection| {
        with_immediate_transaction(connection, |transaction| {
            apply_in_transaction(transaction, &profile_id, &library_id, &context, &request)
        })
    })
}

pub(crate) fn apply_in_transaction(
    connection: &Connection,
    profile_id: &str,
    library_id: &str,
    context: &BoundModuleContext,
    request: &ModuleApplyRequest<Vec<DatabaseIntent>>,
) -> Result<DatabaseApplyOutcome, StoreError> {
    validate_request(request)?;
    assert_identity(connection, profile_id, library_id)?;
    let authority = mutation_authority(connection, library_id, context)?;
    let store_epoch = read_store_epoch(connection)?;
    if request.store_epoch.0 != store_epoch {
        return Err(StoreError::new(
            StoreErrorCode::StaleStoreEpoch,
            "Database mutation targets a stale store epoch",
            true,
        ));
    }
    let fingerprint = serde_json::to_vec(&(
        &context.profile_id,
        &context.library_id,
        &context.project_id,
        &context.adapter,
        request.contract_version,
        &request.store_epoch,
        &request.intent,
    ))
    .map_err(|_| internal("Database mutation cannot be fingerprinted"))?;
    let request_hash = sha256(&fingerprint);
    let now = sqlite_now(connection)?;
    let result = durable_mutation::run(
        connection,
        OperationIdentity {
            module: ModuleName::Database,
            module_name: MODULE_NAME,
            operation_id: &request.operation_id,
            intent_hash: &request_hash,
            store_epoch: &store_epoch,
            committed_at: &now,
            context,
        },
        |scope| {
            let transfer_pages = request.intent.iter().filter_map(|intent| match intent {
                DatabaseIntent::TransferPage { page_id, .. } => Some(ResourceKey::Page {
                    page_id: page_id.clone(),
                }),
                _ => None,
            });
            scope.observe_authorization_before(
                crate::infrastructure::resource_authorization::capture_project_visibility(
                    scope.connection(),
                    library_id,
                    transfer_pages,
                )?,
            );
            let mut effects = MutationEffects::default();
            for intent in &request.intent {
                apply_intent(
                    scope.connection(),
                    library_id,
                    &authority,
                    intent,
                    &now,
                    &mut effects,
                )?;
            }
            refresh_scheduled_page_indexes(scope.connection(), &effects.page_ids, &now)?;
            seal_commit(
                scope,
                context,
                request,
                &request_hash,
                &authority,
                &now,
                effects,
            )
        },
    )?;
    result.verify_manifest_identity(|committed| {
        (committed.commit_seq, committed.store_epoch.0.clone())
    })?;
    match result {
        CommitResult::Committed {
            outcome: committed, ..
        } => {
            let event = load_committed_event_by_sequence(connection, committed.event_sequence)?;
            Ok(DatabaseApplyOutcome {
                committed,
                event: Some(event),
            })
        }
        CommitResult::NoOp { outcome: committed } => Ok(DatabaseApplyOutcome {
            committed,
            event: None,
        }),
        CommitResult::IdempotentReplay {
            outcome: mut committed,
            manifest: _,
        } => {
            committed.receipt.mutation.duplicate = true;
            Ok(DatabaseApplyOutcome {
                committed,
                event: None,
            })
        }
    }
}

/// Applies Database canonical writes as part of an owning domain mutation.
/// The owner publishes the single receipt/event/manifest; this collaborator
/// must never allocate an independent commit for the same user command.
pub(crate) fn apply_as_collaborator(
    connection: &Connection,
    library_id: &str,
    context: &BoundModuleContext,
    operation_id: &str,
    intents: &[DatabaseIntent],
    committed_at: &str,
) -> Result<DatabaseReceipt, StoreError> {
    if intents.is_empty() || intents.len() > MAX_OPERATIONS {
        return Err(invalid("Database collaborator operation count is invalid"));
    }
    let authority = mutation_authority(connection, library_id, context)?;
    let mut effects = MutationEffects::default();
    for intent in intents {
        apply_intent(
            connection,
            library_id,
            &authority,
            intent,
            committed_at,
            &mut effects,
        )?;
    }
    refresh_scheduled_page_indexes(connection, &effects.page_ids, committed_at)?;
    Ok(DatabaseReceipt {
        mutation: ModuleMutationReceipt {
            // The owning receipt carries the public operation identity. This
            // private collaborator value is used only to merge typed effects.
            operation_id: operation_id.to_owned(),
            duplicate: false,
        },
        affected_database_ids: effects.database_ids.into_iter().collect(),
        affected_data_source_ids: effects.data_source_ids.into_iter().collect(),
        affected_page_ids: effects.page_ids.into_iter().collect(),
        affected_view_ids: effects.view_ids.into_iter().collect(),
        operation_kinds: intents
            .iter()
            .map(database_intent_kind)
            .map(str::to_owned)
            .collect(),
        committed_revisions: effects.revisions,
        commit_seq: 0,
        committed_at: committed_at.to_owned(),
    })
}

fn validate_request(request: &ModuleApplyRequest<Vec<DatabaseIntent>>) -> Result<(), StoreError> {
    validate_id(&request.operation_id, "operation_id", MAX_ID_LENGTH)?;
    if request.intent.is_empty() || request.intent.len() > MAX_OPERATIONS {
        return Err(invalid(format!(
            "Database apply requires between 1 and {MAX_OPERATIONS} operations"
        )));
    }
    for intent in &request.intent {
        if let DatabaseIntent::EditPropertyValues { edits } = intent
            && (edits.is_empty() || edits.len() > MAX_BULK_VALUES)
        {
            return Err(invalid(format!(
                "edit_property_values requires between 1 and {MAX_BULK_VALUES} edits"
            )));
        }
    }
    Ok(())
}

fn database_intent_kind(intent: &DatabaseIntent) -> &'static str {
    match intent {
        DatabaseIntent::PutProperty { .. } => "put_property",
        DatabaseIntent::DeleteProperty { .. } => "delete_property",
        DatabaseIntent::PutOption { .. } => "put_option",
        DatabaseIntent::DeleteOption { .. } => "delete_option",
        DatabaseIntent::EditPropertyValues { .. } => "edit_property_values",
        DatabaseIntent::TransferPage { .. } => "transfer_page",
        DatabaseIntent::PutView { .. } => "put_view",
        DatabaseIntent::DeleteView { .. } => "delete_view",
        DatabaseIntent::PositionPage { .. } => "position_page",
        DatabaseIntent::PositionPages { .. } => "position_pages",
    }
}

fn apply_intent(
    connection: &Connection,
    library_id: &str,
    authority: &DatabaseMutationAuthority,
    intent: &DatabaseIntent,
    now: &str,
    effects: &mut MutationEffects,
) -> Result<(), StoreError> {
    let project_id = authority.ledger_project_id.as_str();
    let library_scope = authority.is_library();
    match intent {
        DatabaseIntent::PutProperty {
            data_source_id,
            property_id,
            expected_data_source_revision,
            expected_property_revision,
            name,
            schema,
            before_property_id,
        } => put_property(
            connection,
            library_id,
            project_id,
            data_source_id,
            property_id,
            *expected_data_source_revision,
            *expected_property_revision,
            name,
            schema,
            before_property_id.as_deref(),
            now,
            effects,
            library_scope,
        ),
        DatabaseIntent::DeleteProperty {
            data_source_id,
            property_id,
            expected_data_source_revision,
            expected_property_revision,
        } => delete_property(
            connection,
            library_id,
            project_id,
            data_source_id,
            property_id,
            *expected_data_source_revision,
            *expected_property_revision,
            now,
            effects,
            library_scope,
        ),
        DatabaseIntent::PutOption {
            data_source_id,
            property_id,
            option_id,
            name,
            color,
            expected_property_revision,
        } => put_option(
            connection,
            library_id,
            project_id,
            data_source_id,
            property_id,
            option_id,
            name,
            color.as_deref(),
            *expected_property_revision,
            now,
            effects,
            library_scope,
        ),
        DatabaseIntent::DeleteOption {
            data_source_id,
            property_id,
            option_id,
            expected_property_revision,
        } => delete_option(
            connection,
            library_id,
            project_id,
            data_source_id,
            property_id,
            option_id,
            *expected_property_revision,
            now,
            effects,
            library_scope,
        ),
        DatabaseIntent::EditPropertyValues { edits } => {
            let mut addresses = HashSet::with_capacity(edits.len());
            for edit in edits {
                let address_key = (
                    edit.address.page_id.as_str(),
                    edit.address.data_source_id.as_str(),
                    edit.address.property_id.as_str(),
                );
                if !addresses.insert(address_key) {
                    return Err(invalid(
                        "edit_property_values contains a duplicate Page Property address",
                    ));
                }
                edit_property_value(
                    connection,
                    library_id,
                    project_id,
                    edit,
                    now,
                    effects,
                    library_scope,
                )?;
            }
            Ok(())
        }
        DatabaseIntent::PutView {
            database_id,
            data_source_id,
            view_id,
            expected_revision,
            name,
            view_kind,
            config,
            is_default,
            before_view_id,
        } => put_view(
            connection,
            library_id,
            project_id,
            database_id,
            data_source_id,
            view_id,
            *expected_revision,
            name,
            view_kind,
            config,
            *is_default,
            before_view_id.as_deref(),
            now,
            effects,
            library_scope,
        ),
        DatabaseIntent::DeleteView {
            database_id,
            view_id,
            expected_revision,
        } => delete_view(
            connection,
            library_id,
            project_id,
            database_id,
            view_id,
            *expected_revision,
            now,
            effects,
            library_scope,
        ),
        DatabaseIntent::PositionPage {
            view_id,
            page_id,
            expected_position_revision,
            group_key,
            before_page_id,
        } => position_pages(
            connection,
            library_id,
            project_id,
            view_id,
            &[DatabasePagePosition {
                page_id: page_id.clone(),
                expected_position_revision: *expected_position_revision,
            }],
            group_key.as_deref(),
            before_page_id.as_deref(),
            now,
            effects,
            library_scope,
        ),
        DatabaseIntent::PositionPages {
            view_id,
            pages,
            group_key,
            before_page_id,
        } => position_pages(
            connection,
            library_id,
            project_id,
            view_id,
            pages,
            group_key.as_deref(),
            before_page_id.as_deref(),
            now,
            effects,
            library_scope,
        ),
        DatabaseIntent::TransferPage {
            page_id,
            expected_parent_revision,
            expected_active_membership_revision,
            target,
        } => transfer_page(
            connection,
            library_id,
            project_id,
            page_id,
            *expected_parent_revision,
            *expected_active_membership_revision,
            target,
            now,
            effects,
            library_scope,
            false,
            false,
        ),
    }
}

#[allow(clippy::too_many_arguments)]
fn put_property(
    connection: &Connection,
    library_id: &str,
    project_id: &str,
    data_source_id: &str,
    property_id: &str,
    expected_source_revision: i64,
    expected_property_revision: i64,
    name: &str,
    schema: &DatabasePropertySchema,
    before_property_id: Option<&str>,
    now: &str,
    effects: &mut MutationEffects,
    library_scope: bool,
) -> Result<(), StoreError> {
    validate_id(data_source_id, "data_source_id", MAX_ID_LENGTH)?;
    validate_id(property_id, "property_id", MAX_PROPERTY_ID_LENGTH)?;
    let name = validate_name(name, "Property name")?;
    let value_type = super::property_semantics::value_type(schema);
    if let DatabasePropertySchema::Relation {
        target_data_source_id,
    } = schema
    {
        validate_id(
            target_data_source_id,
            "target_data_source_id",
            MAX_ID_LENGTH,
        )?;
    }
    let source = require_source(connection, library_id, data_source_id)?;
    authorize_write(
        connection,
        project_id,
        &source.database_id,
        DatabaseWriteAction::ManageSchema,
        library_scope,
    )?;
    if let DatabasePropertySchema::Relation {
        target_data_source_id,
    } = schema
    {
        authorize_relation_target_read(
            connection,
            library_id,
            project_id,
            target_data_source_id,
            library_scope,
        )?;
    }
    require_revision(
        expected_source_revision,
        source.revision,
        "Data Source revision changed",
    )?;
    let existing = property_row(connection, data_source_id, property_id)?;
    require_revision(
        expected_property_revision,
        existing.as_ref().map_or(0, |property| property.revision),
        "Property revision changed",
    )?;
    if !existing
        .as_ref()
        .is_some_and(|property| property.lifecycle == "active")
    {
        let active_count = connection.query_row(
            "SELECT count(*) FROM data_source_properties \
             WHERE data_source_id = ?1 AND lifecycle = 'active'",
            [data_source_id],
            |row| row.get::<_, i64>(0),
        )?;
        ensure_collection_capacity(
            active_count,
            super::MAX_DATA_SOURCE_PROPERTIES,
            "Data Source Property collection",
        )?;
    }
    let config = property_config_for_put(value_type, existing.as_ref())?;
    let preserve_rank = existing
        .as_ref()
        .filter(|property| property.lifecycle == "active" && before_property_id.is_none())
        .map(|property| property.rank_key.clone());
    let rank_key = preserve_rank.clone().unwrap_or_else(|| "0".repeat(32));
    let property_revision = existing
        .as_ref()
        .map_or(1, |property| property.revision + 1);
    let created_at = existing
        .as_ref()
        .map_or(now, |property| property.created_at.as_str());
    connection.execute(
        "INSERT INTO data_source_properties(\
           data_source_id, id, name, value_type, config_json, rank_key, lifecycle, \
           schema_revision, created_at, updated_at\
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'active', ?7, ?8, ?9) \
         ON CONFLICT(data_source_id, id) DO UPDATE SET \
           name = excluded.name, value_type = excluded.value_type, \
           config_json = excluded.config_json, rank_key = excluded.rank_key, \
           lifecycle = 'active', schema_revision = excluded.schema_revision, \
           updated_at = excluded.updated_at",
        params![
            data_source_id,
            property_id,
            name,
            value_type,
            serde_json::to_string(&config).map_err(|_| internal("Property config"))?,
            rank_key,
            property_revision,
            created_at,
            now,
        ],
    )?;
    if let DatabasePropertySchema::Relation {
        target_data_source_id,
    } = schema
    {
        let existing_target = connection
            .query_row(
                "SELECT target_data_source_id FROM data_source_relation_properties \
                 WHERE data_source_id = ?1 AND property_id = ?2",
                params![data_source_id, property_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        match existing_target {
            Some(existing_target) if existing_target == *target_data_source_id => {}
            Some(_) => {
                return Err(StoreError::new(
                    StoreErrorCode::Conflict,
                    "Relation Property target is immutable",
                    false,
                ));
            }
            None => {
                connection.execute(
                    "INSERT INTO data_source_relation_properties(\
                       data_source_id, property_id, target_data_source_id\
                     ) VALUES (?1, ?2, ?3)",
                    params![data_source_id, property_id, target_data_source_id],
                )?;
            }
        }
    }
    if preserve_rank.is_none() {
        reorder_properties(connection, data_source_id, property_id, before_property_id)?;
    }
    let source_revision = source.revision + 1;
    connection.execute(
        "UPDATE data_sources SET schema_revision = ?1, updated_at = ?2 WHERE id = ?3",
        params![source_revision, now, data_source_id],
    )?;
    touch_source(effects, &source);
    effects
        .revisions
        .insert(format!("source:{data_source_id}"), source_revision);
    effects.revisions.insert(
        format!("property:{data_source_id}:{property_id}"),
        property_revision,
    );
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn delete_property(
    connection: &Connection,
    library_id: &str,
    project_id: &str,
    data_source_id: &str,
    property_id: &str,
    expected_source_revision: i64,
    expected_property_revision: i64,
    now: &str,
    effects: &mut MutationEffects,
    library_scope: bool,
) -> Result<(), StoreError> {
    let source = require_source(connection, library_id, data_source_id)?;
    authorize_write(
        connection,
        project_id,
        &source.database_id,
        DatabaseWriteAction::ManageSchema,
        library_scope,
    )?;
    require_revision(
        expected_source_revision,
        source.revision,
        "Data Source revision changed",
    )?;
    let property = property_row(connection, data_source_id, property_id)?
        .ok_or_else(|| not_found("Property is unavailable"))?;
    if property.lifecycle != "active" {
        return Err(not_found("Property is not active"));
    }
    require_revision(
        expected_property_revision,
        property.revision,
        "Property revision changed",
    )?;
    if active_view_references_property(connection, data_source_id, property_id)? {
        return Err(StoreError::new(
            StoreErrorCode::Conflict,
            "Property is referenced by an active Database View",
            false,
        ));
    }
    connection.execute(
        "UPDATE data_source_properties SET lifecycle = 'deleted', \
           schema_revision = schema_revision + 1, updated_at = ?1 \
         WHERE data_source_id = ?2 AND id = ?3",
        params![now, data_source_id, property_id],
    )?;
    if matches!(property_id, "scheduled_start" | "scheduled_end") {
        let page_ids = connection
            .prepare(
                "SELECT page_block_id FROM data_source_page_memberships \
                 WHERE data_source_id = ?1 AND removed_at IS NULL",
            )?
            .query_map([data_source_id], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        effects.page_ids.extend(page_ids);
    }
    connection.execute(
        "UPDATE data_sources SET schema_revision = schema_revision + 1, updated_at = ?1 \
         WHERE id = ?2",
        params![now, data_source_id],
    )?;
    touch_source(effects, &source);
    effects
        .revisions
        .insert(format!("source:{data_source_id}"), source.revision + 1);
    effects.revisions.insert(
        format!("property:{data_source_id}:{property_id}"),
        property.revision + 1,
    );
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn put_option(
    connection: &Connection,
    library_id: &str,
    project_id: &str,
    data_source_id: &str,
    property_id: &str,
    option_id: &str,
    name: &str,
    color: Option<&str>,
    expected_property_revision: i64,
    now: &str,
    effects: &mut MutationEffects,
    library_scope: bool,
) -> Result<(), StoreError> {
    validate_id(option_id, "option_id", MAX_PROPERTY_ID_LENGTH)?;
    let raw_name = name;
    let name = validate_name(raw_name, "Option name")?;
    if color.is_some_and(|value| value.is_empty() || value.len() > 128) {
        return Err(invalid("Option color must contain between 1 and 128 bytes"));
    }
    let source = require_source(connection, library_id, data_source_id)?;
    authorize_write(
        connection,
        project_id,
        &source.database_id,
        DatabaseWriteAction::ManageSchema,
        library_scope,
    )?;
    let property = active_property(connection, data_source_id, property_id)?;
    if property_id == "tags" && (name != raw_name || !name.nfc().eq(name.chars())) {
        return Err(invalid(
            "Tags option names must already be Unicode NFC with no surrounding whitespace",
        ));
    }
    require_revision(
        expected_property_revision,
        property.revision,
        "Property revision changed",
    )?;
    let mut config = option_config(&property)?;
    if property_id == "tags"
        && config
            .options
            .iter()
            .any(|option| option.id != option_id && option.name == name)
    {
        return Err(StoreError::new(
            StoreErrorCode::Conflict,
            "Tags options must have unique canonical names",
            false,
        ));
    }
    let next = PropertyOption {
        id: option_id.to_owned(),
        name: name.to_owned(),
        color: color.map(str::to_owned),
    };
    if let Some(existing) = config
        .options
        .iter_mut()
        .find(|option| option.id == option_id)
    {
        if *existing == next {
            effects.revisions.insert(
                format!("property:{data_source_id}:{property_id}"),
                property.revision,
            );
            return Ok(());
        }
        *existing = next;
    } else {
        if config.options.len() >= super::MAX_PROPERTY_OPTIONS {
            return Err(invalid("Property option registry exceeds its bound"));
        }
        config.options.push(next);
    }
    persist_option_config(connection, &source, &property, &config, now)?;
    if property_id == "tags" {
        refresh_tag_projections(connection, data_source_id, &config, now, effects)?;
    }
    touch_source(effects, &source);
    effects
        .revisions
        .insert(format!("source:{data_source_id}"), source.revision + 1);
    effects.revisions.insert(
        format!("property:{data_source_id}:{property_id}"),
        property.revision + 1,
    );
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn delete_option(
    connection: &Connection,
    library_id: &str,
    project_id: &str,
    data_source_id: &str,
    property_id: &str,
    option_id: &str,
    expected_property_revision: i64,
    now: &str,
    effects: &mut MutationEffects,
    library_scope: bool,
) -> Result<(), StoreError> {
    let source = require_source(connection, library_id, data_source_id)?;
    authorize_write(
        connection,
        project_id,
        &source.database_id,
        DatabaseWriteAction::ManageSchema,
        library_scope,
    )?;
    let property = active_property(connection, data_source_id, property_id)?;
    require_revision(
        expected_property_revision,
        property.revision,
        "Property revision changed",
    )?;
    let mut config = option_config(&property)?;
    if !config.options.iter().any(|option| option.id == option_id) {
        return Err(not_found("Property option is unavailable"));
    }
    let mut statement = connection.prepare(
        "SELECT value_json FROM data_source_property_values \
         WHERE data_source_id = ?1 AND property_id = ?2",
    )?;
    let values = statement
        .query_map(params![data_source_id, property_id], |row| {
            row.get::<_, String>(0)
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for value in values {
        let value = parse_json(&value, "Property value")?;
        if value == Value::String(option_id.to_owned())
            || value
                .as_array()
                .is_some_and(|values| values.iter().any(|value| value.as_str() == Some(option_id)))
        {
            return Err(StoreError::new(
                StoreErrorCode::Conflict,
                "Property option is selected by an existing Page",
                false,
            ));
        }
    }
    config.options.retain(|option| option.id != option_id);
    persist_option_config(connection, &source, &property, &config, now)?;
    touch_source(effects, &source);
    effects
        .revisions
        .insert(format!("source:{data_source_id}"), source.revision + 1);
    effects.revisions.insert(
        format!("property:{data_source_id}:{property_id}"),
        property.revision + 1,
    );
    Ok(())
}

fn edit_property_value(
    connection: &Connection,
    library_id: &str,
    project_id: &str,
    input: &DatabasePropertyValueMutation,
    now: &str,
    effects: &mut MutationEffects,
    library_scope: bool,
) -> Result<(), StoreError> {
    match &input.edit {
        DatabasePropertyValueEdit::Replace {
            expected_value_revision,
            value,
        } => {
            let value = property_value_input_json(value)?;
            set_value(
                connection,
                library_id,
                project_id,
                &input.address,
                *expected_value_revision,
                &value,
                now,
                effects,
                library_scope,
            )
        }
        DatabasePropertyValueEdit::PatchSet { delta } => match delta {
            DatabasePropertySetDelta::MultiSelect {
                add_option_ids,
                remove_option_ids,
            } => add_remove_value(
                connection,
                library_id,
                project_id,
                &input.address.page_id,
                &input.address.data_source_id,
                &input.address.property_id,
                add_option_ids,
                remove_option_ids,
                now,
                effects,
                library_scope,
            ),
            DatabasePropertySetDelta::Relation {
                add_page_ids,
                remove_edge_ids,
            } => edit_relation_value(
                connection,
                library_id,
                project_id,
                &input.address,
                RelationEdit::Patch {
                    add_page_ids,
                    remove_edge_ids,
                },
                now,
                effects,
                library_scope,
            ),
        },
        DatabasePropertyValueEdit::ClearRelation {
            expected_value_revision,
        } => edit_relation_value(
            connection,
            library_id,
            project_id,
            &input.address,
            RelationEdit::Clear {
                expected_value_revision: *expected_value_revision,
            },
            now,
            effects,
            library_scope,
        ),
    }
}

fn property_value_input_json(input: &DatabasePropertyValueInput) -> Result<Value, StoreError> {
    let value = match input {
        DatabasePropertyValueInput::Empty => Value::Null,
        DatabasePropertyValueInput::Text { value }
        | DatabasePropertyValueInput::Date { value }
        | DatabasePropertyValueInput::Datetime { value } => Value::String(value.clone()),
        DatabasePropertyValueInput::Number { value } => {
            if !value.is_finite() {
                return Err(invalid("Number Property requires a finite value"));
            }
            json!(value)
        }
        DatabasePropertyValueInput::Checkbox { value } => Value::Bool(*value),
        DatabasePropertyValueInput::Select { option_id } => Value::String(option_id.clone()),
        DatabasePropertyValueInput::MultiSelect { option_ids } => {
            Value::Array(option_ids.iter().cloned().map(Value::String).collect())
        }
    };
    Ok(value)
}

#[allow(clippy::too_many_arguments)]
fn edit_relation_value(
    connection: &Connection,
    library_id: &str,
    project_id: &str,
    address: &DatabasePagePropertyAddress,
    edit: RelationEdit<'_>,
    now: &str,
    effects: &mut MutationEffects,
    library_scope: bool,
) -> Result<(), StoreError> {
    let source = require_source(connection, library_id, &address.data_source_id)?;
    authorize_write(
        connection,
        project_id,
        &source.database_id,
        DatabaseWriteAction::Write,
        library_scope,
    )?;
    let property = active_property(connection, &address.data_source_id, &address.property_id)?;
    if property.value_type != "relation" {
        return Err(invalid("Relation value edit requires a Relation Property"));
    }
    let added_page_ids = match &edit {
        RelationEdit::Clear { .. } => &[],
        RelationEdit::Patch { add_page_ids, .. } => *add_page_ids,
    };
    if !added_page_ids.is_empty() {
        let target_data_source_id = super::relation::target_data_source_id(
            connection,
            &address.data_source_id,
            &address.property_id,
        )?;
        authorize_relation_target_read(
            connection,
            library_id,
            project_id,
            &target_data_source_id,
            library_scope,
        )?;
    }
    let outcome = super::relation::apply_value_edit(
        connection,
        library_id,
        (!library_scope).then_some(project_id),
        address,
        edit,
        now,
    )?;
    if !outcome.changed {
        return Ok(());
    }
    let metadata_revision = bump_page_metadata_revision(connection, &address.page_id, now)?;
    refresh_value_projection(
        connection,
        &address.page_id,
        &address.property_id,
        &Value::Null,
        outcome.value_revision,
        metadata_revision,
        &property,
        now,
    )?;
    touch_source(effects, &source);
    effects.page_ids.insert(address.page_id.clone());
    effects.revisions.insert(
        format!(
            "value:{}:{}:{}",
            address.data_source_id, outcome.membership_id, address.property_id
        ),
        outcome.value_revision,
    );
    effects.revisions.insert(
        format!("page:{}:metadata", address.page_id),
        metadata_revision,
    );
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn set_value(
    connection: &Connection,
    library_id: &str,
    project_id: &str,
    address: &DatabasePagePropertyAddress,
    expected_value_revision: i64,
    input_value: &Value,
    now: &str,
    effects: &mut MutationEffects,
    library_scope: bool,
) -> Result<(), StoreError> {
    let source = require_source(connection, library_id, &address.data_source_id)?;
    authorize_write(
        connection,
        project_id,
        &source.database_id,
        DatabaseWriteAction::Write,
        library_scope,
    )?;
    let property = active_property(connection, &address.data_source_id, &address.property_id)?;
    if property.value_type == "relation" {
        return Err(invalid("Relation Property requires a Relation value edit"));
    }
    let membership = connection
        .query_row(
            "SELECT id FROM data_source_page_memberships \
             WHERE data_source_id = ?1 AND page_block_id = ?2 AND removed_at IS NULL",
            params![address.data_source_id, address.page_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or_else(|| not_found("Page has no active membership in the Data Source"))?;
    let active_row = connection
        .query_row(
            "SELECT 1 FROM pages WHERE block_id = ?1 AND parent_kind = 'data_source' \
             AND parent_id = ?2 AND lifecycle = 'active'",
            params![address.page_id, address.data_source_id],
            |_| Ok(()),
        )
        .optional()?;
    if active_row.is_none() {
        return Err(not_found("Page is not an active row in the Data Source"));
    }
    let existing_revision = connection
        .query_row(
            "SELECT revision FROM data_source_property_values \
             WHERE data_source_id = ?1 AND membership_id = ?2 AND property_id = ?3",
            params![address.data_source_id, membership, address.property_id],
            |row| row.get::<_, i64>(0),
        )
        .optional()?
        .unwrap_or(0);
    require_revision(
        expected_value_revision,
        existing_revision,
        "Property value revision changed",
    )?;
    let value = normalize_value(&property, input_value)?;
    let revision = existing_revision + 1;
    connection.execute(
        "INSERT INTO data_source_property_values(\
           data_source_id, membership_id, property_id, value_type, value_json, revision, updated_at\
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) \
         ON CONFLICT(data_source_id, membership_id, property_id) DO UPDATE SET \
           value_type = excluded.value_type, value_json = excluded.value_json, \
           revision = excluded.revision, updated_at = excluded.updated_at",
        params![
            address.data_source_id,
            membership,
            address.property_id,
            property.value_type,
            serde_json::to_string(&value).map_err(|_| internal("Property value"))?,
            revision,
            now,
        ],
    )?;
    update_grouped_positions(
        connection,
        &address.data_source_id,
        &address.property_id,
        &address.page_id,
        &value,
        now,
        effects,
    )?;
    let metadata_revision = bump_page_metadata_revision(connection, &address.page_id, now)?;
    refresh_value_projection(
        connection,
        &address.page_id,
        &address.property_id,
        &value,
        revision,
        metadata_revision,
        &property,
        now,
    )?;
    touch_source(effects, &source);
    effects.page_ids.insert(address.page_id.clone());
    effects.revisions.insert(
        format!(
            "value:{}:{membership}:{}",
            address.data_source_id, address.property_id
        ),
        revision,
    );
    effects.revisions.insert(
        format!("page:{}:metadata", address.page_id),
        metadata_revision,
    );
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn add_remove_value(
    connection: &Connection,
    library_id: &str,
    project_id: &str,
    page_id: &str,
    data_source_id: &str,
    property_id: &str,
    add: &[String],
    remove: &[String],
    now: &str,
    effects: &mut MutationEffects,
    library_scope: bool,
) -> Result<(), StoreError> {
    let property = active_property(connection, data_source_id, property_id)?;
    if property.value_type != "multi_select" {
        return Err(invalid("add_remove_value requires a multi_select Property"));
    }
    let config = option_config(&property)?;
    let known = config
        .options
        .iter()
        .map(|option| option.id.as_str())
        .collect::<HashSet<_>>();
    if add
        .iter()
        .chain(remove)
        .any(|option_id| !known.contains(option_id.as_str()))
    {
        return Err(invalid("add_remove_value references an unknown option"));
    }
    let membership = connection
        .query_row(
            "SELECT id FROM data_source_page_memberships \
             WHERE data_source_id = ?1 AND page_block_id = ?2 AND removed_at IS NULL",
            params![data_source_id, page_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or_else(|| not_found("Page has no active membership in the Data Source"))?;
    let existing = connection
        .query_row(
            "SELECT value_json, revision FROM data_source_property_values \
             WHERE data_source_id = ?1 AND membership_id = ?2 AND property_id = ?3",
            params![data_source_id, membership, property_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
        )
        .optional()?;
    let mut selection = match &existing {
        Some((value, _)) => normalize_value(&property, &parse_json(value, "Property value")?)?
            .as_array()
            .cloned()
            .ok_or_else(|| corrupt("Stored multi_select value is not an array"))?
            .into_iter()
            .map(|value| {
                value
                    .as_str()
                    .map(str::to_owned)
                    .ok_or_else(|| corrupt("Stored multi_select option is invalid"))
            })
            .collect::<Result<BTreeSet<_>, _>>()?,
        None => BTreeSet::new(),
    };
    let before = selection.clone();
    for option_id in remove {
        selection.remove(option_id);
    }
    selection.extend(add.iter().cloned());
    if selection == before {
        return Ok(());
    }
    set_value(
        connection,
        library_id,
        project_id,
        &DatabasePagePropertyAddress {
            page_id: page_id.to_owned(),
            data_source_id: data_source_id.to_owned(),
            property_id: property_id.to_owned(),
        },
        existing.as_ref().map_or(0, |(_, revision)| *revision),
        &Value::Array(selection.into_iter().map(Value::String).collect()),
        now,
        effects,
        library_scope,
    )
}

struct ActiveMembership {
    id: String,
    data_source_id: String,
    revision: i64,
}

struct CompatibilityValues {
    values: Map<String, Value>,
    revisions: Map<String, Value>,
}

struct PreferredViewPlacement {
    view_id: Option<String>,
    group_key: Option<String>,
    rank_key: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct PageCopyValueDraft {
    pub(crate) property_id: String,
    pub(crate) value: Value,
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct PageCopyPositionAnchor {
    pub(crate) page_id: String,
    pub(crate) expected_position_revision: i64,
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct PageCopyViewPlacement {
    pub(crate) view_id: String,
    pub(crate) expected_view_revision: i64,
    pub(crate) group_key: Option<String>,
    pub(crate) before: Option<PageCopyPositionAnchor>,
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct PageCopyDataSourceDestination {
    pub(crate) data_source_id: String,
    pub(crate) expected_data_source_revision: i64,
    pub(crate) values: Vec<PageCopyValueDraft>,
    pub(crate) view: Option<PageCopyViewPlacement>,
}

pub(crate) struct PageCopyDataSourcePlacement {
    pub(crate) database_id: String,
    pub(crate) data_source_id: String,
    pub(crate) membership_id: String,
    pub(crate) affected_view_ids: Vec<String>,
    pub(crate) location_revision: i64,
    pub(crate) metadata_revision: i64,
    pub(crate) parent_revision: i64,
    pub(crate) value_revisions: BTreeMap<String, i64>,
    pub(crate) position_revision: Option<i64>,
}

#[derive(Clone, Copy)]
pub(crate) struct StagedPagePlacementRevisions {
    pub(crate) location_revision: i64,
    pub(crate) metadata_revision: i64,
    pub(crate) parent_revision: i64,
}

pub(crate) struct ResolvedPageTransferDataSourceDestination {
    pub(crate) project_id: String,
    pub(crate) destination: PageCopyDataSourceDestination,
}

pub(crate) struct ResolvedPageTransferDataSourceSource {
    pub(crate) project_id: String,
    pub(crate) database_id: String,
    pub(crate) data_source_id: String,
}

pub(crate) enum ExistingPageTransferTarget<'a> {
    Library,
    Page { page_id: &'a str },
    DataSource(&'a PageCopyDataSourceDestination),
}

pub(crate) struct ExistingPageTransferPlacement {
    pub(crate) database_id: Option<String>,
    pub(crate) data_source_id: Option<String>,
    pub(crate) membership_id: Option<String>,
    pub(crate) affected_database_ids: Vec<String>,
    pub(crate) affected_view_ids: Vec<String>,
    pub(crate) committed_revisions: BTreeMap<String, i64>,
    pub(crate) location_revision: i64,
    pub(crate) metadata_revision: i64,
    pub(crate) parent_revision: i64,
}

pub(crate) struct AgentMoveDataSourceFinalization {
    pub(crate) affected_database_ids: Vec<String>,
    pub(crate) affected_view_ids: Vec<String>,
    pub(crate) committed_revisions: BTreeMap<String, i64>,
}

pub(crate) fn resolve_page_transfer_data_source_source(
    connection: &Connection,
    library_id: &str,
    requesting_project_id: &str,
    data_source_id: &str,
) -> Result<ResolvedPageTransferDataSourceSource, StoreError> {
    let source = require_source(connection, library_id, data_source_id)?;
    authorize_write(
        connection,
        requesting_project_id,
        &source.database_id,
        DatabaseWriteAction::Write,
        false,
    )?;
    resolve_page_transfer_data_source_source_authority(connection, source)
}

pub(crate) fn resolve_page_copy_data_source_source(
    connection: &Connection,
    library_id: &str,
    data_source_id: &str,
) -> Result<ResolvedPageTransferDataSourceSource, StoreError> {
    let source = require_source(connection, library_id, data_source_id)?;
    resolve_page_transfer_data_source_source_authority(connection, source)
}

fn resolve_page_transfer_data_source_source_authority(
    connection: &Connection,
    source: SourceRow,
) -> Result<ResolvedPageTransferDataSourceSource, StoreError> {
    let project_id = connection
        .query_row(
            "SELECT project_id FROM blocks WHERE id = ?1 AND type = 'database' \
             AND lifecycle = 'active'",
            [&source.database_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or_else(|| corrupt("Source Data Source has no active Database authority"))?;
    Ok(ResolvedPageTransferDataSourceSource {
        project_id,
        database_id: source.database_id,
        data_source_id: source.id,
    })
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn resolve_page_transfer_data_source_destination(
    connection: &Connection,
    library_id: &str,
    requesting_project_id: &str,
    data_source_id: &str,
    view_id: &str,
    group_key: Option<&str>,
    before_page_id: Option<&str>,
) -> Result<ResolvedPageTransferDataSourceDestination, StoreError> {
    resolve_page_transfer_data_source_destination_with_access(
        connection,
        library_id,
        requesting_project_id,
        data_source_id,
        view_id,
        group_key,
        before_page_id,
        true,
    )
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn resolve_page_transfer_data_source_destination_prevalidated(
    connection: &Connection,
    library_id: &str,
    requesting_project_id: &str,
    data_source_id: &str,
    view_id: &str,
    group_key: Option<&str>,
    before_page_id: Option<&str>,
) -> Result<ResolvedPageTransferDataSourceDestination, StoreError> {
    resolve_page_transfer_data_source_destination_with_access(
        connection,
        library_id,
        requesting_project_id,
        data_source_id,
        view_id,
        group_key,
        before_page_id,
        false,
    )
}

#[allow(clippy::too_many_arguments)]
fn resolve_page_transfer_data_source_destination_with_access(
    connection: &Connection,
    library_id: &str,
    requesting_project_id: &str,
    data_source_id: &str,
    view_id: &str,
    group_key: Option<&str>,
    before_page_id: Option<&str>,
    require_access: bool,
) -> Result<ResolvedPageTransferDataSourceDestination, StoreError> {
    let source = require_source(connection, library_id, data_source_id)?;
    if require_access {
        authorize_write(
            connection,
            requesting_project_id,
            &source.database_id,
            DatabaseWriteAction::Write,
            false,
        )?;
    }
    let project_id = connection
        .query_row(
            "SELECT project_id FROM blocks WHERE id = ?1 AND type = 'database' \
             AND lifecycle = 'active'",
            [&source.database_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or_else(|| corrupt("Target Data Source has no active Database authority"))?;
    let view = view_row(connection, view_id)?
        .filter(|view| view.lifecycle == "active")
        .ok_or_else(|| not_found("Block transfer target View is unavailable"))?;
    if view.database_id != source.database_id || view.data_source_id != source.id {
        return Err(invalid(
            "Block transfer target View belongs to another Data Source",
        ));
    }
    let config = parse_json(&view.config_json, "Database View config")?;
    let values = view_group_property(&config)
        .map(|property_id| PageCopyValueDraft {
            property_id: property_id.to_owned(),
            value: group_key.map_or(Value::Null, |value| Value::String(value.to_owned())),
        })
        .into_iter()
        .collect();
    let before = before_page_id
        .map(|page_id| {
            let expected_position_revision = connection
                .query_row(
                    "SELECT COALESCE(position.revision, 0) \
                     FROM data_source_page_memberships membership \
                     JOIN pages page ON page.block_id = membership.page_block_id \
                     LEFT JOIN database_view_page_positions position \
                       ON position.view_id = ?1 AND position.page_block_id = page.block_id \
                     WHERE membership.data_source_id = ?2 \
                       AND membership.page_block_id = ?3 AND membership.removed_at IS NULL \
                       AND page.parent_kind = 'data_source' AND page.parent_id = ?2 \
                       AND page.lifecycle = 'active'",
                    params![view_id, data_source_id, page_id],
                    |row| row.get::<_, i64>(0),
                )
                .optional()?
                .ok_or_else(|| not_found("Block transfer View anchor is unavailable"))?;
            Ok::<_, StoreError>(PageCopyPositionAnchor {
                page_id: page_id.to_owned(),
                expected_position_revision,
            })
        })
        .transpose()?;
    Ok(ResolvedPageTransferDataSourceDestination {
        project_id,
        destination: PageCopyDataSourceDestination {
            data_source_id: source.id,
            expected_data_source_revision: source.revision,
            values,
            view: Some(PageCopyViewPlacement {
                view_id: view.id,
                expected_view_revision: view.revision,
                group_key: group_key.map(str::to_owned),
                before,
            }),
        },
    })
}

pub(crate) fn resolve_page_copy_data_source_project(
    connection: &Connection,
    library_id: &str,
    requesting_project_id: &str,
    data_source_id: &str,
    expected_data_source_revision: i64,
) -> Result<String, StoreError> {
    resolve_page_copy_data_source_project_with_access(
        connection,
        library_id,
        requesting_project_id,
        data_source_id,
        expected_data_source_revision,
        true,
    )
}

pub(crate) fn resolve_page_copy_data_source_project_prevalidated(
    connection: &Connection,
    library_id: &str,
    requesting_project_id: &str,
    data_source_id: &str,
    expected_data_source_revision: i64,
) -> Result<String, StoreError> {
    resolve_page_copy_data_source_project_with_access(
        connection,
        library_id,
        requesting_project_id,
        data_source_id,
        expected_data_source_revision,
        false,
    )
}

fn resolve_page_copy_data_source_project_with_access(
    connection: &Connection,
    library_id: &str,
    requesting_project_id: &str,
    data_source_id: &str,
    expected_data_source_revision: i64,
    require_access: bool,
) -> Result<String, StoreError> {
    let source = require_source(connection, library_id, data_source_id)?;
    require_revision(
        expected_data_source_revision,
        source.revision,
        "Target Data Source revision changed",
    )?;
    if require_access {
        authorize_write(
            connection,
            requesting_project_id,
            &source.database_id,
            DatabaseWriteAction::Write,
            false,
        )?;
    }
    connection
        .query_row(
            "SELECT project_id FROM blocks WHERE id = ?1 AND type = 'database' \
             AND lifecycle = 'active'",
            [&source.database_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or_else(|| corrupt("Target Data Source has no active Database authority"))
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn place_copied_page_in_data_source(
    connection: &Connection,
    library_id: &str,
    requesting_project_id: &str,
    source_page_id: &str,
    copied_page_id: &str,
    destination: &PageCopyDataSourceDestination,
    now: &str,
) -> Result<PageCopyDataSourcePlacement, StoreError> {
    place_staged_page_in_data_source_with_access(
        connection,
        library_id,
        requesting_project_id,
        Some(source_page_id),
        copied_page_id,
        destination,
        StagedPagePlacementRevisions {
            location_revision: 1,
            metadata_revision: 1,
            parent_revision: 1,
        },
        now,
        true,
    )
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn place_copied_page_in_data_source_prevalidated(
    connection: &Connection,
    library_id: &str,
    requesting_project_id: &str,
    source_page_id: &str,
    copied_page_id: &str,
    destination: &PageCopyDataSourceDestination,
    now: &str,
) -> Result<PageCopyDataSourcePlacement, StoreError> {
    place_staged_page_in_data_source_with_access(
        connection,
        library_id,
        requesting_project_id,
        Some(source_page_id),
        copied_page_id,
        destination,
        StagedPagePlacementRevisions {
            location_revision: 1,
            metadata_revision: 1,
            parent_revision: 1,
        },
        now,
        false,
    )
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn place_staged_page_in_data_source(
    connection: &Connection,
    library_id: &str,
    requesting_project_id: &str,
    source_page_id: Option<&str>,
    staged_page_id: &str,
    destination: &PageCopyDataSourceDestination,
    expected: StagedPagePlacementRevisions,
    now: &str,
) -> Result<PageCopyDataSourcePlacement, StoreError> {
    place_staged_page_in_data_source_with_access(
        connection,
        library_id,
        requesting_project_id,
        source_page_id,
        staged_page_id,
        destination,
        expected,
        now,
        true,
    )
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn place_staged_page_in_data_source_prevalidated(
    connection: &Connection,
    library_id: &str,
    requesting_project_id: &str,
    staged_page_id: &str,
    destination: &PageCopyDataSourceDestination,
    expected: StagedPagePlacementRevisions,
    now: &str,
) -> Result<PageCopyDataSourcePlacement, StoreError> {
    place_staged_page_in_data_source_with_access(
        connection,
        library_id,
        requesting_project_id,
        None,
        staged_page_id,
        destination,
        expected,
        now,
        false,
    )
}

#[allow(clippy::too_many_arguments)]
fn place_staged_page_in_data_source_with_access(
    connection: &Connection,
    library_id: &str,
    requesting_project_id: &str,
    source_page_id: Option<&str>,
    staged_page_id: &str,
    destination: &PageCopyDataSourceDestination,
    expected: StagedPagePlacementRevisions,
    now: &str,
    require_access: bool,
) -> Result<PageCopyDataSourcePlacement, StoreError> {
    if destination.values.len() > 512 {
        return Err(invalid("Data Source placement values exceed their bound"));
    }
    let property_ids = destination
        .values
        .iter()
        .map(|value| value.property_id.as_str())
        .collect::<HashSet<_>>();
    if property_ids.len() != destination.values.len() {
        return Err(invalid(
            "Data Source placement Property values must be unique",
        ));
    }
    let source = require_source(connection, library_id, &destination.data_source_id)?;
    require_revision(
        destination.expected_data_source_revision,
        source.revision,
        "Target Data Source revision changed",
    )?;
    if require_access {
        authorize_write(
            connection,
            requesting_project_id,
            &source.database_id,
            DatabaseWriteAction::Write,
            false,
        )?;
    }
    let storage_project_id = connection
        .query_row(
            "SELECT project_id FROM blocks WHERE id = ?1 AND type = 'database' \
             AND lifecycle = 'active'",
            [&source.database_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or_else(|| corrupt("Target Data Source has no active Database authority"))?;
    let staged = connection
        .query_row(
            "SELECT block.project_id, block.location_kind, block.location_revision, \
               block.metadata_revision, page.parent_kind, page.parent_id, page.parent_revision \
             FROM blocks block JOIN pages page ON page.block_id = block.id \
             WHERE block.id = ?1 AND block.type = 'page' AND block.lifecycle = 'active' \
               AND page.lifecycle = 'active'",
            [staged_page_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, i64>(6)?,
                ))
            },
        )
        .optional()?
        .ok_or_else(|| corrupt("Staged Page authority disappeared"))?;
    if staged.0 != storage_project_id
        || staged.1 != "space"
        || staged.2 != expected.location_revision
        || staged.3 != expected.metadata_revision
        || staged.4 != "library"
        || staged.5 != library_id
        || staged.6 != expected.parent_revision
    {
        return Err(corrupt("Staged Page has noncanonical initial placement"));
    }
    let source_membership = source_page_id
        .map(|source_page_id| {
            connection
                .query_row(
                    "SELECT id, data_source_id, revision FROM data_source_page_memberships \
                     WHERE page_block_id = ?1 AND removed_at IS NULL",
                    [source_page_id],
                    |row| {
                        Ok(ActiveMembership {
                            id: row.get(0)?,
                            data_source_id: row.get(1)?,
                            revision: row.get(2)?,
                        })
                    },
                )
                .optional()
        })
        .transpose()?
        .flatten();
    let membership_id = deterministic_membership_id(&destination.data_source_id, staged_page_id);
    if connection
        .query_row(
            "SELECT 1 FROM data_source_page_memberships WHERE id = ?1 \
             OR (data_source_id = ?2 AND page_block_id = ?3)",
            params![membership_id, destination.data_source_id, staged_page_id],
            |_| Ok(()),
        )
        .optional()?
        .is_some()
    {
        return Err(StoreError::new(
            StoreErrorCode::AlreadyOwned,
            "Staged Page membership identity is already owned",
            false,
        ));
    }

    let view = destination
        .view
        .as_ref()
        .map(|placement| {
            let view = view_row(connection, &placement.view_id)?
                .filter(|view| view.lifecycle == "active")
                .ok_or_else(|| not_found("Page copy target View is unavailable"))?;
            if view.database_id != source.database_id
                || view.data_source_id != destination.data_source_id
            {
                return Err(invalid(
                    "Page copy target View belongs to another Data Source",
                ));
            }
            require_revision(
                placement.expected_view_revision,
                view.revision,
                "Page copy target View revision changed",
            )?;
            if let Some(anchor) = &placement.before {
                let anchor_revision = connection
                    .query_row(
                        "SELECT COALESCE(position.revision, 0) \
                         FROM data_source_page_memberships membership \
                         JOIN pages page ON page.block_id = membership.page_block_id \
                         LEFT JOIN database_view_page_positions position \
                           ON position.view_id = ?1 AND position.page_block_id = page.block_id \
                         WHERE membership.data_source_id = ?2 \
                           AND membership.page_block_id = ?3 AND membership.removed_at IS NULL \
                           AND page.parent_kind = 'data_source' AND page.parent_id = ?2 \
                           AND page.lifecycle = 'active'",
                        params![
                            placement.view_id,
                            destination.data_source_id,
                            anchor.page_id
                        ],
                        |row| row.get::<_, i64>(0),
                    )
                    .optional()?
                    .ok_or_else(|| not_found("Page copy View anchor is unavailable"))?;
                require_revision(
                    anchor.expected_position_revision,
                    anchor_revision,
                    "Page copy View anchor changed",
                )?;
            }
            Ok(view)
        })
        .transpose()?;

    connection.execute(
        "DELETE FROM top_level_block_placements WHERE block_id = ?1",
        [staged_page_id],
    )?;
    connection.execute(
        "DELETE FROM library_block_placements WHERE block_id = ?1",
        [staged_page_id],
    )?;
    let location_revision = connection
        .query_row(
            "UPDATE blocks SET location_kind = 'database', containing_document_id = NULL, \
               containing_database_id = ?1, location_revision = location_revision + 1, \
               metadata_revision = metadata_revision + 1, updated_at = ?2 \
             WHERE id = ?3 AND location_revision = ?4 AND metadata_revision = ?5 \
             RETURNING location_revision",
            params![
                source.database_id,
                now,
                staged_page_id,
                expected.location_revision,
                expected.metadata_revision,
            ],
            |row| row.get::<_, i64>(0),
        )
        .optional()?
        .ok_or_else(|| {
            StoreError::new(
                StoreErrorCode::RevisionConflict,
                "Staged Page location changed during placement",
                true,
            )
        })?;
    connection.execute(
        "INSERT INTO data_source_page_memberships( \
           id, data_source_id, page_block_id, revision, created_at, removed_at \
         ) VALUES (?1, ?2, ?3, 1, ?4, NULL)",
        params![
            membership_id,
            destination.data_source_id,
            staged_page_id,
            now
        ],
    )?;
    ensure_transferred_built_in_values(
        connection,
        source_membership.as_ref(),
        &membership_id,
        &destination.data_source_id,
        now,
        None,
    )?;
    if let Some(source_membership) = source_membership
        .as_ref()
        .filter(|membership| membership.data_source_id == destination.data_source_id)
    {
        copy_same_source_property_values(connection, source_membership, &membership_id, now)?;
    }
    let parent_revision = connection
        .query_row(
            "UPDATE pages SET parent_kind = 'data_source', parent_id = ?1, \
               parent_revision = parent_revision + 1, metadata_revision = metadata_revision + 1, \
               updated_at = ?2 WHERE block_id = ?3 AND parent_revision = ?4 \
             RETURNING parent_revision",
            params![
                destination.data_source_id,
                now,
                staged_page_id,
                expected.parent_revision,
            ],
            |row| row.get::<_, i64>(0),
        )
        .optional()?
        .ok_or_else(|| {
            StoreError::new(
                StoreErrorCode::RevisionConflict,
                "Staged Page parent authority changed during placement",
                true,
            )
        })?;
    refresh_transferred_page_projection(
        connection,
        staged_page_id,
        Some(&membership_id),
        Some(&destination.data_source_id),
        now,
    )?;

    let mut effects = MutationEffects::default();
    for value in &destination.values {
        let expected_value_revision = connection
            .query_row(
                "SELECT revision FROM data_source_property_values \
                 WHERE data_source_id = ?1 AND membership_id = ?2 AND property_id = ?3",
                params![destination.data_source_id, membership_id, value.property_id],
                |row| row.get::<_, i64>(0),
            )
            .optional()?
            .unwrap_or(0);
        set_value(
            connection,
            library_id,
            requesting_project_id,
            &DatabasePagePropertyAddress {
                page_id: staged_page_id.to_owned(),
                data_source_id: destination.data_source_id.clone(),
                property_id: value.property_id.clone(),
            },
            expected_value_revision,
            &value.value,
            now,
            &mut effects,
            false,
        )?;
    }
    if let (Some(placement), Some(_)) = (&destination.view, view) {
        position_pages(
            connection,
            library_id,
            requesting_project_id,
            &placement.view_id,
            &[DatabasePagePosition {
                page_id: staged_page_id.to_owned(),
                expected_position_revision: 0,
            }],
            placement.group_key.as_deref(),
            placement
                .before
                .as_ref()
                .map(|anchor| anchor.page_id.as_str()),
            now,
            &mut effects,
            false,
        )?;
    }
    effects.database_ids.insert(source.database_id.clone());
    effects.data_source_ids.insert(source.id.clone());
    effects.page_ids.insert(staged_page_id.to_owned());
    let metadata_revision = connection.query_row(
        "SELECT metadata_revision FROM blocks WHERE id = ?1",
        [staged_page_id],
        |row| row.get::<_, i64>(0),
    )?;
    let value_revisions = destination
        .values
        .iter()
        .map(|value| {
            let revision = connection.query_row(
                "SELECT revision FROM data_source_property_values \
                 WHERE data_source_id = ?1 AND membership_id = ?2 AND property_id = ?3",
                params![destination.data_source_id, membership_id, value.property_id],
                |row| row.get::<_, i64>(0),
            )?;
            Ok((value.property_id.clone(), revision))
        })
        .collect::<Result<BTreeMap<_, _>, rusqlite::Error>>()?;
    let position_revision = destination
        .view
        .as_ref()
        .map(|placement| {
            connection.query_row(
                "SELECT revision FROM database_view_page_positions \
                 WHERE view_id = ?1 AND page_block_id = ?2",
                params![placement.view_id, staged_page_id],
                |row| row.get::<_, i64>(0),
            )
        })
        .transpose()?;
    Ok(PageCopyDataSourcePlacement {
        database_id: source.database_id,
        data_source_id: source.id,
        membership_id,
        affected_view_ids: effects.view_ids.into_iter().collect(),
        location_revision,
        metadata_revision,
        parent_revision,
        value_revisions,
        position_revision,
    })
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn transfer_existing_page_for_block_transfer(
    connection: &Connection,
    library_id: &str,
    requesting_project_id: &str,
    page_id: &str,
    expected_parent_revision: i64,
    expected_active_membership_revision: i64,
    target: ExistingPageTransferTarget<'_>,
    now: &str,
) -> Result<ExistingPageTransferPlacement, StoreError> {
    transfer_existing_page_for_structural_move(
        connection,
        library_id,
        requesting_project_id,
        page_id,
        expected_parent_revision,
        expected_active_membership_revision,
        target,
        now,
        false,
        false,
    )
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn transfer_existing_page_for_agent_move_prevalidated(
    connection: &Connection,
    library_id: &str,
    source_project_id: &str,
    page_id: &str,
    expected_parent_revision: i64,
    expected_active_membership_revision: i64,
    target: ExistingPageTransferTarget<'_>,
    now: &str,
    defer_projection_refresh: bool,
) -> Result<ExistingPageTransferPlacement, StoreError> {
    transfer_existing_page_for_structural_move(
        connection,
        library_id,
        source_project_id,
        page_id,
        expected_parent_revision,
        expected_active_membership_revision,
        target,
        now,
        true,
        defer_projection_refresh,
    )
}

#[allow(clippy::too_many_arguments)]
fn transfer_existing_page_for_structural_move(
    connection: &Connection,
    library_id: &str,
    requesting_project_id: &str,
    page_id: &str,
    expected_parent_revision: i64,
    expected_active_membership_revision: i64,
    target: ExistingPageTransferTarget<'_>,
    now: &str,
    preauthorized_library_scope: bool,
    defer_projection_refresh: bool,
) -> Result<ExistingPageTransferPlacement, StoreError> {
    let mut effects = MutationEffects::default();
    let same_data_source = match &target {
        ExistingPageTransferTarget::DataSource(destination) => connection
            .query_row(
                "SELECT membership.data_source_id = ?2 \
                 FROM data_source_page_memberships membership \
                 WHERE membership.page_block_id = ?1 AND membership.removed_at IS NULL",
                params![page_id, destination.data_source_id],
                |row| row.get::<_, bool>(0),
            )
            .optional()?
            .unwrap_or(false),
        ExistingPageTransferTarget::Library | ExistingPageTransferTarget::Page { .. } => false,
    };
    let database_target = match &target {
        ExistingPageTransferTarget::Library => DatabaseTransferTarget::Library {
            library_id: library_id.to_owned(),
        },
        ExistingPageTransferTarget::Page { page_id } => DatabaseTransferTarget::Page {
            page_id: (*page_id).to_owned(),
        },
        ExistingPageTransferTarget::DataSource(destination) => DatabaseTransferTarget::DataSource {
            data_source_id: destination.data_source_id.clone(),
        },
    };
    if same_data_source {
        let (parent_kind, parent_id, parent_revision, membership_revision) = connection
            .query_row(
                "SELECT page.parent_kind, page.parent_id, page.parent_revision, \
                   membership.revision \
                 FROM pages page \
                 JOIN data_source_page_memberships membership \
                   ON membership.page_block_id = page.block_id \
                   AND membership.removed_at IS NULL \
                 WHERE page.block_id = ?1 AND page.library_id = ?2 \
                   AND page.lifecycle = 'active'",
                params![page_id, library_id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, i64>(3)?,
                    ))
                },
            )
            .optional()?
            .ok_or_else(|| not_found("Page is unavailable"))?;
        let DatabaseTransferTarget::DataSource { data_source_id } = &database_target else {
            return Err(corrupt("Same-Data-Source move lost its target"));
        };
        if parent_kind != "data_source" || parent_id != *data_source_id {
            return Err(corrupt(
                "Same-Data-Source Page has inconsistent parent authority",
            ));
        }
        require_revision(
            expected_parent_revision,
            parent_revision,
            "Page parent revision changed",
        )?;
        require_revision(
            expected_active_membership_revision,
            membership_revision,
            "Page active membership revision changed",
        )?;
    } else {
        transfer_page(
            connection,
            library_id,
            requesting_project_id,
            page_id,
            expected_parent_revision,
            expected_active_membership_revision,
            &database_target,
            now,
            &mut effects,
            preauthorized_library_scope,
            true,
            defer_projection_refresh,
        )?;
    }
    if let ExistingPageTransferTarget::DataSource(destination) = target {
        for value in &destination.values {
            let expected_value_revision = connection
                .query_row(
                    "SELECT property_value.revision \
                     FROM data_source_property_values property_value \
                     JOIN data_source_page_memberships membership \
                       ON membership.id = property_value.membership_id \
                     WHERE membership.page_block_id = ?1 \
                       AND membership.data_source_id = ?2 \
                       AND membership.removed_at IS NULL \
                       AND property_value.property_id = ?3",
                    params![page_id, destination.data_source_id, value.property_id],
                    |row| row.get::<_, i64>(0),
                )
                .optional()?
                .unwrap_or(0);
            set_value(
                connection,
                library_id,
                requesting_project_id,
                &DatabasePagePropertyAddress {
                    page_id: page_id.to_owned(),
                    data_source_id: destination.data_source_id.clone(),
                    property_id: value.property_id.clone(),
                },
                expected_value_revision,
                &value.value,
                now,
                &mut effects,
                preauthorized_library_scope,
            )?;
        }
        if let Some(view) = &destination.view {
            let expected_position_revision = connection
                .query_row(
                    "SELECT revision FROM database_view_page_positions \
                     WHERE view_id = ?1 AND page_block_id = ?2",
                    params![view.view_id, page_id],
                    |row| row.get::<_, i64>(0),
                )
                .optional()?
                .unwrap_or(0);
            position_pages(
                connection,
                library_id,
                requesting_project_id,
                &view.view_id,
                &[DatabasePagePosition {
                    page_id: page_id.to_owned(),
                    expected_position_revision,
                }],
                view.group_key.as_deref(),
                view.before.as_ref().map(|anchor| anchor.page_id.as_str()),
                now,
                &mut effects,
                preauthorized_library_scope,
            )?;
        }
    }
    let (location_revision, metadata_revision, parent_revision, database_id) = connection
        .query_row(
            "SELECT block.location_revision, block.metadata_revision, page.parent_revision, \
               block.containing_database_id \
             FROM blocks block JOIN pages page ON page.block_id = block.id \
             WHERE block.id = ?1",
            [page_id],
            |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            },
        )?;
    let membership = connection
        .query_row(
            "SELECT id, data_source_id, revision FROM data_source_page_memberships \
             WHERE page_block_id = ?1 AND removed_at IS NULL",
            [page_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )
        .optional()?;
    effects
        .revisions
        .insert(format!("blockLocation:{page_id}"), location_revision);
    effects
        .revisions
        .insert(format!("blockMetadata:{page_id}"), metadata_revision);
    Ok(ExistingPageTransferPlacement {
        database_id,
        data_source_id: membership
            .as_ref()
            .map(|(_, data_source_id, _)| data_source_id.clone()),
        membership_id: membership.as_ref().map(|(id, _, _)| id.clone()),
        affected_database_ids: effects.database_ids.into_iter().collect(),
        affected_view_ids: effects.view_ids.into_iter().collect(),
        committed_revisions: effects.revisions,
        location_revision,
        metadata_revision,
        parent_revision,
    })
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn finalize_agent_moved_pages_in_data_source_prevalidated(
    connection: &Connection,
    library_id: &str,
    requesting_project_id: &str,
    page_ids: &[String],
    destination: &PageCopyDataSourceDestination,
    now: &str,
) -> Result<AgentMoveDataSourceFinalization, StoreError> {
    if page_ids.is_empty() || page_ids.len() > MAX_BULK_VALUES {
        return Err(invalid(format!(
            "Agent Page movement requires between 1 and {MAX_BULK_VALUES} Pages"
        )));
    }
    let mut effects = MutationEffects::default();
    for page_id in page_ids {
        active_row_membership(connection, &destination.data_source_id, page_id)?;
        for value in &destination.values {
            let expected_value_revision = connection
                .query_row(
                    "SELECT property_value.revision \
                     FROM data_source_property_values property_value \
                     JOIN data_source_page_memberships membership \
                       ON membership.id = property_value.membership_id \
                     WHERE membership.page_block_id = ?1 \
                       AND membership.data_source_id = ?2 \
                       AND membership.removed_at IS NULL \
                       AND property_value.property_id = ?3",
                    params![page_id, destination.data_source_id, value.property_id],
                    |row| row.get::<_, i64>(0),
                )
                .optional()?
                .unwrap_or(0);
            set_value(
                connection,
                library_id,
                requesting_project_id,
                &DatabasePagePropertyAddress {
                    page_id: page_id.clone(),
                    data_source_id: destination.data_source_id.clone(),
                    property_id: value.property_id.clone(),
                },
                expected_value_revision,
                &value.value,
                now,
                &mut effects,
                false,
            )?;
        }
    }
    if let Some(placement) = &destination.view {
        let view = view_row(connection, &placement.view_id)?
            .filter(|view| view.lifecycle == "active")
            .ok_or_else(|| not_found("Agent Page-move target View is unavailable"))?;
        if view.data_source_id != destination.data_source_id {
            return Err(invalid(
                "Agent Page-move target View belongs to another Data Source",
            ));
        }
        let config = parse_json(&view.config_json, "Database View config")?;
        if let Some(property_id) = view_group_property(&config) {
            let property = active_property(connection, &destination.data_source_id, property_id)?;
            let value =
                database_group_value_from_key(&property.value_type, placement.group_key.as_deref());
            for page_id in page_ids {
                let expected_value_revision = connection
                    .query_row(
                        "SELECT property_value.revision \
                         FROM data_source_property_values property_value \
                         JOIN data_source_page_memberships membership \
                           ON membership.id = property_value.membership_id \
                         WHERE membership.page_block_id = ?1 \
                           AND membership.data_source_id = ?2 \
                           AND membership.removed_at IS NULL \
                           AND property_value.property_id = ?3",
                        params![page_id, destination.data_source_id, property_id],
                        |row| row.get::<_, i64>(0),
                    )
                    .optional()?
                    .unwrap_or(0);
                set_value(
                    connection,
                    library_id,
                    requesting_project_id,
                    &DatabasePagePropertyAddress {
                        page_id: page_id.clone(),
                        data_source_id: destination.data_source_id.clone(),
                        property_id: property_id.to_owned(),
                    },
                    expected_value_revision,
                    &value,
                    now,
                    &mut effects,
                    false,
                )?;
            }
        }
        let pages = page_ids
            .iter()
            .map(|page_id| {
                let expected_position_revision = connection
                    .query_row(
                        "SELECT revision FROM database_view_page_positions \
                         WHERE view_id = ?1 AND page_block_id = ?2",
                        params![placement.view_id, page_id],
                        |row| row.get::<_, i64>(0),
                    )
                    .optional()?
                    .unwrap_or(0);
                Ok(DatabasePagePosition {
                    page_id: page_id.clone(),
                    expected_position_revision,
                })
            })
            .collect::<Result<Vec<_>, StoreError>>()?;
        position_pages(
            connection,
            library_id,
            requesting_project_id,
            &placement.view_id,
            &pages,
            placement.group_key.as_deref(),
            placement
                .before
                .as_ref()
                .map(|anchor| anchor.page_id.as_str()),
            now,
            &mut effects,
            false,
        )?;
    }
    Ok(AgentMoveDataSourceFinalization {
        affected_database_ids: effects.database_ids.into_iter().collect(),
        affected_view_ids: effects.view_ids.into_iter().collect(),
        committed_revisions: effects.revisions,
    })
}

fn database_group_value_from_key(value_type: &str, group_key: Option<&str>) -> Value {
    let Some(group_key) = group_key else {
        return Value::Null;
    };
    if !matches!(value_type, "number" | "checkbox" | "multi_select") {
        return Value::String(group_key.to_owned());
    }
    serde_json::from_str(group_key).unwrap_or_else(|_| Value::String(group_key.to_owned()))
}

#[allow(clippy::too_many_arguments)]
fn transfer_page(
    connection: &Connection,
    library_id: &str,
    project_id: &str,
    page_id: &str,
    expected_parent_revision: i64,
    expected_active_membership_revision: i64,
    target: &DatabaseTransferTarget,
    now: &str,
    effects: &mut MutationEffects,
    library_scope: bool,
    allow_page_parent_transition: bool,
    defer_projection_refresh: bool,
) -> Result<(), StoreError> {
    validate_id(page_id, "page_id", MAX_ID_LENGTH)?;
    let page = connection
        .query_row(
            "SELECT page.library_id, page.parent_kind, page.parent_id, page.parent_revision, \
               block.project_id FROM pages page JOIN blocks block ON block.id = page.block_id \
             WHERE page.block_id = ?1 AND page.lifecycle <> 'deleted'",
            [page_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, String>(4)?,
                ))
            },
        )
        .optional()?
        .ok_or_else(|| not_found("Page is unavailable"))?;
    let (page_library_id, parent_kind, _, parent_revision, page_project_id) = page;
    if page_library_id != library_id || (!library_scope && page_project_id != project_id) {
        return Err(unauthorized(
            "Bound Project cannot transfer this Page authority",
        ));
    }
    if !allow_page_parent_transition
        && (parent_kind == "page" || matches!(target, DatabaseTransferTarget::Page { .. }))
    {
        return Err(StoreError::new(
            StoreErrorCode::InvalidInput,
            "Page-parent transitions require Library Block/Document authority",
            false,
        ));
    }
    require_revision(
        expected_parent_revision,
        parent_revision,
        "Page parent revision changed",
    )?;
    let active_membership = connection
        .query_row(
            "SELECT id, data_source_id, revision FROM data_source_page_memberships \
             WHERE page_block_id = ?1 AND removed_at IS NULL",
            [page_id],
            |row| {
                Ok(ActiveMembership {
                    id: row.get(0)?,
                    data_source_id: row.get(1)?,
                    revision: row.get(2)?,
                })
            },
        )
        .optional()?;
    require_revision(
        expected_active_membership_revision,
        active_membership
            .as_ref()
            .map_or(0, |membership| membership.revision),
        "Page active membership revision changed",
    )?;
    let previous_source = active_membership
        .as_ref()
        .map(|membership| require_source(connection, library_id, &membership.data_source_id))
        .transpose()?;
    if let Some(source) = &previous_source {
        authorize_write(
            connection,
            project_id,
            &source.database_id,
            DatabaseWriteAction::Write,
            library_scope,
        )?;
    }
    let positioned_views = connection
        .prepare("SELECT view_id FROM database_view_page_positions WHERE page_block_id = ?1")?
        .query_map([page_id], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if let Some(membership) = &active_membership {
        let removed_revision = connection
            .query_row(
                "UPDATE data_source_page_memberships SET removed_at = ?1, revision = revision + 1 \
                 WHERE id = ?2 AND removed_at IS NULL RETURNING revision",
                params![now, membership.id],
                |row| row.get::<_, i64>(0),
            )
            .optional()?
            .ok_or_else(|| corrupt("Active Data Source membership disappeared"))?;
        effects.revisions.insert(
            format!("membership:{}:{}", membership.data_source_id, membership.id),
            removed_revision,
        );
    }
    connection.execute(
        "DELETE FROM database_view_page_positions WHERE page_block_id = ?1",
        [page_id],
    )?;
    effects.view_ids.extend(positioned_views);

    let (target_membership_id, target_data_source_id) = match target {
        DatabaseTransferTarget::Library {
            library_id: target_library_id,
        } => {
            if target_library_id != library_id {
                return Err(unauthorized("A Page cannot transfer to another Library"));
            }
            connection.execute(
                "UPDATE blocks SET location_kind = 'space', containing_document_id = NULL, \
                   containing_database_id = NULL, location_revision = location_revision + 1, \
                   metadata_revision = metadata_revision + 1, updated_at = ?1 WHERE id = ?2",
                params![now, page_id],
            )?;
            append_top_level_placement(connection, &page_project_id, page_id, now)?;
            let rank_key = connection.query_row(
                "SELECT rank_key FROM top_level_block_placements WHERE block_id = ?1",
                [page_id],
                |row| row.get::<_, String>(0),
            )?;
            connection.execute(
                "INSERT INTO library_block_placements(\
                   block_id, library_id, rank_key, revision, created_at, updated_at\
                 ) VALUES (?1, ?2, ?3, 1, ?4, ?4) \
                 ON CONFLICT(block_id) DO UPDATE SET library_id = excluded.library_id, \
                   rank_key = excluded.rank_key, revision = library_block_placements.revision + 1, \
                   updated_at = excluded.updated_at",
                params![page_id, library_id, rank_key, now],
            )?;
            (None, None)
        }
        DatabaseTransferTarget::DataSource { data_source_id } => {
            let target_source = require_source(connection, library_id, data_source_id)?;
            authorize_write(
                connection,
                project_id,
                &target_source.database_id,
                DatabaseWriteAction::Write,
                library_scope,
            )?;
            let target_project_id = connection
                .query_row(
                    "SELECT project_id FROM blocks WHERE id = ?1 AND type = 'database'",
                    [&target_source.database_id],
                    |row| row.get::<_, String>(0),
                )
                .optional()?
                .ok_or_else(|| corrupt("Target Data Source has no Database Block authority"))?;
            if !library_scope && target_project_id != project_id {
                return Err(unauthorized(
                    "A Page cannot transfer across Project ownership",
                ));
            }
            if active_membership
                .as_ref()
                .is_some_and(|membership| membership.data_source_id == *data_source_id)
            {
                return Err(invalid("Page already belongs to the target Data Source"));
            }
            let history = connection
                .query_row(
                    "SELECT id, revision, created_at FROM data_source_page_memberships \
                     WHERE data_source_id = ?1 AND page_block_id = ?2",
                    params![data_source_id, page_id],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, i64>(1)?,
                            row.get::<_, String>(2)?,
                        ))
                    },
                )
                .optional()?;
            let membership_id = history.as_ref().map_or_else(
                || deterministic_membership_id(data_source_id, page_id),
                |(id, _, _)| id.clone(),
            );
            if history.is_none() {
                let collision = connection
                    .query_row(
                        "SELECT 1 FROM data_source_page_memberships WHERE id = ?1",
                        [&membership_id],
                        |_| Ok(()),
                    )
                    .optional()?;
                if collision.is_some() {
                    return Err(StoreError::new(
                        StoreErrorCode::AlreadyOwned,
                        "Deterministic membership identity is already owned",
                        false,
                    ));
                }
            }
            let revision = history.as_ref().map_or(1, |(_, revision, _)| revision + 1);
            connection.execute(
                "DELETE FROM top_level_block_placements WHERE block_id = ?1",
                [page_id],
            )?;
            connection.execute(
                "DELETE FROM library_block_placements WHERE block_id = ?1",
                [page_id],
            )?;
            connection.execute(
                "UPDATE blocks SET location_kind = 'database', containing_document_id = NULL, \
                   containing_database_id = ?1, location_revision = location_revision + 1, \
                   metadata_revision = metadata_revision + 1, updated_at = ?2 WHERE id = ?3",
                params![target_source.database_id, now, page_id],
            )?;
            connection.execute(
                "INSERT INTO data_source_page_memberships(\
                   id, data_source_id, page_block_id, revision, created_at, removed_at\
                 ) VALUES (?1, ?2, ?3, ?4, ?5, NULL) \
                 ON CONFLICT(id) DO UPDATE SET data_source_id = excluded.data_source_id, \
                   page_block_id = excluded.page_block_id, revision = excluded.revision, \
                   removed_at = NULL",
                params![
                    membership_id,
                    data_source_id,
                    page_id,
                    revision,
                    history
                        .as_ref()
                        .map_or(now, |(_, _, created_at)| created_at),
                ],
            )?;
            ensure_transferred_built_in_values(
                connection,
                active_membership.as_ref(),
                &membership_id,
                data_source_id,
                now,
                Some(effects),
            )?;
            effects.revisions.insert(
                format!("membership:{data_source_id}:{membership_id}"),
                revision,
            );
            effects.database_ids.insert(target_source.database_id);
            effects.data_source_ids.insert(data_source_id.clone());
            (Some(membership_id), Some(data_source_id.clone()))
        }
        DatabaseTransferTarget::Page {
            page_id: target_page_id,
        } => {
            let (target_document_id, target_project_id) = connection
                .query_row(
                    "SELECT page.document_id, block.project_id \
                     FROM pages page JOIN blocks block ON block.id = page.block_id \
                     WHERE page.block_id = ?1 AND page.library_id = ?2 \
                       AND page.lifecycle = 'active' AND block.lifecycle = 'active'",
                    params![target_page_id, library_id],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
                )
                .optional()?
                .ok_or_else(|| not_found("Target Page is unavailable"))?;
            if !library_scope && target_project_id != project_id {
                return Err(unauthorized(
                    "A Page cannot transfer across Project ownership",
                ));
            }
            connection.execute(
                "DELETE FROM top_level_block_placements WHERE block_id = ?1",
                [page_id],
            )?;
            connection.execute(
                "DELETE FROM library_block_placements WHERE block_id = ?1",
                [page_id],
            )?;
            connection.execute(
                "UPDATE blocks SET location_kind = 'document', containing_document_id = ?1, \
                   containing_database_id = NULL, location_revision = location_revision + 1, \
                   metadata_revision = metadata_revision + 1, updated_at = ?2 WHERE id = ?3",
                params![target_document_id, now, page_id],
            )?;
            effects.page_ids.insert(target_page_id.clone());
            (None, None)
        }
    };
    let (parent_kind, parent_id) = match target {
        DatabaseTransferTarget::Library { library_id } => ("library", library_id.as_str()),
        DatabaseTransferTarget::DataSource { data_source_id } => {
            ("data_source", data_source_id.as_str())
        }
        DatabaseTransferTarget::Page { page_id } => ("page", page_id.as_str()),
    };
    let updated = connection
        .query_row(
            "UPDATE pages SET parent_kind = ?1, parent_id = ?2, \
               parent_revision = parent_revision + 1, metadata_revision = metadata_revision + 1, \
               updated_at = ?3 WHERE block_id = ?4 AND parent_revision = ?5 \
             RETURNING parent_revision, metadata_revision",
            params![
                parent_kind,
                parent_id,
                now,
                page_id,
                expected_parent_revision
            ],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
        )
        .optional()?;
    let Some((parent_revision, metadata_revision)) = updated else {
        return Err(StoreError::new(
            StoreErrorCode::RevisionConflict,
            "Page parent authority changed during transfer",
            true,
        ));
    };
    if !defer_projection_refresh {
        refresh_transferred_page_projection(
            connection,
            page_id,
            target_membership_id.as_deref(),
            target_data_source_id.as_deref(),
            now,
        )?;
    }
    if let Some(source) = previous_source {
        touch_source(effects, &source);
    }
    effects.page_ids.insert(page_id.to_owned());
    effects
        .revisions
        .insert(format!("page:{page_id}:parent"), parent_revision);
    effects
        .revisions
        .insert(format!("page:{page_id}:metadata"), metadata_revision);
    Ok(())
}

fn ensure_transferred_built_in_values(
    connection: &Connection,
    source_membership: Option<&ActiveMembership>,
    target_membership_id: &str,
    target_data_source_id: &str,
    now: &str,
    mut effects: Option<&mut MutationEffects>,
) -> Result<(), StoreError> {
    let properties = connection
        .prepare(
            "SELECT id, value_type, config_json, rank_key, lifecycle, schema_revision, created_at \
             FROM data_source_properties WHERE data_source_id = ?1 AND lifecycle = 'active' \
             ORDER BY id",
        )?
        .query_map([target_data_source_id], |row| {
            Ok(PropertyRow {
                id: row.get(0)?,
                value_type: row.get(1)?,
                config_json: row.get(2)?,
                rank_key: row.get(3)?,
                lifecycle: row.get(4)?,
                revision: row.get(5)?,
                created_at: row.get(6)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for target_property in properties {
        if !is_built_in_property(&target_property.id) {
            continue;
        }
        let existing = connection
            .query_row(
                "SELECT 1 FROM data_source_property_values WHERE data_source_id = ?1 \
                 AND membership_id = ?2 AND property_id = ?3",
                params![
                    target_data_source_id,
                    target_membership_id,
                    target_property.id
                ],
                |_| Ok(()),
            )
            .optional()?;
        if existing.is_some() {
            continue;
        }
        let value = transfer_value(connection, source_membership, &target_property)?;
        connection.execute(
            "INSERT INTO data_source_property_values(\
               data_source_id, membership_id, property_id, value_type, value_json, revision, updated_at\
             ) VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6)",
            params![
                target_data_source_id,
                target_membership_id,
                target_property.id,
                target_property.value_type,
                serde_json::to_string(&value).map_err(|_| internal("Transferred value"))?,
                now,
            ],
        )?;
        if let Some(effects) = effects.as_deref_mut() {
            effects.revisions.insert(
                format!(
                    "value:{target_data_source_id}:{target_membership_id}:{}",
                    target_property.id
                ),
                1,
            );
        }
    }
    Ok(())
}

fn copy_same_source_property_values(
    connection: &Connection,
    source_membership: &ActiveMembership,
    target_membership_id: &str,
    now: &str,
) -> Result<(), StoreError> {
    connection.execute(
        "INSERT INTO data_source_property_values(\
           data_source_id, membership_id, property_id, value_type, value_json, revision, updated_at\
         ) \
         SELECT value.data_source_id, ?1, value.property_id, value.value_type, value.value_json, 1, ?2 \
         FROM data_source_property_values value \
         JOIN data_source_properties property ON property.data_source_id = value.data_source_id \
           AND property.id = value.property_id AND property.lifecycle = 'active' \
         WHERE value.data_source_id = ?3 AND value.membership_id = ?4 \
           AND NOT EXISTS (\
             SELECT 1 FROM data_source_property_values existing \
             WHERE existing.data_source_id = value.data_source_id \
               AND existing.membership_id = ?1 AND existing.property_id = value.property_id\
           )",
        params![
            target_membership_id,
            now,
            source_membership.data_source_id,
            source_membership.id,
        ],
    )?;
    super::relation::copy_relation_edges(
        connection,
        &source_membership.data_source_id,
        &source_membership.id,
        target_membership_id,
        now,
    )?;
    Ok(())
}

fn transfer_value(
    connection: &Connection,
    source_membership: Option<&ActiveMembership>,
    target_property: &PropertyRow,
) -> Result<Value, StoreError> {
    let fallback = default_built_in_value(target_property)?;
    let Some(source_membership) = source_membership else {
        return Ok(fallback);
    };
    let Some(source_property) = property_row(
        connection,
        &source_membership.data_source_id,
        &target_property.id,
    )?
    else {
        return Ok(fallback);
    };
    if source_property.lifecycle != "active"
        || source_property.value_type != target_property.value_type
    {
        return Ok(fallback);
    }
    let source_value = connection
        .query_row(
            "SELECT value_json FROM data_source_property_values WHERE data_source_id = ?1 \
             AND membership_id = ?2 AND property_id = ?3",
            params![
                source_membership.data_source_id,
                source_membership.id,
                target_property.id,
            ],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .map(|value| parse_json(&value, "Transferred source value"))
        .transpose()?;
    let Some(source_value) = source_value else {
        return Ok(fallback);
    };
    if target_property.id == "tags" {
        return map_tags_between_properties(&source_property, &source_value, target_property);
    }
    match normalize_value(target_property, &source_value) {
        Ok(value) => Ok(value),
        Err(error) if error.code == StoreErrorCode::InvalidInput => Ok(fallback),
        Err(error) => Err(error),
    }
}

fn default_built_in_value(property: &PropertyRow) -> Result<Value, StoreError> {
    if property.id == "tags" {
        return Ok(Value::Array(Vec::new()));
    }
    if property.id == "status" {
        let config = option_config(property)?;
        if config.options.iter().any(|option| option.id == "triage") {
            return Ok(Value::String("triage".to_owned()));
        }
    }
    Ok(Value::Null)
}

fn map_tags_between_properties(
    source_property: &PropertyRow,
    source_value: &Value,
    target_property: &PropertyRow,
) -> Result<Value, StoreError> {
    let source_value = normalize_value(source_property, source_value)?;
    let source = option_config(source_property)?;
    let target = option_config(target_property)?;
    let source_names = source
        .options
        .iter()
        .map(|option| (option.id.as_str(), option.name.as_str()))
        .collect::<std::collections::HashMap<_, _>>();
    let target_ids = target
        .options
        .iter()
        .map(|option| (option.name.as_str(), option.id.as_str()))
        .collect::<std::collections::HashMap<_, _>>();
    let mapped = source_value
        .as_array()
        .ok_or_else(|| corrupt("Canonical source tags value is not an array"))?
        .iter()
        .filter_map(|value| {
            value
                .as_str()
                .and_then(|option_id| source_names.get(option_id))
                .and_then(|name| target_ids.get(name))
                .map(|option_id| Value::String((*option_id).to_owned()))
        })
        .collect::<Vec<_>>();
    Ok(Value::Array(mapped))
}

pub(crate) fn refresh_transferred_page_projection(
    connection: &Connection,
    page_id: &str,
    target_membership_id: Option<&str>,
    target_data_source_id: Option<&str>,
    now: &str,
) -> Result<(), StoreError> {
    let authority = connection
        .query_row(
            "SELECT block.project_id, block.lifecycle, block.location_kind, \
               block.containing_document_id, block.containing_database_id, \
               block.location_revision, block.metadata_revision, placement.rank_key \
             FROM blocks block LEFT JOIN top_level_block_placements placement \
               ON placement.block_id = block.id WHERE block.id = ?1 AND block.type = 'page'",
            [page_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, i64>(6)?,
                    row.get::<_, Option<String>>(7)?,
                ))
            },
        )
        .optional()?
        .ok_or_else(|| corrupt("Transferred Page authority disappeared"))?;
    let compatibility = match (target_membership_id, target_data_source_id) {
        (Some(membership_id), Some(data_source_id)) => {
            read_compatibility_values(connection, data_source_id, membership_id)?
        }
        (None, None) => CompatibilityValues {
            values: Map::new(),
            revisions: Map::new(),
        },
        _ => {
            return Err(corrupt(
                "Transferred Page membership projection is incomplete",
            ));
        }
    };
    let placement = match target_data_source_id {
        Some(data_source_id) => preferred_view_placement(connection, data_source_id, page_id)?,
        None => PreferredViewPlacement {
            view_id: None,
            group_key: None,
            rank_key: None,
        },
    };
    let property_revisions_json = connection
        .query_row(
            "SELECT property_revisions_json FROM page_read_model WHERE page_block_id = ?1",
            [page_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or_else(|| corrupt("Transferred Page has no read projection"))?;
    let mut property_revisions = json_object(
        &property_revisions_json,
        "Transferred Page Property revisions",
    )?;
    property_revisions.insert(
        "database".to_owned(),
        Value::Object(compatibility.revisions),
    );
    connection.execute(
        "UPDATE page_read_model SET project_id = ?1, lifecycle = ?2, location_kind = ?3, \
           containing_document_id = ?4, containing_database_id = ?5, top_level_rank_key = ?6, \
           location_revision = ?7, metadata_revision = ?8, membership_id = ?9, \
           database_block_id = ?5, view_id = ?10, view_group_key = ?11, view_rank_key = ?12, \
           database_values_json = ?13, property_revisions_json = ?14, \
           projection_version = projection_version + 1, updated_at = ?15 WHERE page_block_id = ?16",
        params![
            authority.0,
            authority.1,
            authority.2,
            authority.3,
            authority.4,
            authority.7,
            authority.5,
            authority.6,
            target_membership_id,
            placement.view_id,
            placement.group_key,
            placement.rank_key,
            serde_json::to_string(&compatibility.values)
                .map_err(|_| internal("Transferred Page values"))?,
            serde_json::to_string(&property_revisions)
                .map_err(|_| internal("Transferred Page revisions"))?,
            now,
            page_id,
        ],
    )?;
    let scheduled_start = compatibility
        .values
        .get("scheduled_start")
        .and_then(Value::as_str);
    let scheduled_end = compatibility
        .values
        .get("scheduled_end")
        .and_then(Value::as_str);
    connection.execute(
        "UPDATE scheduled_page_index SET lifecycle = ?1, scheduled_start = ?2, \
           scheduled_end = ?3, is_all_day = CASE WHEN ?2 IS NOT NULL AND ?3 IS NOT NULL \
             THEN is_all_day ELSE 0 END, source_metadata_revision = ?4, updated_at = ?5 \
         WHERE page_block_id = ?6",
        params![
            authority.1,
            scheduled_start,
            scheduled_end,
            authority.6,
            now,
            page_id,
        ],
    )?;
    Ok(())
}

fn read_compatibility_values(
    connection: &Connection,
    data_source_id: &str,
    membership_id: &str,
) -> Result<CompatibilityValues, StoreError> {
    let rows = connection
        .prepare(
            "SELECT property.id, property.value_type, property.config_json, property.rank_key, \
               property.lifecycle, property.schema_revision, property.created_at, \
               value.value_json, value.revision FROM data_source_properties property \
             LEFT JOIN data_source_property_values value ON value.data_source_id = property.data_source_id \
               AND value.property_id = property.id AND value.membership_id = ?1 \
             WHERE property.data_source_id = ?2 AND property.lifecycle = 'active' ORDER BY property.id",
        )?
        .query_map(params![membership_id, data_source_id], |row| {
            Ok((
                PropertyRow {
                    id: row.get(0)?,
                    value_type: row.get(1)?,
                    config_json: row.get(2)?,
                    rank_key: row.get(3)?,
                    lifecycle: row.get(4)?,
                    revision: row.get(5)?,
                    created_at: row.get(6)?,
                },
                row.get::<_, Option<String>>(7)?,
                row.get::<_, Option<i64>>(8)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut values = Map::new();
    let mut revisions = Map::new();
    for (property, value, revision) in rows {
        if !is_built_in_property(&property.id) {
            continue;
        }
        let (Some(value), Some(revision)) = (value, revision) else {
            continue;
        };
        let value = parse_json(&value, "Transferred compatibility value")?;
        let value = if property.id == "tags" {
            tag_compatibility_value(&property, &value)?
        } else {
            value
        };
        values.insert(property.id.clone(), value);
        revisions.insert(property.id, Value::from(revision));
    }
    Ok(CompatibilityValues { values, revisions })
}

fn preferred_view_placement(
    connection: &Connection,
    data_source_id: &str,
    page_id: &str,
) -> Result<PreferredViewPlacement, StoreError> {
    let view_id = connection
        .query_row(
            "SELECT view.id FROM data_sources source \
             JOIN database_containers container ON container.block_id = source.home_database_block_id \
             JOIN database_views view ON view.database_block_id = container.block_id \
               AND view.data_source_id = source.id AND view.lifecycle = 'active' \
             WHERE source.id = ?1 ORDER BY CASE WHEN view.id = container.default_view_id \
               THEN 0 ELSE 1 END, view.rank_key, view.id LIMIT 1",
            [data_source_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    let Some(view_id) = view_id else {
        return Ok(PreferredViewPlacement {
            view_id: None,
            group_key: None,
            rank_key: None,
        });
    };
    let position = connection
        .query_row(
            "SELECT group_key, rank_key FROM database_view_page_positions \
             WHERE view_id = ?1 AND page_block_id = ?2",
            params![view_id, page_id],
            |row| Ok((row.get::<_, Option<String>>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;
    Ok(PreferredViewPlacement {
        view_id: Some(view_id),
        group_key: position.as_ref().and_then(|(group, _)| group.clone()),
        rank_key: position.map(|(_, rank)| rank),
    })
}

fn append_top_level_placement(
    connection: &Connection,
    project_id: &str,
    page_id: &str,
    now: &str,
) -> Result<(), StoreError> {
    let mut ids = connection
        .prepare(
            "SELECT block_id FROM top_level_block_placements \
             WHERE project_id = ?1 ORDER BY rank_key, block_id",
        )?
        .query_map([project_id], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    ids.retain(|id| id != page_id);
    ids.push(page_id.to_owned());
    let total = ids.len();
    for (index, id) in ids.into_iter().enumerate() {
        let rank = fractional_rank(index + 1, total);
        connection.execute(
            "INSERT INTO top_level_block_placements(\
               block_id, project_id, rank_key, created_at, updated_at\
             ) VALUES (?1, ?2, ?3, ?4, ?4) ON CONFLICT(block_id) DO UPDATE SET \
               project_id = excluded.project_id, rank_key = excluded.rank_key, \
               updated_at = excluded.updated_at",
            params![id, project_id, rank, now],
        )?;
    }
    Ok(())
}

fn deterministic_membership_id(data_source_id: &str, page_id: &str) -> String {
    let fingerprint = format!("{data_source_id}\0{page_id}");
    format!("membership:{}", sha256(fingerprint.as_bytes()))
}

fn is_built_in_property(property_id: &str) -> bool {
    matches!(
        property_id,
        "status"
            | "priority"
            | "estimate"
            | "tags"
            | "due_date"
            | "scheduled_start"
            | "scheduled_end"
            | "assignee"
    )
}

#[allow(clippy::too_many_arguments)]
fn put_view(
    connection: &Connection,
    library_id: &str,
    project_id: &str,
    database_id: &str,
    data_source_id: &str,
    view_id: &str,
    expected_revision: i64,
    name: &str,
    view_kind: &str,
    config: &Value,
    is_default: bool,
    before_view_id: Option<&str>,
    now: &str,
    effects: &mut MutationEffects,
    library_scope: bool,
) -> Result<(), StoreError> {
    validate_id(database_id, "database_id", MAX_ID_LENGTH)?;
    validate_id(view_id, "view_id", MAX_ID_LENGTH)?;
    let name = validate_name(name, "View name")?;
    if !matches!(view_kind, "kanban" | "list" | "calendar") {
        return Err(invalid("Database View kind is unsupported"));
    }
    let container = require_container(connection, library_id, database_id)?;
    if container.lifecycle != "active" {
        return Err(not_found("Database is not active"));
    }
    let source = require_source(connection, library_id, data_source_id)?;
    if source.database_id != database_id {
        return Err(not_found(
            "View Database and Data Source must share one active authority",
        ));
    }
    authorize_write(
        connection,
        project_id,
        database_id,
        DatabaseWriteAction::ManageViews,
        library_scope,
    )?;
    let existing = view_row(connection, view_id)?;
    require_revision(
        expected_revision,
        existing.as_ref().map_or(0, |view| view.revision),
        "Database View revision changed",
    )?;
    if !existing
        .as_ref()
        .is_some_and(|view| view.lifecycle == "active")
    {
        let active_count = connection.query_row(
            "SELECT count(*) FROM database_views \
             WHERE database_block_id = ?1 AND lifecycle = 'active'",
            [database_id],
            |row| row.get::<_, i64>(0),
        )?;
        ensure_collection_capacity(
            active_count,
            super::MAX_DATABASE_VIEWS,
            "Database View collection",
        )?;
    }
    if existing
        .as_ref()
        .is_some_and(|view| view.database_id != database_id)
    {
        return Err(StoreError::new(
            StoreErrorCode::AlreadyOwned,
            "Database View identity belongs to another Database",
            false,
        ));
    }
    validate_view_config(
        connection,
        library_id,
        project_id,
        data_source_id,
        config,
        library_scope,
    )?;
    let encoded_config = serde_json::to_string(config)
        .map_err(|_| invalid("Database View config cannot be encoded"))?;
    if encoded_config.len() > 262_144 {
        return Err(invalid("Database View config exceeds its byte bound"));
    }
    let existing_group = existing
        .as_ref()
        .map(|view| parse_json(&view.config_json, "Database View config"))
        .transpose()?
        .as_ref()
        .and_then(view_group_property)
        .map(str::to_owned);
    let next_group = view_group_property(config).map(str::to_owned);
    let source_changed = existing
        .as_ref()
        .is_some_and(|view| view.data_source_id != data_source_id);
    let group_changed = existing.is_some() && existing_group != next_group;
    if source_changed || group_changed {
        clear_view_positions(connection, view_id, now)?;
    }
    if source_changed {
        clear_view_projection(connection, view_id, now)?;
    }
    let preserve_rank = existing
        .as_ref()
        .filter(|view| view.lifecycle == "active" && before_view_id.is_none())
        .map(|view| view.rank_key.clone());
    let rank_key = preserve_rank.clone().unwrap_or_else(|| "0".repeat(32));
    let revision = existing.as_ref().map_or(1, |view| view.revision + 1);
    let created_at = existing
        .as_ref()
        .map_or(now, |view| view.created_at.as_str());
    connection.execute(
        "INSERT INTO database_views(\
           id, database_block_id, data_source_id, name, kind, config_json, revision, \
           rank_key, lifecycle, created_at, updated_at\
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'active', ?9, ?10) \
         ON CONFLICT(id) DO UPDATE SET database_block_id = excluded.database_block_id, \
           data_source_id = excluded.data_source_id, name = excluded.name, kind = excluded.kind, \
           config_json = excluded.config_json, revision = excluded.revision, \
           rank_key = excluded.rank_key, lifecycle = 'active', updated_at = excluded.updated_at",
        params![
            view_id,
            database_id,
            data_source_id,
            name,
            view_kind,
            encoded_config,
            revision,
            rank_key,
            created_at,
            now,
        ],
    )?;
    if preserve_rank.is_none() {
        reorder_views(connection, database_id, view_id, before_view_id)?;
    }
    let metadata_revision = connection.query_row(
        "UPDATE database_containers SET \
           default_view_id = CASE WHEN ?1 = 1 THEN ?2 ELSE default_view_id END, \
           metadata_revision = metadata_revision + 1, updated_at = ?3 WHERE block_id = ?4 \
         RETURNING metadata_revision",
        params![i64::from(is_default), view_id, now, database_id],
        |row| row.get::<_, i64>(0),
    )?;
    if is_default
        || container.default_view_id.as_deref() == Some(view_id)
        || source_changed
        || group_changed
    {
        refresh_default_view_projection(connection, database_id, now)?;
    }
    effects.database_ids.insert(database_id.to_owned());
    effects.data_source_ids.insert(data_source_id.to_owned());
    if let Some(existing) = existing {
        effects.data_source_ids.insert(existing.data_source_id);
    }
    effects.view_ids.insert(view_id.to_owned());
    effects
        .revisions
        .insert(format!("view:{view_id}"), revision);
    effects.revisions.insert(
        format!("database:{database_id}:metadata"),
        metadata_revision,
    );
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn delete_view(
    connection: &Connection,
    library_id: &str,
    project_id: &str,
    database_id: &str,
    view_id: &str,
    expected_revision: i64,
    now: &str,
    effects: &mut MutationEffects,
    library_scope: bool,
) -> Result<(), StoreError> {
    let container = require_container(connection, library_id, database_id)?;
    let view = view_row(connection, view_id)?
        .filter(|view| view.database_id == database_id && view.lifecycle == "active")
        .ok_or_else(|| not_found("Active Database View is unavailable"))?;
    authorize_write(
        connection,
        project_id,
        database_id,
        DatabaseWriteAction::ManageViews,
        library_scope,
    )?;
    require_revision(
        expected_revision,
        view.revision,
        "Database View revision changed",
    )?;
    let was_default = container.default_view_id.as_deref() == Some(view_id);
    let metadata_revision = connection.query_row(
        "UPDATE database_containers SET \
           default_view_id = CASE WHEN default_view_id = ?1 THEN NULL ELSE default_view_id END, \
           metadata_revision = metadata_revision + 1, updated_at = ?2 WHERE block_id = ?3 \
         RETURNING metadata_revision",
        params![view_id, now, database_id],
        |row| row.get::<_, i64>(0),
    )?;
    clear_view_projection(connection, view_id, now)?;
    connection.execute(
        "DELETE FROM database_view_page_positions WHERE view_id = ?1",
        [view_id],
    )?;
    connection.execute(
        "UPDATE database_views SET lifecycle = 'deleted', revision = revision + 1, \
           updated_at = ?1 WHERE id = ?2",
        params![now, view_id],
    )?;
    if was_default {
        refresh_default_view_projection(connection, database_id, now)?;
    }
    effects.database_ids.insert(database_id.to_owned());
    effects.data_source_ids.insert(view.data_source_id);
    effects.view_ids.insert(view_id.to_owned());
    effects
        .revisions
        .insert(format!("view:{view_id}"), view.revision + 1);
    effects.revisions.insert(
        format!("database:{database_id}:metadata"),
        metadata_revision,
    );
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn position_pages(
    connection: &Connection,
    library_id: &str,
    project_id: &str,
    view_id: &str,
    pages: &[DatabasePagePosition],
    group_key: Option<&str>,
    before_page_id: Option<&str>,
    now: &str,
    effects: &mut MutationEffects,
    library_scope: bool,
) -> Result<(), StoreError> {
    if pages.is_empty() || pages.len() > MAX_BULK_VALUES {
        return Err(invalid(format!(
            "View positioning requires between 1 and {MAX_BULK_VALUES} Pages"
        )));
    }
    let page_ids = pages
        .iter()
        .map(|page| page.page_id.as_str())
        .collect::<HashSet<_>>();
    if page_ids.len() != pages.len() {
        return Err(invalid("View position Page IDs must be unique"));
    }
    if before_page_id.is_some_and(|page_id| page_ids.contains(page_id)) {
        return Err(invalid(
            "View position anchor must be outside the moved Page set",
        ));
    }
    let view = view_row(connection, view_id)?
        .filter(|view| view.lifecycle == "active")
        .ok_or_else(|| not_found("Active Database View is unavailable"))?;
    let source = require_source(connection, library_id, &view.data_source_id)?;
    if source.database_id != view.database_id {
        return Err(corrupt("Database View source authority is inconsistent"));
    }
    authorize_write(
        connection,
        project_id,
        &view.database_id,
        DatabaseWriteAction::Write,
        library_scope,
    )?;
    let config = parse_json(&view.config_json, "Database View config")?;
    let group_property_id = view_group_property(&config);
    let mut existing_revisions = std::collections::HashMap::new();
    for page in pages {
        let membership_id = active_row_membership(connection, &view.data_source_id, &page.page_id)?;
        let existing_revision = connection
            .query_row(
                "SELECT revision FROM database_view_page_positions \
                 WHERE view_id = ?1 AND page_block_id = ?2",
                params![view_id, page.page_id],
                |row| row.get::<_, i64>(0),
            )
            .optional()?
            .unwrap_or(0);
        require_revision(
            page.expected_position_revision,
            existing_revision,
            "Database View position revision changed",
        )?;
        if let Some(property_id) = group_property_id {
            let value = connection
                .query_row(
                    "SELECT value_json FROM data_source_property_values \
                     WHERE data_source_id = ?1 AND membership_id = ?2 AND property_id = ?3",
                    params![view.data_source_id, membership_id, property_id],
                    |row| row.get::<_, String>(0),
                )
                .optional()?
                .map(|value| parse_json(&value, "Grouped Property value"))
                .transpose()?;
            let effective = value.as_ref().map_or(Ok(None), database_group_key)?;
            if effective.as_deref() != group_key {
                return Err(invalid(
                    "View position group does not match the grouped Property value",
                ));
            }
        }
        existing_revisions.insert(page.page_id.as_str(), existing_revision);
    }

    let logical = read_logical_group(connection, &view, group_property_id, group_key, &page_ids)?;
    let descending = view_manual_direction(&config) == "desc";
    let moved_page_ids = pages
        .iter()
        .map(|page| page.page_id.clone())
        .collect::<Vec<_>>();
    let rank_plan = plan_view_position_run(&logical, &moved_page_ids, before_page_id, descending)
        .map_err(view_position_plan_error)?;
    let mut put = connection.prepare(
        "INSERT INTO database_view_page_positions(\
           view_id, page_block_id, group_key, rank_key, revision, created_at, updated_at\
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6) \
         ON CONFLICT(view_id, page_block_id) DO UPDATE SET group_key = excluded.group_key, \
           rank_key = excluded.rank_key, revision = excluded.revision, updated_at = excluded.updated_at",
    )?;
    for write in &rank_plan.sibling_writes {
        match write.kind {
            ViewSiblingRankWriteKind::Materialize => {
                put.execute(params![
                    view_id,
                    write.page_id,
                    group_key,
                    write.rank_key,
                    1,
                    now,
                ])?;
            }
            ViewSiblingRankWriteKind::Rebalance => {
                let updated = connection.execute(
                    "UPDATE database_view_page_positions SET rank_key = ?1, updated_at = ?2 \
                     WHERE view_id = ?3 AND page_block_id = ?4",
                    params![write.rank_key, now, view_id, write.page_id],
                )?;
                if updated != 1 {
                    return Err(corrupt(
                        "Database View sibling position disappeared during rank maintenance",
                    ));
                }
            }
        }
        connection.execute(
            "UPDATE page_read_model SET view_group_key = ?1, view_rank_key = ?2, \
               projection_version = projection_version + 1, updated_at = ?3 \
             WHERE page_block_id = ?4 AND view_id = ?5",
            params![group_key, write.rank_key, now, write.page_id, view_id],
        )?;
    }
    for page in pages {
        let rank_key = rank_plan
            .moved_rank_keys
            .get(&page.page_id)
            .ok_or_else(|| corrupt("Database View rank plan omitted a moved Page"))?;
        let current = connection
            .query_row(
                "SELECT revision, created_at FROM database_view_page_positions \
                 WHERE view_id = ?1 AND page_block_id = ?2",
                params![view_id, page.page_id],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?;
        let revision = existing_revisions
            .get(page.page_id.as_str())
            .copied()
            .unwrap_or(0)
            + 1;
        put.execute(params![
            view_id,
            page.page_id,
            group_key,
            rank_key,
            revision,
            current.as_ref().map_or(now, |(_, created_at)| created_at),
        ])?;
        connection.execute(
            "UPDATE page_read_model SET view_group_key = ?1, view_rank_key = ?2, \
               projection_version = projection_version + 1, updated_at = ?3 \
             WHERE page_block_id = ?4 AND view_id = ?5",
            params![group_key, rank_key, now, page.page_id, view_id,],
        )?;
        effects
            .revisions
            .insert(format!("position:{view_id}:{}", page.page_id), revision);
    }
    for page in pages {
        let metadata_revision = bump_page_metadata_revision(connection, &page.page_id, now)?;
        connection.execute(
            "UPDATE page_read_model SET metadata_revision = ?1, \
               projection_version = projection_version + 1, updated_at = ?2 \
             WHERE page_block_id = ?3",
            params![metadata_revision, now, page.page_id],
        )?;
        effects.page_ids.insert(page.page_id.clone());
        effects
            .revisions
            .insert(format!("page:{}:metadata", page.page_id), metadata_revision);
    }
    effects.database_ids.insert(view.database_id);
    effects.data_source_ids.insert(view.data_source_id);
    effects.view_ids.insert(view.id);
    Ok(())
}

fn validate_view_config(
    connection: &Connection,
    library_id: &str,
    project_id: &str,
    data_source_id: &str,
    config: &Value,
    library_scope: bool,
) -> Result<(), StoreError> {
    let object = config
        .as_object()
        .ok_or_else(|| invalid("Database View config must be an object"))?;
    let expected = [
        "schemaKey",
        "schemaVersion",
        "filter",
        "sort",
        "group",
        "display",
    ];
    if object.len() != expected.len() || expected.iter().any(|key| !object.contains_key(*key)) {
        return Err(invalid("Database View config has unsupported fields"));
    }
    if object.get("schemaKey").and_then(Value::as_str) != Some("nodex.database-view")
        || object.get("schemaVersion").and_then(Value::as_i64) != Some(2)
    {
        return Err(invalid("Database View config schema is unsupported"));
    }
    validate_view_filter(
        object
            .get("filter")
            .ok_or_else(|| invalid("Database View filter is missing"))?,
        0,
        &mut 0,
    )?;
    let sort = object
        .get("sort")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid("Database View sort must be an array"))?;
    if sort.len() > MAX_VIEW_SORT_RULES {
        return Err(invalid("Database View sort exceeds its bound"));
    }
    for item in sort {
        validate_view_sort(item)?;
    }
    match object.get("group") {
        Some(Value::Null) => {}
        Some(group)
            if group.as_object().is_some_and(|group| {
                group.len() == 1 && group.get("propertyId").and_then(Value::as_str).is_some()
            }) => {}
        _ => return Err(invalid("Database View group is invalid")),
    }
    let display = object
        .get("display")
        .and_then(Value::as_object)
        .ok_or_else(|| invalid("Database View display is invalid"))?;
    if display.len() != 2
        || display.get("showTitle").and_then(Value::as_bool).is_none()
        || !display
            .get("propertyIds")
            .and_then(Value::as_array)
            .is_some_and(|values| values.iter().all(Value::is_string))
    {
        return Err(invalid("Database View display is invalid"));
    }
    if display
        .get("propertyIds")
        .and_then(Value::as_array)
        .is_some_and(|values| values.len() > MAX_VIEW_DISPLAY_PROPERTIES)
    {
        return Err(invalid("Database View display exceeds its Property bound"));
    }
    let property_ids = collect_view_property_ids(config)?;
    let property_records = connection
        .prepare(
            "SELECT id, value_type FROM data_source_properties \
             WHERE data_source_id = ?1 AND lifecycle = 'active'",
        )?
        .query_map([data_source_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut property_capabilities = BTreeMap::new();
    for (property_id, value_type) in property_records {
        let schema = super::property_semantics::schema_from_storage(
            connection,
            data_source_id,
            &property_id,
            &value_type,
        )?;
        property_capabilities.insert(
            property_id,
            super::property_semantics::capabilities(&schema),
        );
    }
    if !property_ids
        .iter()
        .all(|property_id| property_capabilities.contains_key(property_id))
    {
        return Err(invalid(
            "Database View references a missing Data Source Property",
        ));
    }
    validate_view_property_capabilities(
        connection,
        library_id,
        project_id,
        data_source_id,
        config,
        &property_capabilities,
        library_scope,
    )
}

fn validate_view_property_capabilities(
    connection: &Connection,
    library_id: &str,
    project_id: &str,
    data_source_id: &str,
    config: &Value,
    property_capabilities: &BTreeMap<String, DatabasePropertyCapabilities>,
    library_scope: bool,
) -> Result<(), StoreError> {
    if view_group_property(config).is_some_and(|property_id| {
        property_capabilities
            .get(property_id)
            .is_some_and(|capabilities| !capabilities.groupable)
    }) {
        return Err(invalid("Property cannot group a Database View"));
    }
    let sort = config
        .get("sort")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid("Database View sort must be an array"))?;
    for rule in sort {
        let property_id = rule
            .get("field")
            .and_then(Value::as_object)
            .filter(|field| field.get("kind").and_then(Value::as_str) == Some("property"))
            .and_then(|field| field.get("propertyId"))
            .and_then(Value::as_str);
        if property_id.is_some_and(|property_id| {
            property_capabilities
                .get(property_id)
                .is_some_and(|capabilities| !capabilities.sortable)
        }) {
            return Err(invalid("Property cannot sort a Database View"));
        }
    }
    validate_filter_capabilities(
        connection,
        library_id,
        project_id,
        data_source_id,
        config
            .get("filter")
            .ok_or_else(|| invalid("Database View filter is missing"))?,
        property_capabilities,
        library_scope,
    )
}

fn validate_filter_capabilities(
    connection: &Connection,
    library_id: &str,
    project_id: &str,
    data_source_id: &str,
    filter: &Value,
    property_capabilities: &BTreeMap<String, DatabasePropertyCapabilities>,
    library_scope: bool,
) -> Result<(), StoreError> {
    let object = filter
        .as_object()
        .ok_or_else(|| invalid("Database View filter node must be an object"))?;
    if object.get("kind").and_then(Value::as_str) == Some("group") {
        for child in object
            .get("children")
            .and_then(Value::as_array)
            .ok_or_else(|| invalid("Database View filter group children are invalid"))?
        {
            validate_filter_capabilities(
                connection,
                library_id,
                project_id,
                data_source_id,
                child,
                property_capabilities,
                library_scope,
            )?;
        }
        return Ok(());
    }
    let property_id = object
        .get("propertyId")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("Database View filter clause is invalid"))?;
    let operator_name = object
        .get("operator")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("Database View filter clause is invalid"))?;
    let operator = match operator_name {
        "equals" => DatabasePropertyFilterOperator::Equals,
        "not_equals" => DatabasePropertyFilterOperator::NotEquals,
        "contains" => DatabasePropertyFilterOperator::Contains,
        "not_contains" => DatabasePropertyFilterOperator::NotContains,
        "is_empty" => DatabasePropertyFilterOperator::IsEmpty,
        "is_not_empty" => DatabasePropertyFilterOperator::IsNotEmpty,
        _ => return Err(invalid("Database View filter operator is unsupported")),
    };
    let capabilities = property_capabilities
        .get(property_id)
        .ok_or_else(|| invalid("Database View filter references a missing Property"))?;
    if !capabilities.filter_operators.contains(&operator) {
        return Err(invalid("Property filter operator is unsupported"));
    }
    if matches!(
        operator,
        DatabasePropertyFilterOperator::Contains | DatabasePropertyFilterOperator::NotContains
    ) && object
        .get("value")
        .and_then(Value::as_str)
        .is_none_or(str::is_empty)
    {
        return Err(invalid("Property membership filter requires an identity"));
    }
    if capabilities.patch_set_member
        == Some(nodex_core_contracts::database::DatabasePropertySetMemberKind::Page)
        && matches!(
            operator,
            DatabasePropertyFilterOperator::Contains | DatabasePropertyFilterOperator::NotContains
        )
    {
        let page_id = object
            .get("value")
            .and_then(Value::as_str)
            .ok_or_else(|| invalid("Relation Property filter requires a Page identity"))?;
        let target_data_source_id =
            super::relation::target_data_source_id(connection, data_source_id, property_id)?;
        authorize_relation_target_read(
            connection,
            library_id,
            project_id,
            &target_data_source_id,
            library_scope,
        )?;
        if !library_scope {
            crate::library::require_page_read_access(connection, library_id, project_id, page_id)?;
        }
        super::relation::validate_active_targets(
            connection,
            &target_data_source_id,
            &[page_id.to_owned()],
        )?;
    }
    Ok(())
}

fn validate_view_filter(value: &Value, depth: usize, nodes: &mut usize) -> Result<(), StoreError> {
    if depth > 8 || *nodes >= 1_024 {
        return Err(invalid("Database View filter exceeds its structural bound"));
    }
    *nodes += 1;
    let object = value
        .as_object()
        .ok_or_else(|| invalid("Database View filter node must be an object"))?;
    match object.get("kind").and_then(Value::as_str) {
        Some("group") => {
            if !matches!(
                object.get("operator").and_then(Value::as_str),
                Some("and" | "or")
            ) {
                return Err(invalid("Database View filter group operator is invalid"));
            }
            let children = object
                .get("children")
                .and_then(Value::as_array)
                .ok_or_else(|| invalid("Database View filter group children are invalid"))?;
            for child in children {
                validate_view_filter(child, depth + 1, nodes)?;
            }
            Ok(())
        }
        Some("clause") => {
            if object.get("propertyId").and_then(Value::as_str).is_none()
                || !matches!(
                    object.get("operator").and_then(Value::as_str),
                    Some(
                        "equals"
                            | "not_equals"
                            | "contains"
                            | "not_contains"
                            | "is_empty"
                            | "is_not_empty"
                    )
                )
            {
                return Err(invalid("Database View filter clause is invalid"));
            }
            Ok(())
        }
        _ => Err(invalid("Database View filter kind is invalid")),
    }
}

fn validate_view_sort(value: &Value) -> Result<(), StoreError> {
    let object = value
        .as_object()
        .ok_or_else(|| invalid("Database View sort item must be an object"))?;
    if !matches!(
        object.get("direction").and_then(Value::as_str),
        Some("asc" | "desc")
    ) || !matches!(
        object.get("nulls").and_then(Value::as_str),
        Some("first" | "last")
    ) {
        return Err(invalid(
            "Database View sort direction or null policy is invalid",
        ));
    }
    let field = object
        .get("field")
        .and_then(Value::as_object)
        .ok_or_else(|| invalid("Database View sort field is invalid"))?;
    match field.get("kind").and_then(Value::as_str) {
        Some("manual" | "title" | "created") if field.len() == 1 => Ok(()),
        Some("property")
            if field.len() == 2 && field.get("propertyId").and_then(Value::as_str).is_some() =>
        {
            Ok(())
        }
        _ => Err(invalid("Database View sort field is invalid")),
    }
}

fn collect_view_property_ids(config: &Value) -> Result<HashSet<String>, StoreError> {
    let mut property_ids = HashSet::new();
    if let Some(property_id) = view_group_property(config) {
        property_ids.insert(property_id.to_owned());
    }
    let display = config
        .pointer("/display/propertyIds")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid("Database View display Property IDs are invalid"))?;
    for property_id in display {
        property_ids.insert(
            property_id
                .as_str()
                .ok_or_else(|| invalid("Database View display Property ID is invalid"))?
                .to_owned(),
        );
    }
    if let Some(sort) = config.get("sort").and_then(Value::as_array) {
        for item in sort {
            if let Some(property_id) = item.pointer("/field/propertyId").and_then(Value::as_str) {
                property_ids.insert(property_id.to_owned());
            }
        }
    }
    collect_filter_property_ids(
        config
            .get("filter")
            .ok_or_else(|| invalid("Database View filter is missing"))?,
        &mut property_ids,
    )?;
    Ok(property_ids)
}

fn collect_filter_property_ids(
    value: &Value,
    property_ids: &mut HashSet<String>,
) -> Result<(), StoreError> {
    let object = value
        .as_object()
        .ok_or_else(|| invalid("Database View filter node is invalid"))?;
    if object.get("kind").and_then(Value::as_str) == Some("clause") {
        property_ids.insert(
            object
                .get("propertyId")
                .and_then(Value::as_str)
                .ok_or_else(|| invalid("Database View filter Property ID is invalid"))?
                .to_owned(),
        );
        return Ok(());
    }
    for child in object
        .get("children")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid("Database View filter children are invalid"))?
    {
        collect_filter_property_ids(child, property_ids)?;
    }
    Ok(())
}

fn view_group_property(config: &Value) -> Option<&str> {
    config.pointer("/group/propertyId").and_then(Value::as_str)
}

fn view_manual_direction(config: &Value) -> &str {
    config
        .get("sort")
        .and_then(Value::as_array)
        .and_then(|sort| {
            sort.iter()
                .find(|item| item.pointer("/field/kind").and_then(Value::as_str) == Some("manual"))
        })
        .and_then(|item| item.get("direction"))
        .and_then(Value::as_str)
        .unwrap_or("asc")
}

fn read_logical_group(
    connection: &Connection,
    view: &ViewRow,
    group_property_id: Option<&str>,
    group_key: Option<&str>,
    excluded_page_ids: &HashSet<&str>,
) -> Result<Vec<LogicalViewPositionItem>, StoreError> {
    let rows = connection
        .prepare(
            "SELECT membership.id, membership.page_block_id, position.rank_key \
             FROM data_source_page_memberships membership \
             JOIN pages page ON page.block_id = membership.page_block_id \
               AND page.parent_kind = 'data_source' AND page.parent_id = membership.data_source_id \
               AND page.lifecycle = 'active' \
             LEFT JOIN database_view_page_positions position \
               ON position.view_id = ?1 AND position.page_block_id = membership.page_block_id \
             WHERE membership.data_source_id = ?2 AND membership.removed_at IS NULL \
             ORDER BY CASE WHEN position.rank_key IS NULL THEN 1 ELSE 0 END, \
               position.rank_key, membership.page_block_id",
        )?
        .query_map(params![view.id, view.data_source_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut result = Vec::new();
    for (membership_id, page_id, rank_key) in rows {
        if excluded_page_ids.contains(page_id.as_str()) {
            continue;
        }
        if let Some(property_id) = group_property_id {
            let value = connection
                .query_row(
                    "SELECT value_json FROM data_source_property_values \
                     WHERE data_source_id = ?1 AND membership_id = ?2 AND property_id = ?3",
                    params![view.data_source_id, membership_id, property_id],
                    |row| row.get::<_, String>(0),
                )
                .optional()?
                .map(|value| parse_json(&value, "Grouped Property value"))
                .transpose()?;
            let effective = value.as_ref().map_or(Ok(None), database_group_key)?;
            if effective.as_deref() != group_key {
                continue;
            }
        }
        result.push(LogicalViewPositionItem { page_id, rank_key });
    }
    if view_manual_direction(&parse_json(&view.config_json, "Database View config")?) == "desc" {
        result.reverse();
    }
    Ok(result)
}

fn view_position_plan_error(error: ViewPositionPlanError) -> StoreError {
    match error {
        ViewPositionPlanError::InvalidInput(message)
        | ViewPositionPlanError::AnchorNotFound(message) => invalid(message),
        ViewPositionPlanError::FractionalRank(error) => invalid(error.message),
    }
}

fn active_row_membership(
    connection: &Connection,
    data_source_id: &str,
    page_id: &str,
) -> Result<String, StoreError> {
    connection
        .query_row(
            "SELECT membership.id FROM data_source_page_memberships membership \
             JOIN pages page ON page.block_id = membership.page_block_id \
             WHERE membership.data_source_id = ?1 AND membership.page_block_id = ?2 \
               AND membership.removed_at IS NULL AND page.parent_kind = 'data_source' \
               AND page.parent_id = ?1 AND page.lifecycle = 'active'",
            params![data_source_id, page_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or_else(|| not_found("Page is not an active row in the View Data Source"))
}

fn reorder_views(
    connection: &Connection,
    database_id: &str,
    view_id: &str,
    before_view_id: Option<&str>,
) -> Result<(), StoreError> {
    let items = connection
        .prepare(
            "SELECT id, rank_key FROM database_views WHERE database_block_id = ?1 \
             AND lifecycle = 'active' ORDER BY rank_key, id",
        )?
        .query_map([database_id], |row| {
            Ok(RankedItem {
                id: row.get(0)?,
                rank_key: row.get(1)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let plan = plan_fractional_rank(&items, view_id, before_view_id)
        .map_err(|error| rank_plan_error(error, "Database View placement anchor changed"))?;
    for (id, rank_key) in plan.rebalanced_rank_keys {
        connection.execute(
            "UPDATE database_views SET rank_key = ?1 WHERE database_block_id = ?2 AND id = ?3",
            params![rank_key, database_id, id],
        )?;
    }
    connection.execute(
        "UPDATE database_views SET rank_key = ?1 WHERE database_block_id = ?2 AND id = ?3",
        params![plan.rank_key, database_id, view_id],
    )?;
    Ok(())
}

fn clear_view_positions(
    connection: &Connection,
    view_id: &str,
    now: &str,
) -> Result<(), StoreError> {
    connection.execute(
        "DELETE FROM database_view_page_positions WHERE view_id = ?1",
        [view_id],
    )?;
    connection.execute(
        "UPDATE page_read_model SET view_group_key = NULL, view_rank_key = NULL, \
           projection_version = projection_version + 1, updated_at = ?1 WHERE view_id = ?2",
        params![now, view_id],
    )?;
    Ok(())
}

fn clear_view_projection(
    connection: &Connection,
    view_id: &str,
    now: &str,
) -> Result<(), StoreError> {
    connection.execute(
        "UPDATE page_read_model SET view_id = NULL, view_group_key = NULL, view_rank_key = NULL, \
           projection_version = projection_version + 1, updated_at = ?1 WHERE view_id = ?2",
        params![now, view_id],
    )?;
    Ok(())
}

fn refresh_default_view_projection(
    connection: &Connection,
    database_id: &str,
    now: &str,
) -> Result<(), StoreError> {
    let default_view = connection
        .query_row(
            "SELECT view.id, view.data_source_id FROM database_containers container \
             JOIN database_views view ON view.id = container.default_view_id \
             WHERE container.block_id = ?1 AND view.lifecycle = 'active'",
            [database_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;
    let projections = connection
        .prepare(
            "SELECT projection.page_block_id, membership.data_source_id \
             FROM page_read_model projection \
             LEFT JOIN data_source_page_memberships membership \
               ON membership.id = projection.membership_id AND membership.removed_at IS NULL \
             WHERE projection.database_block_id = ?1 ORDER BY projection.page_block_id",
        )?
        .query_map([database_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (page_id, data_source_id) in projections {
        let uses_default = default_view
            .as_ref()
            .is_some_and(|(_, source_id)| data_source_id.as_deref() == Some(source_id));
        let position = if uses_default {
            connection
                .query_row(
                    "SELECT group_key, rank_key FROM database_view_page_positions \
                     WHERE view_id = ?1 AND page_block_id = ?2",
                    params![default_view.as_ref().map(|(id, _)| id), page_id],
                    |row| Ok((row.get::<_, Option<String>>(0)?, row.get::<_, String>(1)?)),
                )
                .optional()?
        } else {
            None
        };
        connection.execute(
            "UPDATE page_read_model SET view_id = ?1, view_group_key = ?2, view_rank_key = ?3, \
               projection_version = projection_version + 1, updated_at = ?4 \
             WHERE page_block_id = ?5",
            params![
                uses_default
                    .then(|| default_view.as_ref().map(|(id, _)| id))
                    .flatten(),
                position
                    .as_ref()
                    .and_then(|(group_key, _)| group_key.as_deref()),
                position.as_ref().map(|(_, rank_key)| rank_key),
                now,
                page_id,
            ],
        )?;
    }
    Ok(())
}

fn require_container(
    connection: &Connection,
    library_id: &str,
    database_id: &str,
) -> Result<ContainerRow, StoreError> {
    connection
        .query_row(
            "SELECT default_view_id, lifecycle FROM database_containers \
             WHERE block_id = ?1 AND library_id = ?2",
            params![database_id, library_id],
            |row| {
                Ok(ContainerRow {
                    default_view_id: row.get(0)?,
                    lifecycle: row.get(1)?,
                })
            },
        )
        .optional()?
        .ok_or_else(|| not_found("Database is unavailable"))
}

fn view_row(connection: &Connection, view_id: &str) -> Result<Option<ViewRow>, StoreError> {
    connection
        .query_row(
            "SELECT id, database_block_id, data_source_id, config_json, rank_key, lifecycle, \
               revision, created_at FROM database_views WHERE id = ?1",
            [view_id],
            |row| {
                Ok(ViewRow {
                    id: row.get(0)?,
                    database_id: row.get(1)?,
                    data_source_id: row.get(2)?,
                    config_json: row.get(3)?,
                    rank_key: row.get(4)?,
                    lifecycle: row.get(5)?,
                    revision: row.get(6)?,
                    created_at: row.get(7)?,
                })
            },
        )
        .optional()
        .map_err(StoreError::from)
}

fn property_config_for_put(
    value_type: &str,
    existing: Option<&PropertyRow>,
) -> Result<Value, StoreError> {
    if let Some(existing) = existing {
        if existing.value_type != value_type {
            return Err(StoreError::new(
                StoreErrorCode::Conflict,
                "Property schema is immutable",
                false,
            ));
        }
        return parse_json(&existing.config_json, "Property config");
    }
    if matches!(value_type, "select" | "multi_select") {
        return Ok(json!({ "options": [] }));
    }
    Ok(json!({}))
}

fn reorder_properties(
    connection: &Connection,
    data_source_id: &str,
    property_id: &str,
    before_property_id: Option<&str>,
) -> Result<(), StoreError> {
    let items = connection
        .prepare(
            "SELECT id, rank_key FROM data_source_properties \
             WHERE data_source_id = ?1 AND lifecycle = 'active' ORDER BY rank_key, id",
        )?
        .query_map([data_source_id], |row| {
            Ok(RankedItem {
                id: row.get(0)?,
                rank_key: row.get(1)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let plan = plan_fractional_rank(&items, property_id, before_property_id)
        .map_err(|error| rank_plan_error(error, "Property placement anchor changed"))?;
    let mut update = connection.prepare(
        "UPDATE data_source_properties SET rank_key = ?1 \
         WHERE data_source_id = ?2 AND id = ?3",
    )?;
    for (id, rank_key) in plan.rebalanced_rank_keys {
        update.execute(params![rank_key, data_source_id, id])?;
    }
    update.execute(params![plan.rank_key, data_source_id, property_id])?;
    Ok(())
}

fn rank_plan_error(error: FractionalRankError, anchor_message: &str) -> StoreError {
    match error.code {
        FractionalRankErrorCode::AnchorNotFound => {
            StoreError::new(StoreErrorCode::RevisionConflict, anchor_message, true)
        }
        FractionalRankErrorCode::RebalanceLimit => invalid(&error.message),
    }
}

fn ensure_collection_capacity(
    active_count: i64,
    maximum: usize,
    label: &str,
) -> Result<(), StoreError> {
    if active_count < i64::try_from(maximum).unwrap_or(i64::MAX) {
        return Ok(());
    }
    Err(invalid(format!("{label} exceeds its fixed bound")))
}

fn active_view_references_property(
    connection: &Connection,
    data_source_id: &str,
    property_id: &str,
) -> Result<bool, StoreError> {
    let configs = connection
        .prepare(
            "SELECT config_json FROM database_views \
             WHERE data_source_id = ?1 AND lifecycle = 'active'",
        )?
        .query_map([data_source_id], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for config in configs {
        let config = parse_json(&config, "Database View config")?;
        if collect_view_property_ids(&config)?.contains(property_id) {
            return Ok(true);
        }
    }
    Ok(false)
}

fn active_page_schedule_value(
    connection: &Connection,
    page_id: &str,
    property_id: &str,
) -> Result<Option<String>, StoreError> {
    let value_json = connection
        .query_row(
            "SELECT value.value_json FROM pages page \
             JOIN data_source_page_memberships membership \
               ON membership.page_block_id = page.block_id \
               AND membership.data_source_id = page.parent_id \
               AND membership.removed_at IS NULL \
             JOIN data_source_properties property \
               ON property.data_source_id = membership.data_source_id \
               AND property.id = ?2 AND property.lifecycle = 'active' \
             LEFT JOIN data_source_property_values value \
               ON value.data_source_id = membership.data_source_id \
               AND value.membership_id = membership.id \
               AND value.property_id = property.id \
             WHERE page.block_id = ?1 AND page.parent_kind = 'data_source' \
             LIMIT 1",
            params![page_id, property_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()?
        .flatten();
    let Some(value_json) = value_json else {
        return Ok(None);
    };
    let value = parse_json(&value_json, "Scheduled Page Property value")?;
    if value.is_null() {
        return Ok(None);
    }
    value
        .as_str()
        .map(|value| Some(value.to_owned()))
        .ok_or_else(|| corrupt("Scheduled Page Property value is not a string"))
}

fn refresh_scheduled_page_indexes(
    connection: &Connection,
    page_ids: &BTreeSet<String>,
    now: &str,
) -> Result<(), StoreError> {
    for page_id in page_ids {
        let scheduled_start = active_page_schedule_value(connection, page_id, "scheduled_start")?;
        let scheduled_end = active_page_schedule_value(connection, page_id, "scheduled_end")?;
        let metadata_revision = connection
            .query_row(
                "SELECT metadata_revision FROM blocks WHERE id = ?1 AND type = 'page'",
                [page_id],
                |row| row.get::<_, i64>(0),
            )
            .optional()?;
        let Some(metadata_revision) = metadata_revision else {
            continue;
        };
        connection.execute(
            "UPDATE scheduled_page_index SET scheduled_start = ?1, scheduled_end = ?2, \
               is_all_day = CASE WHEN ?1 IS NOT NULL AND ?2 IS NOT NULL \
                 THEN is_all_day ELSE 0 END, source_metadata_revision = ?3, updated_at = ?4 \
             WHERE page_block_id = ?5",
            params![
                scheduled_start,
                scheduled_end,
                metadata_revision,
                now,
                page_id
            ],
        )?;
    }
    Ok(())
}

fn option_config(property: &PropertyRow) -> Result<OptionConfig, StoreError> {
    if !matches!(property.value_type.as_str(), "select" | "multi_select") {
        return Err(invalid("Property is not option-backed"));
    }
    let config = serde_json::from_str::<OptionConfig>(&property.config_json)
        .map_err(|_| corrupt("Property option registry is invalid"))?;
    if config.options.len() > super::MAX_PROPERTY_OPTIONS {
        return Err(corrupt("Property option registry exceeds its bound"));
    }
    let mut ids = HashSet::new();
    for option in &config.options {
        validate_id(&option.id, "option.id", MAX_PROPERTY_ID_LENGTH)
            .map_err(|_| corrupt("Stored Property option ID is invalid"))?;
        validate_name(&option.name, "option.name")
            .map_err(|_| corrupt("Stored Property option name is invalid"))?;
        if !ids.insert(option.id.as_str()) {
            return Err(corrupt("Property option registry repeats an ID"));
        }
    }
    Ok(config)
}

fn persist_option_config(
    connection: &Connection,
    source: &SourceRow,
    property: &PropertyRow,
    config: &OptionConfig,
    now: &str,
) -> Result<(), StoreError> {
    connection.execute(
        "UPDATE data_source_properties SET config_json = ?1, \
           schema_revision = schema_revision + 1, updated_at = ?2 \
         WHERE data_source_id = ?3 AND id = ?4",
        params![
            serde_json::to_string(config).map_err(|_| internal("Property option registry"))?,
            now,
            source.id,
            property.id,
        ],
    )?;
    connection.execute(
        "UPDATE data_sources SET schema_revision = schema_revision + 1, updated_at = ?1 \
         WHERE id = ?2",
        params![now, source.id],
    )?;
    Ok(())
}

pub(crate) fn normalize_value(property: &PropertyRow, value: &Value) -> Result<Value, StoreError> {
    if value.is_null() {
        return Ok(Value::Null);
    }
    match property.value_type.as_str() {
        "text" => value
            .as_str()
            .map(|value| Value::String(value.to_owned()))
            .ok_or_else(|| invalid("Property requires a string or null value")),
        "number" => value
            .as_f64()
            .filter(|value| value.is_finite())
            .map(|_| value.clone())
            .ok_or_else(|| invalid("number requires a finite number or null value")),
        "checkbox" => value
            .as_bool()
            .map(Value::Bool)
            .ok_or_else(|| invalid("checkbox requires a boolean or null value")),
        "date" => value
            .as_str()
            .filter(|value| valid_iso_date(value))
            .map(|value| Value::String(value.to_owned()))
            .ok_or_else(|| invalid("date requires a valid YYYY-MM-DD value or null")),
        "datetime" => value
            .as_str()
            .filter(|value| valid_canonical_datetime(value))
            .map(|value| Value::String(value.to_owned()))
            .ok_or_else(|| invalid("datetime requires a canonical UTC RFC 3339 value or null")),
        "select" => {
            let option_id = value
                .as_str()
                .ok_or_else(|| invalid("select requires an option ID or null"))?;
            let config = option_config(property)?;
            if config.options.iter().any(|option| option.id == option_id) {
                return Ok(Value::String(option_id.to_owned()));
            }
            Err(invalid("select references an unknown option"))
        }
        "multi_select" => {
            let values = value
                .as_array()
                .ok_or_else(|| invalid("multi_select requires an option ID array or null"))?;
            let config = option_config(property)?;
            let known = config
                .options
                .iter()
                .map(|option| option.id.as_str())
                .collect::<HashSet<_>>();
            let mut normalized = BTreeSet::new();
            for value in values {
                let option_id = value
                    .as_str()
                    .ok_or_else(|| invalid("multi_select contains a non-string option ID"))?;
                if !known.contains(option_id) {
                    return Err(invalid("multi_select references an unknown option"));
                }
                normalized.insert(option_id.to_owned());
            }
            Ok(Value::Array(
                normalized.into_iter().map(Value::String).collect(),
            ))
        }
        _ => Err(corrupt("Stored Property has an unsupported value type")),
    }
}

#[allow(clippy::too_many_arguments)]
fn update_grouped_positions(
    connection: &Connection,
    data_source_id: &str,
    property_id: &str,
    page_id: &str,
    value: &Value,
    now: &str,
    effects: &mut MutationEffects,
) -> Result<(), StoreError> {
    let views = connection
        .prepare(
            "SELECT id, config_json FROM database_views \
             WHERE data_source_id = ?1 AND lifecycle = 'active' ORDER BY id",
        )?
        .query_map([data_source_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (view_id, config) in views {
        let config = parse_json(&config, "Database View config")?;
        if config.pointer("/group/propertyId").and_then(Value::as_str) != Some(property_id) {
            continue;
        }
        let group_key = database_group_key(value)?;
        let revision = connection
            .query_row(
                "UPDATE database_view_page_positions SET group_key = ?1, \
                   revision = revision + 1, updated_at = ?2 \
                 WHERE view_id = ?3 AND page_block_id = ?4 RETURNING revision",
                params![group_key, now, view_id, page_id],
                |row| row.get::<_, i64>(0),
            )
            .optional()?;
        let Some(revision) = revision else {
            continue;
        };
        connection.execute(
            "UPDATE page_read_model SET view_group_key = ?1, \
               projection_version = projection_version + 1, updated_at = ?2 \
             WHERE page_block_id = ?3 AND view_id = ?4",
            params![group_key, now, page_id, view_id],
        )?;
        effects.view_ids.insert(view_id.clone());
        effects
            .revisions
            .insert(format!("position:{view_id}:{page_id}"), revision);
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn refresh_value_projection(
    connection: &Connection,
    page_id: &str,
    property_id: &str,
    value: &Value,
    value_revision: i64,
    metadata_revision: i64,
    property: &PropertyRow,
    now: &str,
) -> Result<(), StoreError> {
    let row = connection
        .query_row(
            "SELECT database_values_json, property_revisions_json \
             FROM page_read_model WHERE page_block_id = ?1",
            [page_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;
    let Some((values_json, revisions_json)) = row else {
        return Ok(());
    };
    let mut values = json_object(&values_json, "Page Database values")?;
    let mut revisions = json_object(&revisions_json, "Page Property revisions")?;
    let projected_value = if property.id == "tags" {
        tag_compatibility_value(property, value)?
    } else {
        value.clone()
    };
    values.insert(property_id.to_owned(), projected_value);
    let database = revisions
        .entry("database".to_owned())
        .or_insert_with(|| Value::Object(Map::new()))
        .as_object_mut()
        .ok_or_else(|| corrupt("Page Database revision projection is not an object"))?;
    database.insert(property_id.to_owned(), Value::from(value_revision));
    connection.execute(
        "UPDATE page_read_model SET metadata_revision = ?1, database_values_json = ?2, \
           property_revisions_json = ?3, projection_version = projection_version + 1, \
           updated_at = ?4 WHERE page_block_id = ?5",
        params![
            metadata_revision,
            serde_json::to_string(&values).map_err(|_| internal("Page Database values"))?,
            serde_json::to_string(&revisions).map_err(|_| internal("Page Property revisions"))?,
            now,
            page_id,
        ],
    )?;
    Ok(())
}

fn refresh_tag_projections(
    connection: &Connection,
    data_source_id: &str,
    config: &OptionConfig,
    now: &str,
    effects: &mut MutationEffects,
) -> Result<(), StoreError> {
    let rows = connection
        .prepare(
            "SELECT membership.page_block_id, value.value_json \
             FROM data_source_property_values value \
             JOIN data_source_page_memberships membership \
               ON membership.id = value.membership_id \
               AND membership.data_source_id = value.data_source_id \
             WHERE value.data_source_id = ?1 AND value.property_id = 'tags' \
               AND membership.removed_at IS NULL",
        )?
        .query_map([data_source_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let names = config
        .options
        .iter()
        .map(|option| (option.id.as_str(), option.name.as_str()))
        .collect::<std::collections::HashMap<_, _>>();
    for (page_id, value_json) in rows {
        let value = parse_json(&value_json, "Tags value")?;
        let Some(option_ids) = value.as_array() else {
            return Err(corrupt("Stored tags value is not an array"));
        };
        let projected = option_ids
            .iter()
            .map(|value| {
                let option_id = value
                    .as_str()
                    .ok_or_else(|| corrupt("Stored tags option is invalid"))?;
                names
                    .get(option_id)
                    .map(|name| Value::String((*name).to_owned()))
                    .ok_or_else(|| corrupt("Stored tags value references an unknown option"))
            })
            .collect::<Result<Vec<_>, _>>()?;
        let Some(values_json) = connection
            .query_row(
                "SELECT database_values_json FROM page_read_model WHERE page_block_id = ?1",
                [&page_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
        else {
            continue;
        };
        let mut values = json_object(&values_json, "Page Database values")?;
        if values.get("tags") == Some(&Value::Array(projected.clone())) {
            continue;
        }
        values.insert("tags".to_owned(), Value::Array(projected));
        let metadata_revision = bump_page_metadata_revision(connection, &page_id, now)?;
        connection.execute(
            "UPDATE page_read_model SET metadata_revision = ?1, \
               database_values_json = ?2, projection_version = projection_version + 1, \
               updated_at = ?3 WHERE page_block_id = ?4",
            params![
                metadata_revision,
                serde_json::to_string(&values).map_err(|_| internal("Page Database values"))?,
                now,
                page_id,
            ],
        )?;
        effects.page_ids.insert(page_id.clone());
        effects
            .revisions
            .insert(format!("page:{page_id}:metadata"), metadata_revision);
    }
    Ok(())
}

fn bump_page_metadata_revision(
    connection: &Connection,
    page_id: &str,
    now: &str,
) -> Result<i64, StoreError> {
    let metadata_revision = connection
        .query_row(
            "UPDATE blocks SET metadata_revision = metadata_revision + 1, updated_at = ?1 \
             WHERE id = ?2 AND type = 'page' RETURNING metadata_revision",
            params![now, page_id],
            |row| row.get::<_, i64>(0),
        )
        .optional()?
        .ok_or_else(|| corrupt("Database row Page disappeared during metadata commit"))?;
    let changed = connection.execute(
        "UPDATE pages SET metadata_revision = ?1, updated_at = ?2 WHERE block_id = ?3",
        params![metadata_revision, now, page_id],
    )?;
    if changed == 1 {
        return Ok(metadata_revision);
    }
    Err(corrupt(
        "Database row Page metadata authority disappeared during commit",
    ))
}

fn tag_compatibility_value(property: &PropertyRow, value: &Value) -> Result<Value, StoreError> {
    if value.is_null() {
        return Ok(Value::Null);
    }
    let config = option_config(property)?;
    let names = config
        .options
        .iter()
        .map(|option| (option.id.as_str(), option.name.as_str()))
        .collect::<std::collections::HashMap<_, _>>();
    let values = value
        .as_array()
        .ok_or_else(|| corrupt("Canonical tags value is not an array"))?;
    values
        .iter()
        .map(|value| {
            let option_id = value
                .as_str()
                .ok_or_else(|| corrupt("Canonical tags option is invalid"))?;
            names
                .get(option_id)
                .map(|name| Value::String((*name).to_owned()))
                .ok_or_else(|| corrupt("Canonical tags value references an unknown option"))
        })
        .collect::<Result<Vec<_>, _>>()
        .map(Value::Array)
}

fn database_group_key(value: &Value) -> Result<Option<String>, StoreError> {
    if value.is_null() || value.as_str() == Some("") || value.as_array().is_some_and(Vec::is_empty)
    {
        return Ok(None);
    }
    if let Some(value) = value.as_str() {
        return Ok(Some(value.to_owned()));
    }
    serde_json::to_string(value)
        .map(Some)
        .map_err(|_| internal("Database group key"))
}

#[allow(clippy::too_many_arguments)]
fn seal_commit(
    scope: &DurableMutationScope<'_>,
    context: &BoundModuleContext,
    request: &ModuleApplyRequest<Vec<DatabaseIntent>>,
    request_hash: &str,
    authority: &DatabaseMutationAuthority,
    now: &str,
    effects: MutationEffects,
) -> Result<
    SealedOutcome<crate::ModuleWriterResult<DatabaseCommitValue, DatabaseReceipt>>,
    StoreError,
> {
    let connection = scope.connection();
    let store_epoch = scope.store_epoch();
    let database_ids = effects.database_ids.into_iter().collect::<Vec<_>>();
    let data_source_ids = effects.data_source_ids.into_iter().collect::<Vec<_>>();
    let page_ids = effects.page_ids.into_iter().collect::<Vec<_>>();
    let view_ids = effects.view_ids.into_iter().collect::<Vec<_>>();
    let committed_revisions = effects.revisions;
    let operation_kinds = request
        .intent
        .iter()
        .map(database_intent_kind)
        .map(str::to_owned)
        .collect::<Vec<_>>();
    let block_ids = page_ids
        .iter()
        .chain(&database_ids)
        .cloned()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let payload = json!({
        "module": MODULE_NAME,
        "kind": "database_changed",
        "projectId": authority.project_id,
        "version": request.contract_version,
        "operationCount": request.intent.len(),
        "operationKinds": operation_kinds,
        "requestHash": request_hash,
        "databaseIds": database_ids,
        "dataSourceIds": data_source_ids,
        "pageIds": page_ids,
        "viewIds": view_ids,
        "committedRevisions": committed_revisions,
    });
    let event_payload = CoreModuleEventPayload::Database(DatabaseEvent {
        kind: DatabaseEventKind::DatabaseChanged,
        project_id: authority.project_id.clone(),
        database_ids: database_ids.clone(),
        data_source_ids: data_source_ids.clone(),
        page_ids: page_ids.clone(),
        view_ids: view_ids.clone(),
    });
    let projection_impact =
        expand_database_coordinates(connection, impact_for_payload(&event_payload)?)?;
    let payload_json =
        serde_json::to_string(&payload).map_err(|_| internal("Database event payload"))?;
    super::record_local_projection_delta(
        connection,
        scope.evidence(),
        &context.library_id.0,
        &projection_impact,
        &scope.authorization_before(),
    )?;
    if request
        .intent
        .iter()
        .any(|intent| matches!(intent, DatabaseIntent::TransferPage { .. }))
    {
        crate::infrastructure::resource_authorization::record_losses(
            connection,
            scope.evidence(),
            &scope.authorization_before(),
            nodex_core_contracts::ResourceRevocationReason::OwnershipMoved,
        )?;
    }
    let event_sequence = append_change_log(
        connection,
        NewChangeLogEntry {
            project_id: &authority.ledger_project_id,
            store_epoch,
            kind: "database.changed",
            operation_id: Some(&request.operation_id),
            block_ids: &block_ids,
            document_ids: &[],
            database_block_ids: &database_ids,
            payload_json: &payload_json,
            projection_impact: &projection_impact,
            committed_at: now,
        },
        scope.evidence(),
    )?;
    let receipt = DatabaseReceipt {
        mutation: ModuleMutationReceipt {
            operation_id: request.operation_id.clone(),
            duplicate: false,
        },
        affected_database_ids: database_ids.clone(),
        affected_data_source_ids: data_source_ids.clone(),
        affected_page_ids: page_ids.clone(),
        affected_view_ids: view_ids.clone(),
        operation_kinds,
        committed_revisions,
        commit_seq: scope.commit_seq(),
        committed_at: now.to_owned(),
    };
    let committed = crate::ModuleWriterResult {
        value: DatabaseCommitValue {
            operation_count: u32::try_from(request.intent.len())
                .map_err(|_| internal("Database operation count"))?,
        },
        receipt,
        commit_seq: scope.commit_seq(),
        event_sequence,
        store_epoch: StoreEpoch(store_epoch.to_owned()),
    };
    Ok(scope.seal(
        committed,
        ReceiptMetadata {
            operation_kind: "apply",
            event_sequence: Some(event_sequence),
            committed_at: now,
        },
    ))
}

fn require_source(
    connection: &Connection,
    library_id: &str,
    data_source_id: &str,
) -> Result<SourceRow, StoreError> {
    let source = connection
        .query_row(
            "SELECT id, home_database_block_id, lifecycle, schema_revision \
             FROM data_sources WHERE id = ?1 AND library_id = ?2",
            params![data_source_id, library_id],
            |row| {
                Ok(SourceRow {
                    id: row.get(0)?,
                    database_id: row.get(1)?,
                    lifecycle: row.get(2)?,
                    revision: row.get(3)?,
                })
            },
        )
        .optional()?
        .ok_or_else(|| not_found("Data Source is unavailable"))?;
    if source.lifecycle != "active" {
        return Err(not_found("Data Source is not active"));
    }
    Ok(source)
}

fn authorize_relation_target_read(
    connection: &Connection,
    library_id: &str,
    project_id: &str,
    target_data_source_id: &str,
    library_scope: bool,
) -> Result<(), StoreError> {
    let target = require_source(connection, library_id, target_data_source_id)?;
    if library_scope {
        return Ok(());
    }
    let primary =
        super::authorization::project_primary_database(connection, library_id, project_id)?;
    if super::authorization::authorize_database(
        connection,
        project_id,
        primary.as_deref(),
        &target.database_id,
    )? {
        return Ok(());
    }
    Err(not_found("Relation target is unavailable"))
}

fn property_row(
    connection: &Connection,
    data_source_id: &str,
    property_id: &str,
) -> Result<Option<PropertyRow>, StoreError> {
    connection
        .query_row(
            "SELECT id, value_type, config_json, rank_key, lifecycle, schema_revision, created_at \
             FROM data_source_properties WHERE data_source_id = ?1 AND id = ?2",
            params![data_source_id, property_id],
            |row| {
                Ok(PropertyRow {
                    id: row.get(0)?,
                    value_type: row.get(1)?,
                    config_json: row.get(2)?,
                    rank_key: row.get(3)?,
                    lifecycle: row.get(4)?,
                    revision: row.get(5)?,
                    created_at: row.get(6)?,
                })
            },
        )
        .optional()
        .map_err(StoreError::from)
}

pub(crate) fn active_property(
    connection: &Connection,
    data_source_id: &str,
    property_id: &str,
) -> Result<PropertyRow, StoreError> {
    let property = property_row(connection, data_source_id, property_id)?
        .ok_or_else(|| not_found("Property is unavailable"))?;
    if property.lifecycle != "active" {
        return Err(not_found("Property is not active"));
    }
    Ok(property)
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum DatabaseWriteAction {
    Write,
    ManageSchema,
    ManageViews,
}

fn authorize_write(
    connection: &Connection,
    project_id: &str,
    database_id: &str,
    action: DatabaseWriteAction,
    library_scope: bool,
) -> Result<(), StoreError> {
    if library_scope {
        return Ok(());
    }
    let project = connection
        .query_row(
            "SELECT database_block_id, lifecycle FROM projects WHERE id = ?1",
            [project_id],
            |row| Ok((row.get::<_, Option<String>>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?
        .ok_or_else(|| unauthorized("Project is unavailable"))?;
    if project.1 != "active" {
        return Err(unauthorized("Project is read-only"));
    }
    let primary = project.0.or(connection
        .query_row(
            "SELECT database_block_id FROM project_database_bindings \
                 WHERE project_id = ?1 AND lifecycle = 'active'",
            [project_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?);
    if primary.as_deref() == Some(database_id) {
        return Ok(());
    }
    if action != DatabaseWriteAction::Write {
        return Err(unauthorized(
            "Database schema and View management require the Project's primary Database",
        ));
    }
    let direct = connection
        .query_row(
            "SELECT 1 FROM project_resource_grants WHERE project_id = ?1 \
             AND root_kind = 'database' AND root_id = ?2 AND access = 'read_write' \
             AND lifecycle = 'active'",
            params![project_id, database_id],
            |_| Ok(()),
        )
        .optional()?;
    if direct.is_some() {
        return Ok(());
    }
    let document_id = connection
        .query_row(
            "SELECT containing_document_id FROM blocks WHERE id = ?1 AND type = 'database'",
            [database_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()?
        .flatten();
    let Some(document_id) = document_id else {
        return Err(unauthorized("Project cannot mutate this Database"));
    };
    let owner_page_id = connection
        .query_row(
            "SELECT page.block_id FROM block_documents ownership \
             JOIN pages page ON page.block_id = ownership.block_id \
             WHERE ownership.document_id = ?1",
            [document_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or_else(|| corrupt("Embedded Database has no owning Page"))?;
    let inherited = connection
        .query_row(
            "WITH RECURSIVE ancestors(page_id) AS (\
               SELECT ?2 UNION ALL SELECT page.parent_id FROM pages page JOIN ancestors current \
                 ON page.block_id = current.page_id WHERE page.parent_kind = 'page'\
             ) SELECT 1 FROM project_resource_grants grant_row JOIN ancestors \
               ON grant_row.root_id = ancestors.page_id \
             WHERE grant_row.project_id = ?1 AND grant_row.root_kind = 'page' \
               AND grant_row.access = 'read_write' AND grant_row.lifecycle = 'active' LIMIT 1",
            params![project_id, owner_page_id],
            |_| Ok(()),
        )
        .optional()?;
    if inherited.is_some() {
        return Ok(());
    }
    Err(unauthorized("Project cannot mutate this Database"))
}

fn mutation_authority(
    connection: &Connection,
    library_id: &str,
    context: &BoundModuleContext,
) -> Result<DatabaseMutationAuthority, StoreError> {
    if let Some(project_id) = context.project_id.as_ref() {
        let project_id = connection
            .query_row(
                "SELECT id FROM projects \
                 WHERE id = ?1 AND library_id = ?2 AND lifecycle = 'active'",
                params![project_id.0, library_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .ok_or_else(|| unauthorized("Bound Project is not active in this Library"))?;
        return Ok(DatabaseMutationAuthority {
            ledger_project_id: project_id.clone(),
            project_id: Some(project_id),
        });
    }
    if !is_trusted_library_database_context(context) {
        return Err(unauthorized(
            "Database mutations require a Project or trusted Library scope",
        ));
    }
    let ledger_project_id = connection
        .query_row(
            "SELECT id FROM projects WHERE library_id = ?1 ORDER BY created, id LIMIT 1",
            [library_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or_else(|| not_found("Local Library has no storage Project"))?;
    Ok(DatabaseMutationAuthority {
        ledger_project_id,
        project_id: None,
    })
}

fn assert_identity(
    connection: &Connection,
    profile_id: &str,
    library_id: &str,
) -> Result<(), StoreError> {
    let valid = connection
        .query_row(
            "SELECT 1 FROM libraries WHERE id = ?1 AND profile_id = ?2",
            params![library_id, profile_id],
            |_| Ok(()),
        )
        .optional()?;
    if valid.is_some() {
        return Ok(());
    }
    Err(unauthorized(
        "bound Database identity is not present in this Profile store",
    ))
}

fn touch_source(effects: &mut MutationEffects, source: &SourceRow) {
    effects.database_ids.insert(source.database_id.clone());
    effects.data_source_ids.insert(source.id.clone());
}

fn validate_id(value: &str, label: &str, maximum: usize) -> Result<(), StoreError> {
    if !value.trim().is_empty() && value.len() <= maximum {
        return Ok(());
    }
    Err(invalid(format!(
        "{label} must contain between 1 and {maximum} bytes"
    )))
}

fn validate_name<'a>(value: &'a str, label: &str) -> Result<&'a str, StoreError> {
    let value = value.trim();
    if !value.is_empty() && value.len() <= MAX_NAME_LENGTH {
        return Ok(value);
    }
    Err(invalid(format!(
        "{label} must contain between 1 and {MAX_NAME_LENGTH} bytes"
    )))
}

fn require_revision(expected: i64, actual: i64, message: &str) -> Result<(), StoreError> {
    if expected == actual {
        return Ok(());
    }
    Err(StoreError::new(
        StoreErrorCode::RevisionConflict,
        format!("{message}: expected {expected}, current {actual}"),
        true,
    ))
}

fn fractional_rank(ordinal: usize, total: usize) -> String {
    let divisor = (total + 1) as u128;
    let ordinal = ordinal as u128;
    let value = (u128::MAX / divisor) * ordinal + ((u128::MAX % divisor) * ordinal) / divisor;
    format!("{value:032x}")
}

fn valid_iso_date(value: &str) -> bool {
    if value.len() != 10 || &value[4..5] != "-" || &value[7..8] != "-" {
        return false;
    }
    let Ok(year) = value[0..4].parse::<u32>() else {
        return false;
    };
    let Ok(month) = value[5..7].parse::<u32>() else {
        return false;
    };
    let Ok(day) = value[8..10].parse::<u32>() else {
        return false;
    };
    let leap = year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400));
    let maximum = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    (1..=maximum).contains(&day)
}

fn valid_canonical_datetime(value: &str) -> bool {
    let Some((date, time)) = value.split_once('T') else {
        return false;
    };
    if !valid_iso_date(date) || !time.ends_with('Z') {
        return false;
    }
    let time = &time[..time.len() - 1];
    let Some((hour, rest)) = time.split_once(':') else {
        return false;
    };
    let Some((minute, second)) = rest.split_once(':') else {
        return false;
    };
    let (second, fraction) = second
        .split_once('.')
        .map_or((second, None), |(second, fraction)| {
            (second, Some(fraction))
        });
    hour.len() == 2
        && minute.len() == 2
        && second.len() == 2
        && hour.parse::<u32>().is_ok_and(|value| value < 24)
        && minute.parse::<u32>().is_ok_and(|value| value < 60)
        && second.parse::<u32>().is_ok_and(|value| value < 60)
        && fraction.is_none_or(|value| {
            !value.is_empty() && value.len() <= 9 && value.bytes().all(|byte| byte.is_ascii_digit())
        })
}

fn json_object(value: &str, label: &str) -> Result<Map<String, Value>, StoreError> {
    parse_json(value, label)?
        .as_object()
        .cloned()
        .ok_or_else(|| corrupt(format!("{label} is not an object")))
}

fn parse_json(value: &str, label: &str) -> Result<Value, StoreError> {
    serde_json::from_str(value).map_err(|_| corrupt(format!("{label} is invalid JSON")))
}

fn sqlite_now(connection: &Connection) -> Result<String, StoreError> {
    connection
        .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", [], |row| {
            row.get::<_, String>(0)
        })
        .map_err(StoreError::from)
}

fn invalid(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::InvalidInput, message, false)
}

fn not_found(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::NotFound, message, false)
}

fn unauthorized(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::Unauthorized, message, false)
}

fn corrupt(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message, false)
}

fn internal(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::Internal, message, false)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{collect_view_property_ids, ensure_collection_capacity};

    #[test]
    fn fixed_schema_collection_allows_the_last_slot_and_rejects_growth() {
        assert!(ensure_collection_capacity(199, 200, "schema").is_ok());
        let error = ensure_collection_capacity(200, 200, "schema")
            .expect_err("the fixed collection bound must reject another identity");
        assert_eq!(error.code, super::StoreErrorCode::InvalidInput);
    }

    #[test]
    fn view_property_references_ignore_filter_values() {
        let property_ids = collect_view_property_ids(&json!({
            "schemaKey": "nodex.database-view",
            "schemaVersion": 2,
            "filter": {
                "kind": "clause",
                "propertyId": "status",
                "operator": "equals",
                "value": "due_date"
            },
            "sort": [],
            "group": null,
            "display": { "propertyIds": [], "showTitle": true }
        }))
        .expect("valid View config");

        assert!(property_ids.contains("status"));
        assert!(!property_ids.contains("due_date"));
    }
}
