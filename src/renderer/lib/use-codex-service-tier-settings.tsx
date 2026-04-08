import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { CodexServiceTier } from "./types";
import {
  CODEX_DEFAULT_SERVICE_TIER_STORAGE_KEY,
  readCodexServiceTier,
  writeCodexServiceTier,
} from "./codex-service-tier-settings";

export interface CodexServiceTierSettingsSnapshot {
  serviceTier: CodexServiceTier;
  isLoading: false;
}

export type CodexServiceTierChangeSource = "settings" | "composer_menu" | string;

interface CodexServiceTierSettingsContextValue {
  serviceTierSettings: CodexServiceTierSettingsSnapshot;
  setServiceTier: (nextTier: CodexServiceTier, source: CodexServiceTierChangeSource) => void;
}

const DEFAULT_SNAPSHOT: CodexServiceTierSettingsSnapshot = {
  serviceTier: null,
  isLoading: false,
};

const listeners = new Set<() => void>();
let storageListenerBound = false;
let snapshotCache = DEFAULT_SNAPSHOT;

function getSnapshot(): CodexServiceTierSettingsSnapshot {
  const serviceTier = readCodexServiceTier();
  if (snapshotCache.serviceTier === serviceTier) {
    return snapshotCache;
  }

  snapshotCache = {
    serviceTier,
    isLoading: false,
  };
  return snapshotCache;
}

function emitSnapshotChange(): void {
  for (const listener of listeners) {
    listener();
  }
}

function bindStorageListener(): void {
  if (storageListenerBound || typeof window === "undefined") return;
  window.addEventListener("storage", handleStorageEvent);
  storageListenerBound = true;
}

function unbindStorageListener(): void {
  if (!storageListenerBound || typeof window === "undefined" || listeners.size > 0) return;
  window.removeEventListener("storage", handleStorageEvent);
  storageListenerBound = false;
}

function handleStorageEvent(event: StorageEvent): void {
  if (event.key !== null && event.key !== CODEX_DEFAULT_SERVICE_TIER_STORAGE_KEY) return;
  emitSnapshotChange();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  bindStorageListener();
  return () => {
    listeners.delete(listener);
    unbindStorageListener();
  };
}

const CodexServiceTierSettingsContext = createContext<CodexServiceTierSettingsContextValue>({
  serviceTierSettings: DEFAULT_SNAPSHOT,
  setServiceTier: () => {},
});

function useCodexServiceTierSettingsInternal(): CodexServiceTierSettingsContextValue {
  const serviceTierSettings = useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_SNAPSHOT);

  const setServiceTier = useCallback(
    (nextTier: CodexServiceTier, source: CodexServiceTierChangeSource) => {
      void source;
      const previousTier = readCodexServiceTier();
      const normalizedTier = writeCodexServiceTier(nextTier);
      if (previousTier === normalizedTier) return;
      emitSnapshotChange();
    },
    [],
  );

  return useMemo(
    () => ({
      serviceTierSettings,
      setServiceTier,
    }),
    [serviceTierSettings, setServiceTier],
  );
}

export function CodexServiceTierSettingsProvider({ children }: { children: ReactNode }) {
  const value = useCodexServiceTierSettingsInternal();
  return (
    <CodexServiceTierSettingsContext.Provider value={value}>
      {children}
    </CodexServiceTierSettingsContext.Provider>
  );
}

export function useCodexServiceTierSettings(): CodexServiceTierSettingsContextValue {
  return useContext(CodexServiceTierSettingsContext);
}
