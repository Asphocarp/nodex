use std::collections::BTreeMap;

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
    ProjectPermissionMode {
        project_id: String,
    },
    Sessions {
        project_id: Option<String>,
        include_archived: Option<bool>,
    },
    Session {
        session_id: String,
    },
    SessionTab {
        tab_id: String,
    },
    Thread {
        thread_id: String,
    },
    Threads {
        project_id: Option<String>,
        include_archived: Option<bool>,
    },
    ChildThreads {
        parent_thread_id: String,
        include_archived: Option<bool>,
    },
    ExecutionContext {
        thread_id: String,
    },
    TurnAuthority {
        thread_id: String,
        turn_id: String,
        root_thread_id: String,
        actor_project_id: String,
    },
    BackgroundProcesses {
        thread_id: Option<String>,
    },
    Sidebar {
        include_archived: Option<bool>,
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
    ProjectPermissionMode {
        mode: Option<CodexPermissionMode>,
    },
    Sessions {
        sessions: Vec<ProjectWorkspaceSessionSummary>,
    },
    Session {
        session: ProjectWorkspaceSessionSummary,
        panels: Value,
        tabs: Vec<ProjectWorkspaceSessionTab>,
    },
    SessionTab {
        tab: ProjectWorkspaceSessionTab,
    },
    Thread {
        thread: Box<ProjectWorkspaceThread>,
    },
    Threads {
        threads: Vec<ProjectWorkspaceThread>,
    },
    ChildThreads {
        threads: Vec<ProjectWorkspaceThread>,
    },
    ExecutionContext {
        context: Box<ProjectWorkspaceExecutionContext>,
    },
    TurnAuthority {
        resolution: ProjectWorkspaceTurnAuthorityResolution,
    },
    BackgroundProcesses {
        processes: Vec<ProjectWorkspaceBackgroundProcess>,
    },
    Sidebar {
        sidebar: Box<ProjectWorkspaceSidebar>,
    },
    ManagedWorktrees {
        roots: Vec<String>,
    },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct ProjectWorkspaceSidebar {
    pub threads: Vec<ProjectWorkspaceThread>,
    pub project_thread_orders: BTreeMap<String, Vec<String>>,
    pub projectless_thread_order: Option<Vec<String>>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ProjectWorkspaceThreadPlacement {
    Start,
    End,
    Default,
    Before { thread_id: String },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ProjectWorkspaceThreadLane {
    Project { project_id: String },
    Projectless,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct ProjectWorkspaceThreadMoveMetadataPatch {
    #[serde(
        default,
        deserialize_with = "deserialize_present",
        skip_serializing_if = "Option::is_none"
    )]
    pub cwd: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "deserialize_present",
        skip_serializing_if = "Option::is_none"
    )]
    pub managed_worktree_path: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "deserialize_present",
        skip_serializing_if = "Option::is_none"
    )]
    pub projectless_output_directory: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "deserialize_present",
        skip_serializing_if = "Option::is_none"
    )]
    pub projectless_workspace_browser_root: Option<Option<String>>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct ProjectWorkspaceExecutionContext {
    pub thread: ProjectWorkspaceThread,
    pub project: Option<ProjectWorkspaceProject>,
    pub permission_mode: Option<CodexPermissionMode>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct ProjectWorkspaceThread {
    pub thread_id: String,
    pub project_id: Option<String>,
    pub session_id: Option<String>,
    pub forked_from_id: Option<String>,
    pub parent_thread_id: Option<String>,
    pub thread_name: Option<String>,
    pub thread_source: Option<String>,
    pub service_name: Option<String>,
    pub agent_nickname: Option<String>,
    pub agent_role: Option<String>,
    pub agent_path: Option<String>,
    pub thread_preview: String,
    pub model_provider: String,
    pub model_id: Option<String>,
    pub harness_id: Option<String>,
    pub reasoning_effort: Option<String>,
    pub service_tier: Option<String>,
    pub cwd: Option<String>,
    pub managed_worktree_path: Option<String>,
    pub projectless_output_directory: Option<String>,
    pub projectless_workspace_browser_root: Option<String>,
    pub status: ProjectWorkspaceThreadStatus,
    pub archived: bool,
    pub pinned_order: Option<i64>,
    pub has_unread_turn: bool,
    pub dynamic_tool_catalogs: Vec<ProjectWorkspaceDynamicToolCatalog>,
    pub writable_roots: Vec<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub linked_at: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct ProjectWorkspaceThreadStatus {
    pub status_type: CodexThreadStatusType,
    pub active_flags: Vec<CodexThreadActiveFlag>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub enum CodexThreadStatusType {
    NotLoaded,
    Idle,
    SystemError,
    Active,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub enum CodexThreadActiveFlag {
    WaitingOnApproval,
    WaitingOnUserInput,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "kebab-case")]
pub enum CodexPermissionMode {
    Auto,
    GuardianApprovals,
    FullAccess,
    Custom,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct ProjectWorkspaceDynamicToolCatalog {
    pub namespace: String,
    pub toolset_revision: i64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct ProjectWorkspaceTurnCoordinate {
    pub thread_id: String,
    pub turn_id: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ProjectWorkspaceTurnAuthorityScope {
    Project,
    Library,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ProjectWorkspaceTurnAuthoritySource {
    ProjectTurn,
    BuiltinFullAccess,
    InheritedBuiltinFullAccess,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct ProjectWorkspaceTurnAuthority {
    pub thread_id: String,
    pub turn_id: String,
    pub root_thread_id: String,
    pub actor_project_id: String,
    pub library_id: String,
    pub store_epoch: String,
    pub scope: ProjectWorkspaceTurnAuthorityScope,
    pub source: ProjectWorkspaceTurnAuthoritySource,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct ProjectWorkspaceTurnAuthorityResolution {
    pub authority: Option<ProjectWorkspaceTurnAuthority>,
    pub persisted: bool,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "kebab-case")]
pub enum ProjectWorkspaceBackgroundProcessSource {
    AppServer,
    TerminalAction,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct ProjectWorkspaceBackgroundProcess {
    pub id: String,
    pub thread_id: String,
    pub thread_title: Option<String>,
    pub item_id: String,
    pub turn_id: Option<String>,
    pub command: String,
    pub cwd: Option<String>,
    pub process_id: Option<String>,
    pub os_pid: Option<i64>,
    pub terminal_session_id: Option<String>,
    pub source: ProjectWorkspaceBackgroundProcessSource,
    pub started_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct ProjectWorkspaceThreadPatch {
    #[serde(
        default,
        deserialize_with = "deserialize_present",
        skip_serializing_if = "Option::is_none"
    )]
    pub project_id: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "deserialize_present",
        skip_serializing_if = "Option::is_none"
    )]
    pub forked_from_id: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "deserialize_present",
        skip_serializing_if = "Option::is_none"
    )]
    pub parent_thread_id: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "deserialize_present",
        skip_serializing_if = "Option::is_none"
    )]
    pub thread_name: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "deserialize_present",
        skip_serializing_if = "Option::is_none"
    )]
    pub thread_source: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "deserialize_present",
        skip_serializing_if = "Option::is_none"
    )]
    pub service_name: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "deserialize_present",
        skip_serializing_if = "Option::is_none"
    )]
    pub agent_nickname: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "deserialize_present",
        skip_serializing_if = "Option::is_none"
    )]
    pub agent_role: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "deserialize_present",
        skip_serializing_if = "Option::is_none"
    )]
    pub agent_path: Option<Option<String>>,
    pub thread_preview: Option<String>,
    pub model_provider: Option<String>,
    #[serde(
        default,
        deserialize_with = "deserialize_present",
        skip_serializing_if = "Option::is_none"
    )]
    pub model_id: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "deserialize_present",
        skip_serializing_if = "Option::is_none"
    )]
    pub harness_id: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "deserialize_present",
        skip_serializing_if = "Option::is_none"
    )]
    pub reasoning_effort: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "deserialize_present",
        skip_serializing_if = "Option::is_none"
    )]
    pub service_tier: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "deserialize_present",
        skip_serializing_if = "Option::is_none"
    )]
    pub cwd: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "deserialize_present",
        skip_serializing_if = "Option::is_none"
    )]
    pub managed_worktree_path: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "deserialize_present",
        skip_serializing_if = "Option::is_none"
    )]
    pub projectless_output_directory: Option<Option<String>>,
    #[serde(
        default,
        deserialize_with = "deserialize_present",
        skip_serializing_if = "Option::is_none"
    )]
    pub projectless_workspace_browser_root: Option<Option<String>>,
    pub status: Option<ProjectWorkspaceThreadStatus>,
    pub archived: Option<bool>,
    pub created_at: Option<i64>,
    pub updated_at: Option<i64>,
    pub linked_at: Option<String>,
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
    pub layout: Option<Value>,
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
    ReorderPinnedProjects {
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
    UpsertThread {
        thread_id: String,
        patch: Box<ProjectWorkspaceThreadPatch>,
    },
    UpdateThread {
        thread_id: String,
        patch: Box<ProjectWorkspaceThreadPatch>,
    },
    DeleteThread {
        thread_id: String,
    },
    SetThreadArchived {
        thread_id: String,
        archived: bool,
    },
    SetThreadPinned {
        thread_id: String,
        pinned: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        placement: Option<ProjectWorkspaceThreadPlacement>,
    },
    ReorderPinnedThreads {
        thread_ids: Vec<String>,
    },
    SetProjectThreadOrder {
        project_id: String,
        ordered_thread_ids: Vec<String>,
    },
    ClearProjectThreadOrder {
        project_id: String,
    },
    SetProjectlessThreadOrder {
        thread_ids_in_display_order: Vec<String>,
        visible_thread_ids: Vec<String>,
        next_visible_thread_ids: Vec<String>,
    },
    MoveThread {
        thread_id: String,
        source: ProjectWorkspaceThreadLane,
        target: ProjectWorkspaceThreadLane,
        placement: ProjectWorkspaceThreadPlacement,
        metadata: ProjectWorkspaceThreadMoveMetadataPatch,
    },
    SetThreadUnread {
        thread_id: String,
        unread: bool,
    },
    ReplaceThreadDynamicToolCatalogs {
        thread_id: String,
        catalogs: Vec<ProjectWorkspaceDynamicToolCatalog>,
    },
    MergeThreadWritableRoots {
        thread_id: String,
        roots: Vec<String>,
    },
    ReplaceThreadWritableRoots {
        thread_id: String,
        roots: Vec<String>,
    },
    FreezeTurnAuthority {
        thread_id: String,
        turn_id: String,
        root_thread_id: String,
        actor_project_id: String,
        source: ProjectWorkspaceTurnAuthoritySource,
        inherited_from: Option<ProjectWorkspaceTurnCoordinate>,
    },
    UpsertBackgroundProcess {
        process: ProjectWorkspaceBackgroundProcess,
        preserve_started_at: Option<bool>,
    },
    SetProjectPermissionMode {
        project_id: String,
        mode: CodexPermissionMode,
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
        fallback_title: Option<String>,
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
        layout: Option<Value>,
    },
    MoveTab {
        tab_id: String,
        panel_id: ProjectSessionPanelId,
        target_leaf_id: Option<String>,
        before_tab_id: Option<String>,
        source_layout: Option<Value>,
        target_layout: Option<Value>,
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
        #[serde(
            default,
            deserialize_with = "deserialize_present",
            skip_serializing_if = "Option::is_none"
        )]
        state_key: Option<i64>,
        #[serde(
            default,
            deserialize_with = "deserialize_present",
            skip_serializing_if = "Option::is_none"
        )]
        state: Option<Value>,
    },
    ReplaceTabState {
        tab_id: String,
        state_key: i64,
        state: Value,
    },
    LinkThread {
        thread_id: String,
        expected_project_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        thread_patch: Option<Box<ProjectWorkspaceThreadPatch>>,
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
    pub project_catalog_changed: bool,
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

    use super::{
        ProjectSessionIntent, ProjectWorkspaceIntent, ProjectWorkspaceThreadLane,
        ProjectWorkspaceThreadPlacement,
    };

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

    #[test]
    fn thread_patch_distinguishes_absence_from_an_explicit_clear() {
        let intent = serde_json::from_value::<ProjectWorkspaceIntent>(json!({
            "kind": "upsert_thread",
            "thread_id": "thread-1",
            "patch": {
                "project_id": null,
                "managed_worktree_path": null,
                "status": {
                    "status_type": "active",
                    "active_flags": ["waitingOnApproval"]
                }
            }
        }))
        .expect("presence-sensitive Thread patch");
        let ProjectWorkspaceIntent::UpsertThread { patch, .. } = intent else {
            panic!("upsert Thread intent");
        };
        assert_eq!(patch.project_id, Some(None));
        assert_eq!(patch.managed_worktree_path, Some(None));
        assert_eq!(patch.cwd, None);

        let encoded = serde_json::to_value(ProjectWorkspaceIntent::UpsertThread {
            thread_id: "thread-1".to_owned(),
            patch,
        })
        .expect("Thread patch round trip");
        assert_eq!(encoded["patch"]["project_id"], serde_json::Value::Null);
        assert!(encoded["patch"].get("cwd").is_none());
    }

    #[test]
    fn sidebar_intents_encode_explicit_lane_order_and_presence_semantics() {
        let intent = serde_json::from_value::<ProjectWorkspaceIntent>(json!({
            "kind": "move_thread",
            "thread_id": "thread-1",
            "source": { "kind": "projectless" },
            "target": { "kind": "project", "project_id": "project-1" },
            "placement": { "kind": "before", "thread_id": "thread-2" },
            "metadata": {
                "cwd": null,
                "managed_worktree_path": "/tmp/worktree"
            }
        }))
        .expect("explicit Thread move contract");
        let ProjectWorkspaceIntent::MoveThread {
            source,
            target,
            placement,
            metadata,
            ..
        } = intent
        else {
            panic!("move Thread intent");
        };
        assert_eq!(source, ProjectWorkspaceThreadLane::Projectless);
        assert_eq!(
            target,
            ProjectWorkspaceThreadLane::Project {
                project_id: "project-1".to_owned(),
            }
        );
        assert_eq!(
            placement,
            ProjectWorkspaceThreadPlacement::Before {
                thread_id: "thread-2".to_owned(),
            }
        );
        assert_eq!(metadata.cwd, Some(None));
        assert_eq!(
            metadata.managed_worktree_path,
            Some(Some("/tmp/worktree".to_owned()))
        );
        assert_eq!(metadata.projectless_output_directory, None);

        let set_empty = serde_json::to_value(ProjectWorkspaceIntent::SetProjectThreadOrder {
            project_id: "project-1".to_owned(),
            ordered_thread_ids: Vec::new(),
        })
        .expect("empty custom order");
        let clear = serde_json::to_value(ProjectWorkspaceIntent::ClearProjectThreadOrder {
            project_id: "project-1".to_owned(),
        })
        .expect("clear custom order");
        assert_eq!(set_empty["kind"], "set_project_thread_order");
        assert_eq!(set_empty["ordered_thread_ids"], json!([]));
        assert_eq!(clear["kind"], "clear_project_thread_order");
        assert!(clear.get("ordered_thread_ids").is_none());
    }
}
