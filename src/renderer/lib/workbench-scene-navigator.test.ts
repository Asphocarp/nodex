import {
  describe,
  expect,
  test,
  vi,
} from "vitest";
import {
  findNearestWorkbenchPanelLeafToRight,
  findWorkbenchPanelLeafForTab,
  listWorkbenchPanelLeaves,
} from "../../shared/workbench-panel-layout";
import {
  makeWorkbenchSceneKey,
  materializeInitialWorkbenchScene,
  type WorkbenchSceneSnapshot,
} from "../../shared/workbench-scene";
import {
  createWorkbenchSceneNavigator,
  type WorkbenchSceneNavigatorPort,
} from "./workbench-scene-navigator";

function createHarness() {
  const scenes: Record<string, WorkbenchSceneSnapshot> = {};
  const selectLocation = vi.fn();
  const port: WorkbenchSceneNavigatorPort = {
    setScene(owner, update) {
      const key = makeWorkbenchSceneKey(owner);
      scenes[key] = update(scenes[key]);
    },
    selectLocation,
  };
  let nextId = 0;
  const navigator = createWorkbenchSceneNavigator(port, {
    createId(kind) {
      nextId += 1;
      return `${kind}:${nextId}`;
    },
  });
  return {
    navigator,
    scenes,
    selectLocation,
  };
}

describe("WorkbenchSceneNavigator", () => {
  test("materializes and deduplicates a Project resource without creating a Session", async () => {
    const harness = createHarness();
    const owner = { kind: "project" as const, projectId: "alpha" };
    const input = {
      owner,
      request: {
        kind: "page_stage" as const,
        config: {
          accessContext: { kind: "project" as const, projectId: "alpha" },
          pageId: "page:one",
        },
        titleSnapshot: "Page One",
      },
      target: { panelId: "right" as const },
      mode: "durable" as const,
      navigation: "background" as const,
    };

    const first = await harness.navigator.presentPanelSurface(input);
    const second = await harness.navigator.presentPanelSurface(input);

    expect(first).toMatchObject({ status: "presented", reused: false });
    expect(second).toMatchObject({
      status: "presented",
      reused: true,
      surfaceId: first.status === "presented" ? first.surfaceId : "",
    });
    const scene = harness.scenes[makeWorkbenchSceneKey(owner)];
    expect(scene.primary.kind).toBe("db_view");
    expect(scene.panels.right.collapsed).toBe(false);
    expect(Object.values(scene.panelSurfacesById)).toHaveLength(1);
  });

  test("rejects Conversation surfaces in a Project Scene", async () => {
    const harness = createHarness();
    const owner = { kind: "project" as const, projectId: "alpha" };

    await expect(harness.navigator.presentPanelSurface({
      owner,
      request: {
        kind: "conversation",
        sessionId: "session-1",
      },
      target: { panelId: "right" },
      mode: "durable",
      navigation: "background",
    })).resolves.toEqual({
      status: "unavailable",
      reason: "Project conversations belong to Agent Dock",
    });
    expect(harness.scenes).toEqual({});
  });

  test("opens Project Home database pages in an adjacent right group", async () => {
    const harness = createHarness();
    const owner = { kind: "project" as const, projectId: "alpha" };
    const ownerKey = makeWorkbenchSceneKey(owner);
    let nextSeedId = 0;
    const initial = materializeInitialWorkbenchScene(owner, {
      identityFactory: {
        createId(kind) {
          nextSeedId += 1;
          return `seed:${kind}:${nextSeedId}`;
        },
      },
    });
    harness.scenes[ownerKey] = initial;
    const sourceLeaf = findWorkbenchPanelLeafForTab(
      initial.panels.right.layout,
      initial.primary.id,
    );
    if (!sourceLeaf) throw new Error("Expected Project Home source leaf");

    const presentPage = (pageId: string) =>
      harness.navigator.presentPanelSurface({
        owner,
        request: {
          kind: "page_stage",
          config: {
            accessContext: { kind: "project", projectId: "alpha" },
            pageId,
          },
          titleSnapshot: pageId,
        },
        target: {
          panelId: "right",
          placement: {
            kind: "adjacent-right",
            sourceSurfaceId: initial.primary.id,
          },
        },
        mode: "durable",
        navigation: "background",
      });

    const first = await presentPage("page:one");
    expect(first).toMatchObject({ status: "presented", reused: false });
    const afterFirst = harness.scenes[ownerKey];
    const afterFirstLeaves = listWorkbenchPanelLeaves(
      afterFirst.panels.right.layout,
    );
    expect(afterFirstLeaves).toHaveLength(2);
    const firstSurface = Object.values(afterFirst.panelSurfacesById).find(
      (surface) =>
        surface.kind === "page_stage"
        && surface.config.pageId === "page:one",
    );
    if (!firstSurface) throw new Error("Expected first Page surface");
    const firstPageLeaf = findWorkbenchPanelLeafForTab(
      afterFirst.panels.right.layout,
      firstSurface.id,
    );
    expect(firstPageLeaf?.id).toBe(
      findNearestWorkbenchPanelLeafToRight(
        afterFirst.panels.right.layout,
        sourceLeaf.id,
      ),
    );

    await presentPage("page:two");
    const afterSecond = harness.scenes[ownerKey];
    expect(listWorkbenchPanelLeaves(afterSecond.panels.right.layout)).toHaveLength(2);
    const secondSurface = Object.values(afterSecond.panelSurfacesById).find(
      (surface) =>
        surface.kind === "page_stage"
        && surface.config.pageId === "page:two",
    );
    if (!secondSurface) throw new Error("Expected second Page surface");
    const secondPageLeaf = findWorkbenchPanelLeafForTab(
      afterSecond.panels.right.layout,
      secondSurface.id,
    );
    expect(secondPageLeaf?.id).toBe(firstPageLeaf?.id);
    expect(secondPageLeaf?.tabIds).toEqual([
      firstSurface.id,
      secondSurface.id,
    ]);
  });

  test("preserves Project context when selecting a Session owner", () => {
    const harness = createHarness();

    harness.navigator.openSession({ id: "session:one", projectId: "alpha" });

    expect(harness.selectLocation).toHaveBeenCalledWith({
      kind: "session",
      sessionId: "session:one",
      projectContextId: "alpha",
    });
  });

  test("opens a standalone root as its own Resource Scene", () => {
    const harness = createHarness();

    harness.navigator.openResource({ kind: "page", pageId: "page:one" });

    expect(harness.selectLocation).toHaveBeenCalledWith({
      kind: "resource",
      root: { kind: "page", pageId: "page:one" },
    });
  });

  test("rejects execution-only surfaces in a Resource Scene", async () => {
    const harness = createHarness();
    const owner = {
      kind: "resource" as const,
      root: { kind: "page" as const, pageId: "page:one" },
    };

    await expect(harness.navigator.presentPanelSurface({
      owner,
      request: {
        kind: "terminal",
        config: {},
      },
      target: { panelId: "right" },
      mode: "durable",
      navigation: "background",
    })).resolves.toEqual({
      status: "unavailable",
      reason: "Execution surfaces require a Project or Session Scene",
    });
    expect(harness.scenes).toEqual({});
  });
});
