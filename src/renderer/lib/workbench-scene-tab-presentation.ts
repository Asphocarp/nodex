import type { ComponentType } from "react";
import { MessageSquare } from "@/components/shared/icons/generic-icons";
import type { WorkbenchSurfaceDescriptor } from "../../shared/workbench-scene";
import { getPanelNewTabAction } from "./workbench-panel-actions";

export interface WorkbenchSceneTabPresentation {
  readonly title: string;
  readonly icon?: ComponentType<{ className?: string }>;
}

export function resolveWorkbenchSceneTabPresentation(
  surface: WorkbenchSurfaceDescriptor,
  isProjectHomeRoot: boolean,
): WorkbenchSceneTabPresentation {
  if (isProjectHomeRoot) return { title: "Project Home" };
  if (surface.kind === "conversation") {
    return { title: surface.titleSnapshot, icon: MessageSquare };
  }

  const action = getPanelNewTabAction(surface.kind);
  return {
    title: surface.kind === "db_view" ? action.label : surface.titleSnapshot,
    icon: action.Icon,
  };
}
