import type { WorkspaceFilesTab } from "@/features/workspace-files";
import type {
  NormalizedUserAttachmentImageEditorOptions,
} from "@/features/user-attachment-image-editor";
import type {
  ThreadMcpAppSidePanelInput,
  ThreadOpenSubagentPayload,
} from "@/features/local-conversation/thread-stage-types";
import type {
  CodexScheduledAutomationCreateInput,
  CodexScheduledAutomationUpdateInput,
  PanelId,
  WorkbenchTabProjection,
} from "@/lib/types";
import type { WorkbenchSessionRenderProjection } from "@/lib/workbench-session-presentation";

export type ProjectSessionFilesPreviewTab = WorkspaceFilesTab & {
  preview: true;
  kind: "files";
  config: WorkspaceFilesTab["config"] & {
    hostId: "local";
    workspaceRoot: string | null;
    cwd: string | null;
    path: string;
  };
};

export type DurableProjectSessionRenderableTab = WorkbenchTabProjection & {
  preview?: true;
};

export type WorkbenchTabProjectionPanelTab =
  | DurableProjectSessionRenderableTab
  | ProjectSessionFilesPreviewTab;

export type SideChatPanelTabStatus = "loading" | "ready" | "expired";

export interface SideChatPanelTab {
  sideChat: true;
  id: string;
  sessionId: string;
  panelId: PanelId;
  leafId?: string;
  parentThreadId: string;
  parentNavigationPath: string;
  threadId: string | null;
  title: string;
  status: SideChatPanelTabStatus;
  stateKey: number;
}

export interface McpAppPanelTab {
  mcpApp: true;
  id: string;
  sessionId: string;
  projectId: string;
  panelId: PanelId;
  leafId?: string;
  title: string;
  stateKey: number;
  app: ThreadMcpAppSidePanelInput;
}

export interface PlanPanelTab {
  planPanel: true;
  id: "plan";
  sessionId: string;
  projectId: string;
  panelId: "right";
  leafId?: string;
  title: "Plan";
  stateKey: number;
  planKey: string;
  threadId: string;
  turnId: string;
  itemId: string;
  content: string;
  cwd: string | null;
  hideCodeBlocks?: boolean;
}

export interface AutomationPanelTab {
  automationPanel: true;
  id: string;
  sessionId: string;
  projectId: string;
  panelId: "right";
  leafId?: string;
  title: string;
  stateKey: number;
  automationId: string | null;
  createInput: CodexScheduledAutomationCreateInput | null;
  mode: "open" | "suggested-create" | "suggested-update";
  updateInput: CodexScheduledAutomationUpdateInput | null;
}

export interface BackgroundAgentPanelTab {
  backgroundAgent: true;
  id: string;
  sessionId: string;
  projectId: string;
  panelId: "right";
  leafId?: string;
  threadId: string;
  title: string;
  stateKey: number;
  subagent: ThreadOpenSubagentPayload;
}

export interface SubagentsPanelTab {
  subagentsPanel: true;
  id: string;
  sessionId: string;
  projectId: string;
  panelId: "right";
  leafId?: string;
  rootThreadId: string;
  selectedThreadId: string | null;
  selectedDisplayName: string | null;
  title: "Subagents";
  stateKey: number;
}

export type AgentPanelTab = BackgroundAgentPanelTab | SubagentsPanelTab;

export interface ProcessOutputPanelTab {
  processOutputPanel: true;
  id: string;
  sessionId: string;
  projectId: string | null;
  panelId: "right";
  leafId?: string;
  threadId: string;
  turnId: string | null;
  itemId: string;
  title: string;
  stateKey: number;
  command: string;
  cwd: string | null;
  terminalSessionId: string | null;
}

export interface ImageEditorPanelTab {
  imageEditor: true;
  id: `image:${string}`;
  sessionId: string;
  projectId: string | null;
  threadId: string | null;
  panelId: "right";
  leafId?: string;
  title: string;
  tooltip: string;
  stateKey: number;
  preview: true;
  pinBehavior: "automatic";
  options: NormalizedUserAttachmentImageEditorOptions;
}

export interface ProcessOutputPanelTarget {
  threadId: string;
  turnId?: string | null;
  itemId: string;
  command: string;
  cwd: string | null;
  terminalSessionId?: string | null;
}

export type ProjectSessionRenderableTab =
  | DurableProjectSessionRenderableTab
  | ProjectSessionFilesPreviewTab
  | SideChatPanelTab
  | McpAppPanelTab
  | PlanPanelTab
  | AutomationPanelTab
  | BackgroundAgentPanelTab
  | SubagentsPanelTab
  | ProcessOutputPanelTab
  | ImageEditorPanelTab;

export function isSideChatPanelTab(
  tab: ProjectSessionRenderableTab,
): tab is SideChatPanelTab {
  return "sideChat" in tab && tab.sideChat === true;
}

export function isPanelTabClosable(
  tab: ProjectSessionRenderableTab,
): boolean {
  if (!isSideChatPanelTab(tab)) return true;
  return tab.status !== "loading";
}

export function isMcpAppPanelTab(
  tab: ProjectSessionRenderableTab,
): tab is McpAppPanelTab {
  return "mcpApp" in tab && tab.mcpApp === true;
}

export function isPlanPanelTab(
  tab: ProjectSessionRenderableTab,
): tab is PlanPanelTab {
  return "planPanel" in tab && tab.planPanel === true;
}

export function isAutomationPanelTab(
  tab: ProjectSessionRenderableTab,
): tab is AutomationPanelTab {
  return "automationPanel" in tab && tab.automationPanel === true;
}

export function isBackgroundAgentPanelTab(
  tab: ProjectSessionRenderableTab,
): tab is BackgroundAgentPanelTab {
  return "backgroundAgent" in tab && tab.backgroundAgent === true;
}

export function isSubagentsPanelTab(
  tab: ProjectSessionRenderableTab,
): tab is SubagentsPanelTab {
  return "subagentsPanel" in tab && tab.subagentsPanel === true;
}

export function isProcessOutputPanelTab(
  tab: ProjectSessionRenderableTab,
): tab is ProcessOutputPanelTab {
  return "processOutputPanel" in tab && tab.processOutputPanel === true;
}

export function isImageEditorPanelTab(
  tab: ProjectSessionRenderableTab,
): tab is ImageEditorPanelTab {
  return "imageEditor" in tab && tab.imageEditor === true;
}

export function isProjectSessionFilesPreviewTab(
  tab: ProjectSessionRenderableTab,
): tab is ProjectSessionFilesPreviewTab {
  return "kind" in tab
    && tab.kind === "files"
    && tab.preview === true
    && "workspaceRoot" in tab.config;
}

export function isTransientPanelTab(
  tab: ProjectSessionRenderableTab,
): tab is
  | SideChatPanelTab
  | McpAppPanelTab
  | PlanPanelTab
  | AutomationPanelTab
  | AgentPanelTab
  | ProcessOutputPanelTab
  | ImageEditorPanelTab {
  return isSideChatPanelTab(tab)
    || isMcpAppPanelTab(tab)
    || isPlanPanelTab(tab)
    || isAutomationPanelTab(tab)
    || isBackgroundAgentPanelTab(tab)
    || isSubagentsPanelTab(tab)
    || isProcessOutputPanelTab(tab)
    || isImageEditorPanelTab(tab);
}

export function isRootThreadRightPanelComposerOverlayEligibleTab(
  tab: ProjectSessionRenderableTab | null,
): boolean {
  if (!tab) return false;
  if (isImageEditorPanelTab(tab)) {
    return tab.options.composerTarget?.placement === "root"
      || (tab.options.composerTarget === null && tab.threadId !== null);
  }
  if (isTransientPanelTab(tab)) return false;

  return tab.kind === "review"
    || tab.kind === "browser"
    || tab.kind === "db_view"
    || tab.kind === "page_stage"
    || tab.kind === "canvas_stage"
    || (
      tab.kind === "image_editor"
      && tab.config.composerTarget?.placement === "root"
    );
}

export function makeBackgroundAgentPanelTabId(threadId: string): string {
  return `background-agent:${threadId}`;
}

export function makeSubagentsPanelTabId(rootThreadId: string): string {
  return `subagents:${rootThreadId}`;
}

export function makeProcessOutputPanelTabId(
  threadId: string,
  itemId: string,
): string {
  return `process-output:${encodeURIComponent(threadId)}:${encodeURIComponent(itemId)}`;
}

export function makeImageEditorPanelTabId(): `image:${string}` {
  return `image:${crypto.randomUUID()}`;
}

export function updateImageEditorPanelTabTitle(
  tabs: readonly ImageEditorPanelTab[],
  tabId: string,
  title: string,
): ImageEditorPanelTab[] {
  const normalizedTitle = title.trim();
  if (normalizedTitle.length === 0) return [...tabs];
  return tabs.map((tab) =>
    tab.id === tabId
      && (
        tab.title !== normalizedTitle
        || tab.tooltip !== normalizedTitle
      )
      ? {
          ...tab,
          title: normalizedTitle,
          tooltip: normalizedTitle,
        }
      : tab
  );
}

export function resolveProcessOutputPanelTitle(command: string): string {
  const trimmed = command.trim();
  return trimmed.length > 0 ? trimmed : "Process output";
}

export function getSideChatTabTitle(index: number): string {
  return index === 1 ? "Side chat" : `Side chat ${index}`;
}

export function buildSideChatParentNavigationPath(
  session: WorkbenchSessionRenderProjection,
  parentThreadId: string,
): string {
  const sessionPath = `session:${session.id}/thread:${parentThreadId}`;
  return session.projectId === null
    ? sessionPath
    : `project:${session.projectId}/${sessionPath}`;
}
