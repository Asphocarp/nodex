import type { WorktreeEnvironmentOption } from "@/lib/types";

export const LOCAL_ENVIRONMENT_SELECTIONS_STORAGE_KEY =
  "local-env-selections-by-workspace";

export type LocalEnvironmentSelectionsByWorkspace = Record<
  string,
  string | null
>;

interface LocalEnvironmentConfigCandidate {
  readonly configPath: string;
  readonly state: "success" | "parseError" | "readError" | "tooLarge";
}

function normalizePath(value: string): string {
  const withoutExtendedPrefix = value.trim()
    .replace(/^\\\\\?\\UNC\\/i, "\\\\")
    .replace(/^\\\\\?\\(?=[a-z]:[\\/])/i, "");
  const slashNormalized = withoutExtendedPrefix.replaceAll("\\", "/");
  const normalized = slashNormalized.startsWith("//")
    ? `//${slashNormalized.slice(2).replace(/\/{2,}/g, "/")}`
    : slashNormalized.replace(/\/{2,}/g, "/");
  if (normalized === "/") return normalized;
  return normalized.replace(/\/+$/, "");
}

function windowsComparablePath(value: string): {
  comparablePath: string;
  explicit: boolean;
} | null {
  const normalized = normalizePath(value);
  const wslUncMatch = normalized.match(
    /^\/\/(?:wsl\$|wsl\.localhost)\/([^/]+)(?:\/(.*))?$/i,
  );
  if (wslUncMatch) {
    const innerPath = `/${wslUncMatch[2] ?? ""}`;
    if (!/^\/mnt\/[a-z](?:\/|$)/i.test(innerPath)) return null;
    return {
      comparablePath: innerPath.toLowerCase(),
      explicit: true,
    };
  }

  const driveMatch = normalized.match(/^\/?([a-z]):(?:\/(.*))?$/i);
  if (driveMatch) {
    const [, drive, tail] = driveMatch;
    return {
      comparablePath: `/mnt/${drive?.toLowerCase()}${tail ? `/${tail.toLowerCase()}` : ""}`,
      explicit: true,
    };
  }

  if (!/^\/mnt\/[a-z](?:\/|$)/i.test(normalized)) return null;
  return {
    comparablePath: normalized.toLowerCase(),
    explicit: false,
  };
}

export function areLocalEnvironmentPathsEquivalent(left: string, right: string): boolean {
  const normalizedLeft = normalizePath(left);
  const normalizedRight = normalizePath(right);
  if (normalizedLeft === normalizedRight) return true;

  const comparableLeft = windowsComparablePath(normalizedLeft);
  const comparableRight = windowsComparablePath(normalizedRight);
  return Boolean(
    comparableLeft
    && comparableRight
    && (comparableLeft.explicit || comparableRight.explicit)
    && comparableLeft.comparablePath === comparableRight.comparablePath,
  );
}

function fileName(path: string): string {
  const normalized = normalizePath(path);
  return normalized.split("/").filter(Boolean).at(-1) ?? normalized;
}

function resolveDefaultConfigPath(
  candidates: readonly LocalEnvironmentConfigCandidate[],
): string | null {
  const preferred = candidates.find((candidate) =>
    fileName(candidate.configPath) === "environment.toml"
    && candidate.state === "success"
  );
  const successful = candidates.find((candidate) => candidate.state === "success");
  return preferred?.configPath
    ?? successful?.configPath
    ?? candidates[0]?.configPath
    ?? null;
}

export function localEnvironmentWorkspaceKey(
  workspaceRoot: string | null | undefined,
  hostId = "local",
): string | null {
  if (!workspaceRoot) return null;
  const normalizedWorkspaceRoot = normalizePath(workspaceRoot);
  if (!normalizedWorkspaceRoot || normalizedWorkspaceRoot === "/") return null;
  return `${hostId}:${normalizedWorkspaceRoot}`;
}

export function readLocalEnvironmentSelections(): LocalEnvironmentSelectionsByWorkspace {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(LOCAL_ENVIRONMENT_SELECTIONS_STORAGE_KEY) ?? "{}",
    ) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const selections: LocalEnvironmentSelectionsByWorkspace = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (value === null || typeof value === "string") selections[key] = value;
    }
    return selections;
  } catch {
    return {};
  }
}

export function writeLocalEnvironmentSelection({
  workspaceRoot,
  configPath,
  hostId = "local",
}: {
  workspaceRoot: string;
  configPath: string | null;
  hostId?: string;
}): void {
  if (typeof window === "undefined") return;
  const workspaceKey = localEnvironmentWorkspaceKey(workspaceRoot, hostId);
  if (!workspaceKey) return;
  const selections = readLocalEnvironmentSelections();
  selections[workspaceKey] = configPath;
  window.localStorage.setItem(
    LOCAL_ENVIRONMENT_SELECTIONS_STORAGE_KEY,
    JSON.stringify(selections),
  );
}

export function resolveStoredLocalEnvironmentSelection({
  hostId = "local",
  selectionsByWorkspace,
  workspaceKey,
}: {
  hostId?: string;
  selectionsByWorkspace: Readonly<LocalEnvironmentSelectionsByWorkspace>;
  workspaceKey: string | null;
}): string | null | undefined {
  if (workspaceKey === null) return undefined;
  if (Object.prototype.hasOwnProperty.call(selectionsByWorkspace, workspaceKey)) {
    return selectionsByWorkspace[workspaceKey] ?? null;
  }

  const hostPrefix = `${hostId}:`;
  const workspacePath = workspaceKey.slice(hostPrefix.length);
  let resolved: string | null | undefined;
  for (const [candidateKey, candidateValue] of Object.entries(selectionsByWorkspace)) {
    if (!candidateKey.startsWith(hostPrefix)) continue;
    if (!areLocalEnvironmentPathsEquivalent(candidateKey.slice(hostPrefix.length), workspacePath)) continue;

    const normalizedCandidateValue = candidateValue ?? null;
    if (resolved === undefined) {
      resolved = normalizedCandidateValue;
      continue;
    }
    if (resolved === null || normalizedCandidateValue === null) {
      if (resolved !== normalizedCandidateValue) return undefined;
      continue;
    }
    if (!areLocalEnvironmentPathsEquivalent(resolved, normalizedCandidateValue)) return undefined;
  }
  return resolved;
}

export function resolveLocalEnvironmentConfigSelection({
  canValidateSelection,
  candidates,
  hostId = "local",
  selectionsByWorkspace,
  workspaceRoot,
}: {
  canValidateSelection: boolean;
  candidates: readonly LocalEnvironmentConfigCandidate[];
  hostId?: string;
  selectionsByWorkspace: Readonly<LocalEnvironmentSelectionsByWorkspace>;
  workspaceRoot: string | null | undefined;
}): string | null {
  const workspaceKey = localEnvironmentWorkspaceKey(workspaceRoot, hostId);
  if (!workspaceKey) return null;
  const selectedConfigPath = resolveStoredLocalEnvironmentSelection({
    hostId,
    selectionsByWorkspace,
    workspaceKey,
  });
  if (selectedConfigPath === undefined) return null;
  if (selectedConfigPath === null || !canValidateSelection) {
    return selectedConfigPath;
  }

  const matchingCandidate = candidates.find((candidate) =>
    areLocalEnvironmentPathsEquivalent(candidate.configPath, selectedConfigPath)
  );
  return matchingCandidate?.configPath ?? resolveDefaultConfigPath(candidates);
}

export async function loadLocalEnvironmentConfigSelection({
  hostId = "local",
  loadCandidates,
  selectionsByWorkspace,
  workspaceRoot,
}: {
  hostId?: string;
  loadCandidates: (
    workspaceRoot: string,
  ) => Promise<readonly LocalEnvironmentConfigCandidate[]>;
  selectionsByWorkspace: Readonly<LocalEnvironmentSelectionsByWorkspace>;
  workspaceRoot: string | null | undefined;
}): Promise<string | null> {
  if (!workspaceRoot) {
    return resolveLocalEnvironmentConfigSelection({
      canValidateSelection: false,
      candidates: [],
      hostId,
      selectionsByWorkspace,
      workspaceRoot,
    });
  }

  try {
    const candidates = await loadCandidates(workspaceRoot);
    return resolveLocalEnvironmentConfigSelection({
      canValidateSelection: true,
      candidates,
      hostId,
      selectionsByWorkspace,
      workspaceRoot,
    });
  } catch {
    return resolveLocalEnvironmentConfigSelection({
      canValidateSelection: false,
      candidates: [],
      hostId,
      selectionsByWorkspace,
      workspaceRoot,
    });
  }
}

export function resolveLocalEnvironmentOptionSelection({
  options,
  selectionsByWorkspace,
  workspaceRoot,
}: {
  options: readonly WorktreeEnvironmentOption[];
  selectionsByWorkspace: Readonly<LocalEnvironmentSelectionsByWorkspace>;
  workspaceRoot: string | null | undefined;
}): string | null {
  return resolveLocalEnvironmentConfigSelection({
    canValidateSelection: true,
    candidates: options.map((option) => ({
      configPath: option.path,
      state: "success",
    })),
    selectionsByWorkspace,
    workspaceRoot,
  });
}
