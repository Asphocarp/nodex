#!/usr/bin/env node

import { spawn } from "child_process";
import { createConnection } from "net";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";
import { randomBytes, randomUUID } from "crypto";
import TOML from "smol-toml";
import { v7 as uuidV7 } from "uuid";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── Constants ───

const STATUSES = [
  { id: "draft", name: "Draft" },
  { id: "backlog", name: "Backlog" },
  { id: "in_progress", name: "In Progress" },
  { id: "in_review", name: "In Review" },
  { id: "done", name: "Done" },
];

const PRIORITIES = new Set([
  "p0-critical",
  "p1-high",
  "p2-medium",
  "p3-low",
  "p4-later",
]);

const ESTIMATES = new Set(["xs", "s", "m", "l", "xl"]);
const DEFAULT_LS_DESCRIPTION_CHARS = 240;

const COMMANDS = new Set([
  "serve", "ls", "get", "add", "update", "rm", "mv", "block", "database",
  "history", "query", "schema", "backups", "help", "projects", "config",
]);

const SUBCOMMAND_ALIASES = new Map([
  ["list", "ls"],
  ["show", "get"],
  ["create", "add"],
  ["remove", "rm"],
  ["delete", "rm"],
  ["move", "mv"],
  ["hist", "history"],
]);

// ─── Config Resolution (TOML) ───

function loadTomlFile(path) {
  try {
    return TOML.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

const DEFAULT_CONFIG_TOML = `# Nodex configuration
url = "http://localhost:51283"
# session_id = "my-agent"
# project = "default"

# [server]
# dir = "~/.nodex"
# port = 51283
# backup_auto_enabled = false
# backup_interval_hours = 6
# backup_retention = 28
# history_retention = 1000
`;

function applyTomlConfig(cfg, parsed) {
  if (parsed.url) cfg.url = parsed.url;
  if (parsed.session_id) cfg.sessionId = parsed.session_id;
  if (parsed.project) cfg.project = parsed.project;
}

function expandTilde(p) {
  if (p === "~" || p.startsWith("~/")) return join(homedir(), p.slice(1));
  return p;
}

function loadServerConfig() {
  const server = { dir: undefined, port: undefined, backup_auto_enabled: undefined, backup_interval_hours: undefined, backup_retention: undefined, history_retention: undefined };

  // User-level
  const homeConfig = join(homedir(), ".nodex", "config.toml");
  if (existsSync(homeConfig)) {
    const parsed = loadTomlFile(homeConfig);
    if (parsed?.server) applyServerToml(server, parsed.server);
  }

  // Project-level (CWD walk-up) overrides user-level
  const projectConfig = findProjectConfig();
  if (projectConfig) {
    const parsed = loadTomlFile(projectConfig);
    if (parsed?.server) applyServerToml(server, parsed.server);
  }

  // Env vars override TOML
  if (process.env.NODEX_DIR) server.dir = process.env.NODEX_DIR;
  if (process.env.NODEX_PORT) server.port = parseInt(process.env.NODEX_PORT, 10);
  if (process.env.NODEX_BACKUP_AUTO_ENABLED !== undefined) server.backup_auto_enabled = parseBooleanEnvCli(process.env.NODEX_BACKUP_AUTO_ENABLED);
  if (process.env.NODEX_BACKUP_INTERVAL_HOURS) server.backup_interval_hours = parseInt(process.env.NODEX_BACKUP_INTERVAL_HOURS, 10);
  if (process.env.NODEX_BACKUP_RETENTION) server.backup_retention = parseInt(process.env.NODEX_BACKUP_RETENTION, 10);
  if (process.env.NODEX_HISTORY_RETENTION) server.history_retention = parseInt(process.env.NODEX_HISTORY_RETENTION, 10);

  return server;
}

function applyServerToml(server, s) {
  if (s.dir !== undefined) server.dir = s.dir;
  if (s.port !== undefined) server.port = s.port;
  if (s.backup_auto_enabled !== undefined) server.backup_auto_enabled = s.backup_auto_enabled;
  if (s.backup_interval_hours !== undefined) server.backup_interval_hours = s.backup_interval_hours;
  if (s.backup_retention !== undefined) server.backup_retention = s.backup_retention;
  if (s.history_retention !== undefined) server.history_retention = s.history_retention;
}

function parseBooleanEnvCli(value) {
  if (value === undefined) return undefined;
  const n = value.trim().toLowerCase();
  if (n === "1" || n === "true" || n === "yes" || n === "on") return true;
  if (n === "0" || n === "false" || n === "no" || n === "off") return false;
  return undefined;
}

function ensureUserConfig() {
  const configDir = join(homedir(), ".nodex");
  const configPath = join(configDir, "config.toml");
  if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
  if (!existsSync(configPath)) writeFileSync(configPath, DEFAULT_CONFIG_TOML, "utf8");
  return configPath;
}

function findProjectConfig() {
  let dir = process.cwd();
  while (true) {
    const candidate = join(dir, ".nodex", "config.toml");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function loadConfig(cliFlags) {
  const cfg = { url: "http://localhost:51283", sessionId: undefined, project: "default" };

  const homeConfig = join(homedir(), ".nodex", "config.toml");
  const projectConfig = findProjectConfig();

  if (!existsSync(homeConfig) && !projectConfig) ensureUserConfig();

  if (existsSync(homeConfig)) {
    const parsed = loadTomlFile(homeConfig);
    if (parsed) applyTomlConfig(cfg, parsed);
  }

  if (projectConfig) {
    const parsed = loadTomlFile(projectConfig);
    if (parsed) applyTomlConfig(cfg, parsed);
  }

  if (process.env.NODEX_URL) cfg.url = process.env.NODEX_URL;
  if (process.env.NODEX_SESSION_ID) cfg.sessionId = process.env.NODEX_SESSION_ID;
  if (process.env.NODEX_PROJECT) cfg.project = process.env.NODEX_PROJECT;

  if (cliFlags.url) cfg.url = cliFlags.url;
  if (cliFlags.sessionId) cfg.sessionId = cliFlags.sessionId;
  if (cliFlags.project) cfg.project = cliFlags.project;

  return cfg;
}

function loadConfigWithSources() {
  const fields = {
    url: { value: "http://localhost:51283", source: "default" },
    sessionId: { value: undefined, source: "default" },
    project: { value: "default", source: "default" },
    "server.dir": { value: "~/.nodex", source: "default" },
    "server.port": { value: 51283, source: "default" },
    "server.backup_auto_enabled": { value: false, source: "default" },
    "server.backup_interval_hours": { value: 6, source: "default" },
    "server.backup_retention": { value: 28, source: "default" },
    "server.history_retention": { value: 1000, source: "default" },
  };

  const homeConfigPath = join(homedir(), ".nodex", "config.toml");
  const projectConfigPath = findProjectConfig();

  if (existsSync(homeConfigPath)) {
    const parsed = loadTomlFile(homeConfigPath);
    if (parsed) {
      if (parsed.url) fields.url = { value: parsed.url, source: homeConfigPath };
      if (parsed.session_id) fields.sessionId = { value: parsed.session_id, source: homeConfigPath };
      if (parsed.project) fields.project = { value: parsed.project, source: homeConfigPath };
      applyServerTomlSources(fields, parsed.server, homeConfigPath);
    }
  }

  if (projectConfigPath) {
    const parsed = loadTomlFile(projectConfigPath);
    if (parsed) {
      if (parsed.url) fields.url = { value: parsed.url, source: projectConfigPath };
      if (parsed.session_id) fields.sessionId = { value: parsed.session_id, source: projectConfigPath };
      if (parsed.project) fields.project = { value: parsed.project, source: projectConfigPath };
      applyServerTomlSources(fields, parsed.server, projectConfigPath);
    }
  }

  if (process.env.NODEX_URL) fields.url = { value: process.env.NODEX_URL, source: "env NODEX_URL" };
  if (process.env.NODEX_SESSION_ID) fields.sessionId = { value: process.env.NODEX_SESSION_ID, source: "env NODEX_SESSION_ID" };
  if (process.env.NODEX_PROJECT) fields.project = { value: process.env.NODEX_PROJECT, source: "env NODEX_PROJECT" };

  if (process.env.NODEX_DIR) fields["server.dir"] = { value: process.env.NODEX_DIR, source: "env NODEX_DIR" };
  if (process.env.NODEX_PORT) fields["server.port"] = { value: parseInt(process.env.NODEX_PORT, 10), source: "env NODEX_PORT" };
  if (process.env.NODEX_BACKUP_AUTO_ENABLED !== undefined) fields["server.backup_auto_enabled"] = { value: parseBooleanEnvCli(process.env.NODEX_BACKUP_AUTO_ENABLED), source: "env NODEX_BACKUP_AUTO_ENABLED" };
  if (process.env.NODEX_BACKUP_INTERVAL_HOURS) fields["server.backup_interval_hours"] = { value: parseInt(process.env.NODEX_BACKUP_INTERVAL_HOURS, 10), source: "env NODEX_BACKUP_INTERVAL_HOURS" };
  if (process.env.NODEX_BACKUP_RETENTION) fields["server.backup_retention"] = { value: parseInt(process.env.NODEX_BACKUP_RETENTION, 10), source: "env NODEX_BACKUP_RETENTION" };
  if (process.env.NODEX_HISTORY_RETENTION) fields["server.history_retention"] = { value: parseInt(process.env.NODEX_HISTORY_RETENTION, 10), source: "env NODEX_HISTORY_RETENTION" };

  return { fields, homeConfigPath, projectConfigPath };
}

function applyServerTomlSources(fields, server, source) {
  if (!server) return;
  if (server.dir !== undefined) fields["server.dir"] = { value: server.dir, source };
  if (server.port !== undefined) fields["server.port"] = { value: server.port, source };
  if (server.backup_auto_enabled !== undefined) fields["server.backup_auto_enabled"] = { value: server.backup_auto_enabled, source };
  if (server.backup_interval_hours !== undefined) fields["server.backup_interval_hours"] = { value: server.backup_interval_hours, source };
  if (server.backup_retention !== undefined) fields["server.backup_retention"] = { value: server.backup_retention, source };
  if (server.history_retention !== undefined) fields["server.history_retention"] = { value: server.history_retention, source };
}

function formatSource(source) {
  if (source === "default" || source.startsWith("env ")) return source;
  const home = homedir();
  if (source.startsWith(home)) return "~" + source.slice(home.length);
  return source;
}

// ─── CSV Formatting ───

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function csvRow(values) {
  return values.map(csvEscape).join(",");
}

function csvTable(headers, rows) {
  const lines = [csvRow(headers)];
  for (const row of rows) {
    lines.push(csvRow(headers.map(h => row[h])));
  }
  return lines.join("\n");
}

function csvKeyValue(obj) {
  const lines = ["field,value"];
  for (const [key, val] of Object.entries(obj)) {
    lines.push(csvRow([key, val]));
  }
  return lines.join("\n");
}

function jsonOut(obj, flags) {
  console.log(JSON.stringify(obj, null, flags.pretty ? 2 : undefined));
}

function jsonlOut(values) {
  if (values.length === 0) return;
  console.log(values.map((value) => JSON.stringify(value)).join("\n"));
}

function tableCell(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\n/g, " \\n ");
}

function tableOut(headers, rows) {
  const widths = headers.map((header) => {
    const rowWidth = rows.reduce((max, row) => {
      return Math.max(max, tableCell(row[header]).length);
    }, 0);
    return Math.max(header.length, rowWidth);
  });

  const formatRow = (values) => {
    return values
      .map((value, idx) => String(value).padEnd(widths[idx]))
      .join(" | ");
  };

  const lines = [
    formatRow(headers),
    widths.map((width) => "-".repeat(width)).join("-|-"),
  ];

  for (const row of rows) {
    lines.push(formatRow(headers.map((header) => tableCell(row[header]))));
  }

  return lines.join("\n");
}

function getOutputFormat(flags) {
  if (flags.json) return "json";
  if (flags.table) return "table";
  if (flags.csv) return "csv";
  return "jsonl";
}

function rowsOut(headers, rows, flags) {
  const outputFormat = getOutputFormat(flags);
  if (outputFormat === "json") {
    jsonOut(rows, flags);
    return;
  }
  if (outputFormat === "table") {
    console.log(tableOut(headers, rows));
    return;
  }
  if (outputFormat === "jsonl") {
    jsonlOut(rows);
    return;
  }
  console.log(csvTable(headers, rows));
}

function keyValueOut(obj, flags) {
  const outputFormat = getOutputFormat(flags);
  if (outputFormat === "json") {
    jsonOut(obj, flags);
    return;
  }
  if (outputFormat === "table") {
    const rows = Object.entries(obj).map(([field, value]) => ({ field, value }));
    console.log(tableOut(["field", "value"], rows));
    return;
  }
  if (outputFormat === "jsonl") {
    jsonlOut([obj]);
    return;
  }
  console.log(csvKeyValue(obj));
}

// ─── File/Stdin Input ───

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function resolveValue(val) {
  if (!val || typeof val !== "string" || !val.startsWith("@")) return val;
  const target = val.slice(1);
  if (target === "-") return readStdin();
  return readFileSync(resolve(process.cwd(), target), "utf8");
}

// ─── HTTP Helpers ───

let BASE_URL = "";

async function apiFetch(path, options = {}) {
  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`, options);
  } catch {
    throw new Error(`Cannot connect to ${BASE_URL}. Is the Nodex server running?`);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message = typeof body.error === "string"
      ? body.error
      : typeof body.error?.message === "string"
        ? body.error.message
        : `HTTP ${res.status}`;
    throw new Error(message);
  }
  return res.json();
}

function apiGet(path) {
  return apiFetch(path);
}

function apiPost(path, body) {
  return apiFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function apiPut(path, body) {
  return apiFetch(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function apiDelete(path) {
  return apiFetch(path, { method: "DELETE" });
}

async function readPageDetail(config, pageId) {
  const result = await apiGet(
    `${apiPrefix(config)}/pages/${encodeURIComponent(pageId)}`,
  );
  if (
    result?.ok !== true ||
    result.value?.projectId !== config.project ||
    result.value?.page?.pageId !== pageId ||
    typeof result.value?.storeEpoch !== "string" ||
    !result.value?.dataSourceContext
  ) {
    throw new Error(
      result?.error?.message || "Server returned an invalid Page Detail",
    );
  }
  return result.value;
}

function normalizeCliMetadataValue(field, value) {
  if (field === "dueDate") {
    if (value === null) return null;
    if (value instanceof Date && Number.isFinite(value.getTime())) {
      return value.toISOString().slice(0, 10);
    }
    if (typeof value === "string") return value.slice(0, 10);
    throw new Error("Page dueDate must be a date or null");
  }
  if (field === "assignee") return typeof value === "string" ? value.trim() || null : value;
  return value;
}

const CLI_DATABASE_FIELDS = {
  status: "status",
  priority: "priority",
  estimate: "estimate",
  tags: "tags",
  dueDate: "due_date",
  scheduledStart: "scheduled_start",
  scheduledEnd: "scheduled_end",
  assignee: "assignee",
};

function compileCliPageMetadataOperations(detail, patch) {
  const context = detail.dataSourceContext;
  if (context.kind !== "member") {
    throw new Error("Page metadata requires an active Data Source parent");
  }
  const properties = new Map(
    context.properties.map((property) => [property.propertyId, property]),
  );
  const operations = [];
  for (const [field, rawValue] of Object.entries(patch)) {
    const propertyKey = CLI_DATABASE_FIELDS[field];
    if (!propertyKey) throw new Error(`Page metadata field is not writable: ${field}`);
    const property = properties.get(propertyKey);
    if (!property) throw new Error(`Page Data Source is missing ${propertyKey}`);
    let value = normalizeCliMetadataValue(field, rawValue);
    if (field === "tags") {
      value = [...new Set(rawValue)].sort();
    }
    const current = context.values[property.propertyId];
    const currentValue = current?.value ??
      (property.valueType === "multi_select" ? [] : null);
    if (JSON.stringify(value) === JSON.stringify(currentValue)) continue;
    operations.push({
      kind: "set_value",
      pageId: detail.page.pageId,
      dataSourceId: context.dataSource.dataSourceId,
      propertyId: property.propertyId,
      expectedValueRevision: current?.revision ?? 0,
      value,
    });
  }
  return operations;
}

async function mutatePageMetadata(config, pageId, patch, mutationId) {
  const detail = await readPageDetail(config, pageId);
  const operations = compileCliPageMetadataOperations(detail, patch);
  if (operations.length === 0) return null;
  const request = {
    version: 2,
    operationId: mutationId,
    projectId: config.project,
    storeEpoch: detail.storeEpoch,
    actor: { kind: "nodex_cli" },
    operations,
  };
  const send = async () =>
    apiPost(`${apiPrefix(config)}/database-module/apply`, request);
  let result;
  try {
    result = await send();
  } catch {
    result = await send();
  }
  if (result?.ok !== true) {
    throw new Error(result?.error?.message || "Page metadata mutation failed");
  }
  return result.value;
}

async function movePageInDefaultDatabase(config, input, operationId) {
  const snapshot = await readDatabaseModuleSnapshot(config, {
    target: { kind: "project_default" },
    mode: "query",
  });
  if (snapshot.value?.kind !== "query") {
    throw new Error("Default Database View is unavailable");
  }
  const query = snapshot.value.value;
  const view = query.view;
  const statusProperty = query.properties.find(
    (property) =>
      property.lifecycle === "active" && property.propertyId === "status",
  );
  const row = query.rows.find((candidate) => candidate.page.pageId === input.pageId);
  if (!statusProperty || !row || view.kind !== "kanban") {
    throw new Error(`Page ${input.pageId} is not in the default Database View`);
  }
  const currentStatus = row.values[statusProperty.propertyId]?.value;
  if (currentStatus !== input.fromStatus) {
    throw new Error(
      `Page ${input.pageId} moved from ${input.fromStatus} to ${String(currentStatus)} before this command`,
    );
  }
  const operations = [];
  if (currentStatus !== input.toStatus) {
    operations.push({
      kind: "set_value",
      pageId: input.pageId,
      dataSourceId: query.dataSource.dataSourceId,
      propertyId: statusProperty.propertyId,
      expectedValueRevision: row.values[statusProperty.propertyId]?.revision ?? 0,
      value: input.toStatus,
    });
  }
  const manual = view.config.sort.some((sort) => sort.field?.kind === "manual");
  if (manual && (currentStatus !== input.toStatus || input.newOrder !== undefined)) {
    const remaining = query.rows.filter(
      (candidate) =>
        candidate.page.pageId !== input.pageId &&
        candidate.effectiveGroupKey === input.toStatus,
    );
    const targetIndex = input.newOrder === undefined
      ? remaining.length
      : Math.min(input.newOrder, remaining.length);
    const beforePageId = remaining[targetIndex]?.page.pageId;
    operations.push({
      kind: "position_page",
      viewId: view.viewId,
      pageId: input.pageId,
      expectedPositionRevision: row.position?.revision ?? 0,
      groupKey: input.toStatus,
      ...(beforePageId ? { beforePageId } : {}),
    });
  }
  if (operations.length === 0) return null;
  return applyDatabaseOperations(config, snapshot, operationId, operations);
}

async function readPageLifecyclePreflight(config, pageId) {
  const result = await apiGet(
    `${apiPrefix(config)}/page-lifecycle-preflight?pageId=${encodeURIComponent(pageId)}`,
  );
  const snapshot = result?.value;
  if (
    result?.ok !== true ||
    snapshot?.version !== 2 ||
    snapshot?.projectId !== config.project ||
    typeof snapshot?.storeEpoch !== "string" ||
    !Number.isSafeInteger(snapshot?.changeLogSeq) ||
    snapshot?.value?.version !== 2 ||
    snapshot?.value?.tagsProperty?.propertyId !== "tags" ||
    snapshot?.value?.tagsProperty?.valueType !== "multi_select" ||
    snapshot?.value?.tagsProperty?.lifecycle !== "active"
  ) {
    throw new Error(
      result?.error?.message ||
        "Server returned an invalid Page lifecycle preflight",
    );
  }
  return snapshot;
}

async function sendPageLifecycleMutation(config, request) {
  const url = `${BASE_URL}${apiPrefix(config)}/page-lifecycle-mutations`;
  const serializedRequest = JSON.stringify(request);
  const send = async () => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: serializedRequest,
    });
    const result = await response.json().catch(() => null);
    if (result && typeof result.ok === "boolean") return result;
    throw new Error(
      typeof result?.error === "string"
        ? result.error
        : `HTTP ${response.status}`,
    );
  };

  let result;
  let retried = false;
  try {
    result = await send();
  } catch {
    retried = true;
    result = await send();
  }
  if (result?.ok !== true && result?.error?.retryable === true && !retried) {
    result = await send();
  }
  if (result?.ok !== true) {
    throw new Error(result?.error?.message || "Page lifecycle mutation failed");
  }
  return result.value;
}

async function readPageOrNull(config, pageId) {
  let response;
  try {
    response = await fetch(
      `${BASE_URL}${apiPrefix(config)}/database-row?pageId=${encodeURIComponent(pageId)}`,
    );
  } catch {
    throw new Error(`Cannot connect to ${BASE_URL}. Is the Nodex server running?`);
  }
  if (response.status === 404) return null;
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      typeof body.error === "string" ? body.error : `HTTP ${response.status}`,
    );
  }
  return response.json();
}

async function readCanonicalPageAfterLifecycle(config, receipt) {
  const expectsDeleted = receipt.lifecycle === "deleted";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const page = await readPageOrNull(config, receipt.pageId);
    const matches = expectsDeleted
      ? page === null
      : page?.id === receipt.pageId &&
        page.archived === (receipt.lifecycle === "archived");
    if (matches) return page;
    if (attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  throw new Error(
    `Canonical Page read did not reach lifecycle ${receipt.lifecycle}`,
  );
}

function pageLifecycleEnvelope(config, snapshot, operationId, operation) {
  const compiledOperation = operation.kind === "create_page"
    ? compileCreatePageOperationV2(snapshot, operation)
    : operation;
  return {
    version: 2,
    operationId,
    projectId: config.project,
    storeEpoch: snapshot.storeEpoch,
    ...(config.sessionId ? { clientSessionId: config.sessionId } : {}),
    actor: { kind: "nodex_cli" },
    operation: compiledOperation,
  };
}

function compileCreatePageOperationV2(snapshot, operation) {
  const property = snapshot.value.tagsProperty;
  const dataSourceId = snapshot.value.defaultView?.dataSource?.dataSourceId;
  if (
    typeof dataSourceId !== "string" ||
    property.dataSourceId !== dataSourceId ||
    !Number.isSafeInteger(property.revision) ||
    property.revision < 1 ||
    !Array.isArray(property.config?.options)
  ) {
    throw new Error("Page lifecycle preflight has an invalid tags Property authority");
  }
  const byName = new Map();
  const unavailable = new Set();
  for (const option of property.config.options) {
    if (
      typeof option?.id !== "string" ||
      !/^o_[A-Za-z0-9_-]{8}$/.test(option.id) ||
      typeof option?.name !== "string"
    ) {
      throw new Error("Page lifecycle preflight has an invalid tag option registry");
    }
    const name = option.name.normalize("NFC").trim();
    if (!name) throw new Error("Page lifecycle preflight has an empty tag option name");
    unavailable.add(option.id);
    const matches = byName.get(name) || [];
    matches.push(option.id);
    byName.set(name, matches);
  }
  const names = [...new Set((operation.tags || []).map((name) => {
    if (typeof name !== "string") throw new Error("Page tag names must be strings");
    const canonical = name.normalize("NFC").trim();
    if (!canonical) throw new Error("Page tag names must not be empty");
    return canonical;
  }))].sort((left, right) => left.localeCompare(right));
  const tagOptionIds = [];
  const newTagOptions = [];
  for (const name of names) {
    const existing = byName.get(name) || [];
    if (existing.length > 1) {
      throw new Error(`Tag name ${JSON.stringify(name)} is ambiguous in the tags Property`);
    }
    if (existing.length === 1) {
      tagOptionIds.push(existing[0]);
      continue;
    }
    let optionId;
    do {
      optionId = `o_${randomBytes(6).toString("base64url")}`;
    } while (unavailable.has(optionId));
    unavailable.add(optionId);
    tagOptionIds.push(optionId);
    newTagOptions.push({ optionId, name });
  }
  const { tags: _displayNames, ...createFields } = operation;
  void _displayNames;
  return {
    ...createFields,
    dataSourceId,
    tagOptionIds: tagOptionIds.sort(),
    newTagOptions: newTagOptions.sort((left, right) =>
      left.optionId.localeCompare(right.optionId)),
    expectedTagsPropertyRevision: property.revision,
  };
}

// ─── Project API prefix ───

function apiPrefix(config) {
  return `/api/projects/${encodeURIComponent(config.project)}`;
}

function requireCanonicalMutationId(value) {
  const mutationId = value ?? randomUUID();
  if (
    typeof mutationId !== "string" ||
    mutationId.length === 0 ||
    mutationId.length > 512 ||
    mutationId !== mutationId.trim()
  ) {
    throw new Error("--mutation-id must be a canonical non-empty identity up to 512 characters");
  }
  return mutationId;
}

function requireCanonicalPageId(value) {
  if (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    value === value.trim()
  ) {
    return value;
  }
  throw new Error(
    "--page-id must be a canonical non-empty identity up to 512 characters",
  );
}

function scopedMutationId(baseMutationId, suffix, hasMultipleMutations) {
  if (!hasMultipleMutations) return baseMutationId;
  const mutationId = `${baseMutationId}:${suffix}`;
  if (mutationId.length <= 512) return mutationId;
  throw new Error("--mutation-id is too long for a multi-part content update");
}

async function preparePageDocument(config, pageId) {
  const descriptor = await apiPost(
    `${apiPrefix(config)}/blocks/${encodeURIComponent(pageId)}/document/prepare`,
    {},
  );
  if (
    descriptor?.projectId !== config.project ||
    descriptor?.ownerBlockId !== pageId ||
    typeof descriptor?.documentId !== "string" ||
    typeof descriptor?.storeEpoch !== "string" ||
    !Number.isSafeInteger(descriptor?.generation) ||
    !Number.isSafeInteger(descriptor?.headSeq)
  ) {
    throw new Error("Server returned an invalid Page Document descriptor");
  }
  return descriptor;
}

async function sendDocumentMutation(config, descriptor, request) {
  const result = await apiPost(
    `${apiPrefix(config)}/documents/${encodeURIComponent(descriptor.documentId)}/mutations`,
    request,
  );
  if (result?.ok !== true || !Number.isSafeInteger(result?.value?.headSeq)) {
    throw new Error(result?.error?.message || "Server returned an invalid Document mutation receipt");
  }
  return result.value;
}

async function sendAdditionalDocumentCommand(config, request) {
  const result = await apiPost(
    `${apiPrefix(config)}/document-commands`,
    request,
  );
  if (result?.ok !== true || typeof result?.value?.operationId !== "string") {
    throw new Error(
      result?.error?.message ||
        "Server returned an invalid Additional Document command receipt",
    );
  }
  return result.value;
}

function documentMutationEnvelope(config, descriptor, input) {
  return {
    version: 1,
    mutationId: input.mutationId,
    projectId: config.project,
    storeEpoch: descriptor.storeEpoch,
    ...(config.sessionId ? { clientSessionId: config.sessionId } : {}),
    actor: { kind: "nodex_cli" },
    documentId: descriptor.documentId,
    generation: descriptor.generation,
    expectedHeadSeq: input.expectedHeadSeq,
  };
}

async function mutatePageContent(config, pageId, input) {
  const descriptor = await preparePageDocument(config, pageId);
  const current = input.skipUnchanged
    ? await apiGet(
        `${apiPrefix(config)}/database-row?pageId=${encodeURIComponent(pageId)}`,
      )
    : null;
  const hasNfm = input.nfm !== undefined &&
    (!current || current.description !== input.nfm);
  const hasTitle = input.title !== undefined &&
    (!current || current.title !== input.title);
  if (!hasNfm && !hasTitle) return { descriptor, receipts: [] };

  const baseMutationId = requireCanonicalMutationId(input.mutationId);
  const hasMultipleMutations = hasNfm && hasTitle;
  let expectedHeadSeq = input.expectedHeadSeq ?? descriptor.headSeq;
  const receipts = [];

  if (hasNfm) {
    const receipt = await sendDocumentMutation(config, descriptor, {
      ...documentMutationEnvelope(config, descriptor, {
        mutationId: scopedMutationId(baseMutationId, "body", hasMultipleMutations),
        expectedHeadSeq,
      }),
      nfm: input.nfm,
    });
    receipts.push(receipt);
    expectedHeadSeq = receipt.headSeq;
  }

  if (hasTitle) {
    const receipt = await sendDocumentMutation(config, descriptor, {
      ...documentMutationEnvelope(config, descriptor, {
        mutationId: scopedMutationId(baseMutationId, "title", hasMultipleMutations),
        expectedHeadSeq,
      }),
      operations: [{ kind: "set_title", title: input.title }],
    });
    receipts.push(receipt);
  }
  return { descriptor, receipts };
}

// ─── Status Helpers ───

function normalizeStatusId(input) {
  if (typeof input !== "string" || input.trim().length === 0) {
    throw new Error("Status is required");
  }

  const trimmed = input.trim();
  if (STATUSES.some((status) => status.id === trimmed)) return trimmed;

  const normalized = trimmed.toLowerCase().replace(/[\s-]+/g, "_");
  if (STATUSES.some((status) => status.id === normalized)) return normalized;

  const byName = STATUSES.find((status) => status.name.toLowerCase() === trimmed.toLowerCase());
  if (byName) return byName.id;

  const candidates = STATUSES.flatMap((status) => [
    status.id,
    status.id.replace(/_/g, "-"),
    status.name.toLowerCase(),
  ]);
  const suggestion = closestMatch(input, candidates);
  const suffix = suggestion ? ` Did you mean "${suggestion}"?` : "";
  throw new Error(`Unknown status: ${input}.${suffix} Valid: ${STATUSES.map((status) => status.id).join(", ")}`);
}

// ─── Page Formatting ───

function pageToKV(page, statusId) {
  return {
    id: page.id,
    status: statusId,
    title: page.title,
    description: page.description || "",
    priority: page.priority,
    estimate: page.estimate || "",
    tags: Array.isArray(page.tags) ? page.tags.join(";") : "",
    dueDate: page.dueDate || "",
    assignee: page.assignee || "",
    created: page.created,
    order: page.order,
  };
}

const LS_HEADERS = ["id", "status", "title", "priority", "estimate", "assignee", "tags", "order"];
const LS_FULL_HEADERS = [
  "id",
  "status",
  "title",
  "description",
  "descriptionLen",
  "descriptionTruncated",
  "priority",
  "estimate",
  "tags",
  "dueDate",
  "assignee",
  "created",
  "order",
];

function pageToRow(page, statusId) {
  return {
    id: page.id,
    status: statusId,
    title: page.title,
    priority: page.priority,
    estimate: page.estimate || "",
    assignee: page.assignee || "",
    tags: Array.isArray(page.tags) ? page.tags.join(";") : "",
    order: page.order,
  };
}

function truncateDescription(description, maxChars) {
  if (description.length <= maxChars) {
    return { value: description, truncated: false };
  }
  if (maxChars <= 3) {
    return { value: ".".repeat(maxChars), truncated: true };
  }
  return { value: `${description.slice(0, maxChars - 3)}...`, truncated: true };
}

function pageToFullRow(page, statusId, options) {
  const description = page.description || "";
  const truncated = options.descriptionFull
    ? { value: description, truncated: false }
    : truncateDescription(description, options.descriptionChars);

  return {
    id: page.id,
    status: statusId,
    title: page.title,
    description: truncated.value,
    descriptionLen: description.length,
    descriptionTruncated: truncated.truncated,
    priority: page.priority,
    estimate: page.estimate || "",
    tags: Array.isArray(page.tags) ? page.tags : [],
    dueDate: page.dueDate || "",
    assignee: page.assignee || "",
    created: page.created,
    order: page.order,
  };
}

// ─── Arg Parser ───

const OPTION_ALIASES = {
  "--url": "url",
  "--session-id": "sessionId",
  "--project": "project", "-p": "project",
  "--priority": "priority", "-P": "priority",
  "--estimate": "estimate", "-e": "estimate",
  "--description": "description", "-d": "description",
  "--tags": "tags", "-t": "tags",
  "--assignee": "assignee", "-a": "assignee",
  "--due": "due",
  "--title": "title",
  "--name": "name", "-n": "name",
  "--label": "label",
  "--page-id": "pageId",
  "--limit": "limit",
  "--offset": "offset",
  "--before-source": "beforeSource",
  "--before-occurred-at": "beforeOccurredAt",
  "--before-version-id": "beforeVersionId",
  "--before-change-seq": "beforeChangeSeq",
  "--description-chars": "descriptionChars",
  "--mutation-id": "mutationId",
  "--expected-head": "expectedHead",
};

const BOOLEAN_OPTION_ALIASES = {
  "--help": "help",
  "-h": "help",
  "--json": "json",
  "--jsonl": "jsonl",
  "--csv": "csv",
  "--pretty": "pretty",
  "--table": "table",
  "--verbose": "verbose",
  "-v": "verbose",
  "--full": "full",
  "--description-full": "descriptionFull",
  "--clear-description": "clearDescription",
  "--clear-tags": "clearTags",
  "--clear-assignee": "clearAssignee",
  "--clear-due": "clearDue",
};

const OPTION_TOKENS = new Set([
  ...Object.keys(OPTION_ALIASES),
  ...Object.keys(BOOLEAN_OPTION_ALIASES),
]);

const FLAG_DISPLAY = {
  url: "--url",
  sessionId: "--session-id",
  project: "-p/--project",
  priority: "--priority",
  estimate: "--estimate",
  description: "--description",
  tags: "--tags",
  assignee: "--assignee",
  due: "--due",
  title: "--title",
  name: "--name",
  label: "--label",
  pageId: "--page-id",
  limit: "--limit",
  offset: "--offset",
  beforeSource: "--before-source",
  beforeOccurredAt: "--before-occurred-at",
  beforeVersionId: "--before-version-id",
  beforeChangeSeq: "--before-change-seq",
  descriptionChars: "--description-chars",
  mutationId: "--mutation-id",
  expectedHead: "--expected-head",
  help: "--help",
  json: "--json",
  jsonl: "--jsonl",
  csv: "--csv",
  pretty: "--pretty",
  table: "--table",
  verbose: "--verbose",
  full: "--full",
  descriptionFull: "--description-full",
  clearDescription: "--clear-description",
  clearTags: "--clear-tags",
  clearAssignee: "--clear-assignee",
  clearDue: "--clear-due",
  yes: "--yes",
  noSafetyBackup: "--no-safety-backup",
};

const COMMAND_ALLOWED_FLAGS = {
  ls: new Set([
    "help", "json", "jsonl", "csv", "pretty", "table", "project", "url", "sessionId",
    "priority", "assignee", "limit", "offset", "full", "descriptionChars", "descriptionFull",
  ]),
  get: new Set(["help", "json", "jsonl", "csv", "pretty", "table", "project", "url", "sessionId"]),
  add: new Set(["help", "json", "jsonl", "csv", "pretty", "table", "project", "url", "sessionId", "description", "priority", "estimate", "tags", "assignee", "due", "mutationId", "pageId"]),
  update: new Set([
    "help", "json", "jsonl", "csv", "pretty", "table", "verbose", "project", "url", "sessionId",
    "title", "description", "clearDescription", "priority", "estimate", "tags", "clearTags",
    "assignee", "clearAssignee", "due", "clearDue", "mutationId", "expectedHead",
  ]),
  rm: new Set(["help", "json", "jsonl", "csv", "pretty", "table", "project", "url", "sessionId", "mutationId"]),
  mv: new Set([
    "help", "json", "jsonl", "csv", "pretty", "table", "verbose", "project", "url", "sessionId",
    "title", "description", "clearDescription", "priority", "estimate", "tags", "clearTags",
    "assignee", "clearAssignee", "due", "clearDue", "mutationId", "expectedHead",
  ]),
  block: new Set([
    "help", "json", "jsonl", "csv", "pretty", "table", "project", "url",
    "sessionId", "mutationId", "expectedHead",
  ]),
  database: new Set([
    "help", "json", "jsonl", "csv", "pretty", "table", "project", "url",
    "sessionId", "mutationId",
  ]),
  history: new Set([
    "help", "json", "jsonl", "csv", "pretty", "table", "project", "url",
    "page", "limit", "beforeSource", "beforeOccurredAt", "beforeVersionId",
    "beforeChangeSeq",
  ]),
  query: new Set(["help", "json", "jsonl", "csv", "pretty", "table", "project", "url", "sessionId"]),
  schema: new Set(["help", "json", "jsonl", "csv", "pretty", "table", "project", "url", "sessionId"]),
  backups: new Set(["help", "json", "jsonl", "csv", "pretty", "table", "url", "label", "yes", "noSafetyBackup"]),
  projects: new Set(["help", "json", "jsonl", "csv", "pretty", "table", "url", "sessionId", "project", "description", "name"]),
  config: new Set(["help", "json"]),
};

function levenshtein(a, b) {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix = Array.from({ length: rows }, () => Array(cols).fill(0));

  for (let i = 0; i < rows; i++) matrix[i][0] = i;
  for (let j = 0; j < cols; j++) matrix[0][j] = j;

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[a.length][b.length];
}

function closestMatch(value, candidates) {
  const normalized = value.toLowerCase();
  let best = null;
  let bestDistance = Infinity;

  for (const candidate of candidates) {
    const distance = levenshtein(normalized, candidate.toLowerCase());
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }

  if (!best) return null;
  if (bestDistance > Math.max(2, Math.floor(value.length / 3))) return null;
  return best;
}

function resolveSubcommand(input) {
  if (COMMANDS.has(input)) return input;
  if (SUBCOMMAND_ALIASES.has(input)) return SUBCOMMAND_ALIASES.get(input);
  return null;
}

function assertValidProjectId(projectId) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(projectId)) {
    throw new Error(`Invalid project id "${projectId}". Use lowercase letters, numbers, and single hyphens.`);
  }
}

function assertValidPriority(priority) {
  if (!PRIORITIES.has(priority)) {
    throw new Error(`Invalid priority "${priority}". Valid: ${Array.from(PRIORITIES).join(", ")}`);
  }
}

function assertValidEstimate(estimate) {
  if (!ESTIMATES.has(estimate)) {
    throw new Error(`Invalid estimate "${estimate}". Valid: ${Array.from(ESTIMATES).join(", ")}`);
  }
}

function parseNonNegativeInt(raw, label) {
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
}

function parsePositiveIntAtMost(raw, label, maximum) {
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${label} must be an integer between 1 and ${maximum}`);
  }
  return value;
}

function parseDueDate(raw) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error(`Invalid due date "${raw}". Expected YYYY-MM-DD`);
  }

  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) {
    throw new Error(`Invalid due date "${raw}". Expected a real calendar date in YYYY-MM-DD`);
  }

  return raw;
}

function parseTags(raw) {
  return raw
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function parseCliArgs(argv) {
  const args = { _: [], flags: {} };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === "--") {
      args._.push(...argv.slice(i + 1));
      break;
    }

    if (BOOLEAN_OPTION_ALIASES[arg]) {
      const key = BOOLEAN_OPTION_ALIASES[arg];
      args.flags[key] = true;
      continue;
    }
    if (arg === "--yes") {
      args.flags.yes = true;
      continue;
    }
    if (arg === "--no-safety-backup") {
      args.flags.noSafetyBackup = true;
      continue;
    }

    if (OPTION_ALIASES[arg]) {
      const key = OPTION_ALIASES[arg];
      const next = argv[i + 1];
      if (next === undefined || (next.startsWith("-") && OPTION_TOKENS.has(next))) {
        throw new Error(`Option ${arg} requires a value`);
      }
      args.flags[key] = next;
      i += 1;
      continue;
    }

    if (arg.startsWith("-")) {
      const suggestion = closestMatch(arg, Array.from(OPTION_TOKENS));
      const suffix = suggestion ? ` Did you mean ${suggestion}?` : "";
      throw new Error(`Unknown option: ${arg}.${suffix}`);
    }

    args._.push(arg);
  }

  return args;
}

function validateCommandFlags(command, flags) {
  const allowed = COMMAND_ALLOWED_FLAGS[command];
  if (!allowed) return;

  for (const key of Object.keys(flags)) {
    if (!allowed.has(key)) {
      const display = FLAG_DISPLAY[key] || `--${key}`;
      throw new Error(`Option ${display} is not valid for 'nodex ${command}'`);
    }
  }

  if (flags.pretty && !flags.json) {
    throw new Error("--pretty requires --json");
  }

  const outputFlags = [flags.json, flags.jsonl, flags.csv, flags.table].filter(Boolean);
  if (outputFlags.length > 1) {
    throw new Error("Only one output flag can be used at a time: --json, --jsonl, --csv, --table");
  }

  if ((flags.descriptionChars !== undefined || flags.descriptionFull) && !flags.full) {
    throw new Error("--description-chars and --description-full require --full");
  }

  if (flags.descriptionChars !== undefined && flags.descriptionFull) {
    throw new Error("Cannot use --description-chars together with --description-full");
  }
}

function assertNoConflictingClearFlags(flags) {
  const conflicts = [
    ["description", "clearDescription", "--description", "--clear-description"],
    ["tags", "clearTags", "--tags", "--clear-tags"],
    ["assignee", "clearAssignee", "--assignee", "--clear-assignee"],
    ["due", "clearDue", "--due", "--clear-due"],
  ];

  for (const [valueFlag, clearFlag, valueLabel, clearLabel] of conflicts) {
    if (flags[valueFlag] !== undefined && flags[clearFlag]) {
      throw new Error(`Cannot use ${valueLabel} together with ${clearLabel}`);
    }
  }
}

// ─── Command: projects ───

async function cmdProjects(positional, flags) {
  const sub = positional[0];

  if (sub && !["add", "rm", "mv", "ls", "list"].includes(sub)) {
    throw new Error(`Unknown projects subcommand: ${sub}. Valid: add, mv, rm`);
  }

  if (sub === "add") {
    const id = positional[1];
    const name = positional[2];
    if (!id || !name) throw new Error("Usage: nodex projects add <id> <name> [--description <text>]");

    assertValidProjectId(id);

    const body = { id, name };
    if (flags.description !== undefined) body.description = flags.description;

    const project = await apiPost("/api/projects", body);
    keyValueOut({ id: project.id, name: project.name, description: project.description || "" }, flags);
    return;
  }

  if (sub === "rm") {
    const id = positional[1];
    if (!id) throw new Error("Usage: nodex projects rm <id>");
    assertValidProjectId(id);
    await apiDelete(`/api/projects/${encodeURIComponent(id)}`);
    if (flags.json) {
      jsonOut({ success: true, projectId: id }, flags);
      return;
    }
    rowsOut(["status", "projectId"], [{ status: "deleted", projectId: id }], flags);
    return;
  }

  if (sub === "mv") {
    const oldId = positional[1];
    const newId = positional[2];
    if (!oldId || !newId) throw new Error("Usage: nodex projects mv <old-id> <new-id> [--name <name>] [--description <text>]");

    assertValidProjectId(newId);

    const body = { newId };
    if (flags.name !== undefined) body.name = flags.name;
    if (flags.description !== undefined) body.description = flags.description;

    const project = await apiPut(`/api/projects/${encodeURIComponent(oldId)}`, body);
    keyValueOut({ id: project.id, name: project.name, description: project.description || "" }, flags);
    return;
  }

  // Default: list projects
  const data = await apiGet("/api/projects");
  const headers = ["id", "name", "description", "created"];
  const rows = data.projects.map(p => ({
    id: p.id,
    name: p.name,
    description: p.description || "",
    created: p.created,
  }));

  rowsOut(headers, rows, flags);
}

// ─── Command: ls ───

async function cmdLs(positional, flags, config) {
  const prefix = apiPrefix(config);
  const lsOptions = {
    full: flags.full === true,
    descriptionFull: flags.descriptionFull === true,
    descriptionChars: flags.descriptionChars !== undefined
      ? parseNonNegativeInt(flags.descriptionChars, "--description-chars")
      : DEFAULT_LS_DESCRIPTION_CHARS,
  };
  let pages = [];

  if (positional[0]) {
    const statusId = normalizeStatusId(positional[0]);
    const column = await apiGet(`${prefix}/column?id=${encodeURIComponent(statusId)}`);
    pages = column.cards.map((page) => {
      if (lsOptions.full) {
        return pageToFullRow(page, column.id, lsOptions);
      }
      return pageToRow(page, column.id);
    });
  } else {
    const columns = await Promise.all(
      STATUSES.map((status) =>
        apiGet(`${prefix}/column?id=${encodeURIComponent(status.id)}`),
      ),
    );
    for (const column of columns) {
      for (const page of column.cards) {
        if (lsOptions.full) {
          pages.push(pageToFullRow(page, column.id, lsOptions));
        } else {
          pages.push(pageToRow(page, column.id));
        }
      }
    }
  }

  if (flags.priority) {
    assertValidPriority(flags.priority);
    pages = pages.filter((page) => page.priority === flags.priority);
  }
  if (flags.assignee) pages = pages.filter((page) => page.assignee === flags.assignee);
  if (flags.offset) pages = pages.slice(parseNonNegativeInt(flags.offset, "--offset"));
  if (flags.limit) pages = pages.slice(0, parseNonNegativeInt(flags.limit, "--limit"));

  rowsOut(lsOptions.full ? LS_FULL_HEADERS : LS_HEADERS, pages, flags);
}

// ─── Command: get ───

async function cmdGet(positional, flags, config) {
  const pageId = positional[0];
  if (!pageId) throw new Error("Usage: nodex get <page-id>");

  const prefix = apiPrefix(config);
  const page = await apiGet(
    `${prefix}/database-row?pageId=${encodeURIComponent(pageId)}`
  );

  if (flags.json) {
    jsonOut(page, flags);
  } else {
    keyValueOut(pageToKV(page, page.status), flags);
  }
}

// ─── Command: block ───

async function cmdBlock(positional, flags, config) {
  const action = positional[0];
  if (!action) {
    throw new Error(
      "Usage: nodex block <descriptor|export|apply|replace|title|command> [target] [value]",
    );
  }

  if (action === "command") {
    const value = positional[1];
    if (value === undefined) {
      throw new Error("nodex block command requires JSON or @file/@- input");
    }
    const resolvedValue = await resolveValue(value);
    let rawCommand;
    try {
      rawCommand = JSON.parse(resolvedValue);
    } catch {
      throw new Error("Additional Document command must be valid JSON");
    }
    if (
      typeof rawCommand !== "object" ||
      rawCommand === null ||
      Array.isArray(rawCommand)
    ) {
      throw new Error("Additional Document command must be a JSON object");
    }
    const request = {
      ...rawCommand,
      version: rawCommand.version ?? 1,
      operationId:
        flags.mutationId ?? rawCommand.operationId ?? randomUUID(),
      projectId: config.project,
      clientSessionId: config.sessionId ?? "nodex-cli",
      actor: { kind: "nodex_cli" },
    };
    keyValueOut(
      { command: await sendAdditionalDocumentCommand(config, request) },
      flags,
    );
    return;
  }

  const pageId = positional[1];
  if (!pageId) {
    throw new Error(
      "Usage: nodex block <descriptor|export|apply|replace|title> <page-id> [value]",
    );
  }

  if (action === "descriptor") {
    keyValueOut(await preparePageDocument(config, pageId), flags);
    return;
  }
  if (action === "export") {
    const page = await apiGet(
      `${apiPrefix(config)}/database-row?pageId=${encodeURIComponent(pageId)}`,
    );
    keyValueOut(
      { pageId, title: page.title ?? "", nfm: page.description ?? "" },
      flags,
    );
    return;
  }

  const value = positional[2];
  if (value === undefined) {
    throw new Error(`nodex block ${action} requires a value or @file/@- input`);
  }
  const resolvedValue = await resolveValue(value);
  const expectedHeadSeq = flags.expectedHead === undefined
    ? undefined
    : parseNonNegativeInt(flags.expectedHead, "--expected-head");

  if (action === "replace" || action === "title") {
    const result = await mutatePageContent(config, pageId, {
      ...(action === "replace"
        ? { nfm: resolvedValue }
        : { title: resolvedValue }),
      mutationId: flags.mutationId,
      expectedHeadSeq,
    });
    keyValueOut(
      {
        pageId,
        documentId: result.descriptor.documentId,
        mutation: result.receipts[0],
      },
      flags,
    );
    return;
  }

  if (action !== "apply") {
    throw new Error(`Unknown block action: ${action}`);
  }
  let operations;
  try {
    operations = JSON.parse(resolvedValue);
  } catch {
    throw new Error("Block operations must be valid JSON");
  }
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new Error("Block operations must be a non-empty JSON array");
  }
  const descriptor = await preparePageDocument(config, pageId);
  const receipt = await sendDocumentMutation(config, descriptor, {
    ...documentMutationEnvelope(config, descriptor, {
      mutationId: requireCanonicalMutationId(flags.mutationId),
      expectedHeadSeq: expectedHeadSeq ?? descriptor.headSeq,
    }),
    operations,
  });
  keyValueOut(
    { pageId, documentId: descriptor.documentId, mutation: receipt },
    flags,
  );
}

// ─── Command: database ───

async function readDatabaseModuleSnapshot(config, read) {
  const request = {
    version: 2,
    projectId: config.project,
    read,
  };
  const result = await apiPost(
    `${apiPrefix(config)}/database-module/read`,
    request,
  );
  if (
    result?.ok !== true ||
    result?.value?.projectId !== config.project ||
    typeof result?.value?.storeEpoch !== "string" ||
    !Number.isSafeInteger(result?.value?.changeLogSeq) ||
    !result?.value?.value
  ) {
    throw new Error(result?.error?.message || "Server returned an invalid Database Module snapshot");
  }
  return result.value;
}

async function applyDatabaseOperations(config, snapshot, operationId, operations) {
  const request = {
    version: 2,
    operationId,
    projectId: config.project,
    storeEpoch: snapshot.storeEpoch,
    actor: { kind: "nodex_cli" },
    operations,
  };
  const send = async () =>
    apiPost(`${apiPrefix(config)}/database-module/apply`, request);
  let result;
  try {
    result = await send();
  } catch {
    result = await send();
  }
  if (result?.ok !== true) {
    throw new Error(result?.error?.message || "Database Module mutation failed");
  }
  return result.value;
}

async function cmdDatabase(positional, flags, config) {
  const action = positional[0];
  const stableId = positional[1];
  if (!action) {
    throw new Error(
      "Usage: nodex database <catalog|descriptor|query|members|membership|view-update|apply> [stable-id] [value]",
    );
  }

  if (action === "catalog") {
    const snapshot = await readDatabaseModuleSnapshot(config, {
      target: { kind: "project_default" },
      mode: "catalog",
    });
    if (snapshot.value.kind !== "catalog") {
      throw new Error("Server returned an invalid Database catalog");
    }
    if (flags.json) {
      jsonOut(snapshot, flags);
      return;
    }
    rowsOut(
      ["databaseId", "name", "defaultViewId", "dataSources", "views"],
      snapshot.value.databases.map((descriptor) => ({
        databaseId: descriptor.database.databaseId,
        name: descriptor.database.name,
        defaultViewId: descriptor.database.defaultViewId ?? "",
        dataSources: descriptor.dataSources.filter((source) => source.lifecycle === "active").length,
        views: descriptor.views.filter((view) => view.lifecycle === "active").length,
      })),
      flags,
    );
    return;
  }

  if (!stableId) {
    throw new Error(`nodex database ${action} requires a stable identity`);
  }

  if (action === "descriptor") {
    keyValueOut(await readDatabaseModuleSnapshot(config, {
      target: { kind: "database", databaseId: stableId },
      mode: "database",
    }), flags);
    return;
  }
  if (action === "query") {
    const snapshot = await readDatabaseModuleSnapshot(config, {
      target: { kind: "view", viewId: stableId },
      mode: "query",
    });
    if (snapshot.value.kind !== "query") {
      throw new Error("Server returned an invalid Database View query");
    }
    if (flags.json) {
      jsonOut(snapshot, flags);
      return;
    }
    rowsOut(
      ["pageId", "title", "groupKey", "positionRevision", "membershipRevision"],
      snapshot.value.value.rows.map((row) => ({
        pageId: row.page.pageId,
        title: row.page.title,
        groupKey: row.effectiveGroupKey ?? "",
        positionRevision: row.position?.revision ?? 0,
        membershipRevision: row.membership.revision,
      })),
      flags,
    );
    return;
  }
  if (action === "members") {
    const descriptorSnapshot = await readDatabaseModuleSnapshot(config, {
      target: { kind: "database", databaseId: stableId },
      mode: "database",
    });
    if (descriptorSnapshot.value.kind !== "database") {
      throw new Error(`Database not found: ${stableId}`);
    }
    const descriptor = descriptorSnapshot.value.value;
    const activeSourceIds = new Set(
      descriptor.dataSources
        .filter((source) => source.lifecycle === "active")
        .map((source) => source.dataSourceId),
    );
    const view = descriptor.views.find(
      (candidate) => candidate.lifecycle === "active"
        && candidate.viewId === descriptor.database.defaultViewId,
    ) ?? descriptor.views.find(
      (candidate) => candidate.lifecycle === "active"
        && activeSourceIds.has(candidate.dataSourceId),
    );
    if (!view) throw new Error(`Database has no active View: ${stableId}`);
    const querySnapshot = await readDatabaseModuleSnapshot(config, {
      target: { kind: "view", viewId: view.viewId },
      mode: "query",
    });
    if (querySnapshot.value.kind !== "query") {
      throw new Error(`Database View is unavailable: ${view.viewId}`);
    }
    const members = querySnapshot.value.value.rows;
    if (flags.json) {
      jsonOut({ database: descriptor.database, pages: members }, flags);
      return;
    }
    rowsOut(
      ["pageId", "title", "membershipId", "membershipRevision"],
      members.map((row) => ({
        pageId: row.page.pageId,
        title: row.page.title,
        membershipId: row.membership.membershipId,
        membershipRevision: row.membership.revision,
      })),
      flags,
    );
    return;
  }
  if (action === "membership") {
    const targetDatabaseId = positional[2];
    if (!targetDatabaseId) {
      throw new Error("Usage: nodex database membership <page-id> <database-id|none> [view-id]");
    }
    const detail = await readPageDetail(config, stableId);
    const activeMembership = detail.dataSourceContext.kind === "member"
      ? detail.dataSourceContext.membership
      : null;
    const operationId = requireCanonicalMutationId(flags.mutationId);
    const operations = [];
    if (targetDatabaseId === "none" && !activeMembership) {
      throw new Error(`Page ${stableId} has no owning Data Source membership`);
    }
    if (targetDatabaseId === "none") {
      operations.push({
        kind: "transfer_page",
        pageId: stableId,
        expectedParentRevision: detail.page.parentRevision,
        expectedActiveMembershipRevision: activeMembership?.revision ?? 0,
        target: { kind: "library", libraryId: detail.libraryId },
      });
    } else {
      const descriptorSnapshot = await readDatabaseModuleSnapshot(config, {
        target: { kind: "database", databaseId: targetDatabaseId },
        mode: "database",
      });
      if (descriptorSnapshot.value.kind !== "database") {
        throw new Error(`Database not found: ${targetDatabaseId}`);
      }
      const descriptor = descriptorSnapshot.value.value;
      const activeSources = descriptor.dataSources.filter(
        (source) => source.lifecycle === "active",
      );
      if (activeSources.length !== 1) {
        throw new Error(
          `Database ${targetDatabaseId} must have exactly one active Data Source in this release`,
        );
      }
      const targetSource = activeSources[0];
      if (activeMembership?.dataSourceId === targetSource.dataSourceId) {
        throw new Error(`Page already belongs to Data Source ${targetSource.dataSourceId}`);
      }
      const requestedViewId = positional[3];
      const selectedView = requestedViewId
        ? descriptor.views.find(
            (view) => view.viewId === requestedViewId
              && view.dataSourceId === targetSource.dataSourceId
              && view.lifecycle === "active",
          )
        : descriptor.views.find(
            (view) => view.lifecycle === "active"
              && view.dataSourceId === targetSource.dataSourceId
              && view.isDefault,
          ) ?? descriptor.views.find(
            (view) => view.lifecycle === "active"
              && view.dataSourceId === targetSource.dataSourceId,
          );
      if (!selectedView) {
        throw new Error(`Target Database has no active View: ${targetDatabaseId}`);
      }
      operations.push(
        {
          kind: "transfer_page",
          pageId: stableId,
          expectedParentRevision: detail.page.parentRevision,
          expectedActiveMembershipRevision: activeMembership?.revision ?? 0,
          target: {
            kind: "data_source",
            dataSourceId: targetSource.dataSourceId,
          },
        },
        {
          kind: "position_page",
          viewId: selectedView.viewId,
          pageId: stableId,
          expectedPositionRevision: 0,
          groupKey: null,
        },
      );
    }
    const receipt = await applyDatabaseOperations(
      config,
      detail,
      operationId,
      operations,
    );
    keyValueOut(receipt, flags);
    return;
  }
  if (action === "view-update") {
    const input = positional[2];
    if (input === undefined) {
      throw new Error("nodex database view-update requires a JSON patch or @file/@- input");
    }
    const resolved = await resolveValue(input);
    let patch;
    try {
      patch = JSON.parse(resolved);
    } catch {
      throw new Error("Database View patch must be valid JSON");
    }
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
      throw new Error("Database View patch must be a JSON object");
    }
    const viewSnapshot = await readDatabaseModuleSnapshot(config, {
      target: { kind: "view", viewId: stableId },
      mode: "view",
    });
    if (viewSnapshot.value.kind !== "view") {
      throw new Error("Server returned an invalid Database View snapshot");
    }
    const current = viewSnapshot.value.value;
    const allowed = new Set(["name", "kind", "config"]);
    const unsupported = Object.keys(patch).find((key) => !allowed.has(key));
    if (unsupported) throw new Error(`Unsupported Database View patch field: ${unsupported}`);
    const operationId = requireCanonicalMutationId(flags.mutationId);
    const receipt = await applyDatabaseOperations(
      config,
      viewSnapshot,
      operationId,
      [
        {
          kind: "put_view",
          databaseId: current.databaseId,
          dataSourceId: current.dataSourceId,
          viewId: current.viewId,
          expectedRevision: current.revision,
          name: patch.name ?? current.name,
          viewKind: patch.kind ?? current.kind,
          config: patch.config ?? current.config,
          isDefault: current.isDefault,
        },
      ],
    );
    keyValueOut(receipt, flags);
    return;
  }
  if (action !== "apply") {
    throw new Error(`Unknown database action: ${action}`);
  }

  const input = positional[2];
  if (input === undefined) {
    throw new Error("nodex database apply requires an operation array or @file/@- input");
  }
  const resolved = await resolveValue(input);
  let parsed;
  try {
    parsed = JSON.parse(resolved);
  } catch {
    throw new Error("Database operations must be valid JSON");
  }
  const snapshot = await readDatabaseModuleSnapshot(config, {
    target: { kind: "database", databaseId: stableId },
    mode: "database",
  });
  const request = Array.isArray(parsed)
    ? {
        version: 2,
        operationId: requireCanonicalMutationId(flags.mutationId),
        projectId: config.project,
        storeEpoch: snapshot.storeEpoch,
        actor: { kind: "nodex_cli" },
        operations: parsed,
      }
    : parsed;
  if (flags.mutationId && !Array.isArray(parsed)) {
    if (parsed?.operationId !== flags.mutationId) {
      throw new Error("--mutation-id must match the operationId in a full Database request envelope");
    }
  }
  const result = Array.isArray(parsed)
    ? await applyDatabaseOperations(config, snapshot, request.operationId, request.operations)
    : await apiPost(`${apiPrefix(config)}/database-module/apply`, request);
  if (!Array.isArray(parsed) && result?.ok !== true) {
    throw new Error(result?.error?.message || "Database Module mutation failed");
  }
  keyValueOut(Array.isArray(parsed) ? result : result.value, flags);
}

// ─── Command: add ───

async function cmdAdd(positional, flags, config) {
  const statusRaw = positional[0];
  const title = positional[1];
  if (!statusRaw || !title) throw new Error("Usage: nodex add <status> <title> [opts]");

  const status = normalizeStatusId(statusRaw);
  if (flags.mutationId !== undefined && flags.pageId === undefined) {
    throw new Error(
      "--mutation-id for 'nodex add' requires --page-id so a later retry preserves both identities",
    );
  }
  const pageId = flags.pageId === undefined
    ? uuidV7()
    : requireCanonicalPageId(flags.pageId);
  const operationId = requireCanonicalMutationId(flags.mutationId);
  const operation = {
    kind: "create_page",
    pageId: pageId,
    status,
    title,
    nfm: "",
  };

  if (flags.description !== undefined) operation.nfm = await resolveValue(flags.description);
  if (flags.priority) {
    assertValidPriority(flags.priority);
    operation.priority = flags.priority;
  }
  if (flags.estimate) {
    assertValidEstimate(flags.estimate);
    operation.estimate = flags.estimate;
  }
  if (flags.tags !== undefined) operation.tags = parseTags(flags.tags);
  if (flags.assignee !== undefined) operation.assignee = flags.assignee;
  if (flags.due !== undefined) operation.dueDate = parseDueDate(flags.due);
  const preflight = await readPageLifecyclePreflight(config, pageId);
  const isExplicitExactRetry =
    flags.pageId !== undefined && flags.mutationId !== undefined;
  if (
    (preflight.value.page || preflight.value.reservedBlockType) &&
    !isExplicitExactRetry
  ) {
    throw new Error(`Page identity is already reserved: ${pageId}`);
  }
  const receipt = await sendPageLifecycleMutation(
    config,
    pageLifecycleEnvelope(config, preflight, operationId, operation),
  );
  const page = await readCanonicalPageAfterLifecycle(config, receipt);
  if (!page) throw new Error("Created Page is missing from canonical authority");

  if (flags.json) {
    jsonOut(page, flags);
    return;
  }
  keyValueOut(pageToKV(page, status), flags);
}

// ─── Command: update ───

async function cmdUpdate(positional, flags, config) {
  const pageId = positional[0];
  if (!pageId) throw new Error("Usage: nodex update <page-id> [opts]");
  assertNoConflictingClearFlags(flags);

  const prefix = apiPrefix(config);
  const body = { pageId };
  if (config.sessionId) body.sessionId = config.sessionId;

  const title = flags.title === undefined
    ? undefined
    : await resolveValue(flags.title);
  const nfm = flags.clearDescription
    ? ""
    : flags.description === undefined
      ? undefined
      : await resolveValue(flags.description);

  if (flags.priority !== undefined) {
    assertValidPriority(flags.priority);
    body.priority = flags.priority;
  }

  if (flags.estimate !== undefined) {
    assertValidEstimate(flags.estimate);
    body.estimate = flags.estimate;
  }

  if (flags.clearTags) {
    body.tags = [];
  } else if (flags.tags !== undefined) {
    body.tags = parseTags(flags.tags);
  }

  if (flags.clearAssignee) {
    body.assignee = "";
  } else if (flags.assignee !== undefined) {
    body.assignee = flags.assignee;
  }

  if (flags.clearDue) {
    body.dueDate = null;
  } else if (flags.due !== undefined) {
    body.dueDate = parseDueDate(flags.due);
  }

  const metadataChanged = Object.keys(body).some(
    (key) => key !== "pageId" && key !== "sessionId",
  );
  if (!metadataChanged && title === undefined && nfm === undefined) {
    throw new Error("No Page update was specified");
  }
  const { pageId: _pageId, sessionId: _sessionId, ...metadataPatch } = body;
  void _pageId;
  void _sessionId;
  const metadataResult = metadataChanged
    ? await mutatePageMetadata(
        config,
        pageId,
        metadataPatch,
        requireCanonicalMutationId(flags.mutationId),
      )
    : null;
  const contentResult = title !== undefined || nfm !== undefined
    ? await mutatePageContent(config, pageId, {
        title,
        nfm,
        mutationId: flags.mutationId,
        expectedHeadSeq: flags.expectedHead === undefined
          ? undefined
          : parseNonNegativeInt(flags.expectedHead, "--expected-head"),
        skipUnchanged:
          flags.mutationId === undefined && flags.expectedHead === undefined,
      })
    : null;

  if (flags.json) {
    jsonOut({
      status: "updated",
      pageId,
      ...(metadataResult ? { metadata: metadataResult } : {}),
      ...(contentResult
        ? { documentMutations: contentResult.receipts }
        : {}),
    }, flags);
  } else if (flags.verbose) {
    const page = await apiGet(
      `${prefix}/database-row?pageId=${encodeURIComponent(pageId)}`,
    );
    keyValueOut(pageToKV(page, page.status || "unknown"), flags);
  } else {
    rowsOut(["status", "pageId"], [{ status: "updated", pageId: pageId }], flags);
  }
}

// ─── Command: rm ───

async function cmdRm(positional, flags, config) {
  const pageId = positional[0];
  if (!pageId) throw new Error("Usage: nodex rm <page-id>");

  const operationId = requireCanonicalMutationId(flags.mutationId);
  const preflight = await readPageLifecyclePreflight(config, pageId);
  const page = preflight.value.page;
  if (!page || page.pageId !== pageId) {
    throw new Error(`Page does not exist: ${pageId}`);
  }
  if (
    page.lifecycle === "deleted" ||
    page.parent.kind !== "library" ||
    page.libraryRankKey === null
  ) {
    throw new Error(`Page ${pageId} is not an active top-level Library Page`);
  }
  const receipt = await sendPageLifecycleMutation(
    config,
    pageLifecycleEnvelope(config, preflight, operationId, {
      kind: "delete_page",
      pageId: pageId,
      expectedMetadataRevision: page.metadataRevision,
      expectedParentRevision: page.parentRevision,
    }),
  );
  await readCanonicalPageAfterLifecycle(config, receipt);
  if (flags.json) {
    jsonOut({ success: true, pageId: pageId, operationId: receipt.operationId }, flags);
    return;
  }
  rowsOut(["status", "pageId"], [{ status: "deleted", pageId: pageId }], flags);
}

// ─── Command: mv ───

async function cmdMv(positional, flags, config) {
  const pageId = positional[0];
  const fromStatusRaw = positional[1];
  const toStatusRaw = positional[2];
  if (!pageId || !fromStatusRaw || !toStatusRaw) throw new Error("Usage: nodex mv <page-id> <from-status> <to-status> [order]");
  assertNoConflictingClearFlags(flags);

  const prefix = apiPrefix(config);
  const fromStatus = normalizeStatusId(fromStatusRaw);
  const toStatus = normalizeStatusId(toStatusRaw);

  // Atomic move: asserts the Page is still in <from-status>.
  const body = { pageId, fromStatus, toStatus };
  if (positional[3] !== undefined) body.newOrder = parseNonNegativeInt(positional[3], "order");
  if (config.sessionId) body.sessionId = config.sessionId;

  const operationId = requireCanonicalMutationId(flags.mutationId);
  const moveResult = await movePageInDefaultDatabase(
    config,
    {
      pageId,
      fromStatus,
      toStatus,
      ...(body.newOrder === undefined ? {} : { newOrder: body.newOrder }),
    },
    operationId,
  );
  const pageUpdates = {};

  const title = flags.title === undefined
    ? undefined
    : await resolveValue(flags.title);
  const nfm = flags.clearDescription
    ? ""
    : flags.description === undefined
      ? undefined
      : await resolveValue(flags.description);

  if (flags.priority !== undefined) {
    assertValidPriority(flags.priority);
    pageUpdates.priority = flags.priority;
  }

  if (flags.estimate !== undefined) {
    assertValidEstimate(flags.estimate);
    pageUpdates.estimate = flags.estimate;
  }

  if (flags.clearTags) {
    pageUpdates.tags = [];
  } else if (flags.tags !== undefined) {
    pageUpdates.tags = parseTags(flags.tags);
  }

  if (flags.clearAssignee) {
    pageUpdates.assignee = "";
  } else if (flags.assignee !== undefined) {
    pageUpdates.assignee = flags.assignee;
  }

  if (flags.clearDue) {
    pageUpdates.dueDate = null;
  } else if (flags.due !== undefined) {
    pageUpdates.dueDate = parseDueDate(flags.due);
  }

  const hasPageUpdates = Object.keys(pageUpdates).length > 0;
  const hasContentUpdates = title !== undefined || nfm !== undefined;
  let pageAfterMove = null;
  let contentResult = null;

  if (hasPageUpdates) {
    await mutatePageMetadata(config, pageId, pageUpdates, operationId);
  }
  if (hasContentUpdates) {
    contentResult = await mutatePageContent(config, pageId, {
      title,
      nfm,
      mutationId: flags.mutationId,
      expectedHeadSeq: flags.expectedHead === undefined
        ? undefined
        : parseNonNegativeInt(flags.expectedHead, "--expected-head"),
      skipUnchanged:
        flags.mutationId === undefined && flags.expectedHead === undefined,
    });
  }
  if (flags.verbose) {
    pageAfterMove = await apiGet(
      `${prefix}/database-row?pageId=${encodeURIComponent(pageId)}`
    );
  }

  if (flags.json) {
    jsonOut({
      success: moveResult !== false,
      pageId,
      toStatus,
      ...(pageAfterMove ? { page: pageAfterMove } : {}),
      updated: hasPageUpdates || hasContentUpdates,
      ...(contentResult
        ? { documentMutations: contentResult.receipts }
        : {}),
    }, flags);
    return;
  }

  if (flags.verbose && pageAfterMove) {
    keyValueOut(pageToKV(pageAfterMove, toStatus), flags);
    return;
  }

  rowsOut(
    ["status", "pageId", "toStatus"],
    [{ status: "moved", pageId: pageId, toStatus }],
    flags
  );
}

// ─── Command: history ───

function pageHistoryCursorQuery(flags) {
  const cursorFields = [
    flags.beforeSource,
    flags.beforeOccurredAt,
    flags.beforeVersionId,
    flags.beforeChangeSeq,
  ];
  if (cursorFields.every((field) => field === undefined)) return "";

  const params = new URLSearchParams();
  if (!flags.beforeSource || !flags.beforeOccurredAt) {
    throw new Error(
      "History pagination requires --before-source and --before-occurred-at",
    );
  }
  params.set("beforeSource", flags.beforeSource);
  params.set("beforeOccurredAt", flags.beforeOccurredAt);

  if (flags.beforeSource === "document_version") {
    if (!flags.beforeVersionId || flags.beforeChangeSeq !== undefined) {
      throw new Error(
        "A document_version cursor requires --before-version-id and no --before-change-seq",
      );
    }
    params.set("beforeVersionId", flags.beforeVersionId);
    return `&${params.toString()}`;
  }
  if (flags.beforeSource === "change_log") {
    if (flags.beforeChangeSeq === undefined || flags.beforeVersionId !== undefined) {
      throw new Error(
        "A change_log cursor requires --before-change-seq and no --before-version-id",
      );
    }
    params.set(
      "beforeChangeSeq",
      String(parseNonNegativeInt(flags.beforeChangeSeq, "--before-change-seq")),
    );
    return `&${params.toString()}`;
  }
  throw new Error(
    "--before-source must be document_version or change_log",
  );
}

async function cmdHistory(positional, flags, config) {
  const prefix = apiPrefix(config);
  const positionalPageId = positional[0];
  if (positional.length > 1) {
    throw new Error("Usage: nodex history <page-id> [options]");
  }
  if (flags.page && positionalPageId && flags.page !== positionalPageId) {
    throw new Error("Page ID was provided twice with different values");
  }
  const pageId = flags.page ?? positionalPageId;
  if (!pageId) throw new Error("Usage: nodex history <page-id> [options]");

  const pageSize = flags.limit === undefined
    ? 50
    : parsePositiveIntAtMost(flags.limit, "--limit", 100);
  const result = await apiGet(
    `${prefix}/pages/${encodeURIComponent(pageId)}/history?pageSize=${pageSize}${pageHistoryCursorQuery(flags)}`,
  );
  if (result?.ok !== true || !Array.isArray(result?.value?.entries)) {
    throw new Error("Server returned an invalid Page history page");
  }
  const data = result.value;

  const headers = [
    "id",
    "kind",
    "category",
    "title",
    "detail",
    "actor",
    "occurredAt",
    "evidence",
    "recovery",
  ];
  const rows = data.entries.map(e => ({
    id: e.id,
    kind: e.kind,
    category: e.display.category,
    title: e.display.title,
    detail: e.display.detail || "",
    actor: e.display.actorLabel || "",
    occurredAt: e.occurredAt,
    evidence: e.evidence.status,
    recovery: e.recovery.kind,
  }));

  if (flags.json) {
    jsonOut(data, flags);
    return;
  }
  rowsOut(headers, rows, flags);
}

// ─── Command: query ───

async function cmdQuery(positional, flags, config) {
  const prefix = apiPrefix(config);
  const sql = positional[0];
  if (!sql) throw new Error('Usage: nodex query "<sql>" [params...]');

  const params = positional.slice(1);
  const result = await apiPost(`${prefix}/query`, { sql, params });

  if (flags.json) {
    jsonOut(result, flags);
    return;
  }
  rowsOut(result.columns, result.rows, flags);
}

// ─── Command: schema ───

async function cmdSchema(_positional, flags, config) {
  const prefix = apiPrefix(config);
  const data = await apiGet(`${prefix}/schema`);

  if (flags.json) {
    jsonOut(data, flags);
  } else {
    const headers = ["table", "column", "type", "nullable", "default", "primaryKey"];
    const rows = [];
    for (const table of data.tables) {
      for (const col of table.columns) {
        rows.push({
          table: table.name,
          column: col.name,
          type: col.type,
          nullable: String(col.nullable),
          default: col.defaultValue || "",
          primaryKey: String(col.primaryKey),
        });
      }
    }
    rowsOut(headers, rows, flags);
  }
}

// ─── Command: backups ───

const BACKUP_HEADERS = [
  "id",
  "createdAt",
  "trigger",
  "label",
  "includesAssets",
  "dbBytes",
  "assetsBytes",
  "totalBytes",
];

function backupToRow(backup) {
  return {
    id: backup.id,
    createdAt: backup.createdAt,
    trigger: backup.trigger,
    label: backup.label || "",
    includesAssets: String(Boolean(backup.includesAssets)),
    dbBytes: backup.dbBytes,
    assetsBytes: backup.assetsBytes,
    totalBytes: backup.totalBytes,
  };
}

async function cmdBackups(positional, flags) {
  const sub = positional[0];

  if (!sub) {
    const data = await apiGet("/api/backups");
    const rows = data.backups.map(backupToRow);
    if (flags.json) {
      jsonOut(data.backups, flags);
    } else {
      console.log(csvTable(BACKUP_HEADERS, rows));
    }
    return;
  }

  if (sub === "create") {
    const body = {};
    if (flags.label) body.label = flags.label;
    const backup = await apiPost("/api/backups", body);
    if (flags.json) {
      jsonOut(backup, flags);
    } else {
      console.log(csvKeyValue(backupToRow(backup)));
    }
    return;
  }

  if (sub === "restore") {
    const backupId = positional[1];
    if (!backupId) {
      throw new Error("Usage: nodex backups restore <backup-id> --yes [--no-safety-backup]");
    }
    if (!flags.yes) {
      throw new Error("Restore is destructive. Re-run with --yes to confirm.");
    }

    const result = await apiPost(`/api/backups/${encodeURIComponent(backupId)}/restore`, {
      confirm: true,
      createSafetyBackup: !flags.noSafetyBackup,
    });

    if (flags.json) {
      jsonOut(result, flags);
    } else {
      console.log(
        csvKeyValue({
          success: String(Boolean(result.success)),
          restoredBackupId: result.restoredBackupId || backupId,
          safetyBackupId: result.safetyBackupId || "",
        })
      );
    }
    return;
  }

  throw new Error(`Unknown backups subcommand: ${sub}`);
}

// ─── Command: config ───

const CONFIG_DISPLAY_NAMES = {
  url: "url", sessionId: "session_id", project: "project",
  "server.dir": "server.dir", "server.port": "server.port",
  "server.backup_auto_enabled": "server.backup_auto_enabled",
  "server.backup_interval_hours": "server.backup_interval_hours",
  "server.backup_retention": "server.backup_retention",
  "server.history_retention": "server.history_retention",
};

function cmdConfigShow(flags) {
  const { fields } = loadConfigWithSources();

  if (flags.json) {
    const out = {};
    for (const [key, { value, source }] of Object.entries(fields)) {
      out[CONFIG_DISPLAY_NAMES[key]] = { value: value ?? null, source };
    }
    jsonOut(out, flags);
    return;
  }

  const agentKeys = ["url", "sessionId", "project"];
  const serverKeys = Object.keys(fields).filter(k => k.startsWith("server."));

  console.log("\nAgent configuration:");
  for (const key of agentKeys) {
    const { value, source } = fields[key];
    const name = CONFIG_DISPLAY_NAMES[key];
    const val = value ?? "(unset)";
    console.log(`  ${name.padEnd(12)} = ${String(val).padEnd(30)} (${formatSource(source)})`);
  }

  console.log("\nServer configuration:");
  for (const key of serverKeys) {
    const { value, source } = fields[key];
    const name = CONFIG_DISPLAY_NAMES[key].replace("server.", "");
    const val = value ?? "(unset)";
    console.log(`  ${name.padEnd(22)} = ${String(val).padEnd(20)} (${formatSource(source)})`);
  }
  console.log();
}

async function cmdConfigInteractive() {
  if (!process.stdin.isTTY) {
    console.error("Error: Interactive config requires a terminal. Use 'nodex config show' instead.");
    process.exit(1);
  }

  const { createInterface } = await import("node:readline/promises");
  const { homeConfigPath } = loadConfigWithSources();

  // Show current config
  cmdConfigShow({});

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    const cwdConfigPath = join(process.cwd(), ".nodex", "config.toml");

    console.log("Which config do you want to edit?");
    console.log(`  1. User-level   (${formatSource(homeConfigPath)})`);
    console.log(`  2. Project-level (${formatSource(cwdConfigPath)})`);

    const choice = (await rl.question("> ")).trim();
    if (choice !== "1" && choice !== "2") {
      console.log("Cancelled.");
      return;
    }

    const isUserLevel = choice === "1";
    const targetPath = isUserLevel ? homeConfigPath : cwdConfigPath;
    const existing = loadTomlFile(targetPath) || {};

    console.log(`\nEditing ${formatSource(targetPath)}`);

    const newConfig = {};

    const urlDefault = existing.url || "";
    const urlAnswer = (await rl.question(`  url [${urlDefault || "http://localhost:51283"}]: `)).trim();
    if (urlAnswer) newConfig.url = urlAnswer;
    else if (existing.url) newConfig.url = existing.url;

    const sidDefault = existing.session_id || "";
    const sidAnswer = (await rl.question(`  session_id [${sidDefault}]: `)).trim();
    if (sidAnswer) newConfig.session_id = sidAnswer;
    else if (existing.session_id) newConfig.session_id = existing.session_id;

    const projDefault = existing.project || "";
    const projAnswer = (await rl.question(`  project [${projDefault || "default"}]: `)).trim();
    if (projAnswer) newConfig.project = projAnswer;
    else if (existing.project) newConfig.project = existing.project;

    // Server settings
    const existingServer = existing.server || {};
    console.log("\nServer settings (leave blank to keep default):");

    const dirDefault = existingServer.dir || "";
    const dirAnswer = (await rl.question(`  dir [${dirDefault || "~/.nodex"}]: `)).trim();
    if (dirAnswer) (newConfig.server ??= {}).dir = dirAnswer;
    else if (existingServer.dir) (newConfig.server ??= {}).dir = existingServer.dir;

    const portDefault = existingServer.port;
    const portAnswer = (await rl.question(`  port [${portDefault ?? 51283}]: `)).trim();
    if (portAnswer) (newConfig.server ??= {}).port = parseInt(portAnswer, 10);
    else if (existingServer.port !== undefined) (newConfig.server ??= {}).port = existingServer.port;

    const backupAutoDefault = existingServer.backup_auto_enabled;
    const backupAutoAnswer = (await rl.question(`  backup_auto_enabled [${backupAutoDefault ?? false}]: `)).trim();
    if (backupAutoAnswer) (newConfig.server ??= {}).backup_auto_enabled = backupAutoAnswer === "true" || backupAutoAnswer === "1";
    else if (existingServer.backup_auto_enabled !== undefined) (newConfig.server ??= {}).backup_auto_enabled = existingServer.backup_auto_enabled;

    const backupIntervalDefault = existingServer.backup_interval_hours;
    const backupIntervalAnswer = (await rl.question(`  backup_interval_hours [${backupIntervalDefault ?? 6}]: `)).trim();
    if (backupIntervalAnswer) (newConfig.server ??= {}).backup_interval_hours = parseInt(backupIntervalAnswer, 10);
    else if (existingServer.backup_interval_hours !== undefined) (newConfig.server ??= {}).backup_interval_hours = existingServer.backup_interval_hours;

    const backupRetentionDefault = existingServer.backup_retention;
    const backupRetentionAnswer = (await rl.question(`  backup_retention [${backupRetentionDefault ?? 28}]: `)).trim();
    if (backupRetentionAnswer) (newConfig.server ??= {}).backup_retention = parseInt(backupRetentionAnswer, 10);
    else if (existingServer.backup_retention !== undefined) (newConfig.server ??= {}).backup_retention = existingServer.backup_retention;

    const historyRetentionDefault = existingServer.history_retention;
    const historyRetentionAnswer = (await rl.question(`  history_retention [${historyRetentionDefault ?? 1000}]: `)).trim();
    if (historyRetentionAnswer) (newConfig.server ??= {}).history_retention = parseInt(historyRetentionAnswer, 10);
    else if (existingServer.history_retention !== undefined) (newConfig.server ??= {}).history_retention = existingServer.history_retention;

    // Write file
    const targetDir = dirname(targetPath);
    if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });

    const header = "# Nodex configuration\n";
    writeFileSync(targetPath, header + TOML.stringify(newConfig), "utf8");
    console.log(`\nSaved ${formatSource(targetPath)}`);
  } finally {
    rl.close();
  }
}

async function cmdConfig(positional, flags) {
  if (positional[0] && positional[0] !== "show") {
    throw new Error(`Unknown config subcommand: ${positional[0]}. Valid: show`);
  }
  if (positional[0] === "show" || flags.json) {
    cmdConfigShow(flags);
    return;
  }
  await cmdConfigInteractive();
}

// ─── Help ───

function printMainHelp() {
  console.log(`Usage: nodex <command> [args] [options]

Server:
  nodex                          Start server (default)
  nodex serve [path] [-p port]   Start server explicitly

Project Commands:
  nodex projects                       List all projects
  nodex projects add <id> <name>       Create a project
  nodex projects mv <old-id> <new-id>  Rename a project
  nodex projects rm <id>               Delete a project

Config:
  nodex config                   Edit config interactively
  nodex config show              Show resolved config with sources

Agent Commands:
  nodex ls [status]              List Pages
  nodex get <page-id>            Get Page details
  nodex add <status> <title>     Create a Page
  nodex update <page-id>         Update a Page
  nodex block <action> [target]  Apply/export stable-ID Document operations
  nodex database <action> <id>   Query/mutate a Database by stable IDs
  nodex rm <page-id>             Delete a Page
  nodex mv <page-id> <from> <to> Move a Page (supports update opts)
  nodex history <page-id>        View a Page's durable history
  nodex query "<sql>" [params]   Run SQL query
  nodex schema                   Show DB schema
  nodex backups                  List backups / create / restore
  Aliases: list/show/create/remove/delete/move/hist

Global Options:
  -p, --project <id>  Project to operate on (default: "default")
  --url <url>          Server URL (default: http://localhost:51283)
  --session-id <id> Client session identity for exact mutation audit
  --json            Output JSON array/object
  --jsonl           Output JSON Lines (default)
  --csv             Output CSV
  --pretty          Pretty-print JSON output
  --table           Output aligned table text
  -v, --verbose     Verbose output (e.g. full Page after update)
  -h, --help        Show help

Config: .nodex/config.toml (CWD walk-up, then ~/.nodex/config.toml)
  url = "http://localhost:51283"
  session_id = "my-session"
  project = "default"
  [server]
  dir = "~/.nodex"
  port = 51283

Env vars: NODEX_URL, NODEX_SESSION_ID, NODEX_PROJECT
Server env vars: NODEX_DIR, NODEX_PORT, NODEX_BACKUP_*

File Input: Use @filepath or @- for stdin
  nodex add backlog "Task" -d @./plan.md
  cat notes.md | nodex add backlog "Task" -d @-`);
}

function printCommandHelp(cmd) {
  const help = {
    ls: `Usage: nodex ls [status] [options]

  List Pages. Without a status, lists all Pages across all workflow statuses.
  Status accepts canonical ids plus ergonomic separators: draft, backlog, in_progress/in-progress, in_review/in-review, done.

  Options:
    -p, --project <id>  Project (default: "default")
    --priority <p>    Filter by priority
    --assignee <name> Filter by assignee
    --limit <n>       Limit results
    --offset <n>      Skip first n results
    --full            Include full Page fields
    --description-chars <n>  Truncate description to n chars (requires --full)
    --description-full       Include full description (requires --full)
    --jsonl           JSON Lines output (default)
    --json            JSON array output
    --csv             CSV output
    --table           Print aligned text table`,

    get: `Usage: nodex get <page-id>

  Get detailed Page info. Status is auto-resolved.
  Default output format is JSON Lines.`,

    add: `Usage: nodex add <status> <title> [options]

  Create a new Page. Status accepts canonical ids plus ergonomic separators.

  Options:
    -p, --project <id>        Project (default: "default")
    -d, --description <text>  Description (supports @file/@-)
    -P, --priority <p>        Priority: p0-critical..p4-later
    -e, --estimate <e>        Estimate: xs, s, m, l, xl
    -t, --tags <t1,t2>        Comma-separated tags
    -a, --assignee <name>     Assignee
    --due <YYYY-MM-DD>        Due date
    --page-id <id>            Stable Page identity (required with --mutation-id)
    --mutation-id <id>        Stable operation identity; retry with the same --page-id
    --jsonl                   JSON Lines output (default)
    --json                    JSON object output
    --csv                     CSV output
    --table                   Print aligned text table`,

    update: `Usage: nodex update <page-id> [options]

  Update Page properties. Status is auto-resolved.
  Default output: updated,<page-id> (minimal). Use -v for full details.

  Options:
    -p, --project <id>          Project (default: "default")
    --title <text>              New title
    -d, --description <text>    Description (supports @file/@-)
    -P, --priority <p>          Priority
    -e, --estimate <e>          Estimate
    -t, --tags <t1,t2>          Tags
    -a, --assignee <name>       Assignee
    --due <YYYY-MM-DD>          Due date
    --clear-description         Clear description
    --clear-tags                Clear tags
    --clear-assignee            Clear assignee
    --clear-due                 Clear due date
    --mutation-id <id>          Stable exact-retry identity for title/body changes
    --expected-head <seq>       Explicit Document CAS head for exact retry
    -v, --verbose               Show full Page details
    --jsonl                     JSON Lines output (default)
    --json                      JSON object output
    --csv                       CSV output
    --table                     Print aligned text table`,

    block: `Usage: nodex block <action> [target] [value] [options]

  Operate on the Page's Y.Doc through stable application Block IDs.

  Actions:
    descriptor                 Print the current Document id/epoch/generation/head
    export                     Export current title and NFM projection
    apply <json|@file|@->      Apply an ordered stable-ID operation array
    replace <nfm|@file|@->     Explicit CAS-gated whole-body NFM import
    title <text|@file|@->      Replace the collaborative title
    command <json|@file|@->    Run a synced/template/large Document command

  The command form accepts the canonical logical command envelope. Nodex binds
  the selected Project and trusted audit identity before execution; use the same
  operationId and logical intent to recover an exact retry.

  Options:
    -p, --project <id>         Project (default: "default")
    --mutation-id <id>         Stable identity; reuse with the original head after response loss
    --expected-head <seq>      Explicit current-head CAS (read it with descriptor)
    --jsonl                    JSON Lines output (default)
    --json                     JSON object output
    --csv                      CSV output
    --table                    Print aligned text table`,

    database: `Usage: nodex database <action> [stable-id] [value] [options]

  Operate on general Databases and Views using stable application identities.

  Actions:
    catalog                        List Databases and owning membership counts
    descriptor <database-id>       Read schema, Views, store epoch, and cursor
    query <view-id>                Evaluate the View's durable nested filter/sort/group
    members <database-id>          List the Database's current Page memberships
    membership <page-id> <database-id|none> [view-id]
                                   Add, transfer, or remove the Page membership
    view-update <view-id> <json|@file|@->
                                   Update the selected durable View using exact revision CAS
    apply <database-id> <json|@file|@->
                                   Atomically apply a bounded operation array

  An apply value may also be a full request envelope. The operation ID, Project,
  store epoch, and operation intent are retained for exact retries; the local
  host derives trusted audit attribution for every transport.
  Rank keys are never accepted; use beforeBlockId/beforePropertyId/beforeViewId/
  beforePageId logical anchors.

  Options:
    -p, --project <id>             Project (default: "default")
    --mutation-id <id>             Stable exact-retry identity for array input
    --jsonl                        JSON Lines output (default)
    --json                         JSON object output
    --csv                          CSV output
    --table                        Print aligned text table`,

    rm: `Usage: nodex rm <page-id>

  Delete a Page. Status is auto-resolved.

  Options:
    --mutation-id <id>        Stable exact-retry identity for deletion`,

    mv: `Usage: nodex mv <page-id> <from-status> <to-status> [order] [opts]

  Move a Page from one workflow status to another. Fails if the Page is no longer in <from-status>
  (e.g. already claimed by another agent). Order defaults to end of the target status.

  Options:
    -p, --project <id>          Project (default: "default")
    --title <text>              New title
    -d, --description <text>    Description (supports @file/@-)
    -P, --priority <p>          Priority
    -e, --estimate <e>          Estimate
    -t, --tags <t1,t2>          Tags
    -a, --assignee <name>       Assignee
    --due <YYYY-MM-DD>          Due date
    --clear-description         Clear description
    --clear-tags                Clear tags
    --clear-assignee            Clear assignee
    --clear-due                 Clear due date
    --mutation-id <id>          Stable exact-retry identity for title/body changes
    --expected-head <seq>       Explicit Document CAS head for exact retry
    -v, --verbose               Show full Page details
    --jsonl                     JSON Lines output (default)
    --json                      JSON object output
    --csv                       CSV output
    --table                     Print aligned text table`,

    history: `Usage: nodex history <page-id> [options]

  Options:
    --page <id>                Alternate Page ID form
    --limit <n>                Page size from 1 to 100 (default: 50)
    --before-source <source>   Cursor source: document_version or change_log
    --before-occurred-at <ts>  Cursor timestamp from nextCursor
    --before-version-id <id>   Cursor version ID for document_version
    --before-change-seq <seq>  Cursor sequence for change_log
    --jsonl         JSON Lines output (default)
    --json          JSON object output
    --csv           CSV output
    --table         Print aligned text table`,

    query: `Usage: nodex query "<sql>" [param1] [param2] ...

  Execute a read-only SQL query. Parameters replace ? placeholders.
  Default output format is JSON Lines.
  Example: nodex query "SELECT * FROM blocks WHERE type = ?" page
  Use --table for aligned text output.`,

    schema: `Usage: nodex schema

  Show database table schema.
  Default output format is JSON Lines.
  Use --table for aligned text output.`,

    backups: `Usage: nodex backups [subcommand]

  Manage whole-store backups.

  Subcommands:
    nodex backups
      List backups
    nodex backups create [--label <text>]
      Create a manual backup
    nodex backups restore <backup-id> --yes [--no-safety-backup]
      Restore a backup (creates pre-restore safety backup by default)

  Options:
    --label <text>       Optional backup label (create)
    --yes                Required confirmation for restore
    --no-safety-backup   Skip automatic pre-restore safety backup`,

    serve: `Usage: nodex serve [local-store-path] [options]

  Start the Nodex server.

  Options:
    -p, --port <port>   Port (default: 51283)
    --dev               Development mode

  Settings resolved: defaults → config.toml [server] → env vars → CLI flags
  Use .nodex/config.toml in project dir to separate dev/production config.`,

    projects: `Usage: nodex projects [subcommand]

  Manage projects.

  Subcommands:
    nodex projects                          List all projects
    nodex projects add <id> <name>          Create a project
    nodex projects mv <old-id> <new-id>     Rename a project (updates all references)
    nodex projects rm <id>                  Delete a project (and all its data)

  Options:
    -d, --description <text>  Project description (for add/mv)
    -n, --name <name>         Project display name (for mv)`,

    config: `Usage: nodex config [show] [options]

  View or edit Nodex configuration interactively.

  Subcommands:
    nodex config         Interactive config editor
    nodex config show    Display resolved config with sources

  Options:
    --json                Output config as JSON (with show)

  Config resolution (lowest to highest priority):
    1. Defaults
    2. User-level:    ~/.nodex/config.toml
    3. Project-level: .nodex/config.toml (walked up from CWD)
    4. Env vars:      NODEX_URL, NODEX_SESSION_ID, NODEX_PROJECT
                      NODEX_DIR, NODEX_PORT, NODEX_BACKUP_*
    5. CLI flags:     --url, --session-id, --project, --port, [path]

  Use [server] section for dir, port, backup settings.
  Project-level config overrides user-level (useful for dev/production split).`,
  };

  console.log(help[cmd] || `Unknown command: ${cmd}. Run 'nodex help' for usage.`);
}

// ─── Singleton Check ───

function isPortInUse(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => { resolve(false); });
  });
}

// ─── Server Start (existing nodex logic) ───

function parseServeArgs(args) {
  const result = { path: null, port: null, dev: false };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      printCommandHelp("serve");
      process.exit(0);
    }
    if (arg === "--port" || arg === "-p") {
      const next = args[i + 1];
      if (!next || next.startsWith("-")) {
        console.error("Error: --port requires a value");
        process.exit(1);
      }
      result.port = parseInt(next, 10);
      i += 1;
      if (isNaN(result.port)) {
        console.error("Error: Invalid port number");
        process.exit(1);
      }
      continue;
    }
    if (arg === "--dev") {
      result.dev = true;
      continue;
    }
    if (!arg.startsWith("-") && !result.path) {
      result.path = arg;
      continue;
    }

    if (arg.startsWith("-")) {
      console.error(`Error: Unknown option for serve: ${arg}`);
      process.exit(1);
    }
  }

  // Resolution: CLI flag → env → TOML (user + project) → default
  const serverCfg = loadServerConfig();
  if (!result.path) {
    result.path = serverCfg.dir ? expandTilde(serverCfg.dir) : join(homedir(), ".nodex");
  }
  if (result.port === null) {
    result.port = typeof serverCfg.port === "number" ? serverCfg.port : 51283;
  }

  return result;
}

async function cmdServe(args) {
  const serveArgs = parseServeArgs(args);

  if (await isPortInUse(serveArgs.port)) {
    console.error(
      `Nodex is already running on port ${serveArgs.port}.\n` +
      `  Use -p <port> to start on a different port.`
    );
    process.exit(1);
  }

  const localStoreDir = resolve(process.cwd(), serveArgs.path);

  if (!existsSync(localStoreDir)) {
    console.log(`Creating local store directory: ${localStoreDir}`);
    mkdirSync(localStoreDir, { recursive: true });
  }

  const packageRoot = resolve(__dirname, "..");

  console.log(`Starting Nodex...`);
  console.log(`  Local store directory: ${localStoreDir}`);
  console.log(`  Port: ${serveArgs.port}`);
  console.log(`  Mode: ${serveArgs.dev ? "development" : "production"}`);

  // Pass all resolved server settings as env vars to the Electron child.
  // The CLI does CWD walk-up for project-level config; the child process can't
  // reliably do that since its cwd is set to packageRoot.
  const serverCfg = loadServerConfig();
  const env = {
    ...process.env,
    NODEX_DIR: localStoreDir,
    NODEX_PORT: String(serveArgs.port),
  };
  if (serverCfg.backup_auto_enabled !== undefined && !process.env.NODEX_BACKUP_AUTO_ENABLED)
    env.NODEX_BACKUP_AUTO_ENABLED = String(serverCfg.backup_auto_enabled);
  if (serverCfg.backup_interval_hours !== undefined && !process.env.NODEX_BACKUP_INTERVAL_HOURS)
    env.NODEX_BACKUP_INTERVAL_HOURS = String(serverCfg.backup_interval_hours);
  if (serverCfg.backup_retention !== undefined && !process.env.NODEX_BACKUP_RETENTION)
    env.NODEX_BACKUP_RETENTION = String(serverCfg.backup_retention);
  if (serverCfg.history_retention !== undefined && !process.env.NODEX_HISTORY_RETENTION)
    env.NODEX_HISTORY_RETENTION = String(serverCfg.history_retention);

  let child;
  if (serveArgs.dev) {
    child = spawn("npx", ["electron-vite", "dev"], {
      cwd: packageRoot,
      env,
      stdio: "inherit",
    });
  } else {
    // Production: run the built Electron app
    const electronPath = resolve(packageRoot, "node_modules/.bin/electron");
    child = spawn(electronPath, [resolve(packageRoot, "out/main/bootstrap.js")], {
      cwd: packageRoot,
      env,
      stdio: "inherit",
    });
  }

  process.on("SIGINT", () => child.kill("SIGINT"));
  process.on("SIGTERM", () => child.kill("SIGTERM"));

  child.on("exit", (code) => {
    process.exit(code ?? 0);
  });
}

// ─── Main Dispatch ───

function isLikelyServeInvocation(argv) {
  const firstArg = argv[0];
  if (!firstArg) return false;
  if (firstArg.startsWith("-")) return true;
  if (firstArg === "." || firstArg === ".." || firstArg.startsWith("~")) return true;
  return existsSync(resolve(process.cwd(), firstArg));
}

async function main() {
  const argv = process.argv.slice(2);

  // No args → start server
  if (argv.length === 0) {
    await cmdServe([]);
    return;
  }

  const firstArg = argv[0];

  // Global help
  if (firstArg === "--help" || firstArg === "-h") {
    printMainHelp();
    return;
  }

  const subcommand = resolveSubcommand(firstArg);

  // Backward-compatible: allow `nodex <path>` / `nodex -p 1234` for serve mode
  if (!subcommand) {
    if (isLikelyServeInvocation(argv)) {
      await cmdServe(argv);
      return;
    }
    const known = Array.from(new Set([...COMMANDS, ...SUBCOMMAND_ALIASES.keys()]));
    const suggestion = closestMatch(firstArg, known);
    const suffix = suggestion ? ` Did you mean "${suggestion}"?` : "";
    throw new Error(`Unknown command: ${firstArg}.${suffix} Run 'nodex help' for usage.`);
  }

  const restArgs = argv.slice(1);

  if (subcommand === "serve") {
    await cmdServe(restArgs);
    return;
  }

  const parsed = parseCliArgs(restArgs);
  validateCommandFlags(subcommand, parsed.flags);

  if (parsed.flags.help) {
    if (subcommand === "help") {
      if (parsed._[0]) {
        const target = resolveSubcommand(parsed._[0]) || parsed._[0];
        printCommandHelp(target);
      } else {
        printMainHelp();
      }
    } else {
      printCommandHelp(subcommand);
    }
    return;
  }

  if (subcommand === "help") {
    if (parsed._[0]) {
      const target = resolveSubcommand(parsed._[0]) || parsed._[0];
      printCommandHelp(target);
    } else {
      printMainHelp();
    }
    return;
  }

  const config = loadConfig(parsed.flags);
  BASE_URL = config.url;

  // Projects command doesn't need project config
  if (subcommand === "projects") {
    try {
      await cmdProjects(parsed._, parsed.flags);
    } catch (err) {
      process.stderr.write(`error: ${err.message}\n`);
      process.exit(1);
    }
    return;
  }

  // Config command — purely local, no server needed
  if (subcommand === "config") {
    try {
      await cmdConfig(parsed._, parsed.flags);
    } catch (err) {
      process.stderr.write(`error: ${err.message}\n`);
      process.exit(1);
    }
    return;
  }

  assertValidProjectId(config.project);

  const commands = {
    ls: cmdLs,
    get: cmdGet,
    add: cmdAdd,
    update: cmdUpdate,
    rm: cmdRm,
    mv: cmdMv,
    block: cmdBlock,
    database: cmdDatabase,
    history: cmdHistory,
    query: cmdQuery,
    schema: cmdSchema,
    backups: cmdBackups,
  };

  try {
    await commands[subcommand](parsed._, parsed.flags, config);
  } catch (err) {
    process.stderr.write(`error: ${err.message}\n`);
    process.exit(1);
  }
}

main().catch((err) => {
  process.stderr.write(`error: ${err.message}\n`);
  process.exit(1);
});
