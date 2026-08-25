export interface WorkbenchPanelTabOpenerEntry {
  readonly generation: number;
  readonly openerTabId: string;
}

export interface WorkbenchPanelTabOpenerState {
  readonly active: boolean;
  readonly generation: number;
  readonly lastSelectedTabId: string | null;
  readonly tabsById: Readonly<Record<string, WorkbenchPanelTabOpenerEntry>>;
}

export interface WorkbenchPanelTabOpenerStore {
  readonly get: (scopeKey: string) => WorkbenchPanelTabOpenerState;
  readonly recordOpened: (
    scopeKey: string,
    input: {
      readonly tabId: string;
      readonly openerTabId: string;
      readonly openedInBackground: boolean;
    },
  ) => void;
  readonly recordActivated: (
    scopeKey: string,
    tabId: string | null,
    tabIds: readonly string[],
  ) => void;
  readonly recordMoved: (scopeKey: string, tabId: string) => void;
  readonly recordClosed: (scopeKey: string, tabId: string) => void;
  readonly pruneScope: (scopeKey: string) => void;
  readonly pruneOwner: (ownerKey: string) => void;
}

const EMPTY_WORKBENCH_PANEL_TAB_OPENER_STATE: WorkbenchPanelTabOpenerState = {
  active: false,
  generation: 0,
  lastSelectedTabId: null,
  tabsById: {},
};

export function createWorkbenchPanelTabOpenerState(): WorkbenchPanelTabOpenerState {
  return EMPTY_WORKBENCH_PANEL_TAB_OPENER_STATE;
}

function isWorkbenchPanelTabDescendant(
  state: WorkbenchPanelTabOpenerState,
  tabId: string,
  ancestorTabId: string,
): boolean {
  let currentTabId = tabId;
  const visited = new Set<string>();
  while (!visited.has(currentTabId)) {
    visited.add(currentTabId);
    const openerTabId = state.tabsById[currentTabId]?.openerTabId;
    if (!openerTabId) return false;
    if (openerTabId === ancestorTabId) return true;
    currentTabId = openerTabId;
  }
  return false;
}

function resolveWorkbenchPanelTabOpenerRoot(
  state: WorkbenchPanelTabOpenerState,
  tabId: string,
): string {
  let currentTabId = tabId;
  const visited = new Set<string>();
  while (!visited.has(currentTabId)) {
    visited.add(currentTabId);
    const openerTabId = state.tabsById[currentTabId]?.openerTabId;
    if (!openerTabId) return currentTabId;
    currentTabId = openerTabId;
  }
  return currentTabId;
}

function deactivateWorkbenchPanelTabOpenerState(
  state: WorkbenchPanelTabOpenerState,
): WorkbenchPanelTabOpenerState {
  return {
    ...state,
    active: false,
    generation: state.generation + 1,
  };
}

/** Records a newly created tab whose opener still exists in the same panel group. */
export function recordWorkbenchPanelTabOpened(
  state: WorkbenchPanelTabOpenerState,
  input: {
    readonly tabId: string;
    readonly openerTabId: string;
    readonly openedInBackground: boolean;
  },
): WorkbenchPanelTabOpenerState {
  if (input.tabId === input.openerTabId || state.tabsById[input.tabId]) return state;
  return {
    ...state,
    active: true,
    lastSelectedTabId: input.openedInBackground ? state.lastSelectedTabId : input.openerTabId,
    tabsById: {
      ...state.tabsById,
      [input.tabId]: {
        generation: state.generation,
        openerTabId: input.openerTabId,
      },
    },
  };
}

/** Keeps opener affinity alive only while selection stays inside one current-generation tree. */
export function recordWorkbenchPanelTabActivated(
  state: WorkbenchPanelTabOpenerState,
  tabId: string | null,
  tabIds: readonly string[],
): WorkbenchPanelTabOpenerState {
  if (state.lastSelectedTabId === tabId) return state;
  const previousTabId = state.lastSelectedTabId;
  const selectedState = { ...state, lastSelectedTabId: tabId };
  if (!tabId) return deactivateWorkbenchPanelTabOpenerState(selectedState);

  const selectedIsCurrent = state.tabsById[tabId]?.generation === state.generation;
  const selectedOwnsCurrentChild = tabIds.some(
    (candidateTabId) =>
      state.tabsById[candidateTabId]?.openerTabId === tabId &&
      state.tabsById[candidateTabId]?.generation === state.generation,
  );
  if (!selectedIsCurrent && !selectedOwnsCurrentChild) {
    return deactivateWorkbenchPanelTabOpenerState(selectedState);
  }
  if (!previousTabId || previousTabId === tabId) return selectedState;
  if (isWorkbenchPanelTabDescendant(state, previousTabId, tabId)) return selectedState;
  if (isWorkbenchPanelTabDescendant(state, tabId, previousTabId)) return selectedState;
  if (
    resolveWorkbenchPanelTabOpenerRoot(state, previousTabId) ===
    resolveWorkbenchPanelTabOpenerRoot(state, tabId)
  ) {
    return { ...selectedState, active: true };
  }
  return deactivateWorkbenchPanelTabOpenerState(selectedState);
}

/** Reordering or moving any member of an opener tree invalidates that tree. */
export function recordWorkbenchPanelTabMoved(
  state: WorkbenchPanelTabOpenerState,
  tabId: string,
): WorkbenchPanelTabOpenerState {
  const affectsTrackedTree =
    state.tabsById[tabId] !== undefined ||
    Object.values(state.tabsById).some((entry) => entry.openerTabId === tabId);
  if (!affectsTrackedTree) return state;
  return {
    active: false,
    generation: state.generation,
    lastSelectedTabId: null,
    tabsById: {},
  };
}

/** Removes the closed tab and every relationship that descended from it. */
export function recordWorkbenchPanelTabClosed(
  state: WorkbenchPanelTabOpenerState,
  tabId: string,
): WorkbenchPanelTabOpenerState {
  const tabsById = { ...state.tabsById };
  const pendingTabIds = [tabId];
  let changed = false;
  while (pendingTabIds.length > 0) {
    const currentTabId = pendingTabIds.pop();
    if (!currentTabId) continue;
    for (const [candidateTabId, entry] of Object.entries(tabsById)) {
      if (entry.openerTabId === currentTabId) pendingTabIds.push(candidateTabId);
    }
    if (!(currentTabId in tabsById)) continue;
    delete tabsById[currentTabId];
    changed = true;
  }
  if (!changed) return state;
  return {
    ...state,
    active: Object.keys(tabsById).length > 0 ? state.active : false,
    tabsById,
  };
}

/**
 * Resolves within the closing tab's opener tree: nearest right descendant,
 * nearest left descendant, then the opener itself.
 */
export function resolveWorkbenchPanelTabOpenerCloseReplacement(
  state: WorkbenchPanelTabOpenerState,
  tabIds: readonly string[],
  closingTabId: string,
): string | null {
  const closingEntry = state.tabsById[closingTabId];
  if (!closingEntry || !state.active || closingEntry.generation !== state.generation) return null;

  let passedClosingTab = false;
  let leftCandidate: string | null = null;
  for (const candidateTabId of tabIds) {
    if (candidateTabId === closingTabId) {
      passedClosingTab = true;
      continue;
    }
    if (!isWorkbenchPanelTabDescendant(state, candidateTabId, closingEntry.openerTabId)) continue;
    if (state.tabsById[candidateTabId]?.generation !== state.generation) continue;
    if (passedClosingTab) return candidateTabId;
    leftCandidate = candidateTabId;
  }
  if (leftCandidate) return leftCandidate;
  return tabIds.includes(closingEntry.openerTabId) ? closingEntry.openerTabId : null;
}

export function createWorkbenchPanelTabOpenerStore(): WorkbenchPanelTabOpenerStore {
  const stateByScopeKey = new Map<string, WorkbenchPanelTabOpenerState>();
  const get = (scopeKey: string) =>
    stateByScopeKey.get(scopeKey) ?? EMPTY_WORKBENCH_PANEL_TAB_OPENER_STATE;
  const update = (
    scopeKey: string,
    reduce: (state: WorkbenchPanelTabOpenerState) => WorkbenchPanelTabOpenerState,
  ) => {
    const current = get(scopeKey);
    const next = reduce(current);
    if (next === current) return;
    stateByScopeKey.set(scopeKey, next);
  };

  return {
    get,
    recordOpened: (scopeKey, input) => {
      update(scopeKey, (state) => recordWorkbenchPanelTabOpened(state, input));
    },
    recordActivated: (scopeKey, tabId, tabIds) => {
      update(scopeKey, (state) => recordWorkbenchPanelTabActivated(state, tabId, tabIds));
    },
    recordMoved: (scopeKey, tabId) => {
      update(scopeKey, (state) => recordWorkbenchPanelTabMoved(state, tabId));
    },
    recordClosed: (scopeKey, tabId) => {
      update(scopeKey, (state) => recordWorkbenchPanelTabClosed(state, tabId));
    },
    pruneScope: (scopeKey) => {
      stateByScopeKey.delete(scopeKey);
    },
    pruneOwner: (ownerKey) => {
      const scopePrefix = `${ownerKey}:`;
      for (const scopeKey of stateByScopeKey.keys()) {
        if (scopeKey.startsWith(scopePrefix)) stateByScopeKey.delete(scopeKey);
      }
    },
  };
}
