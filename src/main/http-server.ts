import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { randomUUID } from "node:crypto";
import * as backupService from "./local-store/backups";
import * as boardReadModel from "./local-store/board-read-model";
import * as cardOccurrences from "./local-store/card-occurrences";
import * as cardsStore from "./local-store/cards";
import { getDb } from "./local-store/database";
import { readCardMetadataPropertySnapshot } from "./local-store/card-metadata-property-snapshot";
import { readCardDetailCommand } from "./card-detail-boundary";
import * as projectSessionService from "./local-store/project-sessions";
import * as projectsStore from "./local-store/projects";
import * as sqlInspection from "./local-store/sql-inspection";
import {
  getBackupSettings,
  getHistorySettings,
  getTelemetrySettings,
  getThreadNotificationSettings,
  updateBackupSettings,
  updateHistorySettings,
  updateTelemetrySettings,
  updateThreadNotificationSettings,
} from "./local-store/config";
import { dbNotifier } from "./local-store/notifier";
import { blockMutationWriter } from "./block-mutation-writer";
import { projectDeletionRuntime } from "./project-deletion-runtime";
import {
  checkoutGitBranch,
  createAndCheckoutGitBranch,
  readGitBranchState,
} from "./git-branch-service";
import type {
  CardOccurrenceActionInput,
  CardOccurrenceCompleteInput,
  CardOccurrenceUpdateInput,
  CardSearchInput,
  DatabaseRowsDetailsInput,
} from "../shared/types";
import {
  CARD_DOCUMENT_MUTATION_REQUIRED_MESSAGE,
} from "../shared/card-content-authority";
import { MAX_CARD_WRITE_BODY_BYTES } from "../shared/card-limits";
import {
  MAX_IMAGE_UPLOAD_BYTES,
  MAX_RESOURCE_UPLOAD_BYTES,
  readAssetFile,
  resolveAssetPath,
  materializeLocalResource,
  saveUploadedResource,
  saveUploadedImage,
  isSupportedImageMimeType,
} from "./local-store/assets";
import { parseAssetSource } from "../shared/assets";
import { getLogger } from "./logging/logger";
import {
  HttpCardBodySchema,
  parseOptionalCardStatus,
} from "../shared/schemas/http";
import {
  ProjectOrderInputSchema,
  ProjectPinnedInputSchema,
  ProjectPinnedOrderInputSchema,
} from "../shared/schemas/projects";
import { codexService } from "./codex/codex-service";
import {
  CodexSidebarChatsThreadOrderInputSchema,
  CodexSidebarProjectThreadOrderInputSchema,
  CodexSidebarThreadMoveInputSchema,
} from "../shared/codex-sidebar-thread-move";
import { renameProjectSessionChat } from "./project-session-rename-service";
import { registerDocumentSyncHttpRoutes } from "./document-sync-http";
import { documentSyncHub } from "./document-sync-runtime";
import { registerReferenceReadHttpRoutes } from "./reference-read-http";
import { registerBlockPropertyMutationHttpRoute } from "./block-property-mutation-http";
import { registerDatabaseKernelHttpRoutes } from "./database-kernel-http";
import { registerDocumentMutationHttpRoute } from "./document-operation-http";
import { registerAdditionalDocumentCommandHttpRoute } from "./additional-document-command-http";
import { registerDocumentHistoryHttpRoutes } from "./document-history-http";
import {
  registerCardLifecycleHttpRoute,
  registerCardLifecyclePreflightHttpRoute,
} from "./card-lifecycle-http";
import { registerCardHistoryHttpRoute } from "./card-history-http";
import { registerCardMetadataPropertySnapshotHttpRoute } from "./card-metadata-property-snapshot-http";
import { registerCardProjectTransferHttpRoute } from "./card-project-transfer-http";
import { registerBlockTransferHttpRoute } from "./block-transfer-http";
import {
  readProjectScopedDatabaseViewReference,
  resolveProjectScopedCardTarget,
} from "./local-store/reference-reads";
import {
  deleteProjectSessionTabWithBrowserCleanup,
  deleteProjectSessionWithBrowserCleanup,
  deleteProjectWithBrowserCleanup,
  type ProjectSessionBrowserRuntime,
} from "./project-session-browser-ownership";

/** SSE keep-alive ping interval (ms) */
const SSE_PING_INTERVAL_MS = 30_000;

const app = new Hono();
const LOOPBACK_HOST = "127.0.0.1";
const MUTATING_HTTP_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const LEGACY_PROJECT_FIELDS = ["id", "newId", "workspacePath", "aliases"] as const;
const TRUSTED_BROWSER_ORIGINS = new Set([
  "http://localhost:51284",
  "http://127.0.0.1:51284",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);
const cardWriteBodyLimit = bodyLimit({
  maxSize: MAX_CARD_WRITE_BODY_BYTES,
  onError: (c) =>
    c.json(
      { error: `Card payload exceeds ${(MAX_CARD_WRITE_BODY_BYTES / (1024 * 1024)).toFixed(0)}MB limit` },
      413,
    ),
});
const logger = getLogger({ subsystem: "http" });
const SLOW_HTTP_REQUEST_MS = 1_000;

export function resolveHttpRequestLogLevel(
  status: number,
  durationMs: number,
): "debug" | "info" | "warn" | "error" {
  if (status >= 500) return "error";
  if (status >= 400) return "warn";
  if (durationMs >= SLOW_HTTP_REQUEST_MS) return "info";
  return "debug";
}

function approximatePayloadBytes(value: unknown): number | null {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return null;
  }
}

function boardCardCount(board: { columns: Array<{ cards: unknown[] }> }): number {
  return board.columns.reduce((sum, column) => sum + column.cards.length, 0);
}

interface HttpServerDependencies {
  browserRuntime: ProjectSessionBrowserRuntime;
  transcribeDictation: (input: { contentType: string; base64Payload: string }) => Promise<string>;
}

const defaultHttpServerDependencies: HttpServerDependencies = {
  browserRuntime: {
    closeBrowserConversation: async (browserConversationId) => {
      const { browserSidebarService } = await import("./browser-sidebar-service");
      browserSidebarService.closeBrowserConversation(browserConversationId);
    },
    closeBrowserProject: async (projectId) => {
      const { browserSidebarService } = await import("./browser-sidebar-service");
      browserSidebarService.closeBrowserProject(projectId);
    },
    closeBrowserTab: async (identity) => {
      const { browserSidebarService } = await import("./browser-sidebar-service");
      browserSidebarService.closeBrowserTab(identity);
    },
  },
  transcribeDictation: async (input) => await codexService.transcribeDictation(input),
};

let httpServerDependencies: HttpServerDependencies = defaultHttpServerDependencies;

function getLegacyProjectField(body: unknown): string | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;
  return LEGACY_PROJECT_FIELDS.find((field) => Object.prototype.hasOwnProperty.call(record, field)) ?? null;
}

function isTrustedBrowserOrigin(originHeader: string | undefined): boolean {
  if (!originHeader || originHeader.trim().length === 0) return false;

  try {
    const normalized = new URL(originHeader).origin;
    return TRUSTED_BROWSER_ORIGINS.has(normalized);
  } catch {
    return false;
  }
}

function getRequestLogFields(c: Context, requestId: string, startedAt: number): Record<string, unknown> {
  return {
    requestId,
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    durationMs: Date.now() - startedAt,
    origin: c.req.header("origin") ?? null,
  };
}

function withTrustedBrowserCors(origin: string | undefined, response: Response): Response {
  if (!origin || !isTrustedBrowserOrigin(origin)) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.append("Vary", "Origin");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

app.use("*", async (c, next) => {
  const requestId = randomUUID();
  const startedAt = Date.now();

  c.header("x-nodex-request-id", requestId);
  await next();

  const fields = getRequestLogFields(c, requestId, startedAt);
  const durationMs = typeof fields.durationMs === "number" ? fields.durationMs : 0;
  const level = resolveHttpRequestLogLevel(c.res.status, durationMs);

  if (level === "error") {
    logger.error("HTTP request completed with server error", fields);
    return;
  }
  if (level === "warn") {
    logger.warn("HTTP request completed with client error", fields);
    return;
  }
  if (level === "info") {
    logger.info("Slow HTTP request completed", fields);
    return;
  }
  logger.debug("HTTP request completed", fields);
});

// Reject browser-originated write requests unless they come from a trusted local dev origin.
app.use("*", async (c, next) => {
  const origin = c.req.header("origin");
  if (!origin || !MUTATING_HTTP_METHODS.has(c.req.method)) {
    await next();
    return;
  }
  if (isTrustedBrowserOrigin(origin)) {
    await next();
    return;
  }
  return c.json({ error: "Forbidden origin" }, 403);
});

// Only emit CORS headers for trusted local dev browser origins.
app.use("*", cors({
  origin: (origin) => (isTrustedBrowserOrigin(origin) ? origin : null),
}));

app.onError((error, c) => {
  logger.error("HTTP request failed", {
    requestId: c.res.headers.get("x-nodex-request-id") ?? null,
    method: c.req.method,
    path: c.req.path,
    origin: c.req.header("origin") ?? null,
    error,
  });
  return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
});

registerDocumentSyncHttpRoutes(app, {
  hub: documentSyncHub,
  getDocumentProjectId: (documentId) =>
    blockMutationWriter.getBlockDocumentProjectId(documentId),
  getOwnedDocumentDescriptor: async (projectId, ownerBlockId) =>
    (await blockMutationWriter.getOwnedDocumentDescriptor(
      projectId,
      ownerBlockId,
    )).result,
  prepareOwnedBlockDocument: async (projectId, ownerBlockId) =>
    await blockMutationWriter.prepareOwnedBlockDocument(
      projectId,
      ownerBlockId,
    ),
});

registerReferenceReadHttpRoutes(app, {
  resolveCardTarget: resolveProjectScopedCardTarget,
  readDatabaseViewReference: readProjectScopedDatabaseViewReference,
});

registerBlockPropertyMutationHttpRoute(app, {
  applyMutation: async (request) =>
    (await blockMutationWriter.applyBlockPropertyMutation(request)).result,
});

registerCardMetadataPropertySnapshotHttpRoute(app, {
  readSnapshot: (projectId, cardBlockId) =>
    readCardMetadataPropertySnapshot(getDb(), projectId, cardBlockId),
});

registerDatabaseKernelHttpRoutes(app, {
  applyMutation: async (request) =>
    (await blockMutationWriter.applyDatabaseMutation(request)).result,
  readDescriptor: async (projectId, databaseBlockId) =>
    (
      await blockMutationWriter.readDatabaseDescriptor(
        projectId,
        databaseBlockId,
      )
    ).result,
  readCatalog: async (projectId) =>
    (await blockMutationWriter.readDatabaseCatalog(projectId)).result,
  readManagement: async (projectId) =>
    (await blockMutationWriter.readDatabaseManagement(projectId)).result,
  readPrimaryDescriptor: async (projectId) =>
    (await blockMutationWriter.readPrimaryDatabaseDescriptor(projectId)).result,
  readPrimaryViewSnapshot: async (projectId) =>
    (await blockMutationWriter.readPrimaryDatabaseViewSnapshot(projectId))
      .result,
  readViewSnapshot: async (projectId, viewId) =>
    (await blockMutationWriter.readDatabaseViewSnapshot(projectId, viewId))
      .result,
  queryView: async (projectId, viewId) =>
    (await blockMutationWriter.queryDatabaseView(projectId, viewId)).result,
});

registerCardLifecyclePreflightHttpRoute(app, {
  readPreflight: async (projectId, cardId) =>
    (await blockMutationWriter.readCardLifecyclePreflight(projectId, cardId))
      .result,
});

registerCardLifecycleHttpRoute(app, {
  applyMutation: async (request) =>
    (await blockMutationWriter.applyCardLifecycleMutation(request)).result,
});

registerDocumentMutationHttpRoute(app, {
  applyMutation: (request) => documentSyncHub.applyDocumentMutation(request),
});

registerAdditionalDocumentCommandHttpRoute(app, {
  applyCommand: (request) =>
    documentSyncHub.applyAdditionalDocumentCommand(request),
});

registerCardProjectTransferHttpRoute(app, {
  transfer: (intent) => documentSyncHub.transferCardProject(intent),
});

registerBlockTransferHttpRoute(app, {
  transfer: (intent) => documentSyncHub.transferBlocks(intent),
});

registerDocumentHistoryHttpRoutes(app, {
  createCheckpoint: (request) =>
    blockMutationWriter.createDocumentVersionCheckpoint(request),
  listVersions: (request) => blockMutationWriter.listDocumentVersions(request),
  getVersion: (request) => blockMutationWriter.getDocumentVersion(request),
  restoreVersion: (request) => documentSyncHub.applyDocumentMutation(request),
});

registerCardHistoryHttpRoute(app, {
  listHistory: (request) => blockMutationWriter.listCardHistory(request),
});

app.post(
  "/transcribe",
  bodyLimit({
    maxSize: MAX_RESOURCE_UPLOAD_BYTES,
    onError: (c) => c.json({ error: "Audio exceeds 64MB upload limit" }, 413),
  }),
  async (c) => {
    const contentType = c.req.header("content-type")?.trim() ?? "";
    if (contentType.length === 0) {
      return c.json({ error: "Missing Content-Type header" }, 400);
    }

    const base64Payload = (await c.req.text()).trim();
    if (base64Payload.length === 0) {
      return c.json({ error: "Missing transcription payload" }, 400);
    }

    try {
      const text = await httpServerDependencies.transcribeDictation({
        contentType,
        base64Payload,
      });
      return c.json({ text });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "Unable to transcribe audio" }, 502);
    }
  },
);

// === Backup routes ===

app.get("/api/backups", async (c) => {
  const backups = await backupService.listBackups();
  return c.json({ backups });
});

app.post("/api/backups", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  try {
    const backup = await backupService.createBackup({
      trigger: "manual",
      label: typeof body.label === "string" ? body.label : undefined,
    });
    return c.json(backup, 201);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

app.delete("/api/backups/:backupId", async (c) => {
  const backupId = c.req.param("backupId");

  try {
    const result = await backupService.deleteBackup(backupId);
    return c.json(result);
  } catch (err) {
    if (err instanceof backupService.InvalidBackupIdError) {
      return c.json({ error: err.message }, 400);
    }
    if (err instanceof backupService.BackupNotFoundError) {
      return c.json({ error: err.message }, 404);
    }
    return c.json({ error: (err as Error).message }, 500);
  }
});

app.post("/api/backups/:backupId/restore", async (c) => {
  const backupId = c.req.param("backupId");
  const body = await c.req.json().catch(() => ({}));
  if (body.confirm !== true) {
    return c.json({ error: "Restore requires confirm=true" }, 400);
  }

  try {
    const result = await backupService.restoreBackup({
      backupId,
      confirm: true,
      createSafetyBackup: body.createSafetyBackup !== false,
    });
    return c.json(result);
  } catch (err) {
    if (err instanceof backupService.InvalidBackupIdError) {
      return c.json({ error: err.message }, 400);
    }
    if (err instanceof backupService.BackupNotFoundError) {
      return c.json({ error: err.message }, 404);
    }
    return c.json({ error: (err as Error).message }, 500);
  }
});

// === Settings routes ===

app.get("/api/settings/backup", (c) => {
  return c.json(getBackupSettings());
});

app.put("/api/settings/backup", async (c) => {
  const body = await c.req.json().catch(() => ({}));

  try {
    const settings = updateBackupSettings({
      autoEnabled: body.autoEnabled,
      intervalHours: body.intervalHours,
      retentionCount: body.retentionCount,
    });
    backupService.configureAutoBackupScheduler({
      enabled: settings.autoEnabled,
      intervalHours: settings.intervalHours,
      retentionCount: settings.retentionCount,
    });
    return c.json(settings);
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

app.get("/api/settings/history", (c) => {
  return c.json(getHistorySettings());
});

app.put("/api/settings/history", async (c) => {
  const body = await c.req.json().catch(() => ({}));

  try {
    const settings = updateHistorySettings({
      retentionCount: body.retentionCount,
    });
    return c.json(settings);
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

app.get("/api/settings/telemetry", (c) => {
  return c.json(getTelemetrySettings());
});

app.put("/api/settings/telemetry", async (c) => {
  const body = await c.req.json().catch(() => ({}));

  try {
    const settings = updateTelemetrySettings({
      enabled: body.enabled,
      clientKey: body.clientKey,
      environment: body.environment,
      autoCaptureEnabled: body.autoCaptureEnabled,
    });
    return c.json(settings);
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

app.get("/api/settings/thread-notifications", (c) => {
  return c.json(getThreadNotificationSettings());
});

app.put("/api/settings/thread-notifications", async (c) => {
  const body = await c.req.json().catch(() => ({}));

  try {
    const settings = updateThreadNotificationSettings({
      turnMode: body.turnMode,
      permissionsEnabled: body.permissionsEnabled,
      questionsEnabled: body.questionsEnabled,
    });
    return c.json(settings);
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

// === Git routes ===

app.get("/api/git/branch", async (c) => {
  const cwd = c.req.query("cwd");
  if (!cwd) {
    return c.json({ error: "Missing cwd" }, 400);
  }

  try {
    const state = await readGitBranchState(cwd);
    return c.json(state);
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

app.post("/api/git/branch/checkout", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const cwd = typeof body.cwd === "string" ? body.cwd : "";
  const branch = typeof body.branch === "string" ? body.branch : "";

  try {
    const state = await checkoutGitBranch({ cwd, branch });
    return c.json(state);
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

app.post("/api/git/branch/create", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const cwd = typeof body.cwd === "string" ? body.cwd : "";
  const branch = typeof body.branch === "string" ? body.branch : "";

  try {
    const state = await createAndCheckoutGitBranch({ cwd, branch });
    return c.json(state);
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function assertValidIsoCalendarDate(fieldName: string, value: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(value);
  if (!match) return;

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);
  const probe = new Date(Date.UTC(year, month - 1, day));

  if (
    probe.getUTCFullYear() !== year
    || probe.getUTCMonth() !== month - 1
    || probe.getUTCDate() !== day
  ) {
    throw new Error(`Invalid ${fieldName} "${value}"`);
  }
}

function parseRequiredDate(fieldName: string, value: unknown): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value !== "string") throw new Error(`Invalid ${fieldName} value`);
  assertValidIsoCalendarDate(fieldName, value);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid ${fieldName} "${value}"`);
  }
  return parsed;
}

function parseOccurrenceOperationId(value: unknown): string {
  if (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    value === value.trim()
  ) {
    return value;
  }
  throw new Error("Missing or invalid operationId");
}

function parseOccurrenceCreatedCardId(value: unknown): string {
  if (typeof value === "string" && value.length > 0 && value === value.trim()) {
    return value;
  }
  throw new Error("Missing or invalid createdCardId");
}

function parseOccurrenceSource(
  value: unknown,
): CardOccurrenceActionInput["source"] {
  if (
    value === "calendar" ||
    value === "card-stage" ||
    value === "notification" ||
    value === "api"
  ) {
    return value;
  }
  throw new Error("Missing or invalid occurrence source");
}

function parseOccurrenceScope(
  value: unknown,
): CardOccurrenceUpdateInput["scope"] {
  if (value === "this" || value === "this-and-future" || value === "all") {
    return value;
  }
  throw new Error("Missing or invalid occurrence scope");
}

function normalizeCardBody(body: Record<string, unknown>): Record<string, unknown> {
  return HttpCardBodySchema.parse(body);
}

// === Project routes ===

app.get("/api/projects", (c) => {
  const projects = projectsStore.listProjects();
  return c.json({ projects });
});

app.post("/api/projects", async (c) => {
  const body = await c.req.json();
  try {
    const legacyField = getLegacyProjectField(body);
    if (legacyField) {
      return c.json({ error: `Unsupported legacy project field: ${legacyField}` }, 400);
    }
    const project = projectsStore.createProject({
      name: typeof body.name === "string" ? body.name : undefined,
      description: typeof body.description === "string" ? body.description : undefined,
      icon: typeof body.icon === "string" ? body.icon : undefined,
      sources: Array.isArray(body.sources) ? body.sources : undefined,
    });
    return c.json(project, 201);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.put("/api/projects/order", async (c) => {
  const body = await c.req.json();
  try {
    const projects = projectsStore.reorderProjects(ProjectOrderInputSchema.parse(body));
    return c.json({ projects });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.put("/api/projects/pinned-order", async (c) => {
  const body = await c.req.json();
  try {
    const projects = projectsStore.setPinnedProjectOrder(ProjectPinnedOrderInputSchema.parse(body));
    return c.json({ projects });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.get("/api/projects/:projectId", (c) => {
  const project = projectsStore.getProject(c.req.param("projectId"));
  if (!project) return c.json({ error: "Not found" }, 404);
  return c.json(project);
});

app.put("/api/projects/:projectId", async (c) => {
  const projectId = c.req.param("projectId");
  const body = await c.req.json();
  try {
    const legacyField = getLegacyProjectField(body);
    if (legacyField) {
      return c.json({ error: `Unsupported legacy project field: ${legacyField}` }, 400);
    }
    const result = projectsStore.updateProject(projectId, {
      name: typeof body.name === "string" ? body.name : undefined,
      description: typeof body.description === "string" ? body.description : undefined,
      icon: typeof body.icon === "string" ? body.icon : undefined,
      sources: Array.isArray(body.sources) ? body.sources : undefined,
    });
    if (!result) return c.json({ error: "Not found" }, 404);
    return c.json(result);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.put("/api/projects/:projectId/pinned", async (c) => {
  const body = await c.req.json();
  try {
    const result = projectsStore.setProjectPinned(
      c.req.param("projectId"),
      ProjectPinnedInputSchema.parse(body),
    );
    if (!result) return c.json({ error: "Not found" }, 404);
    return c.json(result);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.delete("/api/projects/:projectId", async (c) => {
  const success = await deleteProjectWithBrowserCleanup(
    c.req.param("projectId"),
    httpServerDependencies.browserRuntime,
    (projectId) => projectDeletionRuntime.deleteProject(projectId),
  );
  if (!success) return c.json({ error: "Not found" }, 404);
  return c.json({ success: true });
});

// === Project session routes ===

app.get("/api/projects/:projectId/sessions", (c) => {
  try {
    const includeArchived = c.req.query("includeArchived") === "true";
    const options = {
      includeArchived,
    };
    const sessions = c.req.query("summary") === "true"
      ? projectSessionService.listProjectSessionSummaries(c.req.param("projectId"), options)
      : projectSessionService.listProjectSessions(c.req.param("projectId"), options);
    return c.json({ sessions });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 404);
  }
});

app.get("/api/project-sessions/:sessionId", (c) => {
  const session = projectSessionService.getProjectSession(c.req.param("sessionId"));
  if (!session) return c.json({ error: "Not found" }, 404);
  return c.json(session);
});

app.post("/api/projects/:projectId/sessions", async (c) => {
  const projectId = c.req.param("projectId");
  const body = await c.req.json();
  try {
    const session = projectSessionService.createProjectSession({ ...body, projectId });
    dbNotifier.notifyProjectSessionsChanged(session.projectId, "create", session.id);
    return c.json(session, 201);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.put("/api/project-sessions/:sessionId", async (c) => {
  const body = await c.req.json();
  try {
    const sessionId = c.req.param("sessionId");
    const existing = projectSessionService.getProjectSession(sessionId);
    if (!existing) return c.json({ error: "Not found" }, 404);
    const session = projectSessionService.updateProjectSession(sessionId, body);
    if (!session) return c.json({ error: "Not found" }, 404);
    dbNotifier.notifyProjectSessionsChanged(session.projectId, "update", session.id);
    return c.json(session);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.put("/api/project-sessions/:sessionId/rename", async (c) => {
  const body = await c.req.json();
  try {
    const session = await renameProjectSessionChat(c.req.param("sessionId"), body, {
      getProjectSession: projectSessionService.getProjectSession,
      updateProjectSession: projectSessionService.updateProjectSession,
      setThreadName: (threadId, rawTitle) => codexService.setThreadName(threadId, rawTitle),
      notifyProjectSessionsChanged: (projectId, changeType, sessionId) => {
        dbNotifier.notifyProjectSessionsChanged(projectId, changeType, sessionId);
      },
    });
    if (!session) return c.json({ error: "Not found" }, 404);
    return c.json(session);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.put("/api/project-sessions/:sessionId/pinned", async (c) => {
  const body = await c.req.json();
  try {
    const session = projectSessionService.setProjectSessionPinned(c.req.param("sessionId"), body);
    if (!session) return c.json({ error: "Not found" }, 404);
    dbNotifier.notifyProjectSessionsChanged(session.projectId, "pin", session.id);
    return c.json(session);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.put("/api/projects/:projectId/sessions/pinned-order", async (c) => {
  const projectId = c.req.param("projectId");
  const body = await c.req.json();
  try {
    const sessions = projectSessionService.setPinnedProjectSessionOrder(projectId, body);
    const canonicalProjectId = sessions[0]?.projectId ?? projectsStore.getProject(projectId)?.id ?? projectId;
    dbNotifier.notifyProjectSessionsChanged(canonicalProjectId, "pin");
    return c.json({ sessions });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.put("/api/project-sessions/:sessionId/archive", async (c) => {
  const sessionId = c.req.param("sessionId");
  try {
    const existing = projectSessionService.getProjectSession(sessionId);
    if (!existing) return c.json({ error: "Not found" }, 404);
    if (existing.thread) {
      await codexService.archiveThread(existing.thread.threadId);
    }
    const session = projectSessionService.archiveProjectSession(sessionId);
    if (!session) return c.json({ error: "Not found" }, 404);
    dbNotifier.notifyProjectSessionsChanged(session.projectId, "archive", session.id);
    return c.json(session);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.put("/api/project-sessions/:sessionId/unarchive", async (c) => {
  const sessionId = c.req.param("sessionId");
  try {
    const existing = projectSessionService.getProjectSession(sessionId);
    if (!existing) return c.json({ error: "Not found" }, 404);
    if (existing.thread) {
      await codexService.unarchiveThread(existing.thread.threadId);
    }
    const session = projectSessionService.unarchiveProjectSession(sessionId);
    if (!session) return c.json({ error: "Not found" }, 404);
    dbNotifier.notifyProjectSessionsChanged(session.projectId, "unarchive", session.id);
    return c.json(session);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.put("/api/codex/threads/:threadId/archive", async (c) => {
  try {
    const success = await codexService.archiveThread(c.req.param("threadId"));
    return c.json({ success });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.put("/api/codex/threads/:threadId/unarchive", async (c) => {
  try {
    const thread = await codexService.unarchiveThread(c.req.param("threadId"));
    return c.json(thread);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.put("/api/codex/sidebar/thread-move", async (c) => {
  try {
    const input = CodexSidebarThreadMoveInputSchema.parse(await c.req.json());
    return c.json(await codexService.moveSidebarThread(input));
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});

app.put("/api/codex/sidebar/project-thread-order", async (c) => {
  try {
    const input = CodexSidebarProjectThreadOrderInputSchema.parse(await c.req.json());
    return c.json(await codexService.setSidebarProjectThreadOrder(input));
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});

app.put("/api/codex/sidebar/chats-thread-order", async (c) => {
  try {
    const input = CodexSidebarChatsThreadOrderInputSchema.parse(await c.req.json());
    return c.json(await codexService.setSidebarChatsThreadOrder(input));
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }
});

app.put("/api/project-sessions/:sessionId/unread", async (c) => {
  const body = await c.req.json();
  try {
    const session = projectSessionService.markProjectSessionUnread(c.req.param("sessionId"), body);
    if (!session) return c.json({ error: "Not found" }, 404);
    dbNotifier.notifyProjectSessionsChanged(session.projectId, "unread", session.id);
    return c.json(session);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.post("/api/project-sessions/:sessionId/fork", async (c) => {
  const body = await c.req.json();
  try {
    const result = await codexService.forkProjectSessionThread(c.req.param("sessionId"), body);
    if ("session" in result) {
      dbNotifier.notifyProjectSessionsChanged(result.session.projectId, "create", result.session.id);
    }
    return c.json(result, 201);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.put("/api/project-sessions/:sessionId/panels/:panelId", async (c) => {
  const body = await c.req.json();
  try {
    const panelId = c.req.param("panelId");
    if (panelId !== "right" && panelId !== "bottom") return c.json({ error: "Invalid panel" }, 400);
    const session = projectSessionService.updateProjectSessionPanel(c.req.param("sessionId"), panelId, body);
    if (!session) return c.json({ error: "Not found" }, 404);
    return c.json(session);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.post("/api/project-sessions/:sessionId/panels/:panelId/split", async (c) => {
  const body = await c.req.json();
  try {
    const panelId = c.req.param("panelId");
    if (panelId !== "right" && panelId !== "bottom") return c.json({ error: "Invalid panel" }, 400);
    const session = projectSessionService.splitProjectSessionPanelGroup({
      ...body,
      sessionId: c.req.param("sessionId"),
      panelId,
    });
    if (!session) return c.json({ error: "Not found" }, 404);
    return c.json(session);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.post("/api/project-sessions/:sessionId/panels/:panelId/ensure-right-leaf", async (c) => {
  const body = await c.req.json();
  try {
    const panelId = c.req.param("panelId");
    if (panelId !== "right" && panelId !== "bottom") return c.json({ error: "Invalid panel" }, 400);
    const result = projectSessionService.ensureProjectSessionPanelLeafToRight({
      ...body,
      sessionId: c.req.param("sessionId"),
      panelId,
    });
    if (!result) return c.json({ error: "Not found" }, 404);
    return c.json(result);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.post("/api/project-sessions/:sessionId/panels/:panelId/merge", async (c) => {
  const body = await c.req.json();
  try {
    const panelId = c.req.param("panelId");
    if (panelId !== "right" && panelId !== "bottom") return c.json({ error: "Invalid panel" }, 400);
    const session = projectSessionService.mergeProjectSessionPanelGroup({
      ...body,
      sessionId: c.req.param("sessionId"),
      panelId,
    });
    if (!session) return c.json({ error: "Not found" }, 404);
    return c.json(session);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.put("/api/project-sessions/:sessionId/panels/:panelId/active-group", async (c) => {
  const body = await c.req.json();
  try {
    const panelId = c.req.param("panelId");
    if (panelId !== "right" && panelId !== "bottom") return c.json({ error: "Invalid panel" }, 400);
    const session = projectSessionService.activateProjectSessionPanelGroup({
      ...body,
      sessionId: c.req.param("sessionId"),
      panelId,
    });
    if (!session) return c.json({ error: "Not found" }, 404);
    return c.json(session);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.put("/api/project-sessions/:sessionId/panels/:panelId/resize-group", async (c) => {
  const body = await c.req.json();
  try {
    const panelId = c.req.param("panelId");
    if (panelId !== "right" && panelId !== "bottom") return c.json({ error: "Invalid panel" }, 400);
    const session = projectSessionService.resizeProjectSessionPanelGroup({
      ...body,
      sessionId: c.req.param("sessionId"),
      panelId,
    });
    if (!session) return c.json({ error: "Not found" }, 404);
    return c.json(session);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.put("/api/project-sessions/:sessionId/panels/:panelId/maximized-group", async (c) => {
  const body = await c.req.json();
  try {
    const panelId = c.req.param("panelId");
    if (panelId !== "right" && panelId !== "bottom") return c.json({ error: "Invalid panel" }, 400);
    const session = projectSessionService.maximizeProjectSessionPanelGroup({
      ...body,
      sessionId: c.req.param("sessionId"),
      panelId,
    });
    if (!session) return c.json({ error: "Not found" }, 404);
    return c.json(session);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.delete("/api/project-sessions/:sessionId", async (c) => {
  try {
    const sessionId = c.req.param("sessionId");
    const existing = projectSessionService.getProjectSession(sessionId);
    const success = await deleteProjectSessionWithBrowserCleanup(
      sessionId,
      httpServerDependencies.browserRuntime,
    );
    if (!success) return c.json({ error: "Not found" }, 404);
    if (existing) {
      dbNotifier.notifyProjectSessionsChanged(existing.projectId, "delete", sessionId);
    }
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.put("/api/projects/:projectId/sessions/reorder", async (c) => {
  const projectId = c.req.param("projectId");
  const body = await c.req.json();
  try {
    const orderedSessionIds = Array.isArray(body.orderedSessionIds) ? body.orderedSessionIds : [];
    const sessions = projectSessionService.reorderProjectSessions(
      projectId,
      orderedSessionIds.filter((item: unknown): item is string => typeof item === "string"),
    );
    const canonicalProjectId = sessions[0]?.projectId ?? projectsStore.getProject(projectId)?.id ?? projectId;
    dbNotifier.notifyProjectSessionsChanged(canonicalProjectId, "reorder");
    return c.json({ sessions });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.post("/api/project-sessions/:sessionId/tabs", async (c) => {
  const sessionId = c.req.param("sessionId");
  const body = await c.req.json();
  try {
    const tab = projectSessionService.createProjectSessionTab({ ...body, sessionId });
    return c.json(tab, 201);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.put("/api/project-session-tabs/:tabId", async (c) => {
  const body = await c.req.json();
  try {
    const tab = projectSessionService.updateProjectSessionTab(c.req.param("tabId"), body);
    if (!tab) return c.json({ error: "Not found" }, 404);
    return c.json(tab);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.put("/api/project-session-tabs/:tabId/state", async (c) => {
  const body = await c.req.json();
  try {
    const tab = projectSessionService.updateProjectSessionTabState(
      c.req.param("tabId"),
      typeof body.stateKey === "number" ? body.stateKey : 0,
      body.state,
    );
    if (!tab) return c.json({ error: "Not found" }, 404);
    return c.json(tab);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.delete("/api/project-session-tabs/:tabId", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const rawPreserveEmptyLeafIds = typeof body === "object" && body !== null && "preserveEmptyLeafIds" in body
    ? body.preserveEmptyLeafIds
    : undefined;
  const preserveEmptyLeafIds = Array.isArray(rawPreserveEmptyLeafIds)
    ? rawPreserveEmptyLeafIds.filter((item: unknown): item is string => typeof item === "string")
    : undefined;
  const preferredActiveLeafId = typeof body === "object" && body !== null && "preferredActiveLeafId" in body
    ? typeof body.preferredActiveLeafId === "string"
      ? body.preferredActiveLeafId
      : body.preferredActiveLeafId === null
        ? null
        : undefined
    : undefined;
  const preferredActiveTabId = typeof body === "object" && body !== null && "preferredActiveTabId" in body
    ? typeof body.preferredActiveTabId === "string"
      ? body.preferredActiveTabId
      : body.preferredActiveTabId === null
        ? null
        : undefined
    : undefined;
  const success = await deleteProjectSessionTabWithBrowserCleanup({
    tabId: c.req.param("tabId"),
    preserveEmptyLeafIds,
    preferredActiveLeafId,
    preferredActiveTabId,
  }, httpServerDependencies.browserRuntime);
  if (!success) return c.json({ error: "Not found" }, 404);
  return c.json({ success: true });
});

app.put("/api/project-sessions/:sessionId/tabs/reorder", async (c) => {
  const sessionId = c.req.param("sessionId");
  const body = await c.req.json();
  try {
    const panelId = body.panelId === "bottom" ? "bottom" : "right";
    const orderedTabIds = Array.isArray(body.orderedTabIds) ? body.orderedTabIds : [];
    const session = projectSessionService.reorderProjectSessionTabs(
      {
        sessionId,
        panelId,
        leafId: typeof body.leafId === "string" ? body.leafId : undefined,
        orderedTabIds: orderedTabIds.filter((item: unknown): item is string => typeof item === "string"),
      },
    );
    if (!session) return c.json({ error: "Not found" }, 404);
    return c.json(session);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.put("/api/project-session-tabs/:tabId/move", async (c) => {
  const body = await c.req.json();
  try {
    const session = projectSessionService.moveProjectSessionTab({
      tabId: c.req.param("tabId"),
      targetPanelId: body.targetPanelId,
      targetLeafId: body.targetLeafId,
      targetIndex: body.targetIndex,
      preserveEmptyLeafIds: Array.isArray(body.preserveEmptyLeafIds)
        ? body.preserveEmptyLeafIds.filter((item: unknown): item is string => typeof item === "string")
        : undefined,
      splitTarget: body.splitTarget,
    });
    if (!session) return c.json({ error: "Not found" }, 404);
    return c.json(session);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.put("/api/project-sessions/:sessionId/thread", async (c) => {
  const sessionId = c.req.param("sessionId");
  const body = await c.req.json();
  try {
    const thread = projectSessionService.upsertProjectSessionThreadLink({ ...body, sessionId });
    dbNotifier.notifyProjectSessionsChanged(thread.projectId, "link", sessionId);
    return c.json(thread);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.delete("/api/project-sessions/:sessionId/thread", (c) => {
  const sessionId = c.req.param("sessionId");
  const existing = projectSessionService.getProjectSession(sessionId);
  const success = projectSessionService.detachProjectSessionThread(sessionId);
  if (success && existing) {
    dbNotifier.notifyProjectSessionsChanged(existing.projectId, "link", sessionId);
  }
  return c.json({ success });
});

// === Board routes ===

app.get("/api/projects/:projectId/board-summary", async (c) => {
  const startedAt = Date.now();
  const board = await boardReadModel.getBoardSummary(c.req.param("projectId"));
  logger.info("board summary payload served", {
    channel: "GET /api/projects/:projectId/board-summary",
    projectId: c.req.param("projectId"),
    cardCount: boardCardCount(board),
    approxPayloadBytes: approximatePayloadBytes(board),
    durationMs: Date.now() - startedAt,
  });
  return c.json(board);
});

app.post("/api/projects/:projectId/board", cardWriteBodyLimit, (c) =>
  c.json(
    {
      error:
        "Card creation moved to the authoritative Card lifecycle mutation endpoint",
    },
    410,
  ),
);

// === Asset routes ===

app.post("/api/assets/resolve-path", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const source = typeof body.source === "string" ? body.source : "";
  const parsed = parseAssetSource(source);
  if (!parsed) {
    return c.json({ path: null });
  }

  try {
    const path = resolveAssetPath(parsed.fileName);
    return c.json({ path });
  } catch {
    return c.json({ path: null });
  }
});

async function handleImageUpload(c: Context) {
  const body = await c.req.parseBody();
  const upload = body.file;
  if (!(upload instanceof File)) {
    return c.json({ error: "Missing image file" }, 400);
  }

  if (!isSupportedImageMimeType(upload.type)) {
    return c.json({ error: `Unsupported image type: ${upload.type || "unknown"}` }, 400);
  }

  try {
    const result = await saveUploadedImage(upload);
    return c.json({ source: result.source }, 201);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
}

async function handleResourceUpload(c: Context) {
  const contentType = c.req.header("content-type") ?? "";

  try {
    if (contentType.includes("application/json")) {
      const body = await c.req.json().catch(() => ({}));
      if (!isRecord(body) || typeof body.localPath !== "string") {
        return c.json({ error: "Missing localPath" }, 400);
      }

      const result = materializeLocalResource(body.localPath);
      return c.json({
        source: result.source,
        name: result.name,
        mimeType: result.mimeType,
        bytes: result.bytes,
      }, 201);
    }

    const body = await c.req.parseBody();
    const upload = body.file;
    if (!(upload instanceof File)) {
      return c.json({ error: "Missing resource file" }, 400);
    }

    const result = await saveUploadedResource(upload);
    return c.json({
      source: result.source,
      name: result.name,
      mimeType: result.mimeType,
      bytes: result.bytes,
    }, 201);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
}

app.post(
  "/api/assets/images",
  bodyLimit({
    maxSize: MAX_IMAGE_UPLOAD_BYTES,
    onError: (c) => c.json({ error: "Image exceeds 10MB upload limit" }, 413),
  }),
  async (c) => handleImageUpload(c),
);

app.post(
  "/api/assets/resources",
  bodyLimit({
    maxSize: MAX_RESOURCE_UPLOAD_BYTES,
    onError: (c) => c.json({ error: "Resource exceeds 64MB upload limit" }, 413),
  }),
  async (c) => handleResourceUpload(c),
);

app.get("/api/assets/:fileName", (c) => {
  const fileName = c.req.param("fileName");

  try {
    const { bytes, mimeType } = readAssetFile(fileName);
    return c.body(new Uint8Array(bytes), 200, {
      "Content-Type": mimeType,
      "Cache-Control": "public, max-age=31536000, immutable",
    });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 404);
  }
});

// === Card routes ===

app.get("/api/projects/:projectId/card", async (c) => {
  const projectId = c.req.param("projectId");
  const cardId = c.req.query("cardId");
  if (!cardId) return c.json({ error: "Missing cardId" }, 400);
  const result = readCardDetailCommand(projectId, cardId);
  if (result.ok) return c.json(result);
  if (result.error.code === "invalid_request") return c.json(result, 400);
  if (result.error.code === "card_not_found") return c.json(result, 404);
  if (result.error.code === "card_detail_corrupt") return c.json(result, 409);
  return c.json(result, 503);
});

app.get("/api/projects/:projectId/database-row", async (c) => {
  const projectId = c.req.param("projectId");
  const status = parseOptionalCardStatus(c.req.query("status") || undefined);
  const cardId = c.req.query("cardId");
  if (!cardId) return c.json({ error: "Missing cardId" }, 400);
  const result = await cardsStore.getDatabaseRowCard(
    projectId,
    cardId,
    status,
  );
  if (!result) return c.json({ error: "Not found" }, 404);
  return c.json(result);
});

app.post("/api/projects/:projectId/database-rows/details", async (c) => {
  const projectId = c.req.param("projectId");
  const startedAt = Date.now();
  const body = await c.req.json().catch(() => ({}));
  if (!isRecord(body) || !Array.isArray(body.cardIds)) {
    return c.json({ error: "Missing cardIds" }, 400);
  }
  const cardIds = body.cardIds.filter((cardId): cardId is string => typeof cardId === "string");
  const cards = await boardReadModel.getDatabaseRowsDetails(projectId, { cardIds } satisfies DatabaseRowsDetailsInput);
  logger.info("database row details payload served", {
    channel: "POST /api/projects/:projectId/database-rows/details",
    projectId,
    requestedCardCount: cardIds.length,
    cardCount: cards.length,
    approxPayloadBytes: approximatePayloadBytes(cards),
    durationMs: Date.now() - startedAt,
  });
  return c.json(cards);
});

app.post("/api/cards/search", async (c) => {
  const startedAt = Date.now();
  const body = await c.req.json().catch(() => ({}));
  if (!isRecord(body) || !Array.isArray(body.projectIds) || typeof body.query !== "string") {
    return c.json({ error: "Missing projectIds or query" }, 400);
  }
  const input: CardSearchInput = {
    projectIds: body.projectIds.filter((projectId): projectId is string => typeof projectId === "string"),
    query: body.query,
    limit: typeof body.limit === "number" ? body.limit : undefined,
  };
  const results = await boardReadModel.searchCards(input);
  logger.info("card search payload served", {
    channel: "POST /api/cards/search",
    projectCount: input.projectIds.length,
    resultCount: results.length,
    approxPayloadBytes: approximatePayloadBytes(results),
    durationMs: Date.now() - startedAt,
  });
  return c.json(results);
});

app.put("/api/projects/:projectId/card/description", cardWriteBodyLimit, (c) => {
  return c.json(
    {
      error: CARD_DOCUMENT_MUTATION_REQUIRED_MESSAGE,
      replacement:
        "POST /api/projects/:projectId/documents/:documentId/mutations",
    },
    410,
  );
});

app.delete("/api/projects/:projectId/card", async (c) => {
  return c.json(
    {
      error:
        "Card deletion moved to the authoritative Card lifecycle mutation endpoint",
    },
    410,
  );
});

app.get("/api/projects/:projectId/calendar/occurrences", async (c) => {
  const projectId = c.req.param("projectId");
  const startRaw = c.req.query("start");
  const endRaw = c.req.query("end");
  const searchQuery = c.req.query("search") || undefined;

  try {
    const start = parseRequiredDate("start", startRaw);
    const end = parseRequiredDate("end", endRaw);
    const occurrences = await cardOccurrences.listCalendarOccurrences(projectId, start, end, searchQuery);
    return c.json({ occurrences });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.post("/api/projects/:projectId/card-occurrence/complete", async (c) => {
  const projectId = c.req.param("projectId");
  const body = await c.req.json().catch(() => ({}));
  try {
    if (!isRecord(body)) throw new Error("Invalid request body");
    if (typeof body.cardId !== "string") throw new Error("Missing cardId");
    const input: CardOccurrenceCompleteInput = {
      operationId: parseOccurrenceOperationId(body.operationId),
      createdCardId: parseOccurrenceCreatedCardId(body.createdCardId),
      cardId: body.cardId,
      occurrenceStart: parseRequiredDate("occurrenceStart", body.occurrenceStart),
      source: parseOccurrenceSource(body.source),
    };
    const { result } = await blockMutationWriter.completeCardOccurrence(
      projectId,
      input,
      typeof body.sessionId === "string" ? body.sessionId : undefined,
    );
    if (!result.success) return c.json(result, 400);
    return c.json(result);
  } catch (err) {
    return c.json({ success: false, error: (err as Error).message }, 400);
  }
});

app.post("/api/projects/:projectId/card-occurrence/skip", async (c) => {
  const projectId = c.req.param("projectId");
  const body = await c.req.json().catch(() => ({}));
  try {
    if (!isRecord(body)) throw new Error("Invalid request body");
    if (typeof body.cardId !== "string") throw new Error("Missing cardId");
    const input: CardOccurrenceActionInput = {
      operationId: parseOccurrenceOperationId(body.operationId),
      cardId: body.cardId,
      occurrenceStart: parseRequiredDate("occurrenceStart", body.occurrenceStart),
      source: parseOccurrenceSource(body.source),
    };
    const { result } = await blockMutationWriter.skipCardOccurrence(
      projectId,
      input,
      typeof body.sessionId === "string" ? body.sessionId : undefined,
    );
    if (!result.success) return c.json(result, 400);
    return c.json(result);
  } catch (err) {
    return c.json({ success: false, error: (err as Error).message }, 400);
  }
});

app.put("/api/projects/:projectId/card-occurrence", cardWriteBodyLimit, async (c) => {
  const projectId = c.req.param("projectId");
  const body = await c.req.json().catch(() => ({}));
  try {
    if (!isRecord(body)) throw new Error("Invalid request body");
    if (typeof body.cardId !== "string") throw new Error("Missing cardId");
    if (typeof body.scope !== "string") throw new Error("Missing scope");
    if (!isRecord(body.updates)) throw new Error("Missing updates");
    const updates = normalizeCardBody(body.updates);
    const scope = parseOccurrenceScope(body.scope);
    if (scope === "all" && "createdCardId" in body) {
      throw new Error("Occurrence scope all must not include createdCardId");
    }
    const input: CardOccurrenceUpdateInput = {
      operationId: parseOccurrenceOperationId(body.operationId),
      cardId: body.cardId,
      occurrenceStart: parseRequiredDate("occurrenceStart", body.occurrenceStart),
      source: parseOccurrenceSource(body.source),
      scope,
      ...(scope === "all"
        ? {}
        : { createdCardId: parseOccurrenceCreatedCardId(body.createdCardId) }),
      updates: updates as CardOccurrenceUpdateInput["updates"],
    } as CardOccurrenceUpdateInput;
    const { result } = await blockMutationWriter.updateCardOccurrence(
      projectId,
      input,
      typeof body.sessionId === "string" ? body.sessionId : undefined,
    );
    if (!result.success) return c.json(result, 400);
    return c.json(result);
  } catch (err) {
    return c.json({ success: false, error: (err as Error).message }, 400);
  }
});

// === Column route ===

app.get("/api/projects/:projectId/column", async (c) => {
  const projectId = c.req.param("projectId");
  const columnId = parseOptionalCardStatus(c.req.query("id"));
  if (!columnId) return c.json({ error: "Missing id" }, 400);
  const column = await boardReadModel.readColumn(projectId, columnId);
  return c.json(column);
});

// === SSE events ===

app.get("/api/projects/events", (c) => {
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      const send = (data: string) => {
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      };

      send(JSON.stringify({ event: "connected" }));

      const handler = (event: { projectId?: string; changeType: string }) => {
        send(JSON.stringify({
          event: "projects-changed",
          projectId: event.projectId,
          changeType: event.changeType,
        }));
      };

      dbNotifier.on("projects-changed", handler);

      const pingInterval = setInterval(() => {
        try {
          send(JSON.stringify({ event: "ping" }));
        } catch {
          clearInterval(pingInterval);
        }
      }, SSE_PING_INTERVAL_MS);

      c.req.raw.signal.addEventListener("abort", () => {
        dbNotifier.removeListener("projects-changed", handler);
        clearInterval(pingInterval);
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});

app.get("/api/projects/:projectId/events", (c) => {
  const projectId = projectsStore.getProject(c.req.param("projectId"))?.id ?? c.req.param("projectId");

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      const send = (data: string) => {
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      };

      // Send initial connection event
      send(JSON.stringify({ event: "connected" }));

      const handler = (event: { projectId: string }) => {
        if (event.projectId === projectId) {
          send(JSON.stringify({ event: "board-changed", ...event }));
        }
      };
      const sessionHandler = (event: { projectId: string }) => {
        if (event.projectId === projectId) {
          send(JSON.stringify({ event: "project-sessions-changed" }));
        }
      };
      const databaseHandler = (event: { projectId: string }) => {
        if (event.projectId === projectId) {
          send(JSON.stringify({ event: "database-changed", ...event }));
        }
      };

      dbNotifier.on("board-changed", handler);
      dbNotifier.on("database-changed", databaseHandler);
      dbNotifier.on("project-sessions-changed", sessionHandler);

      // Keep-alive ping
      const pingInterval = setInterval(() => {
        try {
          send(JSON.stringify({ event: "ping" }));
        } catch {
          clearInterval(pingInterval);
        }
      }, SSE_PING_INTERVAL_MS);

      // Cleanup when stream is cancelled
      c.req.raw.signal.addEventListener("abort", () => {
        dbNotifier.removeListener("board-changed", handler);
        dbNotifier.removeListener("database-changed", databaseHandler);
        dbNotifier.removeListener("project-sessions-changed", sessionHandler);
        clearInterval(pingInterval);
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});

// === Schema/Query routes ===

app.get("/api/projects/:projectId/schema", () => {
  const schema = sqlInspection.getSchema();
  return Response.json(schema);
});

app.post("/api/projects/:projectId/query", async (c) => {
  const body = await c.req.json();
  try {
    const result = sqlInspection.executeReadOnlyQuery(body.sql, body.params);
    return c.json(result);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

export function getHttpServerOptions(port: number): {
  fetch: typeof app.fetch;
  port: number;
  hostname: string;
} {
  return {
    fetch: (request, env, executionCtx) => {
      const origin = request.headers.get("origin") ?? undefined;

      if (origin && MUTATING_HTTP_METHODS.has(request.method) && !isTrustedBrowserOrigin(origin)) {
        return Response.json({ error: "Forbidden origin" }, { status: 403 });
      }

      return Promise.resolve(app.fetch(request, env, executionCtx))
        .then((response: Response) => withTrustedBrowserCors(origin, response));
    },
    port,
    hostname: LOOPBACK_HOST,
  };
}

export function __setHttpServerDependenciesForTests(
  overrides: Partial<HttpServerDependencies>,
): void {
  httpServerDependencies = {
    ...defaultHttpServerDependencies,
    ...overrides,
  };
}

export function __resetHttpServerDependenciesForTests(): void {
  httpServerDependencies = defaultHttpServerDependencies;
}

export function startHttpServer(port: number): void {
  serve(getHttpServerOptions(port), (info) => {
    logger.info("HTTP server started", {
      host: LOOPBACK_HOST,
      port: info.port,
    });
  });
}
