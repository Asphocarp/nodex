use nodex_core_contracts::events::ResourceKey;
use rusqlite::{Connection, OptionalExtension, params};

use crate::infrastructure::sqlite::StoreError;

/// Returns the complete Page ownership path from the subject through the
/// farthest active grant root that authorizes it. Page ownership is a single
/// chain, so overlapping grants collapse to one canonical path.
pub(crate) fn page_grant_ownership_proof(
    connection: &Connection,
    project_id: &str,
    page_id: &str,
    write_required: bool,
) -> Result<Option<Vec<ResourceKey>>, StoreError> {
    let page_ids = connection
        .prepare(
            "WITH RECURSIVE ancestors(page_id, depth, path) AS ( \
               SELECT ?2, 0, '|' || ?2 || '|' UNION ALL \
               SELECT page.parent_id, ancestors.depth + 1, \
                 ancestors.path || page.parent_id || '|' \
               FROM pages page JOIN ancestors ON page.block_id = ancestors.page_id \
               WHERE page.parent_kind = 'page' \
                 AND instr(ancestors.path, '|' || page.parent_id || '|') = 0 \
             ), authorized_depth(max_depth) AS ( \
               SELECT max(ancestors.depth) FROM ancestors \
               JOIN project_resource_grants grant_row \
                 ON grant_row.root_kind = 'page' \
                AND grant_row.root_id = ancestors.page_id \
                AND grant_row.project_id = ?1 \
                AND grant_row.lifecycle = 'active' \
                AND (?3 = 0 OR grant_row.access = 'read_write') \
             ) \
             SELECT ancestors.page_id FROM ancestors, authorized_depth \
             WHERE authorized_depth.max_depth IS NOT NULL \
               AND ancestors.depth <= authorized_depth.max_depth \
             ORDER BY ancestors.depth",
        )?
        .query_map(
            params![project_id, page_id, i64::from(write_required)],
            |row| row.get::<_, String>(0),
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    if page_ids.is_empty() {
        return Ok(None);
    }
    Ok(Some(
        page_ids
            .into_iter()
            .map(|page_id| ResourceKey::Page { page_id })
            .collect(),
    ))
}

/// Resolves direct Project access to a top-level Canvas. Embedded Canvases do
/// not use this path: their authority is inherited from the owning Page.
pub(crate) fn canvas_grant_authorization_proof(
    connection: &Connection,
    library_id: &str,
    project_id: &str,
    canvas_id: &str,
    write_required: bool,
) -> Result<Option<Vec<ResourceKey>>, StoreError> {
    canvas_grant_authorization_proof_with_lifecycle(
        connection,
        library_id,
        project_id,
        canvas_id,
        write_required,
        false,
    )
}

pub(crate) fn canvas_lifecycle_grant_authorization_proof(
    connection: &Connection,
    library_id: &str,
    project_id: &str,
    canvas_id: &str,
) -> Result<Option<Vec<ResourceKey>>, StoreError> {
    canvas_grant_authorization_proof_with_lifecycle(
        connection, library_id, project_id, canvas_id, false, true,
    )
}

fn canvas_grant_authorization_proof_with_lifecycle(
    connection: &Connection,
    library_id: &str,
    project_id: &str,
    canvas_id: &str,
    write_required: bool,
    include_deleted: bool,
) -> Result<Option<Vec<ResourceKey>>, StoreError> {
    let authorized = connection
        .query_row(
            "SELECT 1 \
             FROM projects project \
             JOIN blocks block ON block.id = ?3 AND block.library_id = project.library_id \
             JOIN canvas_owners canvas ON canvas.block_id = block.id \
               AND canvas.library_id = block.library_id \
             LEFT JOIN library_block_placements placement ON placement.block_id = block.id \
               AND placement.library_id = block.library_id \
             JOIN project_resource_grants grant_row \
               ON grant_row.project_id = project.id \
              AND grant_row.library_id = project.library_id \
              AND grant_row.root_kind = 'canvas' \
              AND grant_row.root_id = block.id \
             LEFT JOIN document_block_index containing ON containing.block_id = block.id \
             WHERE project.id = ?1 AND project.library_id = ?2 \
               AND project.lifecycle = 'active' \
               AND block.type = 'canvas' \
               AND (?5 = 1 OR block.lifecycle <> 'deleted') \
               AND (block.lifecycle = 'deleted' OR placement.block_id IS NOT NULL) \
               AND containing.block_id IS NULL \
               AND grant_row.lifecycle = 'active' \
               AND (?4 = 0 OR grant_row.access = 'read_write')",
            params![
                project_id,
                library_id,
                canvas_id,
                i64::from(write_required),
                i64::from(include_deleted),
            ],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    Ok(authorized.then(|| {
        vec![ResourceKey::Canvas {
            canvas_id: canvas_id.to_owned(),
        }]
    }))
}
