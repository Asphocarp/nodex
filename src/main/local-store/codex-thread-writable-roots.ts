import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getNodexHome } from "./config";

const CODEX_THREAD_WRITABLE_ROOTS_FILE_NAME = "codex-thread-writable-roots-v1.json";

type CodexThreadWritableRootsState = Record<string, string[]>;

let cachedState: CodexThreadWritableRootsState | null = null;
let pathOverrideForTests: string | null = null;

function getStatePath(): string {
  return pathOverrideForTests
    ?? join(getNodexHome(), CODEX_THREAD_WRITABLE_ROOTS_FILE_NAME);
}

function isCodexAbsoluteWorkspaceRoot(root: string): boolean {
  return (root.startsWith("/") && !root.startsWith("//"))
    || /^[A-Za-z]:[\\/]/.test(root)
    || /^\\\\[^\\]+\\[^\\]+/.test(root)
    || /^\/\/[^/]+\/[^/]+/.test(root);
}

function normalizeRoots(roots: readonly string[]): string[] {
  const normalized: string[] = [];
  for (const root of roots) {
    if (!isCodexAbsoluteWorkspaceRoot(root) || normalized.includes(root)) continue;
    normalized.push(root);
  }
  return normalized;
}

function parseState(value: unknown): CodexThreadWritableRootsState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const parsed: CodexThreadWritableRootsState = {};
  for (const [threadId, roots] of Object.entries(value)) {
    if (!threadId.trim() || !Array.isArray(roots)) continue;
    parsed[threadId] = normalizeRoots(
      roots.filter((root): root is string => typeof root === "string"),
    );
  }
  return parsed;
}

function readState(): CodexThreadWritableRootsState {
  if (cachedState) return cachedState;
  const statePath = getStatePath();
  if (!existsSync(statePath)) {
    cachedState = {};
    return cachedState;
  }
  try {
    cachedState = parseState(JSON.parse(readFileSync(statePath, "utf8")) as unknown);
  } catch {
    cachedState = {};
  }
  return cachedState;
}

function writeState(state: CodexThreadWritableRootsState): void {
  const statePath = getStatePath();
  mkdirSync(dirname(statePath), { recursive: true });
  const temporaryPath = `${statePath}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(state, null, 2), "utf8");
  renameSync(temporaryPath, statePath);
  cachedState = state;
}

export function getCodexThreadWritableRoots(threadId: string): string[] {
  return [...(readState()[threadId] ?? [])];
}

export function mergeCodexThreadWritableRoots(
  threadId: string,
  roots: readonly string[],
): string[] {
  const current = readState();
  const merged = normalizeRoots([...(current[threadId] ?? []), ...roots]);
  if (
    merged.length === (current[threadId]?.length ?? 0)
    && merged.every((root, index) => root === current[threadId]?.[index])
  ) {
    return [...merged];
  }
  writeState({ ...current, [threadId]: merged });
  return [...merged];
}

export function replaceCodexThreadWritableRoots(
  threadId: string,
  roots: readonly string[],
): string[] {
  const current = readState();
  const replacement = normalizeRoots(roots);
  if (
    replacement.length === (current[threadId]?.length ?? 0)
    && replacement.every((root, index) => root === current[threadId]?.[index])
  ) {
    return [...replacement];
  }
  writeState({ ...current, [threadId]: replacement });
  return [...replacement];
}

export function deleteCodexThreadWritableRoots(threadId: string): void {
  const current = readState();
  if (!(threadId in current)) return;
  const next = { ...current };
  delete next[threadId];
  writeState(next);
}

export function setCodexThreadWritableRootsPathOverrideForTests(
  pathOverride: string | null,
): void {
  pathOverrideForTests = pathOverride;
  cachedState = null;
}

export function resetCodexThreadWritableRootsCacheForTests(): void {
  cachedState = null;
}
