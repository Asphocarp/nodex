import {
  clampBoardColumnWidth,
  DEFAULT_BOARD_COLUMN_WIDTH,
  type BoardColumnLayout,
} from "./board-column-layout";

export type DatabaseBoardColumnLayoutPrefs = Readonly<Record<string, BoardColumnLayout>>;

const STORAGE_KEY_PREFIX = "nodex-database-board-column-layout-v1";

const storageKey = (scope: string): string => `${STORAGE_KEY_PREFIX}:${scope}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const databaseBoardColumnLayoutScope = ({
  viewId,
  groupPropertyId,
}: {
  readonly viewId: string;
  readonly groupPropertyId: string | null;
}): string => `${viewId}:${groupPropertyId ?? "ungrouped"}`;

export const getDatabaseBoardColumnLayout = (
  prefs: DatabaseBoardColumnLayoutPrefs,
  pathKey: string,
): BoardColumnLayout => prefs[pathKey] ?? {
  collapsed: false,
  width: DEFAULT_BOARD_COLUMN_WIDTH,
};

export const normalizeDatabaseBoardColumnLayoutPrefs = (
  value: unknown,
): DatabaseBoardColumnLayoutPrefs => {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([pathKey, candidate]) => {
    if (!pathKey || !isRecord(candidate)) return [];
    return [[pathKey, {
      collapsed: candidate.collapsed === true,
      width: clampBoardColumnWidth(candidate.width),
    }]];
  }));
};

export const readDatabaseBoardColumnLayoutPrefs = (
  scope: string,
): DatabaseBoardColumnLayoutPrefs => {
  try {
    const raw = localStorage.getItem(storageKey(scope));
    return raw
      ? normalizeDatabaseBoardColumnLayoutPrefs(JSON.parse(raw) as unknown)
      : {};
  } catch {
    return {};
  }
};

export const updateDatabaseBoardColumnLayoutPrefs = (
  scope: string,
  current: DatabaseBoardColumnLayoutPrefs,
  pathKey: string,
  patch: Partial<BoardColumnLayout>,
): DatabaseBoardColumnLayoutPrefs => {
  const previous = getDatabaseBoardColumnLayout(current, pathKey);
  const next = normalizeDatabaseBoardColumnLayoutPrefs({
    ...current,
    [pathKey]: {
      collapsed: patch.collapsed ?? previous.collapsed,
      width: patch.width === undefined
        ? previous.width
        : clampBoardColumnWidth(patch.width),
    },
  });
  try {
    localStorage.setItem(storageKey(scope), JSON.stringify(next));
  } catch {
    // Column preferences remain usable in-memory when storage is unavailable.
  }
  return next;
};
