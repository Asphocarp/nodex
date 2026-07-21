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
use rusqlite::{Connection, OptionalExtension, params};
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
        LibraryRead::Metadata => Err(invalid("Metadata is assembled by the Library Module")),
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
                event_head,
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
            event_head,
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
            event_head,
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
            event_head,
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
    event_head: i64,
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
    let offset = cursor_offset(
        connection,
        requested_cursor.as_deref(),
        library_id,
        &subject,
        event_head,
    )?;
    let nodes = match &parent {
        LibraryNavigationParent::Library => root_nodes(connection, library_id)?,
        LibraryNavigationParent::Page { page_id } => {
            page_child_nodes(connection, library_id, page_id)?
        }
        LibraryNavigationParent::Database { database_id } => {
            view_nodes(connection, library_id, database_id)?
        }
    };
    let limit = read_limit(limit)?;
    let mut items = nodes
        .iter()
        .skip(offset)
        .take(limit)
        .cloned()
        .collect::<Vec<_>>();
    if let Some(target) = force_include_target
        && !items.iter().any(|node| matches_target(node, &target))
        && let Some(forced) = nodes.iter().find(|node| matches_target(node, &target))
    {
        items.push(forced.clone());
    }
    let next_offset = offset.saturating_add(limit);
    let has_more = next_offset < nodes.len();
    let next_cursor = has_more
        .then(|| cursor::mint(connection, library_id, &subject, next_offset, event_head))
        .transpose()?;
    Ok(LibraryReadValue::Children {
        parent,
        items,
        next_cursor,
        has_more,
        total: u64::try_from(nodes.len()).map_err(|_| corrupt("Library child count overflowed"))?,
    })
}

fn root_nodes(
    connection: &Connection,
    library_id: &str,
) -> Result<Vec<LibraryNavigationNode>, StoreError> {
    let shells = connection
        .prepare(
            "SELECT block.id, block.type FROM library_block_placements placement \
             INNER JOIN blocks block ON block.id = placement.block_id \
             LEFT JOIN pages page ON page.block_id = block.id \
             LEFT JOIN database_containers container ON container.block_id = block.id \
             WHERE placement.library_id = ?1 AND block.type IN ('page', 'database') \
               AND block.lifecycle = 'active' \
               AND COALESCE(page.lifecycle, container.lifecycle) = 'active' \
             ORDER BY placement.rank_key, block.id",
        )?
        .query_map([library_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    hydrate_shells(connection, shells)
}

fn page_child_nodes(
    connection: &Connection,
    library_id: &str,
    page_id: &str,
) -> Result<Vec<LibraryNavigationNode>, StoreError> {
    let document_id = connection
        .query_row(
            "SELECT document_id FROM pages \
             WHERE block_id = ?1 AND library_id = ?2 AND lifecycle = 'active'",
            params![page_id, library_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or_else(|| not_found("Library Page is unavailable"))?;
    let shells = connection
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
             SELECT block.id, block.type FROM ordered \
             INNER JOIN blocks block ON block.id = ordered.block_id \
             LEFT JOIN pages page ON page.block_id = block.id \
             LEFT JOIN database_containers container ON container.block_id = block.id \
             WHERE block.type IN ('page', 'database') AND block.lifecycle = 'active' \
               AND COALESCE(page.lifecycle, container.lifecycle) = 'active' \
             ORDER BY ordered.path",
        )?
        .query_map([document_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    hydrate_shells(connection, shells)
}

fn hydrate_shells(
    connection: &Connection,
    shells: Vec<(String, String)>,
) -> Result<Vec<LibraryNavigationNode>, StoreError> {
    shells
        .into_iter()
        .map(|(id, kind)| match kind.as_str() {
            "page" => page_node(connection, &id),
            "database" => database_node(connection, &id),
            _ => Err(corrupt(
                "Library navigation contains an unsupported Block type",
            )),
        })
        .collect()
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

fn view_nodes(
    connection: &Connection,
    library_id: &str,
    database_id: &str,
) -> Result<Vec<LibraryNavigationNode>, StoreError> {
    let default_view_id = connection
        .query_row(
            "SELECT default_view_id FROM database_containers \
             WHERE block_id = ?1 AND library_id = ?2 AND lifecycle = 'active'",
            params![database_id, library_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()?
        .ok_or_else(|| not_found("Library Database is unavailable"))?;
    connection
        .prepare(
            "SELECT id, database_block_id, data_source_id, name, kind, revision \
             FROM database_views WHERE database_block_id = ?1 AND lifecycle = 'active' \
             ORDER BY rank_key, id",
        )?
        .query_map([database_id], |row| {
            let view_id = row.get::<_, String>(0)?;
            Ok(LibraryNavigationNode::View {
                is_default: default_view_id.as_ref() == Some(&view_id),
                view_id,
                database_id: row.get(1)?,
                data_source_id: row.get(2)?,
                title: row.get(3)?,
                view_kind: row.get(4)?,
                revision: row.get(5)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()
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
            let view = view_nodes(connection, library_id, &database_id)?
                .into_iter()
                .find(|node| matches!(node, LibraryNavigationNode::View { view_id: id, .. } if id == view_id))
                .ok_or_else(|| not_found("Library View is unavailable"))?;
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
    event_head: i64,
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
    let offset = cursor_offset(
        connection,
        requested_cursor.as_deref(),
        library_id,
        &subject,
        event_head,
    )?;
    let mut entries = Vec::new();
    if kinds.contains(&LibraryCatalogKind::Page) {
        let page_ids = connection
            .prepare(
                "SELECT block_id FROM pages WHERE library_id = ?1 AND lifecycle = ?2 \
                 ORDER BY updated_at DESC, block_id",
            )?
            .query_map(params![library_id, lifecycle_value], |row| {
                row.get::<_, String>(0)
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for page_id in page_ids {
            let node = page_node(connection, &page_id)?;
            let LibraryNavigationNode::Page {
                title,
                parent_revision,
                metadata_revision,
                updated_at,
                ..
            } = node
            else {
                unreachable!();
            };
            if !query.is_empty() && !title.to_lowercase().contains(&query) {
                continue;
            }
            entries.push(LibraryCatalogEntry {
                target: LibraryResourceTarget::Page {
                    page_id: page_id.clone(),
                },
                title,
                kind: LibraryCatalogKind::Page,
                lifecycle,
                location_label: page_location_label(connection, &page_id)?,
                updated_at,
                location_revision: parent_revision,
                metadata_revision,
            });
        }
    }
    if kinds.contains(&LibraryCatalogKind::Database) {
        let rows = connection
            .prepare(
                "SELECT container.block_id, container.name, container.updated_at, \
                   block.location_revision, container.metadata_revision \
                 FROM database_containers container \
                 INNER JOIN blocks block ON block.id = container.block_id \
                 WHERE container.library_id = ?1 AND container.lifecycle = ?2 \
                 ORDER BY container.updated_at DESC, container.block_id",
            )?
            .query_map(params![library_id, lifecycle_value], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, i64>(4)?,
                ))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for (database_id, title, updated_at, location_revision, metadata_revision) in rows {
            if !query.is_empty() && !title.to_lowercase().contains(&query) {
                continue;
            }
            entries.push(LibraryCatalogEntry {
                target: LibraryResourceTarget::Database {
                    database_id: database_id.clone(),
                },
                title,
                kind: LibraryCatalogKind::Database,
                lifecycle,
                location_label: database_location_label(connection, &database_id)?,
                updated_at,
                location_revision,
                metadata_revision,
            });
        }
    }
    entries.sort_by(|left, right| {
        right
            .updated_at
            .cmp(&left.updated_at)
            .then_with(|| catalog_id(left).cmp(catalog_id(right)))
    });
    let limit = read_limit(limit)?;
    let items = entries.iter().skip(offset).take(limit).cloned().collect();
    let next_offset = offset.saturating_add(limit);
    let has_more = next_offset < entries.len();
    let next_cursor = has_more
        .then(|| cursor::mint(connection, library_id, &subject, next_offset, event_head))
        .transpose()?;
    Ok(LibraryReadValue::Catalog {
        items,
        next_cursor,
        has_more,
        total: u64::try_from(entries.len())
            .map_err(|_| corrupt("Library catalog count overflowed"))?,
    })
}

fn page_location_label(connection: &Connection, page_id: &str) -> Result<String, StoreError> {
    let parent = connection.query_row(
        "SELECT parent_kind, parent_id FROM pages WHERE block_id = ?1",
        [page_id],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
    )?;
    match parent.0.as_str() {
        "library" => Ok("Library".to_owned()),
        "page" => connection
            .query_row(
                "SELECT materialization.title FROM pages page \
                 INNER JOIN document_materializations materialization \
                   ON materialization.document_id = page.document_id \
                 WHERE page.block_id = ?1",
                [parent.1],
                |row| row.get(0),
            )
            .optional()?
            .map_or_else(|| Ok("Page".to_owned()), Ok),
        "data_source" => connection
            .query_row(
                "SELECT container.name FROM data_sources source \
                 INNER JOIN database_containers container \
                   ON container.block_id = source.home_database_block_id \
                 WHERE source.id = ?1",
                [parent.1],
                |row| row.get(0),
            )
            .optional()?
            .map_or_else(|| Ok("Database".to_owned()), Ok),
        _ => Err(corrupt("Library Page has an invalid parent")),
    }
}

fn database_location_label(
    connection: &Connection,
    database_id: &str,
) -> Result<String, StoreError> {
    let host = connection
        .query_row(
            "SELECT materialization.title FROM blocks block \
             INNER JOIN block_documents ownership \
               ON ownership.document_id = block.containing_document_id \
             INNER JOIN pages page ON page.block_id = ownership.block_id \
             INNER JOIN document_materializations materialization \
               ON materialization.document_id = page.document_id \
             WHERE block.id = ?1 AND block.location_kind = 'document'",
            [database_id],
            |row| row.get(0),
        )
        .optional()?;
    Ok(host.unwrap_or_else(|| "Library".to_owned()))
}

fn cursor_offset(
    connection: &Connection,
    requested_cursor: Option<&str>,
    library_id: &str,
    subject: &[String],
    event_head: i64,
) -> Result<usize, StoreError> {
    let Some(requested_cursor) = requested_cursor else {
        return Ok(0);
    };
    let decoded = cursor::decode(connection, requested_cursor, library_id, subject)?;
    if decoded.change_log_seq != event_head {
        return Err(StoreError::new(
            StoreErrorCode::RevisionConflict,
            "Library content changed while the list was being paged",
            false,
        ));
    }
    Ok(decoded.offset)
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
