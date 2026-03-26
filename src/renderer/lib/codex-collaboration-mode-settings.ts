import type { CodexCollaborationModeKind } from "./types";
import { CodexCollaborationModesByContextSchema } from "../../shared/schemas/codex";
import { parseJsonStringWithSchema } from "../../shared/schemas/storage";

const STORAGE_KEY = "nodex-codex-collaboration-mode-settings-v1";
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

function readStoredMap(): Record<string, CodexCollaborationModeKind> {
  const raw = readRawStorageValue();
  return parseJsonStringWithSchema(raw, CodexCollaborationModesByContextSchema, {});
}

function writeStoredMap(value: Record<string, CodexCollaborationModeKind>): void {
  writeRawStorageValue(JSON.stringify(value));
}

export function getThreadCollaborationModeStorageKey(threadId: string): string {
  return `thread:${threadId}`;
}

export function getDraftCollaborationModeStorageKey(projectId: string, cardId: string): string {
  return `draft:${projectId}:${cardId}`;
}

export function readCollaborationModeForContextKey(contextKey: string): CodexCollaborationModeKind {
  const value = readStoredMap()[contextKey];
  return value === "default" || value === "plan" ? value : DEFAULT_CODEX_COLLABORATION_MODE;
}

export function writeCollaborationModeForContextKey(
  contextKey: string,
  mode: CodexCollaborationModeKind,
): CodexCollaborationModeKind {
  const current = readStoredMap();
  current[contextKey] = mode === "default" || mode === "plan" ? mode : DEFAULT_CODEX_COLLABORATION_MODE;
  writeStoredMap(current);
  return current[contextKey] ?? DEFAULT_CODEX_COLLABORATION_MODE;
}
