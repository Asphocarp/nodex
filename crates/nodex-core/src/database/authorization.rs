use std::collections::BTreeSet;

use nodex_core_contracts::events::ResourceKey;
use rusqlite::{Connection, OptionalExtension, params};

use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};

pub(crate) fn project_primary_database(
    connection: &Connection,
    library_id: &str,
    project_id: &str,
) -> Result<Option<String>, StoreError> {
    let project = connection
        .query_row(
            "SELECT database_block_id, lifecycle FROM projects \
             WHERE id = ?1 AND library_id = ?2",
            params![project_id, library_id],
            |row| Ok((row.get::<_, Option<String>>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()?;
    let Some((database_id, lifecycle)) = project else {
        return Err(not_found("Bound Project is unavailable in this Library"));
    };
    if lifecycle != "active" {
        return Err(unauthorized("Bound Project is not active"));
    }
    if database_id.is_some() {
        return Ok(database_id);
    }
    connection
        .query_row(
            "SELECT database_block_id FROM project_database_bindings \
             WHERE project_id = ?1 AND library_id = ?2 AND lifecycle = 'active'",
            params![project_id, library_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(StoreError::from)
}

pub(crate) fn authorize_required(
    connection: &Connection,
    project_id: Option<&str>,
    primary_database_id: Option<&str>,
    database_id: &str,
) -> Result<(), StoreError> {
    let Some(project_id) = project_id else {
        return Ok(());
    };
    if authorize_database(connection, project_id, primary_database_id, database_id)? {
        return Ok(());
    }
    Err(unauthorized("Project is not authorized for this Database"))
}

pub(crate) fn authorize_database(
    connection: &Connection,
    project_id: &str,
    primary_database_id: Option<&str>,
    database_id: &str,
) -> Result<bool, StoreError> {
    Ok(
        read_authorization_roots(connection, project_id, primary_database_id, database_id)?
            .is_some(),
    )
}

pub(crate) fn read_authorization_roots(
    connection: &Connection,
    project_id: &str,
    primary_database_id: Option<&str>,
    database_id: &str,
) -> Result<Option<Vec<ResourceKey>>, StoreError> {
    let mut roots = BTreeSet::from([ResourceKey::Database {
        database_id: database_id.to_owned(),
    }]);
    let primary = primary_database_id == Some(database_id);
    let direct = connection
        .query_row(
            "SELECT 1 FROM project_resource_grants WHERE project_id = ?1 \
             AND root_kind = 'database' AND root_id = ?2 AND lifecycle = 'active'",
            params![project_id, database_id],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    let mut authorized = primary || direct;
    let containing_document_id = connection
        .query_row(
            "SELECT containing_document_id FROM blocks WHERE id = ?1 AND type = 'database'",
            [database_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()?
        .flatten();
    let Some(containing_document_id) = containing_document_id else {
        return Ok(authorized.then(|| roots.into_iter().collect()));
    };
    let owner_page_id = connection
        .query_row(
            "SELECT page.block_id FROM block_documents ownership \
             JOIN pages page ON page.block_id = ownership.block_id \
             WHERE ownership.document_id = ?1",
            [&containing_document_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    let Some(owner_page_id) = owner_page_id else {
        if authorized {
            return Ok(Some(roots.into_iter().collect()));
        }
        return Err(corrupt("Embedded Database has no owning Page"));
    };
    let inherited_roots = connection
        .prepare(
            "WITH RECURSIVE ancestors(page_id, path) AS (\
               SELECT ?2, '|' || ?2 || '|' \
               UNION ALL \
               SELECT page.parent_id, ancestors.path || page.parent_id || '|' \
               FROM pages page JOIN ancestors ON page.block_id = ancestors.page_id \
               WHERE page.parent_kind = 'page' \
                 AND instr(ancestors.path, '|' || page.parent_id || '|') = 0\
             ) SELECT grant_row.root_id FROM project_resource_grants grant_row JOIN ancestors \
               ON grant_row.root_id = ancestors.page_id \
             WHERE grant_row.project_id = ?1 AND grant_row.root_kind = 'page' \
               AND grant_row.lifecycle = 'active' ORDER BY grant_row.root_id",
        )?
        .query_map(params![project_id, owner_page_id], |row| {
            row.get::<_, String>(0)
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for page_id in inherited_roots {
        authorized = true;
        roots.insert(ResourceKey::Page { page_id });
    }
    Ok(authorized.then(|| roots.into_iter().collect()))
}

fn not_found(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::NotFound, message, false)
}

fn unauthorized(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::Unauthorized, message, false)
}

fn corrupt(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message, false)
}
