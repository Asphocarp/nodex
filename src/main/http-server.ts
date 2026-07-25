import { Hono, type Context } from "hono";
import { ZodError } from "zod";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { randomUUID } from "node:crypto";
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
import { requireProjectionInvalidationRouter } from "./projection-invalidation-runtime";
import {
  checkoutGitBranch,
  createAndCheckoutGitBranch,
  readGitBranchState,
} from "./git-branch-service";
import type {
  PageOccurrenceActionInput,
  PageOccurrenceCompleteInput,
  PageOccurrenceUpdateInput,
  PageSearchInput,
} from "../shared/types";
import { MAX_PAGE_WRITE_BODY_BYTES } from "../shared/page-limits";
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
  HttpPageBodySchema,
  parseOptionalWorkflowStatus,
} from "../shared/schemas/http";
import {
  ProjectLifecycleInputSchema,
  ProjectOrderInputSchema,
  ProjectPinnedInputSchema,
  ProjectPinnedOrderInputSchema,
} from "../shared/schemas/projects";
import { codexService } from "./codex/codex-service";
import { terminalManager } from "./terminal-manager";
import {
  CodexSidebarChatsThreadOrderInputSchema,
  CodexSidebarProjectThreadOrderInputSchema,
  CodexSidebarThreadMoveInputSchema,
} from "../shared/codex-sidebar-thread-move";
import { renameProjectSessionChat } from "./project-session-rename-service";
import {
  registerDocumentSyncHttpRoutes,
  type DocumentSyncHttpDependencies,
} from "./document-sync-http";
import {
  registerReferenceReadHttpRoutes,
  type ReferenceReadHttpDependencies,
} from "./reference-read-http";
import {
  registerBlockPropertyMutationHttpRoute,
  registerLibraryBlockPropertyMutationHttpRoute,
  type BlockPropertyMutationHttpDependencies,
  type LibraryBlockPropertyMutationHttpDependencies,
} from "./block-property-mutation-http";
import {
  registerDatabaseModuleHttpRoutes,
  type DatabaseModuleHttpDependencies,
} from "./database-module-http";
import {
  registerLibraryModuleHttpRoute,
  type LibraryModuleHttpDependencies,
} from "./library-module-http";
import {
  registerLibraryDatabaseModuleHttpRoute,
  type LibraryDatabaseModuleHttpDependencies,
} from "./library-database-module-http";
import {
  registerPageDetailHttpRoute,
  type PageDetailHttpDependencies,
} from "./page-detail-http";
import {
  registerLibraryPageDetailHttpRoute,
  type LibraryPageDetailHttpDependencies,
} from "./library-page-detail-http";
import {
  registerDocumentMutationHttpRoute,
  type DocumentMutationHttpDependencies,
} from "./document-operation-http";
import {
  registerAdditionalDocumentCommandHttpRoute,
  type AdditionalDocumentCommandHttpDependencies,
} from "./additional-document-command-http";
import {
  registerDocumentHistoryHttpRoutes,
  type DocumentHistoryHttpDependencies,
} from "./document-history-http";
import {
  registerPageLifecycleHttpRoute,
  registerPageLifecyclePreflightHttpRoute,
  type PageLifecycleHttpDependencies,
  type PageLifecyclePreflightHttpDependencies,
} from "./page-lifecycle-http";
import {
  registerPageHistoryHttpRoute,
  type PageHistoryHttpDependencies,
} from "./page-history-http";
import {
  registerBlockTransferHttpRoute,
  type BlockTransferHttpDependencies,
} from "./block-transfer-http";
import {
  deleteProjectSessionWithBrowserCleanupUsing,
  type ProjectSessionBrowserRuntime,
} from "./project-session-browser-ownership";
import {
  createProjectLifecycleService,
  type ProjectLifecycleService,
} from "./project-lifecycle-service";
import type { DesktopProjectWorkspacePort } from "./core-client/project-workspace-adapter";
import type { DesktopDatabaseModuleBridge } from "./core-client/desktop-database-module-bridge";
import type { DesktopLibraryModuleBridge } from "./core-client/desktop-library-module-bridge";
import type { DesktopAutomationModulePort } from "./core-client/desktop-automation-module-bridge";
import type { DesktopStoreAdministrationPort } from "./core-client/desktop-store-administration-bridge";
import { CoreModuleResponseError } from "./core-client/core-client";
import { productFeatureGates } from "./product-feature-gates";

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
const pageWriteBodyLimit = bodyLimit({
  maxSize: MAX_PAGE_WRITE_BODY_BYTES,
  onError: (c) =>
    c.json(
      { error: `Page payload exceeds ${(MAX_PAGE_WRITE_BODY_BYTES / (1024 * 1024)).toFixed(0)}MB limit` },
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

interface HttpServerDependencies {
  browserRuntime: ProjectSessionBrowserRuntime;
  projectLifecycleService: ProjectLifecycleService | null;
  transcribeDictation: (input: { contentType: string; base64Payload: string }) => Promise<string>;
  contentModules: HttpContentModuleDependencies;
}

interface HttpStoreAdministrationDependencies {
  readonly port: DesktopStoreAdministrationPort;
  readonly onBackupSettingsChanged?: (
    settings: ReturnType<typeof getBackupSettings>,
  ) => void;
  readonly onStoreRestored?: () => void;
}

export interface HttpContentModuleDependencies {
  referenceReads: ReferenceReadHttpDependencies;
  propertyMutations: {
    project: BlockPropertyMutationHttpDependencies["applyMutation"];
    library: LibraryBlockPropertyMutationHttpDependencies["applyMutation"];
  };
  database: DatabaseModuleHttpDependencies;
  library: LibraryModuleHttpDependencies;
  libraryDatabase: LibraryDatabaseModuleHttpDependencies;
  pageDetail: PageDetailHttpDependencies;
  libraryPageDetail: LibraryPageDetailHttpDependencies;
  pageLifecyclePreflight: PageLifecyclePreflightHttpDependencies;
  pageLifecycle: PageLifecycleHttpDependencies;
  projectWorkspace: DesktopProjectWorkspacePort;
  databaseProjections: Pick<
    DesktopDatabaseModuleBridge,
    | "getDatabaseViewWindow"
    | "getLibraryDatabaseViewWindow"
    | "getDatabaseRowPage"
  >;
  pageSearch: Pick<DesktopLibraryModuleBridge, "searchPages">;
  automation: Pick<
    DesktopAutomationModulePort,
    | "listPageOccurrences"
    | "completePageOccurrence"
    | "skipPageOccurrence"
    | "updatePageOccurrence"
  >;
  storeAdministration: HttpStoreAdministrationDependencies;
  documentSync: DocumentSyncHttpDependencies;
  documentMutation: DocumentMutationHttpDependencies;
  additionalDocumentCommand: AdditionalDocumentCommandHttpDependencies;
  blockTransfer: BlockTransferHttpDependencies;
  documentHistory: DocumentHistoryHttpDependencies;
  pageHistory: PageHistoryHttpDependencies;
}

const createUnconfiguredHttpContentModules = (): HttpContentModuleDependencies => {
  const unavailable = new Proxy(
    function unavailableHttpAuthority(): never {
      throw new Error("HTTP content authority is unavailable before Rust Core initialization");
    },
    {
      get: () => unavailable,
      apply: () => {
        throw new Error("HTTP content authority is unavailable before Rust Core initialization");
      },
    },
  );
  return unavailable as unknown as HttpContentModuleDependencies;
};

const defaultHttpServerDependencies: HttpServerDependencies = {
  projectLifecycleService: null,
  browserRuntime: {
    closeBrowserConversation: async (browserConversationId) => {
      const { browserSidebarService } = await import("./browser-sidebar-service");
      browserSidebarService.closeBrowserConversation(browserConversationId);
    },
    closeBrowserProject: async (projectId) => {
      const { browserSidebarService } = await import("./browser-sidebar-service");
      browserSidebarService.closeBrowserProject(projectId);
    },
  },
  transcribeDictation: async (input) => await codexService.transcribeDictation(input),
  contentModules: createUnconfiguredHttpContentModules(),
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

app.get("/api/app/feature-gates", (c) => {
  c.header("Cache-Control", "no-store");
  return c.json(productFeatureGates);
});

registerDocumentSyncHttpRoutes(app, {
  realtime: {
    subscribe: (scope, target, request) =>
      httpServerDependencies.contentModules.documentSync.realtime.subscribe(
        scope,
        target,
        request,
      ),
    sync: (scope, target, request) =>
      httpServerDependencies.contentModules.documentSync.realtime.sync(
        scope,
        target,
        request,
      ),
    applyUpdate: (scope, target, request) =>
      httpServerDependencies.contentModules.documentSync.realtime.applyUpdate(
        scope,
        target,
        request,
      ),
    publishAwareness: (scope, target, request) =>
      httpServerDependencies.contentModules.documentSync.realtime.publishAwareness(
        scope,
        target,
        request,
      ),
    respondToRelocationLease: (scope, target, request) =>
      httpServerDependencies.contentModules.documentSync.realtime
        .respondToRelocationLease(scope, target, request),
    subscribeCanvasScene: (target, request) =>
      httpServerDependencies.contentModules.documentSync.realtime
        .subscribeCanvasScene(target, request),
    syncCanvasScene: (target, request) =>
      httpServerDependencies.contentModules.documentSync.realtime
        .syncCanvasScene(target, request),
    applyCanvasSceneMutation: (target, request) =>
      httpServerDependencies.contentModules.documentSync.realtime
        .applyCanvasSceneMutation(target, request),
  },
  getOwnedDocumentDescriptor: (projectId, ownerBlockId) =>
    httpServerDependencies.contentModules.documentSync
      .getOwnedDocumentDescriptor(projectId, ownerBlockId),
  prepareOwnedBlockDocument: (projectId, ownerBlockId) =>
    httpServerDependencies.contentModules.documentSync
      .prepareOwnedBlockDocument(projectId, ownerBlockId),
  prepareLibraryOwnedBlockDocument: (ownerBlockId) =>
    httpServerDependencies.contentModules.documentSync
      .prepareLibraryOwnedBlockDocument?.(ownerBlockId)
      ?? Promise.resolve({
        ok: false,
        error: {
          code: "transport_unavailable",
          message: "Library Document preparation is unavailable",
          retryable: true,
          resetRequired: false,
        },
      }),
});

registerReferenceReadHttpRoutes(app, {
  resolvePageOwnershipPath: (input) =>
    httpServerDependencies.contentModules.referenceReads
      .resolvePageOwnershipPath(input),
  resolvePageTarget: (input) =>
    httpServerDependencies.contentModules.referenceReads.resolvePageTarget(input),
  readDatabaseViewReference: (input) =>
    httpServerDependencies.contentModules.referenceReads
      .readDatabaseViewReference(input),
});

registerBlockPropertyMutationHttpRoute(app, {
  applyMutation: async (request) =>
    await httpServerDependencies.contentModules.propertyMutations.project(request),
});
registerLibraryBlockPropertyMutationHttpRoute(app, {
  applyMutation: async (input) =>
    await httpServerDependencies.contentModules.propertyMutations.library(input),
});

registerDatabaseModuleHttpRoutes(app, {
  apply: (request) =>
    httpServerDependencies.contentModules.database.apply(request),
  read: (request) => httpServerDependencies.contentModules.database.read(request),
});

registerLibraryModuleHttpRoute(app, {
  read: (request) => httpServerDependencies.contentModules.library.read(request),
  apply: (request) => httpServerDependencies.contentModules.library.apply(request),
});

registerLibraryDatabaseModuleHttpRoute(app, {
  read: (request) =>
    httpServerDependencies.contentModules.libraryDatabase.read(request),
  apply: (request) =>
    httpServerDependencies.contentModules.libraryDatabase.apply(request),
});

registerPageDetailHttpRoute(app, {
  read: (projectId, pageId) =>
    httpServerDependencies.contentModules.pageDetail.read(projectId, pageId),
});

registerLibraryPageDetailHttpRoute(app, {
  read: (pageId) =>
    httpServerDependencies.contentModules.libraryPageDetail.read(pageId),
});

registerPageLifecyclePreflightHttpRoute(app, {
  readPreflight: (projectId, pageId) =>
    httpServerDependencies.contentModules.pageLifecyclePreflight
      .readPreflight(projectId, pageId),
});

registerPageLifecycleHttpRoute(app, {
  applyMutation: (request) =>
    httpServerDependencies.contentModules.pageLifecycle.applyMutation(request),
});

registerDocumentMutationHttpRoute(app, {
  applyMutation: (request) =>
    httpServerDependencies.contentModules.documentMutation.applyMutation(request),
});

registerAdditionalDocumentCommandHttpRoute(app, {
  applyCommand: (request) =>
    httpServerDependencies.contentModules.additionalDocumentCommand
      .applyCommand(request),
});

registerBlockTransferHttpRoute(app, {
  transfer: (intent) =>
    httpServerDependencies.contentModules.blockTransfer.transfer(intent),
});

registerDocumentHistoryHttpRoutes(app, {
  createCheckpoint: (request) =>
    httpServerDependencies.contentModules.documentHistory
      .createCheckpoint(request),
  listVersions: (request) =>
    httpServerDependencies.contentModules.documentHistory.listVersions(request),
  getVersion: (request) =>
    httpServerDependencies.contentModules.documentHistory.getVersion(request),
  restoreVersion: (request) =>
    httpServerDependencies.contentModules.documentHistory.restoreVersion(request),
});

registerPageHistoryHttpRoute(app, {
  listHistory: (request) =>
    httpServerDependencies.contentModules.pageHistory.listHistory(request),
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

const backupErrorStatus = (error: unknown): 400 | 404 | 500 => {
  if (error instanceof CoreModuleResponseError) {
    if (error.coreError.code === "not_found") return 404;
    if (error.coreError.code === "invalid_input") return 400;
    return 500;
  }
  if (!(error instanceof Error)) return 500;
  if (error.name === "InvalidBackupIdError") return 400;
  if (error.name === "BackupNotFoundError") return 404;
  return 500;
};

app.get("/api/backups", async (c) => {
  const backups = await httpServerDependencies.contentModules
    .storeAdministration.port.listBackups();
  return c.json({ backups });
});

app.post("/api/backups", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  try {
    const backup = await httpServerDependencies.contentModules
      .storeAdministration.port.createBackup({
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
    const result = await httpServerDependencies.contentModules
      .storeAdministration.port.deleteBackup(backupId);
    return c.json(result);
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : "Backup deletion failed" },
      backupErrorStatus(err),
    );
  }
});

app.post("/api/backups/:backupId/restore", async (c) => {
  const backupId = c.req.param("backupId");
  const body = await c.req.json().catch(() => ({}));
  if (body.confirm !== true) {
    return c.json({ error: "Restore requires confirm=true" }, 400);
  }

  try {
    const administration = httpServerDependencies.contentModules
      .storeAdministration;
    const result = await administration.port.restoreBackup({
      backupId,
      confirm: true,
      createSafetyBackup: body.createSafetyBackup !== false,
    });
    administration.onStoreRestored?.();
    return c.json(result);
  } catch (err) {
    return c.json(
      { error: err instanceof Error ? err.message : "Backup restore failed" },
      backupErrorStatus(err),
    );
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
    httpServerDependencies.contentModules.storeAdministration
      .onBackupSettingsChanged?.(settings);
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

function parseOccurrenceCreatedPageId(value: unknown): string {
  if (typeof value === "string" && value.length > 0 && value === value.trim()) {
    return value;
  }
  throw new Error("Missing or invalid createdPageId");
}

function parseOccurrenceSource(
  value: unknown,
): PageOccurrenceActionInput["source"] {
  if (
    value === "calendar" ||
    value === "page-detail" ||
    value === "notification" ||
    value === "api"
  ) {
    return value;
  }
  throw new Error("Missing or invalid occurrence source");
}

function parseOccurrenceScope(
  value: unknown,
): PageOccurrenceUpdateInput["scope"] {
  if (value === "this" || value === "this-and-future" || value === "all") {
    return value;
  }
  throw new Error("Missing or invalid occurrence scope");
}

function normalizePageBody(body: Record<string, unknown>): Record<string, unknown> {
  return HttpPageBodySchema.parse(body);
}

const projectWorkspaceAuthority = (): DesktopProjectWorkspacePort =>
  httpServerDependencies.contentModules.projectWorkspace;

const projectLifecycleAuthority = () =>
  httpServerDependencies.projectLifecycleService ?? createProjectLifecycleService({
    projectWorkspace: projectWorkspaceAuthority(),
    browserRuntime: httpServerDependencies.browserRuntime,
    listCodexBlockers: (threadIds) =>
      codexService.listProjectArchiveBlockers(threadIds),
    listBackgroundProcessRows: async (threadId) =>
      await codexService.listBackgroundProcessRows({ threadId }),
    listLiveTerminalSessions: (input) =>
      terminalManager.listLiveSessionsForOwners(input),
    discardExitedTerminalSessions: (input) =>
      terminalManager.discardExitedSessionsForOwners(input),
  });

// === Project routes ===

app.get("/api/projects", async (c) => {
  const first = Number(c.req.query("first") ?? 100);
  const window = await projectWorkspaceAuthority().listProjectWindow({
    includeArchived: c.req.query("includeArchived") === "true",
    after: c.req.query("after") ?? null,
    first: Number.isFinite(first) ? first : 100,
  });
  return c.json(window);
});

app.post("/api/projects", async (c) => {
  const body = await c.req.json();
  try {
    const legacyField = getLegacyProjectField(body);
    if (legacyField) {
      return c.json({ error: `Unsupported legacy project field: ${legacyField}` }, 400);
    }
    const project = await projectWorkspaceAuthority().createProject({
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
    await projectWorkspaceAuthority().reorderProjects(
      ProjectOrderInputSchema.parse(body),
    );
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.put("/api/projects/pinned-order", async (c) => {
  const body = await c.req.json();
  try {
    await projectWorkspaceAuthority().setPinnedProjectOrder(
      ProjectPinnedOrderInputSchema.parse(body),
    );
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.get("/api/projects/:projectId", async (c) => {
  const project = await projectWorkspaceAuthority().getProject(
    c.req.param("projectId"),
  );
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
    const result = await projectWorkspaceAuthority().updateProject(projectId, {
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
    const result = await projectWorkspaceAuthority().setProjectPinned(
      c.req.param("projectId"),
      ProjectPinnedInputSchema.parse(body),
    );
    if (!result) return c.json({ error: "Not found" }, 404);
    return c.json(result);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.put("/api/projects/:projectId/lifecycle", async (c) => {
  try {
    const input = ProjectLifecycleInputSchema.parse(await c.req.json());
    const result = await projectLifecycleAuthority().setLifecycle(
      c.req.param("projectId"),
      input.lifecycle,
    );
    if (result.kind === "not-found") return c.json(result, 404);
    if (result.kind === "blocked") return c.json(result, 409);
    return c.json(result);
  } catch (error) {
    if (
      error instanceof CoreModuleResponseError
      && error.coreError.code === "revision_conflict"
    ) {
      return c.json({ error: error.message }, 409);
    }
    if (error instanceof ZodError || error instanceof SyntaxError) {
      return c.json({ error: error.message }, 400);
    }
    throw error;
  }
});

// === Project session routes ===

app.get("/api/workspace/tasks", async (c) => {
  const rawProjectId = c.req.query("projectId");
  const projectId = rawProjectId === undefined || rawProjectId === ""
    ? null
    : rawProjectId;
  const rawFirst = c.req.query("first");
  const first = rawFirst === undefined ? undefined : Number(rawFirst);
  if (
    first !== undefined
    && (!Number.isSafeInteger(first) || first <= 0)
  ) {
    return c.json({ error: "first must be a positive integer" }, 400);
  }
  try {
    return c.json(
      await projectWorkspaceAuthority().listProjectSessionSummaryWindow(
        projectId,
        {
          includeArchived: c.req.query("includeArchived") === "true",
          after: c.req.query("after") ?? null,
          first,
        },
      ),
    );
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.get("/api/project-sessions/:sessionId", async (c) => {
  const session = await projectWorkspaceAuthority().getProjectSession(
    c.req.param("sessionId"),
  );
  if (!session) return c.json({ error: "Not found" }, 404);
  return c.json(session);
});

app.post("/api/projects/:projectId/sessions", async (c) => {
  const projectId = c.req.param("projectId");
  const body = await c.req.json();
  try {
    const session = await projectWorkspaceAuthority().createProjectSession({
      ...body,
      projectId,
    });
    return c.json(session, 201);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.put("/api/project-sessions/:sessionId", async (c) => {
  const body = await c.req.json();
  try {
    const sessionId = c.req.param("sessionId");
    const existing = await projectWorkspaceAuthority().getProjectSession(sessionId);
    if (!existing) return c.json({ error: "Not found" }, 404);
    const session = await projectWorkspaceAuthority().updateProjectSession(
      sessionId,
      body,
    );
    if (!session) return c.json({ error: "Not found" }, 404);
    return c.json(session);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.put("/api/project-sessions/:sessionId/rename", async (c) => {
  const body = await c.req.json();
  try {
    const session = await renameProjectSessionChat(c.req.param("sessionId"), body, {
      getProjectSession: projectWorkspaceAuthority().getProjectSession,
      renameProjectSession: projectWorkspaceAuthority().renameProjectSession,
      setThreadName: (threadId, rawTitle) => codexService.setThreadName(threadId, rawTitle),
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
    const session = await projectWorkspaceAuthority().setProjectSessionPinned(
      c.req.param("sessionId"),
      body,
    );
    if (!session) return c.json({ error: "Not found" }, 404);
    return c.json(session);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.put("/api/projects/:projectId/sessions/pinned-order", async (c) => {
  const projectId = c.req.param("projectId");
  const body = await c.req.json();
  try {
    await projectWorkspaceAuthority()
      .setPinnedProjectSessionOrder(projectId, body);
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.put("/api/project-sessions/:sessionId/archive", async (c) => {
  const sessionId = c.req.param("sessionId");
  try {
    const existing = await projectWorkspaceAuthority().getProjectSession(sessionId);
    if (!existing) return c.json({ error: "Not found" }, 404);
    let session;
    if (existing.thread) {
      await codexService.archiveThread(existing.thread.threadId);
      session = await projectWorkspaceAuthority().getProjectSession(sessionId);
    } else {
      session = await projectWorkspaceAuthority().archiveProjectSession(sessionId);
    }
    if (!session) return c.json({ error: "Not found" }, 404);
    return c.json(session);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.put("/api/project-sessions/:sessionId/unarchive", async (c) => {
  const sessionId = c.req.param("sessionId");
  try {
    const existing = await projectWorkspaceAuthority().getProjectSession(sessionId);
    if (!existing) return c.json({ error: "Not found" }, 404);
    let session;
    if (existing.thread) {
      await codexService.unarchiveThread(existing.thread.threadId);
      session = await projectWorkspaceAuthority().getProjectSession(sessionId);
    } else {
      session = await projectWorkspaceAuthority().unarchiveProjectSession(sessionId);
    }
    if (!session) return c.json({ error: "Not found" }, 404);
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
    const session = await projectWorkspaceAuthority().markProjectSessionUnread(
      c.req.param("sessionId"),
      body,
    );
    if (!session) return c.json({ error: "Not found" }, 404);
    return c.json(session);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.post("/api/project-sessions/:sessionId/fork", async (c) => {
  const body = await c.req.json();
  try {
    const result = await codexService.forkProjectSessionThread(c.req.param("sessionId"), body);
    return c.json(result, 201);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.delete("/api/project-sessions/:sessionId", async (c) => {
  try {
    const sessionId = c.req.param("sessionId");
    const workspace = projectWorkspaceAuthority();
    const success = await deleteProjectSessionWithBrowserCleanupUsing({
      sessionId,
      browserRuntime: httpServerDependencies.browserRuntime,
      deleteProjectSession: workspace.deleteProjectSession,
    });
    if (!success) return c.json({ error: "Not found" }, 404);
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
    await projectWorkspaceAuthority().reorderProjectSessions(
      projectId,
      orderedSessionIds.filter((item: unknown): item is string => typeof item === "string"),
    );
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.put("/api/project-sessions/:sessionId/thread", async (c) => {
  const sessionId = c.req.param("sessionId");
  const body = await c.req.json();
  try {
    const thread = await projectWorkspaceAuthority()
      .upsertProjectSessionThreadLink({ ...body, sessionId });
    return c.json(thread);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.delete("/api/project-sessions/:sessionId/thread", async (c) => {
  const sessionId = c.req.param("sessionId");
  const success = await projectWorkspaceAuthority()
    .detachProjectSessionThread(sessionId);
  return c.json({ success });
});

app.get("/api/projects/:projectId/database-views/:viewId/rows", async (c) => {
  const startedAt = Date.now();
  const rawFirst = c.req.query("first");
  const first = rawFirst === undefined ? undefined : Number(rawFirst);
  if (
    first !== undefined
    && (!Number.isSafeInteger(first) || first < 1 || first > 200)
  ) {
    return c.json({ error: "first must be an integer between 1 and 200" }, 400);
  }
  const rawViewId = c.req.param("viewId");
  const window = await httpServerDependencies.contentModules.databaseProjections
    .getDatabaseViewWindow(c.req.param("projectId"), {
      ...(rawViewId === "default" ? {} : { databaseViewId: rawViewId }),
      ...(c.req.query("after") ? { after: c.req.query("after") } : {}),
      ...(first === undefined ? {} : { first }),
    });
  logger.info("Database View window payload served", {
    channel: "GET /api/projects/:projectId/database-views/:viewId/rows",
    projectId: c.req.param("projectId"),
    rowCount: window.rows.length,
    hasContinuation: window.nextCursor !== null,
    approxPayloadBytes: approximatePayloadBytes(window),
    durationMs: Date.now() - startedAt,
  });
  return c.json(window);
});

app.get("/api/library/database-views/:viewId/rows", async (c) => {
  const rawFirst = c.req.query("first");
  const first = rawFirst === undefined ? undefined : Number(rawFirst);
  if (
    first !== undefined
    && (!Number.isSafeInteger(first) || first < 1 || first > 200)
  ) {
    return c.json({ error: "first must be an integer between 1 and 200" }, 400);
  }
  const window = await httpServerDependencies.contentModules.databaseProjections
    .getLibraryDatabaseViewWindow({
      databaseViewId: c.req.param("viewId"),
      ...(c.req.query("after") ? { after: c.req.query("after") } : {}),
      ...(first === undefined ? {} : { first }),
    });
  return c.json(window);
});

app.get("/api/library/databases/:databaseId/default-view/rows", async (c) => {
  const rawFirst = c.req.query("first");
  const first = rawFirst === undefined ? undefined : Number(rawFirst);
  if (
    first !== undefined
    && (!Number.isSafeInteger(first) || first < 1 || first > 200)
  ) {
    return c.json({ error: "first must be an integer between 1 and 200" }, 400);
  }
  const window = await httpServerDependencies.contentModules.databaseProjections
    .getLibraryDatabaseViewWindow({
      databaseId: c.req.param("databaseId"),
      ...(c.req.query("after") ? { after: c.req.query("after") } : {}),
      ...(first === undefined ? {} : { first }),
    });
  return c.json(window);
});

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

app.get("/api/projects/:projectId/database-row", async (c) => {
  const projectId = c.req.param("projectId");
  const status = parseOptionalWorkflowStatus(c.req.query("status") || undefined);
  const pageId = c.req.query("pageId");
  if (!pageId) return c.json({ error: "Missing pageId" }, 400);
  const result = await httpServerDependencies.contentModules.databaseProjections
    .getDatabaseRowPage(
    projectId,
    pageId,
    status,
  );
  if (!result) return c.json({ error: "Not found" }, 404);
  return c.json(result);
});

app.post("/api/pages/search", async (c) => {
  const startedAt = Date.now();
  const body = await c.req.json().catch(() => ({}));
  if (!isRecord(body) || !Array.isArray(body.projectIds) || typeof body.query !== "string") {
    return c.json({ error: "Missing projectIds or query" }, 400);
  }
  const input: PageSearchInput = {
    projectIds: body.projectIds.filter((projectId): projectId is string => typeof projectId === "string"),
    query: body.query,
    limit: typeof body.limit === "number" ? body.limit : undefined,
  };
  const results = await httpServerDependencies.contentModules.pageSearch
    .searchPages(input);
  logger.info("Page search payload served", {
    channel: "POST /api/pages/search",
    projectCount: input.projectIds.length,
    resultCount: results.length,
    approxPayloadBytes: approximatePayloadBytes(results),
    durationMs: Date.now() - startedAt,
  });
  return c.json(results);
});

app.get("/api/projects/:projectId/calendar/occurrences", async (c) => {
  const projectId = c.req.param("projectId");
  const startRaw = c.req.query("start");
  const endRaw = c.req.query("end");
  const searchQuery = c.req.query("search") || undefined;
  const after = c.req.query("after") || undefined;

  try {
    const start = parseRequiredDate("start", startRaw);
    const end = parseRequiredDate("end", endRaw);
    const window = await httpServerDependencies.contentModules.automation
      .listPageOccurrences(projectId, start, end, searchQuery, after);
    return c.json({
      occurrences: window.items,
      nextCursor: window.nextCursor,
    });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

app.post("/api/projects/:projectId/page-occurrence/complete", async (c) => {
  const projectId = c.req.param("projectId");
  const body = await c.req.json().catch(() => ({}));
  try {
    if (!isRecord(body)) throw new Error("Invalid request body");
    if (typeof body.pageId !== "string") throw new Error("Missing pageId");
    const input: PageOccurrenceCompleteInput = {
      operationId: parseOccurrenceOperationId(body.operationId),
      createdPageId: parseOccurrenceCreatedPageId(body.createdPageId),
      pageId: body.pageId,
      occurrenceStart: parseRequiredDate("occurrenceStart", body.occurrenceStart),
      source: parseOccurrenceSource(body.source),
    };
    const result = await httpServerDependencies.contentModules.automation
      .completePageOccurrence(
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

app.post("/api/projects/:projectId/page-occurrence/skip", async (c) => {
  const projectId = c.req.param("projectId");
  const body = await c.req.json().catch(() => ({}));
  try {
    if (!isRecord(body)) throw new Error("Invalid request body");
    if (typeof body.pageId !== "string") throw new Error("Missing pageId");
    const input: PageOccurrenceActionInput = {
      operationId: parseOccurrenceOperationId(body.operationId),
      pageId: body.pageId,
      occurrenceStart: parseRequiredDate("occurrenceStart", body.occurrenceStart),
      source: parseOccurrenceSource(body.source),
    };
    const result = await httpServerDependencies.contentModules.automation
      .skipPageOccurrence(
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

app.put("/api/projects/:projectId/page-occurrence", pageWriteBodyLimit, async (c) => {
  const projectId = c.req.param("projectId");
  const body = await c.req.json().catch(() => ({}));
  try {
    if (!isRecord(body)) throw new Error("Invalid request body");
    if (typeof body.pageId !== "string") throw new Error("Missing pageId");
    if (typeof body.scope !== "string") throw new Error("Missing scope");
    if (!isRecord(body.updates)) throw new Error("Missing updates");
    const updates = normalizePageBody(body.updates);
    const scope = parseOccurrenceScope(body.scope);
    if (scope === "all" && "createdPageId" in body) {
      throw new Error("Occurrence scope all must not include createdPageId");
    }
    const input: PageOccurrenceUpdateInput = {
      operationId: parseOccurrenceOperationId(body.operationId),
      pageId: body.pageId,
      occurrenceStart: parseRequiredDate("occurrenceStart", body.occurrenceStart),
      source: parseOccurrenceSource(body.source),
      scope,
      ...(scope === "all"
        ? {}
        : { createdPageId: parseOccurrenceCreatedPageId(body.createdPageId) }),
      updates: updates as PageOccurrenceUpdateInput["updates"],
    } as PageOccurrenceUpdateInput;
    const result = await httpServerDependencies.contentModules.automation
      .updatePageOccurrence(
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

// === SSE events ===

app.get("/api/library-module/events", (c) => {
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (data: string) => {
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      };
      send(JSON.stringify({ event: "connected" }));
      const projectionRelease = requireProjectionInvalidationRouter().subscribe({
        kind: "library",
        libraryId: requireProjectionInvalidationRouter().libraryId,
      }, (message) => {
        send(JSON.stringify({ event: "projection-stream", message }));
      });
      const handler = (
        event: import("../shared/library-events").LibraryNavigationChangedEvent,
      ) => send(JSON.stringify({ event: "library-navigation-changed", ...event }));
      dbNotifier.on("library-navigation-changed", handler);
      const pingInterval = setInterval(() => {
        try {
          send(JSON.stringify({ event: "ping" }));
        } catch {
          clearInterval(pingInterval);
        }
      }, SSE_PING_INTERVAL_MS);
      c.req.raw.signal.addEventListener("abort", () => {
        projectionRelease();
        dbNotifier.removeListener("library-navigation-changed", handler);
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

app.get("/api/projects/:projectId/events", async (c) => {
  const project = await projectWorkspaceAuthority().getProject(
    c.req.param("projectId"),
  );
  const projectId = project?.id ?? c.req.param("projectId");

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      const send = (data: string) => {
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      };

      // Send initial connection event
      send(JSON.stringify({ event: "connected" }));
      const projectionRelease = project
        ? requireProjectionInvalidationRouter().subscribe({
            kind: "project",
            libraryId: project.libraryId,
            projectId,
          }, (message) => {
            send(JSON.stringify({ event: "projection-stream", message }));
          })
        : () => undefined;

      const handler = (event: { projectId: string }) => {
        if (event.projectId === projectId) {
          send(JSON.stringify({ event: "board-changed", ...event }));
        }
      };
      const pageOwnershipPathsHandler = (event: {
        libraryId: string;
        projectId?: string;
        changeKind: string;
      }) => {
        if (!project || event.libraryId !== project.libraryId) return;
        if (event.projectId && event.projectId !== projectId) return;
        send(JSON.stringify({
          event: "page-ownership-paths-changed",
          changeKind: event.changeKind,
        }));
      };
      const databaseHandler = (event: { projectId: string }) => {
        if (event.projectId === projectId) {
          send(JSON.stringify({ event: "database-changed", ...event }));
        }
      };

      dbNotifier.on("board-changed", handler);
      dbNotifier.on("page-ownership-paths-changed", pageOwnershipPathsHandler);
      dbNotifier.on("database-changed", databaseHandler);

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
        projectionRelease();
        dbNotifier.removeListener("board-changed", handler);
        dbNotifier.removeListener("page-ownership-paths-changed", pageOwnershipPathsHandler);
        dbNotifier.removeListener("database-changed", databaseHandler);
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

app.get("/api/project-sessions/events", (c) => {
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      const send = (data: string) => {
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      };
      send(JSON.stringify({ event: "connected" }));
      const handler = (event: import("../shared/ipc-api").ProjectSessionsChangeEvent) => {
        send(JSON.stringify({ event: "project-sessions-changed", ...event }));
      };
      dbNotifier.on("project-sessions-changed", handler);
      const pingInterval = setInterval(() => {
        try {
          send(JSON.stringify({ event: "ping" }));
        } catch {
          clearInterval(pingInterval);
        }
      }, SSE_PING_INTERVAL_MS);
      c.req.raw.signal.addEventListener("abort", () => {
        dbNotifier.removeListener("project-sessions-changed", handler);
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

export function __setHttpContentModuleDependenciesForTests(
  overrides: Partial<HttpContentModuleDependencies>,
): void {
  httpServerDependencies = {
    ...defaultHttpServerDependencies,
    contentModules: {
      ...defaultHttpServerDependencies.contentModules,
      ...overrides,
    },
  };
}

export function configureHttpContentModuleAuthorities(
  contentModules: HttpContentModuleDependencies,
): void {
  httpServerDependencies = {
    ...httpServerDependencies,
    contentModules,
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
