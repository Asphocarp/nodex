use serde::{Deserialize, Deserializer, Serialize};
use utoipa::ToSchema;

use crate::collection::{CollectionWindow, CollectionWindowRequest};
use crate::{ModuleMutationReceipt, ModuleName, VersionedModuleContract};

pub const PROJECT_WORKSPACE_CONTRACT_VERSION: u32 = 8;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ProjectWorkspaceRead {
    ProjectBootstrap,
    ProjectWindow {
        include_archived: Option<bool>,
        window: CollectionWindowRequest,
    },
    Project {
        project_id: String,
    },
    ProjectActivitySummaries {
        project_ids: Vec<String>,
    },
    ProjectPermissionMode {
        project_id: String,
    },
    TaskWindow {
        project_id: Option<String>,
        include_archived: Option<bool>,
        window: CollectionWindowRequest,
    },
    SidebarOverview {
        include_archived: Option<bool>,
        pinned_window: CollectionWindowRequest,
    },
    Session {
        session_id: String,
    },
    Thread {
        thread_id: String,
    },
    ChildThreadWindow {
        parent_thread_id: String,
        include_archived: Option<bool>,
        window: CollectionWindowRequest,
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
    BackgroundProcessWindow {
        thread_id: Option<String>,
        window: CollectionWindowRequest,
    },
    ManagedWorktreeWindow {
        project_id: Option<String>,
        window: CollectionWindowRequest,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ProjectWorkspaceReadValue {
    ProjectBootstrap {
        bootstrap: ProjectWorkspaceBootstrap,
    },
    ProjectWindow {
        projects: CollectionWindow<ProjectWorkspaceProject>,
    },
    Project {
        project: ProjectWorkspaceProject,
    },
    ProjectActivitySummaries {
        summaries: Vec<ProjectWorkspaceProjectActivitySummary>,
        projection_revision: i64,
    },
    ProjectPermissionMode {
        mode: Option<CodexPermissionMode>,
    },
    TaskWindow {
        tasks: CollectionWindow<ProjectWorkspaceTaskSummary>,
    },
    SidebarOverview {
        pinned_tasks: CollectionWindow<ProjectWorkspaceTaskSummary>,
    },
    Session {
        session: ProjectWorkspaceSessionSummary,
    },
    Thread {
        thread: Box<ProjectWorkspaceThread>,
    },
    ChildThreadWindow {
        threads: CollectionWindow<ProjectWorkspaceThreadSummary>,
    },
    ExecutionContext {
        context: Box<ProjectWorkspaceExecutionContext>,
    },
    TurnAuthority {
        resolution: ProjectWorkspaceTurnAuthorityResolution,
    },
    BackgroundProcessWindow {
        processes: CollectionWindow<ProjectWorkspaceBackgroundProcess>,
    },
    ManagedWorktreeWindow {
        worktrees: CollectionWindow<ProjectWorkspaceManagedWorktreeSummary>,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ProjectWorkspaceBootstrapStatus {
    Empty,
    Ready,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct ProjectWorkspaceBootstrap {
    pub status: ProjectWorkspaceBootstrapStatus,
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

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct ProjectWorkspaceManagedWorktreeSummary {
    pub thread_id: String,
    pub project_id: String,
    pub session_id: Option<String>,
    pub session_title: Option<String>,
    pub thread_name: Option<String>,
    pub path: String,
    pub linked_at: String,
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
    /// Current default View of the Project's primary Database, resolved from
    /// Database authority at read time. `None` only when the Database has no
    /// active default View.
    pub default_database_view_id: Option<String>,
    pub lifecycle: ProjectLifecycle,
    pub binding_revision: i64,
    pub name: String,
    pub description: String,
    pub appearance: ProjectAppearance,
    pub sources: Vec<ProjectSource>,
    pub primary_workspace_root: Option<String>,
    pub pinned: bool,
    pub pinned_order: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ProjectMarkerColor {
    Black,
    Red,
    Orange,
    Yellow,
    Green,
    Blue,
    Purple,
    Pink,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "kebab-case")]
pub enum ProjectMarkerIcon {
    Folder,
    CurrencyDollar,
    Book,
    GraduationCap,
    Edit,
    Writing,
    Function,
    Terminal,
    Music,
    Popcorn,
    Customize,
    Palette,
    Stethoscope,
    Health,
    Lotus,
    Suitcase,
    BarChart,
    Kettlebell,
    Dumbbell,
    Logs,
    Scale,
    DeskGlobe,
    Plane,
    Globe,
    Wrench,
    Paw,
    Flask,
    Brain,
    Heart,
    Plant,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ProjectMarker {
    Icon { icon: ProjectMarkerIcon },
    Emoji { emoji: String },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct ProjectAppearance {
    pub color: ProjectMarkerColor,
    pub marker: ProjectMarker,
}

impl Default for ProjectAppearance {
    fn default() -> Self {
        Self {
            color: ProjectMarkerColor::Black,
            marker: ProjectMarker::Icon {
                icon: ProjectMarkerIcon::Folder,
            },
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct ProjectWorkspaceProjectActivitySummary {
    pub project_id: String,
    pub task_count: u32,
    pub waiting_count: u32,
    pub unread_count: u32,
    pub active_count: u32,
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
    /// Marks the Project's starter "Database View" Session. A database-starter
    /// Session's first window materialization presents the Project's primary
    /// Database default View; the View itself is resolved at read time and is
    /// never stored on the Session.
    pub database_starter: bool,
    pub thread_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct ProjectWorkspaceTaskSummary {
    pub session: ProjectWorkspaceSessionSummary,
    pub thread: Option<ProjectWorkspaceTaskThreadSummary>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct ProjectWorkspaceTaskThreadSummary {
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
    pub cwd: Option<String>,
    pub status: ProjectWorkspaceThreadStatus,
    pub archived: bool,
    pub created_at: i64,
    pub updated_at: i64,
    pub linked_at: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct ProjectWorkspaceThreadSummary {
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
    pub created_at: i64,
    pub updated_at: i64,
    pub linked_at: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, ToSchema)]
pub struct ProjectWorkspaceStarterPage {
    pub page_id: String,
    pub document_id: String,
    pub title_markdown: String,
    pub nfm: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ProjectWorkspaceIntent {
    CreateInitialProject {
        project_id: String,
        name: String,
        description: String,
        appearance: Option<ProjectAppearance>,
        source_roots: Vec<String>,
        starter_page: ProjectWorkspaceStarterPage,
    },
    CreateProject {
        project_id: String,
        name: String,
        description: String,
        appearance: Option<ProjectAppearance>,
        source_roots: Vec<String>,
    },
    UpdateProject {
        project_id: String,
        expected_binding_revision: i64,
        name: Option<String>,
        description: Option<String>,
        appearance: Option<ProjectAppearance>,
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
    ObserveAppServerThreadWindow {
        sweep_id: String,
        thread_ids: Vec<String>,
    },
    ReconcileAppServerThreadSweep {
        sweep_id: String,
        limit: Option<u32>,
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
    SetFallbackTitle {
        title: String,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_catalog_change: Option<ProjectCatalogChangeKind>,
    pub project_ids: Vec<String>,
    pub session_ids: Vec<String>,
    pub thread_ids: Vec<String>,
    pub session_summary_scopes: Vec<ProjectSessionInvalidationScope>,
    pub session_detail_ids: Vec<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ProjectCatalogChangeKind {
    Created,
    MetadataUpdated,
    SourcesUpdated,
    LifecycleUpdated,
    Reordered,
    PinUpdated,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ProjectSessionInvalidationScope {
    Project { project_id: String },
    Projectless,
    All,
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

    const VERSION: u32 = PROJECT_WORKSPACE_CONTRACT_VERSION;
    const MODULE: ModuleName = ModuleName::ProjectWorkspace;
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        ProjectAppearance, ProjectMarker, ProjectMarkerColor, ProjectMarkerIcon,
        ProjectWorkspaceIntent, ProjectWorkspaceThreadLane, ProjectWorkspaceThreadPlacement,
    };

    #[test]
    fn project_appearance_has_a_closed_tagged_wire_contract() {
        let value = serde_json::to_value(ProjectAppearance {
            color: ProjectMarkerColor::Purple,
            marker: ProjectMarker::Icon {
                icon: ProjectMarkerIcon::CurrencyDollar,
            },
        })
        .expect("Project appearance");
        assert_eq!(
            value,
            json!({
                "color": "purple",
                "marker": {
                    "kind": "icon",
                    "icon": "currency-dollar"
                }
            })
        );
        assert!(
            serde_json::from_value::<ProjectAppearance>(json!({
                "color": "chartreuse",
                "marker": { "kind": "icon", "icon": "folder" }
            }))
            .is_err()
        );
        assert!(
            serde_json::from_value::<ProjectAppearance>(json!({
                "color": "black",
                "marker": { "kind": "icon", "icon": "unknown" }
            }))
            .is_err()
        );
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
