import type {
  PanelId,
  ProjectSessionPanelLayout,
  ProjectSessionPanelState,
  ProjectSessionTabConfig,
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
  readonly displayTitle: string;
  readonly order: number;
  readonly pinned: boolean;
  readonly archived: boolean;
  readonly unread: boolean;
  readonly threadId: string | null;
  readonly updatedAt: string;
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
    }
  | {
      readonly kind: "thread";
      readonly threadId: string;
      readonly sessionId: string | null;
      readonly projectId: string | null;
    }
  | {
      readonly kind: "managed_worktrees";
      readonly roots: readonly string[];
    };

export type ProjectSessionIntent =
  | { readonly kind: "rename"; readonly title: string }
  | { readonly kind: "set_pinned"; readonly pinned: boolean }
  | { readonly kind: "set_unread"; readonly unread: boolean }
  | {
      readonly kind: "replace_panel_layout";
      readonly layout: ProjectSessionPanelLayout;
    }
  | {
      readonly kind: "create_tab";
      readonly tabId: string;
      readonly panelId: string;
      readonly title: string;
      readonly config: ProjectSessionTabConfig;
    }
  | { readonly kind: "delete_tab"; readonly tabId: string }
  | {
      readonly kind: "move_tab";
      readonly tabId: string;
      readonly panelId: string;
      readonly beforeTabId?: string;
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
      readonly kind: "set_project_pinned";
      readonly projectId: string;
      readonly pinned: boolean;
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
