import type {
  CodexPermissionMode,
  CodexThreadActiveFlag,
  CodexThreadStatusType,
  PanelId,
  ProjectSessionPanelLayout,
  ProjectSessionPanelState,
  ProjectSessionTabConfig,
  ProjectSessionTabKind,
} from "../types";
import type {
  CommittedModuleValue,
  CoreModuleResult,
  DeepCoreModule,
  ModuleApplyRequest,
  ModuleMutationReceipt,
  ModuleReadRequest,
  ModuleReadSnapshot,
} from "./common";

export interface ProjectWorkspaceDynamicToolCatalog {
  readonly namespace: string;
  readonly toolsetRevision: number;
}

export type ProjectWorkspaceTurnAuthorityScope = "project" | "library";
export type ProjectWorkspaceTurnAuthoritySource =
  | "project_turn"
  | "builtin_full_access"
  | "inherited_builtin_full_access";

export interface ProjectWorkspaceTurnCoordinate {
  readonly threadId: string;
  readonly turnId: string;
}

export interface ProjectWorkspaceTurnAuthority {
  readonly threadId: string;
  readonly turnId: string;
  readonly rootThreadId: string;
  readonly actorProjectId: string;
  readonly libraryId: string;
  readonly storeEpoch: string;
  readonly scope: ProjectWorkspaceTurnAuthorityScope;
  readonly source: ProjectWorkspaceTurnAuthoritySource;
}

export interface ProjectWorkspaceTurnAuthorityResolution {
  readonly authority: ProjectWorkspaceTurnAuthority | null;
  readonly persisted: boolean;
}

export interface ProjectWorkspaceBackgroundProcess {
  readonly id: string;
  readonly threadId: string;
  readonly threadTitle: string | null;
  readonly itemId: string;
  readonly turnId: string | null;
  readonly command: string;
  readonly cwd: string | null;
  readonly processId: string | null;
  readonly osPid: number | null;
  readonly terminalSessionId: string | null;
  readonly source: "app-server" | "terminal-action";
  readonly startedAtMs: number;
  readonly updatedAtMs: number;
}

export interface ProjectWorkspaceThreadStatus {
  readonly statusType: CodexThreadStatusType;
  readonly activeFlags: readonly CodexThreadActiveFlag[];
}

export interface ProjectWorkspaceThread {
  readonly threadId: string;
  readonly projectId: string | null;
  readonly sessionId: string | null;
  readonly forkedFromId: string | null;
  readonly parentThreadId: string | null;
  readonly threadName: string | null;
  readonly threadSource: string | null;
  readonly serviceName: string | null;
  readonly agentNickname: string | null;
  readonly agentRole: string | null;
  readonly threadPreview: string;
  readonly modelProvider: string;
  readonly cwd: string | null;
  readonly managedWorktreePath: string | null;
  readonly projectlessOutputDirectory: string | null;
  readonly projectlessWorkspaceBrowserRoot: string | null;
  readonly status: ProjectWorkspaceThreadStatus;
  readonly archived: boolean;
  readonly pinnedOrder: number | null;
  readonly hasUnreadTurn: boolean;
  readonly dynamicToolCatalogs: readonly ProjectWorkspaceDynamicToolCatalog[];
  readonly writableRoots: readonly string[];
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly linkedAt: string;
}

export interface ProjectWorkspaceExecutionContext {
  readonly thread: ProjectWorkspaceThread;
  readonly project: ProjectWorkspaceProject | null;
  readonly permissionMode: CodexPermissionMode | null;
}

export interface ProjectWorkspaceSidebar {
  readonly threads: readonly ProjectWorkspaceThread[];
  readonly projectThreadOrders: Readonly<Record<string, readonly string[]>>;
  readonly projectlessThreadOrder: readonly string[] | null;
}

export interface ProjectWorkspaceThreadSearchBackfillCandidate {
  readonly threadId: string;
  readonly sourceUpdatedAt: number;
  readonly pinnedOrder: number | null;
}

export interface ProjectWorkspaceThreadSearchSnippetSegment {
  readonly text: string;
  readonly highlight: boolean;
}

export interface ProjectWorkspaceThreadSearchResult {
  readonly threadId: string;
  readonly snippet: string;
  readonly score: number;
  readonly matchKind: "fts";
  readonly snippetSegments: readonly ProjectWorkspaceThreadSearchSnippetSegment[];
}

export interface ProjectWorkspaceThreadSearchUnit {
  readonly turnId: string;
  readonly itemId: string;
  readonly role: "user" | "assistant";
  readonly text: string;
}

export type ProjectWorkspaceThreadPlacement =
  | { readonly kind: "start" }
  | { readonly kind: "end" }
  | { readonly kind: "default" }
  | { readonly kind: "before"; readonly threadId: string };

export type ProjectWorkspaceThreadLane =
  | { readonly kind: "project"; readonly projectId: string }
  | { readonly kind: "projectless" };

export interface ProjectWorkspaceThreadMoveMetadataPatch {
  readonly cwd?: string | null;
  readonly managedWorktreePath?: string | null;
  readonly projectlessOutputDirectory?: string | null;
  readonly projectlessWorkspaceBrowserRoot?: string | null;
}

export interface ProjectWorkspaceThreadPatch {
  readonly projectId?: string | null;
  readonly forkedFromId?: string | null;
  readonly parentThreadId?: string | null;
  readonly threadName?: string | null;
  readonly threadSource?: string | null;
  readonly serviceName?: string | null;
  readonly agentNickname?: string | null;
  readonly agentRole?: string | null;
  readonly threadPreview?: string;
  readonly modelProvider?: string;
  readonly cwd?: string | null;
  readonly managedWorktreePath?: string | null;
  readonly projectlessOutputDirectory?: string | null;
  readonly projectlessWorkspaceBrowserRoot?: string | null;
  readonly status?: ProjectWorkspaceThreadStatus;
  readonly archived?: boolean;
  readonly createdAt?: number;
  readonly updatedAt?: number;
  readonly linkedAt?: string;
}

export interface ProjectWorkspaceProject {
  readonly id: string;
  readonly libraryId: string;
  readonly databaseId: string;
  readonly lifecycle: "active" | "inactive" | "archived";
  readonly bindingRevision: number;
  readonly name: string;
  readonly description: string;
  readonly icon: string | null;
  readonly sources: readonly { readonly root: string; readonly order: number }[];
  readonly primaryWorkspaceRoot: string | null;
  readonly pinned: boolean;
  readonly pinnedOrder: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProjectWorkspaceSessionSummary {
  readonly id: string;
  readonly projectId: string | null;
  readonly noThreadFallbackTitle: string;
  readonly displayTitle: string;
  readonly order: number;
  readonly pinned: boolean;
  readonly pinnedOrder: number | null;
  readonly archived: boolean;
  readonly archivedAt: string | null;
  readonly unread: boolean;
  readonly leftPaneCollapsed: boolean;
  readonly threadId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProjectWorkspaceSessionTab {
  readonly id: string;
  readonly sessionId: string;
  readonly projectId: string | null;
  readonly browserTabId: string | null;
  readonly panelId: PanelId;
  readonly kind: ProjectSessionTabKind;
  readonly title: string;
  readonly order: number;
  readonly config: ProjectSessionTabConfig;
  readonly stateKey: number;
  readonly state: unknown;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProjectSessionPanelSizePatch {
  readonly widthPx?: number;
  readonly heightPx?: number;
  readonly fullWidth?: boolean;
}

export interface ProjectSessionPanelStatePatch {
  readonly collapsed?: boolean;
  readonly size?: ProjectSessionPanelSizePatch;
}

export type ProjectWorkspaceRead =
  | { readonly kind: "startup" }
  | { readonly kind: "project"; readonly projectId: string }
  | {
      readonly kind: "sessions";
      readonly projectId?: string;
      readonly includeArchived?: boolean;
    }
  | { readonly kind: "session"; readonly sessionId: string }
  | { readonly kind: "thread"; readonly threadId: string }
  | {
      readonly kind: "threads";
      readonly projectId?: string;
      readonly includeArchived?: boolean;
    }
  | {
      readonly kind: "child_threads";
      readonly parentThreadId: string;
      readonly includeArchived?: boolean;
    }
  | { readonly kind: "execution_context"; readonly threadId: string }
  | {
      readonly kind: "turn_authority";
      readonly threadId: string;
      readonly turnId: string;
      readonly rootThreadId: string;
      readonly actorProjectId: string;
    }
  | { readonly kind: "background_processes"; readonly threadId?: string }
  | { readonly kind: "sidebar"; readonly includeArchived?: boolean }
  | { readonly kind: "thread_search"; readonly query: string; readonly limit?: number }
  | {
      readonly kind: "thread_search_backfill_candidates";
      readonly limit?: number;
      readonly force?: boolean;
    }
  | { readonly kind: "managed_worktrees"; readonly projectId: string };

export type ProjectWorkspaceReadValue =
  | {
      readonly kind: "startup";
      readonly projects: readonly ProjectWorkspaceProject[];
      readonly sessions: readonly ProjectWorkspaceSessionSummary[];
    }
  | { readonly kind: "project"; readonly project: ProjectWorkspaceProject }
  | {
      readonly kind: "sessions";
      readonly sessions: readonly ProjectWorkspaceSessionSummary[];
    }
  | {
      readonly kind: "session";
      readonly session: ProjectWorkspaceSessionSummary;
      readonly panels: Readonly<Record<PanelId, ProjectSessionPanelState>>;
      readonly tabs: readonly ProjectWorkspaceSessionTab[];
    }
  | {
      readonly kind: "thread";
      readonly thread: ProjectWorkspaceThread;
    }
  | {
      readonly kind: "threads";
      readonly threads: readonly ProjectWorkspaceThread[];
    }
  | {
      readonly kind: "child_threads";
      readonly threads: readonly ProjectWorkspaceThread[];
    }
  | {
      readonly kind: "execution_context";
      readonly context: ProjectWorkspaceExecutionContext;
    }
  | {
      readonly kind: "turn_authority";
      readonly resolution: ProjectWorkspaceTurnAuthorityResolution;
    }
  | {
      readonly kind: "background_processes";
      readonly processes: readonly ProjectWorkspaceBackgroundProcess[];
    }
  | {
      readonly kind: "sidebar";
      readonly sidebar: ProjectWorkspaceSidebar;
    }
  | {
      readonly kind: "thread_search";
      readonly results: readonly ProjectWorkspaceThreadSearchResult[];
    }
  | {
      readonly kind: "thread_search_backfill_candidates";
      readonly candidates: readonly ProjectWorkspaceThreadSearchBackfillCandidate[];
    }
  | {
      readonly kind: "managed_worktrees";
      readonly roots: readonly string[];
    };

export type ProjectSessionIntent =
  | { readonly kind: "rename"; readonly title: string }
  | { readonly kind: "set_pinned"; readonly pinned: boolean }
  | { readonly kind: "set_unread"; readonly unread: boolean }
  | { readonly kind: "set_archived"; readonly archived: boolean }
  | {
      readonly kind: "patch_view_state";
      readonly leftPaneCollapsed?: boolean;
      readonly rightPanel?: ProjectSessionPanelStatePatch;
      readonly bottomPanel?: ProjectSessionPanelStatePatch;
    }
  | {
      readonly kind: "replace_panel_layout";
      readonly panelId: PanelId;
      readonly layout: ProjectSessionPanelLayout;
    }
  | {
      readonly kind: "create_tab";
      readonly tabId: string;
      readonly panelId: PanelId;
      readonly targetLeafId?: string;
      readonly browserTabId?: string;
      readonly tabKind: ProjectSessionTabKind;
      readonly title: string;
      readonly config: ProjectSessionTabConfig;
    }
  | { readonly kind: "delete_tab"; readonly tabId: string }
  | {
      readonly kind: "move_tab";
      readonly tabId: string;
      readonly panelId: PanelId;
      readonly targetLeafId?: string;
      readonly beforeTabId?: string;
    }
  | {
      readonly kind: "update_tab";
      readonly tabId: string;
      readonly title?: string;
      readonly config?: ProjectSessionTabConfig;
    }
  | {
      readonly kind: "replace_tab_state";
      readonly tabId: string;
      readonly stateKey: number;
      readonly state: unknown;
    }
  | {
      readonly kind: "link_thread";
      readonly threadId: string;
      readonly expectedProjectId: string | null;
    }
  | { readonly kind: "unlink_thread"; readonly threadId: string };

export type ProjectWorkspaceIntent =
  | {
      readonly kind: "create_project";
      readonly projectId: string;
      readonly name: string;
      readonly description: string;
      readonly icon?: string;
      readonly sourceRoots: readonly string[];
    }
  | {
      readonly kind: "update_project";
      readonly projectId: string;
      readonly expectedBindingRevision: number;
      readonly name?: string;
      readonly description?: string;
      readonly icon?: string | null;
      readonly sourceRoots?: readonly string[];
    }
  | {
      readonly kind: "set_project_lifecycle";
      readonly projectId: string;
      readonly lifecycle: "active" | "inactive" | "archived";
    }
  | { readonly kind: "reorder_projects"; readonly projectIds: readonly string[] }
  | {
      readonly kind: "reorder_pinned_projects";
      readonly projectIds: readonly string[];
    }
  | {
      readonly kind: "set_project_pinned";
      readonly projectId: string;
      readonly pinned: boolean;
    }
  | {
      readonly kind: "create_session";
      readonly sessionId: string;
      readonly projectId: string | null;
      readonly title: string;
    }
  | { readonly kind: "delete_session"; readonly sessionId: string }
  | {
      readonly kind: "move_session";
      readonly sessionId: string;
      readonly projectId: string | null;
    }
  | {
      readonly kind: "reorder_sessions";
      readonly projectId: string | null;
      readonly sessionIds: readonly string[];
    }
  | {
      readonly kind: "reorder_pinned_sessions";
      readonly projectId: string | null;
      readonly sessionIds: readonly string[];
    }
  | {
      readonly kind: "upsert_thread";
      readonly threadId: string;
      readonly patch: ProjectWorkspaceThreadPatch;
    }
  | { readonly kind: "delete_thread"; readonly threadId: string }
  | {
      readonly kind: "set_thread_pinned";
      readonly threadId: string;
      readonly pinned: boolean;
    }
  | {
      readonly kind: "reorder_pinned_threads";
      readonly threadIds: readonly string[];
    }
  | {
      readonly kind: "set_project_thread_order";
      readonly projectId: string;
      readonly orderedThreadIds: readonly string[];
    }
  | { readonly kind: "clear_project_thread_order"; readonly projectId: string }
  | {
      readonly kind: "set_projectless_thread_order";
      readonly threadIdsInDisplayOrder: readonly string[];
      readonly visibleThreadIds: readonly string[];
      readonly nextVisibleThreadIds: readonly string[];
    }
  | {
      readonly kind: "move_thread";
      readonly threadId: string;
      readonly source: ProjectWorkspaceThreadLane;
      readonly target: ProjectWorkspaceThreadLane;
      readonly placement: ProjectWorkspaceThreadPlacement;
      readonly metadata: ProjectWorkspaceThreadMoveMetadataPatch;
    }
  | {
      readonly kind: "set_thread_unread";
      readonly threadId: string;
      readonly unread: boolean;
    }
  | {
      readonly kind: "replace_thread_dynamic_tool_catalogs";
      readonly threadId: string;
      readonly catalogs: readonly ProjectWorkspaceDynamicToolCatalog[];
    }
  | {
      readonly kind: "merge_thread_writable_roots";
      readonly threadId: string;
      readonly roots: readonly string[];
    }
  | {
      readonly kind: "replace_thread_writable_roots";
      readonly threadId: string;
      readonly roots: readonly string[];
    }
  | {
      readonly kind: "freeze_turn_authority";
      readonly threadId: string;
      readonly turnId: string;
      readonly rootThreadId: string;
      readonly actorProjectId: string;
      readonly source: ProjectWorkspaceTurnAuthoritySource;
      readonly inheritedFrom: ProjectWorkspaceTurnCoordinate | null;
    }
  | {
      readonly kind: "upsert_background_process";
      readonly process: ProjectWorkspaceBackgroundProcess;
      readonly preserveStartedAt?: boolean;
    }
  | {
      readonly kind: "replace_thread_search_projection";
      readonly threadId: string;
      readonly expectedThreadUpdatedAt: number;
      readonly units: readonly ProjectWorkspaceThreadSearchUnit[];
    }
  | {
      readonly kind: "fail_thread_search_projection";
      readonly threadId: string;
      readonly expectedThreadUpdatedAt: number;
      readonly error: string;
    }
  | {
      readonly kind: "set_project_permission_mode";
      readonly projectId: string;
      readonly mode: CodexPermissionMode;
    }
  | {
      readonly kind: "mutate_session";
      readonly sessionId: string;
      readonly intent: ProjectSessionIntent;
    };

export interface ProjectWorkspaceCommitValue {
  readonly affectedProjectIds: readonly string[];
  readonly affectedSessionIds: readonly string[];
  readonly affectedThreadIds: readonly string[];
}

export interface ProjectWorkspaceReceipt extends ModuleMutationReceipt {
  readonly affectedProjectIds: readonly string[];
  readonly affectedSessionIds: readonly string[];
}

export type ProjectWorkspaceModuleReadRequest = ModuleReadRequest<ProjectWorkspaceRead>;
export type ProjectWorkspaceModuleReadResult = CoreModuleResult<
  ModuleReadSnapshot<ProjectWorkspaceReadValue>
>;
export type ProjectWorkspaceModuleApplyRequest = ModuleApplyRequest<ProjectWorkspaceIntent>;
export type ProjectWorkspaceModuleApplyResult = CoreModuleResult<
  CommittedModuleValue<ProjectWorkspaceCommitValue, ProjectWorkspaceReceipt>
>;

export type ProjectWorkspaceModule = DeepCoreModule<
  ProjectWorkspaceModuleReadRequest,
  ProjectWorkspaceModuleReadResult,
  ProjectWorkspaceModuleApplyRequest,
  ProjectWorkspaceModuleApplyResult
>;

export interface ProjectWorkspaceEvent {
  readonly kind: "workspace_changed";
  readonly projectIds: readonly string[];
  readonly sessionIds: readonly string[];
  readonly threadIds: readonly string[];
}
