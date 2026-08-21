import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { requireCodexWorktreeEnvironmentConfigPath } from "../../shared/codex-worktree-environment-path";
import type {
  UpdateWorktreeEnvironmentConfigInput,
  WorktreeEnvironmentConfigRecord,
  WorktreeEnvironmentDefinition,
  WorktreeEnvironmentOption,
  WorktreeEnvironmentSaveResult,
  WorktreeEnvironmentSettingsSnapshot,
} from "../../shared/types";
import {
  parseWorktreeEnvironmentToml,
  serializeWorktreeEnvironmentDefinition,
  WORKTREE_ENVIRONMENT_MAX_BYTES,
} from "./worktree-environment-codec";

export { WORKTREE_ENVIRONMENT_MAX_BYTES } from "./worktree-environment-codec";

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

function resolveEnvironmentRoot(workspacePath: string): string {
  const normalizedWorkspacePath = workspacePath.trim();
  if (!normalizedWorkspacePath) {
    throw new Error("Workspace path is required");
  }

  return path.resolve(normalizedWorkspacePath, ".codex", "environments");
}

function isPathWithin(parentDir: string, candidatePath: string): boolean {
  const relative = path.relative(parentDir, candidatePath);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function normalizeRelativeEnvironmentPath(environmentPath: string): string {
  return requireCodexWorktreeEnvironmentConfigPath(environmentPath);
}

function resolveEnvironmentPath(input: { workspacePath: string; environmentPath: string }): {
  resolvedWorkspacePath: string;
  environmentRoot: string;
  relativePath: string;
  resolvedPath: string;
} {
  const resolvedWorkspacePath = path.resolve(input.workspacePath.trim());
  const environmentRoot = resolveEnvironmentRoot(resolvedWorkspacePath);
  const relativePath = normalizeRelativeEnvironmentPath(input.environmentPath);
  const resolvedPath = path.resolve(resolvedWorkspacePath, relativePath);

  if (!isPathWithin(environmentRoot, resolvedPath)) {
    throw new Error("Environment path must be inside .codex/environments");
  }

  return {
    resolvedWorkspacePath,
    environmentRoot,
    relativePath,
    resolvedPath,
  };
}

function isNodeErrorWithCode(error: unknown, code: string): boolean {
  return (
    error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === code
  );
}

function createEnvironmentRevision(raw: string): string {
  return `sha256:${createHash("sha256").update(raw, "utf8").digest("hex")}`;
}

function assertExpectedRevision(revision: string | null): void {
  if (revision === null || /^sha256:[a-f0-9]{64}$/.test(revision)) return;
  throw new Error("Expected revision must be null or a sha256 revision");
}

async function findCanonicalExistingAncestor(candidatePath: string): Promise<{
  requestedPath: string;
  canonicalPath: string;
}> {
  let currentPath = candidatePath;
  for (;;) {
    const canonicalPath = await realpath(currentPath).catch((error: unknown) => {
      if (isNodeErrorWithCode(error, "ENOENT")) return null;
      throw error;
    });
    if (canonicalPath) return { requestedPath: currentPath, canonicalPath };

    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      throw new Error(`Could not resolve an existing ancestor for ${candidatePath}`);
    }
    currentPath = parentPath;
  }
}

async function prepareCanonicalEnvironmentRoot(input: {
  resolvedWorkspacePath: string;
  environmentRoot: string;
  create: boolean;
}): Promise<string> {
  const canonicalWorkspacePath = await realpath(input.resolvedWorkspacePath).catch(() => null);
  if (!canonicalWorkspacePath) throw new Error("Workspace directory not found");

  const canonicalAncestor = await findCanonicalExistingAncestor(input.environmentRoot);
  if (
    canonicalAncestor.canonicalPath !== canonicalWorkspacePath &&
    !isPathWithin(canonicalWorkspacePath, canonicalAncestor.canonicalPath)
  ) {
    throw new Error("Environment directory must be inside the workspace");
  }

  if (input.create) await mkdir(input.environmentRoot, { recursive: true });

  const canonicalEnvironmentRoot = await realpath(input.environmentRoot).catch(() => null);
  if (!canonicalEnvironmentRoot) {
    throw new Error("Environment directory not found: .codex/environments");
  }
  if (!isPathWithin(canonicalWorkspacePath, canonicalEnvironmentRoot)) {
    throw new Error("Environment directory must be inside the workspace");
  }

  return canonicalEnvironmentRoot;
}

async function resolveCanonicalEnvironmentTarget(input: {
  resolvedWorkspacePath: string;
  environmentRoot: string;
  resolvedPath: string;
  createRoot: boolean;
}): Promise<{ canonicalEnvironmentRoot: string; canonicalTargetPath: string }> {
  const canonicalEnvironmentRoot = await prepareCanonicalEnvironmentRoot({
    resolvedWorkspacePath: input.resolvedWorkspacePath,
    environmentRoot: input.environmentRoot,
    create: input.createRoot,
  });
  const canonicalAncestor = await findCanonicalExistingAncestor(input.resolvedPath);
  if (
    canonicalAncestor.canonicalPath !== canonicalEnvironmentRoot &&
    !isPathWithin(canonicalEnvironmentRoot, canonicalAncestor.canonicalPath)
  ) {
    throw new Error("Environment path must be inside .codex/environments");
  }

  const canonicalExistingTarget = await realpath(input.resolvedPath).catch((error: unknown) => {
    if (isNodeErrorWithCode(error, "ENOENT")) return null;
    throw error;
  });
  const canonicalTargetPath =
    canonicalExistingTarget ??
    path.resolve(
      canonicalAncestor.canonicalPath,
      path.relative(canonicalAncestor.requestedPath, input.resolvedPath),
    );
  if (!isPathWithin(canonicalEnvironmentRoot, canonicalTargetPath)) {
    throw new Error("Environment path must be inside .codex/environments");
  }

  return { canonicalEnvironmentRoot, canonicalTargetPath };
}

const environmentSaveQueues = new Map<string, Promise<void>>();

async function runEnvironmentSaveQueued<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = environmentSaveQueues.get(key) ?? Promise.resolve();
  const result = previous.catch(() => undefined).then(operation);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  environmentSaveQueues.set(key, tail);

  try {
    return await result;
  } finally {
    if (environmentSaveQueues.get(key) === tail) environmentSaveQueues.delete(key);
  }
}

function countOwnValues(value: Record<string, string>): number {
  return Object.keys(value).length;
}

function buildConfigRecord(input: {
  workspacePath: string;
  configPath: string;
  state: WorktreeEnvironmentConfigRecord["state"];
  environment: WorktreeEnvironmentDefinition | null;
  parseErrorMessage?: string | null;
  readErrorMessage?: string | null;
  tooLargeMessage?: string | null;
}): WorktreeEnvironmentConfigRecord {
  const absolutePath = path.resolve(input.workspacePath, input.configPath);
  const environment = input.environment;

  return {
    configPath: input.configPath,
    fileName: path.basename(absolutePath),
    state: input.state,
    exists: true,
    name: environment?.name ?? path.basename(absolutePath, ".toml"),
    hasSetupScript:
      Boolean(environment?.setup.script) ||
      Boolean(countOwnValues(environment?.setup.platformScripts ?? {})),
    hasCleanupScript:
      Boolean(environment?.cleanup.script) ||
      Boolean(countOwnValues(environment?.cleanup.platformScripts ?? {})),
    actionCount: environment?.actions.length ?? 0,
    parseErrorMessage: input.parseErrorMessage ?? null,
    readErrorMessage: input.readErrorMessage ?? null,
    tooLargeMessage: input.tooLargeMessage ?? null,
    environment,
  };
}

async function readSelectedEnvironmentState(input: {
  workspacePath: string;
  configPath: string;
  knownToExist: boolean;
}): Promise<{
  record: WorktreeEnvironmentConfigRecord | null;
  revision: string | null;
}> {
  const resolved = resolveEnvironmentPath({
    workspacePath: input.workspacePath,
    environmentPath: input.configPath,
  });
  const target = await resolveCanonicalEnvironmentTarget({
    ...resolved,
    createRoot: false,
  }).catch((error: unknown) => {
    if (!input.knownToExist) return null;
    return {
      error: error instanceof Error ? error.message : "Could not inspect file",
    };
  });
  if (!target) return { record: null, revision: null };
  if ("error" in target) {
    return {
      record: buildConfigRecord({
        workspacePath: resolved.resolvedWorkspacePath,
        configPath: input.configPath,
        state: "readError",
        environment: null,
        readErrorMessage: target.error,
      }),
      revision: null,
    };
  }

  const statResult = await stat(target.canonicalTargetPath).then(
    (fileStat) => ({ fileStat }),
    (error: unknown) =>
      isNodeErrorWithCode(error, "ENOENT")
        ? { missing: true as const }
        : { error: error instanceof Error ? error.message : "Could not inspect file" },
  );
  if ("missing" in statResult) return { record: null, revision: null };
  if ("error" in statResult) {
    return {
      record: buildConfigRecord({
        workspacePath: resolved.resolvedWorkspacePath,
        configPath: input.configPath,
        state: "readError",
        environment: null,
        readErrorMessage: statResult.error,
      }),
      revision: null,
    };
  }
  const { fileStat } = statResult;
  if (!fileStat.isFile()) {
    return {
      record: buildConfigRecord({
        workspacePath: resolved.resolvedWorkspacePath,
        configPath: input.configPath,
        state: "readError",
        environment: null,
        readErrorMessage: "Environment path must point to a file",
      }),
      revision: null,
    };
  }
  if (fileStat.size > WORKTREE_ENVIRONMENT_MAX_BYTES) {
    return {
      record: buildConfigRecord({
        workspacePath: resolved.resolvedWorkspacePath,
        configPath: input.configPath,
        state: "tooLarge",
        environment: null,
        tooLargeMessage: `Environment file exceeds ${WORKTREE_ENVIRONMENT_MAX_BYTES.toLocaleString()} bytes`,
      }),
      revision: null,
    };
  }

  const rawResult = await readFile(target.canonicalTargetPath, "utf8").then(
    (raw) => ({ raw }),
    (error: unknown) => ({
      error: error instanceof Error ? error.message : "Could not read file",
    }),
  );
  if ("error" in rawResult) {
    return {
      record: buildConfigRecord({
        workspacePath: resolved.resolvedWorkspacePath,
        configPath: input.configPath,
        state: "readError",
        environment: null,
        readErrorMessage: rawResult.error,
      }),
      revision: null,
    };
  }
  const { raw } = rawResult;
  if (Buffer.byteLength(raw, "utf8") > WORKTREE_ENVIRONMENT_MAX_BYTES) {
    return {
      record: buildConfigRecord({
        workspacePath: resolved.resolvedWorkspacePath,
        configPath: input.configPath,
        state: "tooLarge",
        environment: null,
        tooLargeMessage: `Environment file exceeds ${WORKTREE_ENVIRONMENT_MAX_BYTES.toLocaleString()} bytes`,
      }),
      revision: null,
    };
  }

  const revision = createEnvironmentRevision(raw);
  try {
    const environment = parseWorktreeEnvironmentToml(raw, target.canonicalTargetPath);
    return {
      record: buildConfigRecord({
        workspacePath: resolved.resolvedWorkspacePath,
        configPath: input.configPath,
        state: "success",
        environment,
      }),
      revision,
    };
  } catch (error) {
    return {
      record: buildConfigRecord({
        workspacePath: resolved.resolvedWorkspacePath,
        configPath: input.configPath,
        state: "parseError",
        environment: null,
        parseErrorMessage: error instanceof Error ? error.message : "Could not parse file",
      }),
      revision,
    };
  }
}

function resolvePreferredConfigPath(configs: WorktreeEnvironmentConfigRecord[]): string | null {
  const preferred =
    configs.find(
      (config) =>
        path.basename(config.configPath) === "environment.toml" && config.state === "success",
    ) ??
    configs.find((config) => config.state === "success") ??
    configs[0] ??
    null;

  return preferred?.configPath ?? null;
}

function generateConfigPath(
  configs: WorktreeEnvironmentConfigRecord[],
  workspacePath: string,
): string {
  const environmentRoot = resolveEnvironmentRoot(workspacePath);
  const existingPaths = new Set(
    configs.map((config) => path.resolve(workspacePath, config.configPath)),
  );
  const defaultAbsolutePath = path.resolve(environmentRoot, "environment.toml");
  if (!existingPaths.has(defaultAbsolutePath)) {
    return toPosixPath(path.relative(workspacePath, defaultAbsolutePath));
  }

  let index = 2;
  for (;;) {
    const absolutePath = path.resolve(environmentRoot, `environment-${index}.toml`);
    if (!existingPaths.has(absolutePath)) {
      return toPosixPath(path.relative(workspacePath, absolutePath));
    }
    index += 1;
  }
}

function defaultEnvironmentName(workspacePath: string): string {
  const fallback = path.basename(path.resolve(workspacePath));
  return fallback.trim().length > 0 ? fallback.trim() : "local";
}

export function createEmptyWorktreeEnvironmentDefinition(
  workspacePath: string,
): WorktreeEnvironmentDefinition {
  return {
    version: 1,
    name: defaultEnvironmentName(workspacePath),
    setup: {
      script: null,
      platformScripts: {},
    },
    cleanup: {
      script: null,
      platformScripts: {},
    },
    actions: [],
  };
}

export async function listWorktreeEnvironmentConfigs(
  workspacePath: string,
): Promise<WorktreeEnvironmentConfigRecord[]> {
  const normalizedWorkspacePath = workspacePath.trim();
  if (!normalizedWorkspacePath) return [];
  const resolvedWorkspacePath = path.resolve(normalizedWorkspacePath);
  const environmentRoot = resolveEnvironmentRoot(resolvedWorkspacePath);
  const canonicalEnvironmentRoot = await prepareCanonicalEnvironmentRoot({
    resolvedWorkspacePath,
    environmentRoot,
    create: false,
  }).catch(() => null);
  if (!canonicalEnvironmentRoot) return [];

  const entries = await readdir(canonicalEnvironmentRoot, { withFileTypes: true }).catch(() => []);
  const records: WorktreeEnvironmentConfigRecord[] = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile()) continue;
    if (path.extname(entry.name).toLowerCase() !== ".toml") continue;

    const absolutePath = path.resolve(canonicalEnvironmentRoot, entry.name);
    const configPath = toPosixPath(path.join(".codex", "environments", entry.name));
    const fileStat = await stat(absolutePath).catch((error) => {
      records.push(
        buildConfigRecord({
          workspacePath: resolvedWorkspacePath,
          configPath,
          state: "readError",
          environment: null,
          readErrorMessage: error instanceof Error ? error.message : "Could not inspect file",
        }),
      );
      return null;
    });
    if (fileStat === null) continue;
    if (fileStat.size > WORKTREE_ENVIRONMENT_MAX_BYTES) {
      records.push(
        buildConfigRecord({
          workspacePath: resolvedWorkspacePath,
          configPath,
          state: "tooLarge",
          environment: null,
          tooLargeMessage: `Environment file exceeds ${WORKTREE_ENVIRONMENT_MAX_BYTES.toLocaleString()} bytes`,
        }),
      );
      continue;
    }
    const raw = await readFile(absolutePath, "utf8").catch((error) => {
      records.push(
        buildConfigRecord({
          workspacePath: resolvedWorkspacePath,
          configPath,
          state: "readError",
          environment: null,
          readErrorMessage: error instanceof Error ? error.message : "Could not read file",
        }),
      );
      return null;
    });
    if (raw === null) continue;
    if (Buffer.byteLength(raw, "utf8") > WORKTREE_ENVIRONMENT_MAX_BYTES) {
      records.push(
        buildConfigRecord({
          workspacePath: resolvedWorkspacePath,
          configPath,
          state: "tooLarge",
          environment: null,
          tooLargeMessage: `Environment file exceeds ${WORKTREE_ENVIRONMENT_MAX_BYTES.toLocaleString()} bytes`,
        }),
      );
      continue;
    }

    try {
      const environment = parseWorktreeEnvironmentToml(raw, absolutePath);
      records.push(
        buildConfigRecord({
          workspacePath: resolvedWorkspacePath,
          configPath,
          state: "success",
          environment,
        }),
      );
    } catch (error) {
      records.push(
        buildConfigRecord({
          workspacePath: resolvedWorkspacePath,
          configPath,
          state: "parseError",
          environment: null,
          parseErrorMessage: error instanceof Error ? error.message : "Could not parse file",
        }),
      );
    }
  }

  return records;
}

export async function listWorktreeEnvironmentOptions(
  workspacePath: string,
): Promise<WorktreeEnvironmentOption[]> {
  const configs = await listWorktreeEnvironmentConfigs(workspacePath);

  return configs
    .filter((config) => config.state === "success")
    .map((config) => ({
      path: config.configPath,
      name: config.name,
      hasSetupScript: config.hasSetupScript,
      hasCleanupScript: config.hasCleanupScript,
      actionCount: config.actionCount,
    }));
}

async function readWorktreeEnvironmentRecord(input: {
  workspacePath: string;
  environmentPath: string;
}): Promise<WorktreeEnvironmentConfigRecord> {
  const { resolvedWorkspacePath, environmentRoot, relativePath, resolvedPath } =
    resolveEnvironmentPath(input);

  const resolvedEnvironmentRootPath = await prepareCanonicalEnvironmentRoot({
    resolvedWorkspacePath,
    environmentRoot,
    create: false,
  });
  const resolvedEnvironmentFilePath = await realpath(resolvedPath).catch(() => null);
  if (!resolvedEnvironmentFilePath) {
    throw new Error(`Environment file not found: ${relativePath}`);
  }
  if (!isPathWithin(resolvedEnvironmentRootPath, resolvedEnvironmentFilePath)) {
    throw new Error("Environment path must be inside .codex/environments");
  }

  const fileStat = await stat(resolvedEnvironmentFilePath).catch(() => null);
  if (!fileStat?.isFile()) {
    throw new Error(`Environment file not found: ${relativePath}`);
  }

  if (fileStat.size > WORKTREE_ENVIRONMENT_MAX_BYTES) {
    throw new Error(
      `Environment file is too large: ${relativePath} exceeds ${WORKTREE_ENVIRONMENT_MAX_BYTES.toLocaleString()} bytes`,
    );
  }

  const raw = await readFile(resolvedEnvironmentFilePath, "utf8");
  if (Buffer.byteLength(raw, "utf8") > WORKTREE_ENVIRONMENT_MAX_BYTES) {
    throw new Error(
      `Environment file is too large: ${relativePath} exceeds ${WORKTREE_ENVIRONMENT_MAX_BYTES.toLocaleString()} bytes`,
    );
  }

  try {
    const environment = parseWorktreeEnvironmentToml(raw, resolvedEnvironmentFilePath);
    return buildConfigRecord({
      workspacePath: resolvedWorkspacePath,
      configPath: toPosixPath(path.relative(resolvedWorkspacePath, resolvedPath)),
      state: "success",
      environment,
    });
  } catch (error) {
    throw new Error(
      `Could not parse environment file: ${relativePath}${error instanceof Error ? ` (${error.message})` : ""}`,
      { cause: error },
    );
  }
}

export async function readWorktreeEnvironmentDefinition(input: {
  workspacePath: string;
  environmentPath: string;
}): Promise<{
  path: string;
  name: string;
  setupScript: string | null;
  cleanupScript: string | null;
}> {
  const record = await readWorktreeEnvironmentRecord(input);
  const setup = record.environment?.setup;
  const platformSetupScript =
    process.platform === "darwin" || process.platform === "linux" || process.platform === "win32"
      ? (setup?.platformScripts[process.platform] ?? null)
      : null;
  const cleanup = record.environment?.cleanup;
  const platformCleanupScript =
    process.platform === "darwin" || process.platform === "linux" || process.platform === "win32"
      ? (cleanup?.platformScripts[process.platform] ?? null)
      : null;

  return {
    path: record.configPath,
    name: record.name,
    setupScript: platformSetupScript ?? setup?.script ?? null,
    cleanupScript: platformCleanupScript ?? cleanup?.script ?? null,
  };
}

export async function readWorktreeEnvironmentSettingsSnapshot(input: {
  projectId: string;
  projectName: string;
  workspacePath: string;
  configPath?: string | null;
}): Promise<WorktreeEnvironmentSettingsSnapshot> {
  const resolvedWorkspacePath = path.resolve(input.workspacePath.trim());
  const configs = await listWorktreeEnvironmentConfigs(resolvedWorkspacePath);
  const preferredConfigPath =
    input.configPath?.trim() ||
    resolvePreferredConfigPath(configs) ||
    generateConfigPath(configs, resolvedWorkspacePath);
  const listedRecord = configs.find((config) => config.configPath === preferredConfigPath) ?? null;
  const selected = await readSelectedEnvironmentState({
    workspacePath: resolvedWorkspacePath,
    configPath: preferredConfigPath,
    knownToExist: listedRecord !== null,
  });
  const selectedRecord = selected.record;
  let snapshotConfigs = configs;
  if (listedRecord && selectedRecord) {
    snapshotConfigs = configs.map((config) =>
      config.configPath === preferredConfigPath ? selectedRecord : config,
    );
  } else if (listedRecord) {
    snapshotConfigs = configs.filter((config) => config.configPath !== preferredConfigPath);
  } else if (selectedRecord) {
    snapshotConfigs = [...configs, selectedRecord];
  }

  return {
    projectId: input.projectId,
    projectName: input.projectName,
    workspacePath: resolvedWorkspacePath,
    configPath: preferredConfigPath,
    nextConfigPath: generateConfigPath(snapshotConfigs, resolvedWorkspacePath),
    configExists: selectedRecord !== null,
    revision: selected.revision,
    configs: snapshotConfigs,
    environment: selectedRecord?.environment ?? null,
    parseErrorMessage: selectedRecord?.parseErrorMessage ?? null,
    readErrorMessage: selectedRecord?.readErrorMessage ?? null,
    tooLargeMessage: selectedRecord?.tooLargeMessage ?? null,
  };
}

export async function saveWorktreeEnvironmentConfigFile(
  input: UpdateWorktreeEnvironmentConfigInput & {
    workspacePath: string;
  },
): Promise<WorktreeEnvironmentSaveResult> {
  const { resolvedWorkspacePath, environmentRoot, resolvedPath } = resolveEnvironmentPath({
    workspacePath: input.workspacePath,
    environmentPath: input.configPath,
  });

  assertExpectedRevision(input.expectedRevision);
  const raw = serializeWorktreeEnvironmentDefinition(input.environment);
  const initialTarget = await resolveCanonicalEnvironmentTarget({
    resolvedWorkspacePath,
    environmentRoot,
    resolvedPath,
    createRoot: true,
  });

  return runEnvironmentSaveQueued(initialTarget.canonicalTargetPath, async () => {
    const { canonicalTargetPath } = await resolveCanonicalEnvironmentTarget({
      resolvedWorkspacePath,
      environmentRoot,
      resolvedPath,
      createRoot: false,
    });

    if (input.expectedRevision === null) {
      try {
        await writeFile(canonicalTargetPath, raw, { encoding: "utf8", flag: "wx" });
        return { type: "success" };
      } catch (error) {
        if (!isNodeErrorWithCode(error, "EEXIST")) throw error;
        const currentStat = await lstat(canonicalTargetPath);
        if (!currentStat.isFile() || currentStat.size > WORKTREE_ENVIRONMENT_MAX_BYTES) {
          return { type: "conflict" };
        }
        const currentRaw = await readFile(canonicalTargetPath, "utf8");
        if (Buffer.byteLength(currentRaw, "utf8") > WORKTREE_ENVIRONMENT_MAX_BYTES) {
          return { type: "conflict" };
        }
        return currentRaw === raw ? { type: "success" } : { type: "conflict" };
      }
    }

    const currentStat = await stat(canonicalTargetPath).catch((error: unknown) => {
      if (isNodeErrorWithCode(error, "ENOENT")) return null;
      throw error;
    });
    if (!currentStat?.isFile() || currentStat.size > WORKTREE_ENVIRONMENT_MAX_BYTES) {
      return { type: "conflict" };
    }

    const currentRaw = await readFile(canonicalTargetPath, "utf8");
    if (Buffer.byteLength(currentRaw, "utf8") > WORKTREE_ENVIRONMENT_MAX_BYTES) {
      return { type: "conflict" };
    }
    if (currentRaw === raw) return { type: "success" };
    if (createEnvironmentRevision(currentRaw) !== input.expectedRevision) {
      return { type: "conflict" };
    }

    await writeFile(canonicalTargetPath, raw, "utf8");
    return { type: "success" };
  });
}
