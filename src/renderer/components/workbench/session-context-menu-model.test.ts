import { describe, expect, test } from "vitest";
import type { ProjectSession } from "@/lib/types";
import {
  SESSION_CONTEXT_MENU_ACTION_IDS,
  buildSessionContextMenuItems,
} from "./session-context-menu-model";

function makeSession(overrides: Partial<ProjectSession> = {}): ProjectSession {
  const now = "2026-06-08T00:00:00.000Z";
  return {
    id: "session-1",
    projectId: "project-1",
    noThreadFallbackTitle: "Session one",
    displayTitle: "Session one",
    order: 1,
    pinned: false,
    pinnedOrder: null,
    archived: false,
    archivedAt: null,
    unread: false,
    thread: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function flattenActionIds(items: ReturnType<typeof buildSessionContextMenuItems>): string[] {
  return items.flatMap((item) => {
    if (item.type === "separator") return ["separator"];
    if (item.type === "submenu") return [item.id, ...flattenActionIds(item.submenu)];
    return [item.id];
  });
}

describe("session context menu model", () => {
  test("uses the Codex archive action id", () => {
    expect(SESSION_CONTEXT_MENU_ACTION_IDS.archive).toBe("archive-thread");
  });

  test("matches Codex action order", () => {
    const items = buildSessionContextMenuItems({
      session: makeSession({
        thread: {
          sessionId: "session-1",
          projectId: "project-1",
          threadId: "thread-1",
          threadPreview: "",
          modelProvider: "openai",
          cwd: "/tmp/project",
          statusType: "idle",
          statusActiveFlags: [],
          archived: false,
          createdAt: 1,
          updatedAt: 1,
          linkedAt: "2026-06-08T00:00:00.000Z",
        },
      }),
      projectWorkspacePath: "/tmp/project",
      platform: "darwin",
      isGitRepository: true,
    });

    expect(JSON.stringify(flattenActionIds(items))).toBe(JSON.stringify([
      SESSION_CONTEXT_MENU_ACTION_IDS.togglePin,
      SESSION_CONTEXT_MENU_ACTION_IDS.rename,
      SESSION_CONTEXT_MENU_ACTION_IDS.archive,
      "separator",
      SESSION_CONTEXT_MENU_ACTION_IDS.markUnread,
      SESSION_CONTEXT_MENU_ACTION_IDS.reveal,
      "session.copy",
      SESSION_CONTEXT_MENU_ACTION_IDS.copyWorkingDirectory,
      SESSION_CONTEXT_MENU_ACTION_IDS.copySessionId,
      SESSION_CONTEXT_MENU_ACTION_IDS.copyDeeplink,
      "session.fork",
      SESSION_CONTEXT_MENU_ACTION_IDS.forkLocal,
      SESSION_CONTEXT_MENU_ACTION_IDS.forkNewWorktree,
      "separator",
      SESSION_CONTEXT_MENU_ACTION_IDS.openInNewWindow,
    ]));
  });

  test("switches pin label and platform reveal label", () => {
    const items = buildSessionContextMenuItems({
      session: makeSession({ pinned: true, pinnedOrder: 0 }),
      projectWorkspacePath: "/tmp/project",
      platform: "win32",
    });

    expect(items[0]?.type).toBe(undefined);
    if (items[0]?.type !== "separator") {
      expect(items[0]?.label).toBe("Unpin");
    }
    const reveal = items.find((item) => item.type !== "separator" && item.id === SESSION_CONTEXT_MENU_ACTION_IDS.reveal);
    if (reveal?.type !== "separator") {
      expect(reveal?.label).toBe("Reveal in File Explorer");
    }
  });

  test("switches the explicit read-state action label in both directions", () => {
    const labelFor = (unread: boolean): string | null => {
      const item = buildSessionContextMenuItems({
        session: makeSession({ unread }),
      }).find((candidate) =>
        candidate.type !== "separator"
        && candidate.id === SESSION_CONTEXT_MENU_ACTION_IDS.markUnread
      );
      return item?.type === "separator" ? null : item?.label ?? null;
    };

    expect(labelFor(false)).toBe("Mark as unread");
    expect(labelFor(true)).toBe("Mark as read");
  });

  test("disables fork without an attached cwd and enables new worktree only for git repos", () => {
    const blankItems = buildSessionContextMenuItems({
      session: makeSession(),
      isGitRepository: true,
    });
    const blankFork = blankItems.find((item) => item.type === "submenu" && item.id === "session.fork");
    if (blankFork?.type === "submenu") {
      const localFork = blankFork.submenu[0];
      const worktreeFork = blankFork.submenu[1];
      if (localFork?.type !== "separator" && worktreeFork?.type !== "separator") {
        expect(localFork?.enabled).toBe(false);
        expect(worktreeFork?.enabled).toBe(false);
      }
    }

    const attached = makeSession({
      thread: {
        sessionId: "session-1",
        projectId: "project-1",
        threadId: "thread-1",
        threadPreview: "",
        modelProvider: "openai",
        cwd: "/tmp/project",
        statusType: "idle",
        statusActiveFlags: [],
        archived: false,
        createdAt: 1,
        updatedAt: 1,
        linkedAt: "2026-06-08T00:00:00.000Z",
      },
    });
    const nonGitItems = buildSessionContextMenuItems({ session: attached, isGitRepository: false });
    const nonGitFork = nonGitItems.find((item) => item.type === "submenu" && item.id === "session.fork");
    if (nonGitFork?.type === "submenu") {
      const localFork = nonGitFork.submenu[0];
      const worktreeFork = nonGitFork.submenu[1];
      if (localFork?.type !== "separator" && worktreeFork?.type !== "separator") {
        expect(localFork?.enabled).toBe(true);
        expect(worktreeFork?.enabled).toBe(false);
      }
    }
  });
});
