import { request as httpRequest, type IncomingMessage } from "node:http";

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
  DocumentResyncRequired,
} from "./types";

const MAX_JSON_REQUEST_BYTES = 64 * 1024;
const MAX_JSON_RESPONSE_BYTES = 512 * 1024;
const MAX_EVENT_FRAME_BYTES = 512 * 1024;
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_CONFIGURED_JSON_RESPONSE_BYTES = 64 * 1024 * 1024;
const MAX_CONFIGURED_REQUEST_TIMEOUT_MS = 120_000;

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

export class CoreEventReplayError extends Error {
  constructor(readonly boundary: CoreEventReplayRequired) {
    super("Core event replay requires fresh reads");
    this.name = "CoreEventReplayError";
  }
}

export class UdsHttpTransport {
  readonly #maximumJsonResponseBytes: number;
  readonly #requestTimeoutMs: number;

  constructor(
    readonly socketPath: string,
    readonly authCapability: string,
    options: UdsHttpTransportOptions = {},
  ) {
    this.#maximumJsonResponseBytes = boundedPositiveInteger(
      options.maximumJsonResponseBytes ?? MAX_JSON_RESPONSE_BYTES,
      MAX_CONFIGURED_JSON_RESPONSE_BYTES,
      "Core JSON response limit",
    );
    this.#requestTimeoutMs = boundedPositiveInteger(
      options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS,
      MAX_CONFIGURED_REQUEST_TIMEOUT_MS,
      "Core request timeout",
    );
  }

  requestJson<Response>(
    method: "GET" | "POST",
    requestPath: string,
    body?: unknown,
    requestHeaders: Readonly<Record<string, string>> = {},
  ): Promise<Response> {
    const encodedBody = body === undefined
      ? undefined
      : encodeBoundedJson(body, MAX_JSON_REQUEST_BYTES, "Core request");

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
          collectResponse(response, this.#maximumJsonResponseBytes)
            .then((bytes) => {
              const value = decodeBoundedJson<Response>(
                bytes,
                this.#maximumJsonResponseBytes,
                "Core response",
              );
              const status = response.statusCode ?? 0;
              if (status >= 200 && status < 300) {
                settle(() => resolve(value));
                return;
              }
              settle(() => reject(new CoreHttpError(status, errorMessage(value))));
            })
            .catch((error: unknown) => settle(() => reject(error)));
        },
      );
      request.setTimeout(this.#requestTimeoutMs, () => {
        request.destroy(new Error("Core request timed out"));
      });
      request.on("error", (error) => settle(() => reject(error)));
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
            .catch((error: unknown) => settle(() => reject(error)));
        },
      );
      request.setTimeout(this.#requestTimeoutMs, () => {
        request.destroy(new Error("Core Document request timed out"));
      });
      request.on("error", (error) => settle(() => reject(error)));
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
  ): Promise<CoreEventSubscription> {
    if (!Number.isSafeInteger(after) || after < 0) {
      return Promise.reject(new Error("Event sequence must be a non-negative integer"));
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
          path: `/core/v1/events?after=${after}`,
          method: "GET",
          agent: false,
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
              .catch(reject);
            return;
          }

          opened = true;
          const parser = new SseParser(MAX_EVENT_FRAME_BYTES);
          const fail = (error: unknown): void => {
            if (closed) return;
            closed = true;
            response.destroy();
            rejectDone?.(error);
          };
          const processFrame = (frame: { readonly event: string; readonly data: string }): void => {
            if (frame.event === "module") {
              onEvent(parseEventEnvelope(frame.data));
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
          reject(error);
          return;
        }
        if (!closed) rejectDone?.(error);
      });
      request.setTimeout(this.#requestTimeoutMs, () => {
        request.destroy(new Error("Core event stream timed out before opening"));
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
      reject(new Error(`Core response exceeds ${maximumBytes} bytes`));
      response.destroy(new Error(`Core response exceeds ${maximumBytes} bytes`));
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

const parseEventEnvelope = (json: string): CoreEventEnvelope => {
  const value = decodeBoundedJson<unknown>(
    Buffer.from(json, "utf8"),
    MAX_EVENT_FRAME_BYTES,
    "Core event",
  );
  if (typeof value !== "object" || value === null || !("event" in value)) {
    throw new Error("Core event envelope is invalid");
  }
  const event = value.event;
  if (
    typeof event !== "object" ||
    event === null ||
    !("sequence" in event) ||
    typeof event.sequence !== "number"
  ) {
    throw new Error("Core event sequence is invalid");
  }
  return value as CoreEventEnvelope;
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
