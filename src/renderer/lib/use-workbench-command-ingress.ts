import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
} from "react";
import type {
  WorkbenchNavigationCommandSource,
  WorkbenchNavigationDirection,
  WorkbenchPanelTabCycleDirection,
  WorkbenchSidebarToggleCommandSource,
  WorkbenchThreadRenameCommandSource,
} from "../../shared/window-navigation";
import type {
  WorkbenchCommandId,
  WorkbenchCommandInvocation,
  WorkbenchCommandSource,
} from "../../shared/workbench-commands";
import type {
  ContentSearchDomain,
  ContentSearchOpenSource,
} from "@/features/content-search/content-search-context";
import type { CommandMenuOpenRequest } from "./command-palette";

export interface WorkbenchCommandPort {
  readonly navigate: (
    direction: WorkbenchNavigationDirection,
    source: WorkbenchNavigationCommandSource,
  ) => void;
  readonly toggleSidebar: (
    source: WorkbenchSidebarToggleCommandSource,
  ) => void;
  readonly renameThread: (
    source: WorkbenchThreadRenameCommandSource,
  ) => void;
  readonly openContentSearch: (
    source: ContentSearchOpenSource,
    preferredDomain?: ContentSearchDomain,
  ) => void;
  readonly cyclePanelTab: (direction: WorkbenchPanelTabCycleDirection) => void;
  readonly closePanelTab: () => void;
  readonly execute: (
    commandId: WorkbenchCommandId,
    source: WorkbenchCommandSource,
  ) => void;
  readonly openCommandPalette: (request?: CommandMenuOpenRequest) => void;
  readonly toggleSettings: () => void;
  readonly openKeyboardShortcuts: () => void;
}

export interface WorkbenchCommandDispatcher extends WorkbenchCommandPort {
  readonly register: (port: WorkbenchCommandPort) => () => void;
}

export interface WorkbenchReminderOpenRequest {
  readonly projectId: string;
  readonly pageId: string;
  readonly occurrenceStart: string;
}

export interface WorkbenchPageDeepLinkRequest {
  readonly projectId: string;
  readonly pageId: string;
}

export interface WorkbenchSessionDeepLinkRequest {
  readonly projectId: string | null;
  readonly sessionId: string;
}

export interface WorkbenchViewDeepLinkRequest {
  readonly projectId: string;
  readonly viewId: string;
}

export interface WorkbenchExternalIngressHandlers {
  readonly onReminderOpen?: (
    request: WorkbenchReminderOpenRequest,
  ) => void;
  readonly onPageDeepLinkOpen?: (
    request: WorkbenchPageDeepLinkRequest,
  ) => void;
  readonly onSessionDeepLinkOpen?: (
    request: WorkbenchSessionDeepLinkRequest,
  ) => void;
  readonly onViewDeepLinkOpen?: (
    request: WorkbenchViewDeepLinkRequest,
  ) => void;
  readonly onRequestNewWindow?: () => void;
}

function parseReminderOpenRequest(
  value: unknown,
): WorkbenchReminderOpenRequest | null {
  if (!value || typeof value !== "object") return null;
  const request = value as Record<string, unknown>;
  if (typeof request.projectId !== "string") return null;
  if (typeof request.pageId !== "string") return null;
  if (typeof request.occurrenceStart !== "string") return null;
  return {
    projectId: request.projectId,
    pageId: request.pageId,
    occurrenceStart: request.occurrenceStart,
  };
}

function parsePageDeepLinkRequest(
  value: unknown,
): WorkbenchPageDeepLinkRequest | null {
  if (!value || typeof value !== "object") return null;
  const request = value as Record<string, unknown>;
  if (typeof request.projectId !== "string") return null;
  if (typeof request.pageId !== "string") return null;
  return {
    projectId: request.projectId,
    pageId: request.pageId,
  };
}

function parseSessionDeepLinkRequest(
  value: unknown,
): WorkbenchSessionDeepLinkRequest | null {
  if (!value || typeof value !== "object") return null;
  const request = value as Record<string, unknown>;
  if (
    typeof request.projectId !== "string"
    && request.projectId !== null
  ) {
    return null;
  }
  if (typeof request.sessionId !== "string") return null;
  return {
    projectId: request.projectId,
    sessionId: request.sessionId,
  };
}

function parseViewDeepLinkRequest(
  value: unknown,
): WorkbenchViewDeepLinkRequest | null {
  if (!value || typeof value !== "object") return null;
  const request = value as Record<string, unknown>;
  if (typeof request.projectId !== "string") return null;
  if (typeof request.viewId !== "string") return null;
  return {
    projectId: request.projectId,
    viewId: request.viewId,
  };
}

/**
 * The Window-scoped Adapter for every native Workbench ingress. Menu commands
 * go through the registered command port; reminder and deep-link payloads are
 * validated here before they cross into renderer-owned navigation.
 */
export function useWorkbenchCommandIngress(
  externalHandlers: WorkbenchExternalIngressHandlers = {},
): WorkbenchCommandDispatcher {
  const portRef = useRef<WorkbenchCommandPort | null>(null);

  const register = useCallback((port: WorkbenchCommandPort) => {
    portRef.current = port;
    return () => {
      if (portRef.current !== port) return;
      portRef.current = null;
    };
  }, []);

  const navigate = useCallback<WorkbenchCommandPort["navigate"]>(
    (direction, source) => portRef.current?.navigate(direction, source),
    [],
  );
  const toggleSidebar = useCallback<WorkbenchCommandPort["toggleSidebar"]>(
    (source) => portRef.current?.toggleSidebar(source),
    [],
  );
  const renameThread = useCallback<WorkbenchCommandPort["renameThread"]>(
    (source) => portRef.current?.renameThread(source),
    [],
  );
  const openContentSearch = useCallback<
    WorkbenchCommandPort["openContentSearch"]
  >(
    (source, preferredDomain) =>
      portRef.current?.openContentSearch(source, preferredDomain),
    [],
  );
  const cyclePanelTab = useCallback<WorkbenchCommandPort["cyclePanelTab"]>(
    (direction) => portRef.current?.cyclePanelTab(direction),
    [],
  );
  const closePanelTab = useCallback<WorkbenchCommandPort["closePanelTab"]>(
    () => portRef.current?.closePanelTab(),
    [],
  );
  const execute = useCallback<WorkbenchCommandPort["execute"]>(
    (commandId, source) => portRef.current?.execute(commandId, source),
    [],
  );
  const openCommandPalette = useCallback<
    WorkbenchCommandPort["openCommandPalette"]
  >(
    (request) => portRef.current?.openCommandPalette(request),
    [],
  );
  const toggleSettings = useCallback<WorkbenchCommandPort["toggleSettings"]>(
    () => portRef.current?.toggleSettings(),
    [],
  );
  const openKeyboardShortcuts = useCallback<
    WorkbenchCommandPort["openKeyboardShortcuts"]
  >(
    () => portRef.current?.openKeyboardShortcuts(),
    [],
  );
  const onReminderOpen = useEffectEvent((value: unknown) => {
    const request = parseReminderOpenRequest(value);
    if (!request) return;
    externalHandlers.onReminderOpen?.(request);
  });
  const onPageDeepLinkOpen = useEffectEvent((value: unknown) => {
    const request = parsePageDeepLinkRequest(value);
    if (!request) return;
    externalHandlers.onPageDeepLinkOpen?.(request);
  });
  const onSessionDeepLinkOpen = useEffectEvent((value: unknown) => {
    const request = parseSessionDeepLinkRequest(value);
    if (!request) return;
    externalHandlers.onSessionDeepLinkOpen?.(request);
  });
  const onViewDeepLinkOpen = useEffectEvent((value: unknown) => {
    const request = parseViewDeepLinkRequest(value);
    if (!request) return;
    externalHandlers.onViewDeepLinkOpen?.(request);
  });
  const onRequestNewWindow = useEffectEvent(() => {
    externalHandlers.onRequestNewWindow?.();
  });

  useEffect(() => window.api?.onNavigateBack?.(
    () => navigate("back", "menu"),
  ), [navigate]);
  useEffect(() => window.api?.onNavigateForward?.(
    () => navigate("forward", "menu"),
  ), [navigate]);
  useEffect(() => window.api?.onToggleSidebar?.(
    () => toggleSidebar("menu"),
  ), [toggleSidebar]);
  useEffect(() => window.api?.onRenameThread?.(
    () => renameThread("menu"),
  ), [renameThread]);
  useEffect(() => window.api?.onOpenContentSearch?.(
    () => openContentSearch("menu"),
  ), [openContentSearch]);
  useEffect(() => window.api?.onCyclePanelTabPrevious?.(
    () => cyclePanelTab("previous"),
  ), [cyclePanelTab]);
  useEffect(() => window.api?.onCyclePanelTabNext?.(
    () => cyclePanelTab("next"),
  ), [cyclePanelTab]);
  useEffect(() => window.api?.onClosePanelTab?.(
    closePanelTab,
  ), [closePanelTab]);
  useEffect(() => window.api?.onWorkbenchCommand?.(
    (invocation: WorkbenchCommandInvocation) =>
      execute(invocation.commandId, invocation.source),
  ), [execute]);
  useEffect(() => {
    if (!window.api?.on) return undefined;
    return window.api.on("reminder:open", (value: unknown) => {
      onReminderOpen(value);
    });
  }, []);
  useEffect(() => {
    if (!window.api?.on) return undefined;
    return window.api.on("deeplink:open-view", (value: unknown) => {
      onViewDeepLinkOpen(value);
    });
  }, []);
  useEffect(() => {
    if (!window.api?.on) return undefined;
    return window.api.on("deeplink:open-page", (value: unknown) => {
      onPageDeepLinkOpen(value);
    });
  }, []);
  useEffect(() => {
    if (!window.api?.on) return undefined;
    return window.api.on("deeplink:open-session", (value: unknown) => {
      onSessionDeepLinkOpen(value);
    });
  }, []);
  useEffect(() => window.api?.onRequestNewWindow?.(
    onRequestNewWindow,
  ), []);

  return useMemo(() => ({
    register,
    navigate,
    toggleSidebar,
    renameThread,
    openContentSearch,
    cyclePanelTab,
    closePanelTab,
    execute,
    openCommandPalette,
    toggleSettings,
    openKeyboardShortcuts,
  }), [
    closePanelTab,
    cyclePanelTab,
    execute,
    navigate,
    openCommandPalette,
    openContentSearch,
    openKeyboardShortcuts,
    register,
    renameThread,
    toggleSettings,
    toggleSidebar,
  ]);
}
