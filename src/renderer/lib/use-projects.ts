import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import type {
  Project,
  ProjectCreateInput,
  ProjectOrderInput,
  ProjectPinnedInput,
  ProjectPinnedOrderInput,
  ProjectUpdateInput,
} from "./types";
import { invoke, subscribeProjectChanges } from "./api";
import { projectsListQueryOptions } from "./query-options";
import { queryKeys } from "./query-keys";

const PROJECTS_LIST_QUERY_KEY = queryKeys.projects.list();

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown error";
}

export function useProjects() {
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const projectsQuery = useQuery(projectsListQueryOptions());

  const refreshProjects = useCallback(async () => {
    setActionError(null);
    await queryClient.invalidateQueries({
      queryKey: PROJECTS_LIST_QUERY_KEY,
      exact: true,
    });
  }, [queryClient]);

  useEffect(() => {
    return subscribeProjectChanges(() => {
      void queryClient.invalidateQueries({
        queryKey: PROJECTS_LIST_QUERY_KEY,
        exact: true,
      });
    });
  }, [queryClient]);

  const { mutateAsync: createProjectRequest } = useMutation({
    mutationFn: (input: ProjectCreateInput) => invoke("projects:create", input) as Promise<Project>,
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

  const { mutateAsync: deleteProjectRequest } = useMutation({
    mutationFn: (projectId: string) => invoke("projects:delete", projectId) as Promise<boolean>,
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: async (result) => {
      if (!result) return;
      await queryClient.invalidateQueries({
        queryKey: PROJECTS_LIST_QUERY_KEY,
        exact: true,
      });
    },
  });

  const { mutateAsync: updateProjectRequest } = useMutation({
    mutationFn: ({ projectId, updates }: { projectId: string; updates: ProjectUpdateInput }) =>
      invoke("projects:update", projectId, updates) as Promise<Project>,
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
    mutationFn: (input: ProjectOrderInput) => invoke("projects:reorder", input) as Promise<Project[]>,
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: (nextProjects) => {
      queryClient.setQueryData<Project[]>(PROJECTS_LIST_QUERY_KEY, nextProjects);
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
    mutationFn: (input: ProjectPinnedOrderInput) => invoke("projects:set-pinned-order", input) as Promise<Project[]>,
    onMutate: () => {
      setActionError(null);
    },
    onSuccess: (nextProjects) => {
      queryClient.setQueryData<Project[]>(PROJECTS_LIST_QUERY_KEY, nextProjects);
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

  const deleteProject = useCallback(
    async (projectId: string): Promise<boolean> => {
      try {
        return await deleteProjectRequest(projectId);
      } catch (err) {
        setActionError(getErrorMessage(err));
        return false;
      }
    },
    [deleteProjectRequest],
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

  const reorderProjects = useCallback(
    async (input: ProjectOrderInput): Promise<Project[]> => {
      try {
        return await reorderProjectsRequest(input);
      } catch (err) {
        setActionError(getErrorMessage(err));
        return [];
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
    async (input: ProjectPinnedOrderInput): Promise<Project[]> => {
      try {
        return await setPinnedProjectOrderRequest(input);
      } catch (err) {
        setActionError(getErrorMessage(err));
        return [];
      }
    },
    [setPinnedProjectOrderRequest],
  );

  const queryError = projectsQuery.error ? getErrorMessage(projectsQuery.error) : null;

  return {
    projects: projectsQuery.data ?? [],
    loading: projectsQuery.isPending,
    error: actionError ?? queryError,
    refresh: refreshProjects,
    createProject,
    deleteProject,
    updateProject,
    reorderProjects,
    setProjectPinned,
    setPinnedProjectOrder,
  };
}
