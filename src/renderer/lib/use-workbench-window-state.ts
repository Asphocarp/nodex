import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import type {
  WorkbenchLayoutSnapshotV4,
  WorkbenchLocation,
} from "../../shared/workbench-layout";
import { createDefaultWorkbenchLayoutSnapshotV4 } from "../../shared/workbench-layout";
import type { WorkbenchSessionViewSnapshot } from "../../shared/workbench-session-view";
import {
  appScope,
  scopedAtom,
  scopedDerivedAtom,
  useScopedAtom,
  useScopedAtomValue,
} from "./maitai";
import {
  closeWorkbenchRoute,
  createWorkbenchWindowState,
  navigateBackInWorkbenchWindow,
  navigateForwardInWorkbenchWindow,
  navigateWorkbenchWindow,
  openWorkbenchRoute,
  reconcileWorkbenchSessionSelection,
  removeWorkbenchSessionView,
  replaceWorkbenchWindowSnapshot,
  selectWorkbenchProject,
  selectWorkbenchSession,
  setWorkbenchDatabaseSearch,
  snapshotWorkbenchWindowState,
  updateWorkbenchSessionView,
  type WorkbenchSessionCatalogEntry,
  type WorkbenchWindowState,
} from "./workbench-window-state";

const workbenchWindowStateAtom = scopedAtom<WorkbenchWindowState | null>(
  appScope,
  null,
  { debugLabel: "workbench-window-state" },
);

export const workbenchLocationAtom = scopedDerivedAtom(
  appScope,
  (get) => get(workbenchWindowStateAtom)?.location ?? null,
  { debugLabel: "workbench-location" },
);

export const workbenchSessionViewsAtom = scopedDerivedAtom(
  appScope,
  (get) => get(workbenchWindowStateAtom)?.sessionViewsBySessionId ?? {},
  { debugLabel: "workbench-session-views" },
);

export function useWorkbenchLocation(): WorkbenchLocation | null {
  return useScopedAtomValue(workbenchLocationAtom);
}

export function useWorkbenchSessionViews(): Readonly<
  Record<string, WorkbenchSessionViewSnapshot>
> {
  return useScopedAtomValue(workbenchSessionViewsAtom);
}

export function useWorkbenchWindowState(
  initialSnapshot: WorkbenchLayoutSnapshotV4 =
    createDefaultWorkbenchLayoutSnapshotV4(),
) {
  const [storedState, setStoredState] = useScopedAtom(
    workbenchWindowStateAtom,
  );
  const initialStateRef = useRef<WorkbenchWindowState | null>(null);
  if (!initialStateRef.current) {
    initialStateRef.current = createWorkbenchWindowState(initialSnapshot);
  }
  const initialState = initialStateRef.current;
  const state = storedState ?? initialState;

  useLayoutEffect(() => {
    setStoredState((current) => current ?? initialState);
  }, [initialState, setStoredState]);

  const updateState = useCallback(
    (
      update: (
        previous: WorkbenchWindowState,
      ) => WorkbenchWindowState,
    ) => {
      setStoredState((current) => update(current ?? initialState));
    },
    [initialState, setStoredState],
  );

  const navigate = useCallback(
    (
      location: WorkbenchLocation,
      options?: { readonly record?: boolean },
    ) => {
      updateState((previous) =>
        navigateWorkbenchWindow(previous, location, options));
    },
    [updateState],
  );

  const selectSession = useCallback(
    (session: WorkbenchSessionCatalogEntry) => {
      updateState((previous) =>
        selectWorkbenchSession(previous, session));
    },
    [updateState],
  );

  const selectProject = useCallback(
    (projectId: string | null) => {
      updateState((previous) =>
        selectWorkbenchProject(previous, projectId));
    },
    [updateState],
  );

  const openRoute = useCallback(
    (route: Parameters<typeof openWorkbenchRoute>[1]) => {
      updateState((previous) =>
        openWorkbenchRoute(previous, route));
    },
    [updateState],
  );

  const closeRoute = useCallback(() => {
    updateState(closeWorkbenchRoute);
  }, [updateState]);

  const navigateBack = useCallback(() => {
    updateState(navigateBackInWorkbenchWindow);
  }, [updateState]);

  const navigateForward = useCallback(() => {
    updateState(navigateForwardInWorkbenchWindow);
  }, [updateState]);

  const setDatabaseSearch = useCallback(
    (projectId: string, value: string) => {
      updateState((previous) =>
        setWorkbenchDatabaseSearch(previous, projectId, value));
    },
    [updateState],
  );

  const setSessionView = useCallback(
    (
      sessionId: string,
      update:
        | WorkbenchSessionViewSnapshot
        | ((
            previous: WorkbenchSessionViewSnapshot | undefined,
          ) => WorkbenchSessionViewSnapshot),
    ) => {
      updateState((previous) =>
        updateWorkbenchSessionView(previous, sessionId, update));
    },
    [updateState],
  );

  const removeSessionView = useCallback(
    (sessionId: string) => {
      updateState((previous) =>
        removeWorkbenchSessionView(previous, sessionId));
    },
    [updateState],
  );

  const reconcileSelection = useCallback(
    (sessions: readonly WorkbenchSessionCatalogEntry[]) => {
      updateState((previous) =>
        reconcileWorkbenchSessionSelection(previous, sessions));
    },
    [updateState],
  );

  const replaceFromSnapshot = useCallback(
    (snapshot: WorkbenchLayoutSnapshotV4) => {
      updateState((previous) =>
        replaceWorkbenchWindowSnapshot(previous, snapshot));
    },
    [updateState],
  );
  const snapshotForPersistence = useCallback(
    () => snapshotWorkbenchWindowState(state),
    [state],
  );

  return useMemo(() => ({
    state,
    location: state.location,
    databaseSearchByProject: state.databaseSearchByProject,
    sessionViewsBySessionId: state.sessionViewsBySessionId,
    canNavigateBack: state.history.backStack.length > 0,
    canNavigateForward: state.history.forwardStack.length > 0,
    navigate,
    navigateBack,
    navigateForward,
    selectSession,
    selectProject,
    openRoute,
    closeRoute,
    setDatabaseSearch,
    setSessionView,
    removeSessionView,
    reconcileSelection,
    snapshotForPersistence,
    replaceFromSnapshot,
  }), [
    closeRoute,
    navigate,
    navigateBack,
    navigateForward,
    openRoute,
    reconcileSelection,
    removeSessionView,
    replaceFromSnapshot,
    selectProject,
    selectSession,
    setDatabaseSearch,
    setSessionView,
    snapshotForPersistence,
    state,
  ]);
}
