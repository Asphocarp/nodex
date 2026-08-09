//! Canonical read authorization and transaction-scoped visibility capture.

use std::collections::BTreeSet;

use nodex_core_contracts::events::{DeliveryAuthorizationScope, ResourceKey};
use nodex_core_contracts::{
    AdapterKind, BoundModuleContext, LibraryId, ProfileId, ProjectId, ResourceRevocation,
    ResourceRevocationReason, RevokedResourceKind,
};
use rusqlite::{Connection, OptionalExtension, params};

use super::durable_mutation::AuthorizedResourceObservation;
use super::local_commit::{self, CommitContext};
use super::sqlite::{StoreError, StoreErrorCode};

/// Captures the exact active Project scopes which can currently read the
/// supplied resources. Callers invoke this before canonical writes, then use
/// the same observations for projection audience closure and revocations.
pub(crate) fn capture_project_visibility(
    connection: &Connection,
    library_id: &str,
    resources: impl IntoIterator<Item = ResourceKey>,
) -> Result<Vec<AuthorizedResourceObservation>, StoreError> {
    let resources = resources.into_iter().collect::<BTreeSet<_>>();
    if resources.is_empty() {
        return Ok(Vec::new());
    }
    let project_ids = connection
        .prepare_cached(
            "SELECT id FROM projects
             WHERE library_id = ?1 AND lifecycle = 'active' ORDER BY id",
        )?
        .query_map([library_id], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut observations = BTreeSet::new();
    for project_id in project_ids {
        let scope = DeliveryAuthorizationScope::Project {
            library_id: library_id.to_owned(),
            project_id: project_id.clone(),
        };
        let context = project_context(library_id, &project_id);
        for resource in &resources {
            let Some((resource_kind, resource_id)) = revocable_identity(resource) else {
                continue;
            };
            if can_read(connection, &context, &scope, resource)? {
                observations.insert(AuthorizedResourceObservation {
                    authorization_scope: scope.clone(),
                    resource_kind,
                    resource_id: resource_id.to_owned(),
                });
            }
        }
    }
    Ok(observations.into_iter().collect())
}

/// Persists losses from an exact pre-state visibility capture. Authorization
/// is re-evaluated against canonical post-state in the same SQLite transaction.
pub(crate) fn record_losses(
    connection: &Connection,
    commit: &CommitContext,
    observations: &[AuthorizedResourceObservation],
    reason: ResourceRevocationReason,
) -> Result<(), StoreError> {
    for observation in observations {
        let resource = resource_from_observation(observation)?;
        let context = context_for_scope(&observation.authorization_scope);
        if can_read(
            connection,
            &context,
            &observation.authorization_scope,
            &resource,
        )? {
            continue;
        }
        local_commit::record_revocation(
            connection,
            commit,
            &ResourceRevocation {
                authorization_scope: observation.authorization_scope.clone(),
                resource_kind: observation.resource_kind,
                resource_id: observation.resource_id.clone(),
                reason,
            },
        )?;
    }
    Ok(())
}

pub(crate) fn can_read(
    connection: &Connection,
    context: &BoundModuleContext,
    scope: &DeliveryAuthorizationScope,
    resource: &ResourceKey,
) -> Result<bool, StoreError> {
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
    let belongs = connection.query_row(
        "SELECT EXISTS(
           SELECT 1 FROM blocks block
           JOIN projects project ON project.id = block.project_id
           JOIN database_containers container ON container.block_id = block.id
           WHERE block.id = ?1 AND project.library_id = ?2
             AND block.lifecycle = 'active'
         )",
        params![database_id, context.library_id.0],
        |row| row.get::<_, i64>(0),
    )? == 1;
    if !belongs {
        return Ok(false);
    }
    if matches!(scope, DeliveryAuthorizationScope::Library { .. }) {
        return Ok(true);
    }
    let Some(project_id) = scope_project_id(scope) else {
        return Ok(false);
    };
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

fn project_context(library_id: &str, project_id: &str) -> BoundModuleContext {
    BoundModuleContext {
        profile_id: ProfileId("profile:resource-authorization".to_owned()),
        library_id: LibraryId(library_id.to_owned()),
        project_id: Some(ProjectId(project_id.to_owned())),
        connection_id: "connection:resource-authorization".to_owned(),
        adapter: AdapterKind::Test,
    }
}

fn context_for_scope(scope: &DeliveryAuthorizationScope) -> BoundModuleContext {
    let library_id = scope_library_id(scope);
    let project_id = scope_project_id(scope);
    BoundModuleContext {
        profile_id: ProfileId("profile:resource-authorization".to_owned()),
        library_id: LibraryId(library_id.to_owned()),
        project_id: project_id.map(|id| ProjectId(id.to_owned())),
        connection_id: "connection:resource-authorization".to_owned(),
        adapter: AdapterKind::Test,
    }
}

fn revocable_identity(resource: &ResourceKey) -> Option<(RevokedResourceKind, &str)> {
    match resource {
        ResourceKey::Page { page_id } => Some((RevokedResourceKind::Page, page_id)),
        ResourceKey::Document { document_id } => Some((RevokedResourceKind::Document, document_id)),
        ResourceKey::Database { database_id } => Some((RevokedResourceKind::Database, database_id)),
        ResourceKey::DataSource { data_source_id } => {
            Some((RevokedResourceKind::DataSource, data_source_id))
        }
        ResourceKey::View { view_id } => Some((RevokedResourceKind::View, view_id)),
        ResourceKey::Canvas { canvas_id } => Some((RevokedResourceKind::Canvas, canvas_id)),
        ResourceKey::Library { .. } | ResourceKey::Project { .. } => None,
    }
}

fn resource_from_observation(
    observation: &AuthorizedResourceObservation,
) -> Result<ResourceKey, StoreError> {
    let resource_id = observation.resource_id.clone();
    let resource = match observation.resource_kind {
        RevokedResourceKind::Page => ResourceKey::Page {
            page_id: resource_id,
        },
        RevokedResourceKind::Document => ResourceKey::Document {
            document_id: resource_id,
        },
        RevokedResourceKind::Database => ResourceKey::Database {
            database_id: resource_id,
        },
        RevokedResourceKind::DataSource => ResourceKey::DataSource {
            data_source_id: resource_id,
        },
        RevokedResourceKind::View => ResourceKey::View {
            view_id: resource_id,
        },
        RevokedResourceKind::Canvas => ResourceKey::Canvas {
            canvas_id: resource_id,
        },
    };
    Ok(resource)
}

fn authorization_miss(error: &StoreError) -> bool {
    matches!(
        error.code,
        StoreErrorCode::NotFound | StoreErrorCode::Unauthorized
    )
}
