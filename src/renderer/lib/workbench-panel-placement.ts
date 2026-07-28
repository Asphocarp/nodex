import {
  findNearestWorkbenchPanelLeafToRight,
  findWorkbenchPanelLeafForTab,
  getWorkbenchPanelActiveLeaf,
  listWorkbenchPanelLeaves,
} from "../../shared/workbench-panel-layout";
import type {
  PanelId,
  WorkbenchTabProjection,
} from "@/lib/types";
import type { WorkbenchSessionRenderProjection } from "@/lib/workbench-session-presentation";

export function resolveSessionPanelActiveTabId(
  session: WorkbenchSessionRenderProjection,
  panelId: PanelId,
): string | null {
  const panel = session.panels[panelId];
  return getWorkbenchPanelActiveLeaf(panel.layout).activeTabId
    ?? session.tabs.find((tab) => tab.panelId === panelId)?.id
    ?? null;
}

export function resolveSessionPanelActiveLeafId(
  session: WorkbenchSessionRenderProjection,
  panelId: PanelId,
): string {
  return getWorkbenchPanelActiveLeaf(session.panels[panelId].layout).id;
}

export function resolveLeafIdForPanelTab(
  session: WorkbenchSessionRenderProjection,
  panelId: PanelId,
  tabId: string,
): string {
  return findWorkbenchPanelLeafForTab(session.panels[panelId].layout, tabId)?.id
    ?? resolveSessionPanelActiveLeafId(session, panelId);
}

export function resolveDbCardSourceLeafId(
  session: WorkbenchSessionRenderProjection,
  sourceTabId: string | undefined,
): string | null {
  if (!sourceTabId) return null;
  const sourceTab = session.tabs.find((tab) =>
    tab.id === sourceTabId
    && tab.panelId === "right"
    && tab.kind === "db_view"
  );
  if (!sourceTab) return null;
  const sourceLeafId = findWorkbenchPanelLeafForTab(
    session.panels.right.layout,
    sourceTab.id,
  )?.id;
  return sourceLeafId ?? null;
}

export function resolvePageTabTargetLeafId(
  session: WorkbenchSessionRenderProjection,
  sourceTabId: string | undefined,
): string | undefined {
  const sourceLeafId = resolveDbCardSourceLeafId(session, sourceTabId);
  if (!sourceLeafId) return undefined;
  return findNearestWorkbenchPanelLeafToRight(
    session.panels.right.layout,
    sourceLeafId,
  ) ?? undefined;
}

export function shouldEnsureRightLeafForDbCardOpen(
  session: WorkbenchSessionRenderProjection,
  sourceLeafId: string | null,
  rightPanelFullWidth: boolean,
): sourceLeafId is string {
  if (!sourceLeafId) return false;
  if (!rightPanelFullWidth) return false;
  if (findNearestWorkbenchPanelLeafToRight(session.panels.right.layout, sourceLeafId)) {
    return false;
  }
  return listWorkbenchPanelLeaves(session.panels.right.layout).length === 1;
}

export function readPageStagePanelTabPageRef(
  tab: WorkbenchTabProjection | null | undefined,
): { projectId: string; pageId: string } | null {
  if (!tab || tab.kind !== "page_stage") return null;
  if (!("projectId" in tab.config) || !("pageId" in tab.config)) return null;

  return {
    projectId: tab.config.projectId,
    pageId: tab.config.pageId,
  };
}
