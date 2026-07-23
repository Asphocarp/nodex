import {
  findWorkbenchPanelLeafForTab,
  getWorkbenchPanelActiveLeaf,
  listWorkbenchPanelLeaves,
} from "../../shared/workbench-panel-layout";
import type { CodexForkBrowserSidePanelSnapshot } from "../../shared/codex-fork-browser-transfer";
import type {
  PanelId,
  ProjectSession,
  WorkbenchPanelState,
  ProjectSessionSummary,
  WorkbenchTabProjection,
  WorkbenchTabCreateInput,
  WorkbenchTabUpdateInput,
} from "../../shared/types";
import {
  activateWorkbenchSessionViewTab,
  createWorkbenchSessionViewTab,
  materializeInitialWorkbenchSessionView,
  patchWorkbenchSessionViewPanel,
  type WorkbenchSessionViewSnapshot,
  type WorkbenchSessionViewTab,
} from "../../shared/workbench-session-view";

export type WindowLocalProjectSession = ProjectSession & {
  panels: Record<PanelId, WorkbenchPanelState>;
  tabs: WorkbenchTabProjection[];
};

function resourceProjectId(
  session: ProjectSession,
  tab: WorkbenchSessionViewTab,
): string | null {
  return "projectId" in tab.config ? tab.config.projectId : session.projectId;
}

function projectTabConfig(
  tab: WorkbenchSessionViewTab,
): WorkbenchTabProjection["config"] {
  if (tab.kind !== "browser") return tab.config;
  return {
    projectId: null,
    ...(tab.config.url ? { url: tab.config.url } : {}),
    ...(tab.config.title ? { title: tab.config.title } : {}),
    ...(tab.config.faviconUrl ? { faviconUrl: tab.config.faviconUrl } : {}),
    ...(tab.config.deviceToolbarVisible === undefined
      ? {}
      : { deviceToolbarVisible: tab.config.deviceToolbarVisible }),
  };
}

export function projectSessionWithWorkbenchView(
  session: ProjectSession,
  view: WorkbenchSessionViewSnapshot,
): WindowLocalProjectSession {
  const timestamp = view.touchedAt;
  const tabs = (["right", "bottom"] as const).flatMap((panelId) =>
    listWorkbenchPanelLeaves(view.panels[panelId].layout)
      .flatMap((leaf) => leaf.tabIds)
      .map((tabId, order) => {
        const tab = view.tabsById[tabId];
        if (!tab) return null;
        const base = {
          id: tab.id,
          sessionId: session.id,
          projectId: resourceProjectId(session, tab),
          panelId,
          title: tab.titleSnapshot,
          order,
          stateKey: tab.stateKey,
          state: tab.state,
          createdAt: timestamp,
          updatedAt: timestamp,
          kind: tab.kind,
          config: projectTabConfig(tab),
        };
        return tab.kind === "browser"
          ? { ...base, browserTabId: tab.config.browserTabId }
          : { ...base, browserTabId: null };
      })
      .filter((tab): tab is WorkbenchTabProjection => Boolean(tab))
  );
  return {
    ...session,
    panels: view.panels,
    tabs,
  };
}

export function workbenchViewFromProjectSessionProjection(
  session: WindowLocalProjectSession,
): WorkbenchSessionViewSnapshot {
  const tabsById = Object.fromEntries(session.tabs.map((tab) => {
    const common = {
      id: tab.id,
      titleSnapshot: tab.title,
      stateKey: tab.stateKey,
      state: tab.state,
    };
    if (tab.kind === "browser") {
      return [tab.id, {
        ...common,
        kind: tab.kind,
        config: {
          browserTabId: tab.browserTabId,
          ...(tab.config.url ? { url: tab.config.url } : {}),
          ...(tab.config.title ? { title: tab.config.title } : {}),
          ...(tab.config.faviconUrl ? { faviconUrl: tab.config.faviconUrl } : {}),
          ...(tab.config.deviceToolbarVisible === undefined
            ? {}
            : { deviceToolbarVisible: tab.config.deviceToolbarVisible }),
        },
      }];
    }
    return [tab.id, {
      ...common,
      kind: tab.kind,
      config: tab.config,
    }];
  }));
  return {
    version: 1,
    sessionId: session.id,
    tabsById,
    panels: session.panels,
    lastFocusedPanelId: null,
    touchedAt: session.updatedAt,
  } as WorkbenchSessionViewSnapshot;
}

export function materializeWorkbenchViewForProjectSession(
  session: ProjectSession | ProjectSessionSummary,
): WorkbenchSessionViewSnapshot {
  return materializeInitialWorkbenchSessionView({
    id: session.id,
    projectId: session.projectId,
    initialDatabaseViewId: session.initialDatabaseViewId,
  });
}

export function workbenchViewTabFromCreateInput(
  input: WorkbenchTabCreateInput,
): WorkbenchSessionViewTab | null {
  const id = input.clientTabId
    ?? `tab:${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`;
  const common = {
    id,
    titleSnapshot: input.title,
    stateKey: 0,
    state: null,
  };
  if (input.kind === "db_view") {
    if (!input.config.databaseViewId) return null;
    return {
      ...common,
      kind: input.kind,
      config: {
        ...input.config,
        databaseViewId: input.config.databaseViewId,
      },
    };
  }
  if (input.kind === "browser") {
    return {
      ...common,
      kind: input.kind,
      config: {
        browserTabId: input.browserTabId
          ?? `browser:${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`}`,
        ...(input.config.url ? { url: input.config.url } : {}),
        ...(input.config.title ? { title: input.config.title } : {}),
        ...(input.config.faviconUrl ? { faviconUrl: input.config.faviconUrl } : {}),
        ...(input.config.deviceToolbarVisible === undefined
          ? {}
          : { deviceToolbarVisible: input.config.deviceToolbarVisible }),
      },
    };
  }
  return {
    ...common,
    kind: input.kind,
    config: input.config,
  } as WorkbenchSessionViewTab;
}

export function applyWorkbenchViewTabPatch(
  tab: WorkbenchSessionViewTab,
  patch: WorkbenchTabUpdateInput,
): WorkbenchSessionViewTab {
  const common = {
    ...tab,
    ...(patch.title === undefined ? {} : { titleSnapshot: patch.title }),
    ...(patch.stateKey === undefined ? {} : { stateKey: patch.stateKey }),
    ...(!("state" in patch) ? {} : { state: patch.state }),
  };
  if (patch.config === undefined) return common;
  if (tab.kind === "browser") {
    const config = patch.config as WorkbenchTabProjection["config"];
    return {
      ...common,
      kind: "browser",
      config: {
        browserTabId: tab.config.browserTabId,
        ...("url" in config && config.url ? { url: config.url } : {}),
        ...("title" in config && config.title ? { title: config.title } : {}),
        ...("faviconUrl" in config && config.faviconUrl
          ? { faviconUrl: config.faviconUrl }
          : {}),
        ...("deviceToolbarVisible" in config
          && config.deviceToolbarVisible !== undefined
          ? { deviceToolbarVisible: config.deviceToolbarVisible }
          : {}),
      },
    };
  }
  return {
    ...common,
    config: patch.config,
  } as WorkbenchSessionViewTab;
}

export function findWorkbenchViewTabPlacement(
  view: WorkbenchSessionViewSnapshot,
  tabId: string,
): { panelId: PanelId; leafId: string } | null {
  for (const panelId of ["right", "bottom"] as const) {
    const leaf = findWorkbenchPanelLeafForTab(view.panels[panelId].layout, tabId);
    if (leaf) return { panelId, leafId: leaf.id };
  }
  return null;
}

export function applyForkBrowserTransferToWorkbenchView(
  view: WorkbenchSessionViewSnapshot,
  snapshot: CodexForkBrowserSidePanelSnapshot,
): WorkbenchSessionViewSnapshot {
  let next = view;
  for (const descriptor of snapshot.tabs) {
    const targetLeafId = getWorkbenchPanelActiveLeaf(
      next.panels[descriptor.panel].layout,
    ).id;
    next = createWorkbenchSessionViewTab(next, {
      panelId: descriptor.panel,
      targetLeafId,
      tab: {
        id: descriptor.tabId,
        kind: "browser",
        titleSnapshot: "Browser",
        config: {
          browserTabId: descriptor.browserTabId,
          ...(descriptor.initialUrl ? { url: descriptor.initialUrl } : {}),
          deviceToolbarVisible:
            descriptor.deviceToolbarState.toolbarState.isEnabled,
        },
        stateKey: 0,
        state: null,
      },
    });
    if (!descriptor.active) continue;
    next = activateWorkbenchSessionViewTab(
      next,
      descriptor.panel,
      targetLeafId,
      descriptor.tabId,
    );
  }

  next = patchWorkbenchSessionViewPanel(next, "right", {
    collapsed: !snapshot.rightPanelOpen,
    size: { fullWidth: snapshot.rightPanelFullWidth },
  });
  next = patchWorkbenchSessionViewPanel(next, "bottom", {
    collapsed: !snapshot.bottomPanelOpen,
  });
  return {
    ...next,
    lastFocusedPanelId: snapshot.focusArea === "right-panel"
      ? "right"
      : snapshot.focusArea === "bottom-panel"
        ? "bottom"
        : null,
  };
}
