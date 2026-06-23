import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import { subscribeBoardChanges } from "@/lib/api";
import { boardByProjectQueryOptions } from "@/lib/query-options";
import { queryKeys } from "@/lib/query-keys";
import type { BoardSummary, Project } from "@/lib/types";
import { useProjects } from "@/lib/use-projects";

interface BoardSummaryQueryResult {
  data?: BoardSummary;
  isError: boolean;
  isPending: boolean;
}

/**
 * Fetches boards for every project. Used by card pickers and @ mention menus.
 */
export function useBoardsForProjects(
  projects: readonly Project[],
  projectsLoading = false,
  projectsError: string | null = null,
) {
  const queryClient = useQueryClient();
  const projectIdsKey = projects.map((project) => project.id).join("\n");
  const combineBoardResults = useCallback((results: readonly BoardSummaryQueryResult[]) => {
    const boards = new Map<string, BoardSummary>();
    let failedBoardCount = 0;
    results.forEach((result, index) => {
      const project = projects[index];
      if (!project) return;
      if (result.data) {
        boards.set(project.id, result.data);
        return;
      }
      if (result.isError) failedBoardCount += 1;
    });

    const loading = projectsLoading || results.some((result) => result.isPending);
    const allBoardsFailed = projects.length > 0
      && failedBoardCount === projects.length
      && !loading;

    return {
      projects,
      boards,
      loading,
      error: projectsError ?? (allBoardsFailed ? "Something went wrong" : null),
    };
  }, [projects, projectsError, projectsLoading]);

  const boardsQuery = useQueries({
    queries: projects.map((project) => boardByProjectQueryOptions(project.id)),
    combine: combineBoardResults,
  });

  useEffect(() => {
    if (!projectIdsKey) return;

    const projectIds = projectIdsKey.split("\n");
    const unsubscribes = projectIds.map((projectId) =>
      subscribeBoardChanges(projectId, () => {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.boards.byProject(projectId),
          exact: true,
        });
      }),
    );

    return () => {
      for (const unsubscribe of unsubscribes) {
        unsubscribe();
      }
    };
  }, [projectIdsKey, queryClient]);

  return boardsQuery;
}

/**
 * Fetches boards for every project. Used by card pickers and @ mention menus.
 */
export function useAllBoards() {
  const {
    projects,
    loading: projectsLoading,
    error: projectsError,
  } = useProjects();

  return useBoardsForProjects(projects, projectsLoading, projectsError);
}
