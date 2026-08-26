export interface CodeBlockViewStateStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface CodeBlockViewStateStore {
  getWrapped(blockId: string): boolean;
  setWrapped(blockId: string, wrapped: boolean): void;
  subscribe(blockId: string, listener: () => void): () => void;
}

export function codeWrapStateStorageKey(blockId: string): string {
  return `code-wrap-${blockId}`;
}

function getBrowserStorage(): CodeBlockViewStateStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function createCodeBlockViewStateStore(
  storage: CodeBlockViewStateStorage | null = getBrowserStorage(),
): CodeBlockViewStateStore {
  const wrappedByBlockId = new Map<string, boolean>();
  const listenersByBlockId = new Map<string, Set<() => void>>();

  const getWrapped = (blockId: string): boolean => {
    const cached = wrappedByBlockId.get(blockId);
    if (cached !== undefined) return cached;

    let wrapped = false;
    try {
      wrapped = storage?.getItem(codeWrapStateStorageKey(blockId)) === "true";
    } catch {
      wrapped = false;
    }
    wrappedByBlockId.set(blockId, wrapped);
    return wrapped;
  };

  const setWrapped = (blockId: string, wrapped: boolean): void => {
    if (getWrapped(blockId) === wrapped) return;
    wrappedByBlockId.set(blockId, wrapped);
    try {
      storage?.setItem(codeWrapStateStorageKey(blockId), wrapped ? "true" : "false");
    } catch {
      // Keep the renderer session responsive even when persistence is unavailable.
    }
    for (const listener of listenersByBlockId.get(blockId) ?? []) listener();
  };

  const subscribe = (blockId: string, listener: () => void): (() => void) => {
    const listeners = listenersByBlockId.get(blockId) ?? new Set<() => void>();
    listeners.add(listener);
    listenersByBlockId.set(blockId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) listenersByBlockId.delete(blockId);
    };
  };

  return { getWrapped, setWrapped, subscribe };
}

export const codeBlockViewState = createCodeBlockViewStateStore();
