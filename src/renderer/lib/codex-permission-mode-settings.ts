import type { CodexPermissionMode } from "./types";
import { CodexPermissionModesByProjectSchema } from "../../shared/schemas/codex";
import { parseJsonStringWithSchema } from "../../shared/schemas/storage";

export const CODEX_PERMISSION_MODE_STORAGE_KEY = "nodex-codex-permission-modes-v1";

export function readCodexPermissionModes(): Record<string, CodexPermissionMode> {
  try {
    const raw = localStorage.getItem(CODEX_PERMISSION_MODE_STORAGE_KEY);
    return parseJsonStringWithSchema(raw, CodexPermissionModesByProjectSchema, {});
  } catch {
    return {};
  }
}

export function writeCodexPermissionModes(value: Record<string, CodexPermissionMode>): void {
  try {
    localStorage.setItem(CODEX_PERMISSION_MODE_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // ignore localStorage failures
  }
}
