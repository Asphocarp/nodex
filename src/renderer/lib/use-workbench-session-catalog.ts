import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import {
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type {
  Project,
  ProjectSession,
  ProjectSessionForkInput,
  ProjectSessionForkResult,
  ProjectSessionSummary,
  ProjectSessionSummaryWindow,
} from "../../shared/types";
import type { WorkbenchLocation } from "../../shared/workbench-layout";
import { getWorkbenchSessionReturnLocation } from "../../shared/workbench-layout";
import type { WorkbenchSessionViewSnapshot } from "../../shared/workbench-session-view";
import { invoke } from "./api";
import {
  getCachedProjectSessionDetail,
  prefetchProjectSessionDetail,
  projectSessionToSummary,
  seedProjectSessionDetail,
  setProjectSessionSummaries,
} from "./project-session-query-cache";
import {
  projectSessionDetailQueryOptions,
  projectSessionSummariesQueryOptions,
} from "./query-options";
import { queryKeys } from "./query-keys";
import { materializeWorkbenchViewForProjectSession } from "./window-session-view-adapter";
import {
  presentWorkbenchSessionForLegacyView,
  projectSessionSummaryToDomain,
  type WorkbenchSessionPresentation,
  type WorkbenchSessionRenderProjection,
} from "./workbench-session-presentation";
import type { WorkbenchSessionCatalogEntry } from "./workbench-window-state";

const PROJECTLESS_SCOPE_KEY = "__projectless__";

export interface WorkbenchSessionCatalogWindowPort {
  readonly location: WorkbenchLocation;
  readonly sessionViewsBySessionId: Readonly<
    Record<string, WorkbenchSessionViewSnapshot>
  >;
  readonly setSessionView: (
    sessionId: string,
    update:
      | WorkbenchSessionViewSnapshot
      | ((
          previous: WorkbenchSessionViewSnapshot | undefined,
        ) => WorkbenchSessionViewSnapshot),
  ) => void;
  readonly selectSession: (session: WorkbenchSessionCatalogEntry) => void;
  readonly selectProject: (projectId: string | null) => void;
  readonly reconcileSelection: (
    sessions: readonly WorkbenchSessionCatalogEntry[],
  ) => void;
}

export interface UseWorkbenchSessionCatalogInput {
  readonly projects: readonly Project[];
  readonly expandedProjectIds: ReadonlySet<string>;
  readonly window: WorkbenchSessionCatalogWindowPort;
  readonly observeSessionViewMutation?: (
    sessionId: string,
    update:
      | WorkbenchSessionViewSnapshot
      | ((
          previous: WorkbenchSessionViewSnapshot | undefined,
        ) => WorkbenchSessionViewSnapshot),
  ) => void;
}

export interface WorkbenchSessionCatalog {
  readonly activeProject: Project | null;
  readonly activeProjectId: string | null;
  readonly activeSessionId: string | null;
  readonly active: WorkbenchSessionPresentation | null;
  readonly activeProjection: WorkbenchSessionRenderProjection | null;
  readonly byProject: Readonly<
    Record<string, readonly WorkbenchSessionPresentation[]>
  >;
  readonly projectless: readonly WorkbenchSessionPresentation[];
  readonly projectionsByProject: Readonly<
    Record<string, readonly WorkbenchSessionRenderProjection[]>
  >;
  readonly projectlessProjections: readonly WorkbenchSessionRenderProjection[];
  readonly known: readonly WorkbenchSessionPresentation[];
  readonly loading: boolean;
  readonly ready: boolean;
  readonly error: string | null;
  readonly hasMoreByScope: Readonly<Record<string, boolean>>;
  readonly resolveView: (
    session: ProjectSession | ProjectSessionSummary,
  ) => WorkbenchSessionViewSnapshot;
  readonly resolveDefaultDatabaseViewId: (
    projectId: string | null,
  ) => string | null;
  readonly mutateView: (
    session: ProjectSession,
    mutation: (
      view: WorkbenchSessionViewSnapshot,
    ) => WorkbenchSessionViewSnapshot,
  ) => WorkbenchSessionViewSnapshot;
  readonly findById: (
    sessionId: string,
  ) => WorkbenchSessionPresentation | null;
  readonly findByThreadId: (
    threadId: string,
  ) => WorkbenchSessionPresentation | null;
  readonly select: (
    session: ProjectSession | WorkbenchSessionPresentation,
  ) => void;
  readonly selectProject: (projectId: string | null) => void;
  readonly refresh: (
    projectId: string | null,
  ) => Promise<readonly WorkbenchSessionPresentation[]>;
  readonly loadMore: (projectId: string | null) => Promise<void>;
  readonly seed: (session: ProjectSession | null | undefined) => void;
  readonly prefetch: (sessionId: string) => Promise<ProjectSession | null>;
  readonly markUnread: (
    session: ProjectSession,
    unread: boolean,
  ) => Promise<ProjectSession | null>;
  readonly setPinned: (
    session: ProjectSession,
    pinned: boolean,
  ) => Promise<ProjectSession | null>;
  readonly rename: (
    session: ProjectSession,
    title: string,
  ) => Promise<ProjectSession>;
  readonly archive: (
    session: ProjectSession,
  ) => Promise<readonly WorkbenchSessionPresentation[]>;
  readonly ensureThreadSession: (
    threadId: string,
  ) => Promise<ProjectSession | null>;
  readonly ensureBlank: (
    projectId: string | null,
  ) => Promise<WorkbenchSessionPresentation>;
  readonly fork: (
    session: ProjectSession,
    input: ProjectSessionForkInput & {
      readonly browserViewScopeId: string;
    },
  ) => Promise<ProjectSessionForkResult>;
}

function scopeKey(projectId: string | null): string {
  return projectId ?? PROJECTLESS_SCOPE_KEY;
}

export function useWorkbenchSessionCatalog({
  projects,
  expandedProjectIds,
  window,
  observeSessionViewMutation,
}: UseWorkbenchSessionCatalogInput): WorkbenchSessionCatalog {
  const queryClient = useQueryClient();
  const sessionLocation = getWorkbenchSessionReturnLocation(window.location);
  const activeProjectId = sessionLocation.activeProjectId;
  const activeSessionId =
    sessionLocation.kind === "session" ? sessionLocation.sessionId : null;
  const projectScopeIds = useMemo(
    () => [
      ...projects
        .filter((project) =>
          expandedProjectIds.has(project.id)
          || project.id === activeProjectId
        )
        .map((project) => project.id),
      null,
    ],
    [activeProjectId, expandedProjectIds, projects],
  );

  const summaryState = useQueries({
    queries: projectScopeIds.map(projectSessionSummariesQueryOptions),
    combine: (results) => ({
      windowsByScope: Object.fromEntries(results.map((result, index) => [
        scopeKey(projectScopeIds[index] ?? null),
        result.data ?? null,
      ])) as Record<string, ProjectSessionSummaryWindow | null>,
      loading: results.some((result) => result.isPending),
      error: results.find((result) => result.error)?.error ?? null,
    }),
  });
  const materializedViewsRef = useRef<
    Record<string, WorkbenchSessionViewSnapshot>
  >({});
  const loadInFlightRef = useRef<Set<string>>(new Set());

  const resolveProjectDefaultDatabaseViewId = useCallback(
    (projectId: string | null): string | null => projectId === null
      ? null
      : projects.find((project) => project.id === projectId)
        ?.defaultDatabaseViewId ?? null,
    [projects],
  );
  const resolveView = useCallback((
    session: ProjectSession | ProjectSessionSummary,
  ): WorkbenchSessionViewSnapshot => {
    const persisted = window.sessionViewsBySessionId[session.id];
    if (persisted) return persisted;

    const cached = materializedViewsRef.current[session.id];
    if (cached) return cached;

    const materialized = materializeWorkbenchViewForProjectSession(
      session,
      resolveProjectDefaultDatabaseViewId(session.projectId),
    );
    materializedViewsRef.current[session.id] = materialized;
    return materialized;
  }, [
    resolveProjectDefaultDatabaseViewId,
    window.sessionViewsBySessionId,
  ]);

  const presentSummary = useCallback((
    summary: ProjectSessionSummary,
  ): WorkbenchSessionPresentation => {
    const detail = getCachedProjectSessionDetail(queryClient, summary.id);
    const domain = projectSessionSummaryToDomain(summary, detail ?? undefined);
    return {
      domain,
      view: resolveView(domain),
    };
  }, [queryClient, resolveView]);

  const byProject = useMemo<
    Record<string, readonly WorkbenchSessionPresentation[]>
  >(() => Object.fromEntries(projects.map((project) => [
    project.id,
    (summaryState.windowsByScope[project.id]?.items ?? []).map(presentSummary),
  ])), [presentSummary, projects, summaryState.windowsByScope]);
  const projectless = useMemo(
    () => (
      summaryState.windowsByScope[PROJECTLESS_SCOPE_KEY]?.items ?? []
    ).map(presentSummary),
    [presentSummary, summaryState.windowsByScope],
  );
  const known = useMemo(
    () => [...Object.values(byProject).flat(), ...projectless],
    [byProject, projectless],
  );
  const selectedSummaryPresentation =
    known.find((candidate) => candidate.domain.id === activeSessionId)
    ?? (activeProjectId === null ? null : byProject[activeProjectId]?.[0])
    ?? null;
  const selectedSummary = selectedSummaryPresentation?.domain ?? null;
  const selectedDetailQuery = useQuery({
    ...projectSessionDetailQueryOptions(selectedSummary?.id ?? ""),
    enabled: selectedSummary !== null,
  });
  const active = useMemo<WorkbenchSessionPresentation | null>(() => {
    if (!selectedSummaryPresentation) return null;
    const detail = selectedDetailQuery.data;
    if (!detail) return selectedSummaryPresentation;
    return {
      domain: projectSessionSummaryToDomain(
        selectedSummaryPresentation.domain,
        detail,
      ),
      view: resolveView(detail),
    };
  }, [resolveView, selectedDetailQuery.data, selectedSummaryPresentation]);

  const setSessionView = useCallback((
    sessionId: string,
    update:
      | WorkbenchSessionViewSnapshot
      | ((
          previous: WorkbenchSessionViewSnapshot | undefined,
        ) => WorkbenchSessionViewSnapshot),
  ) => {
    window.setSessionView(sessionId, update);
    observeSessionViewMutation?.(sessionId, update);
  }, [observeSessionViewMutation, window]);

  useEffect(() => {
    if (!active) return;
    if (window.sessionViewsBySessionId[active.domain.id]) return;
    setSessionView(active.domain.id, active.view);
  }, [active, setSessionView, window.sessionViewsBySessionId]);

  const catalogEntries = useMemo(
    () => known.map(({ domain }) => ({
      id: domain.id,
      projectId: domain.projectId,
    })),
    [known],
  );
  useEffect(() => {
    if (summaryState.loading) return;
    window.reconcileSelection(catalogEntries);
  }, [catalogEntries, summaryState.loading, window]);

  const mutateView = useCallback((
    session: ProjectSession,
    mutation: (
      view: WorkbenchSessionViewSnapshot,
    ) => WorkbenchSessionViewSnapshot,
  ): WorkbenchSessionViewSnapshot => {
    const current = materializedViewsRef.current[session.id]
      ?? window.sessionViewsBySessionId[session.id]
      ?? materializeWorkbenchViewForProjectSession(
        session,
        resolveProjectDefaultDatabaseViewId(session.projectId),
      );
    const next = mutation(current);
    materializedViewsRef.current[session.id] = next;
    setSessionView(session.id, next);
    return next;
  }, [
    resolveProjectDefaultDatabaseViewId,
    setSessionView,
    window.sessionViewsBySessionId,
  ]);

  const refresh = useCallback(async (
    projectId: string | null,
  ): Promise<readonly WorkbenchSessionPresentation[]> => {
    const result = await invoke("workspace:tasks:list", projectId, {
      first: 50,
    }) as ProjectSessionSummaryWindow;
    queryClient.setQueryData(
      queryKeys.projectSessions.summaries(projectId),
      result,
    );
    return result.items.map(presentSummary);
  }, [presentSummary, queryClient]);

  const loadMore = useCallback(async (
    projectId: string | null,
  ): Promise<void> => {
    const key = scopeKey(projectId);
    if (loadInFlightRef.current.has(key)) return;

    const queryKey = queryKeys.projectSessions.summaries(projectId);
    const current =
      queryClient.getQueryData<ProjectSessionSummaryWindow>(queryKey);
    if (!current?.nextCursor) return;

    loadInFlightRef.current.add(key);
    try {
      const next = await invoke("workspace:tasks:list", projectId, {
        after: current.nextCursor,
        first: 50,
      }) as ProjectSessionSummaryWindow;
      queryClient.setQueryData<ProjectSessionSummaryWindow>(
        queryKey,
        (latest) => {
          if (!latest || latest.nextCursor !== current.nextCursor) {
            return latest;
          }
          const knownIds = new Set(latest.items.map((item) => item.id));
          return {
            ...next,
            items: [
              ...latest.items,
              ...next.items.filter((item) => !knownIds.has(item.id)),
            ],
          };
        },
      );
    } finally {
      loadInFlightRef.current.delete(key);
    }
  }, [queryClient]);

  const seed = useCallback((
    session: ProjectSession | null | undefined,
  ) => {
    seedProjectSessionDetail(queryClient, session);
  }, [queryClient]);
  const prefetch = useCallback(
    async (sessionId: string) =>
      await prefetchProjectSessionDetail(queryClient, sessionId),
    [queryClient],
  );
  const markUnread = useCallback(async (
    session: ProjectSession,
    unread: boolean,
  ): Promise<ProjectSession | null> => {
    const updated = await invoke(
      "project-sessions:mark-unread",
      session.id,
      { unread },
    ) as ProjectSession | null;
    seedProjectSessionDetail(queryClient, updated);
    return updated;
  }, [queryClient]);
  const setPinned = useCallback(async (
    session: ProjectSession,
    pinned: boolean,
  ): Promise<ProjectSession | null> => {
    if (session.projectId === null) return null;
    const projectId = session.projectId;
    const previousWindow =
      queryClient.getQueryData<ProjectSessionSummaryWindow>(
        queryKeys.projectSessions.summaries(projectId),
      );
    const previousSummaries = previousWindow?.items ?? [];
    const nextPinnedOrder = pinned
      ? Math.max(
          -1,
          ...previousSummaries.map(
            (candidate) => candidate.pinnedOrder ?? -1,
          ),
        ) + 1
      : null;
    const optimistic = {
      ...session,
      pinned,
      pinnedOrder: nextPinnedOrder,
    };
    seedProjectSessionDetail(queryClient, optimistic);
    setProjectSessionSummaries(
      queryClient,
      projectId,
      previousSummaries.map((candidate) =>
        candidate.id === session.id
          ? projectSessionToSummary(optimistic)
          : candidate
      ),
    );

    try {
      const updated = await invoke(
        "project-sessions:set-pinned",
        session.id,
        { pinned },
      ) as ProjectSession | null;
      seedProjectSessionDetail(queryClient, updated);
      await refresh(projectId);
      return updated;
    } catch (error) {
      seedProjectSessionDetail(queryClient, session);
      if (previousWindow) {
        queryClient.setQueryData(
          queryKeys.projectSessions.summaries(projectId),
          previousWindow,
        );
      }
      throw error;
    }
  }, [queryClient, refresh]);
  const rename = useCallback(async (
    session: ProjectSession,
    title: string,
  ): Promise<ProjectSession> => {
    const updated = await invoke(
      "project-sessions:rename",
      session.id,
      { title },
    ) as ProjectSession | null;
    if (!updated) throw new Error("Session was not found");
    seedProjectSessionDetail(queryClient, updated);
    await refresh(updated.projectId);
    return updated;
  }, [queryClient, refresh]);
  const archive = useCallback(async (
    session: ProjectSession,
  ): Promise<readonly WorkbenchSessionPresentation[]> => {
    await invoke("project-sessions:archive", session.id);
    queryClient.removeQueries({
      queryKey: queryKeys.projectSessions.detail(session.id),
      exact: true,
    });
    return await refresh(session.projectId);
  }, [queryClient, refresh]);
  const ensureThreadSession = useCallback(async (
    threadId: string,
  ): Promise<ProjectSession | null> => {
    const ensured = await invoke(
      "codex:thread:ensure-session",
      threadId,
    ) as ProjectSession | null;
    if (!ensured) return null;
    seedProjectSessionDetail(queryClient, ensured);
    await refresh(ensured.projectId);
    return ensured;
  }, [queryClient, refresh]);
  const ensureBlank = useCallback(async (
    projectId: string | null,
  ): Promise<WorkbenchSessionPresentation> => {
    const cachedWindow =
      queryClient.getQueryData<ProjectSessionSummaryWindow>(
        queryKeys.projectSessions.summaries(projectId),
      );
    const scopedPresentations = cachedWindow
      ? projectId === null
        ? projectless
        : byProject[projectId] ?? []
      : await refresh(projectId);

    for (const candidate of scopedPresentations) {
      if (candidate.domain.thread) continue;
      const detail =
        getCachedProjectSessionDetail(queryClient, candidate.domain.id)
        ?? await prefetchProjectSessionDetail(
          queryClient,
          candidate.domain.id,
        );
      if (!detail || detail.thread) continue;
      return {
        domain: detail,
        view: resolveView(detail),
      };
    }

    const domain = await invoke("project-sessions:create", {
      projectId,
      noThreadFallbackTitle: "New thread",
    }) as ProjectSession;
    seedProjectSessionDetail(queryClient, domain);
    await refresh(projectId);
    return {
      domain,
      view: resolveView(domain),
    };
  }, [
    byProject,
    projectless,
    queryClient,
    refresh,
    resolveView,
  ]);
  const fork = useCallback(async (
    session: ProjectSession,
    input: ProjectSessionForkInput & {
      readonly browserViewScopeId: string;
    },
  ): Promise<ProjectSessionForkResult> => {
    const result = await invoke(
      "project-sessions:fork",
      session.id,
      {
        target: input.target,
        ...(input.turnId === undefined ? {} : { turnId: input.turnId }),
        ...(input.message === undefined ? {} : { message: input.message }),
        ...(input.collaborationMode === undefined
          ? {}
          : { collaborationMode: input.collaborationMode }),
        ...(input.target === "newWorktree"
          ? {
              localEnvironmentConfigPath:
                input.localEnvironmentConfigPath ?? null,
            }
          : {}),
      },
      {
        browserViewScopeId: input.browserViewScopeId,
        view: resolveView(session),
      },
    ) as ProjectSessionForkResult;
    if ("pendingWorktreeId" in result) return result;
    seedProjectSessionDetail(queryClient, result.session);
    await refresh(result.session.projectId);
    return result;
  }, [queryClient, refresh, resolveView]);
  const findById = useCallback(
    (sessionId: string) =>
      known.find((candidate) => candidate.domain.id === sessionId) ?? null,
    [known],
  );
  const findByThreadId = useCallback(
    (threadId: string) =>
      known.find(
        (candidate) => candidate.domain.thread?.threadId === threadId,
      ) ?? null,
    [known],
  );
  const select = useCallback((
    session: ProjectSession | WorkbenchSessionPresentation,
  ) => {
    const domain = "domain" in session ? session.domain : session;
    window.selectSession({
      id: domain.id,
      projectId: domain.projectId,
    });
  }, [window]);
  const selectProject = useCallback(
    (projectId: string | null) => window.selectProject(projectId),
    [window],
  );

  const projectionsByProject = useMemo(
    () => Object.fromEntries(
      Object.entries(byProject).map(([projectId, presentations]) => [
        projectId,
        presentations.map(presentWorkbenchSessionForLegacyView),
      ]),
    ),
    [byProject],
  );
  const projectlessProjections = useMemo(
    () => projectless.map(presentWorkbenchSessionForLegacyView),
    [projectless],
  );
  const activeProjection = useMemo(
    () => active ? presentWorkbenchSessionForLegacyView(active) : null,
    [active],
  );
  const hasMoreByScope = useMemo(
    () => Object.fromEntries(
      Object.entries(summaryState.windowsByScope).map(([key, result]) => [
        key,
        result?.hasMore === true,
      ]),
    ),
    [summaryState.windowsByScope],
  );
  const error = summaryState.error instanceof Error
    ? summaryState.error.message
    : summaryState.error
      ? "Unable to load project sessions"
      : null;

  return {
    activeProject:
      projects.find((project) => project.id === activeProjectId) ?? null,
    activeProjectId,
    activeSessionId,
    active,
    activeProjection,
    byProject,
    projectless,
    projectionsByProject,
    projectlessProjections,
    known,
    loading: summaryState.loading,
    ready: !summaryState.loading,
    error,
    hasMoreByScope,
    resolveView,
    resolveDefaultDatabaseViewId: resolveProjectDefaultDatabaseViewId,
    mutateView,
    findById,
    findByThreadId,
    select,
    selectProject,
    refresh,
    loadMore,
    seed,
    prefetch,
    markUnread,
    setPinned,
    rename,
    archive,
    ensureThreadSession,
    ensureBlank,
    fork,
  };
}
