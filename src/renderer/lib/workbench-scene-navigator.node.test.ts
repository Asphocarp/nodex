import { describe, expect, test, vi } from "vite-plus/test";
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
  type WorkbenchScenePreviewEntry,
  type WorkbenchSceneNavigatorPort,
} from "./workbench-scene-navigator";

function createHarness() {
  const scenes: Record<string, WorkbenchSceneSnapshot> = {};
  const previews: Record<string, WorkbenchScenePreviewEntry> = {};
  const selectLocation = vi.fn();
  const setSceneAndSelect: WorkbenchSceneNavigatorPort["setSceneAndSelect"] = vi.fn(
    (owner, update, location) => {
      const key = makeWorkbenchSceneKey(owner);
      scenes[key] = update(scenes[key]);
      selectLocation(location);
    },
  );
  const port: WorkbenchSceneNavigatorPort = {
    setScene(owner, update) {
      const key = makeWorkbenchSceneKey(owner);
      scenes[key] = update(scenes[key]);
    },
    selectLocation,
    setSceneAndSelect,
    preview: {
      list(owner) {
        const prefix = `${makeWorkbenchSceneKey(owner)}:`;
        return Object.entries(previews).flatMap(([key, entry]) =>
          key.startsWith(prefix) ? [entry] : [],
        );
      },
      set(owner, panelId, leafId, surface) {
        const key = `${makeWorkbenchSceneKey(owner)}:${panelId}:${leafId}`;
        if (!surface) {
          delete previews[key];
          return;
        }
        previews[key] = { panelId, leafId, surface };
      },
    },
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
    previews,
    scenes,
    selectLocation,
    setSceneAndSelect,
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
    expect(scene.primary?.kind).toBe("db_view");
    expect(scene.panels.right.collapsed).toBe(false);
    expect(Object.values(scene.panelSurfacesById)).toHaveLength(1);
  });

  test("keeps Scene previews ephemeral, replaces them per leaf, and promotes the same identity", async () => {
    const harness = createHarness();
    const owner = { kind: "project" as const, projectId: "alpha" };
    const present = (pageId: string, mode: "preview" | "durable" = "preview") =>
      harness.navigator.presentPanelSurface({
        owner,
        request: {
          kind: "page_stage" as const,
          config: {
            accessContext: { kind: "project" as const, projectId: "alpha" },
            pageId,
          },
          titleSnapshot: pageId,
        },
        target: { panelId: "right" as const },
        mode,
        navigation: "background" as const,
      });

    const first = await present("page:one");
    const second = await present("page:two");
    const sceneBeforePin = harness.scenes[makeWorkbenchSceneKey(owner)];
    const previewBeforePin = Object.values(harness.previews)[0];

    expect(first).toMatchObject({ status: "presented", reused: false });
    expect(second).toMatchObject({ status: "presented", reused: false });
    expect(Object.values(sceneBeforePin.panelSurfacesById)).toEqual([]);
    expect(Object.values(harness.previews)).toHaveLength(1);
    expect(previewBeforePin?.surface).toMatchObject({
      id: second.status === "presented" ? second.surfaceId : "",
      kind: "page_stage",
      config: { pageId: "page:two" },
    });

    const pinned = await present("page:two", "durable");
    const sceneAfterPin = harness.scenes[makeWorkbenchSceneKey(owner)];

    expect(pinned).toMatchObject({
      status: "presented",
      reused: true,
      surfaceId: previewBeforePin?.surface.id,
    });
    expect(harness.previews).toEqual({});
    expect(sceneAfterPin.panelSurfacesById[previewBeforePin!.surface.id]).toMatchObject({
      kind: "page_stage",
      config: { pageId: "page:two" },
    });

    await present("page:two", "preview");
    expect(harness.previews).toEqual({});
    expect(Object.values(sceneAfterPin.panelSurfacesById)).toHaveLength(1);
  });

  test("pins and closes a Scene preview through the explicit preview commands", async () => {
    const harness = createHarness();
    const owner = { kind: "pages" as const };
    const result = await harness.navigator.presentPanelSurface({
      owner,
      request: {
        kind: "page_stage",
        config: {
          accessContext: { kind: "library" },
          pageId: "page:one",
        },
      },
      target: { panelId: "right" },
      mode: "preview",
      navigation: "background",
    });
    if (result.status !== "presented") throw new Error("Expected preview");
    const entry = Object.values(harness.previews)[0];
    if (!entry) throw new Error("Expected preview entry");

    expect(
      harness.navigator.clearPreview({
        owner,
        panelId: entry.panelId,
        leafId: entry.leafId,
        surfaceId: "another-surface",
      }),
    ).toBe(false);
    expect(
      harness.navigator.pinPreview({
        owner,
        panelId: entry.panelId,
        leafId: entry.leafId,
        surfaceId: result.surfaceId,
      }),
    ).toBe(true);
    expect(harness.previews).toEqual({});
    expect(harness.scenes.pages?.panelSurfacesById[result.surfaceId]).toMatchObject({
      kind: "page_stage",
    });
  });

  test("rejects Conversation panel surfaces for every Scene owner", async () => {
    const harness = createHarness();
    const owners = [
      { kind: "project" as const, projectId: "alpha" },
      { kind: "session" as const, sessionId: "session-1" },
    ];

    for (const owner of owners) {
      await expect(
        harness.navigator.presentPanelSurface({
          owner,
          request: {
            kind: "conversation",
            sessionId: "session-1",
          },
          target: { panelId: "right" },
          mode: "durable",
          navigation: "background",
        }),
      ).resolves.toEqual({
        status: "unavailable",
        reason: "Conversation is the Session Scene primary, not a panel surface",
      });
    }
    expect(harness.scenes).toEqual({});
  });

  test("rejects Review surfaces in a Project Scene", async () => {
    const harness = createHarness();

    await expect(
      harness.navigator.presentPanelSurface({
        owner: { kind: "project", projectId: "alpha" },
        request: {
          kind: "review",
          config: { projectId: "alpha" },
        },
        target: { panelId: "right" },
        mode: "durable",
        navigation: "background",
      }),
    ).resolves.toEqual({
      status: "unavailable",
      reason: "Review requires an attached Session",
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
    if (!initial.primary) throw new Error("Expected Project primary");
    const primaryId = initial.primary.id;
    const sourceLeaf = findWorkbenchPanelLeafForTab(initial.panels.right.layout, primaryId);
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
            sourceSurfaceId: primaryId,
          },
        },
        mode: "durable",
        navigation: "background",
      });

    const first = await presentPage("page:one");
    expect(first).toMatchObject({ status: "presented", reused: false });
    const afterFirst = harness.scenes[ownerKey];
    const afterFirstLeaves = listWorkbenchPanelLeaves(afterFirst.panels.right.layout);
    expect(afterFirstLeaves).toHaveLength(2);
    const firstSurface = Object.values(afterFirst.panelSurfacesById).find(
      (surface) => surface.kind === "page_stage" && surface.config.pageId === "page:one",
    );
    if (!firstSurface) throw new Error("Expected first Page surface");
    const firstPageLeaf = findWorkbenchPanelLeafForTab(
      afterFirst.panels.right.layout,
      firstSurface.id,
    );
    expect(firstPageLeaf?.id).toBe(
      findNearestWorkbenchPanelLeafToRight(afterFirst.panels.right.layout, sourceLeaf.id),
    );

    await presentPage("page:two");
    const afterSecond = harness.scenes[ownerKey];
    expect(listWorkbenchPanelLeaves(afterSecond.panels.right.layout)).toHaveLength(2);
    const secondSurface = Object.values(afterSecond.panelSurfacesById).find(
      (surface) => surface.kind === "page_stage" && surface.config.pageId === "page:two",
    );
    if (!secondSurface) throw new Error("Expected second Page surface");
    const secondPageLeaf = findWorkbenchPanelLeafForTab(
      afterSecond.panels.right.layout,
      secondSurface.id,
    );
    expect(secondPageLeaf?.id).toBe(firstPageLeaf?.id);
    expect(secondPageLeaf?.tabIds).toEqual([firstSurface.id, secondSurface.id]);
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

  test("presents a Page in a selected Session owner without creating a Thread", async () => {
    const harness = createHarness();
    const owner = { kind: "session" as const, sessionId: "session:one" };
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
      navigation: "select-owner" as const,
    };

    const first = await harness.navigator.presentPanelSurface(input);
    const second = await harness.navigator.presentPanelSurface(input);
    const scene = harness.scenes[makeWorkbenchSceneKey(owner)];

    expect(first).toMatchObject({ status: "presented", reused: false });
    expect(second).toMatchObject({
      status: "presented",
      reused: true,
      surfaceId: first.status === "presented" ? first.surfaceId : "",
    });
    expect(scene.primary?.kind).toBe("conversation");
    expect(scene.panels.right.collapsed).toBe(false);
    expect(scene.panels.right.size.fullWidth).toBe(false);
    expect(Object.values(scene.panelSurfacesById)).toHaveLength(1);
    expect(harness.selectLocation).toHaveBeenLastCalledWith({
      kind: "session",
      sessionId: "session:one",
      projectContextId: null,
    });
  });

  test("opens the singleton Pages Scene", () => {
    const harness = createHarness();

    harness.navigator.openPages();

    expect(harness.selectLocation).toHaveBeenCalledWith({
      kind: "pages",
    });
  });

  test("opens and focuses Library targets in one Pages tablist", async () => {
    const harness = createHarness();
    const owner = { kind: "pages" as const };
    const present = (pageId: string) =>
      harness.navigator.presentPanelSurface({
        owner,
        request: {
          kind: "page_stage" as const,
          config: {
            accessContext: { kind: "library" as const },
            pageId,
          },
          titleSnapshot: pageId,
        },
        target: { panelId: "right" as const },
        mode: "durable" as const,
        navigation: "select-owner" as const,
      });

    const first = await present("page:one");
    await present("page:two");
    const reused = await present("page:one");

    expect(first).toMatchObject({ status: "presented", reused: false });
    expect(reused).toMatchObject({ status: "presented", reused: true });
    expect(Object.keys(harness.scenes)).toEqual(["pages"]);
    expect(Object.values(harness.scenes.pages!.panelSurfacesById)).toHaveLength(2);
    expect(harness.selectLocation).toHaveBeenLastCalledWith({ kind: "pages" });
    expect(harness.setSceneAndSelect).toHaveBeenCalledTimes(3);
  });

  test("keeps nested Pages navigation with a bottom-panel source", async () => {
    const harness = createHarness();
    const owner = { kind: "pages" as const };
    const request = (pageId: string) => ({
      kind: "page_stage" as const,
      config: {
        accessContext: { kind: "library" as const },
        pageId,
      },
      titleSnapshot: pageId,
    });
    const first = await harness.navigator.presentPanelSurface({
      owner,
      request: request("page:parent"),
      target: { panelId: "bottom" },
      mode: "durable",
      navigation: "background",
    });
    if (first.status !== "presented") throw new Error("Expected parent Page");

    const second = await harness.navigator.presentPanelSurface({
      owner,
      request: request("page:child"),
      target: {
        panelId: "right",
        placement: {
          kind: "adjacent-right",
          sourceSurfaceId: first.surfaceId,
        },
      },
      mode: "durable",
      navigation: "background",
    });
    if (second.status !== "presented") throw new Error("Expected child Page");

    const scene = harness.scenes.pages!;
    expect(
      findWorkbenchPanelLeafForTab(scene.panels.bottom.layout, second.surfaceId)?.tabIds,
    ).toEqual([first.surfaceId, second.surfaceId]);
    expect(findWorkbenchPanelLeafForTab(scene.panels.right.layout, second.surfaceId)).toBeNull();
  });

  test("rejects execution-only surfaces in the Pages Scene", async () => {
    const harness = createHarness();
    const owner = {
      kind: "pages" as const,
    };

    await expect(
      harness.navigator.presentPanelSurface({
        owner,
        request: {
          kind: "terminal",
          config: {},
        },
        target: { panelId: "right" },
        mode: "durable",
        navigation: "background",
      }),
    ).resolves.toEqual({
      status: "unavailable",
      reason: "Pages only accepts Library content surfaces",
    });
    expect(harness.scenes).toEqual({});
  });
});
