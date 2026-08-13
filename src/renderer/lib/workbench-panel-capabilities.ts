import {
  PROJECT_SESSION_SINGLETON_TAB_KINDS,
  type PanelId,
  type WorkbenchTabKind,
} from "@/lib/types";

export type WorkbenchPanelActionKind =
  | Exclude<WorkbenchTabKind, "image_editor">
  | "side_chat";

export type WorkbenchPanelActionUnavailableReason =
  | "no_session"
  | "no_thread"
  | "no_cwd"
  | "project_required"
  | "panel_not_supported"
  | "singleton_exists";

export interface WorkbenchPanelActionCapability {
  available: boolean;
  reason: WorkbenchPanelActionUnavailableReason | null;
}

export interface WorkbenchPanelCapabilities {
  actions: Record<WorkbenchPanelActionKind, WorkbenchPanelActionCapability>;
  availableActionKinds: WorkbenchPanelActionKind[];
}

export interface ResolveWorkbenchPanelCapabilitiesInput {
  panelId: PanelId;
  hasSession: boolean;
  projectId: string | null;
  hasAttachedThread: boolean;
  cwd: string | null | undefined;
  projectWorkspaceRoot?: string | null;
  existingTabKinds?: readonly WorkbenchTabKind[];
}

const PROJECT_ACTION_ORDER: readonly WorkbenchPanelActionKind[] = [
  "review",
  "terminal",
  "browser",
  "files",
  "side_chat",
  "db_view",
  "page_stage",
  "canvas_stage",
];

const PROJECTLESS_ACTION_ORDER: readonly WorkbenchPanelActionKind[] = [
  "review",
  "side_chat",
  "browser",
  "terminal",
];

const ALL_ACTION_KINDS: readonly WorkbenchPanelActionKind[] = [
  ...PROJECT_ACTION_ORDER,
];

const RIGHT_PANEL_ACTIONS = new Set<WorkbenchPanelActionKind>(ALL_ACTION_KINDS);
const BOTTOM_PANEL_ACTIONS = new Set<WorkbenchPanelActionKind>([
  "terminal",
  "browser",
  "files",
  "side_chat",
]);
const PROJECT_REQUIRED_ACTIONS = new Set<WorkbenchPanelActionKind>([
  "files",
  "db_view",
  "page_stage",
  "canvas_stage",
]);
const SINGLETON_ACTIONS = new Set<WorkbenchPanelActionKind>(
  PROJECT_SESSION_SINGLETON_TAB_KINDS,
);

function unavailable(
  reason: WorkbenchPanelActionUnavailableReason,
): WorkbenchPanelActionCapability {
  return { available: false, reason };
}

function resolveActionCapability(
  kind: WorkbenchPanelActionKind,
  input: ResolveWorkbenchPanelCapabilitiesInput,
  existingTabKinds: ReadonlySet<WorkbenchTabKind>,
): WorkbenchPanelActionCapability {
  if (!input.hasSession) return unavailable("no_session");

  const supportedActions = input.panelId === "right"
    ? RIGHT_PANEL_ACTIONS
    : BOTTOM_PANEL_ACTIONS;
  if (!supportedActions.has(kind)) return unavailable("panel_not_supported");

  if (input.projectId === null && PROJECT_REQUIRED_ACTIONS.has(kind)) {
    return unavailable("project_required");
  }

  if (kind === "side_chat" && !input.hasAttachedThread) {
    return unavailable("no_thread");
  }

  if (kind === "review" && input.projectId === null && !input.hasAttachedThread) {
    return unavailable("no_thread");
  }

  if (kind === "terminal") {
    const cwd = input.cwd?.trim();
    const projectWorkspaceRoot = input.projectWorkspaceRoot?.trim();
    if (!cwd && !projectWorkspaceRoot) return unavailable("no_cwd");
    if (input.projectId === null && !input.hasAttachedThread) return unavailable("no_thread");
  }

  if (SINGLETON_ACTIONS.has(kind) && existingTabKinds.has(kind as WorkbenchTabKind)) {
    return unavailable("singleton_exists");
  }

  return { available: true, reason: null };
}

export function resolveWorkbenchPanelCapabilities(
  input: ResolveWorkbenchPanelCapabilitiesInput,
): WorkbenchPanelCapabilities {
  const existingTabKinds = new Set(input.existingTabKinds ?? []);
  const actions = Object.fromEntries(
    ALL_ACTION_KINDS.map((kind) => [
      kind,
      resolveActionCapability(kind, input, existingTabKinds),
    ]),
  ) as Record<WorkbenchPanelActionKind, WorkbenchPanelActionCapability>;
  const orderedKinds = input.projectId === null
    ? PROJECTLESS_ACTION_ORDER
    : PROJECT_ACTION_ORDER;

  return {
    actions,
    availableActionKinds: orderedKinds.filter((kind) => actions[kind].available),
  };
}
