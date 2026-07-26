use std::collections::HashSet;

use nodex_core_contracts::agent::{AgentAuthorizationTarget, AgentProjectResourceAction};
use nodex_core_contracts::library::{
    LibraryAgentBlockTarget, LibraryCatalogEntry, LibraryCatalogKind, LibraryLifecycle,
    LibraryNavigationNode, LibraryNavigationParent, LibraryPageAccessContext,
    LibraryPageDataSourceContext, LibraryPageDetail, LibraryPageDocumentDescriptor,
    LibraryPageIntrinsicProperty, LibraryPageLocation, LibraryPageMembership,
    LibraryPageOwnershipPath, LibraryPageOwnershipPathAncestor, LibraryPageTarget, LibraryRead,
    LibraryReadValue, LibraryResourceTarget, LibraryRouteTarget,
};
use nodex_core_contracts::{AdapterKind, BoundModuleContext};
use rusqlite::{Connection, OptionalExtension, Row, params};
use serde_json::Value;

use crate::database::read::{page_data_source_projection, page_record};
use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};

use super::cursor;

const DEFAULT_LIMIT: usize = 20;
const MAX_LIMIT: usize = 100;

pub(super) fn read(
    connection: &Connection,
    library_id: &str,
    store_epoch: &str,
    event_head: i64,
    context: &BoundModuleContext,
    request: LibraryRead,
) -> Result<LibraryReadValue, StoreError> {
    let requesting_project_id = context
        .project_id
        .as_ref()
        .map(|project| project.0.as_str());
    let requesting_adapter = &context.adapter;
    match request {
        LibraryRead::Metadata | LibraryRead::FilterProjectionImpactForProject { .. } => {
            Err(invalid("Read is assembled by the Library Module"))
        }
        LibraryRead::Children {
            parent,
            cursor: requested_cursor,
            limit,
            force_include_target,
        } => {
            if let LibraryNavigationParent::Page { page_id } = &parent {
                require_bound_page_read_access(
                    connection,
                    library_id,
                    requesting_project_id,
                    requesting_adapter,
                    page_id,
                )?;
            }
            children(
                connection,
                library_id,
                parent,
                requested_cursor,
                limit,
                force_include_target,
            )
        }
        LibraryRead::Path { target } => {
            if let (Some(project_id), LibraryRouteTarget::Page { page_id }) =
                (requesting_project_id, &target)
            {
                super::require_page_read_access(connection, library_id, project_id, page_id)?;
            } else if matches!(&target, LibraryRouteTarget::Page { .. })
                && !trusted_root_adapter(requesting_adapter)
            {
                return Err(unauthorized(
                    "Library Page paths require a trusted root or bound Project Adapter",
                ));
            }
            Ok(LibraryReadValue::Path {
                nodes: path(connection, library_id, &target)?,
                target,
            })
        }
        LibraryRead::Catalog {
            query,
            kinds,
            lifecycle,
            cursor: requested_cursor,
            limit,
        } => catalog(
            connection,
            library_id,
            query,
            kinds,
            lifecycle,
            requested_cursor,
            limit,
        ),
        LibraryRead::PageDetail { page_id } => {
            require_bound_page_read_access(
                connection,
                library_id,
                requesting_project_id,
                requesting_adapter,
                &page_id,
            )?;
            Ok(LibraryReadValue::PageDetail {
                value: Box::new(page_detail(
                    connection,
                    library_id,
                    store_epoch,
                    event_head,
                    &page_id,
                )?),
            })
        }
        LibraryRead::PageContent { page_id } => {
            require_bound_page_read_access(
                connection,
                library_id,
                requesting_project_id,
                requesting_adapter,
                &page_id,
            )?;
            Ok(LibraryReadValue::PageContent {
                value: Box::new(super::content::page_content(
                    connection,
                    library_id,
                    store_epoch,
                    event_head,
                    &page_id,
                )?),
            })
        }
        LibraryRead::PageFile {
            page_id,
            file_kind,
            prepare,
        } => {
            require_bound_page_read_access(
                connection,
                library_id,
                requesting_project_id,
                requesting_adapter,
                &page_id,
            )?;
            Ok(LibraryReadValue::PageFile {
                value: Box::new(super::page_projection::page_file(
                    connection,
                    library_id,
                    store_epoch,
                    event_head,
                    &page_id,
                    file_kind,
                    prepare,
                )?),
            })
        }
        LibraryRead::PageDraftProjection { page_id } => {
            require_bound_page_read_access(
                connection,
                library_id,
                requesting_project_id,
                requesting_adapter,
                &page_id,
            )?;
            Ok(LibraryReadValue::PageDraftProjection {
                value: Box::new(super::page_projection::page_draft_projection(
                    connection,
                    library_id,
                    store_epoch,
                    event_head,
                    &page_id,
                )?),
            })
        }
        LibraryRead::AgentBlockTarget {
            block_id,
            authorization,
        } => {
            super::agent_authorization::authorize_execution(
                connection,
                context,
                library_id,
                &authorization,
                &AgentAuthorizationTarget::PageOrBlock {
                    id: block_id.clone(),
                },
                AgentProjectResourceAction::Read,
            )?;
            let value =
                agent_block_target(connection, library_id, store_epoch, event_head, &block_id)?;
            Ok(LibraryReadValue::AgentBlockTarget { value })
        }
        LibraryRead::AgentSearch {
            authorization,
            query,
            target,
            scope,
            block_types,
            include_archived,
            cursor,
            limit,
        } => super::agent_search::read(
            connection,
            context,
            library_id,
            &authorization,
            &query,
            target,
            scope,
            block_types,
            include_archived,
            cursor.as_deref(),
            limit,
        ),
        LibraryRead::PageTarget { page_id } => Ok(LibraryReadValue::PageTarget {
            value: page_target(connection, library_id, requesting_project_id, &page_id)?
                .map(Box::new),
        }),
        LibraryRead::PageOwnershipPath { page_id } => Ok(LibraryReadValue::PageOwnershipPath {
            value: page_ownership_path(connection, library_id, requesting_project_id, &page_id)?
                .map(Box::new),
        }),
        LibraryRead::PageLocation { page_id } => {
            if requesting_project_id.is_some() || !trusted_root_adapter(requesting_adapter) {
                return Err(unauthorized(
                    "Page location requires a trusted local root Adapter",
                ));
            }
            validate_page_identity(&page_id, "Page location")?;
            let value = connection
                .query_row(
                    "SELECT page.block_id, block.project_id FROM pages page \
                     JOIN blocks block ON block.id = page.block_id AND block.type = 'page' \
                     WHERE page.block_id = ?1 AND page.library_id = ?2 \
                       AND page.lifecycle = 'active' AND block.lifecycle = 'active' LIMIT 1",
                    params![page_id, library_id],
                    |row| {
                        Ok(LibraryPageLocation {
                            page_id: row.get(0)?,
                            project_id: row.get(1)?,
                        })
                    },
                )
                .optional()?;
            Ok(LibraryReadValue::PageLocation { value })
        }
        LibraryRead::Search {
            query,
            include_archived,
            source_kinds,
            block_types,
            cursor,
            limit,
        } => super::content::search(
            connection,
            library_id,
            &query,
            include_archived,
            source_kinds,
            block_types,
            cursor,
            limit,
        ),
        LibraryRead::ProjectPageSearch {
            project_ids,
            query,
            limit,
        } => {
            if requesting_project_id.is_some()
                || !matches!(
                    requesting_adapter,
                    AdapterKind::ElectronHost | AdapterKind::NativeCli | AdapterKind::Test
                )
            {
                return Err(unauthorized(
                    "Project Page search requires a trusted local root Adapter",
                ));
            }
            super::content::project_page_search(connection, library_id, project_ids, &query, limit)
        }
        LibraryRead::PageHistory {
            page_id,
            before,
            limit,
        } => Ok(LibraryReadValue::PageHistory {
            value: Box::new(super::history::page_history(
                connection,
                library_id,
                requesting_project_id,
                &page_id,
                before,
                limit,
            )?),
        }),
        LibraryRead::PlanBlockTransfer { .. } => Err(invalid(
            "Block transfer planning is assembled by the Library Module",
        )),
        LibraryRead::PlanAgentResourceAccess { .. } => Err(invalid(
            "Agent resource planning is assembled by the Library Module",
        )),
        LibraryRead::PrepareAgentPageCopy { .. } => Err(invalid(
            "Agent Page copy preparation is assembled by the Library Module",
        )),
        LibraryRead::PrepareAgentCreatePages { .. } => Err(invalid(
            "Agent Page creation preparation is assembled by the Library Module",
        )),
        LibraryRead::PrepareAgentMovePages { .. } => Err(invalid(
            "Agent Page movement preparation is assembled by the Library Module",
        )),
        LibraryRead::PageLifecyclePreflight { .. } => Err(invalid(
            "Page lifecycle preflight is assembled by the Library Module",
        )),
        LibraryRead::AcquireSearchSnapshot { .. } | LibraryRead::ReleaseSearchSnapshot { .. } => {
            Err(invalid(
                "Search snapshot leases are assembled by the Library Module",
            ))
        }
    }
}

fn require_bound_page_read_access(
    connection: &Connection,
    library_id: &str,
    requesting_project_id: Option<&str>,
    requesting_adapter: &AdapterKind,
    page_id: &str,
) -> Result<(), StoreError> {
    if let Some(project_id) = requesting_project_id {
        return super::require_page_read_access(connection, library_id, project_id, page_id);
    }
    if trusted_root_adapter(requesting_adapter) {
        return Ok(());
    }
    Err(unauthorized(
        "Library Page reads require a trusted root or bound Project Adapter",
    ))
}

fn trusted_root_adapter(adapter: &AdapterKind) -> bool {
    matches!(
        adapter,
        AdapterKind::ElectronHost | AdapterKind::NativeCli | AdapterKind::Test
    )
}

fn agent_block_target(
    connection: &Connection,
    library_id: &str,
    store_epoch: &str,
    event_head: i64,
    block_id: &str,
) -> Result<Option<LibraryAgentBlockTarget>, StoreError> {
    validate_page_identity(block_id, "Agent Block target")?;
    let row = connection
        .query_row(
            "SELECT block.id, block.type, block.lifecycle, \
               CASE WHEN page.block_id IS NOT NULL THEN page.block_id ELSE owner_page.block_id END, \
               CASE WHEN page.block_id IS NOT NULL THEN page.document_id ELSE block.containing_document_id END, \
               CASE WHEN page.block_id IS NOT NULL THEN page_document.generation ELSE owner_document.generation END, \
               CASE WHEN page.block_id IS NOT NULL THEN page_document.head_seq ELSE owner_document.head_seq END \
             FROM blocks block \
             LEFT JOIN pages page ON page.block_id = block.id AND page.library_id = ?2 \
             LEFT JOIN documents page_document ON page_document.id = page.document_id \
             LEFT JOIN block_documents ownership \
               ON ownership.document_id = block.containing_document_id \
             LEFT JOIN pages owner_page \
               ON owner_page.block_id = ownership.block_id AND owner_page.library_id = ?2 \
             LEFT JOIN documents owner_document \
               ON owner_document.id = block.containing_document_id \
             WHERE block.id = ?1 \
               AND (page.block_id IS NOT NULL OR owner_page.block_id IS NOT NULL) \
             LIMIT 1",
            params![block_id, library_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, i64>(6)?,
                ))
            },
        )
        .optional()?;
    let Some((
        block_id,
        block_type,
        lifecycle,
        owner_page_id,
        document_id,
        document_generation,
        document_head_seq,
    )) = row
    else {
        return Ok(None);
    };
    let owner_page = page_detail(
        connection,
        library_id,
        store_epoch,
        event_head,
        &owner_page_id,
    )?;
    Ok(Some(LibraryAgentBlockTarget {
        block_id,
        block_type,
        lifecycle,
        owner_page_id,
        document_id,
        document_generation,
        document_head_seq,
        owner_page: Box::new(owner_page),
    }))
}

fn page_target(
    connection: &Connection,
    library_id: &str,
    requesting_project_id: Option<&str>,
    page_id: &str,
) -> Result<Option<LibraryPageTarget>, StoreError> {
    validate_page_identity(page_id, "Page target")?;
    let project_id = requesting_project_id
        .ok_or_else(|| unauthorized("Page target resolution requires a bound Project"))?;
    if !project_scope_exists(connection, library_id, project_id)? {
        return Ok(None);
    }
    if let Err(error) = super::require_page_read_access(connection, library_id, project_id, page_id)
    {
        if error.code == StoreErrorCode::NotFound {
            return Ok(Some(LibraryPageTarget::Missing {
                target_page_id: page_id.to_owned(),
            }));
        }
        return Err(error);
    }
    let row = connection
        .query_row(
            "SELECT block.type, block.lifecycle, page.library_id, page.lifecycle, \
               document.readiness, document.schema_key, document.schema_version \
             FROM blocks block LEFT JOIN pages page ON page.block_id = block.id \
             LEFT JOIN documents document ON document.id = page.document_id \
             WHERE block.id = ?1 LIMIT 1",
            [page_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, Option<i64>>(6)?,
                ))
            },
        )
        .optional()?;
    let Some((
        block_type,
        lifecycle,
        page_library_id,
        page_lifecycle,
        readiness,
        schema_key,
        schema_version,
    )) = row
    else {
        return Ok(Some(LibraryPageTarget::Missing {
            target_page_id: page_id.to_owned(),
        }));
    };
    if block_type != "page" {
        return Ok(Some(LibraryPageTarget::InvalidTarget {
            target_page_id: page_id.to_owned(),
            actual_block_type: block_type,
        }));
    }
    let page_library_id =
        page_library_id.ok_or_else(|| corrupt("Page target has no Library authority"))?;
    let page_lifecycle =
        page_lifecycle.ok_or_else(|| corrupt("Page target has no Page lifecycle"))?;
    if page_library_id != library_id {
        return Ok(Some(LibraryPageTarget::Missing {
            target_page_id: page_id.to_owned(),
        }));
    }
    if lifecycle != page_lifecycle {
        return Err(corrupt("Page target lifecycle projections diverge"));
    }
    if lifecycle == "deleted" {
        return Ok(Some(LibraryPageTarget::Deleted {
            target_page_id: page_id.to_owned(),
            library_id: page_library_id,
        }));
    }
    if !matches!(lifecycle.as_str(), "active" | "archived") {
        return Err(corrupt("Page target has an invalid lifecycle"));
    }
    let readiness = readiness.ok_or_else(|| corrupt("Page target has no Document readiness"))?;
    let schema_key = schema_key.ok_or_else(|| corrupt("Page target has no Document schema"))?;
    let schema_version =
        schema_version.ok_or_else(|| corrupt("Page target has no Document schema version"))?;
    if !matches!(readiness.as_str(), "pending_genesis" | "ready" | "failed")
        || schema_key.is_empty()
        || schema_version < 1
    {
        return Err(corrupt("Page target Document descriptor is invalid"));
    }
    Ok(Some(LibraryPageTarget::Available {
        target_page_id: page_id.to_owned(),
        page: page_record(connection, page_id)?,
        document: LibraryPageDocumentDescriptor {
            readiness,
            schema_key,
            schema_version,
        },
    }))
}

fn page_ownership_path(
    connection: &Connection,
    library_id: &str,
    requesting_project_id: Option<&str>,
    page_id: &str,
) -> Result<Option<LibraryPageOwnershipPath>, StoreError> {
    validate_page_identity(page_id, "Page ownership path")?;
    let project_id = requesting_project_id
        .ok_or_else(|| unauthorized("Page ownership path requires a bound Project"))?;
    if !project_scope_exists(connection, library_id, project_id)? {
        return Ok(None);
    }
    let Some(hierarchy) = page_hierarchy(connection, library_id, page_id)? else {
        return Ok(Some(LibraryPageOwnershipPath::Missing {
            target_page_id: page_id.to_owned(),
        }));
    };
    let mut visible = Vec::new();
    for page in hierarchy {
        match super::require_page_read_access(connection, library_id, project_id, &page.page_id) {
            Ok(()) => visible.push(page),
            Err(error) if error.code == StoreErrorCode::NotFound => break,
            Err(error) => return Err(error),
        }
    }
    if visible.first().is_none_or(|page| page.page_id != page_id) {
        return Ok(Some(LibraryPageOwnershipPath::Missing {
            target_page_id: page_id.to_owned(),
        }));
    }
    let ancestors = visible
        .into_iter()
        .skip(1)
        .rev()
        .map(|page| LibraryPageOwnershipPathAncestor {
            page_id: page.page_id,
            title: page.title,
            lifecycle: page.lifecycle,
        })
        .collect();
    Ok(Some(LibraryPageOwnershipPath::Available {
        target_page_id: page_id.to_owned(),
        ancestors,
    }))
}

struct PageHierarchyEntry {
    page_id: String,
    title: String,
    lifecycle: LibraryLifecycle,
}

fn page_hierarchy(
    connection: &Connection,
    library_id: &str,
    page_id: &str,
) -> Result<Option<Vec<PageHierarchyEntry>>, StoreError> {
    let mut current = page_id.to_owned();
    let mut hierarchy = Vec::new();
    let mut seen = HashSet::new();
    loop {
        if hierarchy.len() >= 512 {
            return Err(corrupt("Library Page hierarchy exceeds 512 Page levels"));
        }
        if !seen.insert(current.clone()) {
            return Err(corrupt("Library Page hierarchy contains a cycle"));
        }
        let row = connection
            .query_row(
                "SELECT page.library_id, page.parent_kind, page.parent_id, page.lifecycle, \
                   materialization.title \
                 FROM pages page JOIN documents document ON document.id = page.document_id \
                 LEFT JOIN document_materializations materialization \
                   ON materialization.document_id = document.id \
                   AND materialization.generation = document.generation \
                   AND materialization.projected_seq = document.head_seq \
                   AND materialization.schema_version = document.schema_version \
                 WHERE page.block_id = ?1",
                [&current],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, Option<String>>(4)?,
                    ))
                },
            )
            .optional()?;
        let Some((page_library_id, parent_kind, parent_id, lifecycle, title)) = row else {
            if hierarchy.is_empty() {
                return Ok(None);
            }
            return Err(corrupt(
                "Library Page hierarchy points to a missing parent Page",
            ));
        };
        if page_library_id != library_id {
            return Err(corrupt("Library Page hierarchy crosses Library authority"));
        }
        let lifecycle = match lifecycle.as_str() {
            "active" => LibraryLifecycle::Active,
            "archived" => LibraryLifecycle::Archived,
            "deleted" if hierarchy.is_empty() => return Ok(None),
            "deleted" => {
                return Err(corrupt(
                    "Library Page hierarchy points through a deleted parent Page",
                ));
            }
            _ => return Err(corrupt("Library Page has an invalid lifecycle")),
        };
        let title = title.ok_or_else(|| corrupt("Library Page projection is unavailable"))?;
        hierarchy.push(PageHierarchyEntry {
            page_id: current.clone(),
            title,
            lifecycle,
        });
        match parent_kind.as_str() {
            "page" => current = parent_id,
            "library" if parent_id == library_id => return Ok(Some(hierarchy)),
            "data_source" => {
                let source_exists = connection
                    .query_row(
                        "SELECT 1 FROM data_sources \
                         WHERE id = ?1 AND library_id = ?2 AND lifecycle <> 'deleted'",
                        params![parent_id, library_id],
                        |_| Ok(()),
                    )
                    .optional()?
                    .is_some();
                if source_exists {
                    return Ok(Some(hierarchy));
                }
                return Err(corrupt("Library Page has no matching owning Data Source"));
            }
            _ => return Err(corrupt("Library Page has an invalid ownership parent")),
        }
    }
}

fn project_scope_exists(
    connection: &Connection,
    library_id: &str,
    project_id: &str,
) -> Result<bool, StoreError> {
    Ok(connection
        .query_row(
            "SELECT 1 FROM projects WHERE id = ?1 AND library_id = ?2 LIMIT 1",
            params![project_id, library_id],
            |_| Ok(()),
        )
        .optional()?
        .is_some())
}

fn validate_page_identity(value: &str, label: &str) -> Result<(), StoreError> {
    if !value.is_empty() && value.len() <= 512 && value.trim() == value {
        return Ok(());
    }
    Err(invalid(&format!(
        "{label} requires a canonical bounded identity"
    )))
}

fn page_detail(
    connection: &Connection,
    library_id: &str,
    store_epoch: &str,
    event_head: i64,
    page_id: &str,
) -> Result<LibraryPageDetail, StoreError> {
    if page_id.is_empty() || page_id.len() > 512 || page_id.trim() != page_id {
        return Err(invalid("Page detail requires a canonical bounded identity"));
    }
    let document = connection
        .query_row(
            "SELECT document.readiness, document.schema_key, document.schema_version, \
               page.parent_kind, page.parent_id \
             FROM pages page JOIN documents document ON document.id = page.document_id \
             WHERE page.block_id = ?1 AND page.library_id = ?2 AND page.lifecycle <> 'deleted'",
            params![page_id, library_id],
            |row| {
                Ok((
                    LibraryPageDocumentDescriptor {
                        readiness: row.get(0)?,
                        schema_key: row.get(1)?,
                        schema_version: row.get(2)?,
                    },
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            },
        )
        .optional()?
        .ok_or_else(|| not_found("Library Page is unavailable"))?;
    if !matches!(
        document.0.readiness.as_str(),
        "pending_genesis" | "ready" | "failed"
    ) || document.0.schema_key.is_empty()
        || document.0.schema_version < 1
    {
        return Err(corrupt("Library Page Document descriptor is invalid"));
    }
    let intrinsic_properties = connection
        .prepare(
            "SELECT property_key, value_type, value_json, revision FROM block_properties \
             WHERE block_id = ?1 ORDER BY property_key",
        )?
        .query_map([page_id], |row| {
            let key = row.get::<_, String>(0)?;
            let value_type = row.get::<_, String>(1)?;
            let serialized = row.get::<_, String>(2)?;
            let value = parse_json(&serialized, "Page intrinsic Property")?;
            if !valid_intrinsic_value(&value_type, &value) {
                return Err(rusqlite::Error::FromSqlConversionFailure(
                    serialized.len(),
                    rusqlite::types::Type::Text,
                    std::io::Error::new(
                        std::io::ErrorKind::InvalidData,
                        "Page intrinsic Property diverges from its value type",
                    )
                    .into(),
                ));
            }
            Ok(LibraryPageIntrinsicProperty {
                key,
                value_type,
                value,
                revision: row.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let data_source_context = match document.1.as_str() {
        "library" | "page" => LibraryPageDataSourceContext::Standalone,
        "data_source" => {
            let projection =
                page_data_source_projection(connection, library_id, page_id, &document.2)?;
            LibraryPageDataSourceContext::Member {
                membership: LibraryPageMembership {
                    membership_id: projection.membership_id,
                    data_source_id: projection.data_source_id,
                    revision: projection.membership_revision,
                    created_at: projection.membership_created_at,
                },
                database: projection.database,
                data_source: projection.data_source,
                properties: projection.properties,
                values: projection.values,
            }
        }
        _ => return Err(corrupt("Library Page has an invalid parent kind")),
    };
    Ok(LibraryPageDetail {
        version: 2,
        library_id: library_id.to_owned(),
        store_epoch: store_epoch.to_owned(),
        change_log_seq: event_head,
        page: page_record(connection, page_id)?,
        document: document.0,
        intrinsic_properties,
        data_source_context,
        access_context: LibraryPageAccessContext::Library,
    })
}

fn valid_intrinsic_value(value_type: &str, value: &Value) -> bool {
    match value_type {
        "null" => value.is_null(),
        "boolean" => value.is_boolean(),
        "number" => value.is_number(),
        "string" => value.is_null() || value.is_string(),
        "json" => value.is_null() || value.is_array() || value.is_object(),
        _ => false,
    }
}

fn parse_json(serialized: &str, label: &str) -> rusqlite::Result<Value> {
    serde_json::from_str(serialized).map_err(|_| {
        rusqlite::Error::FromSqlConversionFailure(
            serialized.len(),
            rusqlite::types::Type::Text,
            std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                format!("{label} is invalid JSON"),
            )
            .into(),
        )
    })
}

pub(super) fn event_head(connection: &Connection) -> Result<i64, StoreError> {
    connection
        .query_row("SELECT COALESCE(MAX(seq), 0) FROM change_log", [], |row| {
            row.get(0)
        })
        .map_err(Into::into)
}

fn children(
    connection: &Connection,
    library_id: &str,
    parent: LibraryNavigationParent,
    requested_cursor: Option<String>,
    limit: Option<u32>,
    force_include_target: Option<LibraryRouteTarget>,
) -> Result<LibraryReadValue, StoreError> {
    let subject = match &parent {
        LibraryNavigationParent::Library => vec!["children".to_owned(), "library".to_owned()],
        LibraryNavigationParent::Page { page_id } => {
            vec!["children".to_owned(), "page".to_owned(), page_id.clone()]
        }
        LibraryNavigationParent::Database { database_id } => vec![
            "children".to_owned(),
            "database".to_owned(),
            database_id.clone(),
        ],
    };
    let after = cursor_coordinate(
        connection,
        requested_cursor.as_deref(),
        library_id,
        &subject,
    )?;
    let limit = read_limit(limit)?;
    let (mut ordered, total) = match &parent {
        LibraryNavigationParent::Library => {
            root_node_window(connection, library_id, after.as_ref(), limit)?
        }
        LibraryNavigationParent::Page { page_id } => {
            page_child_node_window(connection, library_id, page_id, after.as_ref(), limit)?
        }
        LibraryNavigationParent::Database { database_id } => {
            view_node_window(connection, library_id, database_id, after.as_ref(), limit)?
        }
    };
    let has_more = ordered.len() > limit;
    ordered.truncate(limit);
    let next_cursor = has_more
        .then(|| {
            let last = ordered
                .last()
                .ok_or_else(|| corrupt("Library child continuation has no node"))?;
            cursor::mint(
                connection,
                library_id,
                &subject,
                cursor::KeysetCoordinate {
                    values: vec![cursor::KeysetValue::Text {
                        value: last.sort_key.clone(),
                    }],
                    stable_id: navigation_node_id(&last.node).to_owned(),
                },
            )
        })
        .transpose()?;
    let mut items = ordered
        .into_iter()
        .map(|ordered| ordered.node)
        .collect::<Vec<_>>();
    if let Some(target) = force_include_target
        && !items.iter().any(|node| matches_target(node, &target))
        && let Some(forced) = forced_child_node(connection, library_id, &parent, &target)?
    {
        items.push(forced);
    }
    Ok(LibraryReadValue::Children {
        parent,
        items,
        next_cursor,
        has_more,
        total,
    })
}

struct OrderedNavigationNode {
    node: LibraryNavigationNode,
    sort_key: String,
}

fn root_node_window(
    connection: &Connection,
    library_id: &str,
    after: Option<&cursor::KeysetCoordinate>,
    limit: usize,
) -> Result<(Vec<OrderedNavigationNode>, u64), StoreError> {
    let (after_sort_key, after_id) = keyset_text_coordinate(after)?;
    let query_limit =
        i64::try_from(limit.saturating_add(1)).map_err(|_| invalid("Library limit overflowed"))?;
    let nodes = connection
        .prepare(
            "SELECT block.type, block.id, placement.rank_key, \
               materialization.title, page.parent_revision, page.metadata_revision, \
               document.generation, document.head_seq, page.updated_at, \
               EXISTS(SELECT 1 FROM document_block_index child \
                 INNER JOIN blocks child_block ON child_block.id = child.block_id \
                 WHERE child.document_id = page.document_id \
                   AND child_block.type IN ('page', 'database') \
                   AND child_block.lifecycle = 'active'), \
               container.name, container.default_view_id, container.metadata_revision, \
               block.location_revision, container.updated_at, \
               (SELECT COUNT(*) FROM database_views view \
                 WHERE view.database_block_id = container.block_id \
                   AND view.lifecycle = 'active') \
             FROM library_block_placements placement \
             INNER JOIN blocks block ON block.id = placement.block_id \
             LEFT JOIN pages page ON page.block_id = block.id \
             LEFT JOIN documents document ON document.id = page.document_id \
             LEFT JOIN document_materializations materialization \
               ON materialization.document_id = page.document_id \
             LEFT JOIN database_containers container ON container.block_id = block.id \
             WHERE placement.library_id = ?1 AND block.type IN ('page', 'database') \
               AND block.lifecycle = 'active' \
               AND COALESCE(page.lifecycle, container.lifecycle) = 'active' \
               AND (?2 IS NULL OR placement.rank_key > ?2 \
                 OR (placement.rank_key = ?2 AND block.id > ?3)) \
             ORDER BY placement.rank_key, block.id LIMIT ?4",
        )?
        .query_map(
            params![library_id, after_sort_key, after_id, query_limit],
            navigation_row,
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let total = connection.query_row(
        "SELECT COUNT(*) FROM library_block_placements placement \
         INNER JOIN blocks block ON block.id = placement.block_id \
         LEFT JOIN pages page ON page.block_id = block.id \
         LEFT JOIN database_containers container ON container.block_id = block.id \
         WHERE placement.library_id = ?1 AND block.type IN ('page', 'database') \
           AND block.lifecycle = 'active' \
           AND COALESCE(page.lifecycle, container.lifecycle) = 'active'",
        [library_id],
        |row| row.get::<_, i64>(0),
    )?;
    Ok((nodes, count_to_u64(total)?))
}

fn page_child_node_window(
    connection: &Connection,
    library_id: &str,
    page_id: &str,
    after: Option<&cursor::KeysetCoordinate>,
    limit: usize,
) -> Result<(Vec<OrderedNavigationNode>, u64), StoreError> {
    let document_id = connection
        .query_row(
            "SELECT document_id FROM pages \
             WHERE block_id = ?1 AND library_id = ?2 AND lifecycle = 'active'",
            params![page_id, library_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or_else(|| not_found("Library Page is unavailable"))?;
    let (after_sort_key, after_id) = keyset_text_coordinate(after)?;
    let query_limit =
        i64::try_from(limit.saturating_add(1)).map_err(|_| invalid("Library limit overflowed"))?;
    let nodes = connection
        .prepare(
            "WITH RECURSIVE ordered(block_id, path) AS ( \
               SELECT block_id, printf('%010d', ordinal) || ':' || block_id \
               FROM document_block_index \
               WHERE document_id = ?1 AND parent_block_id IS NULL \
               UNION ALL \
               SELECT child.block_id, ordered.path || '/' || \
                 printf('%010d', child.ordinal) || ':' || child.block_id \
               FROM ordered INNER JOIN document_block_index child \
                 ON child.document_id = ?1 AND child.parent_block_id = ordered.block_id \
             ) \
             SELECT block.type, block.id, ordered.path, \
               materialization.title, page.parent_revision, page.metadata_revision, \
               document.generation, document.head_seq, page.updated_at, \
               EXISTS(SELECT 1 FROM document_block_index child \
                 INNER JOIN blocks child_block ON child_block.id = child.block_id \
                 WHERE child.document_id = page.document_id \
                   AND child_block.type IN ('page', 'database') \
                   AND child_block.lifecycle = 'active'), \
               container.name, container.default_view_id, container.metadata_revision, \
               block.location_revision, container.updated_at, \
               (SELECT COUNT(*) FROM database_views view \
                 WHERE view.database_block_id = container.block_id \
                   AND view.lifecycle = 'active') \
             FROM ordered \
             INNER JOIN blocks block ON block.id = ordered.block_id \
             LEFT JOIN pages page ON page.block_id = block.id \
             LEFT JOIN documents document ON document.id = page.document_id \
             LEFT JOIN document_materializations materialization \
               ON materialization.document_id = page.document_id \
             LEFT JOIN database_containers container ON container.block_id = block.id \
             WHERE block.type IN ('page', 'database') AND block.lifecycle = 'active' \
               AND COALESCE(page.lifecycle, container.lifecycle) = 'active' \
               AND (?2 IS NULL OR ordered.path > ?2 \
                 OR (ordered.path = ?2 AND block.id > ?3)) \
             ORDER BY ordered.path, block.id LIMIT ?4",
        )?
        .query_map(
            params![document_id, after_sort_key, after_id, query_limit],
            navigation_row,
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let total = connection.query_row(
        "WITH RECURSIVE ordered(block_id) AS ( \
           SELECT block_id FROM document_block_index \
           WHERE document_id = ?1 AND parent_block_id IS NULL \
           UNION ALL \
           SELECT child.block_id FROM ordered \
           INNER JOIN document_block_index child \
             ON child.document_id = ?1 AND child.parent_block_id = ordered.block_id \
         ) \
         SELECT COUNT(*) FROM ordered \
         INNER JOIN blocks block ON block.id = ordered.block_id \
         LEFT JOIN pages page ON page.block_id = block.id \
         LEFT JOIN database_containers container ON container.block_id = block.id \
         WHERE block.type IN ('page', 'database') AND block.lifecycle = 'active' \
           AND COALESCE(page.lifecycle, container.lifecycle) = 'active'",
        [document_id],
        |row| row.get::<_, i64>(0),
    )?;
    Ok((nodes, count_to_u64(total)?))
}

fn page_node(connection: &Connection, page_id: &str) -> Result<LibraryNavigationNode, StoreError> {
    connection
        .query_row(
            "SELECT page.block_id, materialization.title, page.parent_revision, \
               page.metadata_revision, document.generation, document.head_seq, page.updated_at, \
               EXISTS(SELECT 1 FROM document_block_index child \
                 INNER JOIN blocks block ON block.id = child.block_id \
                 WHERE child.document_id = page.document_id \
                   AND block.type IN ('page', 'database') AND block.lifecycle = 'active') \
             FROM pages page \
             INNER JOIN documents document ON document.id = page.document_id \
             INNER JOIN document_materializations materialization \
               ON materialization.document_id = page.document_id \
             WHERE page.block_id = ?1 AND page.lifecycle <> 'deleted'",
            [page_id],
            |row| {
                Ok(LibraryNavigationNode::Page {
                    page_id: row.get(0)?,
                    title: row.get(1)?,
                    parent_revision: row.get(2)?,
                    metadata_revision: row.get(3)?,
                    document_generation: row.get(4)?,
                    document_head_seq: row.get(5)?,
                    updated_at: row.get(6)?,
                    has_children: row.get::<_, i64>(7)? == 1,
                })
            },
        )
        .optional()?
        .ok_or_else(|| not_found("Library Page projection is unavailable"))
}

fn database_node(
    connection: &Connection,
    database_id: &str,
) -> Result<LibraryNavigationNode, StoreError> {
    connection
        .query_row(
            "SELECT container.block_id, container.name, container.default_view_id, \
               container.metadata_revision, block.location_revision, container.updated_at, \
               COUNT(view.id) \
             FROM database_containers container \
             INNER JOIN blocks block ON block.id = container.block_id \
             LEFT JOIN database_views view ON view.database_block_id = container.block_id \
               AND view.lifecycle = 'active' \
             WHERE container.block_id = ?1 AND container.lifecycle <> 'deleted' \
             GROUP BY container.block_id",
            [database_id],
            |row| {
                let default_view_id = row.get::<_, Option<String>>(2)?.ok_or_else(|| {
                    rusqlite::Error::InvalidColumnType(
                        2,
                        "default_view_id".to_owned(),
                        rusqlite::types::Type::Null,
                    )
                })?;
                Ok(LibraryNavigationNode::Database {
                    database_id: row.get(0)?,
                    title: row.get(1)?,
                    default_view_id,
                    metadata_revision: row.get(3)?,
                    location_revision: row.get(4)?,
                    updated_at: row.get(5)?,
                    has_multiple_views: row.get::<_, i64>(6)? > 1,
                })
            },
        )
        .optional()?
        .ok_or_else(|| not_found("Library Database projection is unavailable"))
}

fn view_node_window(
    connection: &Connection,
    library_id: &str,
    database_id: &str,
    after: Option<&cursor::KeysetCoordinate>,
    limit: usize,
) -> Result<(Vec<OrderedNavigationNode>, u64), StoreError> {
    let default_view_id = connection
        .query_row(
            "SELECT default_view_id FROM database_containers \
             WHERE block_id = ?1 AND library_id = ?2 AND lifecycle = 'active'",
            params![database_id, library_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()?
        .ok_or_else(|| not_found("Library Database is unavailable"))?;
    let (after_sort_key, after_id) = keyset_text_coordinate(after)?;
    let query_limit =
        i64::try_from(limit.saturating_add(1)).map_err(|_| invalid("Library limit overflowed"))?;
    let nodes = connection
        .prepare(
            "SELECT id, database_block_id, data_source_id, name, kind, revision, rank_key \
             FROM database_views WHERE database_block_id = ?1 AND lifecycle = 'active' \
               AND (?2 IS NULL OR rank_key > ?2 OR (rank_key = ?2 AND id > ?3)) \
             ORDER BY rank_key, id LIMIT ?4",
        )?
        .query_map(
            params![database_id, after_sort_key, after_id, query_limit],
            |row| {
                let view_id = row.get::<_, String>(0)?;
                Ok(OrderedNavigationNode {
                    node: LibraryNavigationNode::View {
                        is_default: default_view_id.as_ref() == Some(&view_id),
                        view_id,
                        database_id: row.get(1)?,
                        data_source_id: row.get(2)?,
                        title: row.get(3)?,
                        view_kind: row.get(4)?,
                        revision: row.get(5)?,
                    },
                    sort_key: row.get(6)?,
                })
            },
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let total = connection.query_row(
        "SELECT COUNT(*) FROM database_views \
         WHERE database_block_id = ?1 AND lifecycle = 'active'",
        [database_id],
        |row| row.get::<_, i64>(0),
    )?;
    Ok((nodes, count_to_u64(total)?))
}

fn navigation_row(row: &Row<'_>) -> rusqlite::Result<OrderedNavigationNode> {
    let kind = row.get::<_, String>(0)?;
    let id = row.get::<_, String>(1)?;
    let sort_key = row.get::<_, String>(2)?;
    let node = match kind.as_str() {
        "page" => LibraryNavigationNode::Page {
            page_id: id,
            title: row.get(3)?,
            parent_revision: row.get(4)?,
            metadata_revision: row.get(5)?,
            document_generation: row.get(6)?,
            document_head_seq: row.get(7)?,
            updated_at: row.get(8)?,
            has_children: row.get::<_, i64>(9)? == 1,
        },
        "database" => LibraryNavigationNode::Database {
            database_id: id,
            title: row.get(10)?,
            default_view_id: row.get::<_, Option<String>>(11)?.ok_or_else(|| {
                rusqlite::Error::InvalidColumnType(
                    11,
                    "default_view_id".to_owned(),
                    rusqlite::types::Type::Null,
                )
            })?,
            metadata_revision: row.get(12)?,
            location_revision: row.get(13)?,
            updated_at: row.get(14)?,
            has_multiple_views: row.get::<_, i64>(15)? > 1,
        },
        _ => {
            return Err(rusqlite::Error::InvalidColumnType(
                0,
                "block.type".to_owned(),
                rusqlite::types::Type::Text,
            ));
        }
    };
    Ok(OrderedNavigationNode { node, sort_key })
}

fn view_node(
    connection: &Connection,
    library_id: &str,
    database_id: &str,
    view_id: &str,
) -> Result<LibraryNavigationNode, StoreError> {
    connection
        .query_row(
            "SELECT view.id, view.database_block_id, view.data_source_id, view.name, \
               view.kind, view.revision, view.id = container.default_view_id \
             FROM database_views view \
             INNER JOIN database_containers container \
               ON container.block_id = view.database_block_id \
             WHERE view.id = ?1 AND view.database_block_id = ?2 \
               AND container.library_id = ?3 AND view.lifecycle = 'active' \
               AND container.lifecycle = 'active'",
            params![view_id, database_id, library_id],
            |row| {
                Ok(LibraryNavigationNode::View {
                    view_id: row.get(0)?,
                    database_id: row.get(1)?,
                    data_source_id: row.get(2)?,
                    title: row.get(3)?,
                    view_kind: row.get(4)?,
                    revision: row.get(5)?,
                    is_default: row.get::<_, i64>(6)? == 1,
                })
            },
        )
        .optional()?
        .ok_or_else(|| not_found("Library View is unavailable"))
}

fn forced_child_node(
    connection: &Connection,
    library_id: &str,
    parent: &LibraryNavigationParent,
    target: &LibraryRouteTarget,
) -> Result<Option<LibraryNavigationNode>, StoreError> {
    match (parent, target) {
        (LibraryNavigationParent::Library, LibraryRouteTarget::Page { page_id }) => {
            let exists = connection.query_row(
                "SELECT EXISTS(SELECT 1 FROM library_block_placements placement \
                 INNER JOIN pages page ON page.block_id = placement.block_id \
                 WHERE placement.library_id = ?1 AND placement.block_id = ?2 \
                   AND page.lifecycle = 'active')",
                params![library_id, page_id],
                |row| row.get::<_, bool>(0),
            )?;
            exists.then(|| page_node(connection, page_id)).transpose()
        }
        (LibraryNavigationParent::Library, LibraryRouteTarget::Database { database_id }) => {
            let exists = connection.query_row(
                "SELECT EXISTS(SELECT 1 FROM library_block_placements placement \
                 INNER JOIN database_containers container \
                   ON container.block_id = placement.block_id \
                 WHERE placement.library_id = ?1 AND placement.block_id = ?2 \
                   AND container.lifecycle = 'active')",
                params![library_id, database_id],
                |row| row.get::<_, bool>(0),
            )?;
            exists
                .then(|| database_node(connection, database_id))
                .transpose()
        }
        (
            LibraryNavigationParent::Page {
                page_id: parent_page_id,
            },
            LibraryRouteTarget::Page { page_id },
        ) => forced_document_child(connection, library_id, parent_page_id, page_id)?
            .then(|| page_node(connection, page_id))
            .transpose(),
        (
            LibraryNavigationParent::Page {
                page_id: parent_page_id,
            },
            LibraryRouteTarget::Database { database_id },
        ) => forced_document_child(connection, library_id, parent_page_id, database_id)?
            .then(|| database_node(connection, database_id))
            .transpose(),
        (
            LibraryNavigationParent::Database { database_id },
            LibraryRouteTarget::View { view_id },
        ) => {
            let exists = connection.query_row(
                "SELECT EXISTS(SELECT 1 FROM database_views view \
                 INNER JOIN database_containers container \
                   ON container.block_id = view.database_block_id \
                 WHERE view.id = ?1 AND view.database_block_id = ?2 \
                   AND container.library_id = ?3 AND view.lifecycle = 'active' \
                   AND container.lifecycle = 'active')",
                params![view_id, database_id, library_id],
                |row| row.get::<_, bool>(0),
            )?;
            exists
                .then(|| view_node(connection, library_id, database_id, view_id))
                .transpose()
        }
        _ => Ok(None),
    }
}

fn forced_document_child(
    connection: &Connection,
    library_id: &str,
    parent_page_id: &str,
    target_id: &str,
) -> Result<bool, StoreError> {
    connection
        .query_row(
            "WITH RECURSIVE ordered(block_id) AS ( \
               SELECT child.block_id FROM pages page \
               INNER JOIN document_block_index child \
                 ON child.document_id = page.document_id \
               WHERE page.block_id = ?1 AND page.library_id = ?2 \
                 AND page.lifecycle = 'active' AND child.parent_block_id IS NULL \
               UNION ALL \
               SELECT child.block_id FROM ordered \
               INNER JOIN document_block_index child \
                 ON child.parent_block_id = ordered.block_id \
             ) \
             SELECT EXISTS(SELECT 1 FROM ordered \
               INNER JOIN blocks block ON block.id = ordered.block_id \
               WHERE ordered.block_id = ?3 AND block.lifecycle = 'active' \
                 AND block.type IN ('page', 'database'))",
            params![parent_page_id, library_id, target_id],
            |row| row.get(0),
        )
        .map_err(Into::into)
}

fn path(
    connection: &Connection,
    library_id: &str,
    target: &LibraryRouteTarget,
) -> Result<Vec<LibraryNavigationNode>, StoreError> {
    match target {
        LibraryRouteTarget::Page { page_id } => page_path(connection, library_id, page_id),
        LibraryRouteTarget::Database { database_id } => {
            database_path(connection, library_id, database_id)
        }
        LibraryRouteTarget::View { view_id } => {
            let database_id = connection
                .query_row(
                    "SELECT database_block_id FROM database_views \
                     WHERE id = ?1 AND lifecycle = 'active'",
                    [view_id],
                    |row| row.get::<_, String>(0),
                )
                .optional()?
                .ok_or_else(|| not_found("Library View is unavailable"))?;
            let mut nodes = database_path(connection, library_id, &database_id)?;
            let view = view_node(connection, library_id, &database_id, view_id)?;
            nodes.push(view);
            Ok(nodes)
        }
    }
}

fn page_path(
    connection: &Connection,
    library_id: &str,
    page_id: &str,
) -> Result<Vec<LibraryNavigationNode>, StoreError> {
    let mut current = page_id.to_owned();
    let mut page_ids = Vec::new();
    let mut seen = HashSet::new();
    loop {
        if page_ids.len() >= 512 {
            return Err(corrupt("Library Page hierarchy exceeds 512 Page levels"));
        }
        if !seen.insert(current.clone()) {
            return Err(corrupt("Library Page hierarchy contains a cycle"));
        }
        let row = connection
            .query_row(
                "SELECT parent_kind, parent_id FROM pages \
                 WHERE block_id = ?1 AND library_id = ?2 AND lifecycle <> 'deleted'",
                params![current, library_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?
            .ok_or_else(|| not_found("Library Page is unavailable"))?;
        page_ids.push(current.clone());
        match row.0.as_str() {
            "library" => break,
            "page" => current = row.1,
            "data_source" => {
                let database_id = connection
                    .query_row(
                        "SELECT home_database_block_id FROM data_sources \
                         WHERE id = ?1 AND library_id = ?2 AND lifecycle <> 'deleted'",
                        params![row.1, library_id],
                        |row| row.get::<_, String>(0),
                    )
                    .optional()?
                    .ok_or_else(|| corrupt("Library Page has no owning Data Source"))?;
                return database_path(connection, library_id, &database_id);
            }
            _ => return Err(corrupt("Library Page has an invalid parent")),
        }
    }
    page_ids.reverse();
    page_ids
        .into_iter()
        .map(|page_id| page_node(connection, &page_id))
        .collect()
}

fn database_path(
    connection: &Connection,
    library_id: &str,
    database_id: &str,
) -> Result<Vec<LibraryNavigationNode>, StoreError> {
    let database = database_node(connection, database_id)?;
    let host_page = connection
        .query_row(
            "SELECT page.block_id FROM blocks block \
             INNER JOIN block_documents ownership \
               ON ownership.document_id = block.containing_document_id \
             INNER JOIN pages page ON page.block_id = ownership.block_id \
             WHERE block.id = ?1 AND block.location_kind = 'document'",
            [database_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    let mut nodes = host_page
        .map(|page_id| page_path(connection, library_id, &page_id))
        .transpose()?
        .unwrap_or_default();
    nodes.push(database);
    Ok(nodes)
}

#[allow(clippy::too_many_arguments)]
fn catalog(
    connection: &Connection,
    library_id: &str,
    query: Option<String>,
    kinds: Option<Vec<LibraryCatalogKind>>,
    lifecycle: Option<LibraryLifecycle>,
    requested_cursor: Option<String>,
    limit: Option<u32>,
) -> Result<LibraryReadValue, StoreError> {
    let query = query.unwrap_or_default().trim().to_lowercase();
    if query.len() > 256 {
        return Err(invalid("Library catalog query exceeds its bound"));
    }
    let lifecycle = lifecycle.unwrap_or(LibraryLifecycle::Active);
    let lifecycle_value = match lifecycle {
        LibraryLifecycle::Active => "active",
        LibraryLifecycle::Archived => "archived",
    };
    let kinds =
        kinds.unwrap_or_else(|| vec![LibraryCatalogKind::Page, LibraryCatalogKind::Database]);
    let kind_subject = kinds
        .iter()
        .map(|kind| match kind {
            LibraryCatalogKind::Page => "page",
            LibraryCatalogKind::Database => "database",
        })
        .collect::<Vec<_>>()
        .join(",");
    let subject = vec![
        "catalog".to_owned(),
        lifecycle_value.to_owned(),
        kind_subject,
        query.clone(),
    ];
    let after = cursor_coordinate(
        connection,
        requested_cursor.as_deref(),
        library_id,
        &subject,
    )?;
    let limit = read_limit(limit)?;
    let (after_updated_at, after_id) = keyset_text_coordinate(after.as_ref())?;
    let include_pages = kinds.contains(&LibraryCatalogKind::Page);
    let include_databases = kinds.contains(&LibraryCatalogKind::Database);
    let query_limit =
        i64::try_from(limit.saturating_add(1)).map_err(|_| invalid("Library limit overflowed"))?;
    let catalog_cte = "\
      WITH catalog(id, kind, title, updated_at, location_revision, metadata_revision, location_label) AS ( \
        SELECT page.block_id, 'page', materialization.title, page.updated_at, \
          page.parent_revision, page.metadata_revision, \
          CASE page.parent_kind \
            WHEN 'library' THEN 'Library' \
            WHEN 'page' THEN COALESCE(( \
              SELECT parent_materialization.title FROM pages parent_page \
              INNER JOIN document_materializations parent_materialization \
                ON parent_materialization.document_id = parent_page.document_id \
              WHERE parent_page.block_id = page.parent_id \
            ), 'Page') \
            WHEN 'data_source' THEN COALESCE(( \
              SELECT container.name FROM data_sources source \
              INNER JOIN database_containers container \
                ON container.block_id = source.home_database_block_id \
              WHERE source.id = page.parent_id \
            ), 'Database') \
            ELSE 'Library' \
          END \
        FROM pages page \
        INNER JOIN document_materializations materialization \
          ON materialization.document_id = page.document_id \
        WHERE ?3 AND page.library_id = ?1 AND page.lifecycle = ?2 \
        UNION ALL \
        SELECT container.block_id, 'database', container.name, container.updated_at, \
          block.location_revision, container.metadata_revision, \
          COALESCE(( \
            SELECT host_materialization.title FROM block_documents ownership \
            INNER JOIN pages host_page ON host_page.block_id = ownership.block_id \
            INNER JOIN document_materializations host_materialization \
              ON host_materialization.document_id = host_page.document_id \
            WHERE ownership.document_id = block.containing_document_id \
              AND block.location_kind = 'document' LIMIT 1 \
          ), 'Library') \
        FROM database_containers container \
        INNER JOIN blocks block ON block.id = container.block_id \
        WHERE ?4 AND container.library_id = ?1 AND container.lifecycle = ?2 \
      ) ";
    let rows_sql = format!(
        "{catalog_cte} \
         SELECT id, kind, title, updated_at, location_revision, metadata_revision, location_label \
         FROM catalog WHERE (?5 = '' OR instr(lower(title), ?5) > 0) \
           AND (?6 IS NULL OR updated_at < ?6 \
             OR (updated_at = ?6 AND id > ?7)) \
         ORDER BY updated_at DESC, id LIMIT ?8"
    );
    let mut entries = connection
        .prepare(&rows_sql)?
        .query_map(
            params![
                library_id,
                lifecycle_value,
                include_pages,
                include_databases,
                query,
                after_updated_at,
                after_id,
                query_limit
            ],
            |row| {
                let id = row.get::<_, String>(0)?;
                let kind = match row.get::<_, String>(1)?.as_str() {
                    "page" => LibraryCatalogKind::Page,
                    "database" => LibraryCatalogKind::Database,
                    _ => unreachable!("catalog CTE emits fixed kinds"),
                };
                let target = match kind {
                    LibraryCatalogKind::Page => LibraryResourceTarget::Page { page_id: id },
                    LibraryCatalogKind::Database => {
                        LibraryResourceTarget::Database { database_id: id }
                    }
                };
                Ok(LibraryCatalogEntry {
                    target,
                    kind,
                    lifecycle,
                    title: row.get(2)?,
                    updated_at: row.get(3)?,
                    location_revision: row.get(4)?,
                    metadata_revision: row.get(5)?,
                    location_label: row.get(6)?,
                })
            },
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let has_more = entries.len() > limit;
    entries.truncate(limit);
    let next_cursor = has_more
        .then(|| {
            let last = entries
                .last()
                .ok_or_else(|| corrupt("Library catalog continuation has no entry"))?;
            cursor::mint(
                connection,
                library_id,
                &subject,
                cursor::KeysetCoordinate {
                    values: vec![cursor::KeysetValue::Text {
                        value: last.updated_at.clone(),
                    }],
                    stable_id: catalog_id(last).to_owned(),
                },
            )
        })
        .transpose()?;
    let total_sql = format!(
        "{catalog_cte} \
         SELECT COUNT(*) FROM catalog \
         WHERE (?5 = '' OR instr(lower(title), ?5) > 0)"
    );
    let total = connection.query_row(
        &total_sql,
        params![
            library_id,
            lifecycle_value,
            include_pages,
            include_databases,
            query
        ],
        |row| row.get::<_, i64>(0),
    )?;
    Ok(LibraryReadValue::Catalog {
        items: entries,
        next_cursor,
        has_more,
        total: count_to_u64(total)?,
    })
}

fn cursor_coordinate(
    connection: &Connection,
    requested_cursor: Option<&str>,
    library_id: &str,
    subject: &[String],
) -> Result<Option<cursor::KeysetCoordinate>, StoreError> {
    let Some(requested_cursor) = requested_cursor else {
        return Ok(None);
    };
    cursor::decode(connection, requested_cursor, library_id, subject).map(Some)
}

fn keyset_text_coordinate(
    coordinate: Option<&cursor::KeysetCoordinate>,
) -> Result<(Option<String>, Option<String>), StoreError> {
    let Some(coordinate) = coordinate else {
        return Ok((None, None));
    };
    let [cursor::KeysetValue::Text { value: sort_key }] = coordinate.values.as_slice() else {
        return Err(invalid("Library cursor coordinate is invalid"));
    };
    Ok((Some(sort_key.clone()), Some(coordinate.stable_id.clone())))
}

fn count_to_u64(count: i64) -> Result<u64, StoreError> {
    u64::try_from(count).map_err(|_| corrupt("Library collection count is invalid"))
}

fn read_limit(limit: Option<u32>) -> Result<usize, StoreError> {
    let limit = usize::try_from(limit.unwrap_or(DEFAULT_LIMIT as u32))
        .map_err(|_| invalid("Library read limit is invalid"))?;
    if (1..=MAX_LIMIT).contains(&limit) {
        return Ok(limit);
    }
    Err(invalid("Library read limit is out of range"))
}

fn matches_target(node: &LibraryNavigationNode, target: &LibraryRouteTarget) -> bool {
    match (node, target) {
        (
            LibraryNavigationNode::Page { page_id, .. },
            LibraryRouteTarget::Page { page_id: target },
        ) => page_id == target,
        (
            LibraryNavigationNode::Database { database_id, .. },
            LibraryRouteTarget::Database {
                database_id: target,
            },
        ) => database_id == target,
        (
            LibraryNavigationNode::View { view_id, .. },
            LibraryRouteTarget::View { view_id: target },
        ) => view_id == target,
        _ => false,
    }
}

fn navigation_node_id(node: &LibraryNavigationNode) -> &str {
    match node {
        LibraryNavigationNode::Page { page_id, .. } => page_id,
        LibraryNavigationNode::Database { database_id, .. } => database_id,
        LibraryNavigationNode::View { view_id, .. } => view_id,
    }
}

fn catalog_id(entry: &LibraryCatalogEntry) -> &str {
    match &entry.target {
        LibraryResourceTarget::Page { page_id } => page_id,
        LibraryResourceTarget::Database { database_id } => database_id,
    }
}

fn invalid(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::InvalidInput, message, false)
}

fn unauthorized(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::Unauthorized, message, false)
}

fn not_found(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::NotFound, message, false)
}

fn corrupt(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message, false)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::valid_intrinsic_value;

    #[test]
    fn accepts_nullable_string_and_json_intrinsic_values() {
        assert!(valid_intrinsic_value("string", &json!(null)));
        assert!(valid_intrinsic_value("json", &json!(null)));
        assert!(valid_intrinsic_value("string", &json!("value")));
        assert!(valid_intrinsic_value("json", &json!({ "key": "value" })));
        assert!(!valid_intrinsic_value("string", &json!(42)));
        assert!(!valid_intrinsic_value("json", &json!("value")));
    }
}
