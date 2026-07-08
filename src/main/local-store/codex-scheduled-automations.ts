import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { parse as parseToml } from "smol-toml";
import {
  computeCodexScheduledAutomationNextRunAt,
  listDueCodexScheduledAutomations as selectDueCodexScheduledAutomations,
  normalizeCodexScheduledAutomationRrule,
  reconcileCodexScheduledAutomationRuntimeState,
} from "./codex-scheduled-automation-schedule";
import { getLocalStoreDir } from "./config";
import { getDb } from "./database";
import type {
  CodexScheduledAutomation,
  CodexScheduledAutomationCreateInput,
  CodexScheduledAutomationDeleteResult,
  CodexScheduledAutomationExecutionEnvironment,
  CodexScheduledAutomationKind,
  CodexScheduledAutomationReasoningEffort,
  CodexScheduledAutomationStatus,
  CodexScheduledAutomationUpdateInput,
} from "../../shared/types";

const AUTOMATIONS_DIR_NAME = "automations";
const AUTOMATION_TOML_FILE_NAME = "automation.toml";
const AUTOMATION_STATE_VERSION = 1;
const RUN_JITTER_SALT_FILE_NAME = ".run-jitter-salt";

let runJitterSaltCache: string | null = null;

interface DbCodexScheduledAutomation {
  automation_id: string;
  kind: string;
  status: string;
  target_thread_id: string | null;
  name: string;
  prompt: string | null;
  rrule: string | null;
  model: string | null;
  reasoning_effort: string | null;
  cwds_json: string | null;
  execution_environment: string | null;
  local_environment_config_path: string | null;
  next_run_at: number | null;
  last_run_at: number | null;
  created_at: number;
  updated_at: number;
}

interface CodexScheduledAutomationStoreInput {
  id: string;
  kind: CodexScheduledAutomationKind;
  status: CodexScheduledAutomationStatus;
  targetThreadId?: string | null;
  name: string;
  prompt?: string | null;
  rrule?: string | null;
  model?: string | null;
  reasoningEffort?: CodexScheduledAutomationReasoningEffort | null;
  cwds?: string[];
  executionEnvironment?: CodexScheduledAutomationExecutionEnvironment | null;
  localEnvironmentConfigPath?: string | null;
  nextRunAt?: number | null;
  lastRunAt?: number | null;
  createdAt?: number;
  updatedAt?: number;
}

type TomlRecord = Record<string, unknown>;

function normalizeId(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!isValidAutomationId(normalized)) {
    throw new Error(`${fieldName} is invalid`);
  }
  return normalized;
}

function isValidAutomationId(value: string): boolean {
  if (value.length === 0) return false;
  if (value === "." || value === "..") return false;
  if (value.includes("/") || value.includes("\\")) return false;
  return true;
}

function normalizeRequiredString(value: string | null | undefined, fieldName: string): string {
  const normalized = value?.trim() ?? "";
  if (normalized.length > 0) return normalized;
  throw new Error(`${fieldName} is required`);
}

function normalizeNullableString(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeKind(kind: string): CodexScheduledAutomationKind {
  if (kind === "cron" || kind === "heartbeat") return kind;
  throw new Error(`Unsupported scheduled automation kind: ${String(kind)}`);
}

function normalizeStatus(status: string): CodexScheduledAutomationStatus {
  if (status === "ACTIVE" || status === "PAUSED" || status === "DELETED") return status;
  throw new Error(`Unsupported scheduled automation status: ${String(status)}`);
}

function normalizeReasoningEffort(
  value: string | null | undefined,
): CodexScheduledAutomationReasoningEffort | null {
  if (value === null || value === undefined) return null;
  const normalized = value.trim();
  if (
    normalized === "none"
    || normalized === "minimal"
    || normalized === "low"
    || normalized === "medium"
    || normalized === "high"
    || normalized === "xhigh"
    || normalized === "max"
  ) {
    return normalized;
  }
  return null;
}

function normalizeExecutionEnvironment(
  value: string | null | undefined,
): CodexScheduledAutomationExecutionEnvironment {
  if (value === "local" || value === "worktree") return value;
  return "worktree";
}

function normalizeTimestamp(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? Math.trunc(value) : null;
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const numericValue = Number(trimmed);
  if (Number.isFinite(numericValue)) return Math.trunc(numericValue);
  const timestamp = new Date(trimmed).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function normalizeRrule(value: string | null | undefined): string | null {
  return normalizeCodexScheduledAutomationRrule(value);
}

function normalizeCwds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const cwds: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const cwd = item.trim();
    if (cwd.length === 0 || cwds.includes(cwd)) continue;
    cwds.push(cwd);
  }
  return cwds;
}

function slugifyAutomationName(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

function createAutomationIdFromName(name: string): string {
  const base = slugifyAutomationName(name) || "automation";
  const existingIds = new Set(listAutomationIds());
  if (!existingIds.has(base)) return base;

  for (let suffix = 2; suffix <= 20; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!existingIds.has(candidate)) return candidate;
  }

  return `${base}-${randomUUID().slice(0, 8)}`;
}

function parseCwdsJson(value: string | null): string[] {
  if (!value) return [];
  try {
    return normalizeCwds(JSON.parse(value));
  } catch {
    return [];
  }
}

function getAutomationsDir(): string {
  return path.join(getLocalStoreDir(), AUTOMATIONS_DIR_NAME);
}

function getRunJitterSalt(): string {
  if (runJitterSaltCache) return runJitterSaltCache;

  const saltPath = path.join(getAutomationsDir(), RUN_JITTER_SALT_FILE_NAME);
  try {
    const existing = fs.readFileSync(saltPath, "utf8").trim();
    if (existing.length > 0) {
      runJitterSaltCache = existing;
      return existing;
    }
  } catch {
    // Missing salt is normal on the first scheduled automation run.
  }

  const generated = randomUUID();
  try {
    fs.mkdirSync(path.dirname(saltPath), { recursive: true });
    fs.writeFileSync(saltPath, `${generated}\n`, "utf8");
  } catch {
    // The in-memory salt still provides stable jitter for this process.
  }
  runJitterSaltCache = generated;
  return generated;
}

function getAutomationDir(automationId: string): string {
  return path.join(getAutomationsDir(), automationId);
}

function getAutomationTomlPath(automationId: string): string {
  return path.join(getAutomationDir(automationId), AUTOMATION_TOML_FILE_NAME);
}

function quoteTomlString(value: string): string {
  const encoded = JSON.stringify(value);
  return typeof encoded === "string" ? encoded : "\"\"";
}

function quoteTomlStringArray(values: string[]): string {
  return `[${values.map(quoteTomlString).join(", ")}]`;
}

function automationToToml(automation: CodexScheduledAutomation): string {
  const lines = [
    `version = ${AUTOMATION_STATE_VERSION}`,
    `id = ${quoteTomlString(automation.id)}`,
    `kind = ${quoteTomlString(automation.kind)}`,
    `name = ${quoteTomlString(automation.name)}`,
    `prompt = ${quoteTomlString(automation.prompt)}`,
    `status = ${quoteTomlString(automation.status)}`,
  ];

  lines.push(`rrule = ${quoteTomlString(normalizeRrule(automation.rrule) ?? "")}`);
  if (automation.model) lines.push(`model = ${quoteTomlString(automation.model)}`);
  if (automation.reasoningEffort) {
    lines.push(`reasoning_effort = ${quoteTomlString(automation.reasoningEffort)}`);
  }

  if (automation.kind === "cron") {
    if (automation.cwds.length === 0) {
      throw new Error("Cron scheduled automation cwd list is required");
    }
    lines.push(`execution_environment = ${quoteTomlString(automation.executionEnvironment)}`);
    if (automation.localEnvironmentConfigPath) {
      lines.push(`local_environment_config_path = ${quoteTomlString(automation.localEnvironmentConfigPath)}`);
    }
    lines.push(`cwds = ${quoteTomlStringArray(automation.cwds)}`);
  } else {
    if (!automation.targetThreadId) {
      throw new Error("Heartbeat scheduled automation target thread id is required");
    }
    lines.push(`target_thread_id = ${quoteTomlString(automation.targetThreadId)}`);
  }

  lines.push(`created_at = ${automation.createdAt}`);
  lines.push(`updated_at = ${automation.updatedAt}`);

  return `${lines.join("\n")}\n`;
}

function parseTomlString(record: TomlRecord, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function parseTomlStringArray(record: TomlRecord, key: string): string[] {
  return normalizeCwds(record[key]);
}

function parseTomlAutomation(record: TomlRecord, expectedId: string): CodexScheduledAutomation {
  const version = typeof record.version === "number" ? record.version : Number(record.version);
  if (version !== AUTOMATION_STATE_VERSION) {
    throw new Error(`Unsupported scheduled automation state version: ${String(record.version)}`);
  }

  const id = normalizeId(parseTomlString(record, "id") ?? expectedId, "Scheduled automation id");
  if (id !== expectedId) {
    throw new Error(`Scheduled automation id ${id} does not match directory ${expectedId}`);
  }

  const kind = normalizeKind(parseTomlString(record, "kind") ?? "");
  const status = normalizeStatus(parseTomlString(record, "status") ?? "ACTIVE");
  const targetThreadId = normalizeNullableString(parseTomlString(record, "target_thread_id"));
  const cwds = parseTomlStringArray(record, "cwds");
  const createdAt = normalizeTimestamp(record.created_at) ?? Date.now();
  const updatedAt = normalizeTimestamp(record.updated_at) ?? createdAt;

  if (kind === "cron" && cwds.length === 0) {
    throw new Error("Cron scheduled automation cwd list is required");
  }
  if (kind === "heartbeat" && !targetThreadId) {
    throw new Error("Heartbeat scheduled automation target thread id is required");
  }

  return {
    id,
    kind,
    status,
    targetThreadId: kind === "heartbeat" ? targetThreadId : null,
    name: normalizeRequiredString(parseTomlString(record, "name"), "Scheduled automation name"),
    prompt: normalizeNullableString(parseTomlString(record, "prompt")) ?? "",
    rrule: normalizeRrule(parseTomlString(record, "rrule")),
    model: normalizeNullableString(parseTomlString(record, "model")),
    reasoningEffort: normalizeReasoningEffort(parseTomlString(record, "reasoning_effort")),
    cwds: kind === "cron" ? cwds : [],
    executionEnvironment: normalizeExecutionEnvironment(parseTomlString(record, "execution_environment")),
    localEnvironmentConfigPath: normalizeNullableString(parseTomlString(record, "local_environment_config_path")),
    nextRunAt: null,
    lastRunAt: null,
    createdAt,
    updatedAt,
  };
}

function readAutomationToml(automationId: string): CodexScheduledAutomation | null {
  const normalizedId = normalizeId(automationId, "Scheduled automation id");
  const filePath = getAutomationTomlPath(normalizedId);
  if (!fs.existsSync(filePath)) return null;

  try {
    const record = parseToml(fs.readFileSync(filePath, "utf8")) as TomlRecord;
    return parseTomlAutomation(record, normalizedId);
  } catch {
    return null;
  }
}

function writeAutomationToml(automation: CodexScheduledAutomation): void {
  const automationDir = getAutomationDir(automation.id);
  fs.mkdirSync(automationDir, { recursive: true });

  const filePath = getAutomationTomlPath(automation.id);
  const tempFilePath = path.join(automationDir, `.${AUTOMATION_TOML_FILE_NAME}.${randomUUID()}.tmp`);
  fs.writeFileSync(tempFilePath, automationToToml(automation), "utf8");
  try {
    fs.renameSync(tempFilePath, filePath);
  } catch (error) {
    try {
      fs.rmSync(filePath, { force: true });
      fs.renameSync(tempFilePath, filePath);
    } catch {
      fs.rmSync(tempFilePath, { force: true });
      throw error;
    }
  }
}

function rowToAutomation(row: DbCodexScheduledAutomation): CodexScheduledAutomation {
  const kind = normalizeKind(row.kind);
  return {
    id: row.automation_id,
    kind,
    status: normalizeStatus(row.status),
    targetThreadId: kind === "heartbeat" ? row.target_thread_id : null,
    name: row.name,
    prompt: row.prompt ?? "",
    rrule: normalizeRrule(row.rrule),
    model: normalizeNullableString(row.model),
    reasoningEffort: normalizeReasoningEffort(row.reasoning_effort),
    cwds: kind === "cron" ? parseCwdsJson(row.cwds_json) : [],
    executionEnvironment: normalizeExecutionEnvironment(row.execution_environment),
    localEnvironmentConfigPath: normalizeNullableString(row.local_environment_config_path),
    nextRunAt: normalizeTimestamp(row.next_run_at),
    lastRunAt: normalizeTimestamp(row.last_run_at),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function listMirrorRows(): CodexScheduledAutomation[] {
  const rows = getDb().prepare(`
    SELECT
      automation_id,
      kind,
      status,
      target_thread_id,
      name,
      prompt,
      rrule,
      model,
      reasoning_effort,
      cwds_json,
      execution_environment,
      local_environment_config_path,
      next_run_at,
      last_run_at,
      created_at,
      updated_at
    FROM codex_scheduled_automations
  `).all() as DbCodexScheduledAutomation[];

  return rows.map(rowToAutomation);
}

function mirrorAutomation(automation: CodexScheduledAutomation): void {
  getDb().prepare(`
    INSERT INTO codex_scheduled_automations (
      automation_id,
      kind,
      status,
      target_thread_id,
      name,
      prompt,
      rrule,
      model,
      reasoning_effort,
      cwds_json,
      execution_environment,
      local_environment_config_path,
      next_run_at,
      last_run_at,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(automation_id) DO UPDATE SET
      kind = excluded.kind,
      status = excluded.status,
      target_thread_id = excluded.target_thread_id,
      name = excluded.name,
      prompt = excluded.prompt,
      rrule = excluded.rrule,
      model = excluded.model,
      reasoning_effort = excluded.reasoning_effort,
      cwds_json = excluded.cwds_json,
      execution_environment = excluded.execution_environment,
      local_environment_config_path = excluded.local_environment_config_path,
      next_run_at = excluded.next_run_at,
      last_run_at = excluded.last_run_at,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at
  `).run(
    automation.id,
    automation.kind,
    automation.status,
    automation.targetThreadId,
    automation.name,
    automation.prompt,
    automation.rrule,
    automation.model,
    automation.reasoningEffort,
    JSON.stringify(automation.cwds),
    automation.executionEnvironment,
    automation.localEnvironmentConfigPath,
    automation.nextRunAt,
    automation.lastRunAt,
    automation.createdAt,
    automation.updatedAt,
  );
}

function replaceMirror(automations: readonly CodexScheduledAutomation[]): void {
  const db = getDb();
  const transaction = db.transaction((items: readonly CodexScheduledAutomation[]) => {
    db.prepare("DELETE FROM codex_scheduled_automations").run();
    for (const automation of items) {
      mirrorAutomation(automation);
    }
  });
  transaction(automations);
}

function deleteMirrorAutomation(automationId: string): void {
  getDb().prepare(`
    DELETE FROM codex_scheduled_automations
    WHERE automation_id = ?
  `).run(automationId);
}

function listAutomationTomls(): CodexScheduledAutomation[] {
  const automationsDir = getAutomationsDir();
  if (!fs.existsSync(automationsDir)) return [];

  const entries = fs.readdirSync(automationsDir, { withFileTypes: true });
  const automations: CodexScheduledAutomation[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !isValidAutomationId(entry.name)) continue;
    const automation = readAutomationToml(entry.name);
    if (automation) automations.push(automation);
  }
  return automations;
}

function listAutomationIds(): string[] {
  const automationsDir = getAutomationsDir();
  try {
    return fs.readdirSync(automationsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && isValidAutomationId(entry.name))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

function reconcileRuntimeState(
  automation: CodexScheduledAutomation,
  mirrorRows: readonly CodexScheduledAutomation[],
  now = Date.now(),
): CodexScheduledAutomation {
  const mirror = mirrorRows.find((row) => row.id === automation.id);
  return reconcileCodexScheduledAutomationRuntimeState({
    automation,
    mirror: mirror ?? null,
    now,
    jitterSalt: getRunJitterSalt(),
  });
}

function migrateMirrorRowsToToml(): void {
  const mirrorRows = listMirrorRows();
  if (mirrorRows.length === 0) return;

  for (const row of mirrorRows) {
    if (!isValidAutomationId(row.id)) continue;
    if (fs.existsSync(getAutomationTomlPath(row.id))) continue;
    if (row.status === "DELETED") continue;
    if (row.kind === "heartbeat" && !row.targetThreadId) continue;
    if (row.kind === "cron" && row.cwds.length === 0) continue;
    writeAutomationToml(row);
  }
}

function listActiveTomlAutomations(now = Date.now()): CodexScheduledAutomation[] {
  migrateMirrorRowsToToml();
  const mirrorRows = listMirrorRows();
  const automations = listAutomationTomls()
    .map((automation) => reconcileRuntimeState(automation, mirrorRows, now))
    .filter((automation) => automation.status !== "DELETED")
    .sort((left, right) => {
      if (left.updatedAt !== right.updatedAt) return right.updatedAt - left.updatedAt;
      return left.id.localeCompare(right.id);
    });
  replaceMirror(automations);
  return automations;
}

function findExistingAutomationAt(automationId: string, now: number): CodexScheduledAutomation | null {
  migrateMirrorRowsToToml();
  const automation = readAutomationToml(automationId);
  if (!automation || automation.status === "DELETED") return null;
  return reconcileRuntimeState(automation, listMirrorRows(), now);
}

function findExistingAutomation(automationId: string): CodexScheduledAutomation | null {
  return findExistingAutomationAt(automationId, Date.now());
}

function normalizeAutomationInput(
  input: CodexScheduledAutomationStoreInput,
  existing: CodexScheduledAutomation | null,
): CodexScheduledAutomation {
  const now = Date.now();
  const id = normalizeId(input.id, "Scheduled automation id");
  const kind = normalizeKind(input.kind);
  const status = normalizeStatus(input.status);
  const targetThreadId = input.targetThreadId === undefined
    ? existing?.targetThreadId ?? null
    : normalizeNullableString(input.targetThreadId);
  const createdAt = existing?.createdAt ?? normalizeTimestamp(input.createdAt) ?? now;
  const updatedAt = normalizeTimestamp(input.updatedAt) ?? now;
  const cwds = input.cwds === undefined ? existing?.cwds ?? [] : normalizeCwds(input.cwds);
  const executionEnvironment = normalizeExecutionEnvironment(
    input.executionEnvironment ?? existing?.executionEnvironment,
  );
  const localEnvironmentConfigPath = input.localEnvironmentConfigPath === undefined
    ? existing?.localEnvironmentConfigPath ?? null
    : normalizeNullableString(input.localEnvironmentConfigPath);

  if (kind === "heartbeat" && !targetThreadId) {
    throw new Error("Heartbeat scheduled automation target thread id is required");
  }
  if (kind === "cron" && cwds.length === 0) {
    throw new Error("Cron scheduled automation cwd list is required");
  }

  return {
    id,
    kind,
    status,
    targetThreadId: kind === "heartbeat" ? targetThreadId : null,
    name: normalizeRequiredString(input.name, "Scheduled automation name"),
    prompt: input.prompt === undefined ? existing?.prompt ?? "" : normalizeNullableString(input.prompt) ?? "",
    rrule: input.rrule === undefined ? existing?.rrule ?? normalizeRrule(null) : normalizeRrule(input.rrule),
    model: input.model === undefined ? existing?.model ?? null : normalizeNullableString(input.model),
    reasoningEffort: input.reasoningEffort === undefined
      ? existing?.reasoningEffort ?? null
      : normalizeReasoningEffort(input.reasoningEffort),
    cwds: kind === "cron" ? cwds : [],
    executionEnvironment,
    localEnvironmentConfigPath: kind === "cron" ? localEnvironmentConfigPath : null,
    nextRunAt: input.nextRunAt === undefined
      ? existing?.nextRunAt ?? null
      : normalizeTimestamp(input.nextRunAt),
    lastRunAt: input.lastRunAt === undefined
      ? existing?.lastRunAt ?? null
      : normalizeTimestamp(input.lastRunAt),
    createdAt,
    updatedAt,
  };
}

function assertNoDuplicateActiveHeartbeat(automation: CodexScheduledAutomation): void {
  if (automation.kind !== "heartbeat") return;
  if (automation.status !== "ACTIVE") return;
  if (!automation.targetThreadId) return;

  const duplicate = listAutomationTomls().some((existing) => (
    existing.id !== automation.id
    && existing.kind === "heartbeat"
    && existing.status === "ACTIVE"
    && existing.targetThreadId === automation.targetThreadId
  ));
  if (duplicate) {
    throw new Error("That thread already has an active heartbeat.");
  }
}

export function listCodexScheduledAutomations(): CodexScheduledAutomation[] {
  return listActiveTomlAutomations();
}

export function getCodexScheduledAutomation(automationId: string): CodexScheduledAutomation | null {
  const normalizedId = normalizeId(automationId, "Scheduled automation id");
  const automation = findExistingAutomation(normalizedId);
  if (!automation) return null;
  mirrorAutomation(automation);
  return automation;
}

export function upsertCodexScheduledAutomation(
  input: CodexScheduledAutomationStoreInput,
): CodexScheduledAutomation {
  const automationId = normalizeId(input.id, "Scheduled automation id");
  const existing = findExistingAutomation(automationId);
  return persistCodexScheduledAutomationInput(input, existing);
}

export function createCodexScheduledAutomation(
  input: CodexScheduledAutomationCreateInput,
): CodexScheduledAutomation {
  const name = normalizeRequiredString(input.name, "Scheduled automation name");
  const now = Date.now();
  return persistCodexScheduledAutomationInput({
    ...input,
    id: createAutomationIdFromName(name),
    name,
    status: "ACTIVE",
    createdAt: now,
    updatedAt: now,
  }, null);
}

export function updateCodexScheduledAutomation(
  input: CodexScheduledAutomationUpdateInput,
): CodexScheduledAutomation | null {
  const automationId = normalizeId(input.id, "Scheduled automation id");
  const existing = findExistingAutomation(automationId);
  if (!existing) return null;
  return persistCodexScheduledAutomationInput(input, existing);
}

function persistCodexScheduledAutomationInput(
  input: CodexScheduledAutomationStoreInput,
  existing: CodexScheduledAutomation | null,
): CodexScheduledAutomation {
  const automation = normalizeAutomationInput(input, existing);
  assertNoDuplicateActiveHeartbeat(automation);
  const reconciled = reconcileCodexScheduledAutomationRuntimeState({
    automation,
    mirror: existing,
    now: Date.now(),
    jitterSalt: getRunJitterSalt(),
  });
  writeAutomationToml(reconciled);
  mirrorAutomation(reconciled);
  return reconciled;
}

export function deleteCodexScheduledAutomationWithStatus(
  automationId: string,
): CodexScheduledAutomationDeleteResult {
  let normalizedId: string;
  try {
    normalizedId = normalizeId(automationId, "Scheduled automation id");
  } catch {
    return { status: "invalid_id" };
  }

  const automationDir = getAutomationDir(normalizedId);
  const fileExists = fs.existsSync(getAutomationTomlPath(normalizedId));
  const mirrorExists = getDb().prepare(`
    SELECT 1
    FROM codex_scheduled_automations
    WHERE automation_id = ?
  `).get(normalizedId) !== undefined;

  if (!fileExists && !mirrorExists) return { status: "not_found" };

  try {
    deleteMirrorAutomation(normalizedId);
  } catch {
    return { status: "state_cleanup_failed" };
  }

  try {
    fs.rmSync(automationDir, { recursive: true, force: true });
  } catch {
    return { status: "remove_failed" };
  }

  return { status: "deleted" };
}

export function deleteCodexScheduledAutomation(automationId: string): boolean {
  return deleteCodexScheduledAutomationWithStatus(automationId).status === "deleted";
}

export function deleteActiveHeartbeatAutomationForTargetThread(
  threadId: string,
): CodexScheduledAutomation | null {
  const targetThreadId = threadId.trim();
  if (!targetThreadId) return null;

  const automation = listAutomationTomls().find((candidate) => (
    candidate.kind === "heartbeat"
    && candidate.status === "ACTIVE"
    && candidate.targetThreadId === targetThreadId
  )) ?? null;
  if (!automation) return null;

  return deleteCodexScheduledAutomationWithStatus(automation.id).status === "deleted"
    ? automation
    : null;
}

export function reconcileCodexScheduledAutomations(now = Date.now()): number {
  migrateMirrorRowsToToml();
  const mirrorRows = listMirrorRows();
  const previousNextRunById = new Map(
    mirrorRows.map((automation) => [automation.id, automation.nextRunAt] as const),
  );
  const automations = listAutomationTomls()
    .map((automation) => reconcileRuntimeState(automation, mirrorRows, now))
    .filter((automation) => automation.status !== "DELETED");
  replaceMirror(automations);
  return automations.filter((automation) => (
    (previousNextRunById.get(automation.id) ?? null) !== automation.nextRunAt
  )).length;
}

export function listDueCodexScheduledAutomationRuns(
  now = Date.now(),
  limit = 10,
): CodexScheduledAutomation[] {
  return selectDueCodexScheduledAutomations(listActiveTomlAutomations(now), now, limit);
}

export function recordCodexScheduledAutomationRunDispatched(
  automationId: string,
  now = Date.now(),
): CodexScheduledAutomation | null {
  const normalizedId = normalizeId(automationId, "Scheduled automation id");
  const automation = findExistingAutomationAt(normalizedId, now);
  if (!automation) return null;

  const nextRunAt = automation.status === "ACTIVE"
    ? computeCodexScheduledAutomationNextRunAt({
      automation: {
        id: automation.id,
        kind: automation.kind,
        rrule: automation.rrule,
      },
      now,
      jitterSalt: getRunJitterSalt(),
    })
    : automation.nextRunAt;
  const updated = {
    ...automation,
    nextRunAt,
    lastRunAt: now,
  };
  mirrorAutomation(updated);
  return updated;
}

export function recordCodexScheduledAutomationNextScheduledRun(
  automationId: string,
  now = Date.now(),
): CodexScheduledAutomation | null {
  const normalizedId = normalizeId(automationId, "Scheduled automation id");
  const automation = findExistingAutomationAt(normalizedId, now);
  if (!automation) return null;

  const nextRunAt = automation.status === "ACTIVE"
    ? computeCodexScheduledAutomationNextRunAt({
      automation: {
        id: automation.id,
        kind: automation.kind,
        rrule: automation.rrule,
      },
      now,
      jitterSalt: getRunJitterSalt(),
    })
    : automation.nextRunAt;
  const updated = {
    ...automation,
    nextRunAt,
  };
  mirrorAutomation(updated);
  return updated;
}

export function recordCodexScheduledAutomationNextRun(
  automationId: string,
  nextRunAt: number | null,
  now = Date.now(),
): CodexScheduledAutomation | null {
  const normalizedId = normalizeId(automationId, "Scheduled automation id");
  const automation = findExistingAutomationAt(normalizedId, now);
  if (!automation) return null;

  const updated = {
    ...automation,
    nextRunAt: automation.status === "ACTIVE" ? nextRunAt : automation.nextRunAt,
  };
  mirrorAutomation(updated);
  return updated;
}
