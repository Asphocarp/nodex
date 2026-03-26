import { mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import type {
  UpdateWorktreeEnvironmentConfigInput,
  WorktreeEnvironmentActionDefinition,
  WorktreeEnvironmentActionIcon,
  WorktreeEnvironmentConfigRecord,
  WorktreeEnvironmentDefinition,
  WorktreeEnvironmentOption,
  WorktreeEnvironmentPlatform,
  WorktreeEnvironmentScriptDefinition,
  WorktreeEnvironmentSettingsSnapshot,
} from "../../shared/types";

interface ParsedEnvironmentToml extends Record<string, unknown> {
  version?: unknown;
  name?: unknown;
  setup?: unknown;
  cleanup?: unknown;
  actions?: unknown;
}

interface ParsedScriptTable extends Record<string, unknown> {
  script?: unknown;
}

const WORKTREE_ENVIRONMENT_PLATFORMS: WorktreeEnvironmentPlatform[] = [
  "darwin",
  "linux",
  "win32",
];

const WORKTREE_ENVIRONMENT_ACTION_ICONS: WorktreeEnvironmentActionIcon[] = [
  "tool",
  "run",
  "debug",
  "test",
];

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
  const normalizedPath = environmentPath.trim();
  if (!normalizedPath) {
    throw new Error("Environment path is required");
  }
  if (path.isAbsolute(normalizedPath)) {
    throw new Error("Environment path must be relative to workspace");
  }
  if (path.extname(normalizedPath).toLowerCase() !== ".toml") {
    throw new Error("Environment path must point to a .toml file");
  }

  return normalizedPath;
}

function resolveEnvironmentPath(input: {
  workspacePath: string;
  environmentPath: string;
}): {
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

function parseEnvironmentToml(raw: string): ParsedEnvironmentToml {
  const parsed = parseToml(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("TOML root must be an object");
  }

  return parsed as ParsedEnvironmentToml;
}

function normalizeScriptValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function parsePlatformScripts(value: unknown): WorktreeEnvironmentScriptDefinition {
  const result: WorktreeEnvironmentScriptDefinition = {
    script: null,
    platformScripts: {},
  };

  if (!value || typeof value !== "object") {
    return result;
  }

  const table = value as ParsedScriptTable;
  result.script = normalizeScriptValue(table.script);

  for (const platform of WORKTREE_ENVIRONMENT_PLATFORMS) {
    const platformTable = table[platform];
    if (!platformTable || typeof platformTable !== "object") continue;
    const script = normalizeScriptValue((platformTable as ParsedScriptTable).script);
    if (!script) continue;
    result.platformScripts[platform] = script;
  }

  return result;
}

function normalizeEnvironmentName(value: unknown, absolutePath: string): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  return path.basename(absolutePath, ".toml");
}

function normalizeActionIcon(value: unknown): WorktreeEnvironmentActionIcon {
  if (typeof value === "string" && WORKTREE_ENVIRONMENT_ACTION_ICONS.includes(value as WorktreeEnvironmentActionIcon)) {
    return value as WorktreeEnvironmentActionIcon;
  }

  return "tool";
}

function normalizeActionPlatform(value: unknown): WorktreeEnvironmentPlatform | null {
  if (typeof value !== "string") return null;
  if (!WORKTREE_ENVIRONMENT_PLATFORMS.includes(value as WorktreeEnvironmentPlatform)) return null;
  return value as WorktreeEnvironmentPlatform;
}

function parseActions(value: unknown): WorktreeEnvironmentActionDefinition[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];

    const candidate = entry as Record<string, unknown>;
    return [{
      id: `action-${index + 1}`,
      name: typeof candidate.name === "string" ? candidate.name.trim() : "",
      icon: normalizeActionIcon(candidate.icon),
      command: typeof candidate.command === "string" ? candidate.command.trim() : "",
      platform: normalizeActionPlatform(candidate.platform),
    }];
  });
}

function parseEnvironmentDefinition(raw: string, absolutePath: string): WorktreeEnvironmentDefinition {
  const parsed = parseEnvironmentToml(raw);
  const version = typeof parsed.version === "number" ? Math.trunc(parsed.version) : 1;

  return {
    version: Number.isFinite(version) && version > 0 ? version : 1,
    name: normalizeEnvironmentName(parsed.name, absolutePath),
    setup: parsePlatformScripts(parsed.setup),
    cleanup: parsePlatformScripts(parsed.cleanup),
    actions: parseActions(parsed.actions),
  };
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
      Boolean(environment?.setup.script) || Boolean(countOwnValues(environment?.setup.platformScripts ?? {})),
    hasCleanupScript:
      Boolean(environment?.cleanup.script) || Boolean(countOwnValues(environment?.cleanup.platformScripts ?? {})),
    actionCount: environment?.actions.length ?? 0,
    parseErrorMessage: input.parseErrorMessage ?? null,
    readErrorMessage: input.readErrorMessage ?? null,
    environment,
  };
}

function resolvePreferredConfigPath(configs: WorktreeEnvironmentConfigRecord[]): string | null {
  const preferred =
    configs.find((config) => path.basename(config.configPath) === "environment.toml" && config.state === "success")
    ?? configs.find((config) => config.state === "success")
    ?? configs[0]
    ?? null;

  return preferred?.configPath ?? null;
}

function generateConfigPath(configs: WorktreeEnvironmentConfigRecord[], workspacePath: string): string {
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

function buildSerializableScriptBlock(
  value: WorktreeEnvironmentScriptDefinition,
): Record<string, unknown> | null {
  const serialized: Record<string, unknown> = {};

  if (value.script?.trim()) {
    serialized.script = value.script.trim();
  }

  for (const platform of WORKTREE_ENVIRONMENT_PLATFORMS) {
    const script = value.platformScripts[platform]?.trim();
    if (!script) continue;
    serialized[platform] = { script };
  }

  return Object.keys(serialized).length > 0 ? serialized : null;
}

function buildSerializableActions(
  actions: WorktreeEnvironmentActionDefinition[],
): Array<Record<string, unknown>> {
  return actions.flatMap((action) => {
    const name = action.name.trim();
    const command = action.command.trim();
    if (!name || !command) return [];

    return [{
      name,
      icon: normalizeActionIcon(action.icon),
      command,
      ...(action.platform ? { platform: action.platform } : {}),
    }];
  });
}

export function serializeWorktreeEnvironmentDefinition(
  environment: WorktreeEnvironmentDefinition,
): string {
  const normalizedName = environment.name.trim();
  if (!normalizedName) {
    throw new Error("Environment name is required");
  }

  const serialized: Record<string, unknown> = {
    version: Number.isFinite(environment.version) && environment.version > 0
      ? Math.trunc(environment.version)
      : 1,
    name: normalizedName,
  };

  const setup = buildSerializableScriptBlock(environment.setup);
  if (setup) {
    serialized.setup = setup;
  }

  const cleanup = buildSerializableScriptBlock(environment.cleanup);
  if (cleanup) {
    serialized.cleanup = cleanup;
  }

  const actions = buildSerializableActions(environment.actions);
  if (actions.length > 0) {
    serialized.actions = actions;
  }

  return [
    "# Managed by Nodex local environment settings.",
    stringifyToml(serialized).trim(),
    "",
  ].join("\n");
}

export async function listWorktreeEnvironmentConfigs(
  workspacePath: string,
): Promise<WorktreeEnvironmentConfigRecord[]> {
  const normalizedWorkspacePath = workspacePath.trim();
  if (!normalizedWorkspacePath) return [];
  const resolvedWorkspacePath = path.resolve(normalizedWorkspacePath);
  const environmentRoot = resolveEnvironmentRoot(resolvedWorkspacePath);
  const rootStat = await stat(environmentRoot).catch(() => null);
  if (!rootStat?.isDirectory()) return [];

  const entries = await readdir(environmentRoot, { withFileTypes: true }).catch(() => []);
  const records: WorktreeEnvironmentConfigRecord[] = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isFile()) continue;
    if (path.extname(entry.name).toLowerCase() !== ".toml") continue;

    const absolutePath = path.resolve(environmentRoot, entry.name);
    const configPath = toPosixPath(path.relative(resolvedWorkspacePath, absolutePath));
    const raw = await readFile(absolutePath, "utf8").catch((error) => {
      records.push(buildConfigRecord({
        workspacePath: resolvedWorkspacePath,
        configPath,
        state: "readError",
        environment: null,
        readErrorMessage: error instanceof Error ? error.message : "Could not read file",
      }));
      return null;
    });
    if (raw === null) continue;

    try {
      const environment = parseEnvironmentDefinition(raw, absolutePath);
      records.push(buildConfigRecord({
        workspacePath: resolvedWorkspacePath,
        configPath,
        state: "success",
        environment,
      }));
    } catch (error) {
      records.push(buildConfigRecord({
        workspacePath: resolvedWorkspacePath,
        configPath,
        state: "parseError",
        environment: null,
        parseErrorMessage: error instanceof Error ? error.message : "Could not parse file",
      }));
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
  const {
    resolvedWorkspacePath,
    environmentRoot,
    relativePath,
    resolvedPath,
  } = resolveEnvironmentPath(input);

  const [resolvedEnvironmentRootPath, resolvedEnvironmentFilePath] = await Promise.all([
    realpath(environmentRoot).catch(() => null),
    realpath(resolvedPath).catch(() => null),
  ]);

  if (!resolvedEnvironmentRootPath) {
    throw new Error("Environment directory not found: .codex/environments");
  }
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

  const raw = await readFile(resolvedEnvironmentFilePath, "utf8");

  try {
    const environment = parseEnvironmentDefinition(raw, resolvedEnvironmentFilePath);
    return buildConfigRecord({
      workspacePath: resolvedWorkspacePath,
      configPath: toPosixPath(path.relative(resolvedWorkspacePath, resolvedPath)),
      state: "success",
      environment,
    });
  } catch (error) {
    throw new Error(
      `Could not parse environment file: ${relativePath}${error instanceof Error ? ` (${error.message})` : ""}`,
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
}> {
  const record = await readWorktreeEnvironmentRecord(input);

  return {
    path: record.configPath,
    name: record.name,
    setupScript: record.environment?.setup.script ?? null,
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
  const preferredConfigPath = input.configPath?.trim()
    || resolvePreferredConfigPath(configs)
    || generateConfigPath(configs, resolvedWorkspacePath);
  const selectedRecord = configs.find((config) => config.configPath === preferredConfigPath) ?? null;

  return {
    projectId: input.projectId,
    projectName: input.projectName,
    workspacePath: resolvedWorkspacePath,
    configPath: preferredConfigPath,
    nextConfigPath: generateConfigPath(configs, resolvedWorkspacePath),
    configExists: selectedRecord !== null,
    configs,
    environment: selectedRecord?.environment ?? null,
    parseErrorMessage: selectedRecord?.parseErrorMessage ?? null,
    readErrorMessage: selectedRecord?.readErrorMessage ?? null,
  };
}

export async function saveWorktreeEnvironmentSettingsSnapshot(
  input: UpdateWorktreeEnvironmentConfigInput & {
    projectName: string;
    workspacePath: string;
  },
): Promise<WorktreeEnvironmentSettingsSnapshot> {
  const {
    resolvedWorkspacePath,
    environmentRoot,
    relativePath,
    resolvedPath,
  } = resolveEnvironmentPath({
    workspacePath: input.workspacePath,
    environmentPath: input.configPath,
  });

  await mkdir(environmentRoot, { recursive: true });
  const raw = serializeWorktreeEnvironmentDefinition(input.environment);
  await writeFile(resolvedPath, raw, "utf8");

  return readWorktreeEnvironmentSettingsSnapshot({
    projectId: input.projectId,
    projectName: input.projectName,
    workspacePath: resolvedWorkspacePath,
    configPath: relativePath,
  });
}
