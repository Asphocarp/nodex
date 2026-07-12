import {
  CANVAS_SCENE_SYNC_VERSION,
  MAX_CANVAS_SCENE_MUTATION_BYTES,
  canonicalizeCanvasSceneMutationRequest,
  type CanvasSceneMutationCommandResult,
  type CanvasSceneMutationRequest,
  type CanvasSceneRealtimeEvent,
  type CanvasSceneSyncCommandResult,
  type CanvasSceneSyncRequest,
} from "./canvas-scene-sync";
import { requireCanvasSceneIdentity } from "./canvas-scene";

export const CANVAS_SCENE_HTTP_CONTENT_TYPE =
  "application/vnd.nodex.canvas-scene.v1+json";
export const MAX_CANVAS_SCENE_HTTP_RESPONSE_BYTES = 16 * 1024 * 1024;

const encoder = new TextEncoder();

const parseBoundedJson = (serialized: string, maxBytes: number): unknown => {
  if (encoder.encode(serialized).byteLength > maxBytes) {
    throw new TypeError(`Canvas scene JSON exceeds ${maxBytes} bytes`);
  }
  try {
    return JSON.parse(serialized) as unknown;
  } catch (error) {
    throw new TypeError("Canvas scene JSON is invalid", { cause: error });
  }
};

const encodeBoundedJson = (value: unknown, maxBytes: number): string => {
  const serialized = JSON.stringify(value);
  if (encoder.encode(serialized).byteLength <= maxBytes) return serialized;
  throw new TypeError(`Canvas scene JSON exceeds ${maxBytes} bytes`);
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requireResultEnvelope = <T>(
  value: unknown,
  label: string,
): T => {
  if (!isRecord(value) || typeof value.ok !== "boolean") {
    throw new TypeError(`${label} is not a command result`);
  }
  if (value.ok && isRecord(value.value)) return value as T;
  if (!value.ok && isRecord(value.error)) return value as T;
  throw new TypeError(`${label} has an invalid result envelope`);
};

export const encodeCanvasSceneSyncRequestHttp = (
  request: CanvasSceneSyncRequest,
): string => encodeBoundedJson(request, MAX_CANVAS_SCENE_MUTATION_BYTES);

export const decodeCanvasSceneSyncRequestHttp = (
  serialized: string,
  routeProjectId: string,
  routeDocumentId: string,
): CanvasSceneSyncRequest => {
  const value = parseBoundedJson(serialized, MAX_CANVAS_SCENE_MUTATION_BYTES);
  if (!isRecord(value) || value.version !== CANVAS_SCENE_SYNC_VERSION) {
    throw new TypeError("Canvas scene sync request is invalid");
  }
  const projectId = requireCanvasSceneIdentity(value.projectId, "projectId");
  const documentId = requireCanvasSceneIdentity(value.documentId, "documentId");
  if (projectId !== routeProjectId || documentId !== routeDocumentId) {
    throw new TypeError("Canvas scene sync request does not match its route");
  }
  const clientSessionId = requireCanvasSceneIdentity(
    value.clientSessionId,
    "clientSessionId",
  );
  const optionalInteger = (field: string, minimum: number): number | undefined => {
    const candidate = value[field];
    if (candidate === undefined) return undefined;
    if (typeof candidate === "number" && Number.isSafeInteger(candidate) && candidate >= minimum) {
      return candidate;
    }
    throw new TypeError(`${field} is invalid`);
  };
  const knownStoreEpoch = value.knownStoreEpoch === undefined
    ? undefined
    : requireCanvasSceneIdentity(value.knownStoreEpoch, "knownStoreEpoch");
  return {
    version: CANVAS_SCENE_SYNC_VERSION,
    projectId,
    documentId,
    clientSessionId,
    ...(knownStoreEpoch ? { knownStoreEpoch } : {}),
    ...(optionalInteger("knownGeneration", 1) === undefined
      ? {}
      : { knownGeneration: optionalInteger("knownGeneration", 1) }),
    ...(optionalInteger("knownHeadSeq", 0) === undefined
      ? {}
      : { knownHeadSeq: optionalInteger("knownHeadSeq", 0) }),
  };
};

export const encodeCanvasSceneMutationRequestHttp = (
  request: CanvasSceneMutationRequest,
): string =>
  encodeBoundedJson(
    canonicalizeCanvasSceneMutationRequest(request),
    MAX_CANVAS_SCENE_MUTATION_BYTES,
  );

export const decodeCanvasSceneMutationRequestHttp = (
  serialized: string,
  routeProjectId: string,
  routeDocumentId: string,
): CanvasSceneMutationRequest => {
  const request = canonicalizeCanvasSceneMutationRequest(
    parseBoundedJson(serialized, MAX_CANVAS_SCENE_MUTATION_BYTES),
  );
  if (
    request.projectId === routeProjectId &&
    request.documentId === routeDocumentId
  ) {
    return request;
  }
  throw new TypeError("Canvas scene mutation does not match its route");
};

export const encodeCanvasSceneSyncResultHttp = (
  result: CanvasSceneSyncCommandResult,
): string => encodeBoundedJson(result, MAX_CANVAS_SCENE_HTTP_RESPONSE_BYTES);

export const decodeCanvasSceneSyncResultHttp = (
  serialized: string,
): CanvasSceneSyncCommandResult =>
  requireResultEnvelope<CanvasSceneSyncCommandResult>(
    parseBoundedJson(serialized, MAX_CANVAS_SCENE_HTTP_RESPONSE_BYTES),
    "Canvas scene sync result",
  );

export const encodeCanvasSceneMutationResultHttp = (
  result: CanvasSceneMutationCommandResult,
): string => encodeBoundedJson(result, MAX_CANVAS_SCENE_HTTP_RESPONSE_BYTES);

export const decodeCanvasSceneMutationResultHttp = (
  serialized: string,
): CanvasSceneMutationCommandResult =>
  requireResultEnvelope<CanvasSceneMutationCommandResult>(
    parseBoundedJson(serialized, MAX_CANVAS_SCENE_HTTP_RESPONSE_BYTES),
    "Canvas scene mutation result",
  );

export const encodeCanvasSceneSseEvent = (
  event: CanvasSceneRealtimeEvent,
): string => encodeBoundedJson(event, MAX_CANVAS_SCENE_HTTP_RESPONSE_BYTES);

export const decodeCanvasSceneSseEvent = (
  serialized: string,
): CanvasSceneRealtimeEvent => {
  const value = parseBoundedJson(
    serialized,
    MAX_CANVAS_SCENE_HTTP_RESPONSE_BYTES,
  );
  if (
    !isRecord(value) ||
    (value.type !== "canvas_scene_committed" &&
      value.type !== "canvas_scene_resync_required") ||
    value.version !== CANVAS_SCENE_SYNC_VERSION ||
    typeof value.projectId !== "string" ||
    typeof value.documentId !== "string"
  ) {
    throw new TypeError("Canvas scene realtime event is invalid");
  }
  return value as unknown as CanvasSceneRealtimeEvent;
};
