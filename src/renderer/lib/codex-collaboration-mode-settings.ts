import type { CodexCollaborationModeKind } from "./types";

const STORAGE_KEY = "nodex-codex-collaboration-mode-v2";
export const DEFAULT_CODEX_COLLABORATION_MODE: CodexCollaborationModeKind = "default";

function readRawStorageValue(): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeRawStorageValue(value: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // ignore localStorage failures
  }
}

export function readGlobalCollaborationMode(): CodexCollaborationModeKind {
  const value = readRawStorageValue();
  return value === "default" || value === "plan" ? value : DEFAULT_CODEX_COLLABORATION_MODE;
}

export function writeGlobalCollaborationMode(
  mode: CodexCollaborationModeKind,
): CodexCollaborationModeKind {
  const nextMode = mode === "default" || mode === "plan" ? mode : DEFAULT_CODEX_COLLABORATION_MODE;
  writeRawStorageValue(nextMode);
  return nextMode;
}
