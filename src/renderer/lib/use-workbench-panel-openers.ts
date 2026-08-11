import {
  useCallback,
  useEffect,
  useRef,
} from "react";
import { toast } from "@/components/ui/toast";
import {
  workspaceTextDocumentRegistry,
} from "@/features/workspace-files/workspace-text-document-controller";
import {
  decideWorkspaceFileTabOpen,
  getWorkspaceFileName,
  isWorkspacePathInsideRoot,
} from "@/features/workspace-files";
import {
  getWorkspaceFileParentPath,
  normalizeOptionalPath,
} from "./workbench-workspace-context";
import {
  getDefaultPanelIdForTabKind,
} from "./workbench-panel-actions";
import {
  resolveDbCardSourceLeafId,
  resolveLeafIdForPanelTab,
  resolveRightNeighborPanelPlacement,
  resolveSessionPanelActiveLeafId,
  resolveSessionPanelActiveTabId,
} from "./workbench-panel-placement";
import {
  buildSideChatParentNavigationPath,
  getSideChatTabTitle,
  type AutomationPanelTab,
  type McpAppPanelTab,
  type PlanPanelTab,
  type SideChatPanelTab,
} from "./workbench-panel-tab-model";
import {
  isPreviewableWorkbenchTabKind,
  makePreviewPageStageTab,
  makePreviewWorkbenchTabProjection,
  makePreviewWorkspaceFileTab,
  makeWorkbenchTabProjectionDraft,
} from "./workbench-panel-preview";
import {
  getRenderablePanelPreviewTab,
} from "./workbench-panel-projection";
import {
  makeWorkbenchSessionPanelSlotKey,
} from "./workbench-panel-slot-key";
import {
  findWorkbenchPanelLeaf,
} from "../../shared/workbench-panel-layout";
import type {
  WorkbenchPanelController,
} from "./use-workbench-panel-controller";
import type {
  WorkbenchSessionRenderProjection,
} from "./workbench-session-presentation";
import type {
  useCodexAppServerControl,
} from "@/features/local-conversation";
import type {
  ThreadMcpAppSidePanelInput,
  ThreadOpenSideChatInput,
  ThreadPlanSidePanelTarget,
  ThreadSummaryPanelScheduledAutomationOpenInput,
} from "@/features/local-conversation/thread-stage-types";
import type {
  OpenPageTabHandler,
} from "@/components/workbench/workbench-page-stage-panel";
import type {
  OpenPageStageOptions,
} from "@/components/board/open-page-stage";
import type {
  CodexCollaborationModeKind,
  PanelId,
  Project,
  WorkbenchTabUpdateInput,
  WorkbenchTabCreateInput,
  WorkbenchTabProjection,
} from "./types";
import type { WorkspaceFileRevealLocation } from "@/features/workspace-files/workspace-file-types";
import type {
  useWorkbenchPanelLifecycle,
} from "./use-workbench-panel-lifecycle";

type ProjectSession = WorkbenchSessionRenderProjection;
export interface OpenCanvasStageOptions {
  readonly targetPanelId?: PanelId;
  readonly targetLeafId?: string;
}

export type OpenCanvasStageHandler = (
  projectId: string,
  canvasBlockId: string,
  titleSnapshot?: string,
  options?: OpenCanvasStageOptions,
) => Promise<boolean>;

export function findCanvasStageTab(
  session: Pick<WorkbenchSessionRenderProjection, "tabs">,
  projectId: string,
  canvasBlockId: string,
): WorkbenchTabProjection | null {
  return session.tabs.find((tab) =>
    tab.kind === "canvas_stage"
    && tab.config.projectId === projectId
    && tab.config.canvasBlockId === canvasBlockId
  ) ?? null;
}

type PanelLifecycle = Pick<
  ReturnType<typeof useWorkbenchPanelLifecycle>,
  | "clearPanelPreviewTab"
  | "closeTab"
  | "ensureActivePanelOpenWithoutRefresh"
  | "pinPreviewTab"
  | "setActivePanelTab"
  | "updateActivePanel"
>;

interface WorkbenchPanelOpenersInput {
  readonly activeProjectId: string | null;
  readonly activeSession: ProjectSession | null;
  readonly controller: WorkbenchPanelController;
  readonly lifecycle: PanelLifecycle;
  readonly codexControl: ReturnType<typeof useCodexAppServerControl>;
  readonly projects: readonly Project[];
  readonly rightPanelFullWidth: boolean;
  readonly createSessionViewTab: (
    input: WorkbenchTabCreateInput,
  ) => WorkbenchTabProjection | null;
  readonly updateTab: (
    tabId: string,
    patch: WorkbenchTabUpdateInput,
  ) => WorkbenchTabProjection | null;
  readonly refreshProjectSessions: (
    projectId: string | null,
  ) => Promise<unknown>;
  readonly openPageStage: (
    projectId: string,
    pageId: string,
    titleSnapshot?: string,
    options?: OpenPageStageOptions,
  ) => void;
  readonly pendingPageDeepLinkOpen: {
    readonly projectId: string;
    readonly pageId: string;
  } | null | undefined;
  readonly onPageDeepLinkHandled?: (payload: {
    readonly projectId: string;
    readonly pageId: string;
  }) => void;
}

/**
 * Owns creation and replacement policy for durable previews and auxiliary
 * panel surfaces. Callers provide lifecycle and owner ports, never raw state
 * setters.
 */
export function useWorkbenchPanelOpeners({
  activeProjectId,
  activeSession,
  controller,
  lifecycle,
  codexControl: workbenchCodexControl,
  projects,
  rightPanelFullWidth,
  createSessionViewTab,
  updateTab,
  refreshProjectSessions,
  openPageStage,
  pendingPageDeepLinkOpen,
  onPageDeepLinkHandled,
}: WorkbenchPanelOpenersInput) {
  const panelControllerRef = useRef(controller);
  panelControllerRef.current = controller;
  const {
    previewTabsByPanel,
    sideChatTabsBySession,
  } = controller;
  const {
    clearPanelPreviewTab,
    closeTab,
    ensureActivePanelOpenWithoutRefresh,
    pinPreviewTab,
    setActivePanelTab,
    updateActivePanel,
  } = lifecycle;

const openSideChat = useCallback(async (
    input: ThreadOpenSideChatInput & {
      targetPanelId?: PanelId;
      targetLeafId?: string;
      collaborationMode?: CodexCollaborationModeKind;
    } = {},
  ) => {
    if (!activeSession?.thread) {
      toast.danger("Failed to open side chat", { id: "side-chat-open-failed" });
      return;
    }
    const panelId = input.targetPanelId ?? "right";
    const leafId = input.targetLeafId ?? resolveSessionPanelActiveLeafId(activeSession, panelId);
    const parentThreadId = activeSession.thread.threadId;
    const existingPanelSideChats = (sideChatTabsBySession[activeSession.id] ?? []).filter((tab) =>
      tab.panelId === panelId
    );
    const index = existingPanelSideChats.length + 1;
    const title = getSideChatTabTitle(index);
    const loadingTabId = `sidechat-loading:${parentThreadId}:${index}`;
    const parentNavigationPath = buildSideChatParentNavigationPath(activeSession, parentThreadId);
    const loadingTab: SideChatPanelTab = {
      sideChat: true,
      id: loadingTabId,
      sessionId: activeSession.id,
      panelId,
      leafId,
      parentThreadId,
      parentNavigationPath,
      threadId: null,
      title,
      status: "loading",
      stateKey: Date.now(),
    };

    panelControllerRef.current.upsertEphemeralTab(loadingTab);
    await ensureActivePanelOpenWithoutRefresh(panelId);

    try {
      const draftPrompt = input.kind === "draft" ? input.draftPrompt.trim() : "";
      const result = await workbenchCodexControl.startSideChat({
        parentThreadId,
        parentNavigationPath,
        ...(input.kind === "draft" ? {} : {
          prompt: input.prompt,
          promptInput: input.promptInput,
        }),
        collaborationMode: input.collaborationMode,
      });
      const readyTabId = `sidechat:${result.threadId}`;
      panelControllerRef.current.updateSideChatTabsBySession((current) => {
        const tabs = current[activeSession.id] ?? [];
        return {
          ...current,
          [activeSession.id]: tabs.map((tab) =>
            tab.id === loadingTabId
              ? {
                  ...tab,
                  id: readyTabId,
                  threadId: result.threadId,
                  status: "ready",
                  stateKey: tab.stateKey + 1,
                }
              : tab
          ),
        };
      });
      panelControllerRef.current.updateSideChatActiveTabByPanel((current) => ({
        ...current,
        [makeWorkbenchSessionPanelSlotKey(activeSession.id, panelId, leafId)]: readyTabId,
      }));
      if (draftPrompt.length > 0) {
        workbenchCodexControl.setComposerIntent(result.threadId, {
          prompt: draftPrompt,
          focusNonce: Date.now(),
        });
      }
    } catch {
      panelControllerRef.current.removeEphemeralTab({
        sessionId: activeSession.id,
        panelId,
        leafId,
        tabId: loadingTabId,
      });
      toast.danger("Failed to open side chat", { id: "side-chat-open-failed" });
    }
  }, [
    activeSession,
    ensureActivePanelOpenWithoutRefresh,
    sideChatTabsBySession,
    workbenchCodexControl,
  ]);

  const openExistingSideChat = useCallback(async (input: {
    threadId: string;
    parentThreadId: string;
    parentNavigationPath: string;
  }): Promise<boolean> => {
    if (!activeSession?.thread) return false;
    if (activeSession.thread.threadId !== input.parentThreadId) return false;

    const tabId = `sidechat:${input.threadId}`;
    const existingTab = (sideChatTabsBySession[activeSession.id] ?? [])
      .find((tab) => tab.id === tabId);
    if (existingTab) {
      panelControllerRef.current.updateSideChatActiveTabByPanel((current) => ({
        ...current,
        [makeWorkbenchSessionPanelSlotKey(
          activeSession.id,
          existingTab.panelId,
          existingTab.leafId,
        )]: tabId,
      }));
      await ensureActivePanelOpenWithoutRefresh(existingTab.panelId);
      return true;
    }

    const panelId = "right" as const;
    const leafId = resolveSessionPanelActiveLeafId(activeSession, panelId);
    const panelSideChats = (sideChatTabsBySession[activeSession.id] ?? [])
      .filter((tab) => tab.panelId === panelId);
    const tab: SideChatPanelTab = {
      sideChat: true,
      id: tabId,
      sessionId: activeSession.id,
      panelId,
      leafId,
      parentThreadId: input.parentThreadId,
      parentNavigationPath: input.parentNavigationPath,
      threadId: input.threadId,
      title: getSideChatTabTitle(panelSideChats.length + 1),
      status: "ready",
      stateKey: Date.now(),
    };

    panelControllerRef.current.upsertEphemeralTab(tab);
    panelControllerRef.current.updateSideChatActiveTabByPanel((current) => ({
      ...current,
      [makeWorkbenchSessionPanelSlotKey(activeSession.id, panelId, leafId)]: tabId,
    }));
    await ensureActivePanelOpenWithoutRefresh(panelId);
    return true;
  }, [
    activeSession,
    ensureActivePanelOpenWithoutRefresh,
    sideChatTabsBySession,
  ]);

  const openMcpAppSidePanel = useCallback(async (input: ThreadMcpAppSidePanelInput) => {
    if (!activeSession || activeSession.projectId === null) return;
    const projectId = activeSession.projectId;

    const panelId: PanelId = "right";
    const leafId = resolveSessionPanelActiveLeafId(activeSession, panelId);
    const tabId = `mcp-app:${input.mcpAppId}`;
    const tab: McpAppPanelTab = {
      mcpApp: true,
      id: tabId,
      sessionId: activeSession.id,
      projectId,
      panelId,
      leafId,
      title: input.title.trim() || input.server,
      stateKey: Date.now(),
      app: input,
    };

    panelControllerRef.current.upsertEphemeralTab(tab);
    await ensureActivePanelOpenWithoutRefresh(panelId);
  }, [activeSession, ensureActivePanelOpenWithoutRefresh]);

  const openPlanSidePanel = useCallback(async (input: ThreadPlanSidePanelTarget) => {
    if (!activeSession || activeSession.projectId === null) return;
    const projectId = activeSession.projectId;
    const panelId: PanelId = "right";
    const leafId = resolveSessionPanelActiveLeafId(activeSession, panelId);
    const tabId = "plan";
    const tab: PlanPanelTab = {
      planPanel: true,
      id: tabId,
      sessionId: activeSession.id,
      projectId,
      panelId,
      leafId,
      title: "Plan",
      stateKey: Date.now(),
      planKey: input.planKey,
      threadId: input.threadId,
      turnId: input.turnId,
      itemId: input.itemId,
      content: input.content,
      cwd: input.cwd,
      hideCodeBlocks: input.hideCodeBlocks,
    };

    panelControllerRef.current.upsertEphemeralTab(tab);
    panelControllerRef.current.updatePanelCollapsedOverrides((current) => ({
      ...current,
      [makeWorkbenchSessionPanelSlotKey(activeSession.id, panelId)]: false,
    }));
    await ensureActivePanelOpenWithoutRefresh(panelId);
  }, [activeSession, ensureActivePanelOpenWithoutRefresh]);

  const openAutomationSidePanel = useCallback(async (input: ThreadSummaryPanelScheduledAutomationOpenInput) => {
    if (!activeSession || activeSession.projectId === null) return;
    const projectId = activeSession.projectId;
    const panelId: PanelId = "right";
    const leafId = resolveSessionPanelActiveLeafId(activeSession, panelId);
    const mode = input.mode ?? "open";
    const automationId = input.automationId ?? input.updateInput?.id ?? null;
    const suggestionKey = [
      mode,
      input.updateInput?.id ?? automationId ?? "",
      input.createInput?.name ?? input.updateInput?.name ?? input.title,
      input.createInput?.rrule ?? input.updateInput?.rrule ?? "",
    ].join(":");
    const tabId = mode === "suggested-create" || mode === "suggested-update"
      ? `automation-suggestion:${encodeURIComponent(suggestionKey)}`
      : `automation:${automationId ?? encodeURIComponent(input.title)}`;
    const tab: AutomationPanelTab = {
      automationPanel: true,
      id: tabId,
      sessionId: activeSession.id,
      projectId,
      panelId,
      leafId,
      title: input.title.trim() || "Scheduled task",
      stateKey: Date.now(),
      automationId,
      createInput: input.createInput ?? null,
      mode,
      updateInput: input.updateInput ?? null,
    };

    panelControllerRef.current.upsertEphemeralTab(tab);
    await ensureActivePanelOpenWithoutRefresh(panelId);
  }, [
    activeSession,
    ensureActivePanelOpenWithoutRefresh,
  ]);

  const recreateSideChatPanelTab = useCallback(async (tabId: string) => {
    if (!activeSession) return;
    const existingTab = (sideChatTabsBySession[activeSession.id] ?? []).find((tab) => tab.id === tabId);
    if (!existingTab) return;

    const titleIndexMatch = existingTab.title.match(/(\d+)$/u);
    const titleIndex = titleIndexMatch ? Number.parseInt(titleIndexMatch[1] ?? "1", 10) : 1;
    const safeIndex = Number.isFinite(titleIndex) && titleIndex > 0 ? titleIndex : 1;
    const loadingTabId = `sidechat-loading:${existingTab.parentThreadId}:${safeIndex}`;
    panelControllerRef.current.updateSideChatTabsBySession((current) => {
      const tabs = current[activeSession.id] ?? [];
      return {
        ...current,
        [activeSession.id]: tabs.map((tab) =>
          tab.id === tabId
            ? {
                ...tab,
                id: loadingTabId,
                threadId: null,
                status: "loading",
                stateKey: tab.stateKey + 1,
              }
            : tab
        ),
      };
    });
    panelControllerRef.current.updateSideChatActiveTabByPanel((current) => ({
      ...current,
      [makeWorkbenchSessionPanelSlotKey(activeSession.id, existingTab.panelId, existingTab.leafId)]: loadingTabId,
    }));

    try {
      const result = await workbenchCodexControl.startSideChat({
        parentThreadId: existingTab.parentThreadId,
        parentNavigationPath: existingTab.parentNavigationPath,
      });
      const readyTabId = `sidechat:${result.threadId}`;
      panelControllerRef.current.updateSideChatTabsBySession((current) => {
        const tabs = current[activeSession.id] ?? [];
        return {
          ...current,
          [activeSession.id]: tabs.map((tab) =>
            tab.id === loadingTabId
              ? {
                  ...tab,
                  id: readyTabId,
                  threadId: result.threadId,
                  status: "ready",
                  stateKey: tab.stateKey + 1,
                }
              : tab
          ),
        };
      });
      panelControllerRef.current.updateSideChatActiveTabByPanel((current) => ({
        ...current,
        [makeWorkbenchSessionPanelSlotKey(activeSession.id, existingTab.panelId, existingTab.leafId)]: readyTabId,
      }));
    } catch {
      panelControllerRef.current.updateSideChatTabsBySession((current) => {
        const tabs = current[activeSession.id] ?? [];
        return {
          ...current,
          [activeSession.id]: tabs.map((tab) =>
            tab.id === loadingTabId
              ? {
                  ...existingTab,
                  status: "expired",
                  stateKey: existingTab.stateKey + 1,
                }
              : tab
          ),
        };
      });
      panelControllerRef.current.updateSideChatActiveTabByPanel((current) => ({
        ...current,
        [makeWorkbenchSessionPanelSlotKey(activeSession.id, existingTab.panelId, existingTab.leafId)]: existingTab.id,
      }));
      toast.danger("Failed to start a new side chat", { id: "side-chat-recreate-failed" });
    }
  }, [activeSession, sideChatTabsBySession, workbenchCodexControl]);

  const openPreviewTab = useCallback(async (
    kind: WorkbenchTabProjection["kind"],
    targetPanelId?: PanelId,
    targetLeafId?: string,
  ) => {
    if (!activeSession) return;
    const sessionProjectId = activeSession.projectId;
    if (!isPreviewableWorkbenchTabKind(kind)) return;

    const panelId = targetPanelId ?? getDefaultPanelIdForTabKind(kind);
    const leafId = targetLeafId ?? resolveSessionPanelActiveLeafId(activeSession, panelId);
    const draft = makeWorkbenchTabProjectionDraft(activeSession, kind);
    if (!draft) return;

    panelControllerRef.current.updatePreviewTabsByPanel((current) => ({
      ...current,
      [makeWorkbenchSessionPanelSlotKey(activeSession.id, panelId, leafId)]: makePreviewWorkbenchTabProjection(activeSession, panelId, draft),
    }));
    await ensureActivePanelOpenWithoutRefresh(panelId);
    await refreshProjectSessions(sessionProjectId);
  }, [activeSession, ensureActivePanelOpenWithoutRefresh, refreshProjectSessions]);

  const openWorkspaceFileTab = useCallback(async (input: {
    cwd?: string | null;
    hostId?: "local";
    path: string;
    title: string;
    panelId: PanelId;
    mode?: "preview" | "durable";
    workspaceRoot?: string | null;
    location?: WorkspaceFileRevealLocation;
  }) => {
    if (!activeSession) return false;
    const sessionProjectId = activeSession.projectId;
    const leafId = resolveSessionPanelActiveLeafId(activeSession, input.panelId);
    const project = sessionProjectId === null
      ? null
      : projects.find((candidate) => candidate.id === sessionProjectId) ?? null;
    const cwd = normalizeOptionalPath(input.cwd) ?? normalizeOptionalPath(activeSession.thread?.cwd) ?? null;
    const explicitWorkspaceRoot = normalizeOptionalPath(input.workspaceRoot);
    const matchingThreadRoot = cwd && isWorkspacePathInsideRoot(cwd, input.path) ? cwd : undefined;
    const matchingProjectRoot = project?.sources
      .map((source) => normalizeOptionalPath(source.root))
      .find((root): root is string => Boolean(root && isWorkspacePathInsideRoot(root, input.path)));
    const workspaceRoot = explicitWorkspaceRoot
      ?? matchingThreadRoot
      ?? matchingProjectRoot
      ?? (project === null ? normalizeOptionalPath(getWorkspaceFileParentPath(input.path)) : undefined)
      ?? null;
    const activeTabId = resolveSessionPanelActiveTabId(activeSession, input.panelId);
    const leaf = findWorkbenchPanelLeaf(activeSession.panels[input.panelId].layout, leafId);
    const durableFilesTabs = activeSession.tabs.flatMap((tab) => {
      if (
        tab.kind !== "files"
        || tab.panelId !== input.panelId
        || !leaf?.tabIds.includes(tab.id)
      ) {
        return [];
      }
      return [{
        id: tab.id,
        hostId: "local" as const,
        path: "path" in tab.config && typeof tab.config.path === "string"
          ? tab.config.path
          : null,
      }];
    });
    const renderablePreviewTab = getRenderablePanelPreviewTab(
      activeSession,
      input.panelId,
      leafId,
      previewTabsByPanel,
    );
    const filesPreviewTab = renderablePreviewTab?.kind === "files"
      ? {
        id: renderablePreviewTab.id,
        hostId: "local" as const,
        path: typeof renderablePreviewTab.config.path === "string"
          ? renderablePreviewTab.config.path
          : null,
      }
      : null;
    const decision = decideWorkspaceFileTabOpen({
      activeDurableTabId: activeTabId,
      durableTabs: durableFilesTabs,
      hostId: input.hostId ?? "local",
      mode: input.mode ?? "preview",
      path: input.path,
      previewTab: filesPreviewTab,
    });
    const fileConfig = {
      projectId: activeSession.projectId,
      hostId: input.hostId ?? "local",
      cwd,
      workspaceRoot,
      path: input.path,
    } as const;
    const applyRevealToDurableTab = (tabId: string) => {
      if (!input.location) return;
      const currentTab = activeSession.tabs.find((tab) => tab.id === tabId);
      const currentState = currentTab?.state;
      const state = typeof currentState === "object"
        && currentState !== null
        && !Array.isArray(currentState)
        ? currentState as Record<string, unknown>
        : {};
      updateTab(tabId, {
        state: {
          ...state,
          pendingReveal: input.location,
        },
        stateKey: (currentTab?.stateKey ?? 0) + 1,
      });
    };
    const applyRevealToPreviewTab = (slotKey: string) => {
      if (!input.location) return;
      panelControllerRef.current.updatePreviewTabsByPanel((current) => {
        const previewTab = current[slotKey];
        if (!previewTab || previewTab.kind !== "files") return current;
        const currentState = previewTab.state;
        const state = typeof currentState === "object"
          && currentState !== null
          && !Array.isArray(currentState)
          ? currentState as Record<string, unknown>
          : {};
        return {
          ...current,
          [slotKey]: {
            ...previewTab,
            state: {
              ...state,
              pendingReveal: input.location,
            },
            stateKey: previewTab.stateKey + 1,
          },
        };
      });
    };
    if (decision.kind === "focus-durable") {
      await setActivePanelTab(input.panelId, decision.tabId, { openPanel: true });
      applyRevealToDurableTab(decision.tabId);
      return true;
    }
    if (decision.kind === "focus-preview") {
      applyRevealToPreviewTab(makeWorkbenchSessionPanelSlotKey(activeSession.id, input.panelId, leafId));
      await ensureActivePanelOpenWithoutRefresh(input.panelId);
      return true;
    }
    if (decision.kind === "create-from-empty") {
      const created = createSessionViewTab({
        sessionId: activeSession.id,
        panelId: input.panelId,
        targetLeafId: leafId,
        kind: "files",
        title: input.title || getWorkspaceFileName(input.path),
        config: fileConfig,
      });
      if (!created) return false;
      applyRevealToDurableTab(created.id);
      await closeTab(decision.emptyTabId, {
        preferredActiveLeafId: leafId,
        preferredActiveTabId: created.id,
      });
      await ensureActivePanelOpenWithoutRefresh(input.panelId);
      return true;
    }
    if (decision.kind === "pin-preview") {
      applyRevealToPreviewTab(makeWorkbenchSessionPanelSlotKey(activeSession.id, input.panelId, leafId));
      await pinPreviewTab(input.panelId, decision.tabId, leafId);
      return true;
    }

    if (
      decision.kind === "create-preview"
      && decision.replacingPreviewTabId
    ) {
      const saved = await workspaceTextDocumentRegistry.flush(
        decision.replacingPreviewTabId,
      );
      if (!saved) {
        toast.danger("Resolve the file conflict before opening another file");
        return false;
      }
    }

    if (decision.kind === "create-durable") {
      const created = createSessionViewTab({
        sessionId: activeSession.id,
        panelId: input.panelId,
        targetLeafId: leafId,
        kind: "files",
        title: input.title || getWorkspaceFileName(input.path),
        config: fileConfig,
      });
      if (created) applyRevealToDurableTab(created.id);
      await ensureActivePanelOpenWithoutRefresh(input.panelId);
      return true;
    }

    panelControllerRef.current.updatePreviewTabsByPanel((current) => ({
      ...current,
      [makeWorkbenchSessionPanelSlotKey(activeSession.id, input.panelId, leafId)]: makePreviewWorkspaceFileTab(activeSession, input.panelId, {
        leafId,
        path: input.path,
        title: input.title || getWorkspaceFileName(input.path),
        cwd,
        workspaceRoot,
        location: input.location,
      }),
    }));
    await ensureActivePanelOpenWithoutRefresh(input.panelId);
    await refreshProjectSessions(sessionProjectId);
    return true;
  }, [
    activeSession,
    closeTab,
    createSessionViewTab,
    ensureActivePanelOpenWithoutRefresh,
    pinPreviewTab,
    previewTabsByPanel,
    projects,
    refreshProjectSessions,
    setActivePanelTab,
    updateTab,
  ]);

  const openPageTab = useCallback<OpenPageTabHandler>(async (projectId, pageId, titleSnapshot, options) => {
    if (!activeSession || activeSession.projectId === null) {
      openPageStage(projectId, pageId, titleSnapshot, options);
      return;
    }
    const sessionProjectId = activeSession.projectId;

    const existing = activeSession.tabs.find((tab) =>
      tab.kind === "page_stage"
      && tab.panelId === "right"
      && "pageId" in tab.config
      && tab.config.pageId === pageId
      && tab.config.projectId === projectId,
    );
    if (existing) {
      const existingLeafId = resolveLeafIdForPanelTab(activeSession, "right", existing.id);
      clearPanelPreviewTab(activeSession.id, "right", existingLeafId);
      await updateActivePanel("right", { collapsed: false });
      await setActivePanelTab("right", existing.id, { leafId: existingLeafId, openPanel: true });
      return;
    }

    const sourceLeafId = resolveDbCardSourceLeafId(activeSession, options?.sourceTabId);
    const placement = resolveRightNeighborPanelPlacement(
      activeSession.panels.right.layout,
      sourceLeafId,
      {
        fullWidth: rightPanelFullWidth,
      },
    );
    let targetLeafId = placement.kind === "existing"
      ? placement.leafId
      : undefined;
    if (placement.kind === "ensure") {
      targetLeafId =
        panelControllerRef.current.durable.ensureLeafToRight(
          activeSession,
          {
            panelId: "right",
            leafId: placement.sourceLeafId,
          },
        );
    }
    const previewLeafId = targetLeafId ?? resolveSessionPanelActiveLeafId(activeSession, "right");
    const matchingPreviewTab = getRenderablePanelPreviewTab(activeSession, "right", previewLeafId, previewTabsByPanel);
    if (
      options?.openMode !== "preview"
      && matchingPreviewTab?.kind === "page_stage"
      && "pageId" in matchingPreviewTab.config
      && matchingPreviewTab.config.pageId === pageId
      && matchingPreviewTab.config.projectId === projectId
    ) {
      await pinPreviewTab("right", matchingPreviewTab.id, previewLeafId);
      return;
    }

    if (options?.openMode === "preview") {
      panelControllerRef.current.updatePreviewTabsByPanel((current) => ({
        ...current,
        [makeWorkbenchSessionPanelSlotKey(activeSession.id, "right", previewLeafId)]: makePreviewPageStageTab(
          activeSession,
          "right",
          { projectId, pageId, titleSnapshot },
        ),
      }));
      await ensureActivePanelOpenWithoutRefresh("right");
      await refreshProjectSessions(sessionProjectId);
      return;
    }

    createSessionViewTab({
      sessionId: activeSession.id,
      panelId: "right",
      ...(targetLeafId ? { targetLeafId } : {}),
      kind: "page_stage",
      title: titleSnapshot || pageId,
      config: {
        projectId,
        pageId: pageId,
        titleSnapshot,
      },
    });
    await ensureActivePanelOpenWithoutRefresh("right");
  }, [
    activeSession,
    clearPanelPreviewTab,
    ensureActivePanelOpenWithoutRefresh,
    createSessionViewTab,
    openPageStage,
    pinPreviewTab,
    previewTabsByPanel,
    refreshProjectSessions,
    rightPanelFullWidth,
    setActivePanelTab,
    updateActivePanel,
  ]);

  const openCanvasStage = useCallback<OpenCanvasStageHandler>(async (
    projectId,
    canvasBlockId,
    titleSnapshot,
    options,
  ) => {
    if (!activeSession || activeSession.projectId === null) return false;

    const existing = findCanvasStageTab(
      activeSession,
      projectId,
      canvasBlockId,
    );
    if (existing) {
      const existingLeafId = resolveLeafIdForPanelTab(
        activeSession,
        existing.panelId,
        existing.id,
      );
      clearPanelPreviewTab(
        activeSession.id,
        existing.panelId,
        existingLeafId,
      );
      await setActivePanelTab(existing.panelId, existing.id, {
        leafId: existingLeafId,
        openPanel: true,
      });
      return true;
    }

    const panelId = options?.targetPanelId ?? "right";
    const leafId = options?.targetLeafId
      ?? resolveSessionPanelActiveLeafId(activeSession, panelId);
    clearPanelPreviewTab(activeSession.id, panelId, leafId);
    const created = createSessionViewTab({
      sessionId: activeSession.id,
      panelId,
      targetLeafId: leafId,
      kind: "canvas_stage",
      title: titleSnapshot?.trim() || "Canvas",
      config: {
        projectId,
        canvasBlockId,
        ...(titleSnapshot?.trim()
          ? { titleSnapshot: titleSnapshot.trim() }
          : {}),
      },
    });
    if (!created) return false;

    await setActivePanelTab(panelId, created.id, {
      leafId,
      openPanel: true,
    });
    return true;
  }, [
    activeSession,
    clearPanelPreviewTab,
    createSessionViewTab,
    setActivePanelTab,
  ]);

  useEffect(() => {
    if (!pendingPageDeepLinkOpen) return;
    if (pendingPageDeepLinkOpen.projectId !== activeProjectId) return;

    let cancelled = false;
    void (async () => {
      await openPageTab(
        pendingPageDeepLinkOpen.projectId,
        pendingPageDeepLinkOpen.pageId,
        undefined,
        {
          openMode: "durable",
        },
      );
      if (cancelled) return;
      onPageDeepLinkHandled?.(pendingPageDeepLinkOpen);
    })();

    return () => {
      cancelled = true;
    };
  }, [
    activeProjectId,
    onPageDeepLinkHandled,
    openPageTab,
    pendingPageDeepLinkOpen,
  ]);

  return {
    openSideChat,
    openExistingSideChat,
    openMcpAppSidePanel,
    openPlanSidePanel,
    openAutomationSidePanel,
    recreateSideChatPanelTab,
    openPreviewTab,
    openWorkspaceFileTab,
    openPageTab,
    openCanvasStage,
  };
}
