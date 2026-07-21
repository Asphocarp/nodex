use std::path::Path;

use nodex_core_contracts::database::{
    DatabaseRead, DatabaseReadMode, DatabaseReadValue, DatabaseTarget,
};
use nodex_core_contracts::library::{
    LIBRARY_CONTRACT_VERSION, LibraryAgentSiblingAnchor, LibraryIntent,
    LibraryPageWriteDestination, LibraryRead, LibraryReadValue,
};
use nodex_core_contracts::workspace::ProjectWorkspaceProject;
use nodex_core_contracts::{CoreErrorCode, ModuleApplyRequest, StoreEpoch};
use nodex_core_protocol::ResponseEnvelope;
use nodex_core_protocol::client::CoreClient;
use serde_json::json;

use crate::cli::{BoundaryPlacement, PageCreateArgs, PageDeleteArgs, PageTransferArgs};
use crate::error::{CliError, CliErrorCode};
use crate::page_mutation::{
    MAX_BODY_INPUT_BYTES, read_content_input, validate_return_fields, validate_title,
};
use crate::runtime::{
    CommandOutput, map_client_error, map_core_error, operation_id, resolve_page_selector,
    selected_project, unwrap_database, unwrap_library,
};

pub(crate) fn create_page(
    client: &CoreClient,
    explicit_project: Option<&str>,
    cwd: &Path,
    arguments: PageCreateArgs,
    json_output: bool,
) -> Result<CommandOutput, CliError> {
    validate_return_fields(&arguments.mutation.r#return)?;
    let title_markdown = validate_title(arguments.title)?;
    let nfm = if arguments.content.empty {
        String::new()
    } else {
        read_content_input(
            arguments.content.file.as_deref(),
            MAX_BODY_INPUT_BYTES,
            "Page body",
        )?
    };
    let project = selected_project(client, explicit_project, cwd)?;
    let destination = resolve_page_destination(client, &project, &arguments.parent, None)?;
    let operation_id = operation_id(arguments.mutation.idempotency_key.as_deref(), json_output)?;
    let response = client
        .library_apply(
            Some(&project.id),
            ModuleApplyRequest {
                version: LIBRARY_CONTRACT_VERSION,
                operation_id,
                store_epoch: StoreEpoch(client.handshake.store_epoch.clone()),
                intent: LibraryIntent::CreatePageFromNfm {
                    title_markdown,
                    nfm,
                    destination,
                },
            },
        )
        .map_err(map_client_error)?;
    let committed = match response.0 {
        ResponseEnvelope::Ok(committed) => committed,
        ResponseEnvelope::Error(error) => return Err(map_core_error(error)),
    };
    let created = committed.value.page_create.as_ref().ok_or_else(|| {
        CliError::new(
            CliErrorCode::Internal,
            "Core semantic Page creation omitted its exact result",
        )
    })?;
    let mut result = json!({
        "operation_id": committed.receipt.mutation.operation_id,
        "duplicate": committed.receipt.mutation.duplicate,
        "page_id": created.page_id,
        "document_id": created.document_id,
        "generation": created.document_generation,
        "head_seq": created.document_head_seq,
        "event_sequence": committed.event_sequence,
        "affected": {
            "created_block_ids": created.block_ids,
        },
        "etags": {
            "title": created.title_etag,
            "body": created.body_etag,
        },
    });
    if arguments
        .mutation
        .r#return
        .iter()
        .any(|field| field == "commit")
    {
        result.as_object_mut().expect("result object").insert(
            "commit".to_owned(),
            serde_json::to_value(&committed.value).map_err(internal)?,
        );
    }
    Ok(CommandOutput::Json(result))
}

pub(crate) fn move_page(
    client: &CoreClient,
    explicit_project: Option<&str>,
    cwd: &Path,
    arguments: PageTransferArgs,
    json_output: bool,
) -> Result<CommandOutput, CliError> {
    transfer_page(client, explicit_project, cwd, arguments, json_output, false)
}

pub(crate) fn duplicate_page(
    client: &CoreClient,
    explicit_project: Option<&str>,
    cwd: &Path,
    arguments: PageTransferArgs,
    json_output: bool,
) -> Result<CommandOutput, CliError> {
    transfer_page(client, explicit_project, cwd, arguments, json_output, true)
}

fn transfer_page(
    client: &CoreClient,
    explicit_project: Option<&str>,
    cwd: &Path,
    arguments: PageTransferArgs,
    json_output: bool,
    duplicate: bool,
) -> Result<CommandOutput, CliError> {
    validate_return_fields(&arguments.mutation.r#return)?;
    let project = selected_project(client, explicit_project, cwd)?;
    let page_id = resolve_page_selector(client, &project.id, &arguments.page)?;
    let anchor = placement_anchor(&arguments)?;
    let destination = resolve_page_destination(client, &project, &arguments.to, anchor)?;
    let operation_id = operation_id(arguments.mutation.idempotency_key.as_deref(), json_output)?;
    let intent = if duplicate {
        LibraryIntent::DuplicatePage {
            source_page_id: page_id.clone(),
            destination,
        }
    } else {
        LibraryIntent::MovePage {
            page_id: page_id.clone(),
            destination,
        }
    };
    let response = client
        .library_apply(
            Some(&project.id),
            ModuleApplyRequest {
                version: LIBRARY_CONTRACT_VERSION,
                operation_id,
                store_epoch: StoreEpoch(client.handshake.store_epoch.clone()),
                intent,
            },
        )
        .map_err(map_client_error)?;
    let committed = match response.0 {
        ResponseEnvelope::Ok(committed) => committed,
        ResponseEnvelope::Error(error) => return Err(map_core_error(error)),
    };
    let mut result = if duplicate {
        let copied = committed.value.page_copy.as_ref().ok_or_else(|| {
            CliError::new(
                CliErrorCode::Internal,
                "Core semantic Page duplication omitted its exact result",
            )
        })?;
        json!({
            "operation_id": committed.receipt.mutation.operation_id,
            "duplicate": committed.receipt.mutation.duplicate,
            "source_page_id": copied.source_page_id,
            "page_id": copied.page_id,
            "document_id": copied.document_id,
            "generation": copied.document_generation,
            "head_seq": copied.document_head_seq,
            "event_sequence": committed.event_sequence,
            "affected": {
                "page_ids": committed.receipt.affected_page_ids,
                "block_ids": copied.block_ids,
                "document_ids": copied.document_ids,
            },
            "etags": {
                "title": copied.title_etag,
                "body": copied.body_etag,
            },
        })
    } else {
        let moved = committed.value.block_transfer.as_ref().ok_or_else(|| {
            CliError::new(
                CliErrorCode::Internal,
                "Core semantic Page movement omitted its exact result",
            )
        })?;
        let page_etag = moved.page_etags.get(&page_id).ok_or_else(|| {
            CliError::new(
                CliErrorCode::Internal,
                "Core semantic Page movement omitted its Page shell ETag",
            )
        })?;
        json!({
            "operation_id": committed.receipt.mutation.operation_id,
            "duplicate": committed.receipt.mutation.duplicate,
            "page_id": page_id,
            "event_sequence": committed.event_sequence,
            "affected": {
                "page_ids": committed.receipt.affected_page_ids,
                "database_ids": committed.receipt.affected_database_ids,
                "document_ids": moved.document_commits.iter().map(|commit| &commit.document_id).collect::<Vec<_>>(),
                "location": moved.final_locations.get(&page_id),
            },
            "etags": { "page": page_etag },
        })
    };
    maybe_include_commit(&mut result, &arguments.mutation.r#return, &committed.value)?;
    Ok(CommandOutput::Json(result))
}

pub(crate) fn delete_page(
    client: &CoreClient,
    explicit_project: Option<&str>,
    cwd: &Path,
    arguments: PageDeleteArgs,
    json_output: bool,
) -> Result<CommandOutput, CliError> {
    validate_return_fields(&arguments.mutation.r#return)?;
    let project = selected_project(client, explicit_project, cwd)?;
    let page_id = resolve_page_selector(client, &project.id, &arguments.page)?;
    let operation_id = operation_id(arguments.mutation.idempotency_key.as_deref(), json_output)?;
    let response = client
        .library_apply(
            Some(&project.id),
            ModuleApplyRequest {
                version: LIBRARY_CONTRACT_VERSION,
                operation_id,
                store_epoch: StoreEpoch(client.handshake.store_epoch.clone()),
                intent: LibraryIntent::DeletePage {
                    page_id: page_id.clone(),
                    expected_etag: arguments.if_match,
                },
            },
        )
        .map_err(map_client_error)?;
    let committed = match response.0 {
        ResponseEnvelope::Ok(committed) => committed,
        ResponseEnvelope::Error(error) => return Err(map_core_error(error)),
    };
    let lifecycle = committed.value.page_lifecycle.as_ref().ok_or_else(|| {
        CliError::new(
            CliErrorCode::Internal,
            "Core semantic Page deletion omitted its lifecycle receipt",
        )
    })?;
    let mut result = json!({
        "operation_id": committed.receipt.mutation.operation_id,
        "duplicate": committed.receipt.mutation.duplicate,
        "page_id": page_id,
        "lifecycle": lifecycle.lifecycle,
        "metadata_revision": lifecycle.metadata_revision,
        "parent_revision": lifecycle.parent_revision,
        "event_sequence": committed.event_sequence,
        "affected": {
            "page_ids": committed.receipt.affected_page_ids,
            "database_ids": committed.receipt.affected_database_ids,
        },
    });
    maybe_include_commit(&mut result, &arguments.mutation.r#return, &committed.value)?;
    Ok(CommandOutput::Json(result))
}

fn placement_anchor(
    arguments: &PageTransferArgs,
) -> Result<Option<LibraryAgentSiblingAnchor>, CliError> {
    if let Some(at) = arguments.at {
        return Ok(Some(match at {
            BoundaryPlacement::Start => LibraryAgentSiblingAnchor::Start,
            BoundaryPlacement::End => LibraryAgentSiblingAnchor::End,
        }));
    }
    if let Some(block_id) = arguments.before.as_deref() {
        return Ok(Some(LibraryAgentSiblingAnchor::Before {
            block_id: stable_id(block_id, "--before")?,
        }));
    }
    arguments
        .after
        .as_deref()
        .map(|block_id| {
            stable_id(block_id, "--after")
                .map(|block_id| LibraryAgentSiblingAnchor::After { block_id })
        })
        .transpose()
}

fn resolve_page_destination(
    client: &CoreClient,
    project: &ProjectWorkspaceProject,
    selector: &str,
    at: Option<LibraryAgentSiblingAnchor>,
) -> Result<LibraryPageWriteDestination, CliError> {
    let unprefixed = selector.strip_prefix('@').unwrap_or(selector);
    if selector == "library" || unprefixed == client.handshake.library_id {
        return Ok(LibraryPageWriteDestination::Library { at });
    }
    if selector == "database" || unprefixed == project.database_id {
        return Ok(LibraryPageWriteDestination::DataSource {
            data_source_id: primary_data_source(client, project)?,
            at,
        });
    }
    if let Some(data_source_id) = selector.strip_prefix("data_source:") {
        return Ok(LibraryPageWriteDestination::DataSource {
            data_source_id: stable_id(data_source_id, "Data Source owner")?,
            at,
        });
    }
    if selector.starts_with('@') {
        let page = unwrap_library(client.library_read(
            Some(&project.id),
            LibraryRead::PageLifecyclePreflight {
                page_id: unprefixed.to_owned(),
            },
        ))?;
        let LibraryReadValue::PageLifecyclePreflight { value } = page.value else {
            return Err(internal("Core returned the wrong Page owner preflight"));
        };
        if value.page.is_some_and(|page| page.lifecycle == "active") {
            return Ok(LibraryPageWriteDestination::Page {
                page_id: unprefixed.to_owned(),
                at,
            });
        }
        let database = client
            .database_read(
                Some(&project.id),
                DatabaseRead {
                    target: DatabaseTarget::Database {
                        database_id: unprefixed.to_owned(),
                    },
                    mode: DatabaseReadMode::Database,
                    filter: None,
                    sort: None,
                },
            )
            .map_err(map_client_error)?;
        match database.0 {
            ResponseEnvelope::Ok(snapshot) => {
                let DatabaseReadValue::Database { value } = snapshot.value else {
                    return Err(internal("Core returned the wrong Database owner snapshot"));
                };
                return Ok(LibraryPageWriteDestination::DataSource {
                    data_source_id: active_data_source_id(&value)?,
                    at,
                });
            }
            ResponseEnvelope::Error(error) if error.code == CoreErrorCode::NotFound => {}
            ResponseEnvelope::Error(error) => return Err(map_core_error(error)),
        }
        let source = unwrap_database(client.database_read(
            Some(&project.id),
            DatabaseRead {
                target: DatabaseTarget::DataSource {
                    data_source_id: unprefixed.to_owned(),
                },
                mode: DatabaseReadMode::DataSource,
                filter: None,
                sort: None,
            },
        ))?;
        let DatabaseReadValue::DataSource { value } = source.value else {
            return Err(internal(
                "Core returned the wrong Data Source owner snapshot",
            ));
        };
        let data_source_id = value
            .pointer("/dataSource/dataSourceId")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| internal("Core Data Source owner has no stable identity"))?;
        return Ok(LibraryPageWriteDestination::DataSource {
            data_source_id: data_source_id.to_owned(),
            at,
        });
    }
    Ok(LibraryPageWriteDestination::Page {
        page_id: resolve_page_selector(client, &project.id, selector)?,
        at,
    })
}

fn primary_data_source(
    client: &CoreClient,
    project: &ProjectWorkspaceProject,
) -> Result<String, CliError> {
    let snapshot = unwrap_database(client.database_read(
        Some(&project.id),
        DatabaseRead {
            target: DatabaseTarget::Database {
                database_id: project.database_id.clone(),
            },
            mode: DatabaseReadMode::Database,
            filter: None,
            sort: None,
        },
    ))?;
    let DatabaseReadValue::Database { value } = snapshot.value else {
        return Err(internal(
            "Core returned the wrong primary Database snapshot",
        ));
    };
    active_data_source_id(&value)
}

fn active_data_source_id(value: &serde_json::Value) -> Result<String, CliError> {
    value
        .get("dataSources")
        .and_then(serde_json::Value::as_array)
        .and_then(|sources| {
            sources.iter().find(|source| {
                source.get("lifecycle").and_then(serde_json::Value::as_str) == Some("active")
            })
        })
        .and_then(|source| source.get("dataSourceId"))
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| {
            CliError::new(
                CliErrorCode::ScopeNotFound,
                "the selected Database has no active Data Source",
            )
        })
}

fn stable_id(value: &str, label: &str) -> Result<String, CliError> {
    let value = value.strip_prefix('@').unwrap_or(value);
    if value.is_empty() || value.len() > 512 || value.trim() != value {
        return Err(CliError::new(
            CliErrorCode::InvalidInput,
            format!("{label} must contain one bounded stable identity"),
        ));
    }
    Ok(value.to_owned())
}

fn maybe_include_commit(
    result: &mut serde_json::Value,
    fields: &[String],
    commit: &nodex_core_contracts::library::LibraryCommitValue,
) -> Result<(), CliError> {
    if !fields.iter().any(|field| field == "commit") {
        return Ok(());
    }
    result.as_object_mut().expect("result object").insert(
        "commit".to_owned(),
        serde_json::to_value(commit).map_err(internal)?,
    );
    Ok(())
}

fn internal(error: impl std::fmt::Display) -> CliError {
    CliError::new(CliErrorCode::Internal, error.to_string())
}
