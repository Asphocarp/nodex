import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { subscribeBoardChanges } from "@/lib/api";
import { boardByProjectQueryOptions } from "@/lib/query-options";
import { queryKeys } from "@/lib/query-keys";
import type { Board } from "@/lib/types";
import { useProjects } from "@/lib/use-projects";

/**
 * Fetches boards for every project. Used by card pickers and @ mention menus.
 */
export function useAllBoards() {
  const queryClient = useQueryClient();
  const { projects, loading: projectsLoading } = useProjects();
  const projectIdsKey = projects.map((project) => project.id).join("\n");

  const boardsQuery = useQueries({
    queries: projects.map((project) => boardByProjectQueryOptions(project.id)),
    combine: (results) => {
      const boards = new Map<string, Board>();
      results.forEach((result, index) => {
        const project = projects[index];
        if (!project || !result.data) return;
        boards.set(project.id, result.data);
      });

      return {
        boards,
        loading: projectsLoading || results.some((result) => result.isPending),
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
