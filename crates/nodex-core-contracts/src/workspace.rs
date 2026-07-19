use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;
use utoipa::ToSchema;

use crate::{ModuleMutationReceipt, ModuleName, VersionedModuleContract};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ProjectWorkspaceRead {
    Startup,
    Project {
        project_id: String,
    },
    Sessions {
        project_id: Option<String>,
        include_archived: Option<bool>,
    },
    Session {
        session_id: String,
    },
    Thread {
        thread_id: String,
    },
    ManagedWorktrees {
        project_id: String,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ProjectWorkspaceReadValue {
    Startup {
        projects: Vec<ProjectWorkspaceProject>,
        sessions: Vec<ProjectWorkspaceSessionSummary>,
    },
    Project {
        project: ProjectWorkspaceProject,
    },
    Sessions {
        sessions: Vec<ProjectWorkspaceSessionSummary>,
    },
    Session {
        session: ProjectWorkspaceSessionSummary,
        panels: Value,
        tabs: Vec<ProjectWorkspaceSessionTab>,
    },
    Thread {
        thread_id: String,
        session_id: Option<String>,
        project_id: Option<String>,
    },
    ManagedWorktrees {
        roots: Vec<String>,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct ProjectWorkspaceProject {
    pub id: String,
    pub library_id: String,
    pub database_id: String,
    pub lifecycle: ProjectLifecycle,
    pub binding_revision: i64,
    pub name: String,
    pub description: String,
    pub icon: Option<String>,
    pub sources: Vec<ProjectSource>,
    pub primary_workspace_root: Option<String>,
    pub pinned: bool,
    pub pinned_order: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct ProjectSource {
    pub root: String,
    pub order: i64,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ProjectLifecycle {
    Active,
    Inactive,
    Archived,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct ProjectWorkspaceSessionSummary {
    pub id: String,
    pub project_id: Option<String>,
    pub no_thread_fallback_title: String,
    pub display_title: String,
    pub order: i64,
    pub pinned: bool,
    pub pinned_order: Option<i64>,
    pub archived: bool,
    pub archived_at: Option<String>,
    pub unread: bool,
    pub left_pane_collapsed: bool,
    pub thread_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ProjectSessionPanelId {
    Right,
    Bottom,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ProjectSessionTabKind {
    DbView,
    PageStage,
    Terminal,
    Browser,
    Review,
    Files,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, ToSchema)]
pub struct ProjectSessionPanelSizePatch {
    #[serde(
        default,
        deserialize_with = "deserialize_present",
        skip_serializing_if = "Option::is_none"
    )]
    pub width_px: Option<f64>,
    #[serde(
        default,
        deserialize_with = "deserialize_present",
        skip_serializing_if = "Option::is_none"
    )]
    pub height_px: Option<f64>,
    #[serde(
        default,
        deserialize_with = "deserialize_present",
        skip_serializing_if = "Option::is_none"
    )]
    pub full_width: Option<bool>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize, ToSchema)]
pub struct ProjectSessionPanelStatePatch {
    #[serde(
        default,
        deserialize_with = "deserialize_present",
        skip_serializing_if = "Option::is_none"
    )]
    pub collapsed: Option<bool>,
    #[serde(
        default,
        deserialize_with = "deserialize_present",
        skip_serializing_if = "Option::is_none"
    )]
    pub size: Option<ProjectSessionPanelSizePatch>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, ToSchema)]
pub struct ProjectWorkspaceSessionTab {
    pub id: String,
    pub session_id: String,
    pub project_id: Option<String>,
    pub browser_tab_id: Option<String>,
    pub panel_id: ProjectSessionPanelId,
    pub kind: ProjectSessionTabKind,
    pub title: String,
    pub order: i64,
    pub config: Value,
    pub state_key: i64,
    pub state: Value,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ProjectWorkspaceIntent {
    CreateProject {
        project_id: String,
        name: String,
        description: String,
        icon: Option<String>,
        source_roots: Vec<String>,
    },
    UpdateProject {
        project_id: String,
        expected_binding_revision: i64,
        name: Option<String>,
        description: Option<String>,
        icon: Option<String>,
        source_roots: Option<Vec<String>>,
    },
    SetProjectLifecycle {
        project_id: String,
        lifecycle: ProjectLifecycle,
    },
    ReorderProjects {
        project_ids: Vec<String>,
    },
    SetProjectPinned {
        project_id: String,
        pinned: bool,
    },
    CreateSession {
        session_id: String,
        project_id: Option<String>,
        title: String,
    },
    DeleteSession {
        session_id: String,
    },
    MoveSession {
        session_id: String,
        project_id: Option<String>,
    },
    ReorderSessions {
        project_id: Option<String>,
        session_ids: Vec<String>,
    },
    ReorderPinnedSessions {
        project_id: Option<String>,
        session_ids: Vec<String>,
    },
    MutateSession {
        session_id: String,
        intent: ProjectSessionIntent,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ProjectSessionIntent {
    Rename {
        title: String,
    },
    SetPinned {
        pinned: bool,
    },
    SetUnread {
        unread: bool,
    },
    SetArchived {
        archived: bool,
    },
    PatchViewState {
        #[serde(
            default,
            deserialize_with = "deserialize_present",
            skip_serializing_if = "Option::is_none"
        )]
        left_pane_collapsed: Option<bool>,
        #[serde(
            default,
            deserialize_with = "deserialize_present",
            skip_serializing_if = "Option::is_none"
        )]
        right_panel: Option<ProjectSessionPanelStatePatch>,
        #[serde(
            default,
            deserialize_with = "deserialize_present",
            skip_serializing_if = "Option::is_none"
        )]
        bottom_panel: Option<ProjectSessionPanelStatePatch>,
    },
    ReplacePanelLayout {
        panel_id: ProjectSessionPanelId,
        layout: Value,
    },
    CreateTab {
        tab_id: String,
        panel_id: ProjectSessionPanelId,
        target_leaf_id: Option<String>,
        browser_tab_id: Option<String>,
        tab_kind: ProjectSessionTabKind,
        title: String,
        config: Value,
    },
    DeleteTab {
        tab_id: String,
    },
    MoveTab {
        tab_id: String,
        panel_id: ProjectSessionPanelId,
        target_leaf_id: Option<String>,
        before_tab_id: Option<String>,
    },
    UpdateTab {
        tab_id: String,
        #[serde(
            default,
            deserialize_with = "deserialize_present",
            skip_serializing_if = "Option::is_none"
        )]
        title: Option<String>,
        #[serde(
            default,
            deserialize_with = "deserialize_present",
            skip_serializing_if = "Option::is_none"
        )]
        config: Option<Value>,
    },
    ReplaceTabState {
        tab_id: String,
        state_key: i64,
        state: Value,
    },
    LinkThread {
        thread_id: String,
        expected_project_id: Option<String>,
    },
    UnlinkThread {
        thread_id: String,
    },
}

fn deserialize_present<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct ProjectWorkspaceCommitValue {
    pub affected_project_ids: Vec<String>,
    pub affected_session_ids: Vec<String>,
    pub affected_thread_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct ProjectWorkspaceReceipt {
    #[serde(flatten)]
    pub mutation: ModuleMutationReceipt,
    pub affected_project_ids: Vec<String>,
    pub affected_session_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct ProjectWorkspaceEvent {
    pub kind: ProjectWorkspaceEventKind,
    pub project_ids: Vec<String>,
    pub session_ids: Vec<String>,
    pub thread_ids: Vec<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ProjectWorkspaceEventKind {
    WorkspaceChanged,
}

pub struct ProjectWorkspaceContract;

impl VersionedModuleContract for ProjectWorkspaceContract {
    type Read = ProjectWorkspaceRead;
    type Snapshot = ProjectWorkspaceReadValue;
    type Intent = ProjectWorkspaceIntent;
    type Receipt = ProjectWorkspaceReceipt;
    type Event = ProjectWorkspaceEvent;

    const VERSION: u32 = 1;
    const MODULE: ModuleName = ModuleName::ProjectWorkspace;
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::ProjectSessionIntent;

    #[test]
    fn optional_tab_updates_distinguish_absence_from_explicit_null() {
        let absent = serde_json::from_value::<ProjectSessionIntent>(json!({
            "kind": "update_tab",
            "tab_id": "tab-1"
        }))
        .expect("absent optional tab fields");
        let encoded = serde_json::to_value(absent).expect("tab update round trip");
        assert!(encoded.get("title").is_none());
        assert!(encoded.get("config").is_none());

        assert!(
            serde_json::from_value::<ProjectSessionIntent>(json!({
                "kind": "update_tab",
                "tab_id": "tab-1",
                "title": null
            }))
            .is_err()
        );
        let explicit_null = serde_json::from_value::<ProjectSessionIntent>(json!({
            "kind": "update_tab",
            "tab_id": "tab-1",
            "config": null
        }))
        .expect("explicit JSON null config");
        let ProjectSessionIntent::UpdateTab { config, .. } = explicit_null else {
            panic!("tab update intent");
        };
        assert_eq!(config, Some(serde_json::Value::Null));
    }
}
