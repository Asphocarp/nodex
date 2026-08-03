import {
  findWorkbenchPanelLeafForTab,
} from "../../shared/workbench-panel-layout";
import {
  activateWorkbenchSceneSurface,
  createWorkbenchSceneSurface,
  ensureWorkbenchSceneLeafToRight,
  getWorkbenchSurfaceReuseKey,
  materializeInitialWorkbenchScene,
  patchWorkbenchScenePanel,
  resolveWorkbenchSceneSurface,
  type WorkbenchBrowserSurfaceConfig,
  type WorkbenchCanvasStageSurfaceConfig,
  type WorkbenchDbViewSurfaceConfig,
  type WorkbenchFilesSurfaceConfig,
  type WorkbenchPageStageSurfaceConfig,
  type WorkbenchReviewSurfaceConfig,
  type WorkbenchSceneOwner,
  type WorkbenchSceneSnapshot,
  type WorkbenchSurfaceDescriptor,
  type WorkbenchTerminalSurfaceConfig,
} from "../../shared/workbench-scene";
import type { WorkbenchSceneLocation } from "../../shared/workbench-layout";
import type { WorkbenchPanelId } from "../../shared/workbench-session-view";
import { resolveRightNeighborPanelPlacement } from "./workbench-panel-placement";

export type WorkbenchSurfaceOpenRequest =
  | {
      readonly kind: "conversation";
      readonly sessionId: string;
      readonly titleSnapshot?: string;
    }
  | {
      readonly kind: "db_view";
      readonly config: WorkbenchDbViewSurfaceConfig;
      readonly titleSnapshot?: string;
    }
  | {
      readonly kind: "page_stage";
      readonly config: WorkbenchPageStageSurfaceConfig;
      readonly titleSnapshot?: string;
    }
  | {
      readonly kind: "canvas_stage";
      readonly config: WorkbenchCanvasStageSurfaceConfig;
      readonly titleSnapshot?: string;
    }
  | {
      readonly kind: "terminal";
      readonly config: Omit<
        WorkbenchTerminalSurfaceConfig,
        "terminalSessionId"
      > & { readonly terminalSessionId?: string };
      readonly titleSnapshot?: string;
    }
  | {
      readonly kind: "browser";
      readonly config?: Omit<
        WorkbenchBrowserSurfaceConfig,
        "browserTabId" | "browserStorageId"
      > & {
        readonly browserTabId?: string;
        readonly browserStorageId?: string;
      };
      readonly titleSnapshot?: string;
    }
  | {
      readonly kind: "review";
      readonly config: WorkbenchReviewSurfaceConfig;
      readonly titleSnapshot?: string;
    }
  | {
      readonly kind: "files";
      readonly config: WorkbenchFilesSurfaceConfig;
      readonly titleSnapshot?: string;
    };

export interface PresentWorkbenchPanelSurfaceInput {
  readonly owner: WorkbenchSceneOwner;
  readonly request: WorkbenchSurfaceOpenRequest;
  readonly target: {
    readonly panelId: WorkbenchPanelId;
    readonly leafId?: string;
    readonly placement?: {
      readonly kind: "adjacent-right";
      readonly sourceSurfaceId: string;
    };
  };
  readonly mode: "durable" | "preview";
  readonly navigation: "select-owner" | "background";
}

function resolvePanelSurfaceTarget(
  scene: WorkbenchSceneSnapshot,
  target: PresentWorkbenchPanelSurfaceInput["target"],
): {
  readonly scene: WorkbenchSceneSnapshot;
  readonly panelId: WorkbenchPanelId;
  readonly leafId: string | undefined;
} {
  if (!target.placement) {
    return { scene, panelId: target.panelId, leafId: target.leafId };
  }
  const sourceSurface = resolveWorkbenchSceneSurface(
    scene,
    target.placement.sourceSurfaceId,
  );
  if (!sourceSurface) {
    return { scene, panelId: target.panelId, leafId: target.leafId };
  }

  const sourcePanelId = (["right", "bottom"] as const).find((panelId) =>
    findWorkbenchPanelLeafForTab(
      scene.panels[panelId].layout,
      sourceSurface.id,
    )
  );
  if (!sourcePanelId) {
    return { scene, panelId: target.panelId, leafId: target.leafId };
  }
  const sourceLeaf = findWorkbenchPanelLeafForTab(
    scene.panels[sourcePanelId].layout,
    sourceSurface.id,
  );
  if (!sourceLeaf) {
    return { scene, panelId: target.panelId, leafId: target.leafId };
  }
  if (sourcePanelId === "bottom") {
    return { scene, panelId: "bottom", leafId: sourceLeaf.id };
  }

  const placement = resolveRightNeighborPanelPlacement(
    scene.panels.right.layout,
    sourceLeaf.id,
    {
      fullWidth: scene.panels.right.size.fullWidth ?? false,
    },
  );
  if (placement.kind === "fallback") {
    return { scene, panelId: "right", leafId: sourceLeaf.id };
  }
  if (placement.kind === "existing") {
    return { scene, panelId: "right", leafId: placement.leafId };
  }

  const ensured = ensureWorkbenchSceneLeafToRight(scene, {
    panelId: "right",
    leafId: placement.sourceLeafId,
  });
  return { scene: ensured.scene, panelId: "right", leafId: ensured.leafId };
}

export type PresentWorkbenchPanelSurfaceResult =
  | {
      readonly status: "presented";
      readonly surfaceId: string;
      readonly reused: boolean;
    }
  | {
      readonly status: "unavailable";
      readonly reason: string;
    };

export interface WorkbenchSceneNavigatorIdentityFactory {
  createId(kind: "surface" | "browser" | "terminal"): string;
}

export interface WorkbenchSceneNavigatorPort {
  readonly setScene: (
    owner: WorkbenchSceneOwner,
    update: (
      previous: WorkbenchSceneSnapshot | undefined,
    ) => WorkbenchSceneSnapshot,
  ) => void;
  readonly selectLocation: (location: WorkbenchSceneLocation) => void;
  readonly setSceneAndSelect: (
    owner: WorkbenchSceneOwner,
    update: (
      previous: WorkbenchSceneSnapshot | undefined,
    ) => WorkbenchSceneSnapshot,
    location: WorkbenchSceneLocation,
  ) => void;
  readonly presentPreview?: (
    input: PresentWorkbenchPanelSurfaceInput,
  ) => Promise<PresentWorkbenchPanelSurfaceResult>;
}

export interface WorkbenchSceneNavigator {
  readonly openProject: (projectId: string) => void;
  readonly openSession: (session: {
    readonly id: string;
    readonly projectId: string | null;
  }) => void;
  readonly openPages: () => void;
  readonly presentPanelSurface: (
    input: PresentWorkbenchPanelSurfaceInput,
  ) => Promise<PresentWorkbenchPanelSurfaceResult>;
}

function createDefaultIdentityFactory(): WorkbenchSceneNavigatorIdentityFactory {
  return {
    createId(kind) {
      const id = globalThis.crypto?.randomUUID?.()
        ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      return `${kind}:${id}`;
    },
  };
}

function makeSurfaceDescriptor(
  request: WorkbenchSurfaceOpenRequest,
  identities: WorkbenchSceneNavigatorIdentityFactory,
): WorkbenchSurfaceDescriptor {
  const common = {
    id: identities.createId("surface"),
    stateKey: 0,
    state: null,
  } as const;

  switch (request.kind) {
    case "conversation":
      return {
        ...common,
        kind: request.kind,
        titleSnapshot: request.titleSnapshot ?? "New chat",
        config: { sessionId: request.sessionId },
      };
    case "db_view":
      return {
        ...common,
        kind: request.kind,
        titleSnapshot: request.titleSnapshot ?? "Database",
        config: request.config,
      };
    case "page_stage":
      return {
        ...common,
        kind: request.kind,
        titleSnapshot: request.titleSnapshot ?? "Page",
        config: request.config,
      };
    case "canvas_stage":
      return {
        ...common,
        kind: request.kind,
        titleSnapshot: request.titleSnapshot ?? "Canvas",
        config: request.config,
      };
    case "terminal":
      return {
        ...common,
        kind: request.kind,
        titleSnapshot: request.titleSnapshot ?? "Terminal",
        config: {
          ...request.config,
          terminalSessionId: request.config.terminalSessionId
            ?? identities.createId("terminal"),
        },
      };
    case "browser": {
      const browserTabId = request.config?.browserTabId
        ?? identities.createId("browser");
      return {
        ...common,
        kind: request.kind,
        titleSnapshot: request.titleSnapshot ?? "Browser",
        config: {
          ...request.config,
          browserTabId,
          browserStorageId: request.config?.browserStorageId
            ?? `browser:scene:${browserTabId}`,
        },
      };
    }
    case "review":
      return {
        ...common,
        kind: request.kind,
        titleSnapshot: request.titleSnapshot ?? "Review",
        config: request.config,
      };
    case "files":
      return {
        ...common,
        kind: request.kind,
        titleSnapshot: request.titleSnapshot
          ?? request.config.path?.split(/[\\/]/).pop()
          ?? "Files",
        config: request.config,
      };
  }
}

function presentDurableSurface(
  port: WorkbenchSceneNavigatorPort,
  identities: WorkbenchSceneNavigatorIdentityFactory,
  input: Omit<PresentWorkbenchPanelSurfaceInput, "request"> & {
    readonly request: WorkbenchSurfaceOpenRequest;
  },
): PresentWorkbenchPanelSurfaceResult {
  const candidate = makeSurfaceDescriptor(input.request, identities);
  let result: PresentWorkbenchPanelSurfaceResult = {
    status: "presented",
    surfaceId: candidate.id,
    reused: false,
  };

  const updateScene = (stored: WorkbenchSceneSnapshot | undefined) => {
    const scene = stored ?? materializeInitialWorkbenchScene(input.owner);
    const reuseKey = getWorkbenchSurfaceReuseKey(candidate);
    if (
      reuseKey !== null
      && scene.primary
      && getWorkbenchSurfaceReuseKey(scene.primary) === reuseKey
    ) {
      result = {
        status: "presented",
        surfaceId: scene.primary.id,
        reused: true,
      };
      return scene;
    }
    const matching = reuseKey === null
      ? null
      : Object.values(scene.panelSurfacesById).find(
          (surface) => getWorkbenchSurfaceReuseKey(surface) === reuseKey,
        ) ?? null;
    if (matching) {
      for (const panelId of ["right", "bottom"] as const) {
        const leaf = findWorkbenchPanelLeafForTab(
          scene.panels[panelId].layout,
          matching.id,
        );
        if (!leaf) continue;
        result = {
          status: "presented",
          surfaceId: matching.id,
          reused: true,
        };
        return patchWorkbenchScenePanel(
          activateWorkbenchSceneSurface(
            scene,
            panelId,
            leaf.id,
            matching.id,
          ),
          panelId,
          { collapsed: false },
        );
      }
    }

    const target = resolvePanelSurfaceTarget(scene, input.target);
    return patchWorkbenchScenePanel(
      createWorkbenchSceneSurface(target.scene, {
        panelId: target.panelId,
        targetLeafId: target.leafId,
        surface: candidate,
      }),
      target.panelId,
      { collapsed: false },
    );
  };

  if (input.navigation === "select-owner") {
    const location = sceneLocationForOwner(input.owner);
    port.setSceneAndSelect(input.owner, updateScene, location);
  } else {
    port.setScene(input.owner, updateScene);
  }
  return result;
}

export function createWorkbenchSceneNavigator(
  port: WorkbenchSceneNavigatorPort,
  identities: WorkbenchSceneNavigatorIdentityFactory =
    createDefaultIdentityFactory(),
): WorkbenchSceneNavigator {
  const presentPanelSurface = async (
    input: PresentWorkbenchPanelSurfaceInput,
  ): Promise<PresentWorkbenchPanelSurfaceResult> => {
    if (input.mode === "preview") {
      return port.presentPreview?.(input) ?? {
        status: "unavailable",
        reason: "Preview presentation is unavailable for this Scene",
      };
    }
    if (input.owner.kind === "project" && input.request.kind === "conversation") {
      return {
        status: "unavailable",
        reason: "Project conversations belong to Agent Dock",
      };
    }
    if (input.owner.kind === "pages") {
      const requestAllowed = input.request.kind === "page_stage"
        || input.request.kind === "canvas_stage"
        || input.request.kind === "db_view";
      const libraryAuthorized = requestAllowed
        && input.request.config.accessContext.kind === "library"
        && (input.request.kind !== "db_view"
          || input.request.config.target.kind !== "project-default");
      if (!libraryAuthorized) {
        return {
          status: "unavailable",
          reason: "Pages only accepts Library content surfaces",
        };
      }
    }
    return presentDurableSurface(port, identities, {
      ...input,
      request: input.request,
    });
  };

  return {
    openProject(projectId) {
      port.selectLocation({ kind: "project", projectId });
    },
    openSession(session) {
      port.selectLocation({
        kind: "session",
        sessionId: session.id,
        projectContextId: session.projectId,
      });
    },
    openPages() {
      port.selectLocation({ kind: "pages" });
    },
    presentPanelSurface,
  };
}

function sceneLocationForOwner(owner: WorkbenchSceneOwner): WorkbenchSceneLocation {
  if (owner.kind === "project") {
    return { kind: "project", projectId: owner.projectId };
  }
  if (owner.kind === "session") {
    return {
      kind: "session",
      sessionId: owner.sessionId,
      projectContextId: null,
    };
  }
  return { kind: "pages" };
}
