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

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProjects = useCallback(async () => {
    try {
      const data = (await invoke("projects:list")) as Project[];
      setProjects(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  useEffect(() => subscribeProjectChanges(() => {
    void fetchProjects();
  }), [fetchProjects]);

  const createProject = useCallback(
    async (input: ProjectCreateInput): Promise<Project | null> => {
      try {
        const project = (await invoke("projects:create", input)) as Project;
        await fetchProjects();
        return project;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
        return null;
      }
    },
    [fetchProjects]
  );

  const deleteProject = useCallback(
    async (projectId: string): Promise<boolean> => {
      try {
        const result = (await invoke("projects:delete", projectId)) as boolean;
        if (result) await fetchProjects();
        return result;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
        return false;
      }
    },
    [fetchProjects]
  );

  const updateProject = useCallback(
    async (projectId: string, updates: ProjectUpdateInput): Promise<Project | null> => {
      try {
        const project = (await invoke("projects:update", projectId, updates)) as Project;
        await fetchProjects();
        return project;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
        return null;
      }
    },
    [fetchProjects]
  );

  const reorderProjects = useCallback(
    async (input: ProjectOrderInput): Promise<Project[]> => {
      try {
        const nextProjects = (await invoke("projects:reorder", input)) as Project[];
        setProjects(nextProjects);
        return nextProjects;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
        await fetchProjects();
        return [];
      }
    },
    [fetchProjects],
  );

  const setProjectPinned = useCallback(
    async (projectId: string, input: ProjectPinnedInput): Promise<Project | null> => {
      try {
        const project = (await invoke("projects:set-pinned", projectId, input)) as Project | null;
        await fetchProjects();
        return project;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
        await fetchProjects();
        return null;
      }
    },
    [fetchProjects],
  );

  const setPinnedProjectOrder = useCallback(
    async (input: ProjectPinnedOrderInput): Promise<Project[]> => {
      try {
        const nextProjects = (await invoke("projects:set-pinned-order", input)) as Project[];
        setProjects(nextProjects);
        return nextProjects;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
        await fetchProjects();
        return [];
      }
    },
    [fetchProjects],
  );

  return {
    projects,
    loading,
    error,
    refresh: fetchProjects,
    createProject,
    deleteProject,
    updateProject,
    reorderProjects,
    setProjectPinned,
    setPinnedProjectOrder,
  };
}
