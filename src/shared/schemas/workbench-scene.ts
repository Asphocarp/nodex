import { z } from "zod";
import {
  findWorkbenchPanelLeafForTab,
  flattenWorkbenchPanelTabIds,
} from "../workbench-panel-layout";
import {
  WORKBENCH_SCENE_MAX_PANEL_SURFACES,
  WORKBENCH_SCENE_VERSION,
  makeWorkbenchSceneKey,
  migrateWorkbenchSceneV1ToV2,
  type WorkbenchSceneOwner,
  type WorkbenchSceneSnapshot,
  type WorkbenchSurfaceDescriptor,
} from "../workbench-scene";
import { BrowserSidebarDeviceToolbarStateSchema } from "../browser/browser-schemas";
import { WorkbenchViewSchema } from "./workbench";
import {
  MAX_WORKBENCH_SESSION_VIEW_JSON_BYTES,
  WorkbenchPanelStateSchema,
} from "./workbench-session-view";

const idSchema = z.string().min(1).max(512);
const surfaceIdSchema = z.string().min(1).max(160);
const titleSchema = z.string().max(2_000);

function encodedJsonBytes(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export const WorkbenchSceneOwnerSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("project"),
    projectId: idSchema,
  }).strict(),
  z.object({
    kind: z.literal("session"),
    sessionId: idSchema,
  }).strict(),
]) satisfies z.ZodType<WorkbenchSceneOwner>;

const WorkbenchConversationSurfaceConfigSchema = z.object({
  sessionId: idSchema,
}).strict();

const WorkbenchDbViewSurfaceConfigSchema = z.object({
  projectId: idSchema,
  target: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("project-default") }).strict(),
    z.object({
      kind: z.literal("database-view"),
      databaseViewId: idSchema,
    }).strict(),
  ]),
  view: WorkbenchViewSchema,
}).strict();

const WorkbenchPageStageSurfaceConfigSchema = z.object({
  projectId: idSchema,
  pageId: idSchema,
  titleSnapshot: z.string().max(2_000).optional(),
}).strict();

const WorkbenchCanvasStageSurfaceConfigSchema = z.object({
  projectId: idSchema,
  canvasBlockId: idSchema,
  titleSnapshot: z.string().max(2_000).optional(),
}).strict();

const WorkbenchTerminalSurfaceConfigSchema = z.object({
  terminalSessionId: idSchema,
  context: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("project"),
      projectId: idSchema,
    }).strict(),
    z.object({
      kind: z.literal("session"),
      sessionId: idSchema,
    }).strict(),
  ]).optional(),
}).strict();

const WorkbenchBrowserSurfaceConfigSchema = z.object({
  browserTabId: idSchema,
  browserUseSource: z.object({
    codexSessionId: idSchema,
  }).strict().optional(),
  browserStorageId: idSchema.optional(),
  url: z.string().optional(),
  title: z.string().max(2_000).optional(),
  faviconUrl: z.string().optional(),
  deviceToolbarVisible: z.boolean().optional(),
  deviceToolbarState: BrowserSidebarDeviceToolbarStateSchema.optional(),
}).strict();

const WorkbenchReviewSurfaceConfigSchema = z.object({
  projectId: idSchema,
  context: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("project"),
      projectId: idSchema,
    }).strict(),
    z.object({
      kind: z.literal("session"),
      sessionId: idSchema,
    }).strict(),
  ]).optional(),
}).strict();

const WorkbenchFilesSurfaceConfigSchema = z.object({
  projectId: idSchema.nullable(),
  hostId: z.literal("local"),
  workspaceRoot: z.string().min(1).nullable(),
  cwd: z.string().min(1).nullable(),
  path: z.string().min(1).optional(),
}).strict();

const surfaceBaseSchema = {
  id: surfaceIdSchema,
  titleSnapshot: titleSchema,
  stateKey: z.number().int().nonnegative(),
  state: z.unknown(),
} as const;

export const WorkbenchSurfaceDescriptorSchema = z.discriminatedUnion("kind", [
  z.object({
    ...surfaceBaseSchema,
    kind: z.literal("conversation"),
    config: WorkbenchConversationSurfaceConfigSchema,
  }).strict(),
  z.object({
    ...surfaceBaseSchema,
    kind: z.literal("db_view"),
    config: WorkbenchDbViewSurfaceConfigSchema,
  }).strict(),
  z.object({
    ...surfaceBaseSchema,
    kind: z.literal("page_stage"),
    config: WorkbenchPageStageSurfaceConfigSchema,
  }).strict(),
  z.object({
    ...surfaceBaseSchema,
    kind: z.literal("canvas_stage"),
    config: WorkbenchCanvasStageSurfaceConfigSchema,
  }).strict(),
  z.object({
    ...surfaceBaseSchema,
    kind: z.literal("terminal"),
    config: WorkbenchTerminalSurfaceConfigSchema,
  }).strict(),
  z.object({
    ...surfaceBaseSchema,
    kind: z.literal("browser"),
    config: WorkbenchBrowserSurfaceConfigSchema,
  }).strict(),
  z.object({
    ...surfaceBaseSchema,
    kind: z.literal("review"),
    config: WorkbenchReviewSurfaceConfigSchema,
  }).strict(),
  z.object({
    ...surfaceBaseSchema,
    kind: z.literal("files"),
    config: WorkbenchFilesSurfaceConfigSchema,
  }).strict(),
]).superRefine((surface, context) => {
  if (encodedJsonBytes(surface.config) > MAX_WORKBENCH_SESSION_VIEW_JSON_BYTES) {
    context.addIssue({
      code: "custom",
      message: "Surface config exceeds its encoded size bound",
    });
  }
  if (encodedJsonBytes(surface.state) > MAX_WORKBENCH_SESSION_VIEW_JSON_BYTES) {
    context.addIssue({
      code: "custom",
      message: "Surface state exceeds its encoded size bound",
    });
  }
}) satisfies z.ZodType<WorkbenchSurfaceDescriptor>;

const WorkbenchAgentDockStateSchema = z.object({
  visible: z.boolean(),
  binding: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("new") }).strict(),
    z.object({
      kind: z.literal("session"),
      sessionId: idSchema,
    }).strict(),
  ]),
  newDraftId: idSchema,
}).strict();

const workbenchSceneSnapshotFields = {
  owner: WorkbenchSceneOwnerSchema,
  primary: WorkbenchSurfaceDescriptorSchema,
  panelSurfacesById: z.record(
    surfaceIdSchema,
    WorkbenchSurfaceDescriptorSchema,
  ),
  panels: z.object({
    right: WorkbenchPanelStateSchema,
    bottom: WorkbenchPanelStateSchema,
  }).strict(),
  lastFocusedPanelId: z.enum(["right", "bottom"]).nullable(),
  touchedAt: z.iso.datetime(),
} as const;

const WorkbenchSceneSnapshotV1InputSchema = z.object({
  version: z.literal(1),
  ...workbenchSceneSnapshotFields,
}).strict();

function migrateWorkbenchSceneSnapshot(value: unknown): unknown {
  const legacy = WorkbenchSceneSnapshotV1InputSchema.safeParse(value);
  if (!legacy.success) return value;
  return migrateWorkbenchSceneV1ToV2(legacy.data);
}

export const WorkbenchSceneSnapshotSchema = z.preprocess(
  migrateWorkbenchSceneSnapshot,
  z.object({
  version: z.literal(WORKBENCH_SCENE_VERSION),
  ...workbenchSceneSnapshotFields,
  agentDock: WorkbenchAgentDockStateSchema.nullable(),
}).strict().superRefine((scene, context) => {
  const entries = Object.entries(scene.panelSurfacesById);
  if (entries.length > WORKBENCH_SCENE_MAX_PANEL_SURFACES) {
    context.addIssue({
      code: "custom",
      path: ["panelSurfacesById"],
      message: `Scene contains more than ${WORKBENCH_SCENE_MAX_PANEL_SURFACES} panel surfaces`,
    });
  }

  for (const [surfaceId, surface] of entries) {
    if (surfaceId === surface.id) continue;
    context.addIssue({
      code: "custom",
      path: ["panelSurfacesById", surfaceId, "id"],
      message: "Surface map key must match surface.id",
    });
  }

  if (scene.panelSurfacesById[scene.primary.id]) {
    context.addIssue({
      code: "custom",
      path: ["primary", "id"],
      message: "Primary surface cannot also be owned as a regular panel surface",
    });
  }

  const placedIds = [
    ...flattenWorkbenchPanelTabIds(scene.panels.right.layout),
    ...flattenWorkbenchPanelTabIds(scene.panels.bottom.layout),
  ];
  const placementCount = new Map<string, number>();
  for (const surfaceId of placedIds) {
    placementCount.set(surfaceId, (placementCount.get(surfaceId) ?? 0) + 1);
  }
  for (const surfaceId of Object.keys(scene.panelSurfacesById)) {
    if (placementCount.get(surfaceId) === 1) continue;
    context.addIssue({
      code: "custom",
      path: ["panelSurfacesById", surfaceId],
      message: "Every panel surface must be placed exactly once",
    });
  }
  for (const surfaceId of placementCount.keys()) {
    if (
      scene.panelSurfacesById[surfaceId]
      || surfaceId === scene.primary.id
    ) continue;
    context.addIssue({
      code: "custom",
      path: ["panels"],
      message: `Panel placement references unknown surface ${surfaceId}`,
    });
  }

  if (scene.owner.kind === "project") {
    if (
      scene.primary.kind !== "db_view"
      || scene.primary.config.projectId !== scene.owner.projectId
      || scene.primary.config.target.kind !== "project-default"
    ) {
      context.addIssue({
        code: "custom",
        path: ["primary"],
        message: "Project Scene primary must target the Project default Database View",
      });
    }
    if (scene.agentDock === null) {
      context.addIssue({
        code: "custom",
        path: ["agentDock"],
        message: "Project Scene must own Agent Dock view state",
      });
    }
    if (placementCount.get(scene.primary.id) !== 1) {
      context.addIssue({
        code: "custom",
        path: ["primary", "id"],
        message: "Project primary must be placed exactly once",
      });
    }
    if (
      flattenWorkbenchPanelTabIds(scene.panels.bottom.layout).includes(
        scene.primary.id,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["panels", "bottom"],
        message: "Project primary must stay in the right surface stack",
      });
    }
    const primaryLeaf = findWorkbenchPanelLeafForTab(
      scene.panels.right.layout,
      scene.primary.id,
    );
    if (!primaryLeaf || primaryLeaf.tabIds[0] !== scene.primary.id) {
      context.addIssue({
        code: "custom",
        path: ["panels", "right", "layout"],
        message: "Project primary must be the first tab in its leaf",
      });
    }
    if (
      scene.panels.right.collapsed
      || scene.panels.right.size.fullWidth !== true
    ) {
      context.addIssue({
        code: "custom",
        path: ["panels", "right"],
        message: "Project right surface stack must remain open and full width",
      });
    }
    if (entries.some(([, surface]) => surface.kind === "conversation")) {
      context.addIssue({
        code: "custom",
        path: ["panelSurfacesById"],
        message: "Project conversations belong to Agent Dock, not panel surfaces",
      });
    }
  } else if (
    scene.primary.kind !== "conversation"
    || scene.primary.config.sessionId !== scene.owner.sessionId
  ) {
    context.addIssue({
      code: "custom",
      path: ["primary"],
      message: "Session Scene primary must target its owning Conversation",
    });
  } else {
    if (scene.agentDock !== null) {
      context.addIssue({
        code: "custom",
        path: ["agentDock"],
        message: "Session Scene cannot own a Project Agent Dock",
      });
    }
    if (placementCount.has(scene.primary.id)) {
      context.addIssue({
        code: "custom",
        path: ["primary", "id"],
        message: "Session primary remains in the main plane",
      });
    }
  }

  if (encodedJsonBytes(scene) > MAX_WORKBENCH_SESSION_VIEW_JSON_BYTES) {
    context.addIssue({
      code: "custom",
      message: "Scene exceeds its encoded size bound",
    });
  }
}),
) satisfies z.ZodType<WorkbenchSceneSnapshot>;

export function validateWorkbenchSceneMapKey(
  sceneKey: string,
  scene: WorkbenchSceneSnapshot,
): boolean {
  return makeWorkbenchSceneKey(scene.owner) === sceneKey;
}
