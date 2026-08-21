import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { AgentExecutionProfile, AgentProviderCatalog } from "../../shared/agent-runtime";
import {
  AGENT_EXECUTION_PROFILE_STORAGE_KEY,
  parseStoredAgentExecutionProfile,
  resolveAgentExecutionProfile,
  writeStoredAgentExecutionProfile,
} from "./agent-execution-profile";

const listeners = new Set<() => void>();
let storageListenerBound = false;

function readRawSnapshot(): string {
  if (typeof localStorage === "undefined") return "";
  try {
    return localStorage.getItem(AGENT_EXECUTION_PROFILE_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function emitChange(): void {
  for (const listener of listeners) listener();
}

function handleStorage(event: StorageEvent): void {
  if (event.key !== null && event.key !== AGENT_EXECUTION_PROFILE_STORAGE_KEY) return;
  emitChange();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!storageListenerBound && typeof window !== "undefined") {
    window.addEventListener("storage", handleStorage);
    storageListenerBound = true;
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && storageListenerBound && typeof window !== "undefined") {
      window.removeEventListener("storage", handleStorage);
      storageListenerBound = false;
    }
  };
}

function parseRawProfile(raw: string): AgentExecutionProfile | null {
  if (!raw) return null;
  try {
    return parseStoredAgentExecutionProfile(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function useAgentExecutionProfile(input: {
  catalog: AgentProviderCatalog | null;
  legacyModelId?: string | null;
  legacyReasoningEffort?: string | null;
  serviceTier?: string | null;
}): {
  executionProfile: AgentExecutionProfile | null;
  setExecutionProfile: (profile: AgentExecutionProfile) => void;
} {
  const rawProfile = useSyncExternalStore(subscribe, readRawSnapshot, () => "");
  const executionProfile = useMemo(
    () =>
      resolveAgentExecutionProfile({
        catalog: input.catalog,
        storedProfile: parseRawProfile(rawProfile),
        legacyModelId: input.legacyModelId,
        legacyReasoningEffort: input.legacyReasoningEffort,
        serviceTier: input.serviceTier,
      }),
    [
      input.catalog,
      input.legacyModelId,
      input.legacyReasoningEffort,
      input.serviceTier,
      rawProfile,
    ],
  );
  const setExecutionProfile = useCallback((profile: AgentExecutionProfile) => {
    const previous = readRawSnapshot();
    writeStoredAgentExecutionProfile(profile);
    if (readRawSnapshot() !== previous) emitChange();
  }, []);

  return { executionProfile, setExecutionProfile };
}
