import type { PageStageState } from "./use-page-stage";
import type { StageId, StageNavDirection, WorkbenchView } from "./use-workbench-state";
import {
  parseNavigationHistoryState as parseNavigationHistoryStateWithSchema,
  parseNavigationSnapshot as parseNavigationSnapshotWithSchema,
} from "./workbench-persisted-schemas";

const HISTORY_STORAGE_KEY = "nodex-workbench-navigation-history-v2";
const MAX_HISTORY_ENTRIES = 50;

export interface NavigationSnapshot {
  dbProjectId: string;
  activeView: WorkbenchView;
  focusedStage: StageId;
  stageNavDirection: StageNavDirection;
  pageStage: PageStageState;
  activePagesTabId: string;
  activeRecentSessionId: string | null;
  threadsProjectId: string;
  activeThreadsTabId: string;
  activeFilesTabId: string;
}

export interface NavigationHistoryState {
  backStack: NavigationSnapshot[];
  forwardStack: NavigationSnapshot[];
}

const EMPTY_HISTORY: NavigationHistoryState = {
  backStack: [],
  forwardStack: [],
};

export function normalizeNavigationSnapshot(value: unknown): NavigationSnapshot | null {
  return parseNavigationSnapshotWithSchema(value);
}

export function normalizeNavigationHistoryState(value: unknown): NavigationHistoryState {
  return parseNavigationHistoryStateWithSchema(value, MAX_HISTORY_ENTRIES);
}

export function readNavigationHistoryState(): NavigationHistoryState {
  try {
    if (typeof sessionStorage === "undefined") return EMPTY_HISTORY;
    const raw = sessionStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return EMPTY_HISTORY;
    return normalizeNavigationHistoryState(JSON.parse(raw));
  } catch {
    return EMPTY_HISTORY;
  }
}

export function writeNavigationHistoryState(state: NavigationHistoryState): NavigationHistoryState {
  const normalized = normalizeNavigationHistoryState(state);
  try {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(normalized));
    }
  } catch {
    // Ignore storage write failures and keep runtime state.
  }
  return normalized;
}

export function areNavigationSnapshotsEqual(left: NavigationSnapshot, right: NavigationSnapshot): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function recordNavigationTransition(
  state: NavigationHistoryState,
  current: NavigationSnapshot,
  next: NavigationSnapshot,
): NavigationHistoryState {
  if (areNavigationSnapshotsEqual(current, next)) return normalizeNavigationHistoryState(state);
  const normalized = normalizeNavigationHistoryState(state);
  const existingBackStack = normalized.backStack;
  const previousSnapshot = existingBackStack[existingBackStack.length - 1];
  const nextBackStack = previousSnapshot && areNavigationSnapshotsEqual(previousSnapshot, current)
    ? existingBackStack
    : [...existingBackStack, current].slice(-MAX_HISTORY_ENTRIES);
  return {
    backStack: nextBackStack,
    forwardStack: [],
  };
}

export function navigateBackInHistory(
  state: NavigationHistoryState,
  current: NavigationSnapshot,
): { historyState: NavigationHistoryState; snapshot: NavigationSnapshot | null } {
  const normalized = normalizeNavigationHistoryState(state);
  const snapshot = normalized.backStack[normalized.backStack.length - 1] ?? null;
  if (!snapshot) {
    return {
      historyState: normalized,
      snapshot: null,
    };
  }

  return {
    historyState: {
      backStack: normalized.backStack.slice(0, -1),
      forwardStack: [current, ...normalized.forwardStack].slice(0, MAX_HISTORY_ENTRIES),
    },
    snapshot,
  };
}

export function navigateForwardInHistory(
  state: NavigationHistoryState,
  current: NavigationSnapshot,
): { historyState: NavigationHistoryState; snapshot: NavigationSnapshot | null } {
  const normalized = normalizeNavigationHistoryState(state);
  const snapshot = normalized.forwardStack[0] ?? null;
  if (!snapshot) {
    return {
      historyState: normalized,
      snapshot: null,
    };
  }

  return {
    historyState: {
      backStack: [...normalized.backStack, current].slice(-MAX_HISTORY_ENTRIES),
      forwardStack: normalized.forwardStack.slice(1),
    },
    snapshot,
  };
}

export const navigationHistoryStorageKey = HISTORY_STORAGE_KEY;

export const navigationHistoryTestHelpers = {
  normalizeNavigationSnapshot,
  normalizeNavigationHistoryState,
  MAX_HISTORY_ENTRIES,
};
