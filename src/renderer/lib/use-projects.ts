import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import type {
  Project,
  ProjectCreateInput,
  ProjectLifecycleMutationResult,
  ProjectOrderInput,
  ProjectPinnedInput,
  ProjectPinnedOrderInput,
  ProjectUpdateInput,
  ProjectWindow,
} from "./types";
import { invoke, invokeCoreResult, subscribeProjectChanges } from "./api";
import { projectsListQueryOptions } from "./query-options";
import { queryKeys } from "./query-keys";
import { runSerializedProjectCatalogUpdate } from "./project-update-queue";

const PROJECTS_LIST_QUERY_KEY = queryKeys.projects.list(false);
const EMPTY_PROJECTS: Project[] = [];

// Module-scope select functions: TanStack Query re-runs `select` only when the
// cached data (or the select reference) changes, so the derived array keeps a
// stable identity across renders. Effects and stores downstream depend on that
// stability; an inline flatMap here previously fed a render loop.
const selectProjects = (
  data: InfiniteData<ProjectWindow, string | null>,
): Project[] => data.pages.flatMap((window) => window.items);

const selectArchivedProjects = (
  data: InfiniteData<ProjectWindow, string | null>,
): Project[] =>
  selectProjects(data).filter((project) => project.lifecycle === "archived");

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown error";
}

export function useProjects() {
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const projectsQuery = useInfiniteQuery({
    ...projectsListQueryOptions(),
    select: selectProjects,
  });
  const projects = projectsQuery.data ?? EMPTY_PROJECTS;

  const refreshProjects = useCallback(async () => {
    setActionError(null);
    await queryClient.invalidateQueries({
      queryKey: PROJECTS_LIST_QUERY_KEY,
      exact: true,
    });
  }, [queryClient]);

  useEffect(() => {
    return subscribeProjectChanges((event) => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.projects.all(),
      });
      if (
        event.changeType === "create"
        || event.changeType === "lifecycle"
        || event.changeType === "delete"
      ) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.projectActivity.all(),
        });
      }
    });
  }, [queryClient]);

  const { mutateAsync: createProjectRequest } = useMutation({
    mutationFn: (input: ProjectCreateInput) =>
      invokeCoreResult("projects:create", input),
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: PROJECTS_LIST_QUERY_KEY,
        exact: true,
      });
    },
  });

  const { mutateAsync: archiveProjectRequest } = useMutation({
    mutationFn: (projectId: string) => invoke(
      "projects:set-lifecycle",
      projectId,
      { lifecycle: "archived" },
    ) as Promise<ProjectLifecycleMutationResult>,
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: async (result) => {
      if (result.kind !== "updated") return;
      await queryClient.invalidateQueries({
        queryKey: queryKeys.projects.all(),
      });
      await queryClient.invalidateQueries({ queryKey: queryKeys.projectSessions.all() });
    },
  });

  const { mutateAsync: updateProjectRequest } = useMutation({
    mutationFn: ({ projectId, updates }: { projectId: string; updates: ProjectUpdateInput }) =>
      runSerializedProjectCatalogUpdate(
        projectId,
        () => invokeCoreResult("projects:update", projectId, updates),
      ),
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: PROJECTS_LIST_QUERY_KEY,
        exact: true,
      });
    },
  });

  const { mutateAsync: reorderProjectsRequest } = useMutation({
    mutationFn: (input: ProjectOrderInput) => invoke("projects:reorder", input) as Promise<void>,
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: PROJECTS_LIST_QUERY_KEY,
        exact: true,
      });
    },
    onError: async () => {
      await queryClient.invalidateQueries({
        queryKey: PROJECTS_LIST_QUERY_KEY,
        exact: true,
      });
    },
  });

  const { mutateAsync: setProjectPinnedRequest } = useMutation({
    mutationFn: ({ projectId, input }: { projectId: string; input: ProjectPinnedInput }) =>
      invoke("projects:set-pinned", projectId, input) as Promise<Project | null>,
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: PROJECTS_LIST_QUERY_KEY,
        exact: true,
      });
    },
    onError: async () => {
      await queryClient.invalidateQueries({
        queryKey: PROJECTS_LIST_QUERY_KEY,
        exact: true,
      });
    },
  });

  const { mutateAsync: setPinnedProjectOrderRequest } = useMutation({
    mutationFn: (input: ProjectPinnedOrderInput) => invoke("projects:set-pinned-order", input) as Promise<void>,
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: PROJECTS_LIST_QUERY_KEY,
        exact: true,
      });
    },
    onError: async () => {
      await queryClient.invalidateQueries({
        queryKey: PROJECTS_LIST_QUERY_KEY,
        exact: true,
      });
    },
  });

  const createProject = useCallback(
    async (input: ProjectCreateInput): Promise<Project | null> => {
      try {
        return await createProjectRequest(input);
      } catch (err) {
        setActionError(getErrorMessage(err));
        return null;
      }
    },
    [createProjectRequest],
  );

  const createProjectOrThrow = useCallback(
    async (input: ProjectCreateInput): Promise<Project> =>
      await createProjectRequest(input),
    [createProjectRequest],
  );

  const archiveProject = useCallback(
    async (projectId: string): Promise<ProjectLifecycleMutationResult> =>
      await archiveProjectRequest(projectId),
    [archiveProjectRequest],
  );

  const updateProject = useCallback(
    async (projectId: string, updates: ProjectUpdateInput): Promise<Project | null> => {
      try {
        return await updateProjectRequest({ projectId, updates });
      } catch (err) {
        setActionError(getErrorMessage(err));
        return null;
      }
    },
    [updateProjectRequest],
  );

  const updateProjectOrThrow = useCallback(
    async (
      projectId: string,
      updates: ProjectUpdateInput,
    ): Promise<Project | null> =>
      await updateProjectRequest({ projectId, updates }),
    [updateProjectRequest],
  );

  const reorderProjects = useCallback(
    async (input: ProjectOrderInput): Promise<void> => {
      try {
        await reorderProjectsRequest(input);
      } catch (err) {
        setActionError(getErrorMessage(err));
        throw err;
      }
    },
    [reorderProjectsRequest],
  );

  const setProjectPinned = useCallback(
    async (projectId: string, input: ProjectPinnedInput): Promise<Project | null> => {
      try {
        return await setProjectPinnedRequest({ projectId, input });
      } catch (err) {
        setActionError(getErrorMessage(err));
        return null;
      }
    },
    [setProjectPinnedRequest],
  );

  const setPinnedProjectOrder = useCallback(
    async (input: ProjectPinnedOrderInput): Promise<void> => {
      try {
        await setPinnedProjectOrderRequest(input);
      } catch (err) {
        setActionError(getErrorMessage(err));
        throw err;
      }
    },
    [setPinnedProjectOrderRequest],
  );

  const queryError = projectsQuery.error ? getErrorMessage(projectsQuery.error) : null;

  return {
    projects,
    hasMoreProjects: projectsQuery.hasNextPage,
    loadingMoreProjects: projectsQuery.isFetchingNextPage,
    loadMoreProjects: async () => {
      if (!projectsQuery.hasNextPage || projectsQuery.isFetchingNextPage) return;
      await projectsQuery.fetchNextPage();
    },
    loading: projectsQuery.isPending,
    ready: projectsQuery.isSuccess,
    error: actionError ?? queryError,
    refresh: refreshProjects,
    createProject,
    createProjectOrThrow,
    archiveProject,
    updateProject,
    updateProjectOrThrow,
    reorderProjects,
    setProjectPinned,
    setPinnedProjectOrder,
  };
}

export function useRemovedProjects(open: boolean) {
  const queryClient = useQueryClient();
  const projectsQuery = useInfiniteQuery({
    ...projectsListQueryOptions({ includeArchived: true }),
    select: selectArchivedProjects,
    enabled: open,
  });

  useEffect(() => subscribeProjectChanges(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.projects.all() });
  }), [queryClient]);

  const { mutateAsync: restoreProject, isPending: restoring } = useMutation({
    mutationFn: (projectId: string) => invoke(
      "projects:set-lifecycle",
      projectId,
      { lifecycle: "active" },
    ) as Promise<ProjectLifecycleMutationResult>,
    onSuccess: async (result) => {
      if (result.kind !== "updated") return;
      await queryClient.invalidateQueries({ queryKey: queryKeys.projects.all() });
      await queryClient.invalidateQueries({ queryKey: queryKeys.projectSessions.all() });
    },
  });

  return {
    projects: projectsQuery.data ?? EMPTY_PROJECTS,
    hasMoreProjects: projectsQuery.hasNextPage,
    loadingMoreProjects: projectsQuery.isFetchingNextPage,
    loadMoreProjects: async () => {
      if (!projectsQuery.hasNextPage || projectsQuery.isFetchingNextPage) return;
      await projectsQuery.fetchNextPage();
    },
    loading: projectsQuery.isPending && open,
    error: projectsQuery.error ? getErrorMessage(projectsQuery.error) : null,
    retry: projectsQuery.refetch,
    restoreProject,
    restoring,
  };
}
