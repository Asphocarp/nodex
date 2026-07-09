import { useEffect, useState } from "react";
import { readAtom, subscribeAtom, writeAtom } from "@/lib/persisted-atom-store";
import {
  normalizeCodexSetupRoles,
  type CodexSetupRoleId,
} from "./setup-codex-onboarding";

const SETUP_CODEX_ROLE_STATE_KEY = "nodex:setup-codex-role-state:v1";

export interface CodexSetupRoleState {
  readonly roles: readonly CodexSetupRoleId[];
  readonly personalizedSuggestionsEnabled: boolean;
  readonly workMode: "coding" | "non_coding" | null;
}

const DEFAULT_SETUP_CODEX_ROLE_STATE: CodexSetupRoleState = {
  roles: [],
  personalizedSuggestionsEnabled: true,
  workMode: null,
};

let cachedState: CodexSetupRoleState | null = null;

function normalizeState(value: unknown): CodexSetupRoleState {
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

export async function readCodexSetupRoleState(): Promise<CodexSetupRoleState> {
  if (cachedState) return cachedState;
  cachedState = normalizeState(await readAtom(
    SETUP_CODEX_ROLE_STATE_KEY,
    DEFAULT_SETUP_CODEX_ROLE_STATE,
  ));
  return cachedState;
}

export async function writeCodexSetupRoles(
  roles: readonly CodexSetupRoleId[],
): Promise<CodexSetupRoleState> {
  const current = await readCodexSetupRoleState();
  const normalizedRoles = normalizeCodexSetupRoles(roles);
  const nextState: CodexSetupRoleState = {
    ...current,
    roles: normalizedRoles,
    workMode: workModeForRoles(normalizedRoles),
  };
  cachedState = nextState;
  await writeAtom(SETUP_CODEX_ROLE_STATE_KEY, nextState);
  return nextState;
}

export function useCodexSetupRoleState(): CodexSetupRoleState {
  const [state, setState] = useState(cachedState ?? DEFAULT_SETUP_CODEX_ROLE_STATE);

  useEffect(() => {
    let active = true;
    void readCodexSetupRoleState().then((value) => {
      if (active) setState(value);
    });
    const unsubscribe = subscribeAtom(SETUP_CODEX_ROLE_STATE_KEY, (value) => {
      cachedState = normalizeState(value);
      setState(cachedState);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return state;
}

export function clearCodexSetupRoleStateCacheForTests(): void {
  cachedState = null;
}
