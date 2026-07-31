import {
  findNearestWorkbenchPanelLeafToRight,
  findWorkbenchPanelLeaf,
  findWorkbenchPanelLeafForTab,
  getWorkbenchPanelActiveLeaf,
  listWorkbenchPanelLeaves,
  type WorkbenchPanelLayout,
} from "../../shared/workbench-panel-layout";
import type {
  PanelId,
  WorkbenchTabProjection,
} from "@/lib/types";
import type { WorkbenchSessionRenderProjection } from "@/lib/workbench-session-presentation";

export type RightNeighborPanelPlacement =
  | { readonly kind: "fallback" }
  | { readonly kind: "existing"; readonly leafId: string }
  | { readonly kind: "ensure"; readonly sourceLeafId: string };

export function resolveRightNeighborPanelPlacement(
  layout: WorkbenchPanelLayout,
  sourceLeafId: string | null,
  options: {
    readonly fullWidth: boolean;
  },
): RightNeighborPanelPlacement {
  if (!sourceLeafId) return { kind: "fallback" };
  if (!findWorkbenchPanelLeaf(layout, sourceLeafId)) {
    return { kind: "fallback" };
  }

  const existingLeafId = findNearestWorkbenchPanelLeafToRight(
    layout,
    sourceLeafId,
  );
  if (existingLeafId) return { kind: "existing", leafId: existingLeafId };
  if (!options.fullWidth) {
    return { kind: "fallback" };
  }
  if (listWorkbenchPanelLeaves(layout).length !== 1) {
    return { kind: "fallback" };
  }
  return { kind: "ensure", sourceLeafId };
}

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

export function readCanvasStagePanelTabCanvasRef(
  tab: WorkbenchTabProjection | null | undefined,
): { projectId: string; canvasBlockId: string } | null {
  if (!tab || tab.kind !== "canvas_stage") return null;

  return {
    projectId: tab.config.projectId,
    canvasBlockId: tab.config.canvasBlockId,
  };
}
