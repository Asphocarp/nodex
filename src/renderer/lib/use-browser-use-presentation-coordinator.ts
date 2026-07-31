import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
} from "react";
import {
  matchesBrowserSidebarTabIdentity,
  type BrowserUsePageClosedEvent,
  type BrowserUsePresentationRequest,
  type BrowserUsePresentationResult,
} from "../../shared/browser-sidebar";
import {
  findWorkbenchPanelLeaf,
  findWorkbenchPanelLeafForTab,
} from "../../shared/workbench-panel-layout";
import {
  consumeBrowserUsePresentationRequest,
  useBrowserSidebarRendererState,
} from "@/features/browser-sidebar/browser-sidebar-renderer-state-store";
import { invoke } from "./api";
import {
  buildBrowserUseWorkbenchTabCreateInput,
  findWorkbenchBrowserTabByRuntimeId,
} from "./browser-use-presentation-model";
import { workbenchSurfaceFromCreateInput } from "./workbench-scene-presentation";
import {
  resolveLeafIdForPanelTab,
  resolveSessionPanelActiveLeafId,
} from "./workbench-panel-placement";
import { resolveWorkbenchPanelSlotLeafId } from "./workbench-panel-slot-key";
import type {
  WorkbenchPanelController,
  WorkbenchSceneDurablePanelCommands,
} from "./use-workbench-panel-controller";
import type {
  WorkbenchSessionCatalog,
} from "./use-workbench-session-catalog";
import type {
  WorkbenchSessionRenderProjection,
} from "./workbench-session-presentation";
import type {
  PanelId,
  WorkbenchTabCreateInput,
  WorkbenchTabProjection,
} from "./types";
import type {
  WorkbenchSceneOwner,
  WorkbenchSceneSnapshot,
  WorkbenchSurfaceDescriptor,
} from "../../shared/workbench-scene";

export interface BrowserUseProjectScenePresentation {
  readonly browserConversationId: string;
  readonly commands: WorkbenchSceneDurablePanelCommands;
  readonly owner: WorkbenchSceneOwner;
  readonly projectId: string;
  readonly scene: WorkbenchSceneSnapshot;
}

interface BrowserUsePresentationCoordinatorInput {
  readonly activeSession: WorkbenchSessionRenderProjection | null;
  readonly projectScene?: BrowserUseProjectScenePresentation | null;
  readonly catalog: Pick<
    WorkbenchSessionCatalog,
    "findById" | "prefetch" | "resolveScene" | "select"
  >;
  readonly controller: WorkbenchPanelController;
  readonly createSessionViewTab: (
    input: WorkbenchTabCreateInput,
  ) => WorkbenchTabProjection | null;
  readonly pinPreviewTab: (
    panelId: PanelId,
    tabId: string,
    leafId?: string,
  ) => Promise<void>;
  readonly setActivePanelCollapsed: (
    panelId: PanelId,
    collapsed: boolean,
  ) => Promise<unknown>;
  readonly setActivePanelTab: (
    panelId: PanelId,
    tabId: string,
    options?: {
      leafId?: string;
      openPanel?: boolean;
    },
  ) => Promise<void>;
  readonly windowSessionId: string;
}

export interface BrowserUsePresentationCoordinator {
  presentBrowserTab(browserTabId: string): Promise<void>;
}

export function useBrowserUsePresentationCoordinator({
  activeSession,
  projectScene = null,
  catalog,
  controller,
  createSessionViewTab,
  pinPreviewTab,
  setActivePanelCollapsed,
  setActivePanelTab,
  windowSessionId,
}: BrowserUsePresentationCoordinatorInput): BrowserUsePresentationCoordinator {
  const runtime = useBrowserSidebarRendererState();
  const pendingRequestsRef =
    useRef(new Map<string, BrowserUsePresentationRequest>());
  const resolvingRequestsRef = useRef(new Set<string>());

  const respond = useCallback(async (
    request: BrowserUsePresentationRequest,
    outcome: BrowserUsePresentationResult["outcome"],
    message?: string,
  ) => {
    consumeBrowserUsePresentationRequest(request.requestId);
    pendingRequestsRef.current.delete(request.requestId);
    resolvingRequestsRef.current.delete(request.requestId);
    await invoke("browser-sidebar-command", {
      type: "browser-use-resolve-presentation",
      result: {
        browserConversationId: request.browserConversationId,
        browserViewScopeId: request.browserViewScopeId,
        browserTabId: request.browserTabId,
        requestId: request.requestId,
        outcome,
        ...(message ? { message: message.slice(0, 1_024) } : {}),
      },
    }).catch(() => undefined);
  }, []);

  const presentInActiveSession = useCallback(async (
    request: BrowserUsePresentationRequest,
    acknowledgeRequest = true,
  ) => {
    const finish = async (
      outcome: BrowserUsePresentationResult["outcome"],
      message?: string,
    ) => {
      if (!acknowledgeRequest) return;
      await respond(request, outcome, message);
    };
    if (
      !activeSession
      || activeSession.id !== request.browserConversationId
    ) {
      pendingRequestsRef.current.set(request.requestId, request);
      return;
    }

    const existing = findWorkbenchBrowserTabByRuntimeId(
      activeSession.tabs,
      request.browserTabId,
    );
    if (!request.visible) {
      if (existing) {
        const leafId = resolveLeafIdForPanelTab(
          activeSession,
          existing.panelId,
          existing.id,
        );
        const leaf = findWorkbenchPanelLeaf(
          activeSession.panels[existing.panelId].layout,
          leafId,
        );
        if (leaf?.activeTabId === existing.id) {
          await setActivePanelCollapsed(existing.panelId, true);
        }
      }
      await finish("accepted");
      return;
    }

    if (existing) {
      await setActivePanelTab(existing.panelId, existing.id, {
        leafId: resolveLeafIdForPanelTab(
          activeSession,
          existing.panelId,
          existing.id,
        ),
        openPanel: true,
      });
      await finish("accepted");
      return;
    }

    const previewEntry = Object.entries(
      controller.previewTabsByPanel,
    ).find(([, tab]) =>
      tab.sessionId === activeSession.id
      && tab.kind === "browser"
      && tab.browserTabId === request.browserTabId
    ) ?? null;
    if (previewEntry) {
      const preview = previewEntry[1];
      const previewLeafId = resolveWorkbenchPanelSlotLeafId(
        previewEntry[0],
        activeSession.id,
        preview.panelId,
      );
      await pinPreviewTab(
        preview.panelId,
        preview.id,
        previewLeafId ?? undefined,
      );
      await setActivePanelTab(preview.panelId, preview.id, {
        ...(previewLeafId ? { leafId: previewLeafId } : {}),
        openPanel: true,
      });
      await finish("accepted");
      return;
    }

    const snapshot = runtime.state.tabs.find((tab) =>
      matchesBrowserSidebarTabIdentity(tab, request)
    ) ?? null;
    const targetLeafId = resolveSessionPanelActiveLeafId(
      activeSession,
      "right",
    );
    const created = createSessionViewTab(
      buildBrowserUseWorkbenchTabCreateInput({
        request,
        sessionId: activeSession.id,
        snapshot,
        targetLeafId,
      }),
    );
    if (!created) {
      await finish("unavailable", "Browser tab could not be created");
      return;
    }
    await setActivePanelTab("right", created.id, {
      leafId: targetLeafId,
      openPanel: true,
    });
    await finish("accepted");
  }, [
    activeSession,
    controller.previewTabsByPanel,
    createSessionViewTab,
    pinPreviewTab,
    respond,
    runtime.state.tabs,
    setActivePanelCollapsed,
    setActivePanelTab,
  ]);

  const ensureProjectBrowserSurface = useCallback((
    request: BrowserUsePresentationRequest,
    activate: boolean,
  ): WorkbenchSurfaceDescriptor | null => {
    if (
      !projectScene
      || projectScene.browserConversationId !== request.browserConversationId
    ) {
      return null;
    }
    const existing = Object.values(projectScene.scene.panelSurfacesById).find(
      (surface) => surface.kind === "browser"
        && surface.config.browserTabId === request.browserTabId,
    ) ?? null;
    if (existing) {
      if (!activate) return existing;
      const panelId = (["right", "bottom"] as const).find((candidate) =>
        findWorkbenchPanelLeafForTab(
          projectScene.scene.panels[candidate].layout,
          existing.id,
        )
      ) ?? null;
      if (!panelId) return null;
      const leaf = findWorkbenchPanelLeafForTab(
        projectScene.scene.panels[panelId].layout,
        existing.id,
      );
      if (!leaf) return null;
      projectScene.commands.activateSurface(
        projectScene.owner,
        panelId,
        leaf.id,
        existing.id,
      );
      projectScene.commands.patchPanel(
        projectScene.owner,
        panelId,
        { collapsed: false },
      );
      return existing;
    }

    const snapshot = runtime.state.tabs.find((tab) =>
      matchesBrowserSidebarTabIdentity(tab, request)
    ) ?? null;
    const rootLeaf = findWorkbenchPanelLeafForTab(
      projectScene.scene.panels.right.layout,
      projectScene.scene.primary.id,
    );
    const createInput = buildBrowserUseWorkbenchTabCreateInput({
      request,
      sessionId: projectScene.browserConversationId,
      snapshot,
      targetLeafId:
        rootLeaf?.id
        ?? projectScene.scene.panels.right.layout.activeLeafId
        ?? undefined,
    });
    const surface = workbenchSurfaceFromCreateInput(createInput);
    const nextScene = projectScene.commands.createSurface(
      projectScene.owner,
      {
        panelId: "right",
        targetLeafId: createInput.targetLeafId,
        surface,
      },
    );
    if (!activate) return surface;
    const leaf = findWorkbenchPanelLeafForTab(
      nextScene.panels.right.layout,
      surface.id,
    );
    if (!leaf) return null;
    projectScene.commands.activateSurface(
      projectScene.owner,
      "right",
      leaf.id,
      surface.id,
    );
    projectScene.commands.patchPanel(
      projectScene.owner,
      "right",
      { collapsed: false },
    );
    return surface;
  }, [projectScene, runtime.state.tabs]);

  const presentInProjectScene = useCallback(async (
    request: BrowserUsePresentationRequest,
  ) => {
    if (!projectScene) return false;
    if (projectScene.browserConversationId !== request.browserConversationId) {
      return false;
    }
    if (!request.visible) {
      const existing = Object.values(
        projectScene.scene.panelSurfacesById,
      ).find((surface) => surface.kind === "browser"
        && surface.config.browserTabId === request.browserTabId) ?? null;
      if (existing) {
        const leaf = findWorkbenchPanelLeafForTab(
          projectScene.scene.panels.right.layout,
          existing.id,
        );
        const rootLeaf = findWorkbenchPanelLeafForTab(
          projectScene.scene.panels.right.layout,
          projectScene.scene.primary.id,
        );
        if (
          leaf
          && rootLeaf
          && leaf.id === rootLeaf.id
          && leaf.activeTabId === existing.id
        ) {
          projectScene.commands.activateSurface(
            projectScene.owner,
            "right",
            leaf.id,
            projectScene.scene.primary.id,
          );
        }
      }
      await respond(request, "accepted");
      return true;
    }
    const presented = ensureProjectBrowserSurface(request, true);
    if (!presented) {
      await respond(request, "unavailable", "Browser tab could not be created");
      return true;
    }
    await respond(request, "accepted");
    return true;
  }, [ensureProjectBrowserSurface, projectScene, respond]);

  const prepareInactiveSession = useEffectEvent((
    request: BrowserUsePresentationRequest,
    presentation: ReturnType<WorkbenchSessionCatalog["findById"]>,
  ) => {
    if (!request.visible || !presentation) return;
    const existing = Object.values(presentation.scene.panelSurfacesById).find((tab) =>
      tab.kind === "browser"
      && tab.config.browserTabId === request.browserTabId
    ) ?? null;
    if (existing) {
      const panelId = (["right", "bottom"] as const).find((candidate) =>
        findWorkbenchPanelLeafForTab(
          presentation.scene.panels[candidate].layout,
          existing.id,
        )
      ) ?? null;
      if (!panelId) return;
      const leaf = findWorkbenchPanelLeafForTab(
        presentation.scene.panels[panelId].layout,
        existing.id,
      );
      if (!leaf) return;
      controller.durable.activateTab(
        presentation.domain,
        panelId,
        leaf.id,
        existing.id,
      );
      controller.durable.patchPanel(
        presentation.domain,
        panelId,
        { collapsed: false },
      );
      return;
    }

    const snapshot = runtime.state.tabs.find((tab) =>
      matchesBrowserSidebarTabIdentity(tab, request)
    ) ?? null;
    const createInput = buildBrowserUseWorkbenchTabCreateInput({
      request,
      sessionId: presentation.domain.id,
      snapshot,
      targetLeafId:
        presentation.scene.panels.right.layout.activeLeafId ?? undefined,
    });
    controller.durable.createTab(presentation.domain, {
      panelId: "right",
      targetLeafId: createInput.targetLeafId,
      tab: workbenchSurfaceFromCreateInput(createInput),
    });
    controller.durable.patchPanel(
      presentation.domain,
      "right",
      { collapsed: false },
    );
  });

  const handleRequest = useEffectEvent(async (
    request: BrowserUsePresentationRequest,
  ) => {
    if (request.browserViewScopeId !== windowSessionId) {
      await respond(request, "stale", "Browser window scope is no longer active");
      return;
    }
    if (resolvingRequestsRef.current.has(request.requestId)) return;
    resolvingRequestsRef.current.add(request.requestId);

    if (
      !request.visible
      && projectScene?.browserConversationId !== request.browserConversationId
      && activeSession?.id !== request.browserConversationId
    ) {
      await respond(request, "accepted");
      return;
    }
    if (await presentInProjectScene(request)) return;
    if (activeSession?.id === request.browserConversationId) {
      await presentInActiveSession(request);
      return;
    }

    pendingRequestsRef.current.set(request.requestId, request);
    const known = catalog.findById(request.browserConversationId);
    if (known) {
      prepareInactiveSession(request, known);
      catalog.select(known);
      return;
    }
    const session = await catalog.prefetch(request.browserConversationId);
    if (!session) {
      await respond(request, "unavailable", "Owning Browser task is unavailable");
      return;
    }
    prepareInactiveSession(request, {
      domain: session,
      scene: catalog.resolveScene(session),
    });
    catalog.select(session);
  });

  useEffect(() => {
    for (const request of runtime.presentationRequests) {
      void handleRequest(request);
    }
  }, [runtime.presentationRequests]);

  useEffect(() => {
    if (!activeSession) return;
    for (const request of pendingRequestsRef.current.values()) {
      if (request.browserConversationId !== activeSession.id) continue;
      pendingRequestsRef.current.delete(request.requestId);
      resolvingRequestsRef.current.delete(request.requestId);
      void handleRequest(request);
    }
  }, [activeSession]);

  const removeClosedPage = useEffectEvent((event: BrowserUsePageClosedEvent) => {
    if (event.browserViewScopeId !== windowSessionId) return;
    if (projectScene?.browserConversationId === event.browserConversationId) {
      const surface = Object.values(projectScene.scene.panelSurfacesById).find(
        (candidate) => candidate.kind === "browser"
          && candidate.config.browserTabId === event.browserTabId,
      );
      if (surface) {
        projectScene.commands.removeSurface(projectScene.owner, surface.id);
      }
      return;
    }
    if (activeSession?.id === event.browserConversationId) {
      const tab = findWorkbenchBrowserTabByRuntimeId(
        activeSession.tabs,
        event.browserTabId,
      );
      if (!tab) return;
      controller.durable.removeTab(activeSession, tab.id);
      return;
    }
    const presentation = catalog.findById(event.browserConversationId);
    if (!presentation) return;
    const tab = Object.values(presentation.scene.panelSurfacesById).find((candidate) =>
      candidate.kind === "browser"
      && candidate.config.browserTabId === event.browserTabId
    );
    if (!tab) return;
    controller.durable.removeTab(presentation.domain, tab.id);
  });

  const retainReleasedPage = useEffectEvent((
    identity: Pick<
      BrowserUsePresentationRequest,
      | "browserConversationId"
      | "browserViewScopeId"
      | "browserTabId"
    >,
  ) => {
    if (identity.browserViewScopeId !== windowSessionId) return;
    const snapshot = runtime.state.tabs.find((tab) =>
      matchesBrowserSidebarTabIdentity(tab, identity)
    ) ?? null;
    if (projectScene?.browserConversationId === identity.browserConversationId) {
      const runtimeTab = runtime.browserUseState.tabs.find((tab) =>
        matchesBrowserSidebarTabIdentity(tab, identity)
      ) ?? null;
      if (!runtimeTab) return;
      ensureProjectBrowserSurface({
        ...identity,
        requestId: `release:${identity.browserTabId}`,
        codexSessionId: runtimeTab.codexSessionId,
        projectId: projectScene.projectId,
        visible: false,
        transition: "default",
        source: "browser-use",
      }, false);
      return;
    }
    if (activeSession?.id === identity.browserConversationId) {
      if (
        findWorkbenchBrowserTabByRuntimeId(
          activeSession.tabs,
          identity.browserTabId,
        )
      ) {
        return;
      }
      createSessionViewTab(buildBrowserUseWorkbenchTabCreateInput({
        request: {
          ...identity,
          requestId: `release:${identity.browserTabId}`,
          codexSessionId:
            activeSession.thread?.threadId ?? activeSession.id,
          projectId: activeSession.projectId,
          visible: false,
          transition: "default",
          source: "browser-use",
        },
        sessionId: activeSession.id,
        snapshot,
      }));
      return;
    }

    const presentation = catalog.findById(identity.browserConversationId);
    if (!presentation) return;
    const existing = Object.values(presentation.scene.panelSurfacesById).some((tab) =>
      tab.kind === "browser"
      && tab.config.browserTabId === identity.browserTabId
    );
    if (existing) return;
    const createInput = buildBrowserUseWorkbenchTabCreateInput({
      request: {
        ...identity,
        requestId: `release:${identity.browserTabId}`,
        codexSessionId:
          presentation.domain.thread?.threadId ?? presentation.domain.id,
        projectId: presentation.domain.projectId,
        visible: false,
        transition: "none",
        source: "browser-use",
      },
      sessionId: presentation.domain.id,
      snapshot,
      targetLeafId: presentation.scene.panels.right.layout.activeLeafId,
    });
    controller.durable.createTab(presentation.domain, {
      panelId: "right",
      targetLeafId: createInput.targetLeafId,
      tab: workbenchSurfaceFromCreateInput(createInput),
    });
  });

  useEffect(() => {
    const unsubscribeClosed = window.api?.on(
      "browser-sidebar-browser-use-page-closed",
      (payload) => {
        removeClosedPage(payload as BrowserUsePageClosedEvent);
      },
    );
    const unsubscribeReleased = window.api?.on(
      "browser-sidebar-browser-use-page-released",
      (payload) => {
        retainReleasedPage(
          payload as BrowserUsePresentationRequest,
        );
      },
    );
    return () => {
      unsubscribeClosed?.();
      unsubscribeReleased?.();
    };
  }, []);

  const presentBrowserTab = useCallback(async (browserTabId: string) => {
    if (!activeSession) return;
    const request: BrowserUsePresentationRequest = {
      browserConversationId: activeSession.id,
      browserViewScopeId: windowSessionId,
      browserTabId,
      requestId:
        globalThis.crypto?.randomUUID?.()
        ?? `summary-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      codexSessionId: activeSession.thread?.threadId ?? activeSession.id,
      projectId: activeSession.projectId,
      visible: true,
      transition: "default",
      source: "browser-use",
    };
    await presentInActiveSession(request, false);
  }, [activeSession, presentInActiveSession, windowSessionId]);

  return { presentBrowserTab };
}
