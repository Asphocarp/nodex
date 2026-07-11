import { EventEmitter } from "node:events";
import type { Context, Hono } from "hono";
import {
  DOCUMENT_HTTP_CONTENT_TYPE,
  decodeDocumentApplyHttpRequest,
  decodeDocumentAwarenessHttpRequest,
  decodeDocumentSyncHttpRequest,
  encodeDocumentApplyHttpAck,
  encodeDocumentHttpError,
  encodeOwnedBlockDocumentDescriptorHttp,
  encodeDocumentRealtimeSseEvent,
  encodeDocumentSyncHttpResponse,
} from "../shared/block-documents/http-contract";
import {
  MAX_CARD_DOCUMENT_STATE_BYTES,
  MAX_CARD_DOCUMENT_UPDATE_BYTES,
} from "../shared/block-documents/contracts";
import type { OwnedBlockDocumentDescriptor } from "../shared/block-documents/contracts";
import type {
  RelocationCommandError,
  RelocationCommandResult,
} from "../shared/block-documents/contracts";
import {
  decodeRelocationHttpRequest,
  encodeRelocationHttpError,
  encodeRelocationHttpResult,
  RELOCATION_HTTP_CONTENT_TYPE,
} from "../shared/block-documents/relocation-transport";
import {
  MAX_DOCUMENT_AWARENESS_UPDATE_BYTES,
  parseDocumentRelocationLeaseResponseRequest,
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
  DocumentSyncHub,
  type DocumentSyncClientTarget,
} from "./document-sync-hub";

const SSE_PING_INTERVAL_MS = 30_000;
const DOCUMENT_SYNC_EVENT_CHANNEL = "document-sync:event";
const MAX_SYNC_REQUEST_BYTES =
  MAX_DOCUMENT_HTTP_METADATA_BYTES + MAX_CARD_DOCUMENT_STATE_BYTES + 8;
const MAX_APPLY_REQUEST_BYTES =
  MAX_DOCUMENT_HTTP_METADATA_BYTES + MAX_CARD_DOCUMENT_UPDATE_BYTES + 8;
const MAX_AWARENESS_REQUEST_BYTES =
  MAX_DOCUMENT_HTTP_METADATA_BYTES + MAX_DOCUMENT_AWARENESS_UPDATE_BYTES + 8;
const MAX_RELOCATION_LEASE_RESPONSE_BYTES = 8 * 1024;
const MAX_RELOCATION_REQUEST_BYTES = MAX_DOCUMENT_HTTP_METADATA_BYTES;

export interface DocumentSyncHttpDependencies {
  readonly hub: DocumentSyncHub;
  readonly getDocumentProjectId: (
    documentId: string,
  ) => Promise<DocumentSyncCommandResult<string>>;
  readonly getOwnedBlockDocumentDescriptor: (
    projectId: string,
    ownerBlockId: string,
  ) => Promise<OwnedBlockDocumentDescriptor>;
  readonly prepareOwnedBlockDocument: (
    projectId: string,
    ownerBlockId: string,
  ) => Promise<DocumentSyncCommandResult<OwnedBlockDocumentDescriptor>>;
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

const relocationBinaryResponse = (body: Uint8Array): Response =>
  new Response(copyToArrayBuffer(body), {
    headers: {
      "Content-Type": RELOCATION_HTTP_CONTENT_TYPE,
      "Cache-Control": "no-store",
    },
  });

const relocationStatusForError = (error: RelocationCommandError): number => {
  if (
    error.code === "source_document_not_found" ||
    error.code === "target_document_not_found" ||
    error.code === "block_not_found"
  ) {
    return 404;
  }
  if (error.code === "unknown" && error.retryable) return 503;
  if (
    error.code === "store_epoch_mismatch" ||
    error.code === "relocation_id_collision" ||
    error.code === "relocation_lease_timeout" ||
    error.code === "document_not_ready" ||
    error.code === "document_generation_mismatch" ||
    error.code === "source_head_mismatch" ||
    error.code === "target_head_changed" ||
    error.code === "block_location_mismatch" ||
    error.code === "block_location_revision_mismatch" ||
    error.code === "block_relocated" ||
    error.code === "recovery_required"
  ) {
    return 409;
  }
  return 400;
};

const relocationErrorResponse = (error: RelocationCommandError): Response =>
  new Response(encodeRelocationHttpError(error), {
    status: relocationStatusForError(error),
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });

const relocationFailure = (
  code: RelocationCommandError["code"],
  message: string,
  options: {
    readonly retryable?: boolean;
    readonly reloadRequired?: boolean;
    readonly relocationId?: string;
  } = {},
): Extract<RelocationCommandResult, { readonly ok: false }> => ({
  ok: false,
  error: {
    code,
    message,
    retryable: options.retryable ?? false,
    reloadRequired: options.reloadRequired ?? false,
    ...(options.relocationId ? { relocationId: options.relocationId } : {}),
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

const readRelocationJsonBody = async (context: Context): Promise<string> => {
  const contentType = context.req.header("content-type")?.split(";", 1)[0];
  if (contentType !== "application/json") {
    throw new TypeError("Block relocation requires application/json");
  }
  const contentLength = Number(context.req.header("content-length"));
  if (
    Number.isFinite(contentLength) &&
    contentLength > MAX_RELOCATION_REQUEST_BYTES
  ) {
    throw new TypeError("Block relocation request is too large");
  }
  const body = await context.req.text();
  if (
    new TextEncoder().encode(body).byteLength > MAX_RELOCATION_REQUEST_BYTES
  ) {
    throw new TypeError("Block relocation request is too large");
  }
  return body;
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
    const event = args[0] as DocumentSyncRealtimeEvent;
    this.enqueue(encodeDocumentRealtimeSseEvent(event));
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
  readonly request: DocumentSyncSubscribeRequest;
  readonly target: BrowserDocumentSyncTarget;
}

const browserClientKey = (
  projectId: string,
  request: DocumentSyncSubscribeRequest,
): string =>
  JSON.stringify([projectId, request.documentId, request.clientSessionId]);

export class DocumentSyncHttpClients {
  private readonly entries = new Map<string, BrowserClientEntry>();

  replace(entry: BrowserClientEntry): void {
    const key = browserClientKey(entry.projectId, entry.request);
    const previous = this.entries.get(key);
    if (previous && previous.target !== entry.target) {
      previous.target.destroy();
    }
    this.entries.set(key, entry);
  }

  get(
    projectId: string,
    request: DocumentSyncSubscribeRequest,
  ): BrowserClientEntry | null {
    return this.entries.get(browserClientKey(projectId, request)) ?? null;
  }

  remove(entry: BrowserClientEntry): void {
    const key = browserClientKey(entry.projectId, entry.request);
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
): Promise<DocumentSyncCommandError | null> => {
  let result: DocumentSyncCommandResult<string>;
  try {
    result = await dependencies.getDocumentProjectId(documentId);
  } catch {
    return commandError(
      "transport_unavailable",
      "The durable document writer is unavailable",
      { retryable: true },
    );
  }
  if (!result.ok) return result.error;
  if (result.value === projectId) return null;
  return commandError(
    "document_not_found",
    "Document does not exist in this Project",
  );
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

export const registerDocumentSyncHttpRoutes = (
  app: Hono,
  dependencies: DocumentSyncHttpDependencies,
): DocumentSyncHttpClients => {
  const clients = new DocumentSyncHttpClients();

  app.get(
    "/api/projects/:projectId/blocks/:ownerBlockId/document",
    async (context) => {
      const projectId = context.req.param("projectId").trim();
      const ownerBlockId = context.req.param("ownerBlockId").trim();
      if (!projectId || !ownerBlockId) {
        return invalidRequest("Project and owner Block are required");
      }
      try {
        const descriptor = await dependencies.getOwnedBlockDocumentDescriptor(
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
          encodeOwnedBlockDocumentDescriptorHttp(descriptor),
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
          encodeOwnedBlockDocumentDescriptorHttp(descriptor),
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
    "/api/projects/:projectId/documents/:documentId/relocations",
    async (context) => {
      const projectId = context.req.param("projectId").trim();
      const documentId = context.req.param("documentId").trim();
      if (!projectId || !documentId) {
        const failure = relocationFailure(
          "invalid_relocation_request",
          "Project and source Document are required",
        );
        return relocationErrorResponse(failure.error);
      }
      try {
        const request = decodeRelocationHttpRequest(
          await readRelocationJsonBody(context),
          projectId,
          documentId,
        );
        const scopeError = await resolveProjectScope(
          dependencies,
          projectId,
          documentId,
        );
        if (scopeError) {
          const failure = relocationFailure(
            scopeError.code === "document_not_found"
              ? "source_document_not_found"
              : "unknown",
            scopeError.message,
            {
              retryable: scopeError.retryable,
              relocationId: request.intent.relocationId,
            },
          );
          return relocationErrorResponse(failure.error);
        }
        const client = requireBrowserClient(clients, projectId, {
          documentId,
          clientSessionId: request.clientSessionId,
        });
        if (!client.ok) {
          const failure = relocationFailure(
            "invalid_relocation_request",
            "Open the source Document event stream before relocating Blocks",
            { relocationId: request.intent.relocationId },
          );
          return relocationErrorResponse(failure.error);
        }
        const result = await dependencies.hub.relocate(
          client.value.target,
          request.intent,
          request.clientSessionId,
        );
        return result.ok
          ? relocationBinaryResponse(encodeRelocationHttpResult(result.value))
          : relocationErrorResponse(result.error);
      } catch (error) {
        const failure = relocationFailure(
          "invalid_relocation_request",
          error instanceof Error ? error.message : "Invalid Block relocation",
        );
        return relocationErrorResponse(failure.error);
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
        const client = requireBrowserClient(clients, projectId, request);
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
