import path from "node:path";
import { parse as parseToml } from "smol-toml";
import type {
  WorktreeEnvironmentActionDefinition,
  WorktreeEnvironmentActionIcon,
  WorktreeEnvironmentDefinition,
  WorktreeEnvironmentPlatform,
  WorktreeEnvironmentScriptDefinition,
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

export const WORKTREE_ENVIRONMENT_PLATFORMS: readonly WorktreeEnvironmentPlatform[] = [
  "darwin",
  "linux",
  "win32",
];

const WORKTREE_ENVIRONMENT_ACTION_ICONS: readonly WorktreeEnvironmentActionIcon[] = [
  "tool",
  "run",
  "debug",
  "test",
];

export const WORKTREE_ENVIRONMENT_MAX_BYTES = 256 * 1024;
export const WORKTREE_ENVIRONMENT_NAME_MAX_CHARS = 256;
export const WORKTREE_ENVIRONMENT_SCRIPT_MAX_BYTES = 128 * 1024;
export const WORKTREE_ENVIRONMENT_ACTION_NAME_MAX_CHARS = 256;
export const WORKTREE_ENVIRONMENT_ACTION_COMMAND_MAX_BYTES = 32 * 1024;
export const WORKTREE_ENVIRONMENT_ACTION_MAX_COUNT = 100;

function assertMaximumCharacters(value: string, maxChars: number, label: string): void {
  if (value.length <= maxChars) return;
  throw new Error(`${label} must be at most ${maxChars.toLocaleString()} characters`);
}

function assertMaximumBytes(value: string, maxBytes: number, label: string): void {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return;
  throw new Error(`${label} must be at most ${maxBytes.toLocaleString()} bytes`);
}

function validateScriptDefinition(
  definition: WorktreeEnvironmentScriptDefinition,
  label: string,
): void {
  if (definition.script !== null) {
    assertMaximumBytes(definition.script, WORKTREE_ENVIRONMENT_SCRIPT_MAX_BYTES, `${label} script`);
  }

  for (const [platform, script] of Object.entries(definition.platformScripts)) {
    if (script === undefined) continue;
    assertMaximumBytes(
      script,
      WORKTREE_ENVIRONMENT_SCRIPT_MAX_BYTES,
      `${label} ${platform} script`,
    );
  }
}

export function validateWorktreeEnvironmentDefinition(
  environment: WorktreeEnvironmentDefinition,
): void {
  assertMaximumCharacters(
    environment.name,
    WORKTREE_ENVIRONMENT_NAME_MAX_CHARS,
    "Environment name",
  );
  validateScriptDefinition(environment.setup, "Setup");
  validateScriptDefinition(environment.cleanup, "Cleanup");

  if (environment.actions.length > WORKTREE_ENVIRONMENT_ACTION_MAX_COUNT) {
    throw new Error(
      `Environment can contain at most ${WORKTREE_ENVIRONMENT_ACTION_MAX_COUNT} actions`,
    );
  }

  for (const [index, action] of environment.actions.entries()) {
    assertMaximumCharacters(
      action.name,
      WORKTREE_ENVIRONMENT_ACTION_NAME_MAX_CHARS,
      `Action ${index + 1} name`,
    );
    assertMaximumBytes(
      action.command,
      WORKTREE_ENVIRONMENT_ACTION_COMMAND_MAX_BYTES,
      `Action ${index + 1} command`,
    );
  }
}

function normalizeScriptValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function parseScriptDefinition(
  value: unknown,
  label: "setup" | "cleanup",
): WorktreeEnvironmentScriptDefinition {
  const result: WorktreeEnvironmentScriptDefinition = {
    script: null,
    platformScripts: {},
  };

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a TOML table`);
  }

  const table = value as ParsedScriptTable;
  if (typeof table.script !== "string") {
    throw new Error(`${label}.script must be a string`);
  }
  result.script = normalizeScriptValue(table.script);

  for (const platform of WORKTREE_ENVIRONMENT_PLATFORMS) {
    const platformTable = table[platform];
    if (platformTable === undefined) continue;
    if (!platformTable || typeof platformTable !== "object" || Array.isArray(platformTable)) {
      throw new Error(`${label}.${platform} must be a TOML table`);
    }

    const platformScript = (platformTable as ParsedScriptTable).script;
    if (typeof platformScript !== "string") {
      throw new Error(`${label}.${platform}.script must be a string`);
    }
    const script = normalizeScriptValue(platformScript);
    if (script !== null) result.platformScripts[platform] = script;
  }

  return result;
}

function normalizeEnvironmentName(value: unknown, absolutePath: string): string {
  if (typeof value === "string") return value.trim();
  throw new Error(`name must be a string in ${path.basename(absolutePath)}`);
}

function normalizeActionIcon(value: unknown): WorktreeEnvironmentActionIcon | null {
  if (
    typeof value === "string"
    && WORKTREE_ENVIRONMENT_ACTION_ICONS.includes(value as WorktreeEnvironmentActionIcon)
  ) {
    return value as WorktreeEnvironmentActionIcon;
  }

  return null;
}

function normalizeActionPlatform(value: unknown): WorktreeEnvironmentPlatform | null {
  if (value === undefined) return null;
  if (
    typeof value === "string"
    && WORKTREE_ENVIRONMENT_PLATFORMS.includes(value as WorktreeEnvironmentPlatform)
  ) {
    return value as WorktreeEnvironmentPlatform;
  }

  throw new Error("Action platform must be darwin, linux, or win32");
}

function parseActions(value: unknown): WorktreeEnvironmentActionDefinition[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];

    const candidate = entry as Record<string, unknown>;
    if (typeof candidate.name !== "string" || typeof candidate.command !== "string") return [];

    const name = candidate.name.trim();
    const command = candidate.command.trim();
    if (!name || !command) return [];

    return [{
      name,
      icon: normalizeActionIcon(candidate.icon),
      command,
      platform: normalizeActionPlatform(candidate.platform),
    }];
  });
}

export function parseWorktreeEnvironmentToml(
  raw: string,
  absolutePath: string,
): WorktreeEnvironmentDefinition {
  const parsed = parseToml(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("TOML root must be an object");
  }

  const source = parsed as ParsedEnvironmentToml;
  const parsedVersion = source.version === undefined ? 1 : source.version;
  if (
    typeof parsedVersion !== "number"
    || !Number.isInteger(parsedVersion)
    || parsedVersion < 1
  ) {
    throw new Error("version must be a positive integer");
  }
  if (source.setup === undefined) throw new Error("setup is required");
  const environment: WorktreeEnvironmentDefinition = {
    version: parsedVersion,
    name: normalizeEnvironmentName(source.name, absolutePath),
    setup: parseScriptDefinition(source.setup, "setup"),
    cleanup: source.cleanup === undefined
      ? { script: null, platformScripts: {} }
      : parseScriptDefinition(source.cleanup, "cleanup"),
    actions: parseActions(source.actions),
  };

  validateWorktreeEnvironmentDefinition(environment);
  return environment;
}

function serializeTomlString(value: string): string {
  const normalized = value.replace(/\r\n?/g, "\n");
  if (!normalized.includes("\n")) return JSON.stringify(normalized);

  if (!normalized.includes("'''")) return `'''\n${normalized}'''`;

  const escaped = normalized
    .replace(/\\/g, "\\\\")
    .replace(/"""/g, '\\"""');
  return `"""\n${escaped}"""`;
}

function appendScriptSection(
  lines: string[],
  section: "setup" | "cleanup",
  definition: WorktreeEnvironmentScriptDefinition,
): void {
  const defaultScript = definition.script ?? "";
  const platformScripts = WORKTREE_ENVIRONMENT_PLATFORMS.flatMap((platform) => {
    const script = definition.platformScripts[platform];
    return script === undefined || script.length === 0 ? [] : [{ platform, script }];
  });

  if (section === "setup" || defaultScript.length > 0 || platformScripts.length > 0) {
    lines.push("", `[${section}]`, `script = ${serializeTomlString(defaultScript)}`);
  }

  if (platformScripts.length === 0) return;

  lines.push("");
  for (const [index, entry] of platformScripts.entries()) {
    lines.push(
      `[${section}.${entry.platform}]`,
      `script = ${serializeTomlString(entry.script)}`,
    );
    if (index < platformScripts.length - 1) lines.push("");
  }
}

export function serializeWorktreeEnvironmentDefinition(
  environment: WorktreeEnvironmentDefinition,
): string {
  validateWorktreeEnvironmentDefinition(environment);

  const name = environment.name.trim();
  if (!name) throw new Error("Environment name is required");

  const version = Number.isFinite(environment.version) && environment.version > 0
    ? Math.trunc(environment.version)
    : 1;
  const actions = environment.actions.flatMap((action) => {
    const normalizedName = action.name.trim();
    const command = action.command.trim();
    if (!normalizedName || !command) return [];
    return [{ ...action, name: normalizedName, command }];
  });
  const lines = [
    "# THIS IS AUTOGENERATED. DO NOT EDIT MANUALLY",
    `version = ${version}`,
    `name = ${serializeTomlString(name)}`,
  ];

  appendScriptSection(lines, "setup", environment.setup);
  appendScriptSection(lines, "cleanup", environment.cleanup);
  if (actions.length > 0) lines.push("");

  for (const action of actions) {
    lines.push(
      "[[actions]]",
      `name = ${serializeTomlString(action.name)}`,
    );
    if (action.icon) lines.push(`icon = ${serializeTomlString(action.icon)}`);
    lines.push(`command = ${serializeTomlString(action.command)}`);
    if (action.platform !== null) {
      lines.push(`platform = ${serializeTomlString(action.platform)}`);
    }
    lines.push("");
  }

  const raw = `${lines.join("\n").trimEnd()}\n`;
  assertMaximumBytes(raw, WORKTREE_ENVIRONMENT_MAX_BYTES, "Environment file");
  return raw;
}
