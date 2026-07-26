use nodex_core_contracts::collection::{
    CollectionWindow, CollectionWindowAuthority, CollectionWindowRequest,
};
use nodex_core_contracts::workspace::ProjectWorkspaceProject;
use rusqlite::types::Value as SqlValue;
use rusqlite::{Connection, params_from_iter};

use crate::infrastructure::collection_window::{WindowCandidate, assemble, normalize_request};
use crate::infrastructure::cursor::{
    self, CollectionCursorSubject, CursorDirection, KeysetCoordinate, KeysetValue,
};
use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};

use super::read::{project, project_row};

pub(super) fn read_project_window(
    connection: &Connection,
    library_id: &str,
    event_head: i64,
    include_archived: bool,
    request: &CollectionWindowRequest,
) -> Result<CollectionWindow<ProjectWorkspaceProject>, StoreError> {
    let normalized = normalize_request(request)?;
    let fingerprint =
        cursor::query_fingerprint(&("workspace_project_window_v1", include_archived))?;
    let subject = CollectionCursorSubject {
        kind: "workspace_projects",
        library_id,
        query_fingerprint: &fingerprint,
    };
    let coordinate = normalized
        .after
        .map(|encoded| cursor::decode(connection, encoded, subject))
        .transpose()?
        .map(|(direction, coordinate)| {
            if direction != CursorDirection::Forward || coordinate.values.len() != 2 {
                return Err(invalid("Workspace Project cursor is incompatible"));
            }
            let [
                KeysetValue::Integer { value: order_key },
                KeysetValue::Text { value: created_at },
            ] = coordinate.values.as_slice()
            else {
                return Err(invalid("Workspace Project cursor coordinate is invalid"));
            };
            Ok((*order_key, created_at.clone(), coordinate.stable_id))
        })
        .transpose()?;

    let mut parameters = vec![
        SqlValue::Text(library_id.to_owned()),
        SqlValue::Integer(i64::from(include_archived)),
    ];
    let cursor_predicate = coordinate
        .map(|(order_key, created_at, stable_id)| {
            parameters.extend([
                SqlValue::Integer(order_key),
                SqlValue::Text(created_at),
                SqlValue::Text(stable_id),
            ]);
            "AND (COALESCE(ordering.\"order\", 9223372036854775807) > ?3 \
               OR (COALESCE(ordering.\"order\", 9223372036854775807) = ?3 \
                 AND project.created > ?4) \
               OR (COALESCE(ordering.\"order\", 9223372036854775807) = ?3 \
                 AND project.created = ?4 AND project.id > ?5))"
        })
        .unwrap_or_default();
    parameters.push(SqlValue::Integer(
        i64::try_from(normalized.first + 1)
            .map_err(|_| invalid("Workspace Project window size is invalid"))?,
    ));
    let limit_parameter = parameters.len();
    let sql = format!(
        "SELECT project.id, project.library_id, project.database_block_id, \
           project.lifecycle, project.binding_revision, project.name, project.description, \
           project.icon, pinned.\"order\", project.created, project.updated, \
           default_view.id, \
           COALESCE(ordering.\"order\", 9223372036854775807) AS order_key \
         FROM projects project \
         LEFT JOIN project_order ordering ON ordering.project_id = project.id \
         LEFT JOIN pinned_project_order pinned ON pinned.project_id = project.id \
         LEFT JOIN database_containers container \
           ON container.block_id = project.database_block_id \
         LEFT JOIN database_views default_view \
           ON default_view.id = container.default_view_id \
          AND default_view.lifecycle = 'active' \
         WHERE project.library_id = ?1 AND (?2 = 1 OR project.lifecycle <> 'archived') \
           {cursor_predicate} \
         ORDER BY order_key, project.created, project.id LIMIT ?{limit_parameter}"
    );
    let rows = connection
        .prepare(&sql)?
        .query_map(params_from_iter(parameters.iter()), |row| {
            Ok((project_row(row)?, row.get::<_, i64>(12)?))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let candidates = rows
        .into_iter()
        .map(|(row, order_key)| {
            let created_at = row.created_at.clone();
            let item = project(connection, row)?;
            Ok(WindowCandidate {
                coordinate: KeysetCoordinate {
                    values: vec![
                        KeysetValue::Integer { value: order_key },
                        KeysetValue::Text { value: created_at },
                    ],
                    stable_id: item.id.clone(),
                },
                item,
            })
        })
        .collect::<Result<Vec<_>, StoreError>>()?;
    assemble(
        candidates,
        normalized.first,
        CollectionWindowAuthority {
            projection_revision: event_head,
        },
        |coordinate| {
            cursor::mint(
                connection,
                subject,
                CursorDirection::Forward,
                coordinate.clone(),
            )
        },
    )
}

fn invalid(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::InvalidInput, message, false)
}

#[cfg(test)]
mod tests {
    use nodex_core_contracts::collection::CollectionWindowRequest;
    use nodex_core_contracts::workspace::{ProjectWorkspaceRead, ProjectWorkspaceReadValue};

    use crate::workspace::test_support::{create_project, read, seeded_workspace};

    #[test]
    fn project_window_seeks_without_repeating_rows() {
        let workspace = seeded_workspace();
        for index in 0..5 {
            create_project(
                &workspace.module,
                &format!("create-project-{index}"),
                &format!("project:{index}"),
            );
        }
        let read_window = |after| {
            let ProjectWorkspaceReadValue::ProjectWindow { projects } = read(
                &workspace.module,
                ProjectWorkspaceRead::ProjectWindow {
                    include_archived: Some(false),
                    window: CollectionWindowRequest {
                        after,
                        first: Some(3),
                    },
                },
            ) else {
                panic!("Project window");
            };
            projects
        };
        let first = read_window(None);
        let second = read_window(first.next_cursor.clone());
        assert_eq!(first.items.len(), 3);
        assert!(
            first
                .items
                .iter()
                .all(|project| project.default_database_view_id.is_some())
        );
        assert!(first.next_cursor.is_some());
        assert!(
            first
                .items
                .iter()
                .all(|left| { second.items.iter().all(|right| left.id != right.id) })
        );
    }
}
