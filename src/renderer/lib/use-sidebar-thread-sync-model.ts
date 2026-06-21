import { useCallback, useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { CodexHostMessage } from "./types";
import type {
  CodexSidebarRefreshPolicy,
  CodexSidebarRefreshReason,
  CodexSidebarSnapshot,
  CodexSidebarSyncResult,
  Project,
} from "./types";
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

const SIDEBAR_THREAD_SYNC_HEARTBEAT_MS = 15_000;
const SIDEBAR_THREAD_SYNC_DEBOUNCE_MS = 300;

function resolveSidebarSyncReasonForHostMessage(
  message: CodexHostMessage,
): CodexSidebarRefreshReason | null {
  if (message.type === "threadTitleUpdated" || message.type === "threadDeleted") return "host-message";
  if (message.type !== "sharedObjectUpdated") return null;
  if (message.object.objectType === "connection") return "app-server-reconnect";
  if (message.object.objectType === "threadSummary" || message.object.objectType === "threadStartProgress") {
    return "host-message";
  }
  return null;
}

export function useSidebarThreadSyncModel(input: {
  projects: readonly Project[];
  onSessionsAffected?: (result: CodexSidebarSyncResult) => void | Promise<void>;
}): {
  snapshot: CodexSidebarSnapshot;
  model: CodexSidebarThreadSyncModel;
  loading: boolean;
  refresh: () => Promise<CodexSidebarSnapshot>;
  setPinned: (threadId: string, pinned: boolean) => Promise<CodexSidebarSnapshot>;
} {
  const { projects, onSessionsAffected } = input;
  const queryClient = useQueryClient();
  const onSessionsAffectedRef = useRef(onSessionsAffected);
  const focusedRef = useRef(true);
  const hostMessageSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    onSessionsAffectedRef.current = onSessionsAffected;
  }, [onSessionsAffected]);

  const query = useQuery({
    queryKey: queryKeys.codexSidebar.snapshot(),
    queryFn: () => invoke("codex:sidebar:snapshot", { refresh: false }),
    staleTime: 5_000,
    refetchOnWindowFocus: false,
  });

  const applySidebarSyncResult = useCallback((result: CodexSidebarSyncResult) => {
    queryClient.setQueryData(queryKeys.codexSidebar.snapshot(), result.snapshot);
    void onSessionsAffectedRef.current?.(result);
  }, [queryClient]);

  const syncSidebarThreads = useCallback(async (
    policy: CodexSidebarRefreshPolicy,
    reason: CodexSidebarRefreshReason,
  ): Promise<CodexSidebarSyncResult> => {
    const result = await invoke("codex:sidebar:sync", { policy, reason });
    applySidebarSyncResult(result);
    return result;
  }, [applySidebarSyncResult]);

  const scheduleHostMessageSync = useCallback((reason: CodexSidebarRefreshReason) => {
    if (hostMessageSyncTimerRef.current !== null) {
      clearTimeout(hostMessageSyncTimerRef.current);
    }
    hostMessageSyncTimerRef.current = setTimeout(() => {
      hostMessageSyncTimerRef.current = null;
      void syncSidebarThreads("stale", reason).catch(() => undefined);
    }, SIDEBAR_THREAD_SYNC_DEBOUNCE_MS);
  }, [syncSidebarThreads]);

  useEffect(() => () => {
    if (hostMessageSyncTimerRef.current !== null) {
      clearTimeout(hostMessageSyncTimerRef.current);
      hostMessageSyncTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    let canceled = false;
    void invoke("codex:sidebar:sync", { policy: "force", reason: "mount" })
      .then((result) => {
        if (canceled) return;
        applySidebarSyncResult(result);
      })
      .catch(() => undefined);
    return () => {
      canceled = true;
    };
  }, [applySidebarSyncResult, projects]);

  useEffect(() => subscribeCodexHostMessages((message) => {
    const reason = resolveSidebarSyncReasonForHostMessage(message);
    if (reason) scheduleHostMessageSync(reason);
  }), [scheduleHostMessageSync]);

  useEffect(() => subscribeProjectChanges(() => {
    void syncSidebarThreads("force", "project-change").catch(() => undefined);
  }), [syncSidebarThreads]);

  useEffect(() => {
    const disposers = projects.map((project) =>
      subscribeProjectSessionChanges(project.id, () => {
        void syncSidebarThreads("read", "session-change").catch(() => undefined);
      })
    );
    return () => {
      for (const dispose of disposers) dispose();
    };
  }, [projects, syncSidebarThreads]);

  useEffect(() => subscribeWindowFocusChanges((focused) => {
    focusedRef.current = focused;
    if (focused) void syncSidebarThreads("stale", "focus").catch(() => undefined);
  }), [syncSidebarThreads]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const handle = window.setInterval(() => {
      const visible = typeof document === "undefined" || document.visibilityState !== "hidden";
      if (!visible || !focusedRef.current) return;
      void syncSidebarThreads("stale", "heartbeat").catch(() => undefined);
    }, SIDEBAR_THREAD_SYNC_HEARTBEAT_MS);
    return () => window.clearInterval(handle);
  }, [syncSidebarThreads]);

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
      const result = await syncSidebarThreads("force", "manual");
      return result.snapshot;
    },
    setPinned: async (threadId: string, pinned: boolean) => {
      const refreshed = await invoke("codex:threads:pinned:set", threadId, { pinned });
      queryClient.setQueryData(queryKeys.codexSidebar.snapshot(), refreshed);
      queryClient.setQueryData(queryKeys.codexSidebar.pinnedThreads(), refreshed.pinnedThreadIds);
      return refreshed;
    },
  };
}
