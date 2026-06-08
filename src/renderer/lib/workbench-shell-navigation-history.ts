import { z } from "zod";
import { WorkbenchViewSchema } from "../../shared/schemas/workbench";
import type { WorkbenchView } from "./use-workbench-state";

const HISTORY_STORAGE_KEY = "nodex-workbench-shell-navigation-history-v1";
const MAX_HISTORY_ENTRIES = 50;

export interface WorkbenchShellNavigationSnapshot {
  activeProjectId: string;
  activeSessionId: string | null;
  activeView: WorkbenchView;
  rightActiveTabId: string | null;
  bottomActiveTabId: string | null;
  rightPanelCollapsed: boolean;
  bottomPanelCollapsed: boolean;
  rightPanelFullWidth: boolean;
}

export interface WorkbenchShellNavigationHistoryState {
  backStack: WorkbenchShellNavigationSnapshot[];
  forwardStack: WorkbenchShellNavigationSnapshot[];
}

const EMPTY_HISTORY: WorkbenchShellNavigationHistoryState = {
  backStack: [],
  forwardStack: [],
};

const WorkbenchShellNavigationSnapshotSchema = z.object({
  activeProjectId: z.string().min(1),
  activeSessionId: z.string().min(1).nullable(),
  activeView: WorkbenchViewSchema,
  rightActiveTabId: z.string().min(1).nullable(),
  bottomActiveTabId: z.string().min(1).nullable(),
  rightPanelCollapsed: z.boolean(),
  bottomPanelCollapsed: z.boolean(),
  rightPanelFullWidth: z.boolean(),
}) satisfies z.ZodType<WorkbenchShellNavigationSnapshot>;

const UnknownArraySchema = z.array(z.unknown());

const WorkbenchShellNavigationHistoryStateSchema = z.object({
  backStack: UnknownArraySchema.transform((items) =>
    items
      .map((item) => parseWorkbenchShellNavigationSnapshot(item))
      .filter((item): item is WorkbenchShellNavigationSnapshot => item !== null),
  ),
  forwardStack: UnknownArraySchema.transform((items) =>
    items
      .map((item) => parseWorkbenchShellNavigationSnapshot(item))
      .filter((item): item is WorkbenchShellNavigationSnapshot => item !== null),
  ),
}) satisfies z.ZodType<WorkbenchShellNavigationHistoryState>;

export function parseWorkbenchShellNavigationSnapshot(value: unknown): WorkbenchShellNavigationSnapshot | null {
  const parsed = WorkbenchShellNavigationSnapshotSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function normalizeWorkbenchShellNavigationHistoryState(
  value: unknown,
): WorkbenchShellNavigationHistoryState {
  const parsed = WorkbenchShellNavigationHistoryStateSchema.safeParse(value);
  if (!parsed.success) return EMPTY_HISTORY;
  return {
    backStack: parsed.data.backStack.slice(-MAX_HISTORY_ENTRIES),
    forwardStack: parsed.data.forwardStack.slice(0, MAX_HISTORY_ENTRIES),
  };
}

export function readWorkbenchShellNavigationHistoryState(): WorkbenchShellNavigationHistoryState {
  try {
    if (typeof sessionStorage === "undefined") return EMPTY_HISTORY;
    const raw = sessionStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return EMPTY_HISTORY;
    return normalizeWorkbenchShellNavigationHistoryState(JSON.parse(raw) as unknown);
  } catch {
    return EMPTY_HISTORY;
  }
}

export function writeWorkbenchShellNavigationHistoryState(
  state: WorkbenchShellNavigationHistoryState,
): WorkbenchShellNavigationHistoryState {
  const normalized = normalizeWorkbenchShellNavigationHistoryState(state);
  try {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(normalized));
    }
  } catch {
    // Keep in-memory history authoritative when browser storage is unavailable.
  }
  return normalized;
}

export function areWorkbenchShellNavigationSnapshotsEqual(
  left: WorkbenchShellNavigationSnapshot,
  right: WorkbenchShellNavigationSnapshot,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function recordWorkbenchShellNavigationTransition(
  state: WorkbenchShellNavigationHistoryState,
  current: WorkbenchShellNavigationSnapshot,
  next: WorkbenchShellNavigationSnapshot,
): WorkbenchShellNavigationHistoryState {
  if (areWorkbenchShellNavigationSnapshotsEqual(current, next)) {
    return normalizeWorkbenchShellNavigationHistoryState(state);
  }

  const normalized = normalizeWorkbenchShellNavigationHistoryState(state);
  const previousSnapshot = normalized.backStack[normalized.backStack.length - 1];
  const backStack = previousSnapshot && areWorkbenchShellNavigationSnapshotsEqual(previousSnapshot, current)
    ? normalized.backStack
    : [...normalized.backStack, current].slice(-MAX_HISTORY_ENTRIES);

  return {
    backStack,
    forwardStack: [],
  };
}

export function navigateBackInWorkbenchShellHistory(
  state: WorkbenchShellNavigationHistoryState,
  current: WorkbenchShellNavigationSnapshot,
): { historyState: WorkbenchShellNavigationHistoryState; snapshot: WorkbenchShellNavigationSnapshot | null } {
  const normalized = normalizeWorkbenchShellNavigationHistoryState(state);
  const snapshot = normalized.backStack[normalized.backStack.length - 1] ?? null;
  if (!snapshot) {
    return { historyState: normalized, snapshot: null };
  }

  return {
    historyState: {
      backStack: normalized.backStack.slice(0, -1),
      forwardStack: [current, ...normalized.forwardStack].slice(0, MAX_HISTORY_ENTRIES),
    },
    snapshot,
  };
}

export function navigateForwardInWorkbenchShellHistory(
  state: WorkbenchShellNavigationHistoryState,
  current: WorkbenchShellNavigationSnapshot,
): { historyState: WorkbenchShellNavigationHistoryState; snapshot: WorkbenchShellNavigationSnapshot | null } {
  const normalized = normalizeWorkbenchShellNavigationHistoryState(state);
  const snapshot = normalized.forwardStack[0] ?? null;
  if (!snapshot) {
    return { historyState: normalized, snapshot: null };
  }

  return {
    historyState: {
      backStack: [...normalized.backStack, current].slice(-MAX_HISTORY_ENTRIES),
      forwardStack: normalized.forwardStack.slice(1),
    },
    snapshot,
  };
}

export const workbenchShellNavigationHistoryStorageKey = HISTORY_STORAGE_KEY;

