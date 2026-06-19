import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { subscribeBoardChanges } from "@/lib/api";
import { boardByProjectQueryOptions } from "@/lib/query-options";
import { queryKeys } from "@/lib/query-keys";
import type { BoardSummary } from "@/lib/types";
import { useProjects } from "@/lib/use-projects";

/**
 * Fetches boards for every project. Used by card pickers and @ mention menus.
 */
export function useAllBoards() {
  const queryClient = useQueryClient();
  const {
    projects,
    loading: projectsLoading,
    error: projectsError,
  } = useProjects();
  const projectIdsKey = projects.map((project) => project.id).join("\n");

  const boardsQuery = useQueries({
    queries: projects.map((project) => boardByProjectQueryOptions(project.id)),
    combine: (results) => {
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
    },
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
