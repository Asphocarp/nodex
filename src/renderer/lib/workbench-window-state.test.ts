import { describe, expect, test } from "vitest";
import {
  createDefaultWorkbenchLayoutSnapshotV4,
  type WorkbenchLocation,
} from "../../shared/workbench-layout";
import {
  createEmptyWorkbenchSessionView,
  patchWorkbenchSessionViewPanel,
} from "../../shared/workbench-session-view";
import {
  closeWorkbenchRoute,
  createWorkbenchWindowState,
  navigateBackInWorkbenchWindow,
  navigateForwardInWorkbenchWindow,
  openWorkbenchRoute,
  reconcileWorkbenchSessionSelection,
  selectWorkbenchSession,
  snapshotWorkbenchWindowState,
  updateWorkbenchSessionView,
} from "./workbench-window-state";

describe("WorkbenchWindowState", () => {
  test("selecting a projectless session preserves Project context", () => {
    const state = createWorkbenchWindowState({
      ...createDefaultWorkbenchLayoutSnapshotV4(),
      location: {
        kind: "empty",
        activeProjectId: "alpha",
      },
    });

    const selected = selectWorkbenchSession(state, {
      id: "session:projectless",
      projectId: null,
    });

    expect(selected.location).toEqual({
      kind: "session",
      activeProjectId: "alpha",
      sessionId: "session:projectless",
    });
  });

  test("routes retain a session return location and close atomically", () => {
    const initial = createWorkbenchWindowState({
      ...createDefaultWorkbenchLayoutSnapshotV4(),
      location: {
        kind: "session",
        activeProjectId: "alpha",
        sessionId: "session:alpha",
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
      createDefaultWorkbenchLayoutSnapshotV4(),
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

  test("back and forward restore the panel view snapshot atomically", () => {
    const initial = createWorkbenchWindowState({
      ...createDefaultWorkbenchLayoutSnapshotV4(),
      location: {
        kind: "session",
        activeProjectId: "alpha",
        sessionId: "session:alpha",
      },
      sessionViewsBySessionId: {
        "session:alpha": patchWorkbenchSessionViewPanel(
          createEmptyWorkbenchSessionView("session:alpha"),
          "right",
          { collapsed: false },
        ),
      },
    });
    const collapsed = updateWorkbenchSessionView(
      initial,
      "session:alpha",
      (view) => patchWorkbenchSessionViewPanel(
        view!,
        "right",
        { collapsed: true },
      ),
    );

    expect(
      collapsed.sessionViewsBySessionId["session:alpha"]?.panels.right.collapsed,
    ).toBe(true);
    const back = navigateBackInWorkbenchWindow(collapsed);
    expect(
      back.sessionViewsBySessionId["session:alpha"]?.panels.right.collapsed,
    ).toBe(false);
    const forward = navigateForwardInWorkbenchWindow(back);
    expect(
      forward.sessionViewsBySessionId["session:alpha"]?.panels.right.collapsed,
    ).toBe(true);
  });

  test("catalog reconciliation repairs only the session return coordinate", () => {
    const location: WorkbenchLocation = {
      kind: "library",
      target: { kind: "home" },
      returnTo: {
        kind: "session",
        activeProjectId: "alpha",
        sessionId: "session:deleted",
      },
    };
    const state = createWorkbenchWindowState({
      ...createDefaultWorkbenchLayoutSnapshotV4(),
      location,
    });

    const reconciled = reconcileWorkbenchSessionSelection(state, [
      { id: "session:alpha", projectId: "alpha" },
      { id: "session:projectless", projectId: null },
    ]);

    expect(reconciled.location).toEqual({
      ...location,
      returnTo: {
        kind: "session",
        activeProjectId: "alpha",
        sessionId: "session:alpha",
      },
    });
  });

  test("persistence folds pending worktree to the return route", () => {
    const state = createWorkbenchWindowState(
      createDefaultWorkbenchLayoutSnapshotV4(),
    );
    const pending = openWorkbenchRoute(state, {
      kind: "pending-worktree",
      clientThreadId: "client:one",
    });

    expect(snapshotWorkbenchWindowState(pending).location).toEqual({
      kind: "empty",
      activeProjectId: null,
    });
  });
});
