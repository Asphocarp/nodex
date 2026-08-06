import { request as httpRequest, type IncomingMessage } from "node:http";
import { CORE_TRANSPORT_BUDGETS } from "@nodex/core-protocol";

import {
  decodeBoundedJson,
  encodeBoundedJson,
} from "./codec";
import { SseParser } from "./sse-parser";
import {
  DOCUMENT_HTTP_CONTENT_TYPE,
  decodeDocumentRealtimeSseEvent,
} from "../../shared/block-documents/http-contract";
import type { DocumentSyncRealtimeEvent } from "../../shared/block-documents/document-sync";
import type {
  CoreEventEnvelope,
  CoreEventReplayRequired,
  CoreEventSubscription,
  BlockRecordCommittedValue,
  DocumentResyncRequired,
} from "./types";

const MAX_JSON_REQUEST_BYTES =
  CORE_TRANSPORT_BUDGETS.ordinary_json_request_bytes;
const MAX_JSON_RESPONSE_BYTES =
  CORE_TRANSPORT_BUDGETS.ordinary_json_response_bytes;
const MAX_DOCUMENT_JSON_REQUEST_BYTES =
  CORE_TRANSPORT_BUDGETS.document_json_request_bytes;
const MAX_DOCUMENT_RESPONSE_BYTES =
  CORE_TRANSPORT_BUDGETS.document_response_bytes;
const MAX_EVENT_FRAME_BYTES = CORE_TRANSPORT_BUDGETS.event_frame_bytes;
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_CONFIGURED_REQUEST_TIMEOUT_MS = 120_000;
const DOCUMENT_ROUTE_PREFIX = "/core/v1/modules/document/";

export interface UdsHttpTransportOptions {
  readonly maximumJsonResponseBytes?: number;
  readonly requestTimeoutMs?: number;
}

export type DocumentFrameResponse<Response> =
  | { readonly kind: "binary"; readonly bytes: Uint8Array }
  | { readonly kind: "json"; readonly value: Response };

export class CoreHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "CoreHttpError";
  }
}

export class CoreResponseTooLargeError extends Error {
  constructor(
    readonly maximumBytes: number,
    readonly observedAtLeastBytes: number,
  ) {
    super(`Core response exceeds ${maximumBytes} bytes`);
    this.name = "CoreResponseTooLargeError";
  }
}

export class CoreEventReplayError extends Error {
  constructor(readonly boundary: CoreEventReplayRequired) {
    super("Core event replay requires fresh reads");
    this.name = "CoreEventReplayError";
  }
}

export class CoreEventCompatibilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CoreEventCompatibilityError";
  }
}

export type CoreTransportErrorKind =
  | "aborted"
  | "connection_lost"
  | "timeout"
  | "unreachable"
  | "unknown";

export type CoreTransportPhase = "connect" | "open" | "response";

export class CoreTransportError extends Error {
  constructor(
    readonly kind: CoreTransportErrorKind,
    readonly phase: CoreTransportPhase,
    readonly code: string | null,
    cause: unknown,
  ) {
    super(coreTransportMessage(kind, code), { cause });
    this.name = "CoreTransportError";
  }
}

export const isDefinitiveCoreGenerationLoss = (error: unknown): boolean =>
  error instanceof CoreTransportError
  && (error.kind === "connection_lost" || error.kind === "unreachable");

const coreTransportMessage = (
  kind: CoreTransportErrorKind,
  code: string | null,
): string => {
  const suffix = code ? ` (${code})` : "";
  switch (kind) {
    case "aborted":
      return `Core request was aborted${suffix}`;
    case "connection_lost":
      return `Core connection was lost${suffix}`;
    case "timeout":
      return `Core request timed out${suffix}`;
    case "unreachable":
      return `Core is unreachable${suffix}`;
    case "unknown":
      return `Core transport failed${suffix}`;
  }
};

const transportCode = (error: unknown): string | null => {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null;
  }
  return typeof error.code === "string" ? error.code : null;
};

const normalizeTransportError = (
  error: unknown,
  phase: CoreTransportPhase,
): unknown => {
  if (
    error instanceof CoreTransportError
    || error instanceof CoreHttpError
    || error instanceof CoreResponseTooLargeError
    || error instanceof CoreEventCompatibilityError
    || error instanceof CoreEventReplayError
  ) {
    return error;
  }
  const code = transportCode(error);
  if (code === "ABORT_ERR" || (error instanceof Error && error.name === "AbortError")) {
    return new CoreTransportError("aborted", phase, code, error);
  }
  if (code === "ENOENT" || code === "ECONNREFUSED") {
    return new CoreTransportError("unreachable", phase, code, error);
  }
  if (code === "ECONNRESET" || code === "EPIPE") {
    return new CoreTransportError("connection_lost", phase, code, error);
  }
  if (code === "ETIMEDOUT") {
    return new CoreTransportError("timeout", phase, code, error);
  }
  return new CoreTransportError("unknown", phase, code, error);
};

interface CoreEventContract {
  readonly transportVersion: number;
  readonly eventVersion: number;
  readonly storeEpoch: string;
}

export class UdsHttpTransport {
  readonly #maximumJsonResponseBytes: number;
  readonly #requestTimeoutMs: number;
  #eventContract: CoreEventContract | null = null;

  constructor(
    readonly socketPath: string,
    readonly authCapability: string,
    options: UdsHttpTransportOptions = {},
  ) {
    this.#maximumJsonResponseBytes = boundedPositiveInteger(
      options.maximumJsonResponseBytes ?? MAX_JSON_RESPONSE_BYTES,
      MAX_JSON_RESPONSE_BYTES,
      "Core JSON response limit",
    );
    this.#requestTimeoutMs = boundedPositiveInteger(
      options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS,
      MAX_CONFIGURED_REQUEST_TIMEOUT_MS,
      "Core request timeout",
    );
  }

  configureEventContract(contract: CoreEventContract): void {
    if (
      !Number.isSafeInteger(contract.transportVersion) ||
      !Number.isSafeInteger(contract.eventVersion) ||
      !contract.storeEpoch
    ) {
      throw new CoreEventCompatibilityError("Core event contract is invalid");
    }
    if (this.#eventContract !== null) {
      throw new CoreEventCompatibilityError("Core event contract is already configured");
    }
    this.#eventContract = contract;
  }

  requestJson<Response>(
    method: "GET" | "POST",
    requestPath: string,
    body?: unknown,
    requestHeaders: Readonly<Record<string, string>> = {},
  ): Promise<Response> {
    const documentRoute = requestPath.startsWith(DOCUMENT_ROUTE_PREFIX);
    const maximumRequestBytes = documentRoute
      ? MAX_DOCUMENT_JSON_REQUEST_BYTES
      : MAX_JSON_REQUEST_BYTES;
    const maximumResponseBytes = documentRoute
      ? MAX_DOCUMENT_RESPONSE_BYTES
      : this.#maximumJsonResponseBytes;
    const encodedBody = body === undefined
      ? undefined
      : encodeBoundedJson(body, maximumRequestBytes, "Core request");

    return new Promise<Response>((resolve, reject) => {
      let settled = false;
      const settle = (action: () => void): void => {
        if (settled) return;
        settled = true;
        action();
      };
      const request = httpRequest(
        {
          socketPath: this.socketPath,
          path: requestPath,
          method,
          agent: false,
          headers: {
            ...requestHeaders,
            accept: "application/json",
            authorization: `Bearer ${this.authCapability}`,
            ...(encodedBody
              ? {
                  "content-length": encodedBody.byteLength,
                  "content-type": "application/json",
                }
              : {}),
          },
        },
        (response) => {
          collectResponse(response, maximumResponseBytes)
            .then((bytes) => {
              const value = decodeBoundedJson<Response>(
                bytes,
                maximumResponseBytes,
                "Core response",
              );
              const status = response.statusCode ?? 0;
              if (status >= 200 && status < 300) {
                settle(() => resolve(value));
                return;
              }
              settle(() => reject(new CoreHttpError(status, errorMessage(value))));
            })
            .catch((error: unknown) =>
              settle(() => reject(normalizeTransportError(error, "response")))
            );
        },
      );
      request.setTimeout(this.#requestTimeoutMs, () => {
        request.destroy(new CoreTransportError("timeout", "response", "ETIMEDOUT", null));
      });
      request.on("error", (error) =>
        settle(() => reject(normalizeTransportError(error, "connect")))
      );
      if (encodedBody) request.write(encodedBody);
      request.end();
    });
  }

  requestDocumentFrame<Response>(
    requestPath: string,
    body: Uint8Array,
    requestHeaders: Readonly<Record<string, string>>,
    maximumResponseBytes: number,
  ): Promise<DocumentFrameResponse<Response>> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const settle = (action: () => void): void => {
        if (settled) return;
        settled = true;
        action();
      };
      const request = httpRequest(
        {
          socketPath: this.socketPath,
          path: requestPath,
          method: "POST",
          agent: false,
          headers: {
            ...requestHeaders,
            accept: `${DOCUMENT_HTTP_CONTENT_TYPE}, application/json`,
            authorization: `Bearer ${this.authCapability}`,
            "content-length": body.byteLength,
            "content-type": DOCUMENT_HTTP_CONTENT_TYPE,
          },
        },
        (response) => {
          collectResponse(response, maximumResponseBytes)
            .then((bytes) => {
              const status = response.statusCode ?? 0;
              if (status < 200 || status >= 300) {
                const value = decodeBoundedJson<unknown>(
                  bytes,
                  maximumResponseBytes,
                  "Core Document error response",
                );
                settle(() => reject(new CoreHttpError(status, errorMessage(value))));
                return;
              }
              const contentType = response.headers["content-type"]?.split(";", 1)[0];
              if (contentType === DOCUMENT_HTTP_CONTENT_TYPE) {
                settle(() => resolve({ kind: "binary", bytes }));
                return;
              }
              if (contentType !== "application/json") {
                settle(() => reject(new Error("Core Document response has an invalid Content-Type")));
                return;
              }
              const value = decodeBoundedJson<Response>(
                bytes,
                maximumResponseBytes,
                "Core Document response",
              );
              settle(() => resolve({ kind: "json", value }));
            })
            .catch((error: unknown) =>
              settle(() => reject(normalizeTransportError(error, "response")))
            );
        },
      );
      request.setTimeout(this.#requestTimeoutMs, () => {
        request.destroy(new CoreTransportError("timeout", "response", "ETIMEDOUT", null));
      });
      request.on("error", (error) =>
        settle(() => reject(normalizeTransportError(error, "connect")))
      );
      request.write(body);
      request.end();
    });
  }

  openEventStream(
    after: number,
    onEvent: (event: CoreEventEnvelope) => void,
    requestHeaders: Readonly<Record<string, string>> = {},
    onResyncRequired?: (event: DocumentResyncRequired) => void,
    onDocumentRealtime?: (event: DocumentSyncRealtimeEvent) => void,
    onCoreResyncRequired?: (event: CoreEventReplayRequired) => void,
    signal?: AbortSignal,
  ): Promise<CoreEventSubscription> {
    if (!Number.isSafeInteger(after) || after < 0) {
      return Promise.reject(new Error("Event sequence must be a non-negative integer"));
    }
    if (this.#eventContract === null) {
      return Promise.reject(
        new CoreEventCompatibilityError("Core event stream opened before handshake"),
      );
    }
    const eventContract = this.#eventContract;

    return new Promise<CoreEventSubscription>((resolve, reject) => {
      let opened = false;
      let closed = false;
      let resolveDone: (() => void) | undefined;
      let rejectDone: ((error: unknown) => void) | undefined;
      const done = new Promise<void>((doneResolve, doneReject) => {
        resolveDone = doneResolve;
        rejectDone = doneReject;
      });
      const request = httpRequest(
        {
          socketPath: this.socketPath,
          path: `/core/v1/events?after=${after}`,
          method: "GET",
          agent: false,
          signal,
          headers: {
            ...requestHeaders,
            accept: "text/event-stream",
            authorization: `Bearer ${this.authCapability}`,
          },
        },
        (response) => {
          request.setTimeout(0);
          const status = response.statusCode ?? 0;
          if (status !== 200) {
            collectResponse(response, this.#maximumJsonResponseBytes)
              .then((bytes) => {
                const value = decodeBoundedJson<unknown>(
                  bytes,
                  this.#maximumJsonResponseBytes,
                  "Core event error response",
                );
                reject(new CoreHttpError(status, errorMessage(value)));
              })
              .catch((error: unknown) => reject(normalizeTransportError(error, "response")));
            return;
          }

          opened = true;
          const parser = new SseParser(MAX_EVENT_FRAME_BYTES);
          const fail = (error: unknown): void => {
            if (closed) return;
            closed = true;
            response.destroy();
            rejectDone?.(normalizeTransportError(error, "response"));
          };
          const processFrame = (frame: { readonly event: string; readonly data: string }): void => {
            if (frame.event === "module") {
              onEvent(parseEventEnvelope(frame.data, eventContract));
              return;
            }
            if (frame.event === "document-resync-required") {
              onResyncRequired?.(parseDocumentResync(frame.data));
              return;
            }
            if (frame.event === "document-realtime") {
              onDocumentRealtime?.(decodeDocumentRealtimeSseEvent(frame.data));
              return;
            }
            if (frame.event !== "core-resync-required") return;

            const boundary = parseCoreResync(frame.data);
            if (onCoreResyncRequired) {
              onCoreResyncRequired(boundary);
              return;
            }
            throw new CoreEventReplayError(boundary);
          };
          response.on("data", (chunk: Buffer) => {
            try {
              for (const frame of parser.push(chunk)) processFrame(frame);
            } catch (error) {
              fail(error);
            }
          });
          response.on("end", () => {
            try {
              for (const frame of parser.finish()) processFrame(frame);
              if (!closed) resolveDone?.();
              closed = true;
            } catch (error) {
              fail(error);
            }
          });
          response.on("aborted", () => {
            fail(new Error("Core event stream ended before completion"));
          });
          response.on("error", fail);
          resolve({
            done,
            close: () => {
              if (closed) return;
              closed = true;
              response.destroy();
              request.destroy();
              resolveDone?.();
            },
          });
        },
      );
      request.on("error", (error) => {
        if (!opened) {
          reject(normalizeTransportError(error, "open"));
          return;
        }
        if (!closed) rejectDone?.(normalizeTransportError(error, "response"));
      });
      request.setTimeout(this.#requestTimeoutMs, () => {
        request.destroy(new CoreTransportError("timeout", "open", "ETIMEDOUT", null));
      });
      request.end();
    });
  }

  openLocalCommitStream(
    after: number,
    onCommit: (commit: BlockRecordCommittedValue) => void,
    requestHeaders: Readonly<Record<string, string>> = {},
    signal?: AbortSignal,
  ): Promise<CoreEventSubscription> {
    if (!Number.isSafeInteger(after) || after < 0) {
      return Promise.reject(new Error("LocalCommit sequence must be a non-negative integer"));
    }
    return new Promise<CoreEventSubscription>((resolve, reject) => {
      let opened = false;
      let closed = false;
      let resolveDone: (() => void) | undefined;
      let rejectDone: ((error: unknown) => void) | undefined;
      const done = new Promise<void>((doneResolve, doneReject) => {
        resolveDone = doneResolve;
        rejectDone = doneReject;
      });
      const request = httpRequest(
        {
          socketPath: this.socketPath,
          path: `/core/v1/local-commits?after=${after}`,
          method: "GET",
          agent: false,
          signal,
          headers: {
            ...requestHeaders,
            accept: "text/event-stream",
            authorization: `Bearer ${this.authCapability}`,
          },
        },
        (response) => {
          request.setTimeout(0);
          const status = response.statusCode ?? 0;
          if (status !== 200) {
            collectResponse(response, this.#maximumJsonResponseBytes)
              .then((bytes) => {
                const value = decodeBoundedJson<unknown>(
                  bytes,
                  this.#maximumJsonResponseBytes,
                  "Core LocalCommit error response",
                );
                reject(new CoreHttpError(status, errorMessage(value)));
              })
              .catch((error: unknown) => reject(normalizeTransportError(error, "response")));
            return;
          }
          opened = true;
          const parser = new SseParser(MAX_EVENT_FRAME_BYTES);
          const fail = (error: unknown): void => {
            if (closed) return;
            closed = true;
            response.destroy();
            rejectDone?.(normalizeTransportError(error, "response"));
          };
          const processFrame = (frame: { readonly event: string; readonly data: string }): void => {
            if (frame.event !== "local-commit") return;
            onCommit(parseBlockRecordCommit(frame.data));
          };
          response.on("data", (chunk: Buffer) => {
            try {
              for (const frame of parser.push(chunk)) processFrame(frame);
            } catch (error) {
              fail(error);
            }
          });
          response.on("end", () => {
            try {
              for (const frame of parser.finish()) processFrame(frame);
              if (!closed) resolveDone?.();
              closed = true;
            } catch (error) {
              fail(error);
            }
          });
          response.on("aborted", () => fail(new Error("Core LocalCommit stream ended before completion")));
          response.on("error", fail);
          resolve({
            done,
            close: () => {
              if (closed) return;
              closed = true;
              response.destroy();
              request.destroy();
              resolveDone?.();
            },
          });
        },
      );
      request.on("error", (error) => {
        if (!opened) {
          reject(normalizeTransportError(error, "open"));
          return;
        }
        if (!closed) rejectDone?.(normalizeTransportError(error, "response"));
      });
      request.setTimeout(this.#requestTimeoutMs, () => {
        request.destroy(new CoreTransportError("timeout", "open", "ETIMEDOUT", null));
      });
      request.end();
    });
  }
}

const boundedPositiveInteger = (
  value: number,
  maximum: number,
  label: string,
): number => {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new Error(`${label} must be a positive integer no greater than ${maximum}`);
  }
  return value;
};

const collectResponse = (
  response: IncomingMessage,
  maximumBytes: number,
): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    const declaredLength = parseContentLength(response);
    if (declaredLength !== undefined && declaredLength > maximumBytes) {
      reject(new CoreResponseTooLargeError(maximumBytes, declaredLength));
      response.destroy();
      return;
    }
    const chunks: Buffer[] = [];
    let byteLength = 0;
    let settled = false;
    response.on("data", (chunk: Buffer) => {
      if (settled) return;
      byteLength += chunk.byteLength;
      if (byteLength <= maximumBytes) {
        chunks.push(chunk);
        return;
      }
      settled = true;
      reject(new CoreResponseTooLargeError(maximumBytes, byteLength));
      response.destroy();
    });
    response.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks, byteLength));
    });
    response.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });

const parseContentLength = (response: IncomingMessage): number | undefined => {
  const raw = response.headers["content-length"];
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) ? value : undefined;
};

const errorMessage = (value: unknown): string => {
  if (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "string"
  ) {
    return value.error;
  }
  return "Core request failed";
};

const parseEventEnvelope = (
  json: string,
  contract: CoreEventContract,
): CoreEventEnvelope => {
  const value = decodeBoundedJson<unknown>(
    Buffer.from(json, "utf8"),
    MAX_EVENT_FRAME_BYTES,
    "Core event",
  );
  if (
    typeof value !== "object" ||
    value === null ||
    !hasExactKeys(value, ["event", "transport_version"]) ||
    !("transport_version" in value) ||
    value.transport_version !== contract.transportVersion ||
    !("event" in value)
  ) {
    throw new CoreEventCompatibilityError("Core event transport version is invalid");
  }
  const event = value.event;
  if (
    typeof event !== "object" ||
    event === null ||
    !hasExactKeys(event, [
      "committed_at",
      "event_version",
      "operation_id",
      "payload",
      "projection_impact",
      "sequence",
      "store_epoch",
    ])
  ) {
    throw new CoreEventCompatibilityError("Core event payload is invalid");
  }
  if (!("event_version" in event) || event.event_version !== contract.eventVersion) {
    throw new CoreEventCompatibilityError("Core event version is invalid");
  }
  if (
    !("sequence" in event) ||
    typeof event.sequence !== "number" ||
    !Number.isSafeInteger(event.sequence) ||
    event.sequence < 1
  ) {
    throw new CoreEventCompatibilityError("Core event sequence is invalid");
  }
  if (!("store_epoch" in event) || event.store_epoch !== contract.storeEpoch) {
    throw new CoreEventCompatibilityError("Core event Store epoch is invalid");
  }
  if (
    !("committed_at" in event) ||
    typeof event.committed_at !== "string" ||
    event.committed_at.length === 0 ||
    event.committed_at.length > 64 ||
    !("operation_id" in event) ||
    (event.operation_id !== null && typeof event.operation_id !== "string") ||
    !("payload" in event) ||
    !isModuleEventPayload(event.payload)
  ) {
    throw new CoreEventCompatibilityError("Core event payload is invalid");
  }
  if (!("projection_impact" in event) || !isProjectionImpact(event.projection_impact)) {
    throw new CoreEventCompatibilityError("Core Projection impact is invalid");
  }
  return value as CoreEventEnvelope;
};

const parseBlockRecordCommit = (json: string): BlockRecordCommittedValue => {
  const value = decodeBoundedJson<unknown>(
    Buffer.from(json, "utf8"),
    MAX_EVENT_FRAME_BYTES,
    "Core LocalCommit",
  );
  if (
    typeof value !== "object"
    || value === null
    || !("cursor" in value)
    || typeof value.cursor !== "object"
    || value.cursor === null
    || !("commit_seq" in value.cursor)
    || !isNonNegativeSafeInteger(value.cursor.commit_seq)
    || value.cursor.commit_seq < 1
    || !("store_epoch" in value.cursor)
    || typeof value.cursor.store_epoch !== "string"
  ) {
    throw new CoreEventCompatibilityError("Core LocalCommit payload is invalid");
  }
  return value as BlockRecordCommittedValue;
};

const hasExactKeys = (
  value: Readonly<object>,
  expected: readonly string[],
): boolean => {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length &&
    actual.every((key, index) => key === expected[index]);
};

const isIdentity = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 512 &&
  value === value.trim();

const isCanonicalIdentityArray = (value: unknown): value is readonly string[] => {
  if (!Array.isArray(value) || value.length > 10_000) return false;
  let previous: string | undefined;
  for (const entry of value) {
    if (!isIdentity(entry) || (previous !== undefined && previous >= entry)) return false;
    previous = entry;
  }
  return true;
};

const isModuleEventPayload = (value: unknown): boolean => {
  if (
    typeof value !== "object" ||
    value === null ||
    !hasExactKeys(value, ["event", "module"]) ||
    !("module" in value) ||
    ![
      "automation",
      "block_record",
      "database",
      "library",
      "owned_document",
      "project_workspace",
      "store_administration",
    ].includes(String(value.module)) ||
    !("event" in value) ||
    typeof value.event !== "object" ||
    value.event === null ||
    !("kind" in value.event) ||
    typeof value.event.kind !== "string"
  ) {
    return false;
  }
  return true;
};

const isProjectionImpact = (value: unknown): boolean => {
  if (typeof value !== "object" || value === null || !("kind" in value)) return false;
  if (value.kind === "none" || value.kind === "all") {
    return Object.keys(value).length === 1;
  }
  if (value.kind !== "resources") return false;
  const record = value as Readonly<Record<string, unknown>>;
  if (!hasExactKeys(record, [
    "data_source_ids",
    "database_ids",
    "document_heads",
    "kind",
    "page_ids",
    "view_ids",
  ])) return false;
  const heads = record.document_heads;
  if (!isCanonicalIdentityArray(record.page_ids) ||
    !isCanonicalIdentityArray(record.database_ids) ||
    !isCanonicalIdentityArray(record.data_source_ids) ||
    !isCanonicalIdentityArray(record.view_ids) ||
    record.page_ids.length + record.database_ids.length +
        record.data_source_ids.length + record.view_ids.length > 10_000 ||
    (record.page_ids.length === 0 && record.database_ids.length === 0 &&
      record.data_source_ids.length === 0 && record.view_ids.length === 0 &&
      Array.isArray(heads) && heads.length === 0)) return false;
  const pages = new Set(record.page_ids);
  let previousHead: string | undefined;
  return Array.isArray(heads) &&
    heads.length <= 10_000 &&
    heads.every((head) =>
      typeof head === "object" &&
      head !== null &&
      hasExactKeys(head, ["document_id", "generation", "head_seq", "page_id"]) &&
      "page_id" in head &&
      isIdentity(head.page_id) &&
      pages.has(head.page_id) &&
      "document_id" in head &&
      isIdentity(head.document_id) &&
      "generation" in head &&
      Number.isSafeInteger(head.generation) &&
      Number(head.generation) >= 1 &&
      "head_seq" in head &&
      Number.isSafeInteger(head.head_seq) &&
      Number(head.head_seq) >= 1 &&
      (() => {
        const key = `${head.page_id}\u0000${head.document_id}`;
        if (previousHead !== undefined && previousHead >= key) return false;
        previousHead = key;
        return true;
      })()
    );
};

const parseDocumentResync = (json: string): DocumentResyncRequired => {
  const value = decodeBoundedJson<unknown>(
    Buffer.from(json, "utf8"),
    MAX_EVENT_FRAME_BYTES,
    "Core Document resync event",
  );
  if (
    typeof value !== "object" ||
    value === null ||
    !("document_id" in value) ||
    typeof value.document_id !== "string" ||
    !("event_head" in value) ||
    typeof value.event_head !== "number"
  ) {
    throw new Error("Core Document resync event is invalid");
  }
  return value as DocumentResyncRequired;
};

const parseCoreResync = (json: string): CoreEventReplayRequired => {
  const value = decodeBoundedJson<unknown>(
    Buffer.from(json, "utf8"),
    MAX_EVENT_FRAME_BYTES,
    "Core resync event",
  );
  if (
    typeof value !== "object" ||
    value === null ||
    !("requested_after" in value) ||
    !isNonNegativeSafeInteger(value.requested_after) ||
    !("oldest_available" in value) ||
    !isNonNegativeSafeInteger(value.oldest_available) ||
    !("event_head" in value) ||
    !isNonNegativeSafeInteger(value.event_head)
  ) {
    throw new Error("Core resync event is invalid");
  }
  return value as CoreEventReplayRequired;
};

const isNonNegativeSafeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
