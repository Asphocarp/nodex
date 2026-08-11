use nodex_core_contracts::database::{
    DatabaseRead, DatabaseReadValue, DatabaseRelationTargetItem, DatabaseTarget,
};
use nodex_core_contracts::events::{AuthorizedReadStamp, ResourceKey};
use nodex_core_contracts::{BoundModuleContext, StoreEpoch};
use rusqlite::Connection;

use crate::infrastructure::resource_authorization;
use crate::infrastructure::sqlite::StoreError;

pub(super) fn issue(
    connection: &Connection,
    context: &BoundModuleContext,
    store_epoch: &str,
    commit_head: i64,
    read: &DatabaseRead,
    value: &DatabaseReadValue,
) -> Result<Option<AuthorizedReadStamp>, StoreError> {
    if matches!(
        value,
        DatabaseReadValue::RowDetail { value } if value.summary.lifecycle != "active"
    ) {
        return Ok(None);
    }
    if matches!(
        value,
        DatabaseReadValue::Database { value }
            | DatabaseReadValue::DataSource { value }
            | DatabaseReadValue::View { value }
            if value.get("lifecycle").and_then(serde_json::Value::as_str) != Some("active")
    ) {
        return Ok(None);
    }
    let Some(subject) = read_subject(context, &read.target) else {
        return Ok(None);
    };
    let mut authorization_dependencies = vec![subject.clone()];
    append_value_dependencies(value, &mut authorization_dependencies);
    resource_authorization::issue_read_stamp(
        connection,
        context,
        StoreEpoch(store_epoch.to_owned()),
        commit_head,
        subject.clone(),
        vec![subject],
        authorization_dependencies,
    )
    .map(Some)
}

fn read_subject(context: &BoundModuleContext, target: &DatabaseTarget) -> Option<ResourceKey> {
    match target {
        DatabaseTarget::ProjectDefault => Some(match &context.project_id {
            Some(project_id) => ResourceKey::Project {
                project_id: project_id.0.clone(),
            },
            None => ResourceKey::Library {
                library_id: context.library_id.0.clone(),
            },
        }),
        DatabaseTarget::Database { database_id } => Some(ResourceKey::Database {
            database_id: database_id.clone(),
        }),
        DatabaseTarget::DataSource { data_source_id }
        | DatabaseTarget::Property { data_source_id, .. } => Some(ResourceKey::DataSource {
            data_source_id: data_source_id.clone(),
        }),
        DatabaseTarget::View { view_id } | DatabaseTarget::PresentedView { view_id, .. } => {
            Some(ResourceKey::View {
                view_id: view_id.clone(),
            })
        }
        DatabaseTarget::Page { page_id } | DatabaseTarget::PageProperty { page_id, .. } => {
            Some(ResourceKey::Page {
                page_id: page_id.clone(),
            })
        }
        DatabaseTarget::AgentDataSource { .. } | DatabaseTarget::AgentView { .. } => None,
    }
}

fn append_value_dependencies(value: &DatabaseReadValue, output: &mut Vec<ResourceKey>) {
    match value {
        DatabaseReadValue::ViewWindow { value } | DatabaseReadValue::AgentQuery { value } => {
            append_view_coordinates(
                &value.database_id,
                &value.data_source_id,
                &value.view_id,
                output,
            );
            append_rows(
                value
                    .rows
                    .items
                    .iter()
                    .filter(|row| row.lifecycle == "active")
                    .map(|row| row.page_id.as_str()),
                output,
            );
        }
        DatabaseReadValue::ListWindow { value } => {
            append_view_coordinates(
                &value.database_id,
                &value.data_source_id,
                &value.view_id,
                output,
            );
            append_rows(
                value.rows.items.iter().filter_map(|row| match row {
                    nodex_core_contracts::database::DatabaseListProjectionRow::Page {
                        summary,
                        ..
                    } if summary.lifecycle == "active" => Some(summary.page_id.as_str()),
                    _ => None,
                }),
                output,
            );
        }
        DatabaseReadValue::ViewGroups { value } => append_view_coordinates(
            &value.database_id,
            &value.data_source_id,
            &value.view_id,
            output,
        ),
        DatabaseReadValue::ViewContext { value } => {
            append_view_coordinates(
                &value.groups.database_id,
                &value.groups.data_source_id,
                &value.groups.view_id,
                output,
            );
            append_rows(
                value
                    .rows
                    .items
                    .iter()
                    .filter(|row| row.summary.lifecycle == "active")
                    .map(|row| row.summary.page_id.as_str()),
                output,
            );
        }
        DatabaseReadValue::RowsById { value } => {
            append_rows(
                value
                    .rows
                    .iter()
                    .filter(|row| row.lifecycle == "active")
                    .map(|row| row.page_id.as_str()),
                output,
            );
        }
        DatabaseReadValue::RowDetail { value } => output.push(ResourceKey::Page {
            page_id: value.summary.page_id.clone(),
        }),
        DatabaseReadValue::RelationCandidateWindow { candidates } => {
            append_rows(
                candidates.items.iter().map(|row| row.page_id.as_str()),
                output,
            );
        }
        DatabaseReadValue::RelationTargetWindow { value } => {
            append_rows(
                value
                    .targets
                    .items
                    .iter()
                    .filter_map(|target| match target {
                        DatabaseRelationTargetItem::Visible { page_id, .. } => {
                            Some(page_id.as_str())
                        }
                        DatabaseRelationTargetItem::Restricted { .. } => None,
                    }),
                output,
            );
        }
        _ => {}
    }
}

fn append_view_coordinates(
    database_id: &str,
    data_source_id: &str,
    view_id: &str,
    output: &mut Vec<ResourceKey>,
) {
    output.push(ResourceKey::Database {
        database_id: database_id.to_owned(),
    });
    output.push(ResourceKey::DataSource {
        data_source_id: data_source_id.to_owned(),
    });
    output.push(ResourceKey::View {
        view_id: view_id.to_owned(),
    });
}

fn append_rows<'a>(rows: impl IntoIterator<Item = &'a str>, output: &mut Vec<ResourceKey>) {
    output.extend(rows.into_iter().map(|page_id| ResourceKey::Page {
        page_id: page_id.to_owned(),
    }));
}
