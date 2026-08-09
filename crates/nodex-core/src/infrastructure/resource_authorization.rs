//! Canonical read authorization and transaction-scoped visibility capture.

use nodex_core_contracts::BoundModuleContext;
use nodex_core_contracts::StoreEpoch;
use nodex_core_contracts::events::{
    AuthorizedReadStamp, DeliveryAddress, DeliveryAuthorizationScope, ResourceKey,
};
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use sha2::{Digest, Sha256};

use super::sqlite::{StoreError, StoreErrorCode};

pub(crate) trait AuthorizationGraphView {
    fn connection(&self) -> &Connection;
}

pub(crate) struct CurrentGraphView<'connection> {
    connection: &'connection Connection,
}

#[derive(Serialize)]
struct CanonicalAuthorizedReadStamp<'a> {
    hash_version: u32,
    store_epoch: &'a StoreEpoch,
    delivery_address: &'a DeliveryAddress,
    authorization_scope: &'a DeliveryAuthorizationScope,
    subject: &'a ResourceKey,
    request_dependencies: &'a [ResourceKey],
    authorization_dependencies: &'a [ResourceKey],
    covered_commit_seq: i64,
}

impl<'connection> CurrentGraphView<'connection> {
    pub(crate) fn new(connection: &'connection Connection) -> Self {
        Self { connection }
    }
}

impl AuthorizationGraphView for CurrentGraphView<'_> {
    fn connection(&self) -> &Connection {
        self.connection
    }
}

pub(crate) fn can_read(
    connection: &Connection,
    context: &BoundModuleContext,
    scope: &DeliveryAuthorizationScope,
    resource: &ResourceKey,
) -> Result<bool, StoreError> {
    can_read_in_view(&CurrentGraphView::new(connection), context, scope, resource)
}

pub(crate) fn issue_read_stamp(
    connection: &Connection,
    context: &BoundModuleContext,
    store_epoch: StoreEpoch,
    covered_commit_seq: i64,
    subject: ResourceKey,
    mut request_dependencies: Vec<ResourceKey>,
    mut authorization_dependencies: Vec<ResourceKey>,
) -> Result<AuthorizedReadStamp, StoreError> {
    if covered_commit_seq < 0 {
        return Err(corrupt("Authorized read commit floor is invalid"));
    }
    request_dependencies.sort();
    request_dependencies.dedup();
    authorization_dependencies.sort();
    authorization_dependencies.dedup();
    if request_dependencies.is_empty() || authorization_dependencies.is_empty() {
        return Err(corrupt("Authorized read dependencies are empty"));
    }
    let authorization_scope = match &context.project_id {
        Some(project_id) => DeliveryAuthorizationScope::Project {
            library_id: context.library_id.0.clone(),
            project_id: project_id.0.clone(),
        },
        None => DeliveryAuthorizationScope::Library {
            library_id: context.library_id.0.clone(),
        },
    };
    let delivery_address = match &authorization_scope {
        DeliveryAuthorizationScope::Library { library_id } => DeliveryAddress::Library {
            library_id: library_id.clone(),
        },
        DeliveryAuthorizationScope::Project {
            library_id,
            project_id,
        } => DeliveryAddress::Project {
            library_id: library_id.clone(),
            project_id: project_id.clone(),
        },
        DeliveryAuthorizationScope::Document { .. } => {
            return Err(corrupt("Library read used a Document authorization scope"));
        }
    };
    for resource in &authorization_dependencies {
        if !can_read(connection, context, &authorization_scope, resource)? {
            return Err(StoreError::new(
                StoreErrorCode::Unauthorized,
                format!(
                    "Canonical read authorization changed before stamp issuance for {resource:?}"
                ),
                false,
            ));
        }
    }
    let encoded = serde_json::to_vec(&CanonicalAuthorizedReadStamp {
        hash_version: 1,
        store_epoch: &store_epoch,
        delivery_address: &delivery_address,
        authorization_scope: &authorization_scope,
        subject: &subject,
        request_dependencies: &request_dependencies,
        authorization_dependencies: &authorization_dependencies,
        covered_commit_seq,
    })
    .map_err(|_| corrupt("Authorized read stamp input is invalid"))?;
    Ok(AuthorizedReadStamp {
        store_epoch,
        delivery_address,
        authorization_scope,
        subject,
        request_dependencies,
        authorization_dependencies,
        covered_commit_seq,
        stamp_hash: format!("{:x}", Sha256::digest(encoded)),
    })
}

pub(crate) fn can_read_in_view(
    view: &impl AuthorizationGraphView,
    context: &BoundModuleContext,
    scope: &DeliveryAuthorizationScope,
    resource: &ResourceKey,
) -> Result<bool, StoreError> {
    let connection = view.connection();
    if scope_library_id(scope) != context.library_id.0 {
        return Ok(false);
    }
    match resource {
        ResourceKey::Library { library_id } => Ok(library_id == &context.library_id.0),
        ResourceKey::Project { project_id } => {
            project_is_authorized(connection, scope, &context.library_id.0, project_id)
        }
        ResourceKey::Page { page_id } => page_is_authorized(connection, scope, context, page_id),
        ResourceKey::Document { document_id } => {
            document_is_authorized(connection, scope, context, document_id)
        }
        ResourceKey::Database { database_id } => {
            database_is_authorized(connection, scope, context, database_id)
        }
        ResourceKey::DataSource { data_source_id } => {
            let coordinates = connection
                .query_row(
                    "SELECT library_id, home_database_block_id FROM data_sources
                     WHERE id = ?1 AND lifecycle = 'active'",
                    [data_source_id],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
                )
                .optional()?;
            let Some((library_id, database_id)) = coordinates else {
                return Ok(false);
            };
            if library_id != context.library_id.0 {
                return Ok(false);
            }
            database_is_authorized(connection, scope, context, &database_id)
        }
        ResourceKey::View { view_id } => {
            let database_id = connection
                .query_row(
                    "SELECT database_block_id FROM database_views
                     WHERE id = ?1 AND lifecycle = 'active'",
                    [view_id],
                    |row| row.get::<_, String>(0),
                )
                .optional()?;
            let Some(database_id) = database_id else {
                return Ok(false);
            };
            database_is_authorized(connection, scope, context, &database_id)
        }
        ResourceKey::Canvas { canvas_id } => {
            canvas_is_authorized(connection, scope, context, canvas_id)
        }
    }
}

fn project_is_authorized(
    connection: &Connection,
    scope: &DeliveryAuthorizationScope,
    library_id: &str,
    project_id: &str,
) -> Result<bool, StoreError> {
    let belongs = connection.query_row(
        "SELECT EXISTS(
           SELECT 1 FROM projects
           WHERE id = ?1 AND library_id = ?2 AND lifecycle = 'active'
         )",
        params![project_id, library_id],
        |row| row.get::<_, i64>(0),
    )? == 1;
    if !belongs {
        return Ok(false);
    }
    Ok(match scope {
        DeliveryAuthorizationScope::Library { .. } => true,
        DeliveryAuthorizationScope::Project {
            project_id: scope_project_id,
            ..
        } => scope_project_id == project_id,
        DeliveryAuthorizationScope::Document {
            project_id: Some(scope_project_id),
            ..
        } => scope_project_id == project_id,
        DeliveryAuthorizationScope::Document {
            project_id: None, ..
        } => false,
    })
}

fn page_is_authorized(
    connection: &Connection,
    scope: &DeliveryAuthorizationScope,
    context: &BoundModuleContext,
    page_id: &str,
) -> Result<bool, StoreError> {
    let page = connection
        .query_row(
            "SELECT document_id FROM pages
             WHERE block_id = ?1 AND library_id = ?2 AND lifecycle = 'active'",
            params![page_id, context.library_id.0],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    let Some(document_id) = page else {
        return Ok(false);
    };
    match scope {
        DeliveryAuthorizationScope::Library { .. } => Ok(true),
        DeliveryAuthorizationScope::Project { project_id, .. } => {
            match crate::library::require_page_read_access(
                connection,
                &context.library_id.0,
                project_id,
                page_id,
            ) {
                Ok(()) => Ok(true),
                Err(error)
                    if matches!(
                        error.code,
                        StoreErrorCode::NotFound | StoreErrorCode::Unauthorized
                    ) =>
                {
                    Ok(false)
                }
                Err(error) => Err(error),
            }
        }
        DeliveryAuthorizationScope::Document {
            document_id: scope_document_id,
            ..
        } => Ok(scope_document_id == &document_id),
    }
}

fn document_is_authorized(
    connection: &Connection,
    scope: &DeliveryAuthorizationScope,
    context: &BoundModuleContext,
    document_id: &str,
) -> Result<bool, StoreError> {
    let belongs = connection.query_row(
        "SELECT EXISTS(
           SELECT 1 FROM documents document
           JOIN projects project ON project.id = document.project_id
           WHERE document.id = ?1 AND project.library_id = ?2
         )",
        params![document_id, context.library_id.0],
        |row| row.get::<_, i64>(0),
    )? == 1;
    if !belongs {
        return Ok(false);
    }
    if matches!(scope, DeliveryAuthorizationScope::Library { .. }) {
        return Ok(true);
    }
    if let DeliveryAuthorizationScope::Document {
        document_id: scope_document_id,
        ..
    } = scope
        && scope_document_id != document_id
    {
        return Ok(false);
    }
    match crate::document::require_owned_document_read_access(connection, context, document_id) {
        Ok(()) => Ok(true),
        Err(error)
            if matches!(
                error.code,
                StoreErrorCode::NotFound | StoreErrorCode::Unauthorized
            ) =>
        {
            Ok(false)
        }
        Err(error) => Err(error),
    }
}

fn database_is_authorized(
    connection: &Connection,
    scope: &DeliveryAuthorizationScope,
    context: &BoundModuleContext,
    database_id: &str,
) -> Result<bool, StoreError> {
    let owner_project_id = connection
        .query_row(
            "SELECT block.project_id FROM blocks block
           JOIN projects project ON project.id = block.project_id
           JOIN database_containers container ON container.block_id = block.id
           WHERE block.id = ?1 AND project.library_id = ?2
             AND block.lifecycle = 'active'",
            params![database_id, context.library_id.0],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    let Some(owner_project_id) = owner_project_id else {
        return Ok(false);
    };
    if matches!(scope, DeliveryAuthorizationScope::Library { .. }) {
        return Ok(true);
    }
    let Some(project_id) = scope_project_id(scope) else {
        return Ok(false);
    };
    if project_id == owner_project_id {
        return Ok(true);
    }
    let primary = match crate::database::authorization::project_primary_database(
        connection,
        &context.library_id.0,
        project_id,
    ) {
        Ok(primary) => primary,
        Err(error) if authorization_miss(&error) => return Ok(false),
        Err(error) => return Err(error),
    };
    match crate::database::authorization::authorize_database(
        connection,
        project_id,
        primary.as_deref(),
        database_id,
    ) {
        Ok(authorized) => Ok(authorized),
        Err(error) if authorization_miss(&error) => Ok(false),
        Err(error) => Err(error),
    }
}

fn canvas_is_authorized(
    connection: &Connection,
    scope: &DeliveryAuthorizationScope,
    context: &BoundModuleContext,
    canvas_id: &str,
) -> Result<bool, StoreError> {
    let row = connection
        .query_row(
            "SELECT block.project_id, ownership.document_id, host_page.block_id
             FROM canvas_owners canvas
             JOIN blocks block ON block.id = canvas.block_id
             JOIN block_documents ownership ON ownership.block_id = block.id
             LEFT JOIN pages host_page
               ON host_page.document_id = block.containing_document_id
             WHERE block.id = ?1 AND canvas.library_id = ?2
               AND block.type = 'canvas' AND block.lifecycle = 'active'",
            params![canvas_id, context.library_id.0],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            },
        )
        .optional()?;
    let Some((owner_project_id, document_id, host_page_id)) = row else {
        return Ok(false);
    };
    match scope {
        DeliveryAuthorizationScope::Library { .. } => Ok(true),
        DeliveryAuthorizationScope::Project { project_id, .. } => {
            if project_id == &owner_project_id {
                return Ok(true);
            }
            let Some(page_id) = host_page_id else {
                return Ok(false);
            };
            match crate::library::require_page_read_access(
                connection,
                &context.library_id.0,
                project_id,
                &page_id,
            ) {
                Ok(()) => Ok(true),
                Err(error)
                    if matches!(
                        error.code,
                        StoreErrorCode::NotFound | StoreErrorCode::Unauthorized
                    ) =>
                {
                    Ok(false)
                }
                Err(error) => Err(error),
            }
        }
        DeliveryAuthorizationScope::Document {
            document_id: scope_document_id,
            ..
        } => Ok(scope_document_id == &document_id),
    }
}

fn scope_library_id(scope: &DeliveryAuthorizationScope) -> &str {
    match scope {
        DeliveryAuthorizationScope::Library { library_id }
        | DeliveryAuthorizationScope::Project { library_id, .. }
        | DeliveryAuthorizationScope::Document { library_id, .. } => library_id,
    }
}

fn scope_project_id(scope: &DeliveryAuthorizationScope) -> Option<&str> {
    match scope {
        DeliveryAuthorizationScope::Project { project_id, .. }
        | DeliveryAuthorizationScope::Document {
            project_id: Some(project_id),
            ..
        } => Some(project_id),
        DeliveryAuthorizationScope::Library { .. }
        | DeliveryAuthorizationScope::Document {
            project_id: None, ..
        } => None,
    }
}

fn authorization_miss(error: &StoreError) -> bool {
    matches!(
        error.code,
        StoreErrorCode::NotFound | StoreErrorCode::Unauthorized
    )
}

fn corrupt(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message, false)
}
