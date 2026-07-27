import * as path from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { resolveNodexHomePath } from "../nodex-home";
import { DATABASE_FILE_NAME } from "./database-file-migration";
import {
  applyCommandKeybindingUpdate,
  createCommandKeymapState,
  normalizeCommandKeybindingOverrides,
  type CommandKeybindingOverrides,
  type CommandKeybindingUpdate,
  type CommandKeymapState,
} from "../../shared/command-keybindings";
import type {
  AppUpdateSettings,
  BackupSettings,
  CodexDeveloperInstructionSettings,
  CodexGitSettings,
  CodexThreadDetailLevel,
  DiagnosticsSettings,
  HistorySettings,
  TelemetrySettings,
  ThreadNotificationSettings,
  ThreadNotificationTurnMode,
  UpdateAppUpdateSettingsInput,
  UpdateBackupSettingsInput,
  UpdateCodexDeveloperInstructionSettingsInput,
  UpdateCodexGitSettingsInput,
  UpdateDiagnosticsSettingsInput,
  UpdateHistorySettingsInput,
  UpdateTelemetrySettingsInput,
  UpdateThreadNotificationSettingsInput,
  UpdateWindowRestoreSettingsInput,
  WindowRestorePolicy,
  WindowRestoreSettings,
} from "../../shared/types";

// ─── TOML [server] config (user-level + CWD walk-up for project-level) ───

interface ServerTomlConfig {
  home?: string;
  backup_auto_enabled?: boolean;
  backup_interval_hours?: number;
  backup_retention?: number;
  thread_notifications_turn_mode?: ThreadNotificationTurnMode;
  thread_notifications_permissions_enabled?: boolean;
  thread_notifications_questions_enabled?: boolean;
  history_retention?: number;
  app_updates_auto_check_enabled?: boolean;
  window_restore_policy?: WindowRestorePolicy;
  diagnostics_enabled?: boolean;
  diagnostics_dsn?: string;
  diagnostics_environment?: string;
  diagnostics_release?: string;
  diagnostics_traces_sample_rate?: number;
  diagnostics_replay_enabled?: boolean;
  diagnostics_replays_session_sample_rate?: number;
  diagnostics_replays_on_error_sample_rate?: number;
  telemetry_enabled?: boolean;
  telemetry_client_key?: string;
  telemetry_environment?: string;
  telemetry_auto_capture_enabled?: boolean;
  command_keybindings?: Record<string, unknown>;
  codex_thread_detail_level?: CodexThreadDetailLevel;
  git_branch_prefix?: string;
  git_commit_instructions?: string;
  git_pr_instructions?: string;
}

interface RootTomlConfig extends Record<string, unknown> {
  server?: ServerTomlConfig;
}

const BACKUP_AUTO_DEFAULT = false;
const BACKUP_INTERVAL_DEFAULT = 6;
const BACKUP_RETENTION_DEFAULT = 28;
const THREAD_NOTIFICATIONS_TURN_MODE_DEFAULT: ThreadNotificationTurnMode = "unfocused";
const THREAD_NOTIFICATIONS_PERMISSIONS_ENABLED_DEFAULT = true;
const THREAD_NOTIFICATIONS_QUESTIONS_ENABLED_DEFAULT = true;
const APP_UPDATES_AUTO_CHECK_DEFAULT = true;
const WINDOW_RESTORE_POLICY_DEFAULT: WindowRestorePolicy = "all";
export const DEFAULT_SENTRY_DSN =
  "https://ecf630563128267bf9798a10b45a089a@o4511580306014208.ingest.us.sentry.io/4511580310011904";
export const DEFAULT_STATSIG_CLIENT_KEY =
  "client-wpoc5Yx721NAMgJde6jcWUTiEP9kp2Ll9nr4EUxdmiP";
const DIAGNOSTICS_ENVIRONMENT_DEFAULT = "production";
const DIAGNOSTICS_TRACES_SAMPLE_RATE_DEFAULT = 0;
const DIAGNOSTICS_REPLAY_ENABLED_DEFAULT = false;
const DIAGNOSTICS_REPLAYS_SESSION_SAMPLE_RATE_DEFAULT = 0.1;
const DIAGNOSTICS_REPLAYS_ON_ERROR_SAMPLE_RATE_DEFAULT = 1;
const TELEMETRY_ENVIRONMENT_DEFAULT = "production";
const TELEMETRY_AUTO_CAPTURE_ENABLED_DEFAULT = false;
const CODEX_THREAD_DETAIL_LEVEL_DEFAULT: CodexThreadDetailLevel = "STEPS_COMMANDS";
const CODEX_GIT_BRANCH_PREFIX_DEFAULT = "codex/";

function readServerSection(configPath: string): ServerTomlConfig | null {
  try {
    const raw = readFileSync(configPath, "utf8");
    const parsed = parseToml(raw) as Record<string, unknown>;
    return (parsed.server as ServerTomlConfig) ?? null;
  } catch {
    return null;
  }
}

function findProjectConfig(): string | null {
  let dir = process.cwd();
  for (;;) {
    const candidate = path.join(dir, ".nodex", "config.toml");
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function loadServerTomlConfig(): ServerTomlConfig {
  const merged: ServerTomlConfig = {};

  // User-level (~/.nodex/config.toml)
  const homeConfig = path.join(getHomeDir(), ".nodex", "config.toml");
  const homeServer = readServerSection(homeConfig);
  if (homeServer) Object.assign(merged, homeServer);

  // Project-level (CWD walk-up) overrides user-level
  const projectConfig = findProjectConfig();
  if (projectConfig) {
    const projectServer = readServerSection(projectConfig);
    if (projectServer) Object.assign(merged, projectServer);
  }

  return merged;
}

function loadUserServerTomlConfig(): ServerTomlConfig {
  const homeConfig = path.join(getHomeDir(), ".nodex", "config.toml");
  return readServerSection(homeConfig) ?? {};
}

function getUserConfigPath(): string {
  return path.join(getHomeDir(), ".nodex", "config.toml");
}

function getHomeDir(): string {
  const envHome = process.env.HOME?.trim();
  if (envHome) return envHome;
  return homedir();
}

function readTomlConfig(configPath: string): RootTomlConfig {
  if (!existsSync(configPath)) {
    return {};
  }

  try {
    const raw = readFileSync(configPath, "utf8");
    const parsed = parseToml(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as RootTomlConfig;
    }
    return {};
  } catch (error) {
    throw new Error(`Could not read config file at ${configPath}: ${(error as Error).message}`);
  }
}

function writeUserServerTomlConfig(nextServer: ServerTomlConfig): void {
  const userConfigPath = getUserConfigPath();
  const nextToml = readTomlConfig(userConfigPath);
  nextToml.server = nextServer;

  const configDirectory = path.dirname(userConfigPath);
  mkdirSync(configDirectory, { recursive: true });
  writeFileSync(userConfigPath, stringifyToml(nextToml as Record<string, unknown>), "utf8");

  userServerToml = loadUserServerTomlConfig();
  serverToml = loadServerTomlConfig();
}

let userServerToml = loadUserServerTomlConfig();
let serverToml = loadServerTomlConfig();

// ─── Getters (resolution: env → TOML → default) ───

export function getNodexHome(): string {
  return resolveNodexHomePath({
    cwd: process.cwd(),
    env: process.env,
    userHome: getHomeDir(),
    configuredHome: serverToml.home,
  });
}

export function getDatabasePath(): string {
  return path.join(getNodexHome(), DATABASE_FILE_NAME);
}

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true;
  }
  return fallback;
}

function parseIntegerEnv(
  value: string | undefined,
  fallback: number,
  minimum: number
): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.max(minimum, parsed);
}

function parseNumberEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) return fallback;
  return parsed;
}

function normalizeSampleRate(value: number, fieldName: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${fieldName} must be a number`);
  }
  if (value < 0 || value > 1) {
    throw new Error(`${fieldName} must be between 0 and 1`);
  }
  return value;
}

function normalizeOptionalStringInput(value: string | null, fieldName: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new Error(`${fieldName} must be a string`);
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeIntegerInput(value: number, minimum: number, fieldName: string): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${fieldName} must be a number`);
  }
  const normalized = Math.trunc(value);
  if (normalized < minimum) {
    throw new Error(`${fieldName} must be at least ${minimum}`);
  }
  return normalized;
}

function backupSettingsFromConfig(config: ServerTomlConfig): Omit<BackupSettings, "envOverrides"> {
  const autoEnabled =
    typeof config.backup_auto_enabled === "boolean"
      ? config.backup_auto_enabled
      : BACKUP_AUTO_DEFAULT;
  const intervalHours =
    typeof config.backup_interval_hours === "number"
      ? Math.max(1, config.backup_interval_hours)
      : BACKUP_INTERVAL_DEFAULT;
  const retentionCount =
    typeof config.backup_retention === "number"
      ? Math.max(0, config.backup_retention)
      : BACKUP_RETENTION_DEFAULT;

  return {
    autoEnabled,
    intervalHours,
    retentionCount,
  };
}

function threadNotificationSettingsFromConfig(config: ServerTomlConfig): ThreadNotificationSettings {
  return {
    turnMode:
      config.thread_notifications_turn_mode === "off"
      || config.thread_notifications_turn_mode === "unfocused"
      || config.thread_notifications_turn_mode === "always"
        ? config.thread_notifications_turn_mode
        : THREAD_NOTIFICATIONS_TURN_MODE_DEFAULT,
    permissionsEnabled:
      typeof config.thread_notifications_permissions_enabled === "boolean"
        ? config.thread_notifications_permissions_enabled
        : THREAD_NOTIFICATIONS_PERMISSIONS_ENABLED_DEFAULT,
    questionsEnabled:
      typeof config.thread_notifications_questions_enabled === "boolean"
        ? config.thread_notifications_questions_enabled
        : THREAD_NOTIFICATIONS_QUESTIONS_ENABLED_DEFAULT,
  };
}

function appUpdateSettingsFromConfig(config: ServerTomlConfig): AppUpdateSettings {
  return {
    automaticChecksEnabled:
      typeof config.app_updates_auto_check_enabled === "boolean"
        ? config.app_updates_auto_check_enabled
        : APP_UPDATES_AUTO_CHECK_DEFAULT,
  };
}

function windowRestoreSettingsFromConfig(config: ServerTomlConfig): WindowRestoreSettings {
  return {
    policy:
      config.window_restore_policy === "all"
      || config.window_restore_policy === "last-window"
      || config.window_restore_policy === "none"
        ? config.window_restore_policy
        : WINDOW_RESTORE_POLICY_DEFAULT,
  };
}

function diagnosticsSettingsFromConfig(config: ServerTomlConfig): Omit<DiagnosticsSettings, "envOverrides"> {
  const enabled = config.diagnostics_enabled === true;
  const configuredDsn = typeof config.diagnostics_dsn === "string"
    ? config.diagnostics_dsn.trim()
    : "";
  const environment = typeof config.diagnostics_environment === "string" && config.diagnostics_environment.trim()
    ? config.diagnostics_environment.trim()
    : DIAGNOSTICS_ENVIRONMENT_DEFAULT;
  const release = typeof config.diagnostics_release === "string" && config.diagnostics_release.trim()
    ? config.diagnostics_release.trim()
    : null;
  const tracesSampleRate = typeof config.diagnostics_traces_sample_rate === "number"
    ? Math.min(1, Math.max(0, config.diagnostics_traces_sample_rate))
    : DIAGNOSTICS_TRACES_SAMPLE_RATE_DEFAULT;
  const replayEnabled =
    typeof config.diagnostics_replay_enabled === "boolean"
      ? config.diagnostics_replay_enabled
      : DIAGNOSTICS_REPLAY_ENABLED_DEFAULT;
  const replaysSessionSampleRate =
    typeof config.diagnostics_replays_session_sample_rate === "number"
      ? Math.min(1, Math.max(0, config.diagnostics_replays_session_sample_rate))
      : DIAGNOSTICS_REPLAYS_SESSION_SAMPLE_RATE_DEFAULT;
  const replaysOnErrorSampleRate =
    typeof config.diagnostics_replays_on_error_sample_rate === "number"
      ? Math.min(1, Math.max(0, config.diagnostics_replays_on_error_sample_rate))
      : DIAGNOSTICS_REPLAYS_ON_ERROR_SAMPLE_RATE_DEFAULT;

  return {
    enabled,
    dsn: configuredDsn || (enabled ? DEFAULT_SENTRY_DSN : ""),
    environment,
    release,
    tracesSampleRate,
    replayEnabled,
    replaysSessionSampleRate,
    replaysOnErrorSampleRate,
  };
}

function telemetrySettingsFromConfig(config: ServerTomlConfig): Omit<TelemetrySettings, "envOverrides"> {
  const enabled = config.telemetry_enabled === true;
  const configuredClientKey = typeof config.telemetry_client_key === "string"
    ? config.telemetry_client_key.trim()
    : "";
  const environment =
    typeof config.telemetry_environment === "string" && config.telemetry_environment.trim()
      ? config.telemetry_environment.trim()
      : TELEMETRY_ENVIRONMENT_DEFAULT;
  const autoCaptureEnabled =
    typeof config.telemetry_auto_capture_enabled === "boolean"
      ? config.telemetry_auto_capture_enabled
      : TELEMETRY_AUTO_CAPTURE_ENABLED_DEFAULT;

  return {
    enabled,
    clientKey: configuredClientKey || (enabled ? DEFAULT_STATSIG_CLIENT_KEY : ""),
    environment,
    autoCaptureEnabled,
  };
}

export function getBackupSettings(): BackupSettings {
  const fromToml = backupSettingsFromConfig(serverToml);
  const envOverrides = {
    autoEnabled: process.env.NODEX_BACKUP_AUTO_ENABLED !== undefined,
    intervalHours: process.env.NODEX_BACKUP_INTERVAL_HOURS !== undefined,
    retentionCount: process.env.NODEX_BACKUP_RETENTION !== undefined,
  };

  return {
    autoEnabled: envOverrides.autoEnabled
      ? parseBooleanEnv(process.env.NODEX_BACKUP_AUTO_ENABLED, fromToml.autoEnabled)
      : fromToml.autoEnabled,
    intervalHours: envOverrides.intervalHours
      ? parseIntegerEnv(process.env.NODEX_BACKUP_INTERVAL_HOURS, fromToml.intervalHours, 1)
      : fromToml.intervalHours,
    retentionCount: envOverrides.retentionCount
      ? parseIntegerEnv(process.env.NODEX_BACKUP_RETENTION, fromToml.retentionCount, 0)
      : fromToml.retentionCount,
    envOverrides,
  };
}

export function updateBackupSettings(input: UpdateBackupSettingsInput): BackupSettings {
  if (typeof input.autoEnabled !== "boolean") {
    throw new Error("autoEnabled must be a boolean");
  }

  const nextSettings = {
    autoEnabled: input.autoEnabled,
    intervalHours: normalizeIntegerInput(input.intervalHours, 1, "intervalHours"),
    retentionCount: normalizeIntegerInput(input.retentionCount, 0, "retentionCount"),
  };

  const userConfigPath = getUserConfigPath();
  const nextToml = readTomlConfig(userConfigPath);
  const nextServer = {
    ...(nextToml.server ?? {}),
    backup_auto_enabled: nextSettings.autoEnabled,
    backup_interval_hours: nextSettings.intervalHours,
    backup_retention: nextSettings.retentionCount,
  };

  nextToml.server = nextServer;

  const configDirectory = path.dirname(userConfigPath);
  mkdirSync(configDirectory, { recursive: true });
  writeFileSync(userConfigPath, stringifyToml(nextToml as Record<string, unknown>), "utf8");

  userServerToml = loadUserServerTomlConfig();
  serverToml = loadServerTomlConfig();

  return getBackupSettings();
}

export function getHistorySettings(): HistorySettings {
  const fromToml =
    typeof serverToml.history_retention === "number"
      ? Math.max(0, serverToml.history_retention)
      : 1000;
  const envOverrides = {
    retentionCount: process.env.NODEX_HISTORY_RETENTION !== undefined,
  };

  return {
    retentionCount: envOverrides.retentionCount
      ? parseIntegerEnv(process.env.NODEX_HISTORY_RETENTION, fromToml, 0)
      : fromToml,
    envOverrides,
  };
}

export function updateHistorySettings(input: UpdateHistorySettingsInput): HistorySettings {
  const nextSettings = {
    retentionCount: normalizeIntegerInput(input.retentionCount, 0, "retentionCount"),
  };

  const userConfigPath = getUserConfigPath();
  const nextToml = readTomlConfig(userConfigPath);
  const nextServer = {
    ...(nextToml.server ?? {}),
    history_retention: nextSettings.retentionCount,
  };

  nextToml.server = nextServer;

  const configDirectory = path.dirname(userConfigPath);
  mkdirSync(configDirectory, { recursive: true });
  writeFileSync(userConfigPath, stringifyToml(nextToml as Record<string, unknown>), "utf8");

  userServerToml = loadUserServerTomlConfig();
  serverToml = loadServerTomlConfig();

  return getHistorySettings();
}

export function getDiagnosticsSettings(): DiagnosticsSettings {
  const fromToml = diagnosticsSettingsFromConfig(userServerToml);
  const envOverrides = {
    enabled: process.env.NODEX_SENTRY_ENABLED !== undefined,
    dsn: process.env.SENTRY_DSN !== undefined,
    environment: process.env.SENTRY_ENVIRONMENT !== undefined,
    release: process.env.SENTRY_RELEASE !== undefined,
    tracesSampleRate: process.env.NODEX_SENTRY_TRACES_SAMPLE_RATE !== undefined,
    replayEnabled: process.env.NODEX_SENTRY_REPLAY_ENABLED !== undefined,
    replaysSessionSampleRate:
      process.env.NODEX_SENTRY_REPLAYS_SESSION_SAMPLE_RATE !== undefined,
    replaysOnErrorSampleRate:
      process.env.NODEX_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE !== undefined,
  };

  const enabled = envOverrides.enabled
    ? parseBooleanEnv(process.env.NODEX_SENTRY_ENABLED, fromToml.enabled)
    : fromToml.enabled;
  const dsnFromEnv = process.env.SENTRY_DSN?.trim() ?? "";
  const dsn = envOverrides.dsn
    ? dsnFromEnv
    : fromToml.dsn || (enabled ? DEFAULT_SENTRY_DSN : "");
  const environmentFromEnv = process.env.SENTRY_ENVIRONMENT?.trim() ?? "";
  const environment = envOverrides.environment && environmentFromEnv
    ? environmentFromEnv
    : fromToml.environment;
  const releaseFromEnv = process.env.SENTRY_RELEASE?.trim() ?? "";
  const release = envOverrides.release
    ? (releaseFromEnv || null)
    : fromToml.release;
  const tracesSampleRate = envOverrides.tracesSampleRate
    ? Math.min(1, Math.max(0, parseNumberEnv(
        process.env.NODEX_SENTRY_TRACES_SAMPLE_RATE,
        fromToml.tracesSampleRate,
      )))
    : fromToml.tracesSampleRate;
  const replayEnabled = envOverrides.replayEnabled
    ? parseBooleanEnv(process.env.NODEX_SENTRY_REPLAY_ENABLED, fromToml.replayEnabled)
    : fromToml.replayEnabled;
  const replaysSessionSampleRate = envOverrides.replaysSessionSampleRate
    ? Math.min(1, Math.max(0, parseNumberEnv(
        process.env.NODEX_SENTRY_REPLAYS_SESSION_SAMPLE_RATE,
        fromToml.replaysSessionSampleRate,
      )))
    : fromToml.replaysSessionSampleRate;
  const replaysOnErrorSampleRate = envOverrides.replaysOnErrorSampleRate
    ? Math.min(1, Math.max(0, parseNumberEnv(
        process.env.NODEX_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE,
        fromToml.replaysOnErrorSampleRate,
      )))
    : fromToml.replaysOnErrorSampleRate;

  return {
    enabled,
    dsn,
    environment,
    release,
    tracesSampleRate,
    replayEnabled,
    replaysSessionSampleRate,
    replaysOnErrorSampleRate,
    envOverrides,
  };
}

export function updateDiagnosticsSettings(
  input: UpdateDiagnosticsSettingsInput,
): DiagnosticsSettings {
  if (typeof input.enabled !== "boolean") {
    throw new Error("enabled must be a boolean");
  }
  const nextSettings = {
    enabled: input.enabled,
    dsn: normalizeOptionalStringInput(input.dsn, "dsn"),
    environment:
      normalizeOptionalStringInput(input.environment, "environment")
      ?? DIAGNOSTICS_ENVIRONMENT_DEFAULT,
    release: normalizeOptionalStringInput(input.release, "release"),
    tracesSampleRate: normalizeSampleRate(input.tracesSampleRate, "tracesSampleRate"),
    replayEnabled: input.replayEnabled,
    replaysSessionSampleRate: normalizeSampleRate(
      input.replaysSessionSampleRate,
      "replaysSessionSampleRate",
    ),
    replaysOnErrorSampleRate: normalizeSampleRate(
      input.replaysOnErrorSampleRate,
      "replaysOnErrorSampleRate",
    ),
  };
  if (typeof nextSettings.replayEnabled !== "boolean") {
    throw new Error("replayEnabled must be a boolean");
  }

  const userConfigPath = getUserConfigPath();
  const nextToml = readTomlConfig(userConfigPath);
  const nextServer: ServerTomlConfig = {
    ...(nextToml.server ?? {}),
    diagnostics_enabled: nextSettings.enabled,
    diagnostics_environment: nextSettings.environment,
    diagnostics_traces_sample_rate: nextSettings.tracesSampleRate,
    diagnostics_replay_enabled: nextSettings.replayEnabled,
    diagnostics_replays_session_sample_rate: nextSettings.replaysSessionSampleRate,
    diagnostics_replays_on_error_sample_rate: nextSettings.replaysOnErrorSampleRate,
  };
  if (nextSettings.dsn) {
    nextServer.diagnostics_dsn = nextSettings.dsn;
  } else {
    delete nextServer.diagnostics_dsn;
  }
  if (nextSettings.release) {
    nextServer.diagnostics_release = nextSettings.release;
  } else {
    delete nextServer.diagnostics_release;
  }

  nextToml.server = nextServer;

  const configDirectory = path.dirname(userConfigPath);
  mkdirSync(configDirectory, { recursive: true });
  writeFileSync(userConfigPath, stringifyToml(nextToml as Record<string, unknown>), "utf8");

  userServerToml = loadUserServerTomlConfig();
  serverToml = loadServerTomlConfig();

  return getDiagnosticsSettings();
}

export function getTelemetrySettings(): TelemetrySettings {
  const fromToml = telemetrySettingsFromConfig(userServerToml);
  const envOverrides = {
    enabled: process.env.NODEX_TELEMETRY_ENABLED !== undefined,
    clientKey: process.env.STATSIG_CLIENT_KEY !== undefined,
    environment: process.env.STATSIG_ENVIRONMENT !== undefined,
    autoCaptureEnabled: process.env.NODEX_TELEMETRY_AUTOCAPTURE_ENABLED !== undefined,
  };

  const enabled = envOverrides.enabled
    ? parseBooleanEnv(process.env.NODEX_TELEMETRY_ENABLED, fromToml.enabled)
    : fromToml.enabled;
  const clientKeyFromEnv = process.env.STATSIG_CLIENT_KEY?.trim() ?? "";
  const clientKey = envOverrides.clientKey
    ? clientKeyFromEnv
    : fromToml.clientKey || (enabled ? DEFAULT_STATSIG_CLIENT_KEY : "");
  const environmentFromEnv = process.env.STATSIG_ENVIRONMENT?.trim() ?? "";
  const environment = envOverrides.environment && environmentFromEnv
    ? environmentFromEnv
    : fromToml.environment;
  const autoCaptureEnabled = envOverrides.autoCaptureEnabled
    ? parseBooleanEnv(
        process.env.NODEX_TELEMETRY_AUTOCAPTURE_ENABLED,
        fromToml.autoCaptureEnabled,
      )
    : fromToml.autoCaptureEnabled;

  return {
    enabled,
    clientKey,
    environment,
    autoCaptureEnabled,
    envOverrides,
  };
}

export function updateTelemetrySettings(
  input: UpdateTelemetrySettingsInput,
): TelemetrySettings {
  if (typeof input.enabled !== "boolean") {
    throw new Error("enabled must be a boolean");
  }
  if (typeof input.autoCaptureEnabled !== "boolean") {
    throw new Error("autoCaptureEnabled must be a boolean");
  }

  const nextSettings = {
    enabled: input.enabled,
    clientKey: normalizeOptionalStringInput(input.clientKey, "clientKey"),
    environment:
      normalizeOptionalStringInput(input.environment, "environment")
      ?? TELEMETRY_ENVIRONMENT_DEFAULT,
    autoCaptureEnabled: input.autoCaptureEnabled,
  };

  const userConfigPath = getUserConfigPath();
  const nextToml = readTomlConfig(userConfigPath);
  const nextServer: ServerTomlConfig = {
    ...(nextToml.server ?? {}),
    telemetry_enabled: nextSettings.enabled,
    telemetry_environment: nextSettings.environment,
    telemetry_auto_capture_enabled: nextSettings.autoCaptureEnabled,
  };
  if (nextSettings.clientKey) {
    nextServer.telemetry_client_key = nextSettings.clientKey;
  } else {
    delete nextServer.telemetry_client_key;
  }

  nextToml.server = nextServer;

  const configDirectory = path.dirname(userConfigPath);
  mkdirSync(configDirectory, { recursive: true });
  writeFileSync(userConfigPath, stringifyToml(nextToml as Record<string, unknown>), "utf8");

  userServerToml = loadUserServerTomlConfig();
  serverToml = loadServerTomlConfig();

  return getTelemetrySettings();
}

export function getThreadNotificationSettings(): ThreadNotificationSettings {
  return threadNotificationSettingsFromConfig(userServerToml);
}

function isCodexThreadDetailLevel(value: unknown): value is CodexThreadDetailLevel {
  return value === "STEPS_PROSE"
    || value === "STEPS_COMMANDS"
    || value === "STEPS_EXECUTION";
}

export function getCodexDeveloperInstructionSettings(): CodexDeveloperInstructionSettings {
  return {
    detailLevel: isCodexThreadDetailLevel(userServerToml.codex_thread_detail_level)
      ? userServerToml.codex_thread_detail_level
      : CODEX_THREAD_DETAIL_LEVEL_DEFAULT,
  };
}

export function updateCodexDeveloperInstructionSettings(
  input: UpdateCodexDeveloperInstructionSettingsInput,
): CodexDeveloperInstructionSettings {
  if (!isCodexThreadDetailLevel(input.detailLevel)) {
    throw new Error("detailLevel must be one of STEPS_PROSE, STEPS_COMMANDS, or STEPS_EXECUTION");
  }
  writeUserServerTomlConfig({
    ...loadUserServerTomlConfig(),
    codex_thread_detail_level: input.detailLevel,
  });
  return getCodexDeveloperInstructionSettings();
}

export function getCodexGitSettings(): CodexGitSettings {
  return {
    branchPrefix: typeof userServerToml.git_branch_prefix === "string"
      ? userServerToml.git_branch_prefix
      : CODEX_GIT_BRANCH_PREFIX_DEFAULT,
    commitInstructions: typeof userServerToml.git_commit_instructions === "string"
      ? userServerToml.git_commit_instructions
      : "",
    pullRequestInstructions: typeof userServerToml.git_pr_instructions === "string"
      ? userServerToml.git_pr_instructions
      : "",
  };
}

export function updateCodexGitSettings(input: UpdateCodexGitSettingsInput): CodexGitSettings {
  const entries = Object.entries(input);
  if (entries.length === 0) return getCodexGitSettings();
  const allowedKeys = new Set(["branchPrefix", "commitInstructions", "pullRequestInstructions"]);
  if (entries.some(([key]) => !allowedKeys.has(key))) {
    throw new Error("Unknown Git setting");
  }
  if (entries.some(([, value]) => typeof value !== "string")) {
    throw new Error("Git setting values must be strings");
  }

  const next = { ...loadUserServerTomlConfig() };
  if (input.branchPrefix !== undefined) next.git_branch_prefix = input.branchPrefix;
  if (input.commitInstructions !== undefined) next.git_commit_instructions = input.commitInstructions;
  if (input.pullRequestInstructions !== undefined) next.git_pr_instructions = input.pullRequestInstructions;
  writeUserServerTomlConfig(next);
  return getCodexGitSettings();
}

export function getCommandKeybindingOverrides(): CommandKeybindingOverrides {
  return normalizeCommandKeybindingOverrides(userServerToml.command_keybindings);
}

export function getCommandKeymapState(): CommandKeymapState {
  return createCommandKeymapState(getCommandKeybindingOverrides());
}

export function updateCommandKeybinding(
  commandId: string,
  update: CommandKeybindingUpdate,
): CommandKeymapState {
  const currentOverrides = getCommandKeybindingOverrides();
  const nextOverrides = applyCommandKeybindingUpdate(currentOverrides, commandId, update);
  writeCommandKeybindingOverrides(nextOverrides);
  return getCommandKeymapState();
}

export function resetCommandKeybindings(): CommandKeymapState {
  writeCommandKeybindingOverrides({});
  return getCommandKeymapState();
}

function writeCommandKeybindingOverrides(overrides: CommandKeybindingOverrides): void {
  const nextServer: ServerTomlConfig = { ...(loadUserServerTomlConfig() ?? {}) };
  if (Object.keys(overrides).length === 0) {
    delete nextServer.command_keybindings;
  } else {
    nextServer.command_keybindings = overrides;
  }
  writeUserServerTomlConfig(nextServer);
}

export function updateThreadNotificationSettings(
  input: UpdateThreadNotificationSettingsInput,
): ThreadNotificationSettings {
  if (input.turnMode !== "off" && input.turnMode !== "unfocused" && input.turnMode !== "always") {
    throw new Error("turnMode must be one of off, unfocused, or always");
  }
  if (typeof input.permissionsEnabled !== "boolean") {
    throw new Error("permissionsEnabled must be a boolean");
  }
  if (typeof input.questionsEnabled !== "boolean") {
    throw new Error("questionsEnabled must be a boolean");
  }

  const nextSettings = {
    turnMode: input.turnMode,
    permissionsEnabled: input.permissionsEnabled,
    questionsEnabled: input.questionsEnabled,
  };

  const userConfigPath = getUserConfigPath();
  const nextToml = readTomlConfig(userConfigPath);
  const nextServer = {
    ...(nextToml.server ?? {}),
    thread_notifications_turn_mode: nextSettings.turnMode,
    thread_notifications_permissions_enabled: nextSettings.permissionsEnabled,
    thread_notifications_questions_enabled: nextSettings.questionsEnabled,
  };

  nextToml.server = nextServer;

  const configDirectory = path.dirname(userConfigPath);
  mkdirSync(configDirectory, { recursive: true });
  writeFileSync(userConfigPath, stringifyToml(nextToml as Record<string, unknown>), "utf8");

  userServerToml = loadUserServerTomlConfig();
  serverToml = loadServerTomlConfig();

  return getThreadNotificationSettings();
}

export function getAppUpdateSettings(): AppUpdateSettings {
  return appUpdateSettingsFromConfig(userServerToml);
}

export function updateAppUpdateSettings(
  input: UpdateAppUpdateSettingsInput,
): AppUpdateSettings {
  if (typeof input.automaticChecksEnabled !== "boolean") {
    throw new Error("automaticChecksEnabled must be a boolean");
  }

  const userConfigPath = getUserConfigPath();
  const nextToml = readTomlConfig(userConfigPath);
  const nextServer = {
    ...(nextToml.server ?? {}),
    app_updates_auto_check_enabled: input.automaticChecksEnabled,
  };

  nextToml.server = nextServer;

  const configDirectory = path.dirname(userConfigPath);
  mkdirSync(configDirectory, { recursive: true });
  writeFileSync(userConfigPath, stringifyToml(nextToml as Record<string, unknown>), "utf8");

  userServerToml = loadUserServerTomlConfig();
  serverToml = loadServerTomlConfig();

  return getAppUpdateSettings();
}

export function getWindowRestoreSettings(): WindowRestoreSettings {
  return windowRestoreSettingsFromConfig(userServerToml);
}

export function updateWindowRestoreSettings(
  input: UpdateWindowRestoreSettingsInput,
): WindowRestoreSettings {
  if (input.policy !== "all" && input.policy !== "last-window" && input.policy !== "none") {
    throw new Error("policy must be one of all, last-window, or none");
  }

  const userConfigPath = getUserConfigPath();
  const nextToml = readTomlConfig(userConfigPath);
  const nextServer = {
    ...(nextToml.server ?? {}),
    window_restore_policy: input.policy,
  };

  nextToml.server = nextServer;

  const configDirectory = path.dirname(userConfigPath);
  mkdirSync(configDirectory, { recursive: true });
  writeFileSync(userConfigPath, stringifyToml(nextToml as Record<string, unknown>), "utf8");

  userServerToml = loadUserServerTomlConfig();
  serverToml = loadServerTomlConfig();

  return getWindowRestoreSettings();
}

export function getBackupAutoEnabled(): boolean {
  return getBackupSettings().autoEnabled;
}

export function getBackupIntervalHours(): number {
  return getBackupSettings().intervalHours;
}

export function getBackupRetention(): number {
  return getBackupSettings().retentionCount;
}

export function getHistoryRetention(): number {
  return getHistorySettings().retentionCount;
}
