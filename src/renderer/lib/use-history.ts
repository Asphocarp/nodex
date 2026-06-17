import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import type { UndoRedoResult, UndoRedoState } from "../../shared/ipc-api";
import { toast } from "@/components/ui/toast";
import type { HistoryRecentResult } from "./query-options";
import { queryKeys } from "./query-keys";
import { invoke } from "./use-history-deps";

export type { UndoRedoState };

function pickUndoRedoState(data: UndoRedoState | null | undefined): UndoRedoState {
  return {
    canUndo: data?.canUndo ?? false,
    canRedo: data?.canRedo ?? false,
    undoDescription: data?.undoDescription ?? null,
    redoDescription: data?.redoDescription ?? null,
  };
}

export function useHistory(projectId: string) {
  const queryClient = useQueryClient();
  // Generate a unique session ID for this browser session
  const [sessionId] = useState(() => {
    const stored = sessionStorage.getItem("kanban-session-id");
    if (stored) return stored;
    const newId = crypto.randomUUID();
    sessionStorage.setItem("kanban-session-id", newId);
    return newId;
  });

  const { data: recentHistory } = useQuery({
    queryKey: queryKeys.history.recent(projectId, sessionId),
    queryFn: () => invoke("history:recent", projectId, sessionId) as Promise<HistoryRecentResult>,
    enabled: projectId.trim().length > 0,
  });
  const state = pickUndoRedoState(recentHistory);

  // Track if we're currently performing an undo/redo to prevent double actions
  const isActingRef = useRef(false);

  const refreshState = useCallback(async () => {
    try {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.history.recent(projectId, sessionId),
        exact: true,
      });
    } catch (err) {
      console.error("Failed to refresh history state:", err);
    }
  }, [projectId, queryClient, sessionId]);

  const updateRecentCache = useCallback((data: UndoRedoResult) => {
    queryClient.setQueryData<HistoryRecentResult>(
      queryKeys.history.recent(projectId, sessionId),
      (current) => ({
        entries: current?.entries ?? [],
        canUndo: data.canUndo,
        canRedo: data.canRedo,
        undoDescription: data.undoDescription,
        redoDescription: data.redoDescription,
      }),
    );
  }, [projectId, queryClient, sessionId]);

  const { mutateAsync: undoRequest } = useMutation({
    mutationFn: () => invoke("history:undo", projectId, sessionId) as Promise<UndoRedoResult>,
    onSuccess: async (data) => {
      if (!data.success) return;
      updateRecentCache(data);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.boards.byProject(projectId),
        exact: true,
      });
    },
  });

  const { mutateAsync: redoRequest } = useMutation({
    mutationFn: () => invoke("history:redo", projectId, sessionId) as Promise<UndoRedoResult>,
    onSuccess: async (data) => {
      if (!data.success) return;
      updateRecentCache(data);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.boards.byProject(projectId),
        exact: true,
      });
    },
  });

  const undo = useCallback(async (): Promise<boolean> => {
    if (isActingRef.current || !state.canUndo) return false;

    isActingRef.current = true;
    try {
      const data = await undoRequest();
      if (data.success && data.entry) {
        toast.info(getActionDescription("undo", data.entry.operation), {
          id: "history-action",
        });
      }

      return data.success;
    } catch (err) {
      console.error("Failed to undo:", err);
      return false;
    } finally {
      isActingRef.current = false;
    }
  }, [state.canUndo, undoRequest]);

  const redo = useCallback(async (): Promise<boolean> => {
    if (isActingRef.current || !state.canRedo) return false;

    isActingRef.current = true;
    try {
      const data = await redoRequest();
      if (data.success && data.entry) {
        toast.info(getActionDescription("redo", data.entry.operation), {
          id: "history-action",
        });
      }

      return data.success;
    } catch (err) {
      console.error("Failed to redo:", err);
      return false;
    } finally {
      isActingRef.current = false;
    }
  }, [redoRequest, state.canRedo]);

  return {
    sessionId,
    canUndo: state.canUndo,
    canRedo: state.canRedo,
    undoDescription: state.undoDescription,
    redoDescription: state.redoDescription,
    undo,
    redo,
    refreshState,
  };
}

function getActionDescription(
  action: "undo" | "redo",
  operation: string
): string {
  const verb = action === "undo" ? "Undid" : "Redid";
  switch (operation) {
    case "create":
      return `${verb} card creation`;
    case "delete":
      return `${verb} card deletion`;
    case "move":
      return `${verb} card move`;
    case "update":
      return `${verb} card update`;
    default:
      return `${verb} action`;
  }
}
