import type {
  CodexSidebarSnapshot,
  CodexSidebarThreadItem,
  Project,
} from "./types";

export interface CodexSidebarProjectGroup {
  project: Project;
  threadKeys: string[];
}

export interface CodexSidebarThreadSyncModel {
  snapshot: CodexSidebarSnapshot;
  threadItemsByKey: Map<string, CodexSidebarThreadItem>;
  pinnedThreadKeys: string[];
  projectGroups: CodexSidebarProjectGroup[];
  projectlessThreadKeys: string[];
}

export function buildSidebarThreadSyncModel(input: {
  snapshot: CodexSidebarSnapshot;
  projects: readonly Project[];
}): CodexSidebarThreadSyncModel {
  const threadItemsByKey = new Map<string, CodexSidebarThreadItem>();
  for (const item of input.snapshot.items) {
    threadItemsByKey.set(item.key, item);
  }

  const pinnedThreadKeys = input.snapshot.items
    .filter((item) => item.pinned)
    .map((item) => item.key);

  const projectGroups = input.projects.map((project) => ({
    project,
    threadKeys: input.snapshot.items
      .filter((item) => item.projectId === project.id && !item.pinned)
      .map((item) => item.key),
  }));

  const projectlessThreadKeys = input.snapshot.items
    .filter((item) => item.projectless && !item.pinned)
    .map((item) => item.key);

  return {
    snapshot: input.snapshot,
    threadItemsByKey,
    pinnedThreadKeys,
    projectGroups,
    projectlessThreadKeys,
  };
}
