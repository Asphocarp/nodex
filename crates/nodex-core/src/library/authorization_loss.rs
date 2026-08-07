use std::collections::{BTreeSet, VecDeque};

use nodex_core_contracts::events::DeliveryAuthorizationScope;
use nodex_core_contracts::{
    AdapterKind, BoundModuleContext, LibraryId, ProfileId, ProjectId, ResourceRevocation,
    ResourceRevocationReason, RevokedResourceKind,
};
use rusqlite::{Connection, OptionalExtension, params};

use crate::infrastructure::durable_mutation::AuthorizedResourceObservation;
use crate::infrastructure::local_commit::{self, CommitContext};
use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
enum ClosureRoot {
    Page(String),
    Database(String),
    Canvas(String),
}

#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
struct ResourceKey {
    kind: RevokedResourceKind,
    id: String,
}

#[derive(Default)]
pub(super) struct AuthorizationRoots {
    pub page_ids: Vec<String>,
    pub database_ids: Vec<String>,
    pub canvas_ids: Vec<String>,
}

impl AuthorizationRoots {
    pub(super) fn page(page_id: impl Into<String>) -> Self {
        Self {
            page_ids: vec![page_id.into()],
            ..Self::default()
        }
    }

    pub(super) fn database(database_id: impl Into<String>) -> Self {
        Self {
            database_ids: vec![database_id.into()],
            ..Self::default()
        }
    }

    pub(super) fn canvas(canvas_id: impl Into<String>) -> Self {
        Self {
            canvas_ids: vec![canvas_id.into()],
            ..Self::default()
        }
    }

    pub(super) fn typed(kind: &str, resource_id: impl Into<String>) -> Result<Self, StoreError> {
        let resource_id = resource_id.into();
        match kind {
            "page" => Ok(Self::page(resource_id)),
            "database" => Ok(Self::database(resource_id)),
            "canvas" => Ok(Self::canvas(resource_id)),
            _ => Err(corrupt(
                "Authorization root has an unsupported resource kind",
            )),
        }
    }
}

pub(super) fn existing_typed_roots(
    connection: &Connection,
    library_id: &str,
    block_ids: &[String],
) -> Result<AuthorizationRoots, StoreError> {
    let mut roots = AuthorizationRoots::default();
    let mut statement = connection.prepare(
        "SELECT block.type FROM blocks block
         JOIN projects project ON project.id = block.project_id
         WHERE block.id = ?1 AND project.library_id = ?2
           AND block.lifecycle = 'active'",
    )?;
    for block_id in block_ids {
        let kind = statement
            .query_row(params![block_id, library_id], |row| row.get::<_, String>(0))
            .optional()?;
        match kind.as_deref() {
            Some("page") => roots.page_ids.push(block_id.clone()),
            Some("database") => roots.database_ids.push(block_id.clone()),
            Some("canvas") => roots.canvas_ids.push(block_id.clone()),
            Some(_) | None => {}
        }
    }
    Ok(roots)
}

/// Captures the complete, exact set of active resource scopes that may lose
/// visibility when the supplied ownership roots mutate. The snapshot is taken
/// before writes and contains no post-state inference.
pub(super) fn capture(
    connection: &Connection,
    library_id: &str,
    roots: AuthorizationRoots,
    restricted_project_ids: Option<&[String]>,
) -> Result<Vec<AuthorizedResourceObservation>, StoreError> {
    let resources = expand_active_resource_closure(connection, library_id, roots)?;
    if resources.is_empty() {
        return Ok(Vec::new());
    }

    let mut observations = BTreeSet::new();
    let library_scope = DeliveryAuthorizationScope::Library {
        library_id: library_id.to_owned(),
    };
    for resource in &resources {
        observations.insert(observation(&library_scope, resource));
        if resource.kind == RevokedResourceKind::Document {
            observations.insert(observation(
                &DeliveryAuthorizationScope::Document {
                    library_id: library_id.to_owned(),
                    project_id: None,
                    document_id: resource.id.clone(),
                },
                resource,
            ));
        }
    }

    for project_id in active_project_ids(connection, library_id, restricted_project_ids)? {
        let project_scope = DeliveryAuthorizationScope::Project {
            library_id: library_id.to_owned(),
            project_id: project_id.clone(),
        };
        for resource in &resources {
            if !resource_is_authorized_for_project(connection, library_id, &project_id, resource)? {
                continue;
            }
            observations.insert(observation(&project_scope, resource));
            if resource.kind == RevokedResourceKind::Document {
                observations.insert(observation(
                    &DeliveryAuthorizationScope::Document {
                        library_id: library_id.to_owned(),
                        project_id: Some(project_id.clone()),
                        document_id: resource.id.clone(),
                    },
                    resource,
                ));
            }
        }
    }
    Ok(observations.into_iter().collect())
}

/// Persists only the exact pre-state scopes that no longer pass canonical
/// post-state authorization. The resulting rows are immutable commit evidence
/// and are shared by apply, replay, and tailer delivery.
pub(super) fn record_losses(
    connection: &Connection,
    commit: &CommitContext,
    observations: &[AuthorizedResourceObservation],
    reason: ResourceRevocationReason,
) -> Result<(), StoreError> {
    for observation in observations {
        if resource_is_authorized_after(connection, observation)? {
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

fn observation(
    scope: &DeliveryAuthorizationScope,
    resource: &ResourceKey,
) -> AuthorizedResourceObservation {
    AuthorizedResourceObservation {
        authorization_scope: scope.clone(),
        resource_kind: resource.kind,
        resource_id: resource.id.clone(),
    }
}

fn expand_active_resource_closure(
    connection: &Connection,
    library_id: &str,
    roots: AuthorizationRoots,
) -> Result<BTreeSet<ResourceKey>, StoreError> {
    let mut queue = VecDeque::new();
    queue.extend(roots.page_ids.into_iter().map(ClosureRoot::Page));
    queue.extend(roots.database_ids.into_iter().map(ClosureRoot::Database));
    queue.extend(roots.canvas_ids.into_iter().map(ClosureRoot::Canvas));
    let mut visited = BTreeSet::new();
    let mut resources = BTreeSet::new();

    while let Some(root) = queue.pop_front() {
        if !visited.insert(root.clone()) {
            continue;
        }
        match root {
            ClosureRoot::Page(page_id) => {
                expand_page(connection, library_id, &page_id, &mut queue, &mut resources)?;
            }
            ClosureRoot::Database(database_id) => {
                expand_database(
                    connection,
                    library_id,
                    &database_id,
                    &mut queue,
                    &mut resources,
                )?;
            }
            ClosureRoot::Canvas(canvas_id) => {
                expand_canvas(connection, library_id, &canvas_id, &mut resources)?;
            }
        }
    }
    Ok(resources)
}

fn expand_page(
    connection: &Connection,
    library_id: &str,
    page_id: &str,
    queue: &mut VecDeque<ClosureRoot>,
    resources: &mut BTreeSet<ResourceKey>,
) -> Result<(), StoreError> {
    let document_id = connection
        .query_row(
            "SELECT page.document_id FROM pages page
             JOIN blocks block ON block.id = page.block_id
             WHERE page.block_id = ?1 AND page.library_id = ?2
               AND page.lifecycle = 'active' AND block.lifecycle = 'active'",
            params![page_id, library_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    let Some(document_id) = document_id else {
        return Ok(());
    };
    resources.insert(ResourceKey {
        kind: RevokedResourceKind::Page,
        id: page_id.to_owned(),
    });
    resources.insert(ResourceKey {
        kind: RevokedResourceKind::Document,
        id: document_id.clone(),
    });

    let child_pages = connection
        .prepare(
            "SELECT page.block_id FROM pages page
             JOIN blocks block ON block.id = page.block_id
             WHERE page.library_id = ?1 AND page.parent_kind = 'page'
               AND page.parent_id = ?2 AND page.lifecycle = 'active'
               AND block.lifecycle = 'active' ORDER BY page.block_id",
        )?
        .query_map(params![library_id, page_id], |row| row.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    queue.extend(child_pages.into_iter().map(ClosureRoot::Page));

    let embedded = connection
        .prepare(
            "SELECT block.type, block.id FROM blocks block
             JOIN projects project ON project.id = block.project_id
             WHERE project.library_id = ?1 AND block.containing_document_id = ?2
               AND block.lifecycle = 'active'
               AND block.type IN ('page', 'database', 'canvas')
             ORDER BY block.type, block.id",
        )?
        .query_map(params![library_id, document_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (kind, id) in embedded {
        match kind.as_str() {
            "page" => queue.push_back(ClosureRoot::Page(id)),
            "database" => queue.push_back(ClosureRoot::Database(id)),
            "canvas" => queue.push_back(ClosureRoot::Canvas(id)),
            _ => {}
        }
    }
    Ok(())
}

fn expand_database(
    connection: &Connection,
    library_id: &str,
    database_id: &str,
    queue: &mut VecDeque<ClosureRoot>,
    resources: &mut BTreeSet<ResourceKey>,
) -> Result<(), StoreError> {
    let active = connection
        .query_row(
            "SELECT 1 FROM database_containers container
             JOIN blocks block ON block.id = container.block_id
             WHERE container.block_id = ?1 AND container.library_id = ?2
               AND container.lifecycle = 'active' AND block.lifecycle = 'active'",
            params![database_id, library_id],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if !active {
        return Ok(());
    }
    resources.insert(ResourceKey {
        kind: RevokedResourceKind::Database,
        id: database_id.to_owned(),
    });

    let data_sources = connection
        .prepare(
            "SELECT id FROM data_sources
             WHERE library_id = ?1 AND home_database_block_id = ?2
               AND lifecycle = 'active' ORDER BY id",
        )?
        .query_map(params![library_id, database_id], |row| {
            row.get::<_, String>(0)
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for data_source_id in data_sources {
        resources.insert(ResourceKey {
            kind: RevokedResourceKind::DataSource,
            id: data_source_id.clone(),
        });
        let views = connection
            .prepare(
                "SELECT id FROM database_views
                 WHERE database_block_id = ?1 AND data_source_id = ?2
                   AND lifecycle = 'active' ORDER BY id",
            )?
            .query_map(params![database_id, data_source_id], |row| {
                row.get::<_, String>(0)
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        resources.extend(views.into_iter().map(|id| ResourceKey {
            kind: RevokedResourceKind::View,
            id,
        }));
        let pages = connection
            .prepare(
                "SELECT page.block_id FROM pages page
                 JOIN blocks block ON block.id = page.block_id
                 WHERE page.library_id = ?1 AND page.parent_kind = 'data_source'
                   AND page.parent_id = ?2 AND page.lifecycle = 'active'
                   AND block.lifecycle = 'active' ORDER BY page.block_id",
            )?
            .query_map(params![library_id, data_source_id], |row| {
                row.get::<_, String>(0)
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        queue.extend(pages.into_iter().map(ClosureRoot::Page));
    }
    Ok(())
}

fn expand_canvas(
    connection: &Connection,
    library_id: &str,
    canvas_id: &str,
    resources: &mut BTreeSet<ResourceKey>,
) -> Result<(), StoreError> {
    let document_id = connection
        .query_row(
            "SELECT ownership.document_id FROM canvas_owners canvas
             JOIN blocks block ON block.id = canvas.block_id
             JOIN block_documents ownership ON ownership.block_id = canvas.block_id
             WHERE canvas.block_id = ?1 AND canvas.library_id = ?2
               AND block.lifecycle = 'active'",
            params![canvas_id, library_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    let Some(document_id) = document_id else {
        return Ok(());
    };
    resources.insert(ResourceKey {
        kind: RevokedResourceKind::Canvas,
        id: canvas_id.to_owned(),
    });
    resources.insert(ResourceKey {
        kind: RevokedResourceKind::Document,
        id: document_id,
    });
    Ok(())
}

fn active_project_ids(
    connection: &Connection,
    library_id: &str,
    restricted: Option<&[String]>,
) -> Result<Vec<String>, StoreError> {
    let mut ids = match restricted {
        Some(ids) => ids.to_vec(),
        None => connection
            .prepare(
                "SELECT id FROM projects WHERE library_id = ?1 AND lifecycle = 'active'
                 ORDER BY id",
            )?
            .query_map([library_id], |row| row.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?,
    };
    ids.sort();
    ids.dedup();
    if restricted.is_some() {
        let mut active = Vec::with_capacity(ids.len());
        for project_id in ids {
            let exists = connection
                .query_row(
                    "SELECT 1 FROM projects
                     WHERE id = ?1 AND library_id = ?2 AND lifecycle = 'active'",
                    params![project_id, library_id],
                    |_| Ok(()),
                )
                .optional()?
                .is_some();
            if exists {
                active.push(project_id);
            }
        }
        return Ok(active);
    }
    Ok(ids)
}

fn resource_is_authorized_after(
    connection: &Connection,
    observation: &AuthorizedResourceObservation,
) -> Result<bool, StoreError> {
    match &observation.authorization_scope {
        DeliveryAuthorizationScope::Library { library_id } => resource_is_active_in_library(
            connection,
            library_id,
            observation.resource_kind,
            &observation.resource_id,
        ),
        DeliveryAuthorizationScope::Project {
            library_id,
            project_id,
        } => resource_is_authorized_for_project(
            connection,
            library_id,
            project_id,
            &ResourceKey {
                kind: observation.resource_kind,
                id: observation.resource_id.clone(),
            },
        ),
        DeliveryAuthorizationScope::Document {
            library_id,
            project_id,
            document_id,
        } => {
            if observation.resource_kind != RevokedResourceKind::Document
                || observation.resource_id != *document_id
            {
                return Err(corrupt(
                    "Document authorization observation has mismatched resource identity",
                ));
            }
            match project_id {
                Some(project_id) => {
                    document_is_authorized(connection, library_id, Some(project_id), document_id)
                }
                None => document_is_authorized(connection, library_id, None, document_id),
            }
        }
    }
}

fn resource_is_authorized_for_project(
    connection: &Connection,
    library_id: &str,
    project_id: &str,
    resource: &ResourceKey,
) -> Result<bool, StoreError> {
    if !resource_is_active_in_library(connection, library_id, resource.kind, &resource.id)? {
        return Ok(false);
    }
    match resource.kind {
        RevokedResourceKind::Page => {
            Ok(
                super::require_page_read_access(connection, library_id, project_id, &resource.id)
                    .is_ok(),
            )
        }
        RevokedResourceKind::Database => {
            database_is_authorized(connection, library_id, project_id, &resource.id)
        }
        RevokedResourceKind::DataSource => {
            let database_id = connection
                .query_row(
                    "SELECT home_database_block_id FROM data_sources
                     WHERE id = ?1 AND library_id = ?2 AND lifecycle = 'active'",
                    params![resource.id, library_id],
                    |row| row.get::<_, String>(0),
                )
                .optional()?;
            match database_id {
                Some(database_id) => {
                    database_is_authorized(connection, library_id, project_id, &database_id)
                }
                None => Ok(false),
            }
        }
        RevokedResourceKind::View => {
            let database_id = connection
                .query_row(
                    "SELECT view.database_block_id FROM database_views view
                     JOIN database_containers container
                       ON container.block_id = view.database_block_id
                     WHERE view.id = ?1 AND container.library_id = ?2
                       AND view.lifecycle = 'active'",
                    params![resource.id, library_id],
                    |row| row.get::<_, String>(0),
                )
                .optional()?;
            match database_id {
                Some(database_id) => {
                    database_is_authorized(connection, library_id, project_id, &database_id)
                }
                None => Ok(false),
            }
        }
        RevokedResourceKind::Canvas => {
            let document_id = owner_document_id(connection, "canvas", &resource.id)?;
            match document_id {
                Some(document_id) => {
                    document_is_authorized(connection, library_id, Some(project_id), &document_id)
                }
                None => Ok(false),
            }
        }
        RevokedResourceKind::Document => {
            document_is_authorized(connection, library_id, Some(project_id), &resource.id)
        }
    }
}

fn database_is_authorized(
    connection: &Connection,
    library_id: &str,
    project_id: &str,
    database_id: &str,
) -> Result<bool, StoreError> {
    let primary = match crate::database::authorization::project_primary_database(
        connection, library_id, project_id,
    ) {
        Ok(primary) => primary,
        Err(error) if authorization_miss(&error) => return Ok(false),
        Err(error) => return Err(error),
    };
    crate::database::authorization::authorize_database(
        connection,
        project_id,
        primary.as_deref(),
        database_id,
    )
}

fn document_is_authorized(
    connection: &Connection,
    library_id: &str,
    project_id: Option<&str>,
    document_id: &str,
) -> Result<bool, StoreError> {
    if !resource_is_active_in_library(
        connection,
        library_id,
        RevokedResourceKind::Document,
        document_id,
    )? {
        return Ok(false);
    }
    let context = BoundModuleContext {
        profile_id: ProfileId("authorization-loss-probe".to_owned()),
        library_id: LibraryId(library_id.to_owned()),
        project_id: project_id.map(|id| ProjectId(id.to_owned())),
        connection_id: "authorization-loss-probe".to_owned(),
        adapter: AdapterKind::Test,
    };
    match crate::document::require_owned_document_read_access(connection, &context, document_id) {
        Ok(()) => Ok(true),
        Err(error) if authorization_miss(&error) => Ok(false),
        Err(error) => Err(error),
    }
}

fn resource_is_active_in_library(
    connection: &Connection,
    library_id: &str,
    kind: RevokedResourceKind,
    resource_id: &str,
) -> Result<bool, StoreError> {
    let active = match kind {
        RevokedResourceKind::Page => connection.query_row(
            "SELECT EXISTS(
               SELECT 1 FROM pages page JOIN blocks block ON block.id = page.block_id
               WHERE page.block_id = ?1 AND page.library_id = ?2
                 AND page.lifecycle = 'active' AND block.lifecycle = 'active')",
            params![resource_id, library_id],
            |row| row.get::<_, i64>(0),
        )?,
        RevokedResourceKind::Database => connection.query_row(
            "SELECT EXISTS(
               SELECT 1 FROM database_containers container
               JOIN blocks block ON block.id = container.block_id
               WHERE container.block_id = ?1 AND container.library_id = ?2
                 AND container.lifecycle = 'active' AND block.lifecycle = 'active')",
            params![resource_id, library_id],
            |row| row.get::<_, i64>(0),
        )?,
        RevokedResourceKind::DataSource => connection.query_row(
            "SELECT EXISTS(
               SELECT 1 FROM data_sources source
               JOIN database_containers container
                 ON container.block_id = source.home_database_block_id
               JOIN blocks block ON block.id = container.block_id
               WHERE source.id = ?1 AND source.library_id = ?2
                 AND source.lifecycle = 'active' AND container.lifecycle = 'active'
                 AND block.lifecycle = 'active')",
            params![resource_id, library_id],
            |row| row.get::<_, i64>(0),
        )?,
        RevokedResourceKind::View => connection.query_row(
            "SELECT EXISTS(
               SELECT 1 FROM database_views view
               JOIN data_sources source ON source.id = view.data_source_id
               JOIN database_containers container
                 ON container.block_id = view.database_block_id
               JOIN blocks block ON block.id = container.block_id
               WHERE view.id = ?1 AND container.library_id = ?2
                 AND view.lifecycle = 'active' AND source.lifecycle = 'active'
                 AND container.lifecycle = 'active' AND block.lifecycle = 'active')",
            params![resource_id, library_id],
            |row| row.get::<_, i64>(0),
        )?,
        RevokedResourceKind::Canvas => connection.query_row(
            "SELECT EXISTS(
               SELECT 1 FROM canvas_owners canvas
               JOIN blocks block ON block.id = canvas.block_id
               WHERE canvas.block_id = ?1 AND canvas.library_id = ?2
                 AND block.lifecycle = 'active')",
            params![resource_id, library_id],
            |row| row.get::<_, i64>(0),
        )?,
        RevokedResourceKind::Document => connection.query_row(
            "SELECT EXISTS(
               SELECT 1 FROM block_documents ownership
               JOIN blocks block ON block.id = ownership.block_id
               JOIN projects project ON project.id = block.project_id
               LEFT JOIN pages page ON page.block_id = block.id
               LEFT JOIN canvas_owners canvas ON canvas.block_id = block.id
               JOIN documents document ON document.id = ownership.document_id
               WHERE ownership.document_id = ?1 AND project.library_id = ?2
                 AND block.lifecycle = 'active' AND document.readiness = 'ready'
                 AND ((block.type = 'page' AND page.lifecycle = 'active')
                   OR (block.type = 'canvas' AND canvas.block_id IS NOT NULL)))",
            params![resource_id, library_id],
            |row| row.get::<_, i64>(0),
        )?,
    };
    Ok(active == 1)
}

fn owner_document_id(
    connection: &Connection,
    owner_type: &str,
    owner_id: &str,
) -> Result<Option<String>, StoreError> {
    connection
        .query_row(
            "SELECT ownership.document_id FROM block_documents ownership
             JOIN blocks block ON block.id = ownership.block_id
             WHERE ownership.block_id = ?1 AND block.type = ?2",
            params![owner_id, owner_type],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(StoreError::from)
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
