import type {
  CodexSidebarSnapshot,
  CodexSidebarThreadItem,
  Project,
  ProjectSession,
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

type SidebarThreadSortSession = Pick<
  ProjectSession,
  "id" | "order" | "pinned" | "pinnedOrder" | "createdAt" | "updatedAt" | "thread"
>;

interface SidebarThreadSortEntry {
  key: string;
  item: CodexSidebarThreadItem;
  session: SidebarThreadSortSession | null;
  sourceIndex: number;
}

function parseDateMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function finiteNumberOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function resolveItemPinned(entry: SidebarThreadSortEntry): boolean {
  return entry.session?.pinned ?? entry.item.pinned;
}

function resolveItemPinnedOrder(entry: SidebarThreadSortEntry): number {
  return entry.session?.pinnedOrder ?? entry.item.pinnedOrder ?? Number.MAX_SAFE_INTEGER;
}

function resolveItemUpdatedAt(entry: SidebarThreadSortEntry): number {
  return finiteNumberOrNull(entry.item.updatedAt)
    ?? parseDateMs(entry.session?.updatedAt)
    ?? 0;
}

function resolveItemCreatedAt(entry: SidebarThreadSortEntry): number {
  return finiteNumberOrNull(entry.item.createdAt)
    ?? parseDateMs(entry.session?.createdAt)
    ?? 0;
}

function resolveItemSessionOrder(entry: SidebarThreadSortEntry): number {
  return entry.session ? entry.session.order : Number.MAX_SAFE_INTEGER;
}

function isLocalNoThreadSessionEntry(entry: SidebarThreadSortEntry): boolean {
  return entry.session !== null && entry.session.thread === null;
}

function compareSidebarThreadSortEntries(left: SidebarThreadSortEntry, right: SidebarThreadSortEntry): number {
  const leftPinned = resolveItemPinned(left);
  const rightPinned = resolveItemPinned(right);
  if (leftPinned !== rightPinned) return leftPinned ? -1 : 1;

  if (leftPinned && rightPinned) {
    const pinnedOrderDelta = resolveItemPinnedOrder(left) - resolveItemPinnedOrder(right);
    if (pinnedOrderDelta !== 0) return pinnedOrderDelta;
  }

  if (isLocalNoThreadSessionEntry(left) || isLocalNoThreadSessionEntry(right)) {
    const sessionOrderDelta = resolveItemSessionOrder(left) - resolveItemSessionOrder(right);
    if (sessionOrderDelta !== 0) return sessionOrderDelta;
  }

  const updatedAtDelta = resolveItemUpdatedAt(right) - resolveItemUpdatedAt(left);
  if (updatedAtDelta !== 0) return updatedAtDelta;

  const sessionOrderDelta = resolveItemSessionOrder(left) - resolveItemSessionOrder(right);
  if (sessionOrderDelta !== 0) return sessionOrderDelta;

  const createdAtDelta = resolveItemCreatedAt(right) - resolveItemCreatedAt(left);
  if (createdAtDelta !== 0) return createdAtDelta;

  if (left.sourceIndex !== right.sourceIndex) return left.sourceIndex - right.sourceIndex;
  return left.key.localeCompare(right.key);
}

export function sortSidebarThreadKeysForDisplay(input: {
  threadKeys: readonly string[];
  itemsByKey: ReadonlyMap<string, CodexSidebarThreadItem>;
  sessionsById: ReadonlyMap<string, SidebarThreadSortSession>;
}): string[] {
  return input.threadKeys
    .flatMap((key, sourceIndex): SidebarThreadSortEntry[] => {
      const item = input.itemsByKey.get(key);
      if (!item) return [];
      const session = item.sessionId ? input.sessionsById.get(item.sessionId) ?? null : null;
      return [{ key, item, session, sourceIndex }];
    })
    .sort(compareSidebarThreadSortEntries)
    .map((entry) => entry.key);
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
