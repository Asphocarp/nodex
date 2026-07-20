use std::collections::{BTreeMap, BTreeSet, HashSet};

use chrono::{DateTime, SecondsFormat, Utc};
use nodex_core_contracts::automation::{PageRecurrenceConfig, PageReminderConfig};
use nodex_core_contracts::library::{
    LibraryBlockPropertyFieldMutation, LibraryBlockPropertyFieldResult,
    LibraryBlockPropertyMutation, LibraryBlockPropertyMutationError,
    LibraryBlockPropertyMutationErrorCode, LibraryBlockPropertyMutationOutcome,
    LibraryBlockPropertyMutationReceipt, LibraryCommitValue, LibraryReceipt,
};
use nodex_core_contracts::{
    AdapterKind, BoundModuleContext, CommittedModuleValue, ModuleMutationReceipt, StoreEpoch,
};
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Map, Value, json};

use crate::automation::{
    refresh_scheduled_index, validate_recurrence_input, validate_reminders_input,
    validate_timezone_input,
};
use crate::database::{
    PageValueProjectionEffects, active_property, authorize_page_value_write, normalize_value,
    refresh_page_value_projection,
};
use crate::document::sha256;
use crate::infrastructure::module_receipts::{NewModuleReceipt, insert_module_receipt};
use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};

use super::mutation::{MutationEffects, finish_mutation, refresh_page_intrinsic_projection};
use super::{LibraryApplyOutcome, require_page_write_access};

const MODULE_NAME: &str = "library";
const MUTATION_KIND: &str = "property_batch";
const MAX_ID_LENGTH: usize = 512;
const MAX_PROPERTY_KEY_LENGTH: usize = 128;
const MAX_FIELDS: usize = 256;
const MAX_SET_MEMBERS: usize = 10_000;
const MAX_ACTOR_BYTES: usize = 1_000_000;

const INTRINSIC_SCHEDULE_KEYS: [&str; 4] = [
    "schedule.isAllDay",
    "schedule.timezone",
    "recurrence.config",
    "reminders.config",
];

#[derive(Clone)]
struct PageAuthority {
    page_id: String,
    storage_project_id: String,
}

#[derive(Clone)]
struct PropertyDefinition {
    id: String,
    value_type: String,
}

#[derive(Clone)]
struct ResolvedIntrinsic {
    path: String,
    page: PageAuthority,
    property_key: String,
    value: Value,
    value_type: &'static str,
    current_revision: i64,
    current_value: Value,
}

#[derive(Clone)]
struct ResolvedDataSource {
    path: String,
    page: PageAuthority,
    data_source_id: String,
    membership_id: String,
    property: PropertyDefinition,
    operation: &'static str,
    value: Value,
    current_revision: i64,
    current_value: Value,
}

#[derive(Clone)]
enum ResolvedField {
    Intrinsic(ResolvedIntrinsic),
    DataSource(ResolvedDataSource),
}

impl ResolvedField {
    fn path(&self) -> &str {
        match self {
            Self::Intrinsic(field) => &field.path,
            Self::DataSource(field) => &field.path,
        }
    }

    fn page_id(&self) -> &str {
        match self {
            Self::Intrinsic(field) => &field.page.page_id,
            Self::DataSource(field) => &field.page.page_id,
        }
    }

    fn current_revision(&self) -> i64 {
        match self {
            Self::Intrinsic(field) => field.current_revision,
            Self::DataSource(field) => field.current_revision,
        }
    }

    fn current_value(&self) -> &Value {
        match self {
            Self::Intrinsic(field) => &field.current_value,
            Self::DataSource(field) => &field.current_value,
        }
    }
}

enum PropertyApplyError {
    Rejected(LibraryBlockPropertyMutationError),
    Store(StoreError),
}

impl From<rusqlite::Error> for PropertyApplyError {
    fn from(error: rusqlite::Error) -> Self {
        Self::Store(StoreError::from(error))
    }
}

impl From<StoreError> for PropertyApplyError {
    fn from(error: StoreError) -> Self {
        Self::Store(error)
    }
}

struct MutationEvidence {
    request_hash: String,
    request_json: String,
    actor_json: String,
    target_page_ids: Vec<String>,
    target_page_ids_json: String,
    database_ids: Vec<String>,
    database_ids_json: String,
    field_intents_json: String,
    expected_revisions_json: String,
}

pub(super) fn apply(
    connection: &Connection,
    context: &BoundModuleContext,
    store_epoch: &str,
    library_id: &str,
    operation_id: &str,
    core_request_hash: &str,
    mutation: &LibraryBlockPropertyMutation,
) -> Result<LibraryApplyOutcome, StoreError> {
    let now = sqlite_now(connection)?;
    let ledger_project_id = ledger_project_id(connection, context, library_id)?;
    let evidence = match validate_request(
        connection,
        context,
        library_id,
        &ledger_project_id,
        store_epoch,
        operation_id,
        mutation,
    ) {
        Ok(evidence) => evidence,
        Err(PropertyApplyError::Rejected(error)) => {
            let evidence =
                minimal_evidence(&ledger_project_id, store_epoch, operation_id, mutation)?;
            persist_property_ledger(
                connection,
                &ledger_project_id,
                store_epoch,
                operation_id,
                mutation.client_session_id.as_deref(),
                &evidence,
                "rejected",
                &public_error_json(operation_id, &error),
                &json!({}),
                None,
                &now,
            )?;
            return finish_rejection(
                connection,
                context,
                store_epoch,
                operation_id,
                core_request_hash,
                error,
                &now,
            );
        }
        Err(PropertyApplyError::Store(error)) => return Err(error),
    };

    if let Some(collision) = read_ledger_collision(
        connection,
        &ledger_project_id,
        store_epoch,
        operation_id,
        mutation.client_session_id.as_deref(),
        &evidence,
    )? {
        return finish_rejection(
            connection,
            context,
            store_epoch,
            operation_id,
            core_request_hash,
            collision,
            &now,
        );
    }

    let resolved = match resolve_fields(connection, context, library_id, operation_id, mutation) {
        Ok(fields) => fields,
        Err(PropertyApplyError::Rejected(error)) => {
            persist_property_ledger(
                connection,
                &ledger_project_id,
                store_epoch,
                operation_id,
                mutation.client_session_id.as_deref(),
                &evidence,
                "rejected",
                &public_error_json(operation_id, &error),
                &json!({}),
                None,
                &now,
            )?;
            return finish_rejection(
                connection,
                context,
                store_epoch,
                operation_id,
                core_request_hash,
                error,
                &now,
            );
        }
        Err(PropertyApplyError::Store(error)) => return Err(error),
    };

    let field_results = resolved
        .iter()
        .map(|field| persist_field(connection, operation_id, field, &now))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| match error {
            PropertyApplyError::Rejected(error) => {
                StoreError::new(StoreErrorCode::RevisionConflict, error.message, false)
            }
            PropertyApplyError::Store(error) => error,
        })?;

    let block_metadata_revisions =
        bump_page_metadata_revisions(connection, operation_id, &evidence.target_page_ids, &now)?;
    let mut affected_view_ids = BTreeSet::new();
    let mut projection_revisions = BTreeMap::new();
    let intrinsic_pages = resolved
        .iter()
        .filter_map(|field| match field {
            ResolvedField::Intrinsic(field) => Some((
                field.page.page_id.clone(),
                field.page.storage_project_id.clone(),
            )),
            ResolvedField::DataSource(_) => None,
        })
        .collect::<BTreeSet<_>>();
    for (page_id, storage_project_id) in intrinsic_pages {
        refresh_page_intrinsic_projection(connection, &page_id, &storage_project_id, &now)?;
        connection.execute(
            "UPDATE page_read_model SET metadata_revision = ?1, \
               projection_version = projection_version + 1, updated_at = ?2 \
             WHERE page_block_id = ?3",
            params![block_metadata_revisions[&page_id], now, page_id],
        )?;
    }
    for (resolved_field, result) in resolved.iter().zip(&field_results) {
        let ResolvedField::DataSource(field) = resolved_field else {
            continue;
        };
        let revision = field_result_revision(result);
        let effects: PageValueProjectionEffects = refresh_page_value_projection(
            connection,
            &field.page.page_id,
            &field.data_source_id,
            &field.property.id,
            &field.value,
            revision,
            block_metadata_revisions[&field.page.page_id],
            &now,
        )?;
        affected_view_ids.extend(effects.view_ids);
        projection_revisions.extend(effects.committed_revisions);
    }
    for page_id in schedule_pages(&resolved) {
        refresh_scheduled_index(connection, &page_id, &now)?;
    }

    let outcome = LibraryBlockPropertyMutationOutcome::Committed {
        fields: field_results.clone(),
        block_metadata_revisions: block_metadata_revisions.clone(),
    };
    let mut committed_revisions = projection_revisions;
    committed_revisions.extend(field_results.iter().map(|result| {
        (
            field_result_path(result).to_owned(),
            field_result_revision(result),
        )
    }));
    committed_revisions.extend(
        block_metadata_revisions
            .iter()
            .map(|(page_id, revision)| (format!("page:{page_id}:metadata"), *revision)),
    );
    let outcome_receipt = LibraryBlockPropertyMutationReceipt { outcome };
    let change_payload = change_payload(
        &evidence,
        &resolved,
        &field_results,
        &block_metadata_revisions,
    );
    let result = finish_mutation(
        connection,
        context,
        store_epoch,
        operation_id,
        core_request_hash,
        MutationEffects {
            project_id: ledger_project_id.clone(),
            operation_kind: MUTATION_KIND,
            change_kind: "block_mutation",
            did_mutate: true,
            created_target: None,
            affected_parent_keys: Vec::new(),
            affected_block_ids: evidence.target_page_ids.clone(),
            affected_page_ids: evidence.target_page_ids.clone(),
            affected_database_ids: evidence.database_ids.clone(),
            affected_view_ids: affected_view_ids.into_iter().collect(),
            affected_document_ids: Vec::new(),
            committed_revisions,
            page_copy: None,
            block_transfer: None,
            page_lifecycle: None,
            block_property_mutation: Some(outcome_receipt),
            agent_page_copy: None,
            agent_create_pages: None,
            agent_move_pages: None,
            change_payload: Some(change_payload),
            committed_at: now.clone(),
        },
    )?;
    let change_log_seq = result.committed.receipt.change_log_seq;
    let public_result = public_success_json(
        operation_id,
        &ledger_project_id,
        store_epoch,
        &field_results,
        &block_metadata_revisions,
        change_log_seq,
        &now,
    );
    persist_property_ledger(
        connection,
        &ledger_project_id,
        store_epoch,
        operation_id,
        mutation.client_session_id.as_deref(),
        &evidence,
        "committed",
        &public_result,
        &Value::Object(
            field_results
                .iter()
                .map(|field| {
                    (
                        field_result_path(field).to_owned(),
                        Value::from(field_result_revision(field)),
                    )
                })
                .collect(),
        ),
        Some(change_log_seq),
        &now,
    )?;
    Ok(result)
}

#[allow(clippy::too_many_arguments)]
fn validate_request(
    connection: &Connection,
    context: &BoundModuleContext,
    library_id: &str,
    project_id: &str,
    store_epoch: &str,
    operation_id: &str,
    mutation: &LibraryBlockPropertyMutation,
) -> Result<MutationEvidence, PropertyApplyError> {
    validate_id(operation_id, "mutationId")?;
    if mutation.fields.is_empty() || mutation.fields.len() > MAX_FIELDS {
        return Err(rejected(
            LibraryBlockPropertyMutationErrorCode::InvalidPropertyMutationRequest,
            format!("Property mutation requires 1-{MAX_FIELDS} fields"),
            None,
            None,
            None,
        ));
    }
    if !mutation.actor.is_object() || canonical_json(&mutation.actor)?.len() > MAX_ACTOR_BYTES {
        return Err(rejected(
            LibraryBlockPropertyMutationErrorCode::InvalidPropertyMutationRequest,
            "Property mutation actor must be a bounded JSON object",
            None,
            None,
            None,
        ));
    }
    if let Some(client_session_id) = &mutation.client_session_id {
        validate_id(client_session_id, "clientSessionId")?;
    }
    let mut paths = BTreeSet::new();
    for field in &mutation.fields {
        let path = mutation_path(field)?;
        if !paths.insert(path.clone()) {
            return Err(rejected(
                LibraryBlockPropertyMutationErrorCode::InvalidPropertyMutationRequest,
                "Property mutation contains a duplicate field path",
                Some(path),
                None,
                None,
            ));
        }
        validate_field_shape(field, &path)?;
    }
    let mut database_ids = BTreeSet::new();
    for field in &mutation.fields {
        let (LibraryBlockPropertyFieldMutation::DataSourceSet { data_source_id, .. }
        | LibraryBlockPropertyFieldMutation::DataSourceAddRemove { data_source_id, .. }) = field
        else {
            continue;
        };
        if let Some(database_id) = connection
            .query_row(
                "SELECT home_database_block_id FROM data_sources \
                 WHERE id = ?1 AND library_id = ?2",
                params![data_source_id, library_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
        {
            database_ids.insert(database_id);
        }
    }
    make_evidence(
        context,
        project_id,
        store_epoch,
        operation_id,
        mutation,
        database_ids.into_iter().collect(),
    )
    .map_err(PropertyApplyError::Store)
}

fn validate_field_shape(
    field: &LibraryBlockPropertyFieldMutation,
    path: &str,
) -> Result<(), PropertyApplyError> {
    match field {
        LibraryBlockPropertyFieldMutation::IntrinsicSet {
            block_id,
            property_key,
            expected_revision,
            ..
        } => {
            validate_id(block_id, "blockId")?;
            validate_property_id(property_key, "propertyKey")?;
            validate_revision(*expected_revision, path)?;
        }
        LibraryBlockPropertyFieldMutation::DataSourceSet {
            page_id,
            data_source_id,
            property_id,
            expected_revision,
            ..
        } => {
            validate_id(page_id, "pageId")?;
            validate_id(data_source_id, "dataSourceId")?;
            validate_property_id(property_id, "propertyId")?;
            validate_revision(*expected_revision, path)?;
        }
        LibraryBlockPropertyFieldMutation::DataSourceAddRemove {
            page_id,
            data_source_id,
            property_id,
            add,
            remove,
        } => {
            validate_id(page_id, "pageId")?;
            validate_id(data_source_id, "dataSourceId")?;
            validate_property_id(property_id, "propertyId")?;
            if add.is_empty() && remove.is_empty() {
                return Err(rejected(
                    LibraryBlockPropertyMutationErrorCode::InvalidPropertyMutationRequest,
                    "add_remove must add or remove at least one option",
                    Some(path.to_owned()),
                    None,
                    None,
                ));
            }
            if add.len() > MAX_SET_MEMBERS || remove.len() > MAX_SET_MEMBERS {
                return Err(rejected(
                    LibraryBlockPropertyMutationErrorCode::InvalidPropertyMutationRequest,
                    "add_remove exceeds the option-set bound",
                    Some(path.to_owned()),
                    None,
                    None,
                ));
            }
            let add_set = add.iter().collect::<HashSet<_>>();
            let remove_set = remove.iter().collect::<HashSet<_>>();
            if add_set.len() != add.len()
                || remove_set.len() != remove.len()
                || add_set.iter().any(|option| remove_set.contains(option))
            {
                return Err(rejected(
                    LibraryBlockPropertyMutationErrorCode::InvalidPropertyMutationRequest,
                    "add_remove option sets must be unique and disjoint",
                    Some(path.to_owned()),
                    None,
                    None,
                ));
            }
            for option_id in add.iter().chain(remove) {
                validate_id(option_id, "optionId")?;
            }
        }
    }
    Ok(())
}

fn resolve_fields(
    connection: &Connection,
    context: &BoundModuleContext,
    library_id: &str,
    operation_id: &str,
    mutation: &LibraryBlockPropertyMutation,
) -> Result<Vec<ResolvedField>, PropertyApplyError> {
    let mut fields = mutation
        .fields
        .iter()
        .map(|field| match field {
            LibraryBlockPropertyFieldMutation::IntrinsicSet { .. } => {
                resolve_intrinsic(connection, context, library_id, operation_id, field)
            }
            LibraryBlockPropertyFieldMutation::DataSourceSet { .. }
            | LibraryBlockPropertyFieldMutation::DataSourceAddRemove { .. } => {
                resolve_data_source(connection, context, library_id, operation_id, field)
            }
        })
        .collect::<Result<Vec<_>, _>>()?;
    fields.sort_by(|left, right| left.path().cmp(right.path()));
    validate_schedule_after_mutation(connection, operation_id, &fields)?;
    Ok(fields)
}

fn resolve_intrinsic(
    connection: &Connection,
    context: &BoundModuleContext,
    library_id: &str,
    operation_id: &str,
    mutation: &LibraryBlockPropertyFieldMutation,
) -> Result<ResolvedField, PropertyApplyError> {
    let LibraryBlockPropertyFieldMutation::IntrinsicSet {
        block_id,
        property_key,
        expected_revision,
        value,
    } = mutation
    else {
        unreachable!("intrinsic resolver receives intrinsic mutation")
    };
    let path = mutation_path(mutation)?;
    let page = active_page(connection, library_id, operation_id, block_id, &path)?;
    authorize_page(connection, context, library_id, &page, &path)?;
    validate_intrinsic_value(property_key, value, &path)?;
    let current = connection
        .query_row(
            "SELECT value_type, value_json, revision FROM block_properties \
             WHERE block_id = ?1 AND project_id = ?2 AND property_key = ?3",
            params![block_id, page.storage_project_id, property_key],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )
        .optional()?;
    let (current_revision, current_value) = match current {
        Some((_value_type, value_json, revision)) => {
            let parsed = parse_canonical_json(&value_json, &path)?;
            (revision, parsed)
        }
        None => (0, Value::Null),
    };
    if current_revision != *expected_revision {
        return Err(rejected(
            LibraryBlockPropertyMutationErrorCode::PropertyConflict,
            format!("Property {path} is at revision {current_revision}, not {expected_revision}"),
            Some(path),
            Some(*expected_revision),
            Some(current_revision),
        ));
    }
    Ok(ResolvedField::Intrinsic(ResolvedIntrinsic {
        path,
        page,
        property_key: property_key.clone(),
        value: value.clone(),
        value_type: intrinsic_value_type(value),
        current_revision,
        current_value,
    }))
}

fn resolve_data_source(
    connection: &Connection,
    context: &BoundModuleContext,
    library_id: &str,
    operation_id: &str,
    mutation: &LibraryBlockPropertyFieldMutation,
) -> Result<ResolvedField, PropertyApplyError> {
    let (page_id, data_source_id, property_id, operation) = match mutation {
        LibraryBlockPropertyFieldMutation::DataSourceSet {
            page_id,
            data_source_id,
            property_id,
            ..
        } => (page_id, data_source_id, property_id, "set"),
        LibraryBlockPropertyFieldMutation::DataSourceAddRemove {
            page_id,
            data_source_id,
            property_id,
            ..
        } => (page_id, data_source_id, property_id, "add_remove"),
        LibraryBlockPropertyFieldMutation::IntrinsicSet { .. } => {
            unreachable!("Data Source resolver receives Data Source mutation")
        }
    };
    let path = mutation_path(mutation)?;
    let page = active_page(connection, library_id, operation_id, page_id, &path)?;
    authorize_page(connection, context, library_id, &page, &path)?;
    let source = connection
        .query_row(
            "SELECT source.home_database_block_id, source.lifecycle, \
               container.lifecycle, block.lifecycle, block.type \
             FROM data_sources source \
             JOIN database_containers container ON container.block_id = source.home_database_block_id \
             JOIN blocks block ON block.id = container.block_id \
             WHERE source.id = ?1 AND source.library_id = ?2",
            params![data_source_id, library_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            },
        )
        .optional()?;
    let Some((database_id, source_lifecycle, container_lifecycle, block_lifecycle, block_type)) =
        source
    else {
        return Err(rejected(
            LibraryBlockPropertyMutationErrorCode::DataSourceNotFound,
            format!("Active Data Source is unavailable: {data_source_id}"),
            Some(path),
            None,
            None,
        ));
    };
    if source_lifecycle != "active"
        || container_lifecycle != "active"
        || block_lifecycle != "active"
        || block_type != "database"
    {
        return Err(rejected(
            LibraryBlockPropertyMutationErrorCode::DataSourceNotFound,
            format!("Active Data Source is unavailable: {data_source_id}"),
            Some(path),
            None,
            None,
        ));
    }
    let library_scope = context.project_id.is_none();
    let requesting_project_id = context
        .project_id
        .as_ref()
        .map_or(page.storage_project_id.as_str(), |project| {
            project.0.as_str()
        });
    if authorize_page_value_write(
        connection,
        requesting_project_id,
        &database_id,
        library_scope,
    )
    .is_err()
    {
        return Err(rejected(
            LibraryBlockPropertyMutationErrorCode::DataSourceNotFound,
            format!("Writable Data Source is unavailable: {data_source_id}"),
            Some(path),
            None,
            None,
        ));
    }
    let membership = connection
        .query_row(
            "SELECT membership.id FROM data_source_page_memberships membership \
             JOIN pages page ON page.block_id = membership.page_block_id \
             WHERE membership.page_block_id = ?1 AND membership.data_source_id = ?2 \
               AND membership.removed_at IS NULL AND page.parent_kind = 'data_source' \
               AND page.parent_id = ?2",
            params![page_id, data_source_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    let Some(membership_id) = membership else {
        return Err(rejected(
            LibraryBlockPropertyMutationErrorCode::MembershipNotFound,
            format!(
                "Page {page_id} requires exactly one active membership in Data Source {data_source_id}"
            ),
            Some(path),
            None,
            None,
        ));
    };
    let property = match active_property(connection, data_source_id, property_id) {
        Ok(property) => property,
        Err(_) => {
            return Err(rejected(
                LibraryBlockPropertyMutationErrorCode::PropertyNotFound,
                format!("Active Property {property_id} is outside Data Source {data_source_id}"),
                Some(path),
                None,
                None,
            ));
        }
    };
    let supported = match mutation {
        LibraryBlockPropertyFieldMutation::DataSourceSet { .. } => matches!(
            property.value_type.as_str(),
            "text" | "select" | "date" | "datetime" | "person"
        ),
        LibraryBlockPropertyFieldMutation::DataSourceAddRemove { .. } => {
            property.value_type == "multi_select"
        }
        LibraryBlockPropertyFieldMutation::IntrinsicSet { .. } => false,
    };
    if !supported {
        return Err(rejected(
            LibraryBlockPropertyMutationErrorCode::PropertyTypeMismatch,
            format!(
                "Operation {operation} cannot mutate {} Property {path}",
                property.value_type
            ),
            Some(path),
            None,
            None,
        ));
    }
    let current = connection
        .query_row(
            "SELECT value_type, value_json, revision FROM data_source_property_values \
             WHERE data_source_id = ?1 AND membership_id = ?2 AND property_id = ?3",
            params![data_source_id, membership_id, property_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            },
        )
        .optional()?;
    let (current_revision, current_value) = match current {
        Some((value_type, value_json, revision)) => {
            if value_type != property.value_type {
                return Err(rejected(
                    LibraryBlockPropertyMutationErrorCode::PropertyValueCorrupt,
                    format!("Stored Property {path} type diverges from its definition"),
                    Some(path),
                    None,
                    None,
                ));
            }
            let parsed = parse_canonical_json(&value_json, &path)?;
            let normalized = normalize_value(&property, &parsed).map_err(|_| {
                rejected(
                    LibraryBlockPropertyMutationErrorCode::PropertyValueCorrupt,
                    format!("Stored Property {path} value is invalid"),
                    Some(path.clone()),
                    None,
                    None,
                )
            })?;
            if canonical_json(&normalized)? != value_json {
                return Err(rejected(
                    LibraryBlockPropertyMutationErrorCode::PropertyValueCorrupt,
                    format!("Stored Property {path} is not canonical"),
                    Some(path),
                    None,
                    None,
                ));
            }
            (revision, normalized)
        }
        None if property.value_type == "multi_select" => (0, Value::Array(Vec::new())),
        None => (0, Value::Null),
    };
    let value = match mutation {
        LibraryBlockPropertyFieldMutation::DataSourceSet {
            expected_revision,
            value,
            ..
        } => {
            if current_revision != *expected_revision {
                return Err(rejected(
                    LibraryBlockPropertyMutationErrorCode::PropertyConflict,
                    format!(
                        "Property {path} is at revision {current_revision}, not {expected_revision}"
                    ),
                    Some(path),
                    Some(*expected_revision),
                    Some(current_revision),
                ));
            }
            if property.id == "status" && value.is_none()
                || value
                    .as_ref()
                    .is_some_and(|value| value.is_empty() || value.trim() != value)
                || property.id == "assignee"
                    && value.as_ref().is_some_and(|value| value.len() > 256)
            {
                return Err(rejected(
                    LibraryBlockPropertyMutationErrorCode::PropertyValueInvalid,
                    format!("Property {path} requires a canonical non-empty value"),
                    Some(path),
                    None,
                    None,
                ));
            }
            normalize_value(
                &property,
                &value
                    .as_ref()
                    .map_or(Value::Null, |value| Value::String(value.clone())),
            )
            .map_err(|error| {
                rejected(
                    LibraryBlockPropertyMutationErrorCode::PropertyValueInvalid,
                    format!(
                        "Submitted Property {path} value is invalid: {}",
                        error.message
                    ),
                    Some(path.clone()),
                    None,
                    None,
                )
            })?
        }
        LibraryBlockPropertyFieldMutation::DataSourceAddRemove { add, remove, .. } => {
            let mut selected = current_value
                .as_array()
                .ok_or_else(|| {
                    rejected(
                        LibraryBlockPropertyMutationErrorCode::PropertyValueCorrupt,
                        format!("Stored Property {path} is not an option set"),
                        Some(path.clone()),
                        None,
                        None,
                    )
                })?
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect::<BTreeSet<_>>();
            for option in remove {
                selected.remove(option);
            }
            selected.extend(add.iter().cloned());
            normalize_value(
                &property,
                &Value::Array(selected.into_iter().map(Value::String).collect()),
            )
            .map_err(|error| {
                rejected(
                    LibraryBlockPropertyMutationErrorCode::PropertyValueInvalid,
                    format!(
                        "Submitted Property {path} value is invalid: {}",
                        error.message
                    ),
                    Some(path.clone()),
                    None,
                    None,
                )
            })?
        }
        LibraryBlockPropertyFieldMutation::IntrinsicSet { .. } => unreachable!(),
    };
    Ok(ResolvedField::DataSource(ResolvedDataSource {
        path,
        page,
        data_source_id: data_source_id.clone(),
        membership_id,
        property: PropertyDefinition {
            id: property.id,
            value_type: property.value_type,
        },
        operation,
        value,
        current_revision,
        current_value,
    }))
}

fn persist_field(
    connection: &Connection,
    operation_id: &str,
    field: &ResolvedField,
    now: &str,
) -> Result<LibraryBlockPropertyFieldResult, PropertyApplyError> {
    match field {
        ResolvedField::Intrinsic(field) => {
            let next_revision = field.current_revision + 1;
            let value_json = canonical_json(&field.value)?;
            let changes = if field.current_revision == 0 {
                connection.execute(
                    "INSERT INTO block_properties( \
                       block_id, project_id, property_key, value_type, value_json, revision, updated_at \
                     ) VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6)",
                    params![
                        field.page.page_id,
                        field.page.storage_project_id,
                        field.property_key,
                        field.value_type,
                        value_json,
                        now,
                    ],
                )?
            } else {
                connection.execute(
                    "UPDATE block_properties SET value_type = ?1, value_json = ?2, \
                       revision = revision + 1, updated_at = ?3 \
                     WHERE block_id = ?4 AND project_id = ?5 AND property_key = ?6 \
                       AND revision = ?7",
                    params![
                        field.value_type,
                        value_json,
                        now,
                        field.page.page_id,
                        field.page.storage_project_id,
                        field.property_key,
                        field.current_revision,
                    ],
                )?
            };
            if changes != 1 {
                return Err(rejected(
                    LibraryBlockPropertyMutationErrorCode::PropertyConflict,
                    format!("Property {} changed while committing", field.path),
                    Some(field.path.clone()),
                    Some(field.current_revision),
                    Some(next_revision),
                ));
            }
            Ok(LibraryBlockPropertyFieldResult::Intrinsic {
                path: field.path.clone(),
                block_id: field.page.page_id.clone(),
                property_key: field.property_key.clone(),
                operation: "set".to_owned(),
                revision: next_revision,
                value: field.value.clone(),
            })
        }
        ResolvedField::DataSource(field) => {
            let next_revision = field.current_revision + 1;
            let value_json = canonical_json(&field.value)?;
            let changes = if field.current_revision == 0 {
                connection.execute(
                    "INSERT INTO data_source_property_values( \
                       data_source_id, membership_id, property_id, value_type, value_json, \
                       revision, updated_at \
                     ) VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6)",
                    params![
                        field.data_source_id,
                        field.membership_id,
                        field.property.id,
                        field.property.value_type,
                        value_json,
                        now,
                    ],
                )?
            } else {
                connection.execute(
                    "UPDATE data_source_property_values SET value_json = ?1, \
                       revision = revision + 1, updated_at = ?2 \
                     WHERE data_source_id = ?3 AND membership_id = ?4 AND property_id = ?5 \
                       AND value_type = ?6 AND revision = ?7",
                    params![
                        value_json,
                        now,
                        field.data_source_id,
                        field.membership_id,
                        field.property.id,
                        field.property.value_type,
                        field.current_revision,
                    ],
                )?
            };
            if changes != 1 {
                return Err(rejected(
                    LibraryBlockPropertyMutationErrorCode::PropertyConflict,
                    format!("Property {} changed while committing", field.path),
                    Some(field.path.clone()),
                    Some(field.current_revision),
                    Some(next_revision),
                ));
            }
            Ok(LibraryBlockPropertyFieldResult::DataSource {
                path: field.path.clone(),
                block_id: field.page.page_id.clone(),
                data_source_id: field.data_source_id.clone(),
                property_id: field.property.id.clone(),
                operation: field.operation.to_owned(),
                revision: next_revision,
                value: field.value.clone(),
            })
        }
    }
    .map_err(|error| match error {
        PropertyApplyError::Rejected(mut error) => {
            if error.message.is_empty() {
                error.message = format!("Property mutation {operation_id} was rejected");
            }
            PropertyApplyError::Rejected(error)
        }
        error => error,
    })
}

fn bump_page_metadata_revisions(
    connection: &Connection,
    operation_id: &str,
    page_ids: &[String],
    now: &str,
) -> Result<BTreeMap<String, i64>, StoreError> {
    let mut revisions = BTreeMap::new();
    for page_id in page_ids {
        let revision = connection
            .query_row(
                "UPDATE blocks SET metadata_revision = metadata_revision + 1, updated_at = ?1 \
                 WHERE id = ?2 AND type = 'page' AND lifecycle = 'active' \
                 RETURNING metadata_revision",
                params![now, page_id],
                |row| row.get::<_, i64>(0),
            )
            .optional()?
            .ok_or_else(|| {
                StoreError::new(
                    StoreErrorCode::NotFound,
                    format!(
                        "Property mutation {operation_id} lost target Page {page_id} while committing"
                    ),
                    false,
                )
            })?;
        connection.execute(
            "UPDATE pages SET metadata_revision = ?1, updated_at = ?2 WHERE block_id = ?3",
            params![revision, now, page_id],
        )?;
        revisions.insert(page_id.clone(), revision);
    }
    Ok(revisions)
}

fn validate_schedule_after_mutation(
    connection: &Connection,
    operation_id: &str,
    fields: &[ResolvedField],
) -> Result<(), PropertyApplyError> {
    let pages = schedule_pages(fields);
    for page_id in pages {
        let first_path = fields
            .iter()
            .find(|field| field.page_id() == page_id && affects_schedule(field))
            .map(ResolvedField::path)
            .unwrap_or("schedule")
            .to_owned();
        let mut database_values = connection
            .prepare(
                "SELECT value.property_id, value.value_json \
                 FROM data_source_page_memberships membership \
                 JOIN data_source_property_values value \
                   ON value.data_source_id = membership.data_source_id \
                  AND value.membership_id = membership.id \
                 WHERE membership.page_block_id = ?1 AND membership.removed_at IS NULL \
                   AND value.property_id IN ('scheduled_start', 'scheduled_end')",
            )?
            .query_map([&page_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?
            .into_iter()
            .map(|(key, value)| parse_canonical_json(&value, &first_path).map(|value| (key, value)))
            .collect::<Result<BTreeMap<_, _>, _>>()?;
        let mut intrinsic_values = connection
            .prepare(
                "SELECT property_key, value_json FROM block_properties \
                 WHERE block_id = ?1 AND property_key IN ( \
                   'schedule.isAllDay', 'schedule.timezone', \
                   'recurrence.config', 'reminders.config' \
                 )",
            )?
            .query_map([&page_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?
            .into_iter()
            .map(|(key, value)| parse_canonical_json(&value, &first_path).map(|value| (key, value)))
            .collect::<Result<BTreeMap<_, _>, _>>()?;
        for field in fields.iter().filter(|field| field.page_id() == page_id) {
            match field {
                ResolvedField::Intrinsic(field)
                    if INTRINSIC_SCHEDULE_KEYS.contains(&field.property_key.as_str()) =>
                {
                    intrinsic_values.insert(field.property_key.clone(), field.value.clone());
                }
                ResolvedField::DataSource(field)
                    if matches!(
                        field.property.id.as_str(),
                        "scheduled_start" | "scheduled_end"
                    ) =>
                {
                    database_values.insert(field.property.id.clone(), field.value.clone());
                }
                _ => {}
            }
        }
        validate_schedule_values(
            operation_id,
            &first_path,
            database_values.get("scheduled_start"),
            database_values.get("scheduled_end"),
            intrinsic_values.get("schedule.isAllDay"),
            intrinsic_values.get("schedule.timezone"),
            intrinsic_values.get("recurrence.config"),
            intrinsic_values.get("reminders.config"),
        )?;
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn validate_schedule_values(
    _operation_id: &str,
    path: &str,
    start: Option<&Value>,
    end: Option<&Value>,
    all_day: Option<&Value>,
    timezone: Option<&Value>,
    recurrence: Option<&Value>,
    reminders: Option<&Value>,
) -> Result<(), PropertyApplyError> {
    let start = optional_datetime(start, path)?;
    let end = optional_datetime(end, path)?;
    if start.is_some() != end.is_some() {
        return Err(property_value_invalid(
            path,
            "scheduled_start and scheduled_end must be set or cleared together",
        ));
    }
    if let (Some(start), Some(end)) = (start, end)
        && end <= start
    {
        return Err(property_value_invalid(
            path,
            "scheduled_end must be after scheduled_start",
        ));
    }
    let all_day = all_day.and_then(Value::as_bool).unwrap_or(false);
    if all_day && start.is_none() {
        return Err(property_value_invalid(
            path,
            "schedule.isAllDay requires a schedule range",
        ));
    }
    let timezone = match timezone {
        None | Some(Value::Null) => None,
        Some(Value::String(value)) => Some(value.as_str()),
        Some(_) => {
            return Err(property_value_invalid(
                path,
                "schedule.timezone must be a string or null",
            ));
        }
    };
    validate_timezone_input(timezone)
        .map_err(|error| property_value_invalid(path, &error.message))?;
    if let Some(value) = recurrence.filter(|value| !value.is_null()) {
        let recurrence = serde_json::from_value::<PageRecurrenceConfig>(value.clone())
            .map_err(|_| property_value_invalid(path, "recurrence.config is invalid"))?;
        validate_recurrence_input(&recurrence)
            .map_err(|error| property_value_invalid(path, &error.message))?;
    }
    let reminders = reminders
        .cloned()
        .unwrap_or_else(|| Value::Array(Vec::new()));
    let reminders = serde_json::from_value::<Vec<PageReminderConfig>>(reminders)
        .map_err(|_| property_value_invalid(path, "reminders.config is invalid"))?;
    validate_reminders_input(&reminders)
        .map_err(|error| property_value_invalid(path, &error.message))?;
    Ok(())
}

fn optional_datetime(
    value: Option<&Value>,
    path: &str,
) -> Result<Option<DateTime<Utc>>, PropertyApplyError> {
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => {
            let parsed = DateTime::parse_from_rfc3339(value)
                .map_err(|_| property_value_invalid(path, "scheduled datetime is invalid"))?
                .with_timezone(&Utc);
            if parsed.to_rfc3339_opts(SecondsFormat::Millis, true) != *value {
                return Err(property_value_invalid(
                    path,
                    "scheduled datetime must be canonical UTC RFC 3339",
                ));
            }
            Ok(Some(parsed))
        }
        Some(_) => Err(property_value_invalid(
            path,
            "scheduled datetime must be a string or null",
        )),
    }
}

fn schedule_pages(fields: &[ResolvedField]) -> BTreeSet<String> {
    fields
        .iter()
        .filter(|field| affects_schedule(field))
        .map(|field| field.page_id().to_owned())
        .collect()
}

fn affects_schedule(field: &ResolvedField) -> bool {
    match field {
        ResolvedField::Intrinsic(field) => {
            INTRINSIC_SCHEDULE_KEYS.contains(&field.property_key.as_str())
        }
        ResolvedField::DataSource(field) => {
            matches!(
                field.property.id.as_str(),
                "scheduled_start" | "scheduled_end"
            )
        }
    }
}

fn validate_intrinsic_value(
    property_key: &str,
    value: &Value,
    path: &str,
) -> Result<(), PropertyApplyError> {
    if matches!(property_key, "agent.blocked" | "agent.status") {
        return Err(rejected(
            LibraryBlockPropertyMutationErrorCode::PropertyNotFound,
            format!("Intrinsic Property {path} is retired"),
            Some(path.to_owned()),
            None,
            None,
        ));
    }
    let valid = match property_key {
        "run.target" => value
            .as_str()
            .is_some_and(|value| matches!(value, "localProject" | "newWorktree" | "cloud")),
        "run.localPath" | "run.worktreePath" | "run.environmentPath" => {
            value.is_null() || value.is_string()
        }
        "run.baseBranch" => value.is_null() || value.as_str().is_some_and(valid_branch_name),
        "schedule.isAllDay" => value.is_boolean(),
        "schedule.timezone" => {
            if value.is_null() {
                true
            } else if let Some(value) = value.as_str() {
                validate_timezone_input(Some(value)).is_ok()
            } else {
                false
            }
        }
        "recurrence.config" => {
            value.is_null()
                || serde_json::from_value::<PageRecurrenceConfig>(value.clone())
                    .is_ok_and(|value| validate_recurrence_input(&value).is_ok())
        }
        "reminders.config" => serde_json::from_value::<Vec<PageReminderConfig>>(value.clone())
            .is_ok_and(|value| validate_reminders_input(&value).is_ok()),
        _ => true,
    };
    if valid {
        return Ok(());
    }
    Err(property_value_invalid(
        path,
        &format!("Intrinsic Property {path} is invalid"),
    ))
}

fn valid_branch_name(value: &str) -> bool {
    let trimmed = value.trim();
    trimmed.is_empty()
        || (!trimmed.starts_with('-')
            && !trimmed.chars().any(|character| {
                matches!(character, '~' | '^' | ':' | '?' | '*' | '[' | ']' | '\\')
                    || character.is_whitespace()
            }))
}

fn active_page(
    connection: &Connection,
    library_id: &str,
    _operation_id: &str,
    page_id: &str,
    path: &str,
) -> Result<PageAuthority, PropertyApplyError> {
    let row = connection
        .query_row(
            "SELECT block.type, block.lifecycle, block.project_id, page.lifecycle, page.library_id \
             FROM blocks block LEFT JOIN pages page ON page.block_id = block.id \
             WHERE block.id = ?1",
            [page_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                ))
            },
        )
        .optional()?;
    let Some((block_type, block_lifecycle, project_id, page_lifecycle, page_library_id)) = row
    else {
        return Err(rejected(
            LibraryBlockPropertyMutationErrorCode::BlockNotFound,
            format!("Page Block does not exist: {page_id}"),
            Some(path.to_owned()),
            None,
            None,
        ));
    };
    if block_type != "page" || page_lifecycle.is_none() {
        return Err(rejected(
            LibraryBlockPropertyMutationErrorCode::BlockTypeMismatch,
            format!("Property mutations require a Page Block: {page_id}"),
            Some(path.to_owned()),
            None,
            None,
        ));
    }
    if block_lifecycle != "active" || page_lifecycle.as_deref() != Some("active") {
        return Err(rejected(
            LibraryBlockPropertyMutationErrorCode::BlockNotActive,
            format!("Page Block is not active: {page_id}"),
            Some(path.to_owned()),
            None,
            None,
        ));
    }
    if page_library_id.as_deref() != Some(library_id) {
        return Err(rejected(
            LibraryBlockPropertyMutationErrorCode::BlockNotFound,
            format!("Page Block is unavailable: {page_id}"),
            Some(path.to_owned()),
            None,
            None,
        ));
    }
    Ok(PageAuthority {
        page_id: page_id.to_owned(),
        storage_project_id: project_id,
    })
}

fn authorize_page(
    connection: &Connection,
    context: &BoundModuleContext,
    library_id: &str,
    page: &PageAuthority,
    path: &str,
) -> Result<(), PropertyApplyError> {
    let Some(project_id) = context.project_id.as_ref() else {
        return Ok(());
    };
    if require_page_write_access(connection, library_id, &project_id.0, &page.page_id).is_ok() {
        return Ok(());
    }
    Err(rejected(
        LibraryBlockPropertyMutationErrorCode::BlockNotFound,
        format!("Writable Page Block is unavailable: {}", page.page_id),
        Some(path.to_owned()),
        None,
        None,
    ))
}

fn ledger_project_id(
    connection: &Connection,
    context: &BoundModuleContext,
    library_id: &str,
) -> Result<String, StoreError> {
    if let Some(project_id) = context.project_id.as_ref() {
        return connection
            .query_row(
                "SELECT id FROM projects \
                 WHERE id = ?1 AND library_id = ?2 AND lifecycle = 'active'",
                params![project_id.0, library_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .ok_or_else(|| {
                StoreError::new(
                    StoreErrorCode::Unauthorized,
                    "Bound Project is not active in this Library",
                    false,
                )
            });
    }
    if !matches!(
        context.adapter,
        AdapterKind::ElectronHost
            | AdapterKind::LoopbackHttp
            | AdapterKind::NativeCli
            | AdapterKind::Test
    ) {
        return Err(StoreError::new(
            StoreErrorCode::Unauthorized,
            "Library Property mutations require trusted local authority",
            false,
        ));
    }
    connection
        .query_row(
            "SELECT id FROM projects WHERE library_id = ?1 AND lifecycle = 'active' \
             ORDER BY created, id LIMIT 1",
            [library_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or_else(|| {
            StoreError::new(
                StoreErrorCode::NotFound,
                "The local Library has no compatibility storage Project",
                false,
            )
        })
}

fn make_evidence(
    _context: &BoundModuleContext,
    project_id: &str,
    store_epoch: &str,
    operation_id: &str,
    mutation: &LibraryBlockPropertyMutation,
    database_ids: Vec<String>,
) -> Result<MutationEvidence, StoreError> {
    let mut fields = mutation.fields.clone();
    fields.sort_by_key(|field| mutation_path(field).unwrap_or_default());
    let public_fields = fields
        .iter()
        .map(public_field_json)
        .collect::<Result<Vec<_>, _>>()?;
    let request = json!({
        "version": 2,
        "mutationId": operation_id,
        "projectId": project_id,
        "storeEpoch": store_epoch,
        "clientSessionId": mutation.client_session_id,
        "actor": mutation.actor,
        "fields": public_fields,
    });
    let request = omit_null_member(request, "clientSessionId");
    let request_json = canonical_json(&request)?;
    let actor_json = canonical_json(&mutation.actor)?;
    let target_page_ids = fields
        .iter()
        .map(|field| match field {
            LibraryBlockPropertyFieldMutation::IntrinsicSet { block_id, .. } => block_id.clone(),
            LibraryBlockPropertyFieldMutation::DataSourceSet { page_id, .. }
            | LibraryBlockPropertyFieldMutation::DataSourceAddRemove { page_id, .. } => {
                page_id.clone()
            }
        })
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let field_intents = fields
        .iter()
        .map(|field| {
            let path = mutation_path(field)?;
            Ok(match field {
                LibraryBlockPropertyFieldMutation::IntrinsicSet { .. }
                | LibraryBlockPropertyFieldMutation::DataSourceSet { .. } => json!({
                    "path": path,
                    "operation": "set",
                    "scope": if matches!(field, LibraryBlockPropertyFieldMutation::IntrinsicSet { .. }) {
                        "intrinsic"
                    } else {
                        "data_source"
                    },
                }),
                LibraryBlockPropertyFieldMutation::DataSourceAddRemove {
                    add, remove, ..
                } => json!({
                    "path": path,
                    "operation": "add_remove",
                    "scope": "data_source",
                    "add": add,
                    "remove": remove,
                }),
            })
        })
        .collect::<Result<Vec<_>, StoreError>>()?;
    let expected_revisions = fields
        .iter()
        .filter_map(|field| match field {
            LibraryBlockPropertyFieldMutation::IntrinsicSet {
                expected_revision, ..
            }
            | LibraryBlockPropertyFieldMutation::DataSourceSet {
                expected_revision, ..
            } => Some((mutation_path(field), *expected_revision)),
            LibraryBlockPropertyFieldMutation::DataSourceAddRemove { .. } => None,
        })
        .map(|(path, revision)| path.map(|path| (path, Value::from(revision))))
        .collect::<Result<Map<_, _>, _>>()?;
    Ok(MutationEvidence {
        request_hash: sha256(request_json.as_bytes()),
        request_json,
        actor_json,
        target_page_ids_json: serde_json::to_string(&target_page_ids)
            .map_err(|_| internal("Property target Page IDs cannot encode"))?,
        target_page_ids,
        database_ids_json: serde_json::to_string(&database_ids)
            .map_err(|_| internal("Property Database IDs cannot encode"))?,
        database_ids,
        field_intents_json: canonical_json(&Value::Array(field_intents))?,
        expected_revisions_json: canonical_json(&Value::Object(expected_revisions))?,
    })
}

fn minimal_evidence(
    project_id: &str,
    store_epoch: &str,
    operation_id: &str,
    mutation: &LibraryBlockPropertyMutation,
) -> Result<MutationEvidence, StoreError> {
    let context = BoundModuleContext {
        profile_id: nodex_core_contracts::ProfileId(String::new()),
        library_id: nodex_core_contracts::LibraryId(String::new()),
        project_id: None,
        connection_id: String::new(),
        adapter: AdapterKind::Test,
    };
    let mut evidence = make_evidence(
        &context,
        project_id,
        store_epoch,
        operation_id,
        mutation,
        Vec::new(),
    )?;
    if !mutation.actor.is_object() {
        evidence.actor_json = "{}".to_owned();
    }
    Ok(evidence)
}

fn public_field_json(field: &LibraryBlockPropertyFieldMutation) -> Result<Value, StoreError> {
    Ok(match field {
        LibraryBlockPropertyFieldMutation::IntrinsicSet {
            block_id,
            property_key,
            expected_revision,
            value,
        } => json!({
            "scope": "intrinsic",
            "blockId": block_id,
            "propertyKey": property_key,
            "operation": "set",
            "expectedRevision": expected_revision,
            "value": value,
        }),
        LibraryBlockPropertyFieldMutation::DataSourceSet {
            page_id,
            data_source_id,
            property_id,
            expected_revision,
            value,
        } => json!({
            "scope": "data_source",
            "pageId": page_id,
            "dataSourceId": data_source_id,
            "propertyId": property_id,
            "operation": "set",
            "expectedRevision": expected_revision,
            "value": value,
        }),
        LibraryBlockPropertyFieldMutation::DataSourceAddRemove {
            page_id,
            data_source_id,
            property_id,
            add,
            remove,
        } => json!({
            "scope": "data_source",
            "pageId": page_id,
            "dataSourceId": data_source_id,
            "propertyId": property_id,
            "operation": "add_remove",
            "add": add,
            "remove": remove,
        }),
    })
}

fn change_payload(
    evidence: &MutationEvidence,
    fields: &[ResolvedField],
    results: &[LibraryBlockPropertyFieldResult],
    block_metadata_revisions: &BTreeMap<String, i64>,
) -> Value {
    let resolved = fields
        .iter()
        .map(|field| (field.path(), field))
        .collect::<BTreeMap<_, _>>();
    json!({
        "version": 2,
        "requestHash": evidence.request_hash,
        "fieldPaths": results.iter().map(field_result_path).collect::<Vec<_>>(),
        "fieldChanges": results.iter().filter_map(|result| {
            let field = resolved.get(field_result_path(result))?;
            Some(json!({
                "path": field_result_path(result),
                "scope": field_result_scope(result),
                "operation": field_result_operation(result),
                "before": {
                    "exists": field.current_revision() > 0,
                    "revision": field.current_revision(),
                    "value": field.current_value(),
                },
                "after": {
                    "exists": true,
                    "revision": field_result_revision(result),
                    "value": field_result_value(result),
                },
            }))
        }).collect::<Vec<_>>(),
        "committedRevisions": results.iter().map(|result| {
            (field_result_path(result).to_owned(), Value::from(field_result_revision(result)))
        }).collect::<Map<_, _>>(),
        "blockMetadataRevisions": block_metadata_revisions,
    })
}

#[allow(clippy::too_many_arguments)]
fn persist_property_ledger(
    connection: &Connection,
    project_id: &str,
    store_epoch: &str,
    operation_id: &str,
    client_session_id: Option<&str>,
    evidence: &MutationEvidence,
    outcome: &str,
    result: &Value,
    committed_revisions: &Value,
    change_log_seq: Option<i64>,
    now: &str,
) -> Result<(), StoreError> {
    connection.execute(
        "INSERT INTO block_mutations( \
           mutation_id, project_id, store_epoch, mutation_kind, actor_json, client_session_id, \
           request_hash, request_json, target_block_ids_json, affected_document_ids_json, \
           affected_database_block_ids_json, field_intents_json, expected_revisions_json, \
           outcome, result_json, committed_revisions_json, document_heads_json, \
           change_log_seq, recorded_at \
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, '[]', ?10, ?11, ?12, \
                   ?13, ?14, ?15, '{}', ?16, ?17)",
        params![
            operation_id,
            project_id,
            store_epoch,
            MUTATION_KIND,
            evidence.actor_json,
            client_session_id,
            evidence.request_hash,
            evidence.request_json,
            evidence.target_page_ids_json,
            evidence.database_ids_json,
            evidence.field_intents_json,
            evidence.expected_revisions_json,
            outcome,
            canonical_json(result)?,
            canonical_json(committed_revisions)?,
            change_log_seq,
            now,
        ],
    )?;
    Ok(())
}

fn read_ledger_collision(
    connection: &Connection,
    project_id: &str,
    store_epoch: &str,
    operation_id: &str,
    client_session_id: Option<&str>,
    evidence: &MutationEvidence,
) -> Result<Option<LibraryBlockPropertyMutationError>, StoreError> {
    let existing = connection
        .query_row(
            "SELECT project_id, store_epoch, mutation_kind, actor_json, client_session_id, \
               request_hash, request_json, target_block_ids_json, \
               affected_database_block_ids_json, field_intents_json, expected_revisions_json \
             FROM block_mutations WHERE mutation_id = ?1",
            [operation_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, String>(7)?,
                    row.get::<_, String>(8)?,
                    row.get::<_, String>(9)?,
                    row.get::<_, String>(10)?,
                ))
            },
        )
        .optional()?;
    let Some(existing) = existing else {
        return Ok(None);
    };
    let exact = existing.0 == project_id
        && existing.1 == store_epoch
        && existing.2 == MUTATION_KIND
        && existing.3 == evidence.actor_json
        && existing.4.as_deref() == client_session_id
        && existing.5 == evidence.request_hash
        && existing.6 == evidence.request_json
        && existing.7 == evidence.target_page_ids_json
        && existing.8 == evidence.database_ids_json
        && existing.9 == evidence.field_intents_json
        && existing.10 == evidence.expected_revisions_json;
    Ok(Some(LibraryBlockPropertyMutationError {
        code: if exact {
            LibraryBlockPropertyMutationErrorCode::Unknown
        } else {
            LibraryBlockPropertyMutationErrorCode::MutationIdCollision
        },
        message: if exact {
            format!(
                "Mutation {operation_id} predates the native module receipt and cannot be replayed safely"
            )
        } else {
            format!("Mutation ID {operation_id} is already bound to another request")
        },
        retryable: false,
        field_path: None,
        expected_revision: None,
        actual_revision: None,
    }))
}

#[allow(clippy::too_many_arguments)]
fn public_success_json(
    operation_id: &str,
    project_id: &str,
    store_epoch: &str,
    fields: &[LibraryBlockPropertyFieldResult],
    block_metadata_revisions: &BTreeMap<String, i64>,
    change_log_seq: i64,
    now: &str,
) -> Value {
    json!({
        "version": 2,
        "mutationId": operation_id,
        "projectId": project_id,
        "storeEpoch": store_epoch,
        "duplicate": false,
        "fields": fields.iter().map(public_field_result_json).collect::<Vec<_>>(),
        "blockMetadataRevisions": block_metadata_revisions,
        "changeLogSeq": change_log_seq,
        "committedAt": now,
    })
}

fn public_field_result_json(field: &LibraryBlockPropertyFieldResult) -> Value {
    match field {
        LibraryBlockPropertyFieldResult::Intrinsic {
            path,
            block_id,
            property_key,
            operation,
            revision,
            value,
        } => json!({
            "path": path,
            "scope": "intrinsic",
            "blockId": block_id,
            "propertyKey": property_key,
            "operation": operation,
            "revision": revision,
            "value": value,
        }),
        LibraryBlockPropertyFieldResult::DataSource {
            path,
            block_id,
            data_source_id,
            property_id,
            operation,
            revision,
            value,
        } => json!({
            "path": path,
            "scope": "data_source",
            "blockId": block_id,
            "dataSourceId": data_source_id,
            "propertyId": property_id,
            "operation": operation,
            "revision": revision,
            "value": value,
        }),
    }
}

fn public_error_json(operation_id: &str, error: &LibraryBlockPropertyMutationError) -> Value {
    omit_null_members(json!({
        "code": property_error_code(error.code),
        "message": error.message,
        "retryable": error.retryable,
        "mutationId": operation_id,
        "fieldPath": error.field_path,
        "expectedRevision": error.expected_revision,
        "actualRevision": error.actual_revision,
    }))
}

fn finish_rejection(
    connection: &Connection,
    context: &BoundModuleContext,
    store_epoch: &str,
    operation_id: &str,
    request_hash: &str,
    error: LibraryBlockPropertyMutationError,
    now: &str,
) -> Result<LibraryApplyOutcome, StoreError> {
    let event_head =
        connection.query_row("SELECT COALESCE(MAX(seq), 0) FROM change_log", [], |row| {
            row.get::<_, i64>(0)
        })?;
    let committed = CommittedModuleValue {
        value: LibraryCommitValue {
            affected_resource_ids: Vec::new(),
            page_copy: None,
            block_transfer: None,
            page_lifecycle: None,
            block_property_mutation: Some(LibraryBlockPropertyMutationReceipt {
                outcome: LibraryBlockPropertyMutationOutcome::Rejected { error },
            }),
            agent_page_copy: None,
            agent_create_pages: None,
            agent_move_pages: None,
        },
        receipt: LibraryReceipt {
            mutation: ModuleMutationReceipt {
                operation_id: operation_id.to_owned(),
                duplicate: false,
            },
            operation_kind: MUTATION_KIND.to_owned(),
            did_mutate: false,
            created_target: None,
            affected_parent_keys: Vec::new(),
            affected_page_ids: Vec::new(),
            affected_database_ids: Vec::new(),
            affected_view_ids: Vec::new(),
            committed_revisions: BTreeMap::new(),
            change_log_seq: event_head,
            committed_at: now.to_owned(),
        },
        event_sequence: event_head,
        store_epoch: StoreEpoch(store_epoch.to_owned()),
    };
    let result = serde_json::to_value(&committed)
        .map_err(|_| internal("Property rejection result cannot encode"))?;
    insert_module_receipt(
        connection,
        NewModuleReceipt {
            module_name: MODULE_NAME,
            operation_id,
            context,
            operation_kind: MUTATION_KIND,
            store_epoch,
            request_hash,
            result: &result,
            event_sequence: None,
            committed_at: now,
        },
    )?;
    Ok(LibraryApplyOutcome {
        committed,
        event: None,
    })
}

fn mutation_path(field: &LibraryBlockPropertyFieldMutation) -> Result<String, StoreError> {
    Ok(match field {
        LibraryBlockPropertyFieldMutation::IntrinsicSet {
            block_id,
            property_key,
            ..
        } => format!(
            "intrinsic/{}/{}",
            encode_uri_component(block_id),
            encode_uri_component(property_key)
        ),
        LibraryBlockPropertyFieldMutation::DataSourceSet {
            page_id,
            data_source_id,
            property_id,
            ..
        }
        | LibraryBlockPropertyFieldMutation::DataSourceAddRemove {
            page_id,
            data_source_id,
            property_id,
            ..
        } => format!(
            "data_source/{}/{}/{}",
            encode_uri_component(data_source_id),
            encode_uri_component(page_id),
            encode_uri_component(property_id)
        ),
    })
}

fn encode_uri_component(value: &str) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut encoded = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        if byte.is_ascii_alphanumeric()
            || matches!(
                byte,
                b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')'
            )
        {
            encoded.push(char::from(*byte));
            continue;
        }
        encoded.push('%');
        encoded.push(char::from(HEX[usize::from(byte >> 4)]));
        encoded.push(char::from(HEX[usize::from(byte & 0x0f)]));
    }
    encoded
}

fn field_result_path(field: &LibraryBlockPropertyFieldResult) -> &str {
    match field {
        LibraryBlockPropertyFieldResult::Intrinsic { path, .. }
        | LibraryBlockPropertyFieldResult::DataSource { path, .. } => path,
    }
}

fn field_result_revision(field: &LibraryBlockPropertyFieldResult) -> i64 {
    match field {
        LibraryBlockPropertyFieldResult::Intrinsic { revision, .. }
        | LibraryBlockPropertyFieldResult::DataSource { revision, .. } => *revision,
    }
}

fn field_result_scope(field: &LibraryBlockPropertyFieldResult) -> &'static str {
    match field {
        LibraryBlockPropertyFieldResult::Intrinsic { .. } => "intrinsic",
        LibraryBlockPropertyFieldResult::DataSource { .. } => "data_source",
    }
}

fn field_result_operation(field: &LibraryBlockPropertyFieldResult) -> &str {
    match field {
        LibraryBlockPropertyFieldResult::Intrinsic { operation, .. }
        | LibraryBlockPropertyFieldResult::DataSource { operation, .. } => operation,
    }
}

fn field_result_value(field: &LibraryBlockPropertyFieldResult) -> &Value {
    match field {
        LibraryBlockPropertyFieldResult::Intrinsic { value, .. }
        | LibraryBlockPropertyFieldResult::DataSource { value, .. } => value,
    }
}

fn intrinsic_value_type(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) | Value::Object(_) => "json",
    }
}

fn parse_canonical_json(value: &str, path: &str) -> Result<Value, PropertyApplyError> {
    let parsed = serde_json::from_str::<Value>(value).map_err(|_| {
        rejected(
            LibraryBlockPropertyMutationErrorCode::PropertyValueCorrupt,
            format!("Stored Property {path} is not valid JSON"),
            Some(path.to_owned()),
            None,
            None,
        )
    })?;
    if canonical_json(&parsed)? == value {
        return Ok(parsed);
    }
    Err(rejected(
        LibraryBlockPropertyMutationErrorCode::PropertyValueCorrupt,
        format!("Stored Property {path} is not canonical JSON"),
        Some(path.to_owned()),
        None,
        None,
    ))
}

fn canonical_json(value: &Value) -> Result<String, StoreError> {
    serde_json::to_string(&canonical_value(value))
        .map_err(|_| internal("Property JSON cannot be encoded"))
}

fn canonical_value(value: &Value) -> Value {
    match value {
        Value::Array(items) => Value::Array(items.iter().map(canonical_value).collect()),
        Value::Object(input) => {
            let mut output = Map::new();
            let mut keys = input.keys().collect::<Vec<_>>();
            keys.sort();
            for key in keys {
                if let Some(value) = input.get(key) {
                    output.insert(key.clone(), canonical_value(value));
                }
            }
            Value::Object(output)
        }
        value => value.clone(),
    }
}

fn omit_null_member(mut value: Value, key: &str) -> Value {
    if let Some(object) = value.as_object_mut()
        && object.get(key).is_some_and(Value::is_null)
    {
        object.remove(key);
    }
    value
}

fn omit_null_members(mut value: Value) -> Value {
    if let Some(object) = value.as_object_mut() {
        object.retain(|_, value| !value.is_null());
    }
    value
}

fn validate_id(value: &str, label: &str) -> Result<(), PropertyApplyError> {
    if !value.is_empty() && value.len() <= MAX_ID_LENGTH && value.trim() == value {
        return Ok(());
    }
    Err(rejected(
        LibraryBlockPropertyMutationErrorCode::InvalidPropertyMutationRequest,
        format!("{label} must be a canonical non-empty string"),
        None,
        None,
        None,
    ))
}

fn validate_property_id(value: &str, label: &str) -> Result<(), PropertyApplyError> {
    if !value.is_empty() && value.len() <= MAX_PROPERTY_KEY_LENGTH && value.trim() == value {
        return Ok(());
    }
    Err(rejected(
        LibraryBlockPropertyMutationErrorCode::InvalidPropertyMutationRequest,
        format!("{label} must be a canonical Property identity"),
        None,
        None,
        None,
    ))
}

fn validate_revision(revision: i64, path: &str) -> Result<(), PropertyApplyError> {
    if revision >= 0 {
        return Ok(());
    }
    Err(rejected(
        LibraryBlockPropertyMutationErrorCode::InvalidPropertyMutationRequest,
        "expectedRevision must be non-negative",
        Some(path.to_owned()),
        None,
        None,
    ))
}

fn property_value_invalid(path: &str, message: &str) -> PropertyApplyError {
    rejected(
        LibraryBlockPropertyMutationErrorCode::PropertyValueInvalid,
        message,
        Some(path.to_owned()),
        None,
        None,
    )
}

fn rejected(
    code: LibraryBlockPropertyMutationErrorCode,
    message: impl Into<String>,
    field_path: Option<String>,
    expected_revision: Option<i64>,
    actual_revision: Option<i64>,
) -> PropertyApplyError {
    PropertyApplyError::Rejected(LibraryBlockPropertyMutationError {
        code,
        message: message.into(),
        retryable: false,
        field_path,
        expected_revision,
        actual_revision,
    })
}

fn property_error_code(code: LibraryBlockPropertyMutationErrorCode) -> &'static str {
    match code {
        LibraryBlockPropertyMutationErrorCode::InvalidPropertyMutationRequest => {
            "invalid_property_mutation_request"
        }
        LibraryBlockPropertyMutationErrorCode::MutationIdCollision => "mutation_id_collision",
        LibraryBlockPropertyMutationErrorCode::ProjectNotFound => "project_not_found",
        LibraryBlockPropertyMutationErrorCode::BlockNotFound => "block_not_found",
        LibraryBlockPropertyMutationErrorCode::BlockNotActive => "block_not_active",
        LibraryBlockPropertyMutationErrorCode::BlockTypeMismatch => "block_type_mismatch",
        LibraryBlockPropertyMutationErrorCode::DataSourceNotFound => "data_source_not_found",
        LibraryBlockPropertyMutationErrorCode::MembershipNotFound => "membership_not_found",
        LibraryBlockPropertyMutationErrorCode::PropertyNotFound => "property_not_found",
        LibraryBlockPropertyMutationErrorCode::PropertyTypeMismatch => "property_type_mismatch",
        LibraryBlockPropertyMutationErrorCode::PropertyValueInvalid => "property_value_invalid",
        LibraryBlockPropertyMutationErrorCode::PropertyValueCorrupt => "property_value_corrupt",
        LibraryBlockPropertyMutationErrorCode::PropertyConflict => "property_conflict",
        LibraryBlockPropertyMutationErrorCode::Unknown => "unknown",
    }
}

fn sqlite_now(connection: &Connection) -> Result<String, StoreError> {
    connection
        .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", [], |row| {
            row.get::<_, String>(0)
        })
        .map_err(StoreError::from)
}

fn internal(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::Internal, message, false)
}
