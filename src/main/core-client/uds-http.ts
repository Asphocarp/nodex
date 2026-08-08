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
  CoreModuleEventPayload,
  CoreStreamCheckpoint,
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
  readonly libraryId: string;
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
      !contract.libraryId ||
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
    signal?: AbortSignal,
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
          signal,
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
    onCheckpoint?: (checkpoint: CoreStreamCheckpoint) => void,
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
            if (frame.event === "stream-checkpoint") {
              onCheckpoint?.(parseStreamCheckpoint(frame.data, eventContract));
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
    !hasExactKeys(value, ["packet", "transport_version"]) ||
    !("transport_version" in value) ||
    value.transport_version !== contract.transportVersion ||
    !("packet" in value)
  ) {
    throw new CoreEventCompatibilityError("Core event transport version is invalid");
  }
  assertAuthorizedDeliveryPacket(value.packet, contract);
  return value as CoreEventEnvelope;
};

const assertAuthorizedDeliveryPacket = (
  packet: unknown,
  contract: CoreEventContract,
): void => {
  if (
    typeof packet !== "object" ||
    packet === null ||
    !hasExactKeys(packet, [
      "authorization_scope",
      "coverage",
      "document_effects",
      "effects",
      "manifest",
      "packet_hash",
      "packet_version",
      "projection_effects",
      "projection_impact",
      "revocations",
    ])
  ) {
    throw new CoreEventCompatibilityError("Authorized delivery packet is invalid");
  }
  if (
    !("packet_version" in packet)
    || packet.packet_version !== 2
    || !("packet_hash" in packet)
    || !isSha256(packet.packet_hash)
    || !("projection_impact" in packet)
    || !isProjectionImpact(packet.projection_impact)
  ) {
    throw new CoreEventCompatibilityError("Authorized delivery integrity is invalid");
  }
  const authorizationScope = "authorization_scope" in packet
    ? packet.authorization_scope
    : null;
  if (!isDeliveryAuthorizationScope(authorizationScope, contract.libraryId)) {
    throw new CoreEventCompatibilityError("Delivery authorization scope is invalid");
  }

  const manifest = "manifest" in packet ? packet.manifest : null;
  if (
    typeof manifest !== "object"
    || manifest === null
    || !hasExactKeys(manifest, [
      "committed_at",
      "event_version",
      "identity",
      "operation_id",
    ])
    || !("event_version" in manifest)
    || manifest.event_version !== contract.eventVersion
    || !("operation_id" in manifest)
    || !isIdentity(manifest.operation_id)
    || !("committed_at" in manifest)
    || typeof manifest.committed_at !== "string"
    || manifest.committed_at.length === 0
    || manifest.committed_at.length > 64
  ) {
    throw new CoreEventCompatibilityError("Commit manifest header is invalid");
  }

  const identity = "identity" in manifest ? manifest.identity : null;
  if (
    typeof identity !== "object"
    || identity === null
    || !hasExactKeys(identity, ["commit_seq", "manifest_hash", "store_epoch"])
    || !("commit_seq" in identity)
    || !isPositiveSafeInteger(identity.commit_seq)
    || !("manifest_hash" in identity)
    || !isSha256(identity.manifest_hash)
    || !("store_epoch" in identity)
    || identity.store_epoch !== contract.storeEpoch
  ) {
    throw new CoreEventCompatibilityError("Commit manifest identity is invalid");
  }

  const effects = "effects" in packet ? packet.effects : null;
  if (
    !Array.isArray(effects)
    || effects.length > 10_000
    || effects.some((effect) => !isAuthorizedModuleEffect(effect))
  ) {
    throw new CoreEventCompatibilityError("Authorized semantic effects are invalid");
  }

  const documentEffects = "document_effects" in packet
    ? packet.document_effects
    : null;
  if (
    !Array.isArray(documentEffects)
    || documentEffects.length > 10_000
    || documentEffects.some((effect) => !isAuthorizedDocumentEffect(effect))
  ) {
    throw new CoreEventCompatibilityError("Authorized Document effects are invalid");
  }

  const projectionEffects = "projection_effects" in packet
    ? packet.projection_effects
    : null;
  if (
    !Array.isArray(projectionEffects)
    || projectionEffects.length > 10_000
    || projectionEffects.some((effect) => !isProjectionEffect(effect))
  ) {
    throw new CoreEventCompatibilityError("Authorized Projection effects are invalid");
  }

  const revocations = "revocations" in packet ? packet.revocations : null;
  if (
    !Array.isArray(revocations)
    || revocations.length > 10_000
    || revocations.some((revocation) =>
      !isResourceRevocation(revocation, contract.libraryId)
    )
  ) {
    throw new CoreEventCompatibilityError("Authorized revocations are invalid");
  }

  const coverage = "coverage" in packet ? packet.coverage : null;
  if (!isDeliveryCoverage(coverage)) {
    throw new CoreEventCompatibilityError("Authorized delivery coverage is invalid");
  }
  const semanticOrders = effects.map((effect) =>
    (effect as { readonly semantic: { readonly effect_order: number } }).semantic.effect_order
  );
  const documentOrders = documentEffects.map((effect) =>
    (effect as { readonly reference: { readonly effect_order: number } }).reference.effect_order
  );
  const inlineOrders = documentEffects
    .filter((effect) =>
      (effect as { readonly inline_update?: unknown }).inline_update !== null
      && (effect as { readonly inline_update?: unknown }).inline_update !== undefined
    )
    .map((effect) =>
      (effect as { readonly reference: { readonly effect_order: number } }).reference.effect_order
    );
  const projectionScopes = projectionEffects.map((effect) =>
    (effect as {
      readonly scope: { readonly canonical_key: string };
    }).scope.canonical_key
  );
  if (
    !sameNumberArray(coverage.semantic_effect_orders, semanticOrders)
    || !sameNumberArray(coverage.document_effect_orders, documentOrders)
    || !sameNumberArray(coverage.inline_document_effect_orders, inlineOrders)
    || !sameStringArray(coverage.projection_scope_keys, projectionScopes)
  ) {
    throw new CoreEventCompatibilityError("Authorized delivery coverage does not match packet resources");
  }
};

const parseStreamCheckpoint = (
  json: string,
  contract: CoreEventContract,
): CoreStreamCheckpoint => {
  const value = decodeBoundedJson<unknown>(
    Buffer.from(json, "utf8"),
    MAX_EVENT_FRAME_BYTES,
    "Core stream checkpoint",
  );
  if (
    typeof value !== "object"
    || value === null
    || !hasExactKeys(value, [
      "generation",
      "oldest_available_seq",
      "resync_token",
      "scanned_through_seq",
      "store_epoch",
    ])
    || !("store_epoch" in value)
    || value.store_epoch !== contract.storeEpoch
    || !("generation" in value)
    || !isIdentity(value.generation)
    || !("scanned_through_seq" in value)
    || !isNonNegativeSafeInteger(value.scanned_through_seq)
    || !("oldest_available_seq" in value)
    || !isNonNegativeSafeInteger(value.oldest_available_seq)
    || value.oldest_available_seq > value.scanned_through_seq
    || !("resync_token" in value)
    || (value.resync_token !== null && !isIdentity(value.resync_token))
  ) {
    throw new CoreEventCompatibilityError("Core stream checkpoint is invalid");
  }
  return value as CoreStreamCheckpoint;
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

const isSha256 = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);

const isNonNegativeSafeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const isPositiveSafeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 1;

const isCanonicalIntegerArray = (value: unknown): value is readonly number[] => {
  if (!Array.isArray(value) || value.length > 10_000) return false;
  let previous = -1;
  for (const entry of value) {
    if (!isNonNegativeSafeInteger(entry) || entry <= previous) return false;
    previous = entry;
  }
  return true;
};

const isLocalCommitResources = (value: unknown): boolean => {
  if (
    typeof value !== "object"
    || value === null
    || !hasExactKeys(value, ["block_ids", "database_ids", "document_ids"])
  ) return false;
  return "block_ids" in value
    && isCanonicalIdentityArray(value.block_ids)
    && "database_ids" in value
    && isCanonicalIdentityArray(value.database_ids)
    && "document_ids" in value
    && isCanonicalIdentityArray(value.document_ids);
};

const isAuthorizedModuleEffect = (value: unknown): boolean => {
  if (
    typeof value !== "object"
    || value === null
    || !hasExactKeys(value, ["payload", "semantic"])
    || !("payload" in value)
    || !isModuleEventPayload(value.payload)
    || !("semantic" in value)
  ) return false;
  const semantic = value.semantic;
  if (
    typeof semantic !== "object"
    || semantic === null
    || !hasExactKeys(semantic, [
      "effect_kind",
      "effect_order",
      "kind",
      "module",
      "payload_hash",
      "projection_impact",
      "resources",
    ])
    || !("kind" in semantic)
    || semantic.kind !== "module_changed"
    || !("effect_kind" in semantic)
    || !isIdentity(semantic.effect_kind)
    || !("effect_order" in semantic)
    || !isNonNegativeSafeInteger(semantic.effect_order)
    || !("payload_hash" in semantic)
    || !isSha256(semantic.payload_hash)
    || !("projection_impact" in semantic)
    || !isProjectionImpact(semantic.projection_impact)
    || !("resources" in semantic)
    || !isLocalCommitResources(semantic.resources)
    || !("module" in semantic)
    || !("module" in value.payload)
    || semantic.module !== value.payload.module
  ) return false;
  return true;
};

const isByteArray = (value: unknown): value is readonly number[] =>
  Array.isArray(value)
  && value.length <= MAX_EVENT_FRAME_BYTES
  && value.every((byte) =>
    typeof byte === "number"
    && Number.isInteger(byte)
    && byte >= 0
    && byte <= 255
  );

const isAuthorizedDocumentEffect = (value: unknown): boolean => {
  if (
    typeof value !== "object"
    || value === null
    || !hasExactKeys(value, ["inline_update", "reference"])
    || !("inline_update" in value)
    || (value.inline_update !== null && !isByteArray(value.inline_update))
    || !("reference" in value)
  ) return false;
  const reference = value.reference;
  if (
    typeof reference !== "object"
    || reference === null
    || !hasExactKeys(reference, [
      "base_head_seq",
      "document_id",
      "effect_order",
      "generation",
      "page_id",
      "resource_kind",
      "result_head_seq",
      "update_byte_length",
      "update_hash",
      "update_id",
    ])
    || !("base_head_seq" in reference)
    || !isNonNegativeSafeInteger(reference.base_head_seq)
    || !("result_head_seq" in reference)
    || !isPositiveSafeInteger(reference.result_head_seq)
    || reference.result_head_seq <= reference.base_head_seq
    || !("generation" in reference)
    || !isPositiveSafeInteger(reference.generation)
    || !("effect_order" in reference)
    || !isNonNegativeSafeInteger(reference.effect_order)
    || !("document_id" in reference)
    || !isIdentity(reference.document_id)
    || !("page_id" in reference)
    || (reference.page_id !== null && !isIdentity(reference.page_id))
    || !("resource_kind" in reference)
    || reference.resource_kind !== "document_update"
    || !("update_id" in reference)
    || !isIdentity(reference.update_id)
    || !("update_hash" in reference)
    || !isSha256(reference.update_hash)
    || !("update_byte_length" in reference)
    || !isNonNegativeSafeInteger(reference.update_byte_length)
  ) return false;
  return value.inline_update === null
    || value.inline_update.length === reference.update_byte_length;
};

const isProjectionEffect = (value: unknown): boolean => {
  if (
    typeof value !== "object"
    || value === null
    || !hasExactKeys(value, [
      "base_revision",
      "covered_commit_seq",
      "effect_hash",
      "patch",
      "requires_read_at_least",
      "result_revision",
      "scope",
    ])
    || !("base_revision" in value)
    || !isNonNegativeSafeInteger(value.base_revision)
    || !("result_revision" in value)
    || !isPositiveSafeInteger(value.result_revision)
    || value.result_revision !== value.base_revision + 1
    || !("covered_commit_seq" in value)
    || !isPositiveSafeInteger(value.covered_commit_seq)
    || !("effect_hash" in value)
    || !isSha256(value.effect_hash)
    || !("requires_read_at_least" in value)
    || typeof value.requires_read_at_least !== "boolean"
    || !("patch" in value)
    || (value.patch !== null && typeof value.patch !== "object")
    || !("scope" in value)
  ) return false;
  const scope = value.scope;
  return typeof scope === "object"
    && scope !== null
    && hasExactKeys(scope, ["canonical_key", "schema_version", "scope"])
    && "canonical_key" in scope
    && typeof scope.canonical_key === "string"
    && /^v1:[0-9a-f]{64}$/u.test(scope.canonical_key)
    && "schema_version" in scope
    && scope.schema_version === 1
    && "scope" in scope
    && typeof scope.scope === "object"
    && scope.scope !== null;
};

const isDeliveryAuthorizationScope = (
  value: unknown,
  expectedLibraryId: string,
): boolean => {
  if (typeof value !== "object" || value === null || !("kind" in value)) {
    return false;
  }
  if (value.kind === "library") {
    return hasExactKeys(value, ["kind", "library_id"])
      && "library_id" in value
      && value.library_id === expectedLibraryId;
  }
  if (value.kind === "project") {
    return hasExactKeys(value, ["kind", "library_id", "project_id"])
      && "library_id" in value
      && value.library_id === expectedLibraryId
      && "project_id" in value
      && isIdentity(value.project_id);
  }
  if (value.kind === "document") {
    return hasExactKeys(value, [
      "document_id",
      "kind",
      "library_id",
      "project_id",
    ])
      && "library_id" in value
      && value.library_id === expectedLibraryId
      && "document_id" in value
      && isIdentity(value.document_id)
      && "project_id" in value
      && (value.project_id === null || isIdentity(value.project_id));
  }
  return false;
};

const isResourceRevocation = (
  value: unknown,
  expectedLibraryId: string,
): boolean => {
  if (
    typeof value !== "object"
    || value === null
    || !hasExactKeys(value, [
      "authorization_scope",
      "reason",
      "resource_id",
      "resource_kind",
    ])
  ) return false;
  return "authorization_scope" in value
    && isDeliveryAuthorizationScope(value.authorization_scope, expectedLibraryId)
    && "resource_id" in value
    && isIdentity(value.resource_id)
    && "resource_kind" in value
    && ["page", "document", "database", "data_source", "view", "canvas"]
      .includes(String(value.resource_kind))
    && "reason" in value
    && ["ownership_moved", "access_revoked", "archived", "deleted"]
      .includes(String(value.reason));
};

const isDeliveryCoverage = (value: unknown): value is {
  readonly document_effect_orders: readonly number[];
  readonly inline_document_effect_orders: readonly number[];
  readonly projection_scope_keys: readonly string[];
  readonly semantic_effect_orders: readonly number[];
} => typeof value === "object"
  && value !== null
  && hasExactKeys(value, [
    "document_effect_orders",
    "inline_document_effect_orders",
    "projection_scope_keys",
    "semantic_effect_orders",
  ])
  && "document_effect_orders" in value
  && isCanonicalIntegerArray(value.document_effect_orders)
  && "inline_document_effect_orders" in value
  && isCanonicalIntegerArray(value.inline_document_effect_orders)
  && "projection_scope_keys" in value
  && isCanonicalIdentityArray(value.projection_scope_keys)
  && "semantic_effect_orders" in value
  && isCanonicalIntegerArray(value.semantic_effect_orders);

const sameNumberArray = (
  left: readonly number[],
  right: readonly number[],
): boolean => left.length === right.length
  && left.every((entry, index) => entry === right[index]);

const sameStringArray = (
  left: readonly string[],
  right: readonly string[],
): boolean => left.length === right.length
  && left.every((entry, index) => entry === right[index]);

const isModuleEventPayload = (value: unknown): value is CoreModuleEventPayload => {
  if (
    typeof value !== "object" ||
    value === null ||
    !hasExactKeys(value, ["event", "module"]) ||
    !("module" in value) ||
    ![
      "automation",
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
    !("commit_head" in value) ||
    typeof value.commit_head !== "number"
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
    typeof value !== "object"
    || value === null
    || !hasExactKeys(value, [
      "commit_head",
      "generation",
      "oldest_available",
      "requested_after",
      "resync_token",
    ])
    || !("requested_after" in value)
    || !isNonNegativeSafeInteger(value.requested_after)
    || !("oldest_available" in value)
    || !isNonNegativeSafeInteger(value.oldest_available)
    || !("commit_head" in value)
    || !isNonNegativeSafeInteger(value.commit_head)
    || !("generation" in value)
    || !isIdentity(value.generation)
    || !("resync_token" in value)
    || !isIdentity(value.resync_token)
  ) {
    throw new Error("Core resync event is invalid");
  }
  return value as CoreEventReplayRequired;
};
