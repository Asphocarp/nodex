import { describe, expect, test } from "vitest";
import {
  buildSidebarThreadSyncModel,
  sortSidebarThreadKeysForDisplay,
} from "./codex-sidebar-thread-sync";
import type { CodexSidebarSnapshot, CodexSidebarThreadItem, Project, ProjectSession } from "./types";

function makeProject(id: string, name: string): Project {
  return {
    id,
    name,
    description: null,
    icon: null,
    sources: [{ root: `/work/${id}` }],
    primaryWorkspaceRoot: `/work/${id}`,
    created: new Date("2026-01-01T00:00:00.000Z"),
    updated: new Date("2026-01-01T00:00:00.000Z"),
    pinned: false,
    pinnedOrder: null,
  } as unknown as Project;
}

function makeThread(input: {
  threadId: string;
  projectId: string | null;
  pinned?: boolean;
  updatedAt?: number;
}): CodexSidebarThreadItem {
  return {
    key: `local:${input.threadId}`,
    kind: "local",
    hostId: "local",
    threadId: input.threadId,
    sessionId: `session:${input.threadId}`,
    projectId: input.projectId,
    title: input.threadId,
    preview: "",
    cwd: input.projectId ? `/work/${input.projectId}` : null,
    updatedAt: input.updatedAt ?? 0,
    createdAt: 0,
    pinned: input.pinned === true,
    pinnedOrder: input.pinned === true ? 0 : null,
    unread: false,
    archived: false,
    statusType: "notLoaded",
    statusActiveFlags: [],
    projectless: input.projectId === null,
    disabled: false,
  };
}

function makeSnapshot(items: CodexSidebarThreadItem[]): CodexSidebarSnapshot {
  return {
    items,
    pinnedThreadIds: items.filter((item) => item.pinned).map((item) => item.threadId),
    projectAssignments: Object.fromEntries(
      items
        .filter((item): item is CodexSidebarThreadItem & { projectId: string } => typeof item.projectId === "string")
        .map((item) => [item.threadId, item.projectId]),
    ),
    projectlessThreadIds: items.filter((item) => item.projectless).map((item) => item.threadId),
    generatedAt: 1,
  };
}

function makeSession(input: {
  id: string;
  order: number;
  pinned?: boolean;
  pinnedOrder?: number | null;
  updatedAt?: string;
}): ProjectSession {
  return {
    id: input.id,
    projectId: "alpha",
    noThreadFallbackTitle: input.id,
    displayTitle: input.id,
    order: input.order,
    pinned: input.pinned === true,
    pinnedOrder: input.pinnedOrder ?? null,
    archived: false,
    archivedAt: null,
    unread: false,
    leftPaneCollapsed: false,
    panels: {} as ProjectSession["panels"],
    thread: null,
    tabs: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-01-01T00:00:00.000Z",
  };
}

describe("buildSidebarThreadSyncModel", () => {
  test("separates pinned, unpinned, project, and projectless rows", () => {
    const alpha = makeProject("alpha", "Alpha");
    const beta = makeProject("beta", "Beta");
    const pinned = makeThread({ threadId: "thread-pinned", projectId: "alpha", pinned: true });
    const alphaRecent = makeThread({ threadId: "thread-alpha", projectId: "alpha", updatedAt: 20 });
    const betaRecent = makeThread({ threadId: "thread-beta", projectId: "beta", updatedAt: 10 });
    const projectless = makeThread({ threadId: "thread-free", projectId: null, updatedAt: 5 });

    const model = buildSidebarThreadSyncModel({
      snapshot: makeSnapshot([pinned, alphaRecent, betaRecent, projectless]),
      projects: [alpha, beta],
    });

    expect(JSON.stringify(model.pinnedThreadKeys)).toBe(JSON.stringify(["local:thread-pinned"]));
    expect(JSON.stringify(model.projectGroups[0]?.threadKeys)).toBe(JSON.stringify(["local:thread-alpha"]));
    expect(JSON.stringify(model.projectGroups[1]?.threadKeys)).toBe(JSON.stringify(["local:thread-beta"]));
    expect(JSON.stringify(model.projectlessThreadKeys)).toBe(JSON.stringify(["local:thread-free"]));
  });
});

describe("sortSidebarThreadKeysForDisplay", () => {
  test("sorts snapshot and fallback rows with one display comparator", () => {
    const olderSnapshotThread = makeThread({
      threadId: "thread-older",
      projectId: "alpha",
      updatedAt: 100,
    });
    const newFallbackThread = {
      ...makeThread({
        threadId: "session-new",
        projectId: "alpha",
        updatedAt: 200,
      }),
      key: "local:session:session-new",
      sessionId: "session-new",
      title: "New thread",
    };
    const itemsByKey = new Map([
      [olderSnapshotThread.key, olderSnapshotThread],
      [newFallbackThread.key, newFallbackThread],
    ]);
    const sessionsById = new Map([
      ["session:thread-older", makeSession({
        id: "session:thread-older",
        order: 1,
      })],
      ["session-new", makeSession({
        id: "session-new",
        order: 0,
        updatedAt: "2026-01-01T00:00:01.000Z",
      })],
    ]);

    const sorted = sortSidebarThreadKeysForDisplay({
      threadKeys: [olderSnapshotThread.key, newFallbackThread.key],
      itemsByKey,
      sessionsById,
    });

    expect(JSON.stringify(sorted)).toBe(JSON.stringify([newFallbackThread.key, olderSnapshotThread.key]));
  });

  test("sorts pinned fallback rows by pinned order instead of append order", () => {
    const pinnedSnapshotThread = makeThread({
      threadId: "thread-pinned",
      projectId: "alpha",
      pinned: true,
      updatedAt: 200,
    });
    pinnedSnapshotThread.pinnedOrder = 3;
    const databaseView = {
      ...makeThread({
        threadId: "session-database-view",
        projectId: "alpha",
        pinned: true,
        updatedAt: 100,
      }),
      key: "local:session:session-database-view",
      sessionId: "session-database-view",
      title: "Database View",
      pinnedOrder: 0,
    };
    const itemsByKey = new Map([
      [pinnedSnapshotThread.key, pinnedSnapshotThread],
      [databaseView.key, databaseView],
    ]);
    const sessionsById = new Map([
      ["session:thread-pinned", makeSession({
        id: "session:thread-pinned",
        order: 1,
        pinned: true,
        pinnedOrder: 3,
      })],
      ["session-database-view", makeSession({
        id: "session-database-view",
        order: 0,
        pinned: true,
        pinnedOrder: 0,
      })],
    ]);

    const sorted = sortSidebarThreadKeysForDisplay({
      threadKeys: [pinnedSnapshotThread.key, databaseView.key],
      itemsByKey,
      sessionsById,
    });

    expect(JSON.stringify(sorted)).toBe(JSON.stringify([databaseView.key, pinnedSnapshotThread.key]));
  });
});
