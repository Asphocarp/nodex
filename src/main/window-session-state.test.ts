import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { WorkspaceState } from "./workspace-state";
import {
  WindowSessionState,
  windowSessionStateTestHelpers,
} from "./window-session-state";

function withTempUserData(run: (userDataPath: string) => void): void {
  const userDataPath = mkdtempSync(join(tmpdir(), "nodex-window-sessions-"));
  try {
    run(userDataPath);
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
}

describe("WindowSessionState", () => {
  test("seeds and restores all retained sessions", () => {
    withTempUserData((userDataPath) => {
      const workspaceState = new WorkspaceState(userDataPath);
      const workspaceBootstrap = workspaceState.bootstrap();
      const state = new WindowSessionState(userDataPath);

      const first = state.createSession(workspaceBootstrap.catalog);
      const second = state.createSession(workspaceBootstrap.catalog);
      const restored = state.selectStartupSessions("all", workspaceBootstrap.catalog);

      expect(restored.length).toBe(2);
      expect(restored[0]?.id).toBe(first.id);
      expect(restored[1]?.id).toBe(second.id);
    });
  });

  test("last-window policy restores only the focused session", () => {
    withTempUserData((userDataPath) => {
      const workspaceBootstrap = new WorkspaceState(userDataPath).bootstrap();
      const state = new WindowSessionState(userDataPath);
      const first = state.createSession(workspaceBootstrap.catalog);
      const second = state.createSession(workspaceBootstrap.catalog);

      state.assignWindow(1, first.id);
      state.assignWindow(2, second.id);
      state.markFocused(1);

      const restored = state.selectStartupSessions("last-window", workspaceBootstrap.catalog);
      expect(restored.length).toBe(1);
      expect(restored[0]?.id).toBe(first.id);
    });
  });

  test("none policy starts a fresh session", () => {
    withTempUserData((userDataPath) => {
      const workspaceBootstrap = new WorkspaceState(userDataPath).bootstrap();
      const state = new WindowSessionState(userDataPath);
      const oldSession = state.createSession(workspaceBootstrap.catalog);
      const restored = state.selectStartupSessions("none", workspaceBootstrap.catalog);

      expect(restored.length).toBe(1);
      expect(restored[0]?.id === oldSession.id).toBeFalse();
    });
  });

  test("saves independent layouts for duplicate workspace sessions", () => {
    withTempUserData((userDataPath) => {
      const workspaceBootstrap = new WorkspaceState(userDataPath).bootstrap();
      const state = new WindowSessionState(userDataPath);
      const first = state.createSession(workspaceBootstrap.catalog);
      const second = state.createSession(workspaceBootstrap.catalog);

      state.assignWindow(1, first.id);
      state.assignWindow(2, second.id);

      const firstLayout = { ...first.layout, focusedStage: "cards" as const };
      const secondLayout = { ...second.layout, focusedStage: "threads" as const };
      state.saveLayout(1, first.workspaceId, firstLayout, workspaceBootstrap.catalog);
      state.saveLayout(2, second.workspaceId, secondLayout, workspaceBootstrap.catalog);

      const catalog = state.readCatalog();
      const savedFirst = catalog?.sessions.find((session) => session.id === first.id);
      const savedSecond = catalog?.sessions.find((session) => session.id === second.id);

      expect(savedFirst?.layout.focusedStage).toBe("cards");
      expect(savedSecond?.layout.focusedStage).toBe("threads");
    });
  });

  test("resolves the assigned session for a window", () => {
    withTempUserData((userDataPath) => {
      const workspaceBootstrap = new WorkspaceState(userDataPath).bootstrap();
      const state = new WindowSessionState(userDataPath);
      const session = state.createSession(workspaceBootstrap.catalog);

      state.assignWindow(7, session.id);
      expect(state.getSessionForWindow(7)?.id).toBe(session.id);

      state.clearWindow(7);
      expect(state.getSessionForWindow(7)).toBe(null);
    });
  });

  test("retains only open sessions when shutdown state is persisted", () => {
    withTempUserData((userDataPath) => {
      const workspaceBootstrap = new WorkspaceState(userDataPath).bootstrap();
      const state = new WindowSessionState(userDataPath);
      const first = state.createSession(workspaceBootstrap.catalog);
      const second = state.createSession(workspaceBootstrap.catalog);
      const closedBeforeQuit = state.createSession(workspaceBootstrap.catalog);

      state.retainSessions([first.id, second.id]);

      const catalog = state.readCatalog();
      expect(catalog?.sessions.length).toBe(2);
      expect(catalog?.sessions[0]?.id).toBe(first.id);
      expect(catalog?.sessions[1]?.id).toBe(second.id);
      expect(catalog?.sessions.some((session) => session.id === closedBeforeQuit.id)).toBeFalse();
    });
  });

  test("can retain the last closed session when quitting with no open windows", () => {
    withTempUserData((userDataPath) => {
      const workspaceBootstrap = new WorkspaceState(userDataPath).bootstrap();
      const state = new WindowSessionState(userDataPath);
      const previous = state.createSession(workspaceBootstrap.catalog);
      const lastClosed = state.createSession(workspaceBootstrap.catalog);

      state.retainSessions([lastClosed.id]);

      const catalog = state.readCatalog();
      expect(catalog?.sessions.length).toBe(1);
      expect(catalog?.sessions[0]?.id).toBe(lastClosed.id);
      expect(catalog?.sessions.some((session) => session.id === previous.id)).toBeFalse();
    });
  });

  test("validates saved window bounds against displays", () => {
    const visible = windowSessionStateTestHelpers.isWindowSessionBoundsVisible(
      { x: 10, y: 10, width: 1000, height: 800, mode: "normal" },
      [{ bounds: { x: 0, y: 0, width: 1440, height: 900 } }],
    );
    const offscreen = windowSessionStateTestHelpers.isWindowSessionBoundsVisible(
      { x: 3000, y: 3000, width: 1000, height: 800, mode: "normal" },
      [{ bounds: { x: 0, y: 0, width: 1440, height: 900 } }],
    );

    expect(visible).toBeTrue();
    expect(offscreen).toBeFalse();
  });
});
