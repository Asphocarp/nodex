import {
  buildCodexTurnDiffFromPatchBatches,
  isCodexFileChange,
} from "../../../../shared/codex-file-change";
import type { CodexTurnDiffPatchBatch } from "../../../lib/types";

export interface TurnDiffPayload {
  unifiedDiff: string;
  cwd?: string;
  showRevertButton?: boolean;
  patchBatches?: CodexTurnDiffPatchBatch[] | null;
}

export interface ProjectlessOutputScope {
  cwd?: string | null;
  projectlessOutputDirectory?: string | null;
}

export function normalizeTurnDiffPatchBatches(
  value: unknown,
): CodexTurnDiffPatchBatch[] | undefined {
  if (!Array.isArray(value)) return undefined;

  return value.flatMap((batch) => {
    if (typeof batch !== "object" || batch === null) return [];
    const batchCwd = (batch as { cwd?: unknown }).cwd;
    const changes = (batch as { changes?: unknown }).changes;
    return [
      {
        cwd: typeof batchCwd === "string" && batchCwd.trim().length > 0 ? batchCwd : null,
        changes: Array.isArray(changes) ? changes : [],
      },
    ];
  });
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || path.startsWith("~/") || /^[A-Za-z]:[\\/]/u.test(path);
}

export function normalizePathSegments(path: string): string {
  const normalized = path.replace(/\\/gu, "/");
  const prefix = normalized.startsWith("/") ? "/" : "";
  const segments: string[] = [];

  for (const segment of normalized.split("/")) {
    if (segment.length === 0 || segment === ".") continue;
    if (segment === "..") {
      if (segments.length > 0 && segments[segments.length - 1] !== "..") {
        segments.pop();
        continue;
      }
      if (!prefix) segments.push(segment);
      continue;
    }
    segments.push(segment);
  }

  return `${prefix}${segments.join("/")}` || prefix || ".";
}

export function resolveOutputPath(path: string, cwd: string | null | undefined): string {
  const normalizedPath = normalizePathSegments(path);
  if (isAbsolutePath(normalizedPath) || !cwd) return normalizedPath;
  return normalizePathSegments(`${cwd}/${normalizedPath}`);
}

export function normalizeComparableResourcePath(
  path: string,
  cwd: string | null | undefined,
): string {
  return normalizePathSegments(resolveOutputPath(path, cwd)).replace(/\/+$/u, "");
}

export function isResourceInsideProjectlessOutputDirectory(input: {
  cwd: string | null | undefined;
  projectlessOutputDirectory: string | null | undefined;
  resourcePath: string;
}): boolean {
  if (!input.projectlessOutputDirectory) return true;

  const root = normalizeComparableResourcePath(input.projectlessOutputDirectory, input.cwd);
  if (!root) return false;

  const resource = normalizeComparableResourcePath(input.resourcePath, input.cwd);
  return resource === root || resource.startsWith(`${root}/`);
}

function stripPatchPathPrefix(path: string): string {
  const trimmed = path.trim().replace(/^"|"$/gu, "");
  if (trimmed === "/dev/null") return "";
  if (trimmed.startsWith("a/") || trimmed.startsWith("b/")) {
    return trimmed.slice(2);
  }
  return trimmed;
}

function parseDiffHeaderPaths(line: string): string[] {
  if (!line.startsWith("diff --git ")) return [];

  const rest = line.slice("diff --git ".length);
  if (rest.startsWith('"')) {
    const paths: string[] = [];
    let index = 0;
    while (index < rest.length) {
      while (rest[index] === " ") index += 1;
      if (rest[index] !== '"') break;
      index += 1;
      let path = "";
      while (index < rest.length) {
        const char = rest[index];
        if (char === '"') {
          index += 1;
          break;
        }
        if (char === "\\" && index + 1 < rest.length) {
          path += rest[index + 1];
          index += 2;
          continue;
        }
        path += char;
        index += 1;
      }
      paths.push(path);
    }
    return paths.map(stripPatchPathPrefix).filter(Boolean);
  }

  const destinationIndex = rest.lastIndexOf(" b/");
  if (destinationIndex < 0) return [];
  return [stripPatchPathPrefix(rest.slice(destinationIndex + 1))].filter(Boolean);
}

function parseUnifiedFileHeaderPath(line: string): string | null {
  if (!line.startsWith("--- ") && !line.startsWith("+++ ")) return null;
  const rawPath = line.slice(4).split("\t", 1)[0] ?? "";
  const path = stripPatchPathPrefix(rawPath);
  return path || null;
}

function extractDiffBlockPaths(block: string): string[] {
  const paths = new Set<string>();
  for (const line of block.split("\n")) {
    for (const path of parseDiffHeaderPaths(line)) paths.add(path);
    const headerPath = parseUnifiedFileHeaderPath(line);
    if (headerPath) paths.add(headerPath);
  }
  return [...paths];
}

function splitUnifiedDiffBlocks(diff: string): string[] {
  const normalized = diff.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  if (normalized.trim().length === 0) return [];

  const lines = normalized.split("\n");
  const hasGitHeaders = lines.some((line) => line.startsWith("diff --git "));
  if (hasGitHeaders) {
    const blocks: string[] = [];
    let blockStart = lines.findIndex((line) => line.startsWith("diff --git "));
    if (blockStart < 0) return [];
    for (let index = blockStart + 1; index <= lines.length; index += 1) {
      if (index === lines.length || lines[index]?.startsWith("diff --git ")) {
        blocks.push(lines.slice(blockStart, index).join("\n"));
        blockStart = index;
      }
    }
    return blocks;
  }

  const blocks: string[] = [];
  let blockStart = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const nextLine = lines[index + 1] ?? "";
    if (line.startsWith("--- ") && nextLine.startsWith("+++ ")) {
      if (blockStart >= 0) blocks.push(lines.slice(blockStart, index).join("\n"));
      blockStart = index;
    }
  }
  if (blockStart >= 0) blocks.push(lines.slice(blockStart).join("\n"));
  return blocks;
}

function filterUnifiedDiff(unifiedDiff: string, scope: ProjectlessOutputScope): string {
  if (!scope.projectlessOutputDirectory) return unifiedDiff;

  return splitUnifiedDiffBlocks(unifiedDiff)
    .filter((block) => {
      const paths = extractDiffBlockPaths(block);
      return (
        paths.length > 0 &&
        paths.every((path) =>
          isResourceInsideProjectlessOutputDirectory({
            cwd: scope.cwd,
            projectlessOutputDirectory: scope.projectlessOutputDirectory,
            resourcePath: path,
          }),
        )
      );
    })
    .join("\n");
}

function getPatchChangePaths(change: unknown): string[] {
  if (!isCodexFileChange(change)) return [];
  const movePath =
    change.type === "update" || change.type === "nonRenderable" ? change.movePath : null;
  return [change.path, movePath].filter(
    (path): path is string => typeof path === "string" && path.trim().length > 0,
  );
}

function filterPatchBatches(
  patchBatches: readonly CodexTurnDiffPatchBatch[] | null | undefined,
  scope: ProjectlessOutputScope,
): CodexTurnDiffPatchBatch[] | null | undefined {
  if (patchBatches === undefined || patchBatches === null) return patchBatches;
  if (!scope.projectlessOutputDirectory) return [...patchBatches];

  return patchBatches.flatMap((batch) => {
    const cwd = batch.cwd ?? scope.cwd ?? null;
    const changes = batch.changes.filter((change) => {
      const paths = getPatchChangePaths(change);
      return (
        paths.length > 0 &&
        paths.every((path) =>
          isResourceInsideProjectlessOutputDirectory({
            cwd,
            projectlessOutputDirectory: scope.projectlessOutputDirectory,
            resourcePath: path,
          }),
        )
      );
    });
    return changes.length > 0 ? [{ cwd: batch.cwd, changes }] : [];
  });
}

function hasUnifiedDiffChanges(unifiedDiff: string): boolean {
  return unifiedDiff
    .split(/\r?\n/u)
    .some(
      (line) =>
        (line.startsWith("+") && !line.startsWith("+++")) ||
        (line.startsWith("-") && !line.startsWith("---")),
    );
}

function hasPatchBatchChanges(
  patchBatches: readonly CodexTurnDiffPatchBatch[] | null | undefined,
): boolean {
  return patchBatches?.some((batch) => batch.changes.some(isCodexFileChange)) ?? false;
}

export function hasTurnDiffPayloadChanges(payload: TurnDiffPayload | null): boolean {
  if (!payload) return false;
  return hasUnifiedDiffChanges(payload.unifiedDiff) || hasPatchBatchChanges(payload.patchBatches);
}

export function filterTurnDiffPayload(
  payload: TurnDiffPayload,
  scope: ProjectlessOutputScope,
): TurnDiffPayload | null {
  const effectiveScope = {
    ...scope,
    cwd: payload.cwd ?? scope.cwd,
  };
  const filteredPatchBatches = filterPatchBatches(payload.patchBatches, effectiveScope);
  const filteredUnifiedDiff = filterUnifiedDiff(payload.unifiedDiff, {
    ...effectiveScope,
  });
  const normalizedPayload: TurnDiffPayload = {
    ...payload,
    unifiedDiff: filteredUnifiedDiff,
    ...(filteredPatchBatches === undefined ? {} : { patchBatches: filteredPatchBatches }),
  };
  if (hasPatchBatchChanges(filteredPatchBatches)) {
    const synthesizedDiff = buildCodexTurnDiffFromPatchBatches(filteredPatchBatches ?? []);
    if (!hasUnifiedDiffChanges(filteredUnifiedDiff) && synthesizedDiff.trim().length > 0) {
      return { ...normalizedPayload, unifiedDiff: synthesizedDiff };
    }
  }

  if (!scope.projectlessOutputDirectory) {
    if (
      normalizedPayload.unifiedDiff.trim().length > 0 ||
      hasPatchBatchChanges(filteredPatchBatches)
    ) {
      return normalizedPayload;
    }
    return null;
  }

  if (hasTurnDiffPayloadChanges(normalizedPayload)) return normalizedPayload;

  return null;
}

function extractDestinationPathFromDiffBlock(block: string): string | null {
  const paths = extractDiffBlockPaths(block);
  return paths.at(-1) ?? paths[0] ?? null;
}

export function collectTurnDiffChangedPaths(
  payload: TurnDiffPayload,
  scope: ProjectlessOutputScope = {},
): string[] {
  const paths = new Set<string>();
  for (const block of splitUnifiedDiffBlocks(payload.unifiedDiff)) {
    const path = extractDestinationPathFromDiffBlock(block);
    if (!path) continue;
    paths.add(normalizeComparableResourcePath(path, payload.cwd ?? scope.cwd).toLowerCase());
  }
  for (const batch of payload.patchBatches ?? []) {
    const cwd = batch.cwd ?? payload.cwd ?? scope.cwd;
    for (const change of batch.changes) {
      const pathsForChange = getPatchChangePaths(change);
      const finalPath = pathsForChange.at(-1);
      if (!finalPath) continue;
      paths.add(normalizeComparableResourcePath(finalPath, cwd).toLowerCase());
    }
  }
  return [...paths].filter(Boolean);
}

export function shouldSuppressTurnDiffByEndResources(input: {
  payload: TurnDiffPayload | null;
  endResourcePaths: readonly string[];
  scope?: ProjectlessOutputScope;
}): boolean {
  if (!input.payload || input.endResourcePaths.length === 0) return false;
  const changedPaths = collectTurnDiffChangedPaths(input.payload, input.scope);
  if (changedPaths.length === 0) return false;
  const endPaths = new Set(
    input.endResourcePaths.map((path) =>
      normalizeComparableResourcePath(path, input.scope?.cwd).toLowerCase(),
    ),
  );
  return changedPaths.every((path) => endPaths.has(path));
}
