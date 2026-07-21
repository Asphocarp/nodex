use std::path::Path;

use nodex_core_contracts::library::{
    LIBRARY_CONTRACT_VERSION, LibraryIntent, LibraryRead, LibraryReadValue, LibraryWriteParent,
};
use nodex_core_contracts::{ModuleApplyRequest, StoreEpoch};
use nodex_core_protocol::ResponseEnvelope;
use nodex_core_protocol::client::CoreClient;
use serde_json::json;

use crate::cli::PageCreateArgs;
use crate::error::{CliError, CliErrorCode};
use crate::page_mutation::{
    MAX_BODY_INPUT_BYTES, read_content_input, validate_return_fields, validate_title,
};
use crate::runtime::{
    CommandOutput, map_client_error, map_core_error, operation_id, resolve_page_selector,
    selected_project, unwrap_library,
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
    let parent = resolve_write_parent(client, &project.id, &arguments.parent)?;
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
                    parent,
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

fn resolve_write_parent(
    client: &CoreClient,
    project_id: &str,
    selector: &str,
) -> Result<LibraryWriteParent, CliError> {
    let unprefixed = selector.strip_prefix('@').unwrap_or(selector);
    if selector == "library" || unprefixed == client.handshake.library_id {
        return Ok(LibraryWriteParent::Library { before: None });
    }
    let page_id = resolve_page_selector(client, project_id, selector)?;
    let snapshot = unwrap_library(client.library_read(
        Some(project_id),
        LibraryRead::PageLifecyclePreflight {
            page_id: page_id.clone(),
        },
    ))?;
    let LibraryReadValue::PageLifecyclePreflight { value } = snapshot.value else {
        return Err(internal("Core returned the wrong Page parent preflight"));
    };
    let page = value.page.ok_or_else(|| {
        CliError::new(
            CliErrorCode::ScopeNotFound,
            format!("Page parent @{page_id} is unavailable"),
        )
    })?;
    if page.lifecycle != "active" {
        return Err(CliError::new(
            CliErrorCode::ScopeNotFound,
            format!("Page parent @{page_id} is not active"),
        ));
    }
    Ok(LibraryWriteParent::Page {
        page_id,
        expected_document_generation: page.document.generation,
        expected_document_head_seq: page.document.head_seq,
        before: None,
    })
}

fn internal(error: impl std::fmt::Display) -> CliError {
    CliError::new(CliErrorCode::Internal, error.to_string())
}
