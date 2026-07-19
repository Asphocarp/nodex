import { useCallback } from "react";
import {
  persistedAtom,
  preloadPersistedAtom,
  useMaitaiStore,
  usePersistedAtomValue,
  useSetPersistedAtom,
} from "@/lib/maitai";
import {
  normalizeCodexSetupRoles,
  type CodexSetupRoleId,
} from "./setup-codex-onboarding";

export const SETUP_CODEX_ROLE_STATE_KEY = "nodex:setup-codex-role-state:v1";

export interface CodexSetupRoleState {
  readonly roles: readonly CodexSetupRoleId[];
  readonly personalizedSuggestionsEnabled: boolean;
  readonly workMode: "coding" | "non_coding" | null;
}

export const DEFAULT_SETUP_CODEX_ROLE_STATE: CodexSetupRoleState = {
  roles: [],
  personalizedSuggestionsEnabled: true,
  workMode: null,
};

export function normalizeCodexSetupRoleState(value: unknown): CodexSetupRoleState {
  if (!value || typeof value !== "object") return DEFAULT_SETUP_CODEX_ROLE_STATE;
  const record = value as Record<string, unknown>;
  const workMode = record.workMode === "coding" || record.workMode === "non_coding"
    ? record.workMode
    : null;
  return {
    roles: normalizeCodexSetupRoles(record.roles),
    personalizedSuggestionsEnabled: record.personalizedSuggestionsEnabled !== false,
    workMode,
  };
}

function workModeForRoles(roles: readonly CodexSetupRoleId[]): CodexSetupRoleState["workMode"] {
  return roles.some((role) => role === "engineering" || role === "data_science")
    ? "coding"
    : "non_coding";
}

export function updateCodexSetupRoles(
  current: CodexSetupRoleState,
  roles: readonly CodexSetupRoleId[],
): CodexSetupRoleState {
  const normalizedRoles = normalizeCodexSetupRoles(roles);
  return {
    ...current,
    roles: normalizedRoles,
    workMode: workModeForRoles(normalizedRoles),
  };
}

export const codexSetupRoleStateAtom = persistedAtom<CodexSetupRoleState>({
  debugLabel: "codex-setup-role-state",
  storageKey: SETUP_CODEX_ROLE_STATE_KEY,
  defaultValue: DEFAULT_SETUP_CODEX_ROLE_STATE,
  hydration: "eager",
  synchronization: "cross-window",
  optimistic: true,
  writeFailure: "retain-and-error",
  decode: normalizeCodexSetupRoleState,
  encode: (value) => ({ version: 1, ...value }),
});

export function useCodexSetupRoleState(): CodexSetupRoleState {
  return usePersistedAtomValue(codexSetupRoleStateAtom).value;
}

export function useSetCodexSetupRoles(): (
  roles: readonly CodexSetupRoleId[],
) => Promise<CodexSetupRoleState> {
  const store = useMaitaiStore();
  const setState = useSetPersistedAtom(codexSetupRoleStateAtom);

  return useCallback(async (roles: readonly CodexSetupRoleId[]) => {
    await preloadPersistedAtom(store, codexSetupRoleStateAtom);
    let nextState = DEFAULT_SETUP_CODEX_ROLE_STATE;
    await setState((current) => {
      nextState = updateCodexSetupRoles(current, roles);
      return nextState;
    });
    return nextState;
  }, [setState, store]);
}
