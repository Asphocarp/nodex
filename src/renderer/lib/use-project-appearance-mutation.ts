import {
  useMutation,
  useQueryClient,
  type InfiniteData,
} from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { toast } from "@/components/ui/toast";
import type { ProjectAppearance } from "../../shared/project-appearance";
import { invoke } from "./api";
import { queryKeys } from "./query-keys";
import { runSerializedProjectCatalogUpdate } from "./project-update-queue";
import type { Project, ProjectWindow } from "./types";

interface ProjectAppearanceMutationContext {
  sequence: number;
}

interface ProjectAppearanceMutationVariables {
  appearance: ProjectAppearance;
  sequence: number;
}

export function patchProjectAppearanceInWindow(
  data: InfiniteData<ProjectWindow, string | null> | undefined,
  projectId: string,
  appearance: ProjectAppearance,
): InfiniteData<ProjectWindow, string | null> | undefined {
  if (!data) return data;

  let changed = false;
  const pages = data.pages.map((page) => {
    let pageChanged = false;
    const items = page.items.map((project) => {
      if (project.id !== projectId) return project;
      changed = true;
      pageChanged = true;
      return { ...project, appearance };
    });
    return pageChanged ? { ...page, items } : page;
  });
  if (!changed) return data;

  return { ...data, pages };
}

export function useProjectAppearanceMutation(
  project: Project,
) {
  const queryClient = useQueryClient();
  const projectId = project.id;
  const latestSequenceRef = useRef(0);
  const pendingCountRef = useRef(0);
  const confirmedProjectRef = useRef(project);
  const latestSettlementRef = useRef<Promise<Project>>(Promise.resolve(project));

  const mutation = useMutation<
    Project,
    Error,
    ProjectAppearanceMutationVariables,
    ProjectAppearanceMutationContext
  >({
    scope: { id: `project-appearance:${projectId}` },
    mutationFn: async ({ appearance }) => {
      const project = await runSerializedProjectCatalogUpdate(
        projectId,
        () => invoke("projects:update", projectId, {
          appearance,
        }) as Promise<Project | null>,
      );
      if (!project) {
        throw new Error("The project is no longer available");
      }
      confirmedProjectRef.current = project;
      return project;
    },
    onMutate: async ({ appearance, sequence }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.projects.all() });
      if (sequence !== latestSequenceRef.current) return { sequence };
      queryClient.setQueriesData<InfiniteData<ProjectWindow, string | null>>(
        { queryKey: queryKeys.projects.all() },
        (current) => patchProjectAppearanceInWindow(
          current,
          projectId,
          appearance,
        ),
      );
      return { sequence };
    },
    onSuccess: (project, _variables, context) => {
      if (context.sequence !== latestSequenceRef.current) return;
      queryClient.setQueriesData<InfiniteData<ProjectWindow, string | null>>(
        { queryKey: queryKeys.projects.all() },
        (current) => patchProjectAppearanceInWindow(
          current,
          projectId,
          project.appearance,
        ),
      );
    },
    onError: (error, _variables, context) => {
      if (context?.sequence === latestSequenceRef.current) {
        queryClient.setQueriesData<InfiniteData<ProjectWindow, string | null>>(
          { queryKey: queryKeys.projects.all() },
          (current) => patchProjectAppearanceInWindow(
            current,
            projectId,
            confirmedProjectRef.current.appearance,
          ),
        );
      }
      toast.danger("Could not update project marker", {
        description: error.message,
      });
    },
    onSettled: async (_project, _error, _variables, context) => {
      pendingCountRef.current = Math.max(0, pendingCountRef.current - 1);
      if (context?.sequence !== latestSequenceRef.current) return;
      await queryClient.invalidateQueries({
        queryKey: queryKeys.projects.all(),
      });
    },
  });

  useEffect(() => {
    if (pendingCountRef.current > 0) return;
    confirmedProjectRef.current = project;
    latestSettlementRef.current = Promise.resolve(project);
  }, [project]);

  const makeVariables = (
    appearance: ProjectAppearance,
  ): ProjectAppearanceMutationVariables => {
    const sequence = latestSequenceRef.current + 1;
    latestSequenceRef.current = sequence;
    pendingCountRef.current += 1;
    return { appearance, sequence };
  };

  const changeAppearanceAsync = (appearance: ProjectAppearance) => {
    const request = mutation.mutateAsync(makeVariables(appearance));
    const settlement = request.catch(() => confirmedProjectRef.current);
    latestSettlementRef.current = settlement;
    return request;
  };

  const waitForSettledProject = async (): Promise<Project> => {
    if (pendingCountRef.current === 0) return confirmedProjectRef.current;
    while (true) {
      const settlement = latestSettlementRef.current;
      const settledProject = await settlement;
      if (settlement === latestSettlementRef.current) return settledProject;
    }
  };

  return {
    changeAppearance: (appearance: ProjectAppearance) => {
      void changeAppearanceAsync(appearance).catch(() => undefined);
    },
    changeAppearanceAsync,
    error: mutation.error,
    pending: mutation.isPending,
    waitForSettledProject,
  };
}
