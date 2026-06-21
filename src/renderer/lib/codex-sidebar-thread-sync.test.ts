import { describe, expect, test } from "bun:test";
import { buildSidebarThreadSyncModel } from "./codex-sidebar-thread-sync";
import type { CodexSidebarSnapshot, CodexSidebarThreadItem, Project } from "./types";

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
