use std::collections::BTreeMap;

use nodex_core_contracts::{LocalProjectionPatch, LocalProjectionScope, ProjectionImpact};
use rusqlite::Connection;

use crate::infrastructure::local_commit::{self, CommitContext};
use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};

use super::window::{ViewGroupsRead, rows_by_id, view_groups};

const MAX_ROWS_BY_ID: usize = 100;

/// Records the renderer-facing result of a committed relational mutation.
///
/// This compiler deliberately reads the canonical post-write state from the
/// same SQLite transaction. Domain writers only describe their affected
/// coordinates; they never hand-author cards, memberships, totals, or cursor
/// values. Exact row patches provide the local fast path, while an explicit
/// read floor covers changes which cannot be represented by a bounded patch.
pub(crate) fn record_local_projection_delta(
    connection: &Connection,
    commit: &CommitContext,
    library_id: &str,
    project_id: Option<&str>,
    impact: &ProjectionImpact,
) -> Result<(), StoreError> {
    let Some(project_id) = project_id else {
        return local_commit::require_projection_read(
            connection,
            commit,
            LocalProjectionScope::Library {
                library_id: library_id.to_owned(),
            },
        );
    };

    let ProjectionImpact::Resources {
        page_ids,
        database_ids,
        data_source_ids,
        view_ids,
        ..
    } = impact
    else {
        return match impact {
            ProjectionImpact::None => Ok(()),
            ProjectionImpact::All => local_commit::require_projection_read(
                connection,
                commit,
                LocalProjectionScope::Library {
                    library_id: library_id.to_owned(),
                },
            ),
            ProjectionImpact::Resources { .. } => unreachable!(),
        };
    };

    let mut page_ids = page_ids.clone();
    page_ids.sort();
    page_ids.dedup();
    for page_id in &page_ids {
        local_commit::record_projection_patch(
            connection,
            commit,
            LocalProjectionPatch::PageChanged {
                project_id: project_id.to_owned(),
                page_id: page_id.clone(),
            },
        )?;
        local_commit::require_projection_read(
            connection,
            commit,
            LocalProjectionScope::Page {
                project_id: project_id.to_owned(),
                page_id: page_id.clone(),
            },
        )?;
    }

    let mut view_ids = view_ids.clone();
    view_ids.sort();
    view_ids.dedup();
    for view_id in &view_ids {
        record_view_delta(
            connection, commit, library_id, project_id, view_id, &page_ids,
        )?;
    }

    if view_ids.is_empty() && (!database_ids.is_empty() || !data_source_ids.is_empty()) {
        local_commit::require_projection_read(
            connection,
            commit,
            LocalProjectionScope::Project {
                project_id: project_id.to_owned(),
            },
        )?;
    }
    Ok(())
}

fn record_view_delta(
    connection: &Connection,
    commit: &CommitContext,
    library_id: &str,
    project_id: &str,
    view_id: &str,
    page_ids: &[String],
) -> Result<(), StoreError> {
    let groups = match view_groups(
        connection,
        library_id,
        view_id,
        ViewGroupsRead {
            commit_head: commit.commit_seq(),
            project_id: Some(project_id),
            store_epoch: commit.store_epoch(),
        },
    ) {
        Ok(groups) => groups,
        Err(error) if error.code == StoreErrorCode::NotFound => {
            return local_commit::require_projection_read(
                connection,
                commit,
                LocalProjectionScope::Project {
                    project_id: project_id.to_owned(),
                },
            );
        }
        Err(error) => return Err(error),
    };
    let scope = LocalProjectionScope::DatabaseView {
        project_id: project_id.to_owned(),
        database_id: groups.database_id.clone(),
        data_source_id: groups.data_source_id.clone(),
        view_id: view_id.to_owned(),
    };
    if page_ids.is_empty() {
        return local_commit::require_projection_read(connection, commit, scope);
    }

    let mut rows_by_page = BTreeMap::new();
    for page_ids in page_ids.chunks(MAX_ROWS_BY_ID) {
        let rows = rows_by_id(connection, library_id, view_id, page_ids)?;
        rows_by_page.extend(rows.rows.into_iter().map(|row| (row.page_id.clone(), row)));
    }

    for page_id in page_ids {
        let Some(row) = rows_by_page.get(page_id) else {
            local_commit::record_projection_patch(
                connection,
                commit,
                LocalProjectionPatch::DatabaseRowRemove {
                    project_id: project_id.to_owned(),
                    database_id: groups.database_id.clone(),
                    data_source_id: groups.data_source_id.clone(),
                    view_id: view_id.to_owned(),
                    page_id: page_id.clone(),
                    total_rows: groups.total_rows,
                    group_key: None,
                    group_total: None,
                },
            )?;
            continue;
        };
        let group_total = groups
            .groups
            .iter()
            .find(|group| group.group_key == row.effective_group_key)
            .map(|group| group.total_rows);
        local_commit::record_projection_patch(
            connection,
            commit,
            LocalProjectionPatch::DatabaseRowUpsert {
                project_id: project_id.to_owned(),
                database_id: groups.database_id.clone(),
                data_source_id: groups.data_source_id.clone(),
                view_id: view_id.to_owned(),
                row: Box::new(row.clone()),
                total_rows: groups.total_rows,
                group_total,
            },
        )?;
    }

    // A row patch is the immediate visible result. The canonical read remains
    // an explicit background repair for renderer-specific pagination windows,
    // totals, and any former-group evidence that a post-state patch cannot
    // encode globally.
    local_commit::require_projection_read(connection, commit, scope)?;

    Ok(())
}
