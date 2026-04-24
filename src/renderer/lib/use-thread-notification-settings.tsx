import {
  useCallback,
  useEffect,
  useSyncExternalStore,
} from "react";
import { invoke } from "./api";
import type {
  ThreadNotificationSettings,
  UpdateThreadNotificationSettingsInput,
} from "./types";

interface ThreadNotificationSettingsSnapshot {
  settings: ThreadNotificationSettings;
  isLoading: boolean;
}

const DEFAULT_SETTINGS: ThreadNotificationSettings = {
  turnMode: "unfocused",
  permissionsEnabled: true,
  questionsEnabled: true,
};

const DEFAULT_SNAPSHOT: ThreadNotificationSettingsSnapshot = {
  settings: DEFAULT_SETTINGS,
  isLoading: true,
};

const listeners = new Set<() => void>();
let snapshotCache = DEFAULT_SNAPSHOT;
let loadPromise: Promise<void> | null = null;

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

function getSnapshot(): ThreadNotificationSettingsSnapshot {
  return snapshotCache;
}

async function loadSettings(): Promise<void> {
  const result = await invoke("settings:thread-notifications:get");
  const nextSettings = isThreadNotificationSettings(result)
    ? result
    : DEFAULT_SETTINGS;
  snapshotCache = {
    settings: nextSettings,
    isLoading: false,
  };
  emitChange();
}

function ensureLoaded(): void {
  if (!snapshotCache.isLoading || loadPromise) {
    return;
  }

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

export function useThreadNotificationSettings(): {
  settings: ThreadNotificationSettings;
  isLoading: boolean;
  updateSettings: (input: UpdateThreadNotificationSettingsInput) => Promise<ThreadNotificationSettings>;
  reloadSettings: () => Promise<void>;
} {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_SNAPSHOT);

  useEffect(() => {
    ensureLoaded();
  }, []);

  const reloadSettings = useCallback(async () => {
    snapshotCache = {
      settings: snapshotCache.settings,
      isLoading: true,
    };
    emitChange();
    await loadSettings();
  }, []);

  const updateSettings = useCallback(async (input: UpdateThreadNotificationSettingsInput) => {
    const result = await invoke("settings:thread-notifications:update", input);
    const nextSettings = result as ThreadNotificationSettings;
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
    reloadSettings,
  };
}

function isThreadNotificationSettings(value: unknown): value is ThreadNotificationSettings {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ThreadNotificationSettings>;
  if (
    candidate.turnMode !== "off"
    && candidate.turnMode !== "unfocused"
    && candidate.turnMode !== "always"
  ) {
    return false;
  }
  return (
    typeof candidate.permissionsEnabled === "boolean"
    && typeof candidate.questionsEnabled === "boolean"
  );
}

export function __resetThreadNotificationSettingsForTests(): void {
  snapshotCache = DEFAULT_SNAPSHOT;
  loadPromise = null;
  listeners.clear();
}
