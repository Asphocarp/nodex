import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";
import type {
  WorkbenchLayoutSnapshotV6,
  WorkbenchLocationV6,
} from "../../shared/workbench-layout";
import { createDefaultWorkbenchLayoutSnapshotV6 } from "../../shared/workbench-layout";
import { WorkbenchLayoutSnapshotV6Schema } from "../../shared/schemas/workbench-layout";
import {
  type WorkbenchSceneOwner,
  type WorkbenchSceneSnapshot,
} from "../../shared/workbench-scene";
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
  reconcileMissingWorkbenchSession,
  removeWorkbenchScene,
  replaceWorkbenchWindowSnapshot,
  selectWorkbenchProject,
  selectWorkbenchResource,
  selectWorkbenchSession,
  setWorkbenchDatabaseSearch,
  snapshotWorkbenchWindowState,
  updateWorkbenchScene,
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

export const workbenchScenesAtom = scopedDerivedAtom(
  appScope,
  (get) => get(workbenchWindowStateAtom)?.scenesByOwnerKey ?? {},
  { debugLabel: "workbench-scenes" },
);

export function useWorkbenchLocation(): WorkbenchLocationV6 | null {
  return useScopedAtomValue(workbenchLocationAtom);
}

export function useWorkbenchScenes(): Readonly<
  Record<string, WorkbenchSceneSnapshot>
> {
  return useScopedAtomValue(workbenchScenesAtom);
}

export function useWorkbenchWindowState(
  initialSnapshot: WorkbenchLayoutSnapshotV6 =
    createDefaultWorkbenchLayoutSnapshotV6(),
) {
  const [storedState, setStoredState] = useScopedAtom(
    workbenchWindowStateAtom,
  );
  const initialStateRef = useRef<WorkbenchWindowState | null>(null);
  if (!initialStateRef.current) {
    initialStateRef.current = createWorkbenchWindowState(
      WorkbenchLayoutSnapshotV6Schema.parse(initialSnapshot),
    );
  }
  const initialState = initialStateRef.current;
  const state = storedState ?? initialState;

  useLayoutEffect(() => {
    setStoredState((current) => current ?? initialState);
  }, [initialState, setStoredState]);

  const updateState = useCallback(
    (update: (previous: WorkbenchWindowState) => WorkbenchWindowState) => {
      setStoredState((current) => update(current ?? initialState));
    },
    [initialState, setStoredState],
  );

  const navigate = useCallback(
    (
      location: WorkbenchLocationV6,
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

  const selectResource = useCallback(
    (root: Parameters<typeof selectWorkbenchResource>[1]) => {
      updateState((previous) => selectWorkbenchResource(previous, root));
    },
    [updateState],
  );

  const openRoute = useCallback(
    (route: Parameters<typeof openWorkbenchRoute>[1]) => {
      updateState((previous) => openWorkbenchRoute(previous, route));
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

  const setScene = useCallback((
    owner: WorkbenchSceneOwner,
    update:
      | WorkbenchSceneSnapshot
      | ((previous: WorkbenchSceneSnapshot | undefined) => WorkbenchSceneSnapshot),
    options?: { readonly recordHistory?: boolean },
  ) => {
    updateState((previous) =>
      updateWorkbenchScene(previous, owner, update, options));
  }, [updateState]);

  const removeScene = useCallback((owner: WorkbenchSceneOwner) => {
    updateState((previous) => removeWorkbenchScene(previous, owner));
  }, [updateState]);

  const reconcileMissingSession = useCallback((sessionId: string) => {
    updateState((previous) =>
      reconcileMissingWorkbenchSession(previous, sessionId));
  }, [updateState]);

  const replaceFromSnapshot = useCallback(
    (snapshot: WorkbenchLayoutSnapshotV6) => {
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
    scenesByOwnerKey: state.scenesByOwnerKey,
    canNavigateBack: state.history.backStack.length > 0,
    canNavigateForward: state.history.forwardStack.length > 0,
    navigate,
    navigateBack,
    navigateForward,
    selectSession,
    selectProject,
    selectResource,
    openProject: selectProject,
    openRoute,
    closeRoute,
    setDatabaseSearch,
    setScene,
    removeScene,
    reconcileMissingSession,
    snapshotForPersistence,
    replaceFromSnapshot,
  }), [
    closeRoute,
    navigate,
    navigateBack,
    navigateForward,
    openRoute,
    removeScene,
    reconcileMissingSession,
    replaceFromSnapshot,
    selectProject,
    selectResource,
    selectSession,
    setDatabaseSearch,
    setScene,
    snapshotForPersistence,
    state,
  ]);
}
