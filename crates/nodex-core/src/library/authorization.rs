use nodex_core_contracts::events::ResourceKey;
use rusqlite::{Connection, params};

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
