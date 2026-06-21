import { useCallback, useEffect, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CodexHostMessage } from "./types";
import type { CodexSidebarSnapshot, Project } from "./types";
import {
  invoke,
  subscribeCodexHostMessages,
  subscribeProjectChanges,
  subscribeProjectSessionChanges,
  subscribeWindowFocusChanges,
} from "./api";
import { queryKeys } from "./query-keys";
import {
  buildSidebarThreadSyncModel,
  type CodexSidebarThreadSyncModel,
} from "./codex-sidebar-thread-sync";

const EMPTY_SIDEBAR_SNAPSHOT: CodexSidebarSnapshot = {
  items: [],
  pinnedThreadIds: [],
  projectAssignments: {},
  projectlessThreadIds: [],
  generatedAt: 0,
};

function shouldInvalidateSidebarSnapshot(message: CodexHostMessage): boolean {
  if (message.type === "threadTitleUpdated" || message.type === "threadDeleted") return true;
  if (message.type !== "sharedObjectUpdated") return false;
  return message.object.objectType === "threadSummary" || message.object.objectType === "threadStartProgress";
}

export function useSidebarThreadSyncModel(input: {
  projects: readonly Project[];
}): {
  snapshot: CodexSidebarSnapshot;
  model: CodexSidebarThreadSyncModel;
  loading: boolean;
  refresh: () => Promise<CodexSidebarSnapshot>;
  setPinned: (threadId: string, pinned: boolean) => Promise<CodexSidebarSnapshot>;
} {
  const { projects } = input;
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.codexSidebar.snapshot(),
    queryFn: () => invoke("codex:sidebar:snapshot", { refresh: false }),
    staleTime: 5_000,
    refetchOnWindowFocus: true,
  });

  const invalidateSidebarSnapshot = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.codexSidebar.snapshot() });
  }, [queryClient]);

  useEffect(() => {
    let canceled = false;
    void invoke("codex:sidebar:snapshot", { refresh: true })
      .then((snapshot) => {
        if (canceled) return;
        queryClient.setQueryData(queryKeys.codexSidebar.snapshot(), snapshot);
      })
      .catch(() => undefined);
    return () => {
      canceled = true;
    };
  }, [queryClient, projects]);

  useEffect(() => subscribeCodexHostMessages((message) => {
    if (shouldInvalidateSidebarSnapshot(message)) {
      invalidateSidebarSnapshot();
    }
  }), [invalidateSidebarSnapshot]);

  useEffect(() => subscribeProjectChanges(() => {
    invalidateSidebarSnapshot();
  }), [invalidateSidebarSnapshot]);

  useEffect(() => {
    const disposers = projects.map((project) =>
      subscribeProjectSessionChanges(project.id, invalidateSidebarSnapshot)
    );
    return () => {
      for (const dispose of disposers) dispose();
    };
  }, [invalidateSidebarSnapshot, projects]);

  useEffect(() => subscribeWindowFocusChanges((focused) => {
    if (focused) invalidateSidebarSnapshot();
  }), [invalidateSidebarSnapshot]);

  const snapshot = query.data ?? EMPTY_SIDEBAR_SNAPSHOT;
  const model = useMemo(() => buildSidebarThreadSyncModel({
    snapshot,
    projects,
  }), [projects, snapshot]);

  return {
    snapshot,
    model,
    loading: query.isLoading,
    refresh: async () => {
      const refreshed = await invoke("codex:sidebar:snapshot", { refresh: true });
      queryClient.setQueryData(queryKeys.codexSidebar.snapshot(), refreshed);
      return refreshed;
    },
    setPinned: async (threadId: string, pinned: boolean) => {
      const refreshed = await invoke("codex:threads:pinned:set", threadId, { pinned });
      queryClient.setQueryData(queryKeys.codexSidebar.snapshot(), refreshed);
      queryClient.setQueryData(queryKeys.codexSidebar.pinnedThreads(), refreshed.pinnedThreadIds);
      return refreshed;
    },
  };
}
