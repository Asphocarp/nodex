import { ChevronRight, FileText, Shapes, Table2 } from "lucide-react";
import { AppShellHeaderContentRegistrar } from "@/lib/workbench-ui-scopes";
import { listWorkbenchPanelLeaves } from "../../../shared/workbench-panel-layout";
import type {
  WorkbenchSceneSnapshot,
  WorkbenchSurfaceDescriptor,
} from "../../../shared/workbench-scene";

function activeSceneSurface(
  scene: WorkbenchSceneSnapshot,
): WorkbenchSurfaceDescriptor {
  const panelId = scene.lastFocusedPanelId ?? "right";
  const panel = scene.panels[panelId];
  const activeLeaf = listWorkbenchPanelLeaves(panel.layout).find(
    (leaf) => leaf.id === panel.layout.activeLeafId,
  );
  const activeId = activeLeaf?.activeTabId;
  if (!activeId || activeId === scene.primary.id) return scene.primary;
  return scene.panelSurfacesById[activeId] ?? scene.primary;
}

export function ResourceSceneBreadcrumb({
  scene,
}: {
  readonly scene: WorkbenchSceneSnapshot;
}) {
  if (scene.owner.kind !== "resource") return null;
  const root = scene.owner.root;
  const Icon = root.kind === "page"
    ? FileText
    : root.kind === "database"
      ? Table2
      : Shapes;
  const rootTitle = scene.primary.titleSnapshot.trim()
    || (root.kind === "page"
      ? "Untitled"
      : root.kind === "database"
        ? "Database"
        : "Canvas");
  const active = activeSceneSurface(scene);
  const childTitle = active.id === scene.primary.id
    ? null
    : active.titleSnapshot.trim() || null;

  return (
    <AppShellHeaderContentRegistrar
      content={(
        <div className="no-drag flex h-full min-w-0 items-center gap-1.5 text-sm">
          <span className="shrink-0 text-token-text-secondary">Pages</span>
          <ChevronRight
            className="icon-2xs shrink-0 text-token-description-foreground"
            aria-hidden
          />
          <Icon
            className="icon-2xs shrink-0 text-token-text-secondary"
            aria-hidden
          />
          <span className="min-w-0 truncate text-token-text-primary">
            {rootTitle}
          </span>
          {childTitle ? (
            <>
              <ChevronRight
                className="icon-2xs shrink-0 text-token-description-foreground"
                aria-hidden
              />
              <span className="min-w-0 truncate text-token-text-secondary">
                {childTitle}
              </span>
            </>
          ) : null}
        </div>
      )}
    />
  );
}
