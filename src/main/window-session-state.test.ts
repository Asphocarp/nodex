import { describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  createDefaultWorkbenchLayoutSnapshot,
  type WorkbenchLayoutSnapshot,
} from "../shared/workbench-layout";
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

function makeLayout(
  focusedStage: WorkbenchLayoutSnapshot["focusedStage"],
  dbProjectId: string,
): WorkbenchLayoutSnapshot {
  return {
    ...createDefaultWorkbenchLayoutSnapshot(),
    dbProjectId,
    threadsProjectId: dbProjectId,
    focusedStage,
  };
}

describe("WindowSessionState", () => {
  test("creates a default session without workspace catalog input", () => {
    withTempUserData((userDataPath) => {
      const state = new WindowSessionState(userDataPath);
      const session = state.createSession();
      const catalog = state.readCatalog();

      expect(session.layout.dbProjectId).toBe("default");
      expect(session.layout.focusedStage).toBe("db");
      expect(catalog?.sessions.length).toBe(1);
      expect(catalog?.lastActiveSessionId).toBe(session.id);
    });
  });

  test("seeds a new session from an explicit layout", () => {
    withTempUserData((userDataPath) => {
      const state = new WindowSessionState(userDataPath);
      const seededLayout = makeLayout("threads", "seeded");
      const session = state.createSession({ layout: seededLayout });

      expect(session.layout.dbProjectId).toBe("seeded");
      expect(session.layout.threadsProjectId).toBe("seeded");
      expect(session.layout.focusedStage).toBe("threads");
    });
  });

  test("seeds new sessions from the last-focused session layout", () => {
    withTempUserData((userDataPath) => {
      const state = new WindowSessionState(userDataPath);
      const first = state.createSession({ layout: makeLayout("cards", "first") });
      const second = state.createSession({ layout: makeLayout("files", "second") });

      state.assignWindow(1, first.id);
      state.assignWindow(2, second.id);
      state.markFocused(1);

      const inherited = state.createSession();
      expect(inherited.layout.dbProjectId).toBe("first");
      expect(inherited.layout.focusedStage).toBe("cards");
    });
  });

  test("restores all retained sessions for all-window policy", () => {
    withTempUserData((userDataPath) => {
      const state = new WindowSessionState(userDataPath);
      const first = state.createSession();
      const second = state.createSession();
      const restored = state.selectStartupSessions("all");

      expect(restored.length).toBe(2);
      expect(restored[0]?.id).toBe(first.id);
      expect(restored[1]?.id).toBe(second.id);
    });
  });

  test("last-window policy restores only the focused session", () => {
    withTempUserData((userDataPath) => {
      const state = new WindowSessionState(userDataPath);
      const first = state.createSession();
      const second = state.createSession();

      state.assignWindow(1, first.id);
      state.assignWindow(2, second.id);
      state.markFocused(1);

      const restored = state.selectStartupSessions("last-window");
      expect(restored.length).toBe(1);
      expect(restored[0]?.id).toBe(first.id);
    });
  });

  test("none policy starts a fresh session", () => {
    withTempUserData((userDataPath) => {
      const state = new WindowSessionState(userDataPath);
      const oldSession = state.createSession();
      const restored = state.selectStartupSessions("none");

      expect(restored.length).toBe(1);
      expect(restored[0]?.id === oldSession.id).toBe(false);
      expect(state.readCatalog()?.sessions.length).toBe(1);
    });
  });

  test("saves independent layouts for duplicate window sessions", () => {
    withTempUserData((userDataPath) => {
      const state = new WindowSessionState(userDataPath);
      const first = state.createSession();
      const second = state.createSession();

      state.assignWindow(1, first.id);
      state.assignWindow(2, second.id);

      state.saveLayout(1, makeLayout("cards", "first"));
      state.saveLayout(2, makeLayout("threads", "second"));

      const catalog = state.readCatalog();
      const savedFirst = catalog?.sessions.find((session) => session.id === first.id);
      const savedSecond = catalog?.sessions.find((session) => session.id === second.id);

      expect(savedFirst?.layout.dbProjectId).toBe("first");
      expect(savedFirst?.layout.focusedStage).toBe("cards");
      expect(savedSecond?.layout.dbProjectId).toBe("second");
      expect(savedSecond?.layout.focusedStage).toBe("threads");
    });
  });

  test("bootstraps and resolves the assigned session for a window", () => {
    withTempUserData((userDataPath) => {
      const state = new WindowSessionState(userDataPath);
      const session = state.createSession();

      state.assignWindow(7, session.id);
      expect(state.bootstrap(7).id).toBe(session.id);
      expect(state.getSessionForWindow(7)?.id).toBe(session.id);

      state.clearWindow(7);
      expect(state.getSessionForWindow(7)).toBe(null);
    });
  });

  test("updates focus metadata and last active session", () => {
    withTempUserData((userDataPath) => {
      const state = new WindowSessionState(userDataPath);
      const first = state.createSession();
      const second = state.createSession();

      state.assignWindow(1, first.id);
      state.assignWindow(2, second.id);
      state.markFocused(1);

      const catalog = state.readCatalog();
      expect(catalog?.lastActiveSessionId).toBe(first.id);
    });
  });

  test("retains only open sessions when shutdown state is persisted", () => {
    withTempUserData((userDataPath) => {
      const state = new WindowSessionState(userDataPath);
      const first = state.createSession();
      const second = state.createSession();
      const closedBeforeQuit = state.createSession();

      state.retainSessions([first.id, second.id]);

      const catalog = state.readCatalog();
      expect(catalog?.sessions.length).toBe(2);
      expect(catalog?.sessions[0]?.id).toBe(first.id);
      expect(catalog?.sessions[1]?.id).toBe(second.id);
      expect(catalog?.sessions.some((session) => session.id === closedBeforeQuit.id)).toBe(false);
    });
  });

  test("can retain the last closed session when quitting with no open windows", () => {
    withTempUserData((userDataPath) => {
      const state = new WindowSessionState(userDataPath);
      const previous = state.createSession();
      const lastClosed = state.createSession();

      state.retainSessions([lastClosed.id]);

      const catalog = state.readCatalog();
      expect(catalog?.sessions.length).toBe(1);
      expect(catalog?.sessions[0]?.id).toBe(lastClosed.id);
      expect(catalog?.sessions.some((session) => session.id === previous.id)).toBe(false);
    });
  });

  test("saves normalized window bounds with layout updates", () => {
    withTempUserData((userDataPath) => {
      const state = new WindowSessionState(userDataPath);
      const session = state.createSession();
      state.assignWindow(1, session.id);

      const saved = state.saveLayout(1, makeLayout("files", "bounded"), {
        x: 10.2,
        y: 20.7,
        width: 1000.4,
        height: 800.8,
        mode: "normal",
      });

      expect(saved.bounds?.x).toBe(10);
      expect(saved.bounds?.y).toBe(21);
      expect(saved.bounds?.width).toBe(1000);
      expect(saved.bounds?.height).toBe(801);
      expect(saved.layout.focusedStage).toBe("files");
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

    expect(visible).toBe(true);
    expect(offscreen).toBe(false);
  });
});
