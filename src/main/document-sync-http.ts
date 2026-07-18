import { EventEmitter } from "node:events";
import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  DOCUMENT_HTTP_CONTENT_TYPE,
  decodeDocumentApplyHttpRequest,
  decodeDocumentAwarenessHttpRequest,
  decodeDocumentSyncHttpRequest,
  encodeDocumentApplyHttpAck,
  encodeDocumentHttpError,
  encodeLibraryOwnedDocumentDescriptorHttp,
  encodeOwnedDocumentDescriptorHttp,
  encodeDocumentRealtimeSseEvent,
  encodeDocumentSyncHttpResponse,
} from "../shared/block-documents/http-contract";
import {
  MAX_PAGE_DOCUMENT_STATE_BYTES,
  MAX_PAGE_DOCUMENT_UPDATE_BYTES,
} from "../shared/block-documents/contracts";
import type {
  LibraryOwnedDocumentDescriptor,
  OwnedDocumentDescriptor,
} from "../shared/block-documents/contracts";
import {
  MAX_DOCUMENT_AWARENESS_UPDATE_BYTES,
  parseDocumentRelocationLeaseResponseRequest,
  type DocumentAccessAck,
  type DocumentAccessKind,
  type LibraryDocumentAccessAck,
  type DocumentSyncCommandError,
  type DocumentSyncCommandResult,
  type DocumentSyncRealtimeEvent,
  type DocumentSyncSubscribeRequest,
} from "../shared/block-documents/document-sync";
import {
  DocumentHttpWireError,
  MAX_DOCUMENT_HTTP_METADATA_BYTES,
} from "../shared/block-documents/http-wire";
import {
  CANVAS_SCENE_HTTP_CONTENT_TYPE,
  decodeCanvasSceneMutationRequestHttp,
  decodeCanvasSceneSyncRequestHttp,
  encodeCanvasSceneMutationResultHttp,
  encodeCanvasSceneSseEvent,
  encodeCanvasSceneSyncResultHttp,
} from "../shared/block-documents/canvas-scene-http-contract";
import type {
  CanvasSceneRealtimeEvent,
  CanvasSceneSubscribeRequest,
} from "../shared/block-documents/canvas-scene-sync";
import { MAX_CANVAS_SCENE_MUTATION_BYTES } from "../shared/block-documents/canvas-scene-sync";
import {
  DocumentSyncHub,
  type DocumentSyncClientTarget,
} from "./document-sync-hub";

const SSE_PING_INTERVAL_MS = 30_000;
const DOCUMENT_SYNC_EVENT_CHANNEL = "document-sync:event";
const MAX_SYNC_REQUEST_BYTES =
  MAX_DOCUMENT_HTTP_METADATA_BYTES + MAX_PAGE_DOCUMENT_STATE_BYTES + 8;
const MAX_APPLY_REQUEST_BYTES =
  MAX_DOCUMENT_HTTP_METADATA_BYTES + MAX_PAGE_DOCUMENT_UPDATE_BYTES + 8;
const MAX_AWARENESS_REQUEST_BYTES =
  MAX_DOCUMENT_HTTP_METADATA_BYTES + MAX_DOCUMENT_AWARENESS_UPDATE_BYTES + 8;
const MAX_RELOCATION_LEASE_RESPONSE_BYTES = 8 * 1024;

export interface DocumentSyncHttpDependencies {
  readonly hub: DocumentSyncHub;
  readonly authorizeDocumentAccess: (
    projectId: string,
    documentId: string,
    access: DocumentAccessKind,
  ) => Promise<DocumentSyncCommandResult<DocumentAccessAck>>;
  readonly getOwnedDocumentDescriptor: (
    projectId: string,
    ownerBlockId: string,
  ) => Promise<OwnedDocumentDescriptor>;
  readonly prepareOwnedBlockDocument: (
    projectId: string,
    ownerBlockId: string,
  ) => Promise<DocumentSyncCommandResult<OwnedDocumentDescriptor>>;
  readonly authorizeLibraryDocumentAccess?: (
    documentId: string,
    access: DocumentAccessKind,
  ) => Promise<DocumentSyncCommandResult<LibraryDocumentAccessAck>>;
  readonly prepareLibraryOwnedBlockDocument?: (
    ownerBlockId: string,
  ) => Promise<DocumentSyncCommandResult<LibraryOwnedDocumentDescriptor>>;
}

const commandError = (
  code: DocumentSyncCommandError["code"],
  message: string,
  options: {
    readonly retryable?: boolean;
    readonly resetRequired?: boolean;
  } = {},
): DocumentSyncCommandError => ({
  code,
  message,
  retryable: options.retryable ?? false,
  resetRequired: options.resetRequired ?? false,
});

const statusForError = (error: DocumentSyncCommandError): number => {
  if (error.code === "document_not_found" || error.code === "unauthorized") {
    return 404;
  }
  if (
    error.code === "transport_unavailable" ||
    error.code === "store_not_initialized"
  ) {
    return 503;
  }
  if (
    error.code === "document_not_ready" ||
    error.code === "store_epoch_mismatch" ||
    error.code === "document_generation_mismatch" ||
    error.code === "future_base_head" ||
    error.code === "document_update_missing_dependencies" ||
    error.code === "update_id_collision" ||
    error.code === "block_relocated" ||
    error.code === "recovery_required"
  ) {
    return 409;
  }
  return 400;
};

const errorResponse = (error: DocumentSyncCommandError): Response =>
  new Response(encodeDocumentHttpError(error), {
    status: statusForError(error),
    headers: { "Content-Type": "application/json" },
  });

const copyToArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
};

const binaryResponse = (body: Uint8Array): Response =>
  new Response(copyToArrayBuffer(body), {
    headers: {
      "Content-Type": DOCUMENT_HTTP_CONTENT_TYPE,
      "Cache-Control": "no-store",
    },
  });


const invalidRequest = (message: string): Response =>
  errorResponse(commandError("invalid_document_update", message));

const readBinaryBody = async (
  context: Context,
  maxBytes: number,
): Promise<Uint8Array> => {
  const contentType = context.req.header("content-type")?.split(";", 1)[0];
  if (contentType !== DOCUMENT_HTTP_CONTENT_TYPE) {
    throw new DocumentHttpWireError(
      "Document request has an invalid Content-Type",
    );
  }
  const contentLength = Number(context.req.header("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new DocumentHttpWireError(
      `Document request exceeds ${maxBytes} bytes`,
    );
  }
  const body = new Uint8Array(await context.req.arrayBuffer());
  if (body.byteLength > maxBytes) {
    throw new DocumentHttpWireError(
      `Document request exceeds ${maxBytes} bytes`,
    );
  }
  return body;
};

const readRelocationLeaseJsonBody = async (
  context: Context,
): Promise<ReturnType<typeof parseDocumentRelocationLeaseResponseRequest>> => {
  const contentType = context.req.header("content-type")?.split(";", 1)[0];
  if (contentType !== "application/json") {
    throw new TypeError("Relocation lease response requires application/json");
  }
  const contentLength = Number(context.req.header("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_RELOCATION_LEASE_RESPONSE_BYTES
  ) {
    throw new TypeError("Relocation lease response is too large");
  }
  const body = await context.req.text();
  if (
    new TextEncoder().encode(body).byteLength >
    MAX_RELOCATION_LEASE_RESPONSE_BYTES
  ) {
    throw new TypeError("Relocation lease response is too large");
  }
  return parseDocumentRelocationLeaseResponseRequest(JSON.parse(body));
};

const readCanvasJsonBody = async (context: Context): Promise<string> => {
  const contentType = context.req.header("content-type")?.split(";", 1)[0];
  if (contentType !== CANVAS_SCENE_HTTP_CONTENT_TYPE) {
    throw new TypeError("Canvas scene request has an invalid Content-Type");
  }
  return await context.req.text();
};
let browserTargetSequence = 0;

class BrowserDocumentSyncTarget
  extends EventEmitter
  implements DocumentSyncClientTarget
{
  readonly id: number;
  private destroyed = false;

  constructor(private readonly enqueue: (serializedEvent: string) => void) {
    super();
    browserTargetSequence += 1;
    this.id = -browserTargetSequence;
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  send(channel: string, ...args: unknown[]): void {
    if (this.destroyed || channel !== DOCUMENT_SYNC_EVENT_CHANNEL) return;
    const event = args[0] as DocumentSyncRealtimeEvent | CanvasSceneRealtimeEvent;
    this.enqueue(
      "type" in event
        ? encodeCanvasSceneSseEvent(event)
        : encodeDocumentRealtimeSseEvent(event),
    );
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit("destroyed");
    this.removeAllListeners();
  }
}

interface BrowserClientEntry {
  readonly projectId: string;
  readonly engine: "yjs" | "canvas_scene";
  readonly request: DocumentSyncSubscribeRequest | CanvasSceneSubscribeRequest;
  readonly target: BrowserDocumentSyncTarget;
}

const browserClientKey = (
  projectId: string,
  request: DocumentSyncSubscribeRequest | CanvasSceneSubscribeRequest,
  engine: "yjs" | "canvas_scene" = "yjs",
): string =>
  JSON.stringify([engine, projectId, request.documentId, request.clientSessionId]);

export class DocumentSyncHttpClients {
  private readonly entries = new Map<string, BrowserClientEntry>();

  replace(entry: BrowserClientEntry): void {
    const key = browserClientKey(entry.projectId, entry.request, entry.engine);
    const previous = this.entries.get(key);
    if (previous && previous.target !== entry.target) {
      previous.target.destroy();
    }
    this.entries.set(key, entry);
  }

  get(
    projectId: string,
    request: DocumentSyncSubscribeRequest,
    engine: "yjs" | "canvas_scene" = "yjs",
  ): BrowserClientEntry | null {
    return this.entries.get(browserClientKey(projectId, request, engine)) ?? null;
  }

  getAny(
    projectId: string,
    request: DocumentSyncSubscribeRequest,
  ): BrowserClientEntry | null {
    return this.get(projectId, request, "yjs") ??
      this.get(projectId, request, "canvas_scene");
  }

  remove(entry: BrowserClientEntry): void {
    const key = browserClientKey(entry.projectId, entry.request, entry.engine);
    if (this.entries.get(key)?.target === entry.target) {
      this.entries.delete(key);
    }
    entry.target.destroy();
  }
}

const resolveProjectScope = async (
  dependencies: DocumentSyncHttpDependencies,
  projectId: string,
  documentId: string,
  access: DocumentAccessKind = "read",
): Promise<DocumentSyncCommandError | null> => {
  let result: DocumentSyncCommandResult<DocumentAccessAck>;
  try {
    result = await dependencies.authorizeDocumentAccess(
      projectId,
      documentId,
      access,
    );
  } catch {
    return commandError(
      "transport_unavailable",
      "The durable document writer is unavailable",
      { retryable: true },
    );
  }
  if (!result.ok) return result.error;
  if (
    result.value.authorized &&
    result.value.projectId === projectId &&
    result.value.documentId === documentId &&
    result.value.access === access
  ) {
    return null;
  }
  return commandError("invalid_response", "Document access escaped its scope");
};

const requireBrowserClient = (
  clients: DocumentSyncHttpClients,
  projectId: string,
  request: DocumentSyncSubscribeRequest,
): DocumentSyncCommandResult<BrowserClientEntry> => {
  const entry = clients.get(projectId, request);
  if (entry) return { ok: true, value: entry };
  return {
    ok: false,
    error: commandError(
      "unauthorized",
      "Open the Document event stream before issuing sync commands",
    ),
  };
};

const requireAnyBrowserClient = (
  clients: DocumentSyncHttpClients,
  projectId: string,
  request: DocumentSyncSubscribeRequest,
): DocumentSyncCommandResult<BrowserClientEntry> => {
  const entry = clients.getAny(projectId, request);
  if (entry) return { ok: true, value: entry };
  return {
    ok: false,
    error: commandError(
      "unauthorized",
      "Open the Document event stream before responding to a lease",
    ),
  };
};

const LOCAL_LIBRARY_HTTP_SCOPE = "local-user-library";

const resolveLibraryScope = async (
  dependencies: DocumentSyncHttpDependencies,
  documentId: string,
  access: DocumentAccessKind = "read",
): Promise<DocumentSyncCommandError | null> => {
  if (!dependencies.authorizeLibraryDocumentAccess) {
    return commandError(
      "transport_unavailable",
      "Library Document access is unavailable",
      { retryable: true },
    );
  }
  try {
    const result = await dependencies.authorizeLibraryDocumentAccess(
      documentId,
      access,
    );
    if (!result.ok) return result.error;
    if (
      result.value.authorized &&
      result.value.documentId === documentId &&
      result.value.access === access
    ) {
      return null;
    }
    return commandError("invalid_response", "Library Document access escaped its scope");
  } catch {
    return commandError(
      "transport_unavailable",
      "The durable document writer is unavailable",
      { retryable: true },
    );
  }
};

/** Registers the Yjs transport under trusted local Library authority. */
const registerLibraryDocumentSyncHttpRoutes = (
  app: Hono,
  dependencies: DocumentSyncHttpDependencies,
  clients: DocumentSyncHttpClients,
): void => {
  app.post("/api/library/blocks/:ownerBlockId/document/prepare", async (context) => {
    const ownerBlockId = context.req.param("ownerBlockId").trim();
    if (!ownerBlockId) return invalidRequest("Owner Block is required");
    if (!dependencies.prepareLibraryOwnedBlockDocument) {
      return errorResponse(commandError(
        "transport_unavailable",
        "Library Document preparation is unavailable",
        { retryable: true },
      ));
    }
    try {
      const prepared = await dependencies.prepareLibraryOwnedBlockDocument(
        ownerBlockId,
      );
      if (!prepared.ok) return errorResponse(prepared.error);
      if (prepared.value.ownerBlockId !== ownerBlockId) {
        return errorResponse(commandError(
          "invalid_response",
          "Prepared Document escaped its requested Library owner",
        ));
      }
      return new Response(
        encodeLibraryOwnedDocumentDescriptorHttp(prepared.value),
        {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          },
        },
      );
    } catch (error) {
      return errorResponse(commandError(
        "transport_unavailable",
        error instanceof Error ? error.message : "Owned Document preparation failed",
        { retryable: true },
      ));
    }
  });

  app.get("/api/library/documents/:documentId/events", async (context) => {
    const documentId = context.req.param("documentId").trim();
    const clientSessionId = context.req.query("clientSessionId")?.trim() ?? "";
    if (!documentId || !clientSessionId) {
      return invalidRequest("Document and client session are required");
    }
    const scopeError = await resolveLibraryScope(dependencies, documentId);
    if (scopeError) return errorResponse(scopeError);

    const encoder = new TextEncoder();
    let entry: BrowserClientEntry | null = null;
    let pingInterval: ReturnType<typeof setInterval> | null = null;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const target = new BrowserDocumentSyncTarget((serializedEvent) => {
          controller.enqueue(encoder.encode(`data: ${serializedEvent}\n\n`));
        });
        entry = {
          projectId: LOCAL_LIBRARY_HTTP_SCOPE,
          engine: "yjs",
          request: { documentId, clientSessionId },
          target,
        };
        clients.replace(entry);
        const subscribed = dependencies.hub.subscribe(target, entry.request);
        if (!subscribed.ok) {
          clients.remove(entry);
          controller.error(new Error(subscribed.error.message));
          return;
        }
        pingInterval = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(": ping\n\n"));
          } catch {
            if (pingInterval) clearInterval(pingInterval);
          }
        }, SSE_PING_INTERVAL_MS);
      },
      cancel() {
        if (pingInterval) clearInterval(pingInterval);
        if (entry) clients.remove(entry);
      },
    });
    context.req.raw.signal.addEventListener("abort", () => {
      if (pingInterval) clearInterval(pingInterval);
      if (entry) clients.remove(entry);
    }, { once: true });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-store",
        Connection: "keep-alive",
      },
    });
  });

  app.post("/api/library/documents/:documentId/sync", async (context) => {
    const documentId = context.req.param("documentId").trim();
    try {
      const request = decodeDocumentSyncHttpRequest(
        documentId,
        await readBinaryBody(context, MAX_SYNC_REQUEST_BYTES),
      );
      const scopeError = await resolveLibraryScope(dependencies, documentId);
      if (scopeError) return errorResponse(scopeError);
      const client = requireBrowserClient(clients, LOCAL_LIBRARY_HTTP_SCOPE, request);
      if (!client.ok) return errorResponse(client.error);
      const result = await dependencies.hub.sync(client.value.target, request);
      return result.ok
        ? binaryResponse(encodeDocumentSyncHttpResponse(result.value))
        : errorResponse(result.error);
    } catch (error) {
      return invalidRequest(error instanceof Error ? error.message : "Invalid sync request");
    }
  });

  app.post("/api/library/documents/:documentId/updates", async (context) => {
    const documentId = context.req.param("documentId").trim();
    try {
      const request = decodeDocumentApplyHttpRequest(
        documentId,
        await readBinaryBody(context, MAX_APPLY_REQUEST_BYTES),
      );
      const scopeError = await resolveLibraryScope(dependencies, documentId, "write");
      if (scopeError) return errorResponse(scopeError);
      const client = requireBrowserClient(clients, LOCAL_LIBRARY_HTTP_SCOPE, request);
      if (!client.ok) return errorResponse(client.error);
      const result = await dependencies.hub.applyUpdate(client.value.target, request);
      return result.ok
        ? binaryResponse(encodeDocumentApplyHttpAck(result.value))
        : errorResponse(result.error);
    } catch (error) {
      return invalidRequest(error instanceof Error ? error.message : "Invalid update request");
    }
  });

  app.post("/api/library/documents/:documentId/awareness", async (context) => {
    const documentId = context.req.param("documentId").trim();
    try {
      const request = decodeDocumentAwarenessHttpRequest(
        documentId,
        await readBinaryBody(context, MAX_AWARENESS_REQUEST_BYTES),
      );
      const scopeError = await resolveLibraryScope(dependencies, documentId);
      if (scopeError) return errorResponse(scopeError);
      const client = requireBrowserClient(clients, LOCAL_LIBRARY_HTTP_SCOPE, request);
      if (!client.ok) return errorResponse(client.error);
      const result = dependencies.hub.publishAwareness(client.value.target, request);
      return result.ok ? context.json(result.value) : errorResponse(result.error);
    } catch (error) {
      return invalidRequest(
        error instanceof Error ? error.message : "Invalid Awareness request",
      );
    }
  });

  app.post(
    "/api/library/documents/:documentId/relocation-leases/:leaseId/responses",
    async (context) => {
      const documentId = context.req.param("documentId").trim();
      const leaseId = context.req.param("leaseId").trim();
      if (!documentId || !leaseId) {
        return invalidRequest("Document and relocation lease are required");
      }
      try {
        const request = await readRelocationLeaseJsonBody(context);
        if (request.documentId !== documentId || request.leaseId !== leaseId) {
          return invalidRequest("Relocation lease response does not match its route");
        }
        const scopeError = await resolveLibraryScope(dependencies, documentId);
        if (scopeError) return errorResponse(scopeError);
        const client = requireAnyBrowserClient(
          clients,
          LOCAL_LIBRARY_HTTP_SCOPE,
          request,
        );
        if (!client.ok) return errorResponse(client.error);
        const result = dependencies.hub.respondToRelocationLease(
          client.value.target,
          request,
        );
        return result.ok ? context.json(result.value) : errorResponse(result.error);
      } catch (error) {
        return invalidRequest(
          error instanceof Error ? error.message : "Invalid relocation lease response",
        );
      }
    },
  );
};

export const registerDocumentSyncHttpRoutes = (
  app: Hono,
  dependencies: DocumentSyncHttpDependencies,
): DocumentSyncHttpClients => {
  const clients = new DocumentSyncHttpClients();
  registerLibraryDocumentSyncHttpRoutes(app, dependencies, clients);

  app.get(
    "/api/projects/:projectId/blocks/:ownerBlockId/document",
    async (context) => {
      const projectId = context.req.param("projectId").trim();
      const ownerBlockId = context.req.param("ownerBlockId").trim();
      if (!projectId || !ownerBlockId) {
        return invalidRequest("Project and owner Block are required");
      }
      try {
        const descriptor = await dependencies.getOwnedDocumentDescriptor(
          projectId,
          ownerBlockId,
        );
        if (
          descriptor.projectId !== projectId ||
          descriptor.ownerBlockId !== ownerBlockId
        ) {
          return errorResponse(
            commandError(
              "invalid_response",
              "Owned Document descriptor escaped its requested scope",
            ),
          );
        }
        return new Response(
          encodeOwnedDocumentDescriptorHttp(descriptor),
          {
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
            },
          },
        );
      } catch (error) {
        return errorResponse(
          commandError(
            "document_not_found",
            error instanceof Error
              ? error.message
              : "Owned Document does not exist",
          ),
        );
      }
    },
  );

  app.post(
    "/api/projects/:projectId/blocks/:ownerBlockId/document/prepare",
    async (context) => {
      const projectId = context.req.param("projectId").trim();
      const ownerBlockId = context.req.param("ownerBlockId").trim();
      if (!projectId || !ownerBlockId) {
        return invalidRequest("Project and owner Block are required");
      }
      try {
        const prepared = await dependencies.prepareOwnedBlockDocument(
          projectId,
          ownerBlockId,
        );
        if (!prepared.ok) return errorResponse(prepared.error);
        const descriptor = prepared.value;
        if (
          descriptor.projectId !== projectId ||
          descriptor.ownerBlockId !== ownerBlockId
        ) {
          return errorResponse(
            commandError(
              "invalid_response",
              "Prepared Document descriptor escaped its requested scope",
            ),
          );
        }
        return new Response(
          encodeOwnedDocumentDescriptorHttp(descriptor),
          {
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": "no-store",
            },
          },
        );
      } catch (error) {
        return errorResponse(
          commandError(
            "transport_unavailable",
            error instanceof Error
              ? error.message
              : "Owned Document preparation failed",
            { retryable: true },
          ),
        );
      }
    },
  );

  app.get(
    "/api/projects/:projectId/documents/:documentId/events",
    async (context) => {
      const projectId = context.req.param("projectId");
      const documentId = context.req.param("documentId");
      const clientSessionId =
        context.req.query("clientSessionId")?.trim() ?? "";
      if (!projectId || !documentId || !clientSessionId) {
        return invalidRequest(
          "Project, Document, and client session are required",
        );
      }
      const scopeError = await resolveProjectScope(
        dependencies,
        projectId,
        documentId,
      );
      if (scopeError) return errorResponse(scopeError);

      const encoder = new TextEncoder();
      let entry: BrowserClientEntry | null = null;
      let pingInterval: ReturnType<typeof setInterval> | null = null;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const send = (serializedEvent: string): void => {
            controller.enqueue(encoder.encode(`data: ${serializedEvent}\n\n`));
          };
          const target = new BrowserDocumentSyncTarget(send);
          entry = {
            projectId,
            engine: "yjs",
            request: { documentId, clientSessionId },
            target,
          };
          clients.replace(entry);
          const subscribed = dependencies.hub.subscribe(target, entry.request);
          if (!subscribed.ok) {
            clients.remove(entry);
            controller.error(new Error(subscribed.error.message));
            return;
          }
          pingInterval = setInterval(() => {
            try {
              controller.enqueue(encoder.encode(": ping\n\n"));
            } catch {
              if (pingInterval) clearInterval(pingInterval);
            }
          }, SSE_PING_INTERVAL_MS);
        },
        cancel() {
          if (pingInterval) clearInterval(pingInterval);
          if (entry) clients.remove(entry);
        },
      });
      context.req.raw.signal.addEventListener(
        "abort",
        () => {
          if (pingInterval) clearInterval(pingInterval);
          if (entry) clients.remove(entry);
        },
        { once: true },
      );

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-store",
          Connection: "keep-alive",
        },
      });
    },
  );

  app.post(
    "/api/projects/:projectId/documents/:documentId/sync",
    async (context) => {
      const projectId = context.req.param("projectId");
      const documentId = context.req.param("documentId");
      try {
        const request = decodeDocumentSyncHttpRequest(
          documentId,
          await readBinaryBody(context, MAX_SYNC_REQUEST_BYTES),
        );
        const scopeError = await resolveProjectScope(
          dependencies,
          projectId,
          documentId,
        );
        if (scopeError) return errorResponse(scopeError);
        const client = requireBrowserClient(clients, projectId, request);
        if (!client.ok) return errorResponse(client.error);
        const result = await dependencies.hub.sync(
          client.value.target,
          request,
        );
        return result.ok
          ? binaryResponse(encodeDocumentSyncHttpResponse(result.value))
          : errorResponse(result.error);
      } catch (error) {
        return invalidRequest(
          error instanceof Error ? error.message : "Invalid sync request",
        );
      }
    },
  );

  app.get(
    "/api/projects/:projectId/documents/:documentId/canvas/events",
    async (context) => {
      const projectId = context.req.param("projectId").trim();
      const documentId = context.req.param("documentId").trim();
      const clientSessionId = context.req.query("clientSessionId")?.trim() ?? "";
      if (!projectId || !documentId || !clientSessionId) {
        return invalidRequest("Project, Document, and client session are required");
      }
      const scopeError = await resolveProjectScope(dependencies, projectId, documentId);
      if (scopeError) return errorResponse(scopeError);
      const encoder = new TextEncoder();
      let entry: BrowserClientEntry | null = null;
      let pingInterval: ReturnType<typeof setInterval> | null = null;
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const target = new BrowserDocumentSyncTarget((serialized) => {
            controller.enqueue(encoder.encode(`data: ${serialized}\n\n`));
          });
          const request: CanvasSceneSubscribeRequest = {
            version: 1,
            projectId,
            documentId,
            clientSessionId,
          };
          entry = { projectId, engine: "canvas_scene", request, target };
          clients.replace(entry);
          const result = dependencies.hub.subscribeCanvasScene(target, request);
          if (!result.ok) {
            clients.remove(entry);
            controller.error(new Error(result.error.message));
            return;
          }
          pingInterval = setInterval(() => {
            try {
              controller.enqueue(encoder.encode(": ping\n\n"));
            } catch {
              if (pingInterval) clearInterval(pingInterval);
            }
          }, SSE_PING_INTERVAL_MS);
        },
        cancel() {
          if (pingInterval) clearInterval(pingInterval);
          if (entry) clients.remove(entry);
        },
      });
      context.req.raw.signal.addEventListener("abort", () => {
        if (pingInterval) clearInterval(pingInterval);
        if (entry) clients.remove(entry);
      }, { once: true });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-store",
          Connection: "keep-alive",
        },
      });
    },
  );

  app.post(
    "/api/projects/:projectId/documents/:documentId/canvas/sync",
    bodyLimit({
      maxSize: MAX_CANVAS_SCENE_MUTATION_BYTES,
      onError: () => invalidRequest("Canvas sync request is too large"),
    }),
    async (context) => {
      const projectId = context.req.param("projectId").trim();
      const documentId = context.req.param("documentId").trim();
      try {
        const request = decodeCanvasSceneSyncRequestHttp(
          await readCanvasJsonBody(context), projectId, documentId,
        );
        const client = clients.get(projectId, request, "canvas_scene");
        if (!client) return invalidRequest("Open the Canvas event stream before syncing");
        const result = await dependencies.hub.syncCanvasScene(client.target, request);
        return new Response(encodeCanvasSceneSyncResultHttp(result), {
          status: result.ok ? 200 : 409,
          headers: { "Content-Type": CANVAS_SCENE_HTTP_CONTENT_TYPE },
        });
      } catch (error) {
        return invalidRequest(error instanceof Error ? error.message : "Invalid Canvas sync request");
      }
    },
  );

  app.post(
    "/api/projects/:projectId/documents/:documentId/canvas/mutations",
    bodyLimit({
      maxSize: MAX_CANVAS_SCENE_MUTATION_BYTES,
      onError: () => invalidRequest("Canvas mutation request is too large"),
    }),
    async (context) => {
      const projectId = context.req.param("projectId").trim();
      const documentId = context.req.param("documentId").trim();
      try {
        const request = decodeCanvasSceneMutationRequestHttp(
          await readCanvasJsonBody(context), projectId, documentId,
        );
        const scopeError = await resolveProjectScope(
          dependencies,
          projectId,
          documentId,
          "write",
        );
        if (scopeError) return errorResponse(scopeError);
        const client = clients.get(projectId, request, "canvas_scene");
        if (!client) return invalidRequest("Open the Canvas event stream before mutating");
        const result = await dependencies.hub.applyCanvasSceneMutation(client.target, request);
        return new Response(encodeCanvasSceneMutationResultHttp(result), {
          status: result.ok ? 200 : 409,
          headers: { "Content-Type": CANVAS_SCENE_HTTP_CONTENT_TYPE },
        });
      } catch (error) {
        return invalidRequest(error instanceof Error ? error.message : "Invalid Canvas mutation request");
      }
    },
  );

  app.post(
    "/api/projects/:projectId/documents/:documentId/updates",
    async (context) => {
      const projectId = context.req.param("projectId");
      const documentId = context.req.param("documentId");
      try {
        const request = decodeDocumentApplyHttpRequest(
          documentId,
          await readBinaryBody(context, MAX_APPLY_REQUEST_BYTES),
        );
        const scopeError = await resolveProjectScope(
          dependencies,
          projectId,
          documentId,
          "write",
        );
        if (scopeError) return errorResponse(scopeError);
        const client = requireBrowserClient(clients, projectId, request);
        if (!client.ok) return errorResponse(client.error);
        const result = await dependencies.hub.applyUpdate(
          client.value.target,
          request,
        );
        return result.ok
          ? binaryResponse(encodeDocumentApplyHttpAck(result.value))
          : errorResponse(result.error);
      } catch (error) {
        return invalidRequest(
          error instanceof Error ? error.message : "Invalid update request",
        );
      }
    },
  );

  app.post(
    "/api/projects/:projectId/documents/:documentId/awareness",
    async (context) => {
      const projectId = context.req.param("projectId");
      const documentId = context.req.param("documentId");
      try {
        const request = decodeDocumentAwarenessHttpRequest(
          documentId,
          await readBinaryBody(context, MAX_AWARENESS_REQUEST_BYTES),
        );
        const scopeError = await resolveProjectScope(
          dependencies,
          projectId,
          documentId,
        );
        if (scopeError) return errorResponse(scopeError);
        const client = requireBrowserClient(clients, projectId, request);
        if (!client.ok) return errorResponse(client.error);
        const result = dependencies.hub.publishAwareness(
          client.value.target,
          request,
        );
        return result.ok
          ? context.json(result.value)
          : errorResponse(result.error);
      } catch (error) {
        return invalidRequest(
          error instanceof Error ? error.message : "Invalid Awareness request",
        );
      }
    },
  );

  app.post(
    "/api/projects/:projectId/documents/:documentId/relocation-leases/:leaseId/responses",
    async (context) => {
      const projectId = context.req.param("projectId").trim();
      const documentId = context.req.param("documentId").trim();
      const leaseId = context.req.param("leaseId").trim();
      if (!projectId || !documentId || !leaseId) {
        return invalidRequest(
          "Project, Document, and relocation lease are required",
        );
      }
      try {
        const request = await readRelocationLeaseJsonBody(context);
        if (request.documentId !== documentId || request.leaseId !== leaseId) {
          return invalidRequest(
            "Relocation lease response does not match its route",
          );
        }
        const scopeError = await resolveProjectScope(
          dependencies,
          projectId,
          documentId,
        );
        if (scopeError) return errorResponse(scopeError);
        const client = requireAnyBrowserClient(clients, projectId, request);
        if (!client.ok) return errorResponse(client.error);
        const result = dependencies.hub.respondToRelocationLease(
          client.value.target,
          request,
        );
        return result.ok
          ? context.json(result.value)
          : errorResponse(result.error);
      } catch (error) {
        return invalidRequest(
          error instanceof Error
            ? error.message
            : "Invalid relocation lease response",
        );
      }
    },
  );

  return clients;
};
