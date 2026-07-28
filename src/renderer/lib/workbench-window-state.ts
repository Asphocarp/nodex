import type {
  WorkbenchLayoutSnapshotV4,
  WorkbenchLocation,
  WorkbenchSessionLocation,
} from "../../shared/workbench-layout";
import {
  getRestorableWorkbenchLocation,
  getWorkbenchSessionReturnLocation,
} from "../../shared/workbench-layout";
import type { WorkbenchSessionViewSnapshot } from "../../shared/workbench-session-view";

const MAX_WORKBENCH_LOCATION_HISTORY = 50;

export interface WorkbenchWindowNavigationSnapshot {
  readonly location: WorkbenchLocation;
  readonly sessionViewsBySessionId: Readonly<
    Record<string, WorkbenchSessionViewSnapshot>
  >;
}

export interface WorkbenchLocationHistory {
  readonly backStack: readonly WorkbenchWindowNavigationSnapshot[];
  readonly forwardStack: readonly WorkbenchWindowNavigationSnapshot[];
}

export interface WorkbenchWindowState {
  readonly location: WorkbenchLocation;
  readonly databaseSearchByProject: Readonly<Record<string, string>>;
  readonly sessionViewsBySessionId: Readonly<
    Record<string, WorkbenchSessionViewSnapshot>
  >;
  readonly history: WorkbenchLocationHistory;
}

export interface WorkbenchSessionCatalogEntry {
  readonly id: string;
  readonly projectId: string | null;
}

export function createWorkbenchWindowState(
  snapshot: WorkbenchLayoutSnapshotV4,
): WorkbenchWindowState {
  return {
    location: snapshot.location,
    databaseSearchByProject: snapshot.databaseSearchByProject,
    sessionViewsBySessionId: snapshot.sessionViewsBySessionId,
    history: {
      backStack: [],
      forwardStack: [],
    },
  };
}

export function areWorkbenchLocationsEqual(
  left: WorkbenchLocation,
  right: WorkbenchLocation,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function snapshotWorkbenchNavigation(
  state: WorkbenchWindowState,
): WorkbenchWindowNavigationSnapshot {
  return {
    location: state.location,
    sessionViewsBySessionId: state.sessionViewsBySessionId,
  };
}

function areWorkbenchNavigationSnapshotsEqual(
  left: WorkbenchWindowNavigationSnapshot,
  right: WorkbenchWindowNavigationSnapshot,
): boolean {
  return (
    areWorkbenchLocationsEqual(left.location, right.location)
    && left.sessionViewsBySessionId === right.sessionViewsBySessionId
  );
}

function recordWorkbenchNavigationTransition(
  previous: WorkbenchWindowState,
  next: WorkbenchWindowState,
): WorkbenchWindowState {
  const previousSnapshot = snapshotWorkbenchNavigation(previous);
  const lastSnapshot =
    previous.history.backStack[previous.history.backStack.length - 1] ?? null;
  const backStack =
    lastSnapshot
    && areWorkbenchNavigationSnapshotsEqual(lastSnapshot, previousSnapshot)
      ? previous.history.backStack
      : [...previous.history.backStack, previousSnapshot].slice(
          -MAX_WORKBENCH_LOCATION_HISTORY,
        );

  return {
    ...next,
    history: {
      backStack,
      forwardStack: [],
    },
  };
}

export function navigateWorkbenchWindow(
  state: WorkbenchWindowState,
  location: WorkbenchLocation,
  options: { readonly record?: boolean } = {},
): WorkbenchWindowState {
  if (areWorkbenchLocationsEqual(state.location, location)) return state;
  if (options.record === false) {
    return {
      ...state,
      location,
    };
  }

  const next = {
    ...state,
    location,
  };
  return recordWorkbenchNavigationTransition(state, next);
}

export function navigateBackInWorkbenchWindow(
  state: WorkbenchWindowState,
): WorkbenchWindowState {
  const snapshot =
    state.history.backStack[state.history.backStack.length - 1] ?? null;
  if (!snapshot) return state;

  return {
    ...state,
    location: snapshot.location,
    sessionViewsBySessionId: snapshot.sessionViewsBySessionId,
    history: {
      backStack: state.history.backStack.slice(0, -1),
      forwardStack: [
        snapshotWorkbenchNavigation(state),
        ...state.history.forwardStack,
      ].slice(0, MAX_WORKBENCH_LOCATION_HISTORY),
    },
  };
}

export function navigateForwardInWorkbenchWindow(
  state: WorkbenchWindowState,
): WorkbenchWindowState {
  const snapshot = state.history.forwardStack[0] ?? null;
  if (!snapshot) return state;

  return {
    ...state,
    location: snapshot.location,
    sessionViewsBySessionId: snapshot.sessionViewsBySessionId,
    history: {
      backStack: [
        ...state.history.backStack,
        snapshotWorkbenchNavigation(state),
      ].slice(-MAX_WORKBENCH_LOCATION_HISTORY),
      forwardStack: state.history.forwardStack.slice(1),
    },
  };
}

export function selectWorkbenchSession(
  state: WorkbenchWindowState,
  input: WorkbenchSessionCatalogEntry,
): WorkbenchWindowState {
  const current = getWorkbenchSessionReturnLocation(state.location);
  const activeProjectId =
    input.projectId === null ? current.activeProjectId : input.projectId;

  return navigateWorkbenchWindow(state, {
    kind: "session",
    activeProjectId,
    sessionId: input.id,
  });
}

export function selectWorkbenchProject(
  state: WorkbenchWindowState,
  projectId: string | null,
): WorkbenchWindowState {
  const current = getWorkbenchSessionReturnLocation(state.location);
  if (
    current.kind === "session"
    && current.activeProjectId === projectId
  ) {
    return state;
  }

  return navigateWorkbenchWindow(state, {
    kind: "empty",
    activeProjectId: projectId,
  });
}

export function openWorkbenchRoute(
  state: WorkbenchWindowState,
  route:
    | {
        readonly kind: "library";
        readonly target: Extract<
          WorkbenchLocation,
          { readonly kind: "library" }
        >["target"];
      }
    | { readonly kind: "settings"; readonly path: string }
    | { readonly kind: "automations"; readonly path: string }
    | {
        readonly kind: "pending-worktree";
        readonly clientThreadId: string;
      },
): WorkbenchWindowState {
  const returnTo = getWorkbenchSessionReturnLocation(state.location);
  return navigateWorkbenchWindow(state, {
    ...route,
    returnTo,
  } as WorkbenchLocation);
}

export function closeWorkbenchRoute(
  state: WorkbenchWindowState,
): WorkbenchWindowState {
  if (state.location.kind === "session" || state.location.kind === "empty") {
    return state;
  }
  return navigateWorkbenchWindow(state, state.location.returnTo);
}

export function setWorkbenchDatabaseSearch(
  state: WorkbenchWindowState,
  projectId: string,
  value: string,
): WorkbenchWindowState {
  if (state.databaseSearchByProject[projectId] === value) return state;
  return {
    ...state,
    databaseSearchByProject: {
      ...state.databaseSearchByProject,
      [projectId]: value,
    },
  };
}

export function updateWorkbenchSessionView(
  state: WorkbenchWindowState,
  sessionId: string,
  update:
    | WorkbenchSessionViewSnapshot
    | ((
        previous: WorkbenchSessionViewSnapshot | undefined,
      ) => WorkbenchSessionViewSnapshot),
): WorkbenchWindowState {
  const previous = state.sessionViewsBySessionId[sessionId];
  const next = typeof update === "function" ? update(previous) : update;
  if (previous === next) return state;

  const nextState = {
    ...state,
    sessionViewsBySessionId: {
      ...state.sessionViewsBySessionId,
      [sessionId]: next,
    },
  };
  return recordWorkbenchNavigationTransition(state, nextState);
}

export function removeWorkbenchSessionView(
  state: WorkbenchWindowState,
  sessionId: string,
): WorkbenchWindowState {
  if (!state.sessionViewsBySessionId[sessionId]) return state;
  const sessionViewsBySessionId = { ...state.sessionViewsBySessionId };
  delete sessionViewsBySessionId[sessionId];
  return {
    ...state,
    sessionViewsBySessionId,
  };
}

export function reconcileWorkbenchSessionSelection(
  state: WorkbenchWindowState,
  sessions: readonly WorkbenchSessionCatalogEntry[],
): WorkbenchWindowState {
  const current = getWorkbenchSessionReturnLocation(state.location);
  if (
    current.kind === "session"
    && sessions.some((session) => session.id === current.sessionId)
  ) {
    return state;
  }

  const projectSession = sessions.find(
    (session) => session.projectId === current.activeProjectId,
  );
  const fallback = projectSession ?? null;
  const location: WorkbenchSessionLocation = fallback
    ? {
        kind: "session",
        activeProjectId:
          fallback.projectId === null
            ? current.activeProjectId
            : fallback.projectId,
        sessionId: fallback.id,
      }
    : {
        kind: "empty",
        activeProjectId: current.activeProjectId,
      };

  if (
    state.location.kind !== "session"
    && state.location.kind !== "empty"
  ) {
    if (areWorkbenchLocationsEqual(state.location.returnTo, location)) {
      return state;
    }
    return {
      ...state,
      location: {
        ...state.location,
        returnTo: location,
      },
    };
  }

  return navigateWorkbenchWindow(state, location, { record: false });
}

export function replaceWorkbenchWindowSnapshot(
  state: WorkbenchWindowState,
  snapshot: WorkbenchLayoutSnapshotV4,
): WorkbenchWindowState {
  return {
    ...createWorkbenchWindowState(snapshot),
    history: state.history,
  };
}

export function snapshotWorkbenchWindowState(
  state: WorkbenchWindowState,
): WorkbenchLayoutSnapshotV4 {
  return {
    version: 4,
    location: getRestorableWorkbenchLocation(state.location),
    databaseSearchByProject: {
      ...state.databaseSearchByProject,
    },
    sessionViewsBySessionId: {
      ...state.sessionViewsBySessionId,
    },
  };
}

export const workbenchWindowStateLimits = {
  maxHistoryEntries: MAX_WORKBENCH_LOCATION_HISTORY,
};
