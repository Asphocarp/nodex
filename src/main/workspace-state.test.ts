import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { WorkspaceState, workspaceStateTestHelpers } from "./workspace-state";
import type { WorkbenchResumeSnapshot } from "../shared/workbench-resume";

function withTempUserData(run: (userDataPath: string) => void): void {
  const userDataPath = mkdtempSync(join(tmpdir(), "nodex-workspaces-"));
  try {
    run(userDataPath);
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
}

function makeLegacyResumeSnapshot(): WorkbenchResumeSnapshot {
  return {
    version: 1,
    dbProjectId: "legacy",
    threadsProjectId: "threads",
    viewsByProject: { legacy: "calendar" },
    focusedStage: "threads",
    stageNavDirection: "left",
    activeCardsTabId: "session:card",
    activeRecentSessionId: "recent-card",
    activeThreadsTabId: "thread-1",
    recentCardSessions: [
      {
        id: "recent-card",
        projectId: "legacy",
        cardId: "card-1",
        titleSnapshot: "Legacy card",
        lastOpenedAt: "2026-03-09T00:00:00.000Z",
      },
    ],
    cardStage: {
      open: true,
      projectId: "legacy",
      cardId: "card-1",
    },
  };
}

describe("WorkspaceState", () => {
  test("seeds a default workspace from legacy resume state", () => {
    withTempUserData((userDataPath) => {
      const state = new WorkspaceState(userDataPath, () => makeLegacyResumeSnapshot());
      const bootstrap = state.bootstrap();

      expect(bootstrap.activeWorkspace.id).toBe("default");
      expect(bootstrap.activeWorkspace.layout.dbProjectId).toBe("legacy");
      expect(bootstrap.activeWorkspace.layout.threadsProjectId).toBe("threads");
      expect(bootstrap.activeWorkspace.layout.focusedStage).toBe("threads");
      expect(bootstrap.activeWorkspace.layout.cardStage.cardId).toBe("card-1");
    });
  });

  test("creates, activates, renames, and deletes workspaces with fallback active selection", () => {
    withTempUserData((userDataPath) => {
      const state = new WorkspaceState(userDataPath);
      const first = state.bootstrap();
      const created = state.createWorkspace("Review", first.activeWorkspace.layout, "🚀");

      expect(created.activeWorkspace.name).toBe("Review");
      expect(created.activeWorkspace.icon).toBe("🚀");
      expect(created.catalog.workspaces.length).toBe(2);

      const renamed = state.renameWorkspace(created.activeWorkspace.id, "Review lane", "🧠");
      expect(renamed.activeWorkspace.name).toBe("Review lane");
      expect(renamed.activeWorkspace.icon).toBe("🧠");

      const clearedIcon = state.renameWorkspace(created.activeWorkspace.id, "Review lane", null);
      expect(clearedIcon.activeWorkspace.icon).toBe(undefined);

      const deleted = state.deleteWorkspace(created.activeWorkspace.id);
      expect(deleted.activeWorkspace.id).toBe("default");
      expect(deleted.catalog.workspaces.length).toBe(1);

      const deleteLast = state.deleteWorkspace("default");
      expect(deleteLast.activeWorkspace.id).toBe("default");
      expect(deleteLast.catalog.workspaces.length).toBe(1);
    });
  });

  test("normalizes invalid catalog active id to the first workspace", () => {
    const layout = workspaceStateTestHelpers.createDefaultWorkbenchLayoutSnapshot();
    const normalized = workspaceStateTestHelpers.normalizeCatalog({
      version: 1,
      lastActiveWorkspaceId: "missing",
      workspaces: [
        {
          id: "a",
          name: "A",
          icon: "not-an-icon",
          createdAt: "2026-03-09T00:00:00.000Z",
          updatedAt: "2026-03-09T00:00:00.000Z",
          layout,
        },
      ],
    }, layout);

    expect(normalized?.lastActiveWorkspaceId).toBe("a");
    expect(normalized?.workspaces.length).toBe(1);
    expect(normalized?.workspaces[0]?.icon).toBe(undefined);
  });
});
