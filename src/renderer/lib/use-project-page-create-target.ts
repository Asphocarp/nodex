import { useEffect, useMemo, useState } from "react";
import type { Project } from "./types";
import type { BoardSummary } from "./types";
import type { DatabaseViewRenderModel } from "./database-view-render-model";
import type { ScopeHandle } from "./maitai";
import { materializePageCreateTarget } from "./page-create-target";
import {
  registerProjectDefaultPageCreateTarget,
  unregisterProjectDefaultPageCreateTarget,
  type PageCreateTarget,
  type PageCreateTargetCapability,
} from "./page-create-target-registry";

const PROJECT_DEFAULT_TARGET_SURFACE_PREFIX = "project-default-page-create";
const PROJECT_SCENE_PANEL_PREFIX = "project-scene";

export interface ProjectDefaultPageCreateCapabilityInput {
  readonly project: Project;
  readonly target: PageCreateTarget | null;
  readonly error: string | null;
}

export function resolveProjectDefaultPageCreateCapability({
  project,
  target,
  error,
}: ProjectDefaultPageCreateCapabilityInput): PageCreateTargetCapability {
  if (!project.defaultDatabaseViewId) {
    return {
      status: "unavailable",
      reason: "This Project has no active default Database View.",
    };
  }
  if (error) {
    return {
      status: "unavailable",
      reason: "Couldn’t prepare this Project’s default Database View.",
    };
  }
  if (!target) {
    return {
      status: "loading",
      reason: "Preparing this Project’s default Database View…",
    };
  }
  return { status: "ready", target };
}

export interface UseProjectPageCreateTargetInput {
  readonly appHandle: ScopeHandle;
  readonly project: Project | null;
  readonly board: BoardSummary | null;
  readonly databaseView: DatabaseViewRenderModel | null;
  readonly error: string | null;
  readonly clientSessionId: string;
}

/**
 * Registers the active Project's canonical default View as a low-priority
 * authoring target. The store subscription is owned by Workbench's existing
 * active-Project Kanban projection; this hook only projects readiness into the
 * window-scoped command capability registry.
 */
export function useProjectPageCreateTarget({
  appHandle,
  project,
  board,
  databaseView,
  error,
  clientSessionId,
}: UseProjectPageCreateTargetInput): void {
  const [registrationToken] = useState(() => crypto.randomUUID());
  const target = useMemo(() => {
    if (!project?.defaultDatabaseViewId) return null;
    return materializePageCreateTarget({
      surfaceId: `${PROJECT_DEFAULT_TARGET_SURFACE_PREFIX}:${project.id}:${project.defaultDatabaseViewId}`,
      panelTabId: `${PROJECT_SCENE_PANEL_PREFIX}:${project.id}`,
      project,
      databaseView,
      board,
      clientSessionId,
    });
  }, [board, clientSessionId, databaseView, project]);
  const capability = useMemo(() => project
    ? resolveProjectDefaultPageCreateCapability({ project, target, error })
    : null, [error, project, target]);

  useEffect(() => {
    if (!project || !capability) return undefined;
    registerProjectDefaultPageCreateTarget(
      appHandle,
      project.id,
      registrationToken,
      capability,
    );
    return () => {
      unregisterProjectDefaultPageCreateTarget(
        appHandle,
        project.id,
        registrationToken,
      );
    };
  }, [appHandle, capability, project, registrationToken]);
}
