import { describe, expect, test } from "vitest";
import { parseDatabaseId } from "./database-identities";
import { WorkbenchSceneSnapshotSchema } from "./schemas/workbench-scene";
import {
  cloneWorkbenchSceneLayoutForNewWindow,
  createWorkbenchSceneSurface,
  getWorkbenchSurfaceReuseKey,
  makeWorkbenchSceneKey,
  materializeInitialWorkbenchScene,
  mergeWorkbenchSceneLeaf,
  migrateWorkbenchSceneV1ToV4,
  migrateWorkbenchSceneV2ToV4,
  migrateWorkbenchSceneV3ToV4,
  moveWorkbenchSceneSurface,
  patchWorkbenchScenePanel,
  removeWorkbenchSceneSurface,
  reorderWorkbenchSceneSurfaces,
  splitWorkbenchSceneLeaf,
  type WorkbenchSceneIdentityFactory,
  type WorkbenchSceneSnapshot,
  type WorkbenchSceneSnapshotV1,
  type WorkbenchSceneSnapshotV2,
  type WorkbenchSurfaceDescriptor,
  type WorkbenchSurfaceDescriptorV3,
} from "./workbench-scene";

function identityFactory(prefix: string): WorkbenchSceneIdentityFactory {
  let next = 0;
  return {
    createId(kind) {
      next += 1;
      return `${prefix}:${kind}:${next}`;
    },
  };
}

function projectScene(): WorkbenchSceneSnapshot {
  return materializeInitialWorkbenchScene(
    { kind: "project", projectId: "project-1" },
    {
      identityFactory: identityFactory("project"),
      touchedAt: "2026-07-31T00:00:00.000Z",
    },
  );
}

function browserSurface(id = "browser-surface"): WorkbenchSurfaceDescriptor {
  return {
    id,
    kind: "browser",
    titleSnapshot: "Browser",
    config: {
      browserTabId: "browser-runtime-1",
      browserStorageId: "browser-storage-1",
      url: "https://example.com",
    },
    stateKey: 0,
    state: null,
  };
}

function sceneV2Fields(
  scene: WorkbenchSceneSnapshot,
): Omit<WorkbenchSceneSnapshotV2, "version" | "agentDock"> {
  if (scene.owner.kind === "resource") {
    throw new Error("Resource Scenes did not exist in Scene v2");
  }
  return {
    owner: scene.owner,
    primary: toLegacySurface(scene.primary),
    panelSurfacesById: Object.fromEntries(
      Object.entries(scene.panelSurfacesById).map(([surfaceId, surface]) => [
        surfaceId,
        toLegacySurface(surface),
      ]),
    ),
    panels: scene.panels,
    lastFocusedPanelId: scene.lastFocusedPanelId,
    touchedAt: scene.touchedAt,
  };
}

function toLegacySurface(
  surface: WorkbenchSurfaceDescriptor,
): WorkbenchSurfaceDescriptorV3 {
  if (
    surface.kind !== "db_view"
    && surface.kind !== "page_stage"
    && surface.kind !== "canvas_stage"
  ) {
    return surface;
  }
  if (surface.config.accessContext.kind !== "project") {
    throw new Error("Legacy Scenes only carried Project resource surfaces");
  }
  const { accessContext, ...config } = surface.config;
  return {
    ...surface,
    config: {
      ...config,
      projectId: accessContext.projectId,
    },
  } as WorkbenchSurfaceDescriptorV3;
}

describe("WorkbenchScene", () => {
  test("materializes Project and Session owner-root primary surfaces", () => {
    const project = projectScene();
    const session = materializeInitialWorkbenchScene(
      { kind: "session", sessionId: "session-1" },
      {
        identityFactory: identityFactory("session"),
        touchedAt: "2026-07-31T00:00:00.000Z",
      },
    );

    expect(project.primary).toMatchObject({
      kind: "db_view",
      config: {
        accessContext: { kind: "project", projectId: "project-1" },
        target: { kind: "project-default" },
      },
    });
    expect(session.primary).toMatchObject({
      kind: "conversation",
      config: { sessionId: "session-1" },
    });
    expect(project.panels.right.collapsed).toBe(false);
    expect(project.panels.right.size.fullWidth).toBe(true);
    expect(project.panels.right.layout.root).toMatchObject({
      type: "leaf",
      tabIds: [project.primary.id],
      activeTabId: project.primary.id,
    });
    expect(project.composerOverlay).toEqual({ visible: true });
    expect(session.composerOverlay).toEqual({ visible: true });
    expect(project.agentDock).toMatchObject({ binding: { kind: "new" } });
    expect(session.panels.right.collapsed).toBe(true);
    expect(session.agentDock).toBeNull();
    expect(project.panels.bottom.collapsed).toBe(true);
    expect(makeWorkbenchSceneKey(project.owner)).toBe("project:project-1");
    expect(makeWorkbenchSceneKey(session.owner)).toBe("session:session-1");
    const resource = materializeInitialWorkbenchScene({
      kind: "resource",
      root: { kind: "page", pageId: "page-1" },
    });
    expect(resource.primary).toMatchObject({
      kind: "page_stage",
      config: {
        accessContext: { kind: "library" },
        pageId: "page-1",
      },
    });
    expect(resource.composerOverlay.visible).toBe(false);
    expect(resource.agentDock).toBeNull();
    expect(makeWorkbenchSceneKey(resource.owner)).toBe("resource:page:page-1");
    const databaseResource = materializeInitialWorkbenchScene({
      kind: "resource",
      root: {
        kind: "database",
        databaseId: parseDatabaseId("database-1"),
      },
    });
    const canvasResource = materializeInitialWorkbenchScene({
      kind: "resource",
      root: { kind: "canvas", canvasId: "canvas-1" },
    });
    expect(databaseResource.primary).toMatchObject({
      kind: "db_view",
      config: {
        accessContext: { kind: "library" },
        target: {
          kind: "database-default",
          databaseId: "database-1",
        },
      },
    });
    expect(canvasResource.primary).toMatchObject({
      kind: "canvas_stage",
      config: {
        accessContext: { kind: "library" },
        canvasBlockId: "canvas-1",
      },
    });
    expect(WorkbenchSceneSnapshotSchema.parse(project)).toEqual(project);
    expect(WorkbenchSceneSnapshotSchema.parse(session)).toEqual(session);
    expect(WorkbenchSceneSnapshotSchema.parse(resource)).toEqual(resource);
    expect(WorkbenchSceneSnapshotSchema.parse(databaseResource))
      .toEqual(databaseResource);
    expect(WorkbenchSceneSnapshotSchema.parse(canvasResource))
      .toEqual(canvasResource);
  });

  test("owns each panel surface exactly once and never allows closing primary", () => {
    const initial = projectScene();
    const withBrowser = createWorkbenchSceneSurface(initial, {
      panelId: "right",
      surface: browserSurface(),
    });

    expect(withBrowser.panelSurfacesById["browser-surface"]).toEqual(
      browserSurface(),
    );
    expect(withBrowser.panels.right.layout.root).toMatchObject({
      type: "leaf",
      tabIds: [initial.primary.id, "browser-surface"],
    });
    expect(WorkbenchSceneSnapshotSchema.parse(withBrowser)).toEqual(withBrowser);
    expect(createWorkbenchSceneSurface(withBrowser, {
      panelId: "bottom",
      surface: browserSurface(),
    })).toBe(withBrowser);
  });

  test("rejects owner-root primary mismatches and duplicate placement", () => {
    const project = projectScene();
    const mismatched = {
      ...project,
      owner: { kind: "project", projectId: "project-2" },
    };
    expect(() => WorkbenchSceneSnapshotSchema.parse(mismatched)).toThrow();

    const withBrowser = createWorkbenchSceneSurface(project, {
      panelId: "right",
      surface: browserSurface(),
    });
    const duplicated = {
      ...withBrowser,
      panels: {
        ...withBrowser.panels,
        bottom: {
          ...withBrowser.panels.bottom,
          layout: withBrowser.panels.right.layout,
        },
      },
    };
    expect(() => WorkbenchSceneSnapshotSchema.parse(duplicated)).toThrow();
  });

  test("keeps a Project right surface stack open and full width", () => {
    const project = projectScene();
    const maximized = patchWorkbenchScenePanel(project, "right", {
      collapsed: false,
      size: { fullWidth: true },
    });
    const collapsed = patchWorkbenchScenePanel(maximized, "right", {
      collapsed: true,
    });

    expect(maximized.panels.right.size.fullWidth).toBe(true);
    expect(collapsed.panels.right.collapsed).toBe(false);
    expect(collapsed.panels.right.size.fullWidth).toBe(true);
  });

  test("protects the Project root surface through panel mutations", () => {
    const initial = createWorkbenchSceneSurface(projectScene(), {
      panelId: "right",
      surface: browserSurface(),
    });
    const rootLeafId = initial.panels.right.layout.activeLeafId;

    expect(removeWorkbenchSceneSurface(initial, initial.primary.id)).toBe(initial);
    expect(moveWorkbenchSceneSurface(initial, {
      surfaceId: initial.primary.id,
      targetPanelId: "bottom",
    })).toBe(initial);
    expect(splitWorkbenchSceneLeaf(initial, {
      panelId: "right",
      leafId: rootLeafId,
      side: "right",
      surfaceId: initial.primary.id,
    })).toBe(initial);
    expect(mergeWorkbenchSceneLeaf(initial, {
      panelId: "right",
      leafId: rootLeafId,
    })).toBe(initial);

    const reordered = reorderWorkbenchSceneSurfaces(initial, {
      panelId: "right",
      leafId: rootLeafId,
      orderedSurfaceIds: ["browser-surface", initial.primary.id],
    });
    expect(reordered.panels.right.layout.root).toMatchObject({
      type: "leaf",
      tabIds: [initial.primary.id, "browser-surface"],
    });
    expect(WorkbenchSceneSnapshotSchema.parse(reordered)).toEqual(reordered);
  });

  test("migrates an active Project Conversation surface into Agent Dock", () => {
    const current = projectScene();
    if (current.panels.right.layout.root.type !== "leaf") {
      throw new Error("Expected a single Project root leaf");
    }
    const withoutDock = sceneV2Fields(current);
    const legacy: WorkbenchSceneSnapshotV1 = {
      ...withoutDock,
      version: 1,
      panelSurfacesById: {
        "conversation-1": {
          id: "conversation-1",
          kind: "conversation",
          titleSnapshot: "Investigate",
          config: { sessionId: "session-1" },
          stateKey: 0,
          state: null,
        },
      },
      panels: {
        ...current.panels,
        right: {
          ...current.panels.right,
          collapsed: true,
          size: { ...current.panels.right.size, fullWidth: false },
          layout: {
            ...current.panels.right.layout,
            root: {
              ...current.panels.right.layout.root,
              tabIds: ["conversation-1"],
              activeTabId: "conversation-1",
              mruTabIds: ["conversation-1"],
            },
          },
        },
      },
    };

    const canonical = migrateWorkbenchSceneV1ToV4(legacy);

    expect(canonical.version).toBe(4);
    expect(canonical.composerOverlay).toEqual({ visible: true });
    expect(canonical.agentDock).toEqual({
      binding: { kind: "session", sessionId: "session-1" },
      newDraftId: `agent-draft:${canonical.primary.id}`,
    });
    expect(WorkbenchSceneSnapshotSchema.parse(legacy)).toEqual(canonical);
    expect(WorkbenchSceneSnapshotSchema.parse(canonical)).toEqual(canonical);
  });

  test("migrates v2 composer visibility into the shared Scene presentation", () => {
    const project = projectScene();
    const legacyProject: WorkbenchSceneSnapshotV2 = {
      ...sceneV2Fields(project),
      version: 2,
      agentDock: {
        ...project.agentDock!,
        visible: false,
      },
    };
    const session = materializeInitialWorkbenchScene({
      kind: "session",
      sessionId: "session-1",
    });
    const legacySession: WorkbenchSceneSnapshotV2 = {
      ...sceneV2Fields(session),
      version: 2,
      agentDock: null,
    };

    expect(migrateWorkbenchSceneV2ToV4(legacyProject).composerOverlay)
      .toEqual({ visible: false });
    expect(migrateWorkbenchSceneV2ToV4(legacySession).composerOverlay)
      .toEqual({ visible: true });
  });

  test("migrates v3 resource configs to explicit Project access", () => {
    const current = projectScene();
    if (current.owner.kind === "resource") {
      throw new Error("Expected a legacy-compatible Project Scene");
    }
    const legacy = {
      ...current,
      version: 3 as const,
      owner: current.owner,
      primary: toLegacySurface(current.primary),
      panelSurfacesById: Object.fromEntries(
        Object.entries(current.panelSurfacesById).map(([id, surface]) => [
          id,
          toLegacySurface(surface),
        ]),
      ),
    };

    const migrated = migrateWorkbenchSceneV3ToV4(legacy);

    expect(migrated.primary).toMatchObject({
      kind: "db_view",
      config: {
        accessContext: { kind: "project", projectId: "project-1" },
      },
    });
    expect(WorkbenchSceneSnapshotSchema.parse(legacy)).toEqual(migrated);
  });

  test("new-window clone remints presentation and Browser identities", () => {
    const original = createWorkbenchSceneSurface({
      ...projectScene(),
      composerOverlay: { visible: false },
    }, {
      panelId: "right",
      surface: browserSurface(),
    });
    const clone = cloneWorkbenchSceneLayoutForNewWindow(
      {
        scenesByOwnerKey: {
          [makeWorkbenchSceneKey(original.owner)]: original,
        },
      },
      identityFactory("clone"),
    ).scenesByOwnerKey["project:project-1"]!;
    const clonedBrowser = Object.values(clone.panelSurfacesById)[0];

    expect(clone.owner).toEqual(original.owner);
    expect(clone.primary.id).not.toBe(original.primary.id);
    expect(clone.agentDock?.newDraftId).not.toBe(
      original.agentDock?.newDraftId,
    );
    expect(clone.composerOverlay).toEqual({ visible: false });
    expect(clonedBrowser?.id).not.toBe("browser-surface");
    expect(clonedBrowser?.kind).toBe("browser");
    if (clonedBrowser?.kind !== "browser") {
      throw new Error("Expected cloned Browser surface");
    }
    expect(clonedBrowser.config.browserTabId).not.toBe("browser-runtime-1");
    expect(clonedBrowser.config.browserStorageId).not.toBe("browser-storage-1");
    expect(WorkbenchSceneSnapshotSchema.parse(clone)).toEqual(clone);
  });

  test("persists explicit Project runtime contexts without a host Session", () => {
    const withTerminal = createWorkbenchSceneSurface(projectScene(), {
      panelId: "bottom",
      surface: {
        id: "terminal-surface",
        kind: "terminal",
        titleSnapshot: "Terminal",
        config: {
          terminalSessionId: "terminal-runtime-1",
          context: { kind: "project", projectId: "project-1" },
        },
        stateKey: 0,
        state: null,
      },
    });
    const withReview = createWorkbenchSceneSurface(withTerminal, {
      panelId: "right",
      surface: {
        id: "review-surface",
        kind: "review",
        titleSnapshot: "Review",
        config: {
          projectId: "project-1",
          context: { kind: "project", projectId: "project-1" },
        },
        stateKey: 0,
        state: null,
      },
    });

    expect(WorkbenchSceneSnapshotSchema.parse(withReview)).toEqual(withReview);
    expect(withReview.panelSurfacesById["terminal-surface"]?.config)
      .toMatchObject({ context: { kind: "project", projectId: "project-1" } });
    expect(withReview.panelSurfacesById["review-surface"]?.config)
      .toMatchObject({ context: { kind: "project", projectId: "project-1" } });
  });

  test("derives stable semantic reuse keys only for singleton resources", () => {
    const conversation = materializeInitialWorkbenchScene(
      { kind: "session", sessionId: "session-1" },
      { identityFactory: identityFactory("reuse") },
    ).primary;
    const database = projectScene().primary;

    expect(getWorkbenchSurfaceReuseKey(conversation)).toBe(
      "conversation:session-1",
    );
    expect(getWorkbenchSurfaceReuseKey(database)).toBe(
      "db:project:project-1:default",
    );
    expect(getWorkbenchSurfaceReuseKey({
      id: "library-page",
      kind: "page_stage",
      titleSnapshot: "Page",
      config: {
        accessContext: { kind: "library" },
        pageId: "page-1",
      },
      stateKey: 0,
      state: null,
    })).toBe("page:library:page-1");
    expect(getWorkbenchSurfaceReuseKey({
      id: "review-project",
      kind: "review",
      titleSnapshot: "Review",
      config: {
        projectId: "project-1",
        context: { kind: "project", projectId: "project-1" },
      },
      stateKey: 0,
      state: null,
    })).toBe("review:project:project-1");
    expect(getWorkbenchSurfaceReuseKey({
      id: "review-session",
      kind: "review",
      titleSnapshot: "Review",
      config: {
        projectId: "project-1",
        context: { kind: "session", sessionId: "session-1" },
      },
      stateKey: 0,
      state: null,
    })).toBe("review:session:session-1");
    expect(getWorkbenchSurfaceReuseKey(browserSurface())).toBeNull();
  });
});
