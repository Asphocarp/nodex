import type { ReactNode } from "react";
import {
  isPanelActionTargetAllowed,
  type PanelNewTabAction,
} from "@/lib/workbench-panel-actions";
import { resolveWorkbenchSceneTabPresentation } from "@/lib/workbench-scene-tab-presentation";
import type {
  WorkbenchSceneDurablePanelCommands,
} from "@/lib/use-workbench-panel-controller";
import type { PanelId, Project } from "@/lib/types";
import type { CommandKeymapState } from "../../../shared/command-keybindings";
import {
  listWorkbenchPanelLeaves,
} from "../../../shared/workbench-panel-layout";
import {
  resolveWorkbenchSceneSurface,
  type WorkbenchSceneSnapshot,
  type WorkbenchSurfaceDescriptor,
} from "../../../shared/workbench-scene";
import type { AppShellTabItem } from "./app-shell-tabs";
import type { PanelDestination } from "./panel-destination-picker-model";
import { ProjectMarker } from "./project-marker";
import { WorkbenchPanelHost } from "./workbench-panel-host";

export interface WorkbenchScenePanelsProps {
  readonly scene: WorkbenchSceneSnapshot;
  readonly project: Project;
  readonly projects: Project[];
  readonly commands: WorkbenchSceneDurablePanelCommands;
  readonly isMac: boolean;
  readonly commandKeymapState?: CommandKeymapState | null;
  readonly availableActions: readonly PanelNewTabAction[];
  readonly currentProjectDbViewExists: boolean;
  readonly rightPanelHeaderAfterList: ReactNode;
  readonly rightPanelHeaderStartInsetWidth: number;
  readonly bottomPanelGlobalHeaderInsetWidth: number;
  readonly panelTabScrollEndPaddingPx: number;
  readonly renderSurface: (
    surface: WorkbenchSurfaceDescriptor,
    context: { readonly active: boolean; readonly panelId: PanelId },
  ) => ReactNode;
  readonly onOpenAction: (
    panelId: PanelId,
    leafId: string,
    action: PanelNewTabAction["kind"],
  ) => void;
  readonly onOpenDestination: (
    panelId: PanelId,
    leafId: string,
    destination: PanelDestination,
  ) => Promise<void>;
  readonly onCloseSurface?: (
    surface: WorkbenchSurfaceDescriptor,
  ) => Promise<boolean>;
}

function makePanelItems(
  scene: WorkbenchSceneSnapshot,
  project: Project,
  panelId: PanelId,
  renderSurface: WorkbenchScenePanelsProps["renderSurface"],
): {
  readonly itemsByLeafId: Record<string, AppShellTabItem[]>;
  readonly activeTabIdsByLeafId: Record<string, string | null>;
} {
  const itemsByLeafId: Record<string, AppShellTabItem[]> = {};
  const activeTabIdsByLeafId: Record<string, string | null> = {};
  for (const leaf of listWorkbenchPanelLeaves(scene.panels[panelId].layout)) {
    const surfaces = leaf.tabIds.flatMap((surfaceId) => {
      const surface = resolveWorkbenchSceneSurface(scene, surfaceId);
      return surface ? [surface] : [];
    });
    itemsByLeafId[leaf.id] = surfaces.map((surface) => {
      const isProjectHomeRoot = scene.owner.kind === "project"
        && surface.id === scene.primary.id
        && surface.kind === "db_view";
      const presentation = resolveWorkbenchSceneTabPresentation(
        surface,
        isProjectHomeRoot,
      );
      return {
        id: surface.id,
        title: presentation.title,
        icon: presentation.icon,
        iconElement: isProjectHomeRoot ? (
          <ProjectMarker
            appearance={project.appearance}
            className="size-4"
            data-project-home-tab-marker="true"
          />
        ) : undefined,
        closable: surface.id !== scene.primary.id,
        reorderable: surface.id !== scene.primary.id,
        splittable: surface.id !== scene.primary.id,
        renderPanel: (_close, context) => renderSurface(surface, {
          active: context.active,
          panelId,
        }),
      };
    });
    activeTabIdsByLeafId[leaf.id] =
      leaf.activeTabId && resolveWorkbenchSceneSurface(scene, leaf.activeTabId)
        ? leaf.activeTabId
        : surfaces[0]?.id ?? null;
  }
  return { itemsByLeafId, activeTabIdsByLeafId };
}

/** Durable panel chrome for any owner-scoped Scene. */
export function buildWorkbenchScenePanels({
  scene,
  project,
  projects,
  commands,
  isMac,
  commandKeymapState,
  availableActions,
  currentProjectDbViewExists,
  rightPanelHeaderAfterList,
  rightPanelHeaderStartInsetWidth,
  bottomPanelGlobalHeaderInsetWidth,
  panelTabScrollEndPaddingPx,
  renderSurface,
  onOpenAction,
  onOpenDestination,
  onCloseSurface,
}: WorkbenchScenePanelsProps) {
  const ownerKey = scene.owner.kind === "project"
    ? `project:${scene.owner.projectId}`
    : `session:${scene.owner.sessionId}`;

  const renderPanel = (panelId: PanelId) => {
    const projection = makePanelItems(scene, project, panelId, renderSurface);
    return (
      <WorkbenchPanelHost
        sessionId={ownerKey}
        sessionProjectId={project.id}
        panelId={panelId}
        layout={scene.panels[panelId].layout}
        tabItemsByLeafId={projection.itemsByLeafId}
        activeTabIdsByLeafId={projection.activeTabIdsByLeafId}
        availableActions={availableActions.filter((action) =>
          isPanelActionTargetAllowed(action, panelId)
        )}
        projects={projects}
        isMac={isMac}
        commandKeymapState={commandKeymapState}
        currentProjectDbViewExists={currentProjectDbViewExists}
        renderAfterList={panelId === "right"
          ? () => rightPanelHeaderAfterList
          : undefined}
        headerStartInsetPx={panelId === "right"
          ? rightPanelHeaderStartInsetWidth
          : undefined}
        headerEndInsetPx={panelId === "bottom"
          ? bottomPanelGlobalHeaderInsetWidth
          : undefined}
        tabScrollEndPaddingPx={panelTabScrollEndPaddingPx}
        commands={{
          selectTab: (leafId, surfaceId) => {
            commands.activateSurface(
              scene.owner,
              panelId,
              leafId,
              surfaceId,
            );
          },
          closeTab: (_leafId, surfaceId) => {
            const surface = resolveWorkbenchSceneSurface(scene, surfaceId);
            if (!surface) return;
            void (async () => {
              if (onCloseSurface && !await onCloseSurface(surface)) return;
              commands.removeSurface(scene.owner, surfaceId);
            })();
          },
          pinTab: () => undefined,
          reorderTab: (leafId, surfaceId, targetIndex) => {
            const leaf = listWorkbenchPanelLeaves(
              scene.panels[panelId].layout,
            ).find((candidate) => candidate.id === leafId);
            if (!leaf) return;
            const orderedSurfaceIds = [...leaf.tabIds];
            const sourceIndex = orderedSurfaceIds.indexOf(surfaceId);
            if (sourceIndex < 0) return;
            orderedSurfaceIds.splice(sourceIndex, 1);
            orderedSurfaceIds.splice(targetIndex, 0, surfaceId);
            commands.reorderSurfaces(scene.owner, {
              panelId,
              leafId,
              orderedSurfaceIds,
            });
          },
          moveTab: (
            surfaceId,
            targetPanelId,
            targetLeafId,
            targetIndex,
            splitTarget,
          ) => {
            commands.moveSurface(scene.owner, {
              surfaceId,
              targetPanelId,
              targetLeafId,
              targetIndex,
              splitTarget,
            });
          },
          splitGroup: (leafId, side, surfaceId) => {
            commands.splitLeaf(scene.owner, {
              panelId,
              leafId,
              side,
              surfaceId,
            });
          },
          focusGroup: (leafId) => {
            commands.activateSurface(scene.owner, panelId, leafId);
          },
          activateGroup: (leafId, surfaceId) => {
            commands.activateSurface(
              scene.owner,
              panelId,
              leafId,
              surfaceId,
            );
          },
          resizeGroup: (branchId, ratio) => {
            commands.resizeBranch(scene.owner, {
              panelId,
              branchId,
              ratio,
            });
          },
          openAction: (action, leafId) => {
            onOpenAction(panelId, leafId, action);
          },
          openDestination: async (destination, leafId) => {
            await onOpenDestination(panelId, leafId, destination);
          },
        }}
      />
    );
  };

  return {
    right: renderPanel("right"),
    bottom: renderPanel("bottom"),
  };
}
