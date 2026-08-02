import { describe, expect, test } from "vitest";
import { createDefaultWorkbenchLayoutSnapshotV6 } from "../../shared/workbench-layout";
import {
  makeWorkbenchSceneKey,
  materializeInitialWorkbenchScene,
  patchWorkbenchScenePanel,
} from "../../shared/workbench-scene";
import {
  closeWorkbenchRoute,
  createWorkbenchWindowState,
  navigateBackInWorkbenchWindow,
  navigateForwardInWorkbenchWindow,
  navigateWorkbenchWindow,
  openWorkbenchRoute,
  reconcileMissingWorkbenchSession,
  selectWorkbenchProject,
  selectWorkbenchResource,
  selectWorkbenchSession,
  snapshotWorkbenchWindowState,
  updateWorkbenchScene,
} from "./workbench-window-state";

describe("WorkbenchWindowState", () => {
  test("selecting a projectless Session preserves Project context", () => {
    const state = createWorkbenchWindowState({
      ...createDefaultWorkbenchLayoutSnapshotV6(),
      location: {
        kind: "project",
        projectId: "alpha",
      },
    });

    const selected = selectWorkbenchSession(state, {
      id: "session:projectless",
      projectId: null,
    });

    expect(selected.location).toEqual({
      kind: "session",
      sessionId: "session:projectless",
      projectContextId: "alpha",
    });
  });

  test("selecting a Project navigates directly without selecting a Session", () => {
    const state = createWorkbenchWindowState({
      ...createDefaultWorkbenchLayoutSnapshotV6(),
      location: {
        kind: "session",
        sessionId: "session:alpha",
        projectContextId: "alpha",
      },
    });

    expect(selectWorkbenchProject(state, "alpha").location).toEqual({
      kind: "project",
      projectId: "alpha",
    });
  });

  test("routes retain a Scene return location and close atomically", () => {
    const initial = createWorkbenchWindowState({
      ...createDefaultWorkbenchLayoutSnapshotV6(),
      location: {
        kind: "session",
        sessionId: "session:alpha",
        projectContextId: "alpha",
      },
    });
    const routed = openWorkbenchRoute(initial, {
      kind: "settings",
      path: "/settings/keyboard-shortcuts",
    });

    expect(routed.location).toEqual({
      kind: "settings",
      path: "/settings/keyboard-shortcuts",
      returnTo: initial.location,
    });
    expect(closeWorkbenchRoute(routed).location).toEqual(initial.location);
  });

  test("back and forward apply history without recording themselves", () => {
    const initial = createWorkbenchWindowState(
      createDefaultWorkbenchLayoutSnapshotV6(),
    );
    const settings = openWorkbenchRoute(initial, {
      kind: "settings",
      path: "/settings/general",
    });
    const automations = openWorkbenchRoute(settings, {
      kind: "automations",
      path: "/automations",
    });

    const back = navigateBackInWorkbenchWindow(automations);
    const forward = navigateForwardInWorkbenchWindow(back);

    expect(back.location.kind).toBe("settings");
    expect(back.history.backStack).toHaveLength(1);
    expect(back.history.forwardStack).toHaveLength(1);
    expect(forward.location.kind).toBe("automations");
    expect(forward.history.backStack).toHaveLength(2);
    expect(forward.history.forwardStack).toHaveLength(0);
  });

  test("Resource Scenes participate in the shared window history", () => {
    const initial = createWorkbenchWindowState(
      createDefaultWorkbenchLayoutSnapshotV6(),
    );
    const page = selectWorkbenchResource(initial, {
      kind: "page",
      pageId: "page:alpha",
    });
    const canvas = selectWorkbenchResource(page, {
      kind: "canvas",
      canvasId: "canvas:alpha",
    });

    const pageAgain = navigateBackInWorkbenchWindow(canvas);
    const emptyAgain = navigateBackInWorkbenchWindow(pageAgain);
    const pageForward = navigateForwardInWorkbenchWindow(emptyAgain);

    expect(pageAgain.location).toEqual(page.location);
    expect(emptyAgain.location).toEqual(initial.location);
    expect(pageForward.location).toEqual(page.location);
    expect(pageForward.history.forwardStack).toHaveLength(1);
  });

  test("opens a Resource Scene atomically from another auxiliary route", () => {
    const initial = createWorkbenchWindowState({
      ...createDefaultWorkbenchLayoutSnapshotV6(),
      location: { kind: "project", projectId: "alpha" },
    });
    const settings = openWorkbenchRoute(initial, {
      kind: "settings",
      path: "/settings/general",
    });
    const resource = selectWorkbenchResource(settings, {
      kind: "page",
      pageId: "page:alpha",
    });

    expect(resource.location).toEqual({
      kind: "resource",
      root: { kind: "page", pageId: "page:alpha" },
    });
    expect(navigateBackInWorkbenchWindow(resource).location).toEqual(
      settings.location,
    );
  });

  test("Resource replacement does not add history and divergent navigation clears forward", () => {
    const initial = createWorkbenchWindowState(
      createDefaultWorkbenchLayoutSnapshotV6(),
    );
    const page = selectWorkbenchResource(initial, {
      kind: "page",
      pageId: "page:alpha",
    });
    const emptyAgain = navigateBackInWorkbenchWindow(page);
    const canvas = selectWorkbenchResource(emptyAgain, {
      kind: "canvas",
      canvasId: "canvas:alpha",
    });
    const replacement = navigateWorkbenchWindow(
      canvas,
      { kind: "resource", root: { kind: "page", pageId: "page:alpha" } },
      { record: false },
    );

    expect(canvas.history.forwardStack).toHaveLength(0);
    expect(replacement.history).toEqual(canvas.history);
    expect(replacement.location).toEqual(page.location);
    expect(navigateWorkbenchWindow(replacement, replacement.location)).toBe(
      replacement,
    );
  });

  test("back and forward restore the Scene snapshot atomically", () => {
    const owner = { kind: "session", sessionId: "session:alpha" } as const;
    const scene = patchWorkbenchScenePanel(
      materializeInitialWorkbenchScene(owner),
      "right",
      { collapsed: false },
    );
    const sceneKey = makeWorkbenchSceneKey(owner);
    const initial = createWorkbenchWindowState({
      ...createDefaultWorkbenchLayoutSnapshotV6(),
      location: {
        kind: "session",
        sessionId: "session:alpha",
        projectContextId: "alpha",
      },
      scenesByOwnerKey: { [sceneKey]: scene },
    });
    const collapsed = updateWorkbenchScene(initial, owner, (current) =>
      patchWorkbenchScenePanel(current!, "right", { collapsed: true }));

    expect(
      collapsed.scenesByOwnerKey[sceneKey]?.panels.right.collapsed,
    ).toBe(true);
    const back = navigateBackInWorkbenchWindow(collapsed);
    expect(back.scenesByOwnerKey[sceneKey]?.panels.right.collapsed).toBe(false);
    const forward = navigateForwardInWorkbenchWindow(back);
    expect(forward.scenesByOwnerKey[sceneKey]?.panels.right.collapsed).toBe(true);
  });

  test("updates composer overlay state without recording navigation history", () => {
    const owner = { kind: "session", sessionId: "session:alpha" } as const;
    const scene = materializeInitialWorkbenchScene(owner);
    const sceneKey = makeWorkbenchSceneKey(owner);
    const initial = createWorkbenchWindowState({
      ...createDefaultWorkbenchLayoutSnapshotV6(),
      location: {
        kind: "session",
        sessionId: "session:alpha",
        projectContextId: "alpha",
      },
      scenesByOwnerKey: { [sceneKey]: scene },
    });

    const hidden = updateWorkbenchScene(initial, owner, (current) => ({
      ...current!,
      composerOverlay: { visible: false },
    }), { recordHistory: false });

    expect(hidden.scenesByOwnerKey[sceneKey]?.composerOverlay.visible).toBe(false);
    expect(hidden.history).toEqual(initial.history);
    expect(snapshotWorkbenchWindowState(hidden).scenesByOwnerKey[sceneKey])
      .toEqual(hidden.scenesByOwnerKey[sceneKey]);
  });

  test("only an authoritative missing Session reconciles to Project", () => {
    const location = {
      kind: "settings",
      path: "/settings/general",
      returnTo: {
        kind: "session",
        sessionId: "session:deleted",
        projectContextId: "alpha",
      },
    } as const;
    const state = createWorkbenchWindowState({
      ...createDefaultWorkbenchLayoutSnapshotV6(),
      location,
    });

    const reconciled = reconcileMissingWorkbenchSession(
      state,
      "session:deleted",
    );

    expect(reconciled.location).toEqual({
      ...location,
      returnTo: {
        kind: "project",
        projectId: "alpha",
      },
    });
    expect(reconcileMissingWorkbenchSession(
      state,
      "session:another",
    )).toBe(state);
  });

  test("persistence folds pending worktree to the return route", () => {
    const state = createWorkbenchWindowState(
      createDefaultWorkbenchLayoutSnapshotV6(),
    );
    const pending = openWorkbenchRoute(state, {
      kind: "pending-worktree",
      clientThreadId: "client:one",
    });

    expect(snapshotWorkbenchWindowState(pending).location).toEqual({
      kind: "empty",
    });
  });
});
