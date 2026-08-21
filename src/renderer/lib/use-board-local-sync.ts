import type { PageInput } from "./types";

export interface BoardLocalPatchMutation {
  type: "patch";
  sourceInstanceId: symbol;
  columnId: string;
  pageId: string;
  updates: Partial<PageInput>;
}

export interface BoardLocalRefreshMutation {
  type: "refresh";
  sourceInstanceId: symbol;
}

export type BoardLocalMutation = BoardLocalPatchMutation | BoardLocalRefreshMutation;

type BoardLocalMutationListener = (mutation: BoardLocalMutation) => void;

const listenersByProjectId = new Map<string, Set<BoardLocalMutationListener>>();

export function publishBoardLocalMutation(projectId: string, mutation: BoardLocalMutation): void {
  if (!projectId) return;

  const listeners = listenersByProjectId.get(projectId);
  if (!listeners || listeners.size === 0) return;

  for (const listener of listeners) {
    listener(mutation);
  }
}

export function subscribeBoardLocalMutation(
  projectId: string,
  listener: BoardLocalMutationListener,
): () => void {
  if (!projectId) return () => {};

  const listeners = listenersByProjectId.get(projectId) ?? new Set<BoardLocalMutationListener>();
  listeners.add(listener);
  listenersByProjectId.set(projectId, listeners);

  return () => {
    const current = listenersByProjectId.get(projectId);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) {
      listenersByProjectId.delete(projectId);
    }
  };
}

export function resetBoardLocalMutationListenersForTest(): void {
  listenersByProjectId.clear();
}
