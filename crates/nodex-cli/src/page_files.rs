use std::fs::{self, File};
use std::io::{self, Cursor, Read, Write};
use std::path::Path;

use nodex_core_contracts::library::{
    LIBRARY_CONTRACT_VERSION, LibraryIntent, LibraryPageFileChange, LibraryPageFileManifest,
    LibraryPageFileSummary, LibraryRead, LibraryReadValue,
};
use nodex_core_contracts::{ModuleApplyRequest, StoreEpoch};
use nodex_core_protocol::client::CoreClient;
use nodex_core_protocol::{LibraryApplyResponse, ResponseEnvelope};
use serde_json::json;
use sha2::{Digest, Sha256};

use crate::cli::{
    PageFileDeleteArgs, PageFileListArgs, PageFilePutArgs, PageFileReadArgs, PageFileRenameArgs,
    PageFileRestoreArgs, PageFileVersionsArgs,
};
use crate::error::{CliError, CliErrorCode};
use crate::runtime::{
    CommandOutput, map_client_error, map_core_error, operation_id, resolve_page_selector,
    selected_project, unwrap_library,
};

const MAX_PAGE_FILES_PER_COMMAND: usize = 10_000;

pub(crate) fn list(
    client: &CoreClient,
    explicit_project: Option<&str>,
    cwd: &Path,
    arguments: PageFileListArgs,
) -> Result<CommandOutput, CliError> {
    let (project_id, page_id) = resolve_page(client, explicit_project, cwd, &arguments.page)?;
    let snapshot = read_manifest(
        client,
        &project_id,
        &page_id,
        arguments.after,
        arguments.limit,
        arguments.include_deleted,
    )?;
    Ok(CommandOutput::Json(json!({
        "page_id": snapshot.page_id,
        "manifest_revision": snapshot.revision,
        "files": snapshot.files,
        "next_cursor": snapshot.next_cursor,
        "has_more": snapshot.has_more,
        "total": snapshot.total,
    })))
}

pub(crate) fn read(
    client: &CoreClient,
    explicit_project: Option<&str>,
    cwd: &Path,
    arguments: PageFileReadArgs,
) -> Result<CommandOutput, CliError> {
    if arguments.version.is_some_and(|version| version < 1) {
        return Err(invalid("File version must be positive"));
    }
    let (project_id, page_id) = resolve_page(client, explicit_project, cwd, &arguments.page)?;
    let file = resolve_file(client, &project_id, &page_id, &arguments.file, true)?;
    let blob = client
        .read_page_file_blob(
            Some(&project_id),
            &page_id,
            &file.file_id,
            arguments.version,
        )
        .map_err(map_client_error)?;
    if arguments.output == Path::new("-") {
        return Ok(CommandOutput::Bytes(blob.bytes));
    }
    write_output_file(&arguments.output, &blob.bytes)?;
    Ok(CommandOutput::Json(json!({
        "page_id": page_id,
        "file_id": file.file_id,
        "logical_path": file.logical_path,
        "version": arguments.version.unwrap_or(file.version),
        "byte_length": blob.bytes.len(),
        "mime_type": blob.mime_type,
        "etag": blob.etag,
        "output": arguments.output,
    })))
}

pub(crate) fn put(
    client: &CoreClient,
    explicit_project: Option<&str>,
    cwd: &Path,
    arguments: PageFilePutArgs,
    json_output: bool,
) -> Result<CommandOutput, CliError> {
    reject_return_fields(&arguments.mutation.r#return)?;
    let (project_id, page_id) = resolve_page(client, explicit_project, cwd, &arguments.page)?;
    let operation_id = operation_id(arguments.mutation.idempotency_key.as_deref(), json_output)?;
    let mime_type = arguments
        .mime
        .unwrap_or_else(|| infer_mime_type(&arguments.path).to_owned());
    let prepared = if arguments.source == Path::new("-") {
        let mut bytes = Vec::new();
        io::stdin()
            .lock()
            .take((nodex_core_protocol::MAX_PAGE_FILE_BLOB_BYTES + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(io_error)?;
        if bytes.len() > nodex_core_protocol::MAX_PAGE_FILE_BLOB_BYTES {
            return Err(invalid("Page File stdin exceeds the 64 MiB limit"));
        }
        client
            .prepare_page_file_blob(
                Some(&project_id),
                &operation_id,
                &client.handshake.store_epoch,
                Some(&arguments.path),
                &mut Cursor::new(bytes.as_slice()),
                bytes.len() as u64,
            )
            .map_err(map_client_error)?
    } else {
        let metadata = fs::symlink_metadata(&arguments.source).map_err(io_error)?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(invalid("Page File source must be one regular file"));
        }
        let mut source = File::open(&arguments.source).map_err(io_error)?;
        client
            .prepare_page_file_blob(
                Some(&project_id),
                &operation_id,
                &client.handshake.store_epoch,
                Some(&arguments.path),
                &mut source,
                metadata.len(),
            )
            .map_err(map_client_error)?
    };
    let file_id = file_id_for_operation(&operation_id);
    apply_put(
        client,
        &project_id,
        &page_id,
        operation_id,
        file_id,
        arguments.path,
        mime_type,
        prepared.receipt_id,
        arguments.turn_id,
    )
}

pub(crate) fn rename(
    client: &CoreClient,
    explicit_project: Option<&str>,
    cwd: &Path,
    arguments: PageFileRenameArgs,
    json_output: bool,
) -> Result<CommandOutput, CliError> {
    reject_return_fields(&arguments.mutation.r#return)?;
    let (project_id, page_id) = resolve_page(client, explicit_project, cwd, &arguments.page)?;
    let file = resolve_file(client, &project_id, &page_id, &arguments.file, false)?;
    let manifest = read_manifest(client, &project_id, &page_id, None, Some(100), false)?;
    apply(
        client,
        &project_id,
        &page_id,
        manifest.revision,
        operation_id(arguments.mutation.idempotency_key.as_deref(), json_output)?,
        LibraryPageFileChange::Rename {
            file_id: file.file_id,
            expected_version: file.version,
            logical_path: arguments.path,
        },
        arguments.turn_id,
    )
}

pub(crate) fn delete(
    client: &CoreClient,
    explicit_project: Option<&str>,
    cwd: &Path,
    arguments: PageFileDeleteArgs,
    json_output: bool,
) -> Result<CommandOutput, CliError> {
    reject_return_fields(&arguments.mutation.r#return)?;
    let (project_id, page_id) = resolve_page(client, explicit_project, cwd, &arguments.page)?;
    let file = resolve_file(client, &project_id, &page_id, &arguments.file, false)?;
    let manifest = read_manifest(client, &project_id, &page_id, None, Some(100), false)?;
    apply(
        client,
        &project_id,
        &page_id,
        manifest.revision,
        operation_id(arguments.mutation.idempotency_key.as_deref(), json_output)?,
        LibraryPageFileChange::Delete {
            file_id: file.file_id,
            expected_version: file.version,
        },
        arguments.turn_id,
    )
}

pub(crate) fn versions(
    client: &CoreClient,
    explicit_project: Option<&str>,
    cwd: &Path,
    arguments: PageFileVersionsArgs,
) -> Result<CommandOutput, CliError> {
    let (project_id, page_id) = resolve_page(client, explicit_project, cwd, &arguments.page)?;
    let file = resolve_file(client, &project_id, &page_id, &arguments.file, true)?;
    let snapshot = unwrap_library(client.library_read(
        Some(&project_id),
        LibraryRead::PageFileVersions {
            page_id,
            file_id: file.file_id,
            cursor: arguments.after,
            limit: arguments.limit,
        },
    ))?;
    let LibraryReadValue::PageFileVersions { value } = snapshot.value else {
        return Err(internal(
            "Core returned the wrong Page File versions snapshot",
        ));
    };
    Ok(CommandOutput::Json(
        serde_json::to_value(value).map_err(json_error)?,
    ))
}

pub(crate) fn restore(
    client: &CoreClient,
    explicit_project: Option<&str>,
    cwd: &Path,
    arguments: PageFileRestoreArgs,
    json_output: bool,
) -> Result<CommandOutput, CliError> {
    reject_return_fields(&arguments.mutation.r#return)?;
    if arguments.version < 1 {
        return Err(invalid("File version must be positive"));
    }
    let (project_id, page_id) = resolve_page(client, explicit_project, cwd, &arguments.page)?;
    let file = resolve_file(client, &project_id, &page_id, &arguments.file, true)?;
    let manifest = read_manifest(client, &project_id, &page_id, None, Some(100), true)?;
    apply(
        client,
        &project_id,
        &page_id,
        manifest.revision,
        operation_id(arguments.mutation.idempotency_key.as_deref(), json_output)?,
        LibraryPageFileChange::RestoreVersion {
            file_id: file.file_id,
            expected_version: file.version,
            source_version: arguments.version,
        },
        arguments.turn_id,
    )
}

fn apply(
    client: &CoreClient,
    project_id: &str,
    page_id: &str,
    expected_manifest_revision: i64,
    operation_id: String,
    change: LibraryPageFileChange,
    turn_id: Option<String>,
) -> Result<CommandOutput, CliError> {
    let response = client
        .library_apply(
            Some(project_id),
            ModuleApplyRequest {
                contract_version: LIBRARY_CONTRACT_VERSION,
                operation_id,
                store_epoch: StoreEpoch(client.handshake.store_epoch.clone()),
                intent: LibraryIntent::ApplyPageFileChanges {
                    page_id: page_id.to_owned(),
                    expected_manifest_revision,
                    changes: vec![change],
                    turn_id,
                },
            },
        )
        .map_err(map_client_error)?;
    page_file_apply_output(response)
}

fn page_file_apply_output(response: LibraryApplyResponse) -> Result<CommandOutput, CliError> {
    let committed = match response.0 {
        ResponseEnvelope::Ok(committed) => committed,
        ResponseEnvelope::Error(error) => return Err(map_core_error(error)),
    };
    let receipt =
        committed.outcome().page_files.as_ref().ok_or_else(|| {
            internal("Core Page File mutation omitted its exact Page Files receipt")
        })?;
    Ok(CommandOutput::Json(json!({
        "operation_id": committed.receipt().mutation.operation_id,
        "duplicate": committed.receipt().mutation.duplicate,
        "page_id": receipt.page_id,
        "manifest_revision": receipt.manifest_revision,
        "created_file_ids": receipt.created_file_ids,
        "updated_file_ids": receipt.updated_file_ids,
        "deleted_file_ids": receipt.deleted_file_ids,
        "commit_seq": committed.commit_cursor(),
    })))
}

#[allow(clippy::too_many_arguments)]
fn apply_put(
    client: &CoreClient,
    project_id: &str,
    page_id: &str,
    operation_id: String,
    file_id: String,
    logical_path: String,
    mime_type: String,
    prepared_blob_receipt_id: String,
    turn_id: Option<String>,
) -> Result<CommandOutput, CliError> {
    let response = client
        .library_apply(
            Some(project_id),
            ModuleApplyRequest {
                contract_version: LIBRARY_CONTRACT_VERSION,
                operation_id,
                store_epoch: StoreEpoch(client.handshake.store_epoch.clone()),
                intent: LibraryIntent::PutPageFile {
                    page_id: page_id.to_owned(),
                    file_id,
                    logical_path,
                    mime_type,
                    prepared_blob_receipt_id,
                    turn_id,
                },
            },
        )
        .map_err(map_client_error)?;
    page_file_apply_output(response)
}

fn resolve_page(
    client: &CoreClient,
    explicit_project: Option<&str>,
    cwd: &Path,
    selector: &str,
) -> Result<(String, String), CliError> {
    let project = selected_project(client, explicit_project, cwd)?;
    let page_id = resolve_page_selector(client, &project.id, selector)?;
    Ok((project.id, page_id))
}

fn read_manifest(
    client: &CoreClient,
    project_id: &str,
    page_id: &str,
    cursor: Option<String>,
    limit: Option<u32>,
    include_deleted: bool,
) -> Result<LibraryPageFileManifest, CliError> {
    let snapshot = unwrap_library(client.library_read(
        Some(project_id),
        LibraryRead::PageFiles {
            page_id: page_id.to_owned(),
            query: None,
            cursor,
            limit,
            include_deleted: include_deleted.then_some(true),
        },
    ))?;
    let LibraryReadValue::PageFiles { value } = snapshot.value else {
        return Err(internal("Core returned the wrong Page Files snapshot"));
    };
    Ok(*value)
}

fn find_all_files(
    client: &CoreClient,
    project_id: &str,
    page_id: &str,
    include_deleted: bool,
) -> Result<Vec<LibraryPageFileSummary>, CliError> {
    let mut files = Vec::new();
    let mut cursor = None;
    loop {
        let manifest = read_manifest(
            client,
            project_id,
            page_id,
            cursor,
            Some(100),
            include_deleted,
        )?;
        files.extend(manifest.files);
        if files.len() > MAX_PAGE_FILES_PER_COMMAND {
            return Err(invalid(
                "Page File command exceeds the 10,000-entry resolution bound",
            ));
        }
        if !manifest.has_more {
            return Ok(files);
        }
        cursor = manifest.next_cursor;
        if cursor.is_none() {
            return Err(internal("Core Page Files pagination omitted its cursor"));
        }
    }
}

fn resolve_file(
    client: &CoreClient,
    project_id: &str,
    page_id: &str,
    selector: &str,
    include_deleted: bool,
) -> Result<LibraryPageFileSummary, CliError> {
    let matches = find_all_files(client, project_id, page_id, include_deleted)?
        .into_iter()
        .filter(|file| file.file_id == selector || file.logical_path == selector)
        .collect::<Vec<_>>();
    match matches.as_slice() {
        [file] => return Ok(file.clone()),
        [_, ..] => {
            return Err(invalid(
                "File selector matches both an identity and logical path",
            ));
        }
        [] => {}
    }
    let metadata = unwrap_library(client.library_read(
        Some(project_id),
        LibraryRead::PageFileMetadata {
            page_id: page_id.to_owned(),
            file_id: selector.to_owned(),
        },
    ))?;
    let LibraryReadValue::PageFileMetadata { value } = metadata.value else {
        return Err(internal(
            "Core returned the wrong Page File metadata snapshot",
        ));
    };
    Ok(*value)
}

fn write_output_file(path: &Path, bytes: &[u8]) -> Result<(), CliError> {
    if let Ok(metadata) = fs::symlink_metadata(path)
        && (metadata.file_type().is_symlink() || !metadata.is_file())
    {
        return Err(invalid("Page File output must be a regular file path"));
    }
    let mut output = File::create(path).map_err(io_error)?;
    output.write_all(bytes).map_err(io_error)?;
    output.sync_all().map_err(io_error)
}

fn file_id_for_operation(operation_id: &str) -> String {
    let digest = Sha256::digest(operation_id.as_bytes());
    format!("page-file:{}", hex::encode(&digest[..16]))
}

fn infer_mime_type(logical_path: &str) -> &'static str {
    let extension = Path::new(logical_path)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    match extension.as_str() {
        "md" | "mdx" => "text/markdown",
        "txt" | "log" => "text/plain",
        "json" => "application/json",
        "yaml" | "yml" => "application/yaml",
        "csv" => "text/csv",
        "html" | "htm" => "text/html",
        "css" => "text/css",
        "js" | "mjs" | "cjs" => "text/javascript",
        "ts" | "tsx" => "text/typescript",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "pdf" => "application/pdf",
        "zip" => "application/zip",
        _ => "application/octet-stream",
    }
}

fn reject_return_fields(fields: &[String]) -> Result<(), CliError> {
    if fields.is_empty() {
        return Ok(());
    }
    Err(invalid("Page File commands do not accept --return fields"))
}

fn invalid(message: impl Into<String>) -> CliError {
    CliError::new(CliErrorCode::InvalidInput, message)
}

fn internal(message: impl Into<String>) -> CliError {
    CliError::new(CliErrorCode::Internal, message)
}

fn io_error(error: io::Error) -> CliError {
    CliError::new(CliErrorCode::InvalidInput, error.to_string())
}

fn json_error(error: serde_json::Error) -> CliError {
    CliError::new(CliErrorCode::Internal, error.to_string())
}
