import { useCallback, useState } from "react";
import type { PageInput, PageUpdateMutationResult } from "./types";

export interface PageStageHandlers {
  onUpdate: (
    columnId: string,
    pageId: string,
    updates: Partial<PageInput>,
  ) => Promise<PageUpdateMutationResult | void>;
  onPatch: (
    columnId: string,
    pageId: string,
    updates: Partial<PageInput>,
  ) => void;
  onDelete: (columnId: string, pageId: string) => Promise<void>;
  onMove: (fromStatus: string, pageId: string, toStatus: string) => Promise<void>;
  onCompleteOccurrence?: (pageId: string, occurrenceStart: Date) => Promise<void>;
  onSkipOccurrence?: (pageId: string, occurrenceStart: Date) => Promise<void>;
}

export interface PageStageState {
  open: boolean;
  projectId: string;
  pageId: string | null;
}

const INITIAL_STATE: PageStageState = {
  open: false,
  projectId: "",
  pageId: null,
};

export function openPageStageState(
  state: PageStageState,
  projectId: string,
  pageId: string,
): PageStageState {
  const normalizedProjectId = projectId.trim();
  const normalizedPageId = pageId.trim();
  if (!normalizedProjectId || !normalizedPageId) return state;

  if (
    state.open
    && state.projectId === normalizedProjectId
    && state.pageId === normalizedPageId
  ) {
    return state;
  }

  return {
    open: true,
    projectId: normalizedProjectId,
    pageId: normalizedPageId,
  };
}

export function closePageStageState(state: PageStageState): PageStageState {
  if (!state.open) return state;
  return {
    ...state,
    open: false,
  };
}

function normalizeInitialPageStageState(
  value: PageStageState | null | undefined,
): PageStageState {
  if (!value) return INITIAL_STATE;
  if (typeof value.open !== "boolean") return INITIAL_STATE;
  if (typeof value.projectId !== "string") return INITIAL_STATE;
  if (value.pageId !== null && typeof value.pageId !== "string") return INITIAL_STATE;
  return {
    open: value.open,
    projectId: value.projectId,
    pageId: value.pageId ?? null,
  };
}

export function usePageStageState(initialState?: PageStageState | null) {
  const [state, setState] = useState<PageStageState>(() => normalizeInitialPageStageState(initialState));

  const openPageStage = useCallback((projectId: string, pageId: string) => {
    setState((current) => openPageStageState(current, projectId, pageId));
  }, []);

  const closePageStage = useCallback(() => {
    setState((current) => closePageStageState(current));
  }, []);

  const pageStagePageId = state.open ? state.pageId ?? undefined : undefined;

  return {
    state,
    openPageStage,
    closePageStage,
    pageStagePageId,
  };
}
