use nodex_core_contracts::administration::{
    StoreAdministrationEvent, StoreAdministrationEventKind,
};
use nodex_core_contracts::automation::{AutomationEvent, AutomationEventKind};
use nodex_core_contracts::database::{DatabaseEvent, DatabaseEventKind};
use nodex_core_contracts::library::{LibraryEvent, LibraryEventKind};
use nodex_core_contracts::workspace::{ProjectWorkspaceEvent, ProjectWorkspaceEventKind};
use nodex_core_contracts::{
    CORE_CONTRACT_VERSION, CommittedCoreModuleEvent, CoreModuleEventPayload, StoreEpoch,
};
use rusqlite::{Connection, params};
use serde::Deserialize;

use crate::document::event_log::{
    ChangeLogRow, reconstruct_document_event, validate_change_log_row,
};

use super::sqlite::{StoreError, StoreErrorCode};
use super::writer::StoreReaders;

const DEFAULT_REPLAY_LIMIT: u32 = 256;
const MAX_REPLAY_LIMIT: u32 = 1_024;
const MAX_EVENT_PAYLOAD_BYTES: usize = 1024 * 1024;
const MAX_EVENT_IDENTITIES: usize = 10_000;
const MODULE_KINDS: &str = "'library.changed', 'database.changed', 'owned_document.document_initialized', \
    'owned_document.document_updated', 'owned_document.canvas_scene_updated', \
    'owned_document.document_restored', 'owned_document.document_invalidated', \
    'project_workspace.changed', 'automation.changed', 'store_administration.changed'";

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CoreEventReplay {
    Events {
        events: Vec<CommittedCoreModuleEvent>,
        event_head: i64,
    },
    ResyncRequired {
        requested_after: i64,
        oldest_available: i64,
        event_head: i64,
    },
}

#[derive(Clone)]
pub struct CoreEventLog {
    readers: StoreReaders,
}

impl CoreEventLog {
    pub fn new(readers: StoreReaders) -> Self {
        Self { readers }
    }

    pub fn head(&self) -> Result<i64, StoreError> {
        self.readers.read_default(event_head)
    }

    pub fn replay(&self, after: i64, limit: Option<u32>) -> Result<CoreEventReplay, StoreError> {
        self.readers.read_default(move |connection| {
            let transaction = connection.unchecked_transaction()?;
            let replay = replay_core_events(&transaction, after, limit)?;
            transaction.commit()?;
            Ok(replay)
        })
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LibraryMetadata {
    module: String,
    affected_page_ids: Vec<String>,
    affected_database_ids: Vec<String>,
    affected_parent_keys: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DatabaseMetadata {
    module: String,
    kind: String,
    #[serde(default)]
    project_id: Option<String>,
    database_ids: Vec<String>,
    data_source_ids: Vec<String>,
    page_ids: Vec<String>,
    view_ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceMetadata {
    module: String,
    kind: String,
    project_catalog_changed: bool,
    project_ids: Vec<String>,
    session_ids: Vec<String>,
    thread_ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AutomationMetadata {
    module: String,
    kind: String,
    automation_ids: Vec<String>,
    lease_ids: Vec<String>,
    run_ids: Vec<String>,
    reminder_lease_ids: Vec<String>,
    snooze_ids: Vec<i64>,
    page_ids: Vec<String>,
    document_ids: Vec<String>,
    database_ids: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AdministrationMetadata {
    module: String,
    operation_kind: String,
    kind: String,
    backup_ids: Vec<String>,
    readiness_changed: bool,
}

fn replay_core_events(
    connection: &Connection,
    after: i64,
    limit: Option<u32>,
) -> Result<CoreEventReplay, StoreError> {
    if after < 0 {
        return Err(invalid("Core event replay boundary is invalid"));
    }
    let limit = limit
        .unwrap_or(DEFAULT_REPLAY_LIMIT)
        .clamp(1, MAX_REPLAY_LIMIT);
    let (oldest_change, event_head) = connection.query_row(
        "SELECT COALESCE(min(seq), 0), COALESCE(max(seq), 0) FROM change_log",
        [],
        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
    )?;
    if oldest_change < 0 || event_head < oldest_change {
        return Err(corrupt("Change log retention boundary is invalid"));
    }
    if oldest_change > 1 && after < oldest_change - 1 {
        return Ok(CoreEventReplay::ResyncRequired {
            requested_after: after,
            oldest_available: oldest_change,
            event_head,
        });
    }

    let sql = format!(
        "SELECT seq, project_id, store_epoch, kind, operation_id, payload_json, committed_at \
         FROM change_log WHERE seq > ?1 AND kind IN ({MODULE_KINDS}) \
         ORDER BY seq ASC LIMIT ?2"
    );
    let rows = connection
        .prepare(&sql)?
        .query_map(params![after, i64::from(limit) + 1], |row| {
            Ok(ChangeLogRow {
                sequence: row.get(0)?,
                project_id: row.get(1)?,
                store_epoch: row.get(2)?,
                kind: row.get(3)?,
                operation_id: row.get(4)?,
                payload_json: row.get(5)?,
                committed_at: row.get(6)?,
            })
        })?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|_| corrupt("Change log event row has invalid column types"))?;
    if rows.len() > usize::try_from(limit).expect("bounded replay limit") {
        return Ok(CoreEventReplay::ResyncRequired {
            requested_after: after,
            oldest_available: rows.first().map_or(event_head, |row| row.sequence),
            event_head,
        });
    }

    let mut previous = after;
    let mut events = Vec::with_capacity(rows.len());
    for row in rows {
        validate_change_log_row(&row, previous, event_head)?;
        previous = row.sequence;
        let Some(event) = reconstruct_event(connection, &row)? else {
            return Ok(CoreEventReplay::ResyncRequired {
                requested_after: after,
                oldest_available: row.sequence,
                event_head,
            });
        };
        events.push(event);
    }
    Ok(CoreEventReplay::Events { events, event_head })
}

fn reconstruct_event(
    connection: &Connection,
    row: &ChangeLogRow,
) -> Result<Option<CommittedCoreModuleEvent>, StoreError> {
    if row.kind.starts_with("owned_document.") {
        return reconstruct_document_event(connection, row);
    }
    if row.payload_json.len() > MAX_EVENT_PAYLOAD_BYTES {
        return Err(corrupt("Core event payload exceeds its bound"));
    }
    let payload = match row.kind.as_str() {
        "library.changed" => {
            let metadata = decode::<LibraryMetadata>(row, "Library")?;
            require_module(&metadata.module, "library")?;
            validate_strings(&metadata.affected_page_ids, "Library Page")?;
            validate_strings(&metadata.affected_database_ids, "Library Database")?;
            validate_strings(&metadata.affected_parent_keys, "Library parent")?;
            CoreModuleEventPayload::Library(LibraryEvent {
                kind: LibraryEventKind::LibraryChanged,
                page_ids: metadata.affected_page_ids,
                database_ids: metadata.affected_database_ids,
                parent_keys: metadata.affected_parent_keys,
            })
        }
        "database.changed" => {
            let metadata = decode::<DatabaseMetadata>(row, "Database")?;
            require_module_kind(
                &metadata.module,
                "database",
                &metadata.kind,
                "database_changed",
            )?;
            validate_strings(&metadata.database_ids, "Database")?;
            validate_strings(&metadata.data_source_ids, "Data Source")?;
            validate_strings(&metadata.page_ids, "Database Page")?;
            validate_strings(&metadata.view_ids, "Database View")?;
            if let Some(project_id) = metadata.project_id.as_deref() {
                validate_identity(project_id, "Database Project")?;
                if project_id != row.project_id {
                    return Err(corrupt(
                        "Database event Project and ledger authority diverge",
                    ));
                }
            }
            CoreModuleEventPayload::Database(DatabaseEvent {
                kind: DatabaseEventKind::DatabaseChanged,
                project_id: metadata.project_id,
                database_ids: metadata.database_ids,
                data_source_ids: metadata.data_source_ids,
                page_ids: metadata.page_ids,
                view_ids: metadata.view_ids,
            })
        }
        "project_workspace.changed" => {
            let metadata = decode::<WorkspaceMetadata>(row, "Project Workspace")?;
            require_module_kind(
                &metadata.module,
                "project_workspace",
                &metadata.kind,
                "workspace_changed",
            )?;
            validate_strings(&metadata.project_ids, "Project Workspace Project")?;
            validate_strings(&metadata.session_ids, "Project Workspace Session")?;
            validate_strings(&metadata.thread_ids, "Project Workspace Thread")?;
            CoreModuleEventPayload::ProjectWorkspace(ProjectWorkspaceEvent {
                kind: ProjectWorkspaceEventKind::WorkspaceChanged,
                project_catalog_changed: metadata.project_catalog_changed,
                project_ids: metadata.project_ids,
                session_ids: metadata.session_ids,
                thread_ids: metadata.thread_ids,
            })
        }
        "automation.changed" => {
            let metadata = decode::<AutomationMetadata>(row, "Automation")?;
            require_module_kind(
                &metadata.module,
                "automation",
                &metadata.kind,
                "automation_changed",
            )?;
            validate_strings(&metadata.automation_ids, "Automation")?;
            validate_strings(&metadata.lease_ids, "Automation lease")?;
            validate_strings(&metadata.run_ids, "Automation run")?;
            validate_strings(&metadata.reminder_lease_ids, "Reminder lease")?;
            validate_strings(&metadata.page_ids, "Automation Page")?;
            validate_strings(&metadata.document_ids, "Automation Document")?;
            validate_strings(&metadata.database_ids, "Automation Database")?;
            if metadata.snooze_ids.len() > MAX_EVENT_IDENTITIES
                || metadata.snooze_ids.iter().any(|id| *id < 1)
            {
                return Err(corrupt("Automation snooze event identities are invalid"));
            }
            CoreModuleEventPayload::Automation(AutomationEvent {
                kind: AutomationEventKind::AutomationChanged,
                automation_ids: metadata.automation_ids,
                lease_ids: metadata.lease_ids,
                run_ids: metadata.run_ids,
                reminder_lease_ids: metadata.reminder_lease_ids,
                snooze_ids: metadata.snooze_ids,
                page_ids: metadata.page_ids,
                document_ids: metadata.document_ids,
                database_ids: metadata.database_ids,
            })
        }
        "store_administration.changed" => {
            let metadata = decode::<AdministrationMetadata>(row, "Store Administration")?;
            require_module_kind(
                &metadata.module,
                "store_administration",
                &metadata.kind,
                "store_administration_changed",
            )?;
            validate_identity(&metadata.operation_kind, "Store Administration operation")?;
            validate_strings(&metadata.backup_ids, "Store Administration backup")?;
            CoreModuleEventPayload::StoreAdministration(StoreAdministrationEvent {
                kind: StoreAdministrationEventKind::StoreAdministrationChanged,
                operation: metadata.operation_kind,
                backup_ids: metadata.backup_ids,
                readiness_changed: metadata.readiness_changed,
            })
        }
        _ => return Err(corrupt("Core event kind is unsupported")),
    };
    Ok(Some(CommittedCoreModuleEvent {
        version: CORE_CONTRACT_VERSION,
        sequence: row.sequence,
        store_epoch: StoreEpoch(row.store_epoch.clone()),
        operation_id: row.operation_id.clone(),
        committed_at: row.committed_at.clone(),
        payload,
    }))
}

fn event_head(connection: &Connection) -> Result<i64, StoreError> {
    let head = connection.query_row("SELECT COALESCE(max(seq), 0) FROM change_log", [], |row| {
        row.get::<_, i64>(0)
    })?;
    if head < 0 {
        return Err(corrupt("Core event head is invalid"));
    }
    Ok(head)
}

fn decode<T: for<'de> Deserialize<'de>>(row: &ChangeLogRow, label: &str) -> Result<T, StoreError> {
    serde_json::from_str(&row.payload_json)
        .map_err(|_| corrupt(&format!("{label} event payload is invalid")))
}

fn require_module(actual: &str, expected: &str) -> Result<(), StoreError> {
    if actual == expected {
        return Ok(());
    }
    Err(corrupt("Core event Module identity is inconsistent"))
}

fn require_module_kind(
    actual_module: &str,
    expected_module: &str,
    actual_kind: &str,
    expected_kind: &str,
) -> Result<(), StoreError> {
    require_module(actual_module, expected_module)?;
    if actual_kind == expected_kind {
        return Ok(());
    }
    Err(corrupt("Core event kind metadata is inconsistent"))
}

fn validate_strings(values: &[String], label: &str) -> Result<(), StoreError> {
    if values.len() > MAX_EVENT_IDENTITIES {
        return Err(corrupt(&format!("{label} event list exceeds its bound")));
    }
    for value in values {
        validate_identity(value, label)?;
    }
    Ok(())
}

fn validate_identity(value: &str, label: &str) -> Result<(), StoreError> {
    if !value.is_empty() && value.len() <= 512 && value.trim() == value {
        return Ok(());
    }
    Err(corrupt(&format!("{label} event identity is invalid")))
}

fn invalid(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::InvalidInput, message, false)
}

fn corrupt(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message, false)
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;
    use crate::infrastructure::store::SqliteStoreKernel;

    #[test]
    fn replays_typed_module_events_from_durable_change_log() {
        let directory = tempdir().expect("temporary Profile");
        let kernel = SqliteStoreKernel::open(directory.path()).expect("Core store");
        kernel
            .writer()
            .call(|connection| {
                connection.execute(
                    "INSERT INTO projects(id, name, created, updated) \
                     VALUES ('project:events', 'Events', '2026-01-01', '2026-01-01')",
                    [],
                )?;
                for (kind, operation_id, payload) in [
                    (
                        "library.changed",
                        "library:event",
                        serde_json::json!({
                            "module": "library",
                            "affectedPageIds": ["page:one"],
                            "affectedDatabaseIds": [],
                            "affectedParentKeys": ["library:root"]
                        }),
                    ),
                    (
                        "database.changed",
                        "database:event",
                        serde_json::json!({
                            "module": "database",
                            "kind": "database_changed",
                            "databaseIds": ["database:one"],
                            "dataSourceIds": ["source:one"],
                            "pageIds": [],
                            "viewIds": ["view:one"]
                        }),
                    ),
                ] {
                    connection.execute(
                        "INSERT INTO change_log(\
                           project_id, store_epoch, kind, operation_id, payload_json, committed_at\
                         ) VALUES ('project:events', 'epoch:events', ?1, ?2, ?3, '2026-01-01')",
                        params![kind, operation_id, payload.to_string()],
                    )?;
                }
                Ok(())
            })
            .expect("event fixtures");
        let event_log = CoreEventLog::new(kernel.readers());

        let CoreEventReplay::Events { events, event_head } =
            event_log.replay(0, None).expect("durable replay")
        else {
            panic!("expected replayed events");
        };
        assert_eq!(event_head, 2);
        assert_eq!(events.len(), 2);
        assert!(matches!(
            events[0].payload,
            CoreModuleEventPayload::Library(_)
        ));
        assert!(matches!(
            events[1].payload,
            CoreModuleEventPayload::Database(_)
        ));
    }

    #[test]
    fn bounded_replay_requires_resync_instead_of_returning_a_partial_prefix() {
        let directory = tempdir().expect("temporary Profile");
        let kernel = SqliteStoreKernel::open(directory.path()).expect("Core store");
        kernel
            .writer()
            .call(|connection| {
                connection.execute(
                    "INSERT INTO projects(id, name, created, updated) \
                     VALUES ('project:events', 'Events', '2026-01-01', '2026-01-01')",
                    [],
                )?;
                for index in 0..3 {
                    connection.execute(
                        "INSERT INTO change_log(\
                           project_id, store_epoch, kind, operation_id, payload_json, committed_at\
                         ) VALUES ('project:events', 'epoch:events', 'library.changed', ?1, ?2, '2026-01-01')",
                        params![
                            format!("library:event:{index}"),
                            serde_json::json!({
                                "module": "library",
                                "affectedPageIds": [format!("page:{index}")],
                                "affectedDatabaseIds": [],
                                "affectedParentKeys": ["library:root"]
                            })
                            .to_string()
                        ],
                    )?;
                }
                Ok(())
            })
            .expect("event fixtures");
        let event_log = CoreEventLog::new(kernel.readers());

        assert!(matches!(
            event_log.replay(0, Some(2)).expect("bounded replay"),
            CoreEventReplay::ResyncRequired { event_head: 3, .. }
        ));
    }
}
