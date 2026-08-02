import type { BrowserSidebarDeviceToolbarState } from "./browser-sidebar";
import type { CodexForkBrowserSidePanelSnapshot } from "./codex-fork-browser-transfer";
import type { InitialProjectPresentation } from "./initial-project-welcome";
import type { ContentAccessContext } from "./content-access-context";
import type { DatabaseId } from "./database-identities";
import type { LibraryResourceTarget } from "./library-module";
import {
  activateWorkbenchSessionViewTab,
  cloneWorkbenchLayoutForNewWindow as cloneLegacyWorkbenchLayoutForNewWindow,
  createEmptyWorkbenchSessionView,
  createWorkbenchSessionViewTab,
  ensureWorkbenchSessionViewLeafToRight,
  maximizeWorkbenchSessionViewLeaf,
  mergeWorkbenchSessionViewLeaf,
  moveWorkbenchSessionViewTab,
  normalizeWorkbenchSessionView,
  patchWorkbenchSessionViewPanel,
  removeWorkbenchSessionViewTab,
  reorderWorkbenchSessionViewTabs,
  resizeWorkbenchSessionViewBranch,
  splitWorkbenchSessionViewLeaf,
  updateWorkbenchSessionViewTab,
  type WorkbenchPanelId,
  type WorkbenchPanelSize,
  type WorkbenchPanelState,
  type WorkbenchSessionViewIdentityFactory,
  type WorkbenchSessionViewSnapshot,
  type WorkbenchSessionViewTab,
  type WorkbenchSurfacePresentation,
} from "./workbench-session-view";
import {
  activateWorkbenchPanelLeaf,
  findWorkbenchPanelLeaf,
  findWorkbenchPanelLeafForTab,
  flattenWorkbenchPanelTabIds,
  getWorkbenchPanelActiveLeaf,
  moveWorkbenchPanelTab,
  removeWorkbenchPanelTab,
  reorderWorkbenchPanelLeafTabs,
  type WorkbenchPanelSplitSide,
} from "./workbench-panel-layout";

export const WORKBENCH_SCENE_VERSION = 4 as const;
export const WORKBENCH_SCENE_MAX_PANEL_SURFACES = 2_048;

export type WorkbenchSceneOwner =
  | {
      readonly kind: "project";
      readonly projectId: string;
    }
  | {
      readonly kind: "session";
      readonly sessionId: string;
    }
  | {
      readonly kind: "resource";
      readonly root: LibraryResourceTarget;
    };

export type WorkbenchSceneKey = string;

export type WorkbenchAgentDockBinding =
  | { readonly kind: "new" }
  | { readonly kind: "session"; readonly sessionId: string };

export interface WorkbenchAgentDockState {
  readonly binding: WorkbenchAgentDockBinding;
  readonly newDraftId: string;
}

export interface WorkbenchComposerOverlayState {
  readonly visible: boolean;
}

export function makeWorkbenchSceneKey(
  owner: WorkbenchSceneOwner,
): WorkbenchSceneKey {
  if (owner.kind === "project") return `project:${owner.projectId}`;
  if (owner.kind === "session") return `session:${owner.sessionId}`;
  if (owner.root.kind === "page") return `resource:page:${owner.root.pageId}`;
  if (owner.root.kind === "database") {
    return `resource:database:${owner.root.databaseId}`;
  }
  return `resource:canvas:${owner.root.canvasId}`;
}

export type WorkbenchSurfaceKind =
  | "conversation"
  | "db_view"
  | "page_stage"
  | "canvas_stage"
  | "terminal"
  | "browser"
  | "review"
  | "files";

export interface WorkbenchConversationSurfaceConfig {
  readonly sessionId: string;
}

export interface WorkbenchDbViewSurfaceConfig {
  readonly accessContext: ContentAccessContext;
  readonly target:
    | { readonly kind: "project-default" }
    | {
        readonly kind: "database-default";
        readonly databaseId: DatabaseId;
      }
    | {
        readonly kind: "database-view";
        readonly databaseViewId: string;
      };
  readonly view: "kanban" | "list" | "toggle-list" | "calendar";
}

export interface WorkbenchPageStageSurfaceConfig {
  readonly accessContext: ContentAccessContext;
  readonly pageId: string;
  readonly titleSnapshot?: string;
}

export interface WorkbenchCanvasStageSurfaceConfig {
  readonly accessContext: ContentAccessContext;
  readonly canvasBlockId: string;
  readonly titleSnapshot?: string;
}

export interface WorkbenchTerminalSurfaceConfig {
  readonly terminalSessionId: string;
  readonly context?:
    | {
        readonly kind: "project";
        readonly projectId: string;
      }
    | {
        readonly kind: "session";
        readonly sessionId: string;
      };
}

export interface WorkbenchBrowserSurfaceConfig {
  readonly browserTabId: string;
  readonly browserUseSource?: {
    readonly codexSessionId: string;
  };
  readonly browserStorageId?: string;
  readonly url?: string;
  readonly title?: string;
  readonly faviconUrl?: string;
  readonly deviceToolbarVisible?: boolean;
  readonly deviceToolbarState?: BrowserSidebarDeviceToolbarState;
}

export interface WorkbenchReviewSurfaceConfig {
  readonly projectId: string;
  readonly context?:
    | {
        readonly kind: "project";
        readonly projectId: string;
      }
    | {
        readonly kind: "session";
        readonly sessionId: string;
      };
}

export interface WorkbenchFilesSurfaceConfig {
  readonly projectId: string | null;
  readonly hostId: "local";
  readonly workspaceRoot: string | null;
  readonly cwd: string | null;
  readonly path?: string;
}

export interface WorkbenchSurfaceConfigByKind {
  readonly conversation: WorkbenchConversationSurfaceConfig;
  readonly db_view: WorkbenchDbViewSurfaceConfig;
  readonly page_stage: WorkbenchPageStageSurfaceConfig;
  readonly canvas_stage: WorkbenchCanvasStageSurfaceConfig;
  readonly terminal: WorkbenchTerminalSurfaceConfig;
  readonly browser: WorkbenchBrowserSurfaceConfig;
  readonly review: WorkbenchReviewSurfaceConfig;
  readonly files: WorkbenchFilesSurfaceConfig;
}

type WorkbenchSurfaceVariant = {
  [Kind in WorkbenchSurfaceKind]: {
    readonly kind: Kind;
    readonly config: WorkbenchSurfaceConfigByKind[Kind];
  };
}[WorkbenchSurfaceKind];

export type WorkbenchSurfaceDescriptor = {
  readonly id: string;
  readonly titleSnapshot: string;
  readonly stateKey: number;
  readonly state: unknown;
} & WorkbenchSurfaceVariant;

export interface WorkbenchSceneSnapshot {
  readonly version: typeof WORKBENCH_SCENE_VERSION;
  readonly owner: WorkbenchSceneOwner;
  readonly primary: WorkbenchSurfaceDescriptor;
  readonly panelSurfacesById: Readonly<
    Record<string, WorkbenchSurfaceDescriptor>
  >;
  readonly panels: Readonly<Record<WorkbenchPanelId, WorkbenchPanelState>>;
  readonly lastFocusedPanelId: WorkbenchPanelId | null;
  readonly composerOverlay: WorkbenchComposerOverlayState;
  readonly agentDock: WorkbenchAgentDockState | null;
  readonly touchedAt: string;
}

type WorkbenchLegacyResourceSurfaceDescriptor =
  | (Omit<
      Extract<WorkbenchSurfaceDescriptor, { readonly kind: "db_view" }>,
      "config"
    > & {
      readonly config: {
        readonly projectId: string;
        readonly target:
          | { readonly kind: "project-default" }
          | {
              readonly kind: "database-view";
              readonly databaseViewId: string;
            };
        readonly view: WorkbenchDbViewSurfaceConfig["view"];
      };
    })
  | (Omit<
      Extract<WorkbenchSurfaceDescriptor, { readonly kind: "page_stage" }>,
      "config"
    > & {
      readonly config: Omit<
        WorkbenchPageStageSurfaceConfig,
        "accessContext"
      > & { readonly projectId: string };
    })
  | (Omit<
      Extract<WorkbenchSurfaceDescriptor, { readonly kind: "canvas_stage" }>,
      "config"
    > & {
      readonly config: Omit<
        WorkbenchCanvasStageSurfaceConfig,
        "accessContext"
      > & { readonly projectId: string };
    });

export type WorkbenchSurfaceDescriptorV3 =
  | Exclude<
      WorkbenchSurfaceDescriptor,
      { readonly kind: "db_view" | "page_stage" | "canvas_stage" }
    >
  | WorkbenchLegacyResourceSurfaceDescriptor;

export interface WorkbenchSceneSnapshotV3 {
  readonly version: 3;
  readonly owner: Exclude<WorkbenchSceneOwner, { readonly kind: "resource" }>;
  readonly primary: WorkbenchSurfaceDescriptorV3;
  readonly panelSurfacesById: Readonly<
    Record<string, WorkbenchSurfaceDescriptorV3>
  >;
  readonly panels: Readonly<Record<WorkbenchPanelId, WorkbenchPanelState>>;
  readonly lastFocusedPanelId: WorkbenchPanelId | null;
  readonly composerOverlay: WorkbenchComposerOverlayState;
  readonly agentDock: WorkbenchAgentDockState | null;
  readonly touchedAt: string;
}

export type WorkbenchSceneSnapshotV2 = Omit<
  WorkbenchSceneSnapshotV3,
  "version" | "composerOverlay" | "agentDock"
> & {
  readonly version: 2;
  readonly agentDock: (WorkbenchAgentDockState & {
    readonly visible: boolean;
  }) | null;
};

export type WorkbenchSceneSnapshotV1 = Omit<
  WorkbenchSceneSnapshotV2,
  "version" | "agentDock"
> & {
  readonly version: 1;
};

export interface WorkbenchSceneIdentityFactory {
  createId(kind: "surface" | "leaf" | "branch" | "browser" | "draft"): string;
}

export interface WorkbenchSceneSurfaceCreateInput {
  readonly panelId: WorkbenchPanelId;
  readonly presentation?: WorkbenchSurfacePresentation;
  readonly targetLeafId?: string;
  readonly surface: WorkbenchSurfaceDescriptor;
}

export interface WorkbenchSceneSurfaceRemoveOptions {
  readonly preserveEmptyLeafIds?: string[];
  readonly preferredActiveLeafId?: string | null;
  readonly preferredActiveSurfaceId?: string | null;
}

export interface WorkbenchSceneSurfaceMoveInput {
  readonly surfaceId: string;
  readonly targetPanelId: WorkbenchPanelId;
  readonly targetLeafId?: string;
  readonly targetIndex?: number;
  readonly preserveEmptyLeafIds?: string[];
  readonly splitTarget?: {
    readonly leafId: string;
    readonly side: WorkbenchPanelSplitSide;
  };
  readonly identityFactory?: WorkbenchSceneIdentityFactory;
}

export interface WorkbenchSceneLeafInput {
  readonly panelId: WorkbenchPanelId;
  readonly leafId: string;
}

export interface WorkbenchSceneLeafSplitInput extends WorkbenchSceneLeafInput {
  readonly side: WorkbenchPanelSplitSide;
  readonly surfaceId?: string;
  readonly identityFactory?: WorkbenchSceneIdentityFactory;
}

export interface WorkbenchScenePanelPatch {
  readonly collapsed?: boolean;
  readonly size?: Partial<WorkbenchPanelSize>;
}

export interface CloneWorkbenchSceneLayout {
  readonly scenesByOwnerKey: Readonly<
    Record<WorkbenchSceneKey, WorkbenchSceneSnapshot>
  >;
}

function currentIso(): string {
  return new Date().toISOString();
}

function defaultIdentityFactory(): WorkbenchSceneIdentityFactory {
  return {
    createId(kind) {
      const id = globalThis.crypto?.randomUUID?.()
        ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
      return `${kind}:${id}`;
    },
  };
}

function toLegacyIdentityFactory(
  identityFactory: WorkbenchSceneIdentityFactory,
): WorkbenchSessionViewIdentityFactory {
  return {
    createId(kind) {
      return identityFactory.createId(kind === "tab" ? "surface" : kind);
    },
  };
}

const PANEL_IDS = ["right", "bottom"] as const satisfies readonly WorkbenchPanelId[];

function isSurfacePlaced(
  scene: Pick<WorkbenchSceneSnapshot, "panels">,
  surfaceId: string,
): boolean {
  return PANEL_IDS.some((panelId) =>
    flattenWorkbenchPanelTabIds(scene.panels[panelId].layout).includes(surfaceId)
  );
}

function toLegacyPanelView(
  scene: WorkbenchSceneSnapshot,
): WorkbenchSessionViewSnapshot {
  const tabsById = isSurfacePlaced(scene, scene.primary.id)
    ? {
        ...scene.panelSurfacesById,
        [scene.primary.id]: scene.primary,
      }
    : scene.panelSurfacesById;
  return {
    version: 3,
    sessionId: makeWorkbenchSceneKey(scene.owner),
    tabsById: tabsById as Record<
      string,
      WorkbenchSessionViewTab
    >,
    panels: scene.panels as Record<WorkbenchPanelId, WorkbenchPanelState>,
    lastFocusedPanelId: scene.lastFocusedPanelId,
    touchedAt: scene.touchedAt,
  };
}

function enforceProjectSceneInvariants(
  scene: WorkbenchSceneSnapshot,
): WorkbenchSceneSnapshot {
  const panelSurfacesById = Object.fromEntries(
    Object.entries(scene.panelSurfacesById).filter(([, surface]) =>
      surface.kind !== "conversation"
    ),
  );
  const knownIds = new Set([
    scene.primary.id,
    ...Object.keys(panelSurfacesById),
  ]);
  let rightLayout = scene.panels.right.layout;
  let bottomLayout = removeWorkbenchPanelTab(
    scene.panels.bottom.layout,
    scene.primary.id,
  );

  for (const panelId of PANEL_IDS) {
    const layout = panelId === "right" ? rightLayout : bottomLayout;
    for (const surfaceId of flattenWorkbenchPanelTabIds(layout)) {
      if (knownIds.has(surfaceId)) continue;
      if (panelId === "right") {
        rightLayout = removeWorkbenchPanelTab(rightLayout, surfaceId);
      } else {
        bottomLayout = removeWorkbenchPanelTab(bottomLayout, surfaceId);
      }
    }
  }

  let rootLeaf = findWorkbenchPanelLeafForTab(rightLayout, scene.primary.id);
  if (!rootLeaf) {
    const targetLeaf = getWorkbenchPanelActiveLeaf(rightLayout);
    rightLayout = moveWorkbenchPanelTab(rightLayout, {
      tabId: scene.primary.id,
      targetLeafId: targetLeaf.id,
      targetIndex: 0,
    });
    rootLeaf = findWorkbenchPanelLeafForTab(rightLayout, scene.primary.id);
  }
  if (rootLeaf) {
    rightLayout = reorderWorkbenchPanelLeafTabs(
      rightLayout,
      rootLeaf.id,
      [
        scene.primary.id,
        ...rootLeaf.tabIds.filter((surfaceId) => surfaceId !== scene.primary.id),
      ],
    );
  }

  return {
    ...scene,
    panelSurfacesById,
    panels: {
      right: {
        ...scene.panels.right,
        collapsed: false,
        layout: rightLayout,
        size: {
          ...scene.panels.right.size,
          fullWidth: true,
        },
      },
      bottom: {
        ...scene.panels.bottom,
        layout: bottomLayout,
      },
    },
    lastFocusedPanelId: scene.lastFocusedPanelId === "right"
      || scene.lastFocusedPanelId === "bottom"
      ? scene.lastFocusedPanelId
      : null,
    agentDock: scene.agentDock ?? {
      binding: { kind: "new" },
      newDraftId: `agent-draft:${scene.primary.id}`,
    },
  };
}

function enforceSessionSceneInvariants(
  scene: WorkbenchSceneSnapshot,
): WorkbenchSceneSnapshot {
  const panels = { ...scene.panels };
  for (const panelId of PANEL_IDS) {
    panels[panelId] = {
      ...panels[panelId],
      layout: removeWorkbenchPanelTab(
        panels[panelId].layout,
        scene.primary.id,
      ),
    };
  }
  return {
    ...scene,
    panels,
    agentDock: null,
  };
}

function enforceResourceSceneInvariants(
  scene: WorkbenchSceneSnapshot,
): WorkbenchSceneSnapshot {
  const allowedKinds = new Set<WorkbenchSurfaceKind>([
    "db_view",
    "page_stage",
    "canvas_stage",
    "browser",
  ]);
  const rooted = enforceProjectSceneInvariants({
    ...scene,
    panelSurfacesById: Object.fromEntries(
      Object.entries(scene.panelSurfacesById).filter(([, surface]) =>
        allowedKinds.has(surface.kind)
      ),
    ),
  });
  return {
    ...rooted,
    composerOverlay: { visible: false },
    agentDock: null,
  };
}

function enforceWorkbenchSceneInvariants(
  scene: WorkbenchSceneSnapshot,
): WorkbenchSceneSnapshot {
  if (scene.owner.kind === "project") {
    return enforceProjectSceneInvariants(scene);
  }
  if (scene.owner.kind === "resource") {
    return enforceResourceSceneInvariants(scene);
  }
  return enforceSessionSceneInvariants(scene);
}

function fromLegacyPanelView(
  scene: WorkbenchSceneSnapshot,
  view: WorkbenchSessionViewSnapshot,
): WorkbenchSceneSnapshot {
  const primary = view.tabsById[scene.primary.id]
    ? view.tabsById[scene.primary.id] as WorkbenchSurfaceDescriptor
    : scene.primary;
  const panelSurfacesById = { ...view.tabsById } as Record<
    string,
    WorkbenchSurfaceDescriptor
  >;
  delete panelSurfacesById[primary.id];
  return enforceWorkbenchSceneInvariants({
    ...scene,
    primary,
    panelSurfacesById,
    panels: view.panels,
    lastFocusedPanelId: view.lastFocusedPanelId,
    touchedAt: view.touchedAt,
  });
}

export function resolveWorkbenchSceneSurface(
  scene: WorkbenchSceneSnapshot,
  surfaceId: string,
): WorkbenchSurfaceDescriptor | undefined {
  return surfaceId === scene.primary.id
    ? scene.primary
    : scene.panelSurfacesById[surfaceId];
}

function toLegacyPanelTab(
  surface: WorkbenchSurfaceDescriptor,
): WorkbenchSessionViewTab {
  if (surface.kind !== "db_view") {
    return surface as WorkbenchSessionViewTab;
  }
  if (surface.config.target.kind !== "database-view") {
    throw new Error(
      "A symbolic Project Database surface cannot be projected as a legacy Session tab",
    );
  }
  return {
    ...surface,
    config: {
      projectId: surface.config.accessContext.kind === "project"
        ? surface.config.accessContext.projectId
        : (() => {
            throw new Error(
              "A Library Database surface cannot be projected as a legacy Session tab",
            );
          })(),
      databaseViewId: surface.config.target.databaseViewId,
      view: surface.config.view,
    },
  };
}

/**
 * Decode-only bridge for descriptors that were authored through the v1-v4
 * Session panel vocabulary. Runtime layout ownership remains the Scene.
 */
export function workbenchSurfaceFromLegacySessionTab(
  tab: WorkbenchSessionViewTab,
): WorkbenchSurfaceDescriptor {
  if (tab.kind !== "db_view") return tab as WorkbenchSurfaceDescriptor;
  return {
    ...tab,
    config: {
      accessContext: { kind: "project", projectId: tab.config.projectId },
      target: {
        kind: "database-view",
        databaseViewId: tab.config.databaseViewId,
      },
      view: tab.config.view,
    },
  };
}

/**
 * Temporary compatibility projection while leaf renderers move from Session
 * views to Scene surfaces. The returned value is never a second authority.
 */
export function projectWorkbenchSceneToLegacySessionView(
  scene: WorkbenchSceneSnapshot,
): WorkbenchSessionViewSnapshot {
  if (scene.owner.kind !== "session") {
    throw new Error("Only a Session Scene has a legacy Session view projection");
  }
  return {
    ...toLegacyPanelView(scene),
    sessionId: scene.owner.sessionId,
    tabsById: Object.fromEntries(
      Object.entries(scene.panelSurfacesById).map(([surfaceId, surface]) => [
        surfaceId,
        toLegacyPanelTab(surface),
      ]),
    ),
  };
}

export function applyLegacySessionViewToWorkbenchScene(
  scene: WorkbenchSceneSnapshot,
  view: WorkbenchSessionViewSnapshot,
): WorkbenchSceneSnapshot {
  if (
    scene.owner.kind !== "session"
    || scene.owner.sessionId !== view.sessionId
  ) {
    return scene;
  }
  const panelSurfacesById = Object.fromEntries(
    Object.entries(view.tabsById).map(([surfaceId, tab]) => [
      surfaceId,
      workbenchSurfaceFromLegacySessionTab(tab),
    ]),
  );
  return normalizeWorkbenchScene({
    ...scene,
    panelSurfacesById,
    panels: view.panels,
    lastFocusedPanelId: view.lastFocusedPanelId,
    touchedAt: view.touchedAt,
  });
}

function ownerRootPrimary(
  owner: WorkbenchSceneOwner,
  identityFactory: WorkbenchSceneIdentityFactory,
): WorkbenchSurfaceDescriptor {
  if (owner.kind === "project") {
    return {
      id: identityFactory.createId("surface"),
      kind: "db_view",
      titleSnapshot: "Database",
      config: {
        accessContext: { kind: "project", projectId: owner.projectId },
        target: { kind: "project-default" },
        view: "kanban",
      },
      stateKey: 0,
      state: null,
    };
  }

  if (owner.kind === "session") return {
    id: identityFactory.createId("surface"),
    kind: "conversation",
    titleSnapshot: "Conversation",
    config: { sessionId: owner.sessionId },
    stateKey: 0,
    state: null,
  };

  const common = {
    id: identityFactory.createId("surface"),
    stateKey: 0,
    state: null,
  } as const;
  if (owner.root.kind === "page") {
    return {
      ...common,
      kind: "page_stage",
      titleSnapshot: "Page",
      config: {
        accessContext: { kind: "library" },
        pageId: owner.root.pageId,
      },
    };
  }
  if (owner.root.kind === "database") {
    return {
      ...common,
      kind: "db_view",
      titleSnapshot: "Database",
      config: {
        accessContext: { kind: "library" },
        target: {
          kind: "database-default",
          databaseId: owner.root.databaseId,
        },
        view: "kanban",
      },
    };
  }
  return {
    ...common,
    kind: "canvas_stage",
    titleSnapshot: "Canvas",
    config: {
      accessContext: { kind: "library" },
      canvasBlockId: owner.root.canvasId,
    },
  };
}

export function createEmptyWorkbenchScene(
  owner: WorkbenchSceneOwner,
  options: {
    readonly identityFactory?: WorkbenchSceneIdentityFactory;
    readonly touchedAt?: string;
  } = {},
): WorkbenchSceneSnapshot {
  const identityFactory = options.identityFactory ?? defaultIdentityFactory();
  const view = createEmptyWorkbenchSessionView(makeWorkbenchSceneKey(owner), {
    identityFactory: toLegacyIdentityFactory(identityFactory),
    touchedAt: options.touchedAt,
  });
  return normalizeWorkbenchScene({
    version: WORKBENCH_SCENE_VERSION,
    owner,
    primary: ownerRootPrimary(owner, identityFactory),
    panelSurfacesById: {},
    panels: view.panels,
    lastFocusedPanelId: null,
    composerOverlay: { visible: owner.kind !== "resource" },
    agentDock: owner.kind === "project"
      ? {
          binding: { kind: "new" },
          newDraftId: identityFactory.createId("draft"),
        }
      : null,
    touchedAt: view.touchedAt,
  });
}

export function materializeInitialWorkbenchScene(
  owner: WorkbenchSceneOwner,
  options: {
    readonly identityFactory?: WorkbenchSceneIdentityFactory;
    readonly touchedAt?: string;
  } = {},
): WorkbenchSceneSnapshot {
  return createEmptyWorkbenchScene(owner, options);
}

export function materializeInitialProjectWelcomeScene(
  presentation: InitialProjectPresentation,
  options: { readonly touchedAt?: string } = {},
): WorkbenchSceneSnapshot {
  const counters = new Map<string, number>();
  const identityFactory: WorkbenchSceneIdentityFactory = {
    createId(kind) {
      const ordinal = counters.get(kind) ?? 0;
      counters.set(kind, ordinal + 1);
      return `initial:${presentation.projectId}:${kind}:${ordinal}`;
    },
  };
  const initial = materializeInitialWorkbenchScene(
    { kind: "project", projectId: presentation.projectId },
    {
      identityFactory,
      touchedAt: options.touchedAt,
    },
  );
  const surfaceId = identityFactory.createId("surface");
  const withPage = createWorkbenchSceneSurface(initial, {
    panelId: "right",
    surface: {
      id: surfaceId,
      kind: "page_stage",
      titleSnapshot: presentation.starterPageTitle,
      config: {
        accessContext: {
          kind: "project",
          projectId: presentation.projectId,
        },
        pageId: presentation.starterPageId,
        titleSnapshot: presentation.starterPageTitle,
      },
      stateKey: 0,
      state: null,
    },
  });
  const maximized = patchWorkbenchScenePanel(withPage, "right", {
    collapsed: false,
    size: { fullWidth: true },
  });
  return options.touchedAt
    ? { ...maximized, touchedAt: options.touchedAt }
    : maximized;
}

export function normalizeWorkbenchScene(
  value: WorkbenchSceneSnapshot,
): WorkbenchSceneSnapshot {
  const normalized = normalizeWorkbenchSessionView(toLegacyPanelView(value));
  return fromLegacyPanelView(value, normalized);
}

function migrateWorkbenchSurfaceV3ToV4(
  surface: WorkbenchSurfaceDescriptorV3,
): WorkbenchSurfaceDescriptor {
  if (
    surface.kind !== "db_view"
    && surface.kind !== "page_stage"
    && surface.kind !== "canvas_stage"
  ) {
    return surface;
  }
  const { projectId, ...config } = surface.config;
  return {
    ...surface,
    config: {
      ...config,
      accessContext: { kind: "project", projectId },
    },
  } as WorkbenchSurfaceDescriptor;
}

function migrateLegacySceneBase(input: {
  readonly legacy: Omit<WorkbenchSceneSnapshotV3, "version" | "composerOverlay" | "agentDock">;
  readonly composerOverlay: WorkbenchComposerOverlayState;
  readonly agentDock: WorkbenchAgentDockState | null;
}): WorkbenchSceneSnapshot {
  return normalizeWorkbenchScene({
    ...input.legacy,
    version: WORKBENCH_SCENE_VERSION,
    primary: migrateWorkbenchSurfaceV3ToV4(input.legacy.primary),
    panelSurfacesById: Object.fromEntries(
      Object.entries(input.legacy.panelSurfacesById).map(
        ([surfaceId, surface]) => [
          surfaceId,
          migrateWorkbenchSurfaceV3ToV4(surface),
        ],
      ),
    ),
    composerOverlay: input.composerOverlay,
    agentDock: input.agentDock,
  });
}

export function migrateWorkbenchSceneV3ToV4(
  legacy: WorkbenchSceneSnapshotV3,
): WorkbenchSceneSnapshot {
  const { composerOverlay, agentDock, ...scene } = legacy;
  return migrateLegacySceneBase({
    legacy: scene,
    composerOverlay,
    agentDock,
  });
}

export function migrateWorkbenchSceneV2ToV4(
  legacy: WorkbenchSceneSnapshotV2,
): WorkbenchSceneSnapshot {
  const { agentDock: legacyAgentDock, ...scene } = legacy;
  return migrateLegacySceneBase({
    legacy: scene,
    composerOverlay: {
      visible: legacy.owner.kind === "project"
        ? legacyAgentDock?.visible ?? true
        : true,
    },
    agentDock: legacyAgentDock
      ? {
          binding: legacyAgentDock.binding,
          newDraftId: legacyAgentDock.newDraftId,
        }
      : null,
  });
}

/**
 * Pure Scene-v1 migration. Project Conversation surfaces become a Dock
 * binding; their Sessions remain owned by Core.
 */
export function migrateWorkbenchSceneV1ToV4(
  legacy: WorkbenchSceneSnapshotV1,
): WorkbenchSceneSnapshot {
  if (legacy.owner.kind === "session") {
    return migrateLegacySceneBase({
      legacy,
      composerOverlay: { visible: true },
      agentDock: null,
    });
  }

  const rightWasCollapsed = legacy.panels.right.collapsed;
  const activeLeaf = getWorkbenchPanelActiveLeaf(legacy.panels.right.layout);
  const activeSurface = activeLeaf.activeTabId
    ? legacy.panelSurfacesById[activeLeaf.activeTabId]
    : undefined;
  const boundSessionId = activeSurface?.kind === "conversation"
    ? activeSurface.config.sessionId
    : null;
  const migrated = migrateLegacySceneBase({
    legacy,
    composerOverlay: { visible: true },
    agentDock: {
      binding: boundSessionId
        ? { kind: "session", sessionId: boundSessionId }
        : { kind: "new" },
      newDraftId: `agent-draft:${legacy.primary.id}`,
    },
  });

  if (!rightWasCollapsed && !boundSessionId) return migrated;
  const rootLeaf = findWorkbenchPanelLeafForTab(
    migrated.panels.right.layout,
    migrated.primary.id,
  );
  if (!rootLeaf) return migrated;
  return {
    ...migrated,
    panels: {
      ...migrated.panels,
      right: {
        ...migrated.panels.right,
        layout: activateWorkbenchPanelLeaf(
          migrated.panels.right.layout,
          rootLeaf.id,
          migrated.primary.id,
        ),
      },
    },
    lastFocusedPanelId: "right",
  };
}

export function createWorkbenchSceneSurface(
  scene: WorkbenchSceneSnapshot,
  input: WorkbenchSceneSurfaceCreateInput,
): WorkbenchSceneSnapshot {
  if (
    input.surface.id === scene.primary.id
    || scene.panelSurfacesById[input.surface.id]
  ) {
    return scene;
  }
  const view = createWorkbenchSessionViewTab(toLegacyPanelView(scene), {
    panelId: input.panelId,
    presentation: input.presentation,
    targetLeafId: input.targetLeafId,
    tab: input.surface as WorkbenchSessionViewTab,
  });
  return fromLegacyPanelView(scene, view);
}

export function updateWorkbenchSceneSurface(
  scene: WorkbenchSceneSnapshot,
  surfaceId: string,
  patch: Partial<Omit<WorkbenchSurfaceDescriptor, "id" | "kind">>,
): WorkbenchSceneSnapshot {
  if (surfaceId === scene.primary.id) {
    return {
      ...scene,
      primary: {
        ...scene.primary,
        ...patch,
        id: scene.primary.id,
        kind: scene.primary.kind,
      } as WorkbenchSurfaceDescriptor,
      touchedAt: currentIso(),
    };
  }
  const view = updateWorkbenchSessionViewTab(
    toLegacyPanelView(scene),
    surfaceId,
    patch as Partial<Omit<WorkbenchSessionViewTab, "id" | "kind">>,
  );
  return fromLegacyPanelView(scene, view);
}

export function removeWorkbenchSceneSurface(
  scene: WorkbenchSceneSnapshot,
  surfaceId: string,
  options: WorkbenchSceneSurfaceRemoveOptions = {},
): WorkbenchSceneSnapshot {
  if (surfaceId === scene.primary.id) return scene;
  const view = removeWorkbenchSessionViewTab(toLegacyPanelView(scene), surfaceId, {
    preserveEmptyLeafIds: options.preserveEmptyLeafIds,
    preferredActiveLeafId: options.preferredActiveLeafId,
    preferredActiveTabId: options.preferredActiveSurfaceId,
  });
  return fromLegacyPanelView(scene, view);
}

export function activateWorkbenchSceneSurface(
  scene: WorkbenchSceneSnapshot,
  panelId: WorkbenchPanelId,
  leafId: string,
  surfaceId?: string | null,
): WorkbenchSceneSnapshot {
  return fromLegacyPanelView(
    scene,
    activateWorkbenchSessionViewTab(
      toLegacyPanelView(scene),
      panelId,
      leafId,
      surfaceId,
    ),
  );
}

export function splitWorkbenchSceneLeaf(
  scene: WorkbenchSceneSnapshot,
  input: WorkbenchSceneLeafSplitInput,
): WorkbenchSceneSnapshot {
  if (input.surfaceId === scene.primary.id) return scene;
  const identityFactory = input.identityFactory ?? defaultIdentityFactory();
  return fromLegacyPanelView(
    scene,
    splitWorkbenchSessionViewLeaf(toLegacyPanelView(scene), {
      panelId: input.panelId,
      leafId: input.leafId,
      side: input.side,
      surfaceId: undefined,
      tabId: input.surfaceId,
      identityFactory: toLegacyIdentityFactory(identityFactory),
    } as Parameters<typeof splitWorkbenchSessionViewLeaf>[1]),
  );
}

export function ensureWorkbenchSceneLeafToRight(
  scene: WorkbenchSceneSnapshot,
  input: WorkbenchSceneLeafInput & {
    readonly identityFactory?: WorkbenchSceneIdentityFactory;
  },
): { readonly scene: WorkbenchSceneSnapshot; readonly leafId: string; readonly created: boolean } {
  const identityFactory = input.identityFactory ?? defaultIdentityFactory();
  const result = ensureWorkbenchSessionViewLeafToRight(toLegacyPanelView(scene), {
    panelId: input.panelId,
    leafId: input.leafId,
    identityFactory: toLegacyIdentityFactory(identityFactory),
  });
  return {
    scene: fromLegacyPanelView(scene, result.view),
    leafId: result.leafId,
    created: result.created,
  };
}

export function mergeWorkbenchSceneLeaf(
  scene: WorkbenchSceneSnapshot,
  input: WorkbenchSceneLeafInput,
): WorkbenchSceneSnapshot {
  const leaf = findWorkbenchPanelLeaf(
    scene.panels[input.panelId].layout,
    input.leafId,
  );
  if (leaf?.tabIds.includes(scene.primary.id)) return scene;
  return fromLegacyPanelView(
    scene,
    mergeWorkbenchSessionViewLeaf(toLegacyPanelView(scene), input),
  );
}

export function moveWorkbenchSceneSurface(
  scene: WorkbenchSceneSnapshot,
  input: WorkbenchSceneSurfaceMoveInput,
): WorkbenchSceneSnapshot {
  if (input.surfaceId === scene.primary.id) return scene;
  const identityFactory = input.identityFactory ?? defaultIdentityFactory();
  return fromLegacyPanelView(
    scene,
    moveWorkbenchSessionViewTab(toLegacyPanelView(scene), {
      tabId: input.surfaceId,
      targetPanelId: input.targetPanelId,
      targetLeafId: input.targetLeafId,
      targetIndex: input.targetIndex,
      preserveEmptyLeafIds: input.preserveEmptyLeafIds,
      splitTarget: input.splitTarget,
      identityFactory: toLegacyIdentityFactory(identityFactory),
    }),
  );
}

export function reorderWorkbenchSceneSurfaces(
  scene: WorkbenchSceneSnapshot,
  input: {
    readonly panelId: WorkbenchPanelId;
    readonly leafId: string;
    readonly orderedSurfaceIds: string[];
  },
): WorkbenchSceneSnapshot {
  const leaf = findWorkbenchPanelLeaf(
    scene.panels[input.panelId].layout,
    input.leafId,
  );
  const orderedSurfaceIds = leaf?.tabIds.includes(scene.primary.id)
    ? [
        scene.primary.id,
        ...input.orderedSurfaceIds.filter((surfaceId) =>
          surfaceId !== scene.primary.id
        ),
      ]
    : input.orderedSurfaceIds;
  return fromLegacyPanelView(
    scene,
    reorderWorkbenchSessionViewTabs(toLegacyPanelView(scene), {
      panelId: input.panelId,
      leafId: input.leafId,
      orderedTabIds: orderedSurfaceIds,
    }),
  );
}

export function resizeWorkbenchSceneBranch(
  scene: WorkbenchSceneSnapshot,
  input: {
    readonly panelId: WorkbenchPanelId;
    readonly branchId: string;
    readonly ratio: number;
  },
): WorkbenchSceneSnapshot {
  return fromLegacyPanelView(
    scene,
    resizeWorkbenchSessionViewBranch(toLegacyPanelView(scene), input),
  );
}

export function maximizeWorkbenchSceneLeaf(
  scene: WorkbenchSceneSnapshot,
  input: {
    readonly panelId: WorkbenchPanelId;
    readonly leafId: string | null;
  },
): WorkbenchSceneSnapshot {
  return fromLegacyPanelView(
    scene,
    maximizeWorkbenchSessionViewLeaf(toLegacyPanelView(scene), input),
  );
}

export function patchWorkbenchScenePanel(
  scene: WorkbenchSceneSnapshot,
  panelId: WorkbenchPanelId,
  patch: WorkbenchScenePanelPatch,
): WorkbenchSceneSnapshot {
  const adjustedPatch = patch.collapsed === true && panelId === "right"
    ? {
        ...patch,
        size: {
          ...patch.size,
          fullWidth: false,
        },
      }
    : patch;
  return fromLegacyPanelView(
    scene,
    patchWorkbenchSessionViewPanel(
      toLegacyPanelView(scene),
      panelId,
      adjustedPatch,
    ),
  );
}

function clonePrimarySurface(
  surface: WorkbenchSurfaceDescriptor,
  identityFactory: WorkbenchSceneIdentityFactory,
): WorkbenchSurfaceDescriptor {
  const id = identityFactory.createId("surface");
  if (surface.kind !== "browser") return { ...surface, id };
  return {
    ...surface,
    id,
    config: {
      ...surface.config,
      browserTabId: identityFactory.createId("browser"),
      browserStorageId: identityFactory.createId("browser"),
    },
  };
}

function cloneWorkbenchScene(
  scene: WorkbenchSceneSnapshot,
  identityFactory: WorkbenchSceneIdentityFactory,
): WorkbenchSceneSnapshot {
  const sceneKey = makeWorkbenchSceneKey(scene.owner);
  const legacy = cloneLegacyWorkbenchLayoutForNewWindow(
    {
      sessionViewsBySessionId: {
        [sceneKey]: toLegacyPanelView(scene),
      },
    },
    toLegacyIdentityFactory(identityFactory),
  ).sessionViewsBySessionId[sceneKey];
  if (!legacy) throw new Error(`Missing cloned Workbench Scene ${sceneKey}`);
  const projectId = scene.owner.kind === "project"
    ? scene.owner.projectId
    : null;
  const clonedPlacedPrimary = projectId
    ? Object.values(legacy.tabsById).find((tab) => {
        const surface = tab as WorkbenchSurfaceDescriptor;
        return surface.kind === "db_view"
          && surface.config.target.kind === "project-default"
          && surface.config.accessContext.kind === "project"
          && surface.config.accessContext.projectId === projectId;
      }) as WorkbenchSurfaceDescriptor | undefined
    : undefined;
  return fromLegacyPanelView(
    {
      ...scene,
      primary: clonedPlacedPrimary
        ?? clonePrimarySurface(scene.primary, identityFactory),
      agentDock: scene.agentDock
        ? {
            ...scene.agentDock,
            newDraftId: identityFactory.createId("draft"),
          }
        : null,
      touchedAt: currentIso(),
    },
    legacy,
  );
}

export function cloneWorkbenchSceneLayoutForNewWindow<
  Layout extends CloneWorkbenchSceneLayout,
>(
  layout: Layout,
  identityFactory: WorkbenchSceneIdentityFactory = defaultIdentityFactory(),
): Layout {
  return {
    ...layout,
    scenesByOwnerKey: Object.fromEntries(
      Object.entries(layout.scenesByOwnerKey).map(([sceneKey, scene]) => [
        sceneKey,
        cloneWorkbenchScene(scene, identityFactory),
      ]),
    ),
  };
}

function contentAccessContextKey(context: ContentAccessContext): string {
  return context.kind === "project"
    ? `project:${context.projectId}`
    : "library";
}

export function getWorkbenchSurfaceReuseKey(
  surface: WorkbenchSurfaceDescriptor,
): string | null {
  switch (surface.kind) {
    case "conversation":
      return `conversation:${surface.config.sessionId}`;
    case "db_view": {
      const accessKey = contentAccessContextKey(surface.config.accessContext);
      return surface.config.target.kind === "project-default"
        ? `db:${accessKey}:default`
        : surface.config.target.kind === "database-default"
          ? `db:${accessKey}:database:${surface.config.target.databaseId}:default`
          : `db:${accessKey}:view:${surface.config.target.databaseViewId}`;
    }
    case "page_stage":
      return `page:${contentAccessContextKey(surface.config.accessContext)}:${surface.config.pageId}`;
    case "canvas_stage":
      return `canvas:${contentAccessContextKey(surface.config.accessContext)}:${surface.config.canvasBlockId}`;
    case "review": {
      const context = surface.config.context;
      if (!context) return `review:project:${surface.config.projectId}`;
      return context.kind === "project"
        ? `review:project:${context.projectId}`
        : `review:session:${context.sessionId}`;
    }
    case "files":
      return `files:${surface.config.projectId ?? "projectless"}:${surface.config.path ?? "root"}`;
    case "browser":
    case "terminal":
      return null;
  }
}

export function applyForkBrowserTransferToWorkbenchScene(
  scene: WorkbenchSceneSnapshot,
  snapshot: CodexForkBrowserSidePanelSnapshot,
): WorkbenchSceneSnapshot {
  let next = scene;
  for (const descriptor of snapshot.tabs) {
    const targetLeafId = getWorkbenchPanelActiveLeaf(
      next.panels[descriptor.panel].layout,
    ).id;
    next = createWorkbenchSceneSurface(next, {
      panelId: descriptor.panel,
      targetLeafId,
      surface: {
        id: descriptor.tabId,
        kind: "browser",
        titleSnapshot: "Browser",
        config: {
          browserTabId: descriptor.browserTabId,
          browserStorageId: `browser:${globalThis.crypto?.randomUUID?.()
            ?? `${Date.now()}-${Math.random()}`}`,
          ...(descriptor.initialUrl ? { url: descriptor.initialUrl } : {}),
          deviceToolbarVisible:
            descriptor.deviceToolbarState.toolbarState.isEnabled,
          deviceToolbarState: descriptor.deviceToolbarState,
        },
        stateKey: 0,
        state: null,
      },
    });
    if (!descriptor.active) continue;
    next = activateWorkbenchSceneSurface(
      next,
      descriptor.panel,
      targetLeafId,
      descriptor.tabId,
    );
  }

  next = patchWorkbenchScenePanel(next, "right", {
    collapsed: !snapshot.rightPanelOpen,
    size: { fullWidth: snapshot.rightPanelFullWidth },
  });
  next = patchWorkbenchScenePanel(next, "bottom", {
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
