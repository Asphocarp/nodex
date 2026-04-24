import {
  useCallback,
  useEffect,
  useSyncExternalStore,
} from "react";
import { invoke } from "./api";
import type {
  UpdateWindowRestoreSettingsInput,
  WindowRestoreSettings,
} from "./types";

interface WindowRestoreSettingsSnapshot {
  settings: WindowRestoreSettings;
  isLoading: boolean;
}

const DEFAULT_SETTINGS: WindowRestoreSettings = {
  policy: "all",
};

const DEFAULT_SNAPSHOT: WindowRestoreSettingsSnapshot = {
  settings: DEFAULT_SETTINGS,
  isLoading: true,
};

const listeners = new Set<() => void>();
let snapshotCache = DEFAULT_SNAPSHOT;
let loadPromise: Promise<void> | null = null;

function normalizeWindowRestoreSettings(value: unknown): WindowRestoreSettings {
  if (typeof value !== "object" || value === null) return DEFAULT_SETTINGS;
  const policy = (value as { policy?: unknown }).policy;
  if (policy === "all" || policy === "last-window" || policy === "none") {
    return { policy };
  }
  return DEFAULT_SETTINGS;
}

function emitChange(): void {
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): WindowRestoreSettingsSnapshot {
  return snapshotCache;
}

async function loadSettings(): Promise<void> {
  const result = await invoke("settings:window-restore:get");
  snapshotCache = {
    settings: normalizeWindowRestoreSettings(result),
    isLoading: false,
  };
  emitChange();
}

function ensureLoaded(): void {
  if (!snapshotCache.isLoading || loadPromise) return;
  loadPromise = loadSettings()
    .catch(() => {
      snapshotCache = {
        settings: DEFAULT_SETTINGS,
        isLoading: false,
      };
      emitChange();
    })
    .finally(() => {
      loadPromise = null;
    });
}

export function useWindowRestoreSettings(): {
  settings: WindowRestoreSettings;
  isLoading: boolean;
  updateSettings: (input: UpdateWindowRestoreSettingsInput) => Promise<WindowRestoreSettings>;
} {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_SNAPSHOT);

  useEffect(() => {
    ensureLoaded();
  }, []);

  const updateSettings = useCallback(async (input: UpdateWindowRestoreSettingsInput) => {
    const result = await invoke("settings:window-restore:update", input);
    const nextSettings = normalizeWindowRestoreSettings(result);
    snapshotCache = {
      settings: nextSettings,
      isLoading: false,
    };
    emitChange();
    return nextSettings;
  }, []);

  return {
    settings: snapshot.settings,
    isLoading: snapshot.isLoading,
    updateSettings,
  };
}

export function __resetWindowRestoreSettingsForTests(): void {
  snapshotCache = DEFAULT_SNAPSHOT;
  loadPromise = null;
  listeners.clear();
}
