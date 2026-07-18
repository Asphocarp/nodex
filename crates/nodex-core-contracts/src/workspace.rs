use serde::{Deserialize, Serialize};
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
        panel_layout: Value,
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
    pub display_title: String,
    pub order: i64,
    pub pinned: bool,
    pub archived: bool,
    pub unread: bool,
    pub thread_id: Option<String>,
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
    ReplacePanelLayout {
        layout: Value,
    },
    CreateTab {
        tab_id: String,
        panel_id: String,
        title: String,
        config: Value,
    },
    DeleteTab {
        tab_id: String,
    },
    MoveTab {
        tab_id: String,
        panel_id: String,
        before_tab_id: Option<String>,
    },
    LinkThread {
        thread_id: String,
        expected_project_id: Option<String>,
    },
    UnlinkThread {
        thread_id: String,
    },
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
