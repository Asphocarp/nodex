import {
  DURABLE_CANVAS_SCENE_APP_STATE_KEYS,
  MAX_CANVAS_SCENE_ELEMENTS,
  MAX_CANVAS_SCENE_FILES,
  CanvasSceneContractError,
  canonicalStringifyCanvasScene,
  canonicalizeCanvasSceneElement,
  canonicalizeCanvasSceneFile,
  pickPortableCanvasSceneAppState,
  requireCanvasSceneIdentity,
  type CanvasSceneAppState,
  type CanvasSceneElement,
  type CanvasSceneFile,
  type CanvasSceneJsonValue,
  type PortableCanvasScene,
} from "./canvas-scene";

export const CANVAS_SCENE_SYNC_VERSION = 1 as const;
export const MAX_CANVAS_SCENE_MUTATION_BYTES = 2 * 1024 * 1024;

export type CanvasSceneOptionalJson =
  | { readonly kind: "absent" }
  | { readonly kind: "value"; readonly value: CanvasSceneJsonValue };

export interface CanvasSceneAppStateIntent {
  readonly expected: CanvasSceneOptionalJson;
  readonly value: CanvasSceneOptionalJson;
}

export type CanvasSceneAppStateIntents = Readonly<
  Record<string, CanvasSceneAppStateIntent>
>;

export interface CanvasSceneMutationRequest {
  readonly version: typeof CANVAS_SCENE_SYNC_VERSION;
  readonly mutationId: string;
  readonly projectId: string;
  readonly documentId: string;
  readonly storeEpoch: string;
  readonly generation: number;
  readonly baseHeadSeq: number;
  readonly clientSessionId: string;
  readonly elementCandidates: readonly CanvasSceneElement[];
  readonly appStateIntents: CanvasSceneAppStateIntents;
  readonly fileAdditions: Readonly<Record<string, CanvasSceneFile>>;
}

export interface CanvasSceneMutationResult {
  readonly version: typeof CANVAS_SCENE_SYNC_VERSION;
  readonly mutationId: string;
  readonly projectId: string;
  readonly documentId: string;
  readonly storeEpoch: string;
  readonly generation: number;
  readonly baseHeadSeq: number;
  readonly headSeq: number;
  readonly duplicate: boolean;
  readonly outcome: "committed" | "no_change";
  readonly sceneHash: string;
  readonly changedElementIds: readonly string[];
  readonly appliedAppStateKeys: readonly string[];
  readonly skippedAppStateKeys: readonly string[];
  readonly addedFileIds: readonly string[];
  readonly removedFileIds: readonly string[];
  readonly committedAt: string;
}

export type CanvasSceneMutationErrorCode =
  | "invalid_canvas_scene_mutation"
  | "store_epoch_mismatch"
  | "project_scope_mismatch"
  | "document_not_found"
  | "document_not_ready"
  | "document_engine_mismatch"
  | "document_generation_mismatch"
  | "future_base_head"
  | "mutation_id_collision"
  | "canvas_scene_corrupt"
  | "unknown";

export interface CanvasSceneMutationError {
  readonly code: CanvasSceneMutationErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly resetRequired: boolean;
  readonly mutationId?: string;
}

export type CanvasSceneMutationCommandResult =
  | {
      readonly ok: true;
      readonly value: CanvasSceneMutationResult;
      /** Present only for a first effective commit; safe to fan out after ACK. */
      readonly event?: CanvasSceneCommittedEvent;
    }
  | { readonly ok: false; readonly error: CanvasSceneMutationError };

export type CanvasSceneSyncCommandResult =
  | { readonly ok: true; readonly value: CanvasSceneSyncResponse }
  | { readonly ok: false; readonly error: CanvasSceneMutationError };

export interface CanvasSceneSubscribeRequest {
  readonly version: typeof CANVAS_SCENE_SYNC_VERSION;
  readonly projectId: string;
  readonly documentId: string;
  readonly clientSessionId: string;
}

export interface CanvasSceneSubscriptionAck {
  readonly subscribed: true;
}

export interface CanvasSceneUnsubscribeAck {
  readonly unsubscribed: true;
}

export type CanvasSceneSubscriptionCommandResult =
  | {
      readonly ok: true;
      readonly value: CanvasSceneSubscriptionAck | CanvasSceneUnsubscribeAck;
    }
  | { readonly ok: false; readonly error: CanvasSceneMutationError };

export interface CanvasSceneSyncRequest {
  readonly version: typeof CANVAS_SCENE_SYNC_VERSION;
  readonly projectId: string;
  readonly documentId: string;
  readonly clientSessionId: string;
  readonly knownStoreEpoch?: string;
  readonly knownGeneration?: number;
  readonly knownHeadSeq?: number;
}

export interface CanvasSceneSyncResponse {
  readonly version: typeof CANVAS_SCENE_SYNC_VERSION;
  readonly projectId: string;
  readonly documentId: string;
  readonly storeEpoch: string;
  readonly generation: number;
  readonly headSeq: number;
  readonly sceneHash: string;
  readonly scene: PortableCanvasScene;
}

export interface CanvasSceneCommittedEvent {
  readonly type: "canvas_scene_committed";
  readonly version: typeof CANVAS_SCENE_SYNC_VERSION;
  readonly projectId: string;
  readonly documentId: string;
  readonly storeEpoch: string;
  readonly generation: number;
  readonly mutationId: string;
  readonly baseHeadSeq: number;
  readonly headSeq: number;
  readonly sceneHash: string;
  readonly elementUpdates: readonly CanvasSceneElement[];
  readonly appState: CanvasSceneAppState;
  readonly fileAdditions: Readonly<Record<string, CanvasSceneFile>>;
  readonly removedFileIds: readonly string[];
}

export interface CanvasSceneResyncRequiredEvent {
  readonly type: "canvas_scene_resync_required";
  readonly version: typeof CANVAS_SCENE_SYNC_VERSION;
  readonly projectId: string;
  readonly documentId: string;
  readonly storeEpoch: string;
  readonly generation: number;
  readonly headSeq: number;
}

export type CanvasSceneRealtimeEvent =
  | CanvasSceneCommittedEvent
  | CanvasSceneResyncRequiredEvent;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requireSafeInteger = (
  value: unknown,
  field: string,
  minimum: number,
): number => {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= minimum) {
    return value;
  }
  throw new CanvasSceneContractError(
    `${field} must be a safe integer >= ${minimum}`,
  );
};

const exactKeys = (
  value: Readonly<Record<string, unknown>>,
  field: string,
  required: readonly string[],
): void => {
  const allowed = new Set(required);
  for (const key of required) {
    if (Object.prototype.hasOwnProperty.call(value, key)) continue;
    throw new CanvasSceneContractError(`${field}.${key} is required`);
  }
  for (const key of Object.keys(value)) {
    if (allowed.has(key)) continue;
    throw new CanvasSceneContractError(`${field}.${key} is not supported`);
  }
};

const canonicalOptionalJson = (
  value: unknown,
  field: string,
  appStateKey: string,
): CanvasSceneOptionalJson => {
  if (!isRecord(value)) {
    throw new CanvasSceneContractError(`${field} must be an object`);
  }
  if (value.kind === "absent") {
    exactKeys(value, field, ["kind"]);
    return { kind: "absent" };
  }
  if (value.kind !== "value") {
    throw new CanvasSceneContractError(
      `${field}.kind must be absent or value`,
    );
  }
  exactKeys(value, field, ["kind", "value"]);
  const parsed = pickPortableCanvasSceneAppState({
    [appStateKey]: value.value,
  })[appStateKey];
  if (parsed === undefined) {
    throw new CanvasSceneContractError(`${field}.value is invalid`);
  }
  return { kind: "value", value: parsed };
};

export const canonicalizeCanvasSceneMutationRequest = (
  input: unknown,
): CanvasSceneMutationRequest => {
  if (!isRecord(input)) {
    throw new CanvasSceneContractError("Canvas scene mutation must be an object");
  }
  exactKeys(input, "Canvas scene mutation", [
    "version",
    "mutationId",
    "projectId",
    "documentId",
    "storeEpoch",
    "generation",
    "baseHeadSeq",
    "clientSessionId",
    "elementCandidates",
    "appStateIntents",
    "fileAdditions",
  ]);
  if (input.version !== CANVAS_SCENE_SYNC_VERSION) {
    throw new CanvasSceneContractError(
      `Canvas scene mutation.version must be ${CANVAS_SCENE_SYNC_VERSION}`,
    );
  }
  if (!Array.isArray(input.elementCandidates)) {
    throw new CanvasSceneContractError(
      "Canvas scene mutation.elementCandidates must be an array",
    );
  }
  if (input.elementCandidates.length > MAX_CANVAS_SCENE_ELEMENTS) {
    throw new CanvasSceneContractError(
      `Canvas scene mutation exceeds ${MAX_CANVAS_SCENE_ELEMENTS} element candidates`,
    );
  }
  const elementCandidates = input.elementCandidates.map((element) =>
    canonicalizeCanvasSceneElement(element, { runtime: true }),
  );
  const elementIds = elementCandidates.map((element) => element.id as string);
  if (new Set(elementIds).size !== elementIds.length) {
    throw new CanvasSceneContractError(
      "Canvas scene mutation repeats an element id",
    );
  }
  if (!isRecord(input.appStateIntents)) {
    throw new CanvasSceneContractError(
      "Canvas scene mutation.appStateIntents must be an object",
    );
  }
  const appStateIntents: Record<string, CanvasSceneAppStateIntent> = {};
  const allowedAppStateKeys = new Set<string>(
    DURABLE_CANVAS_SCENE_APP_STATE_KEYS,
  );
  for (const [key, intent] of Object.entries(input.appStateIntents)) {
    if (!allowedAppStateKeys.has(key)) {
      throw new CanvasSceneContractError(
        `Canvas scene mutation contains non-durable appState key ${key}`,
      );
    }
    if (!isRecord(intent)) {
      throw new CanvasSceneContractError(
        `Canvas scene mutation.appStateIntents.${key} must be an object`,
      );
    }
    exactKeys(intent, `Canvas scene mutation.appStateIntents.${key}`, [
      "expected",
      "value",
    ]);
    appStateIntents[key] = {
      expected: canonicalOptionalJson(
        intent.expected,
        `Canvas scene mutation.appStateIntents.${key}.expected`,
        key,
      ),
      value: canonicalOptionalJson(
        intent.value,
        `Canvas scene mutation.appStateIntents.${key}.value`,
        key,
      ),
    };
  }
  if (!isRecord(input.fileAdditions)) {
    throw new CanvasSceneContractError(
      "Canvas scene mutation.fileAdditions must be an object",
    );
  }
  const fileEntries = Object.entries(input.fileAdditions);
  if (fileEntries.length > MAX_CANVAS_SCENE_FILES) {
    throw new CanvasSceneContractError(
      `Canvas scene mutation exceeds ${MAX_CANVAS_SCENE_FILES} file additions`,
    );
  }
  const fileAdditions = Object.fromEntries(
    fileEntries
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([fileId, file]) => [
        fileId,
        canonicalizeCanvasSceneFile(file, fileId),
      ]),
  );
  const request: CanvasSceneMutationRequest = {
    version: CANVAS_SCENE_SYNC_VERSION,
    mutationId: requireCanvasSceneIdentity(input.mutationId, "mutationId"),
    projectId: requireCanvasSceneIdentity(input.projectId, "projectId"),
    documentId: requireCanvasSceneIdentity(input.documentId, "documentId"),
    storeEpoch: requireCanvasSceneIdentity(input.storeEpoch, "storeEpoch"),
    generation: requireSafeInteger(input.generation, "generation", 1),
    baseHeadSeq: requireSafeInteger(input.baseHeadSeq, "baseHeadSeq", 0),
    clientSessionId: requireCanvasSceneIdentity(
      input.clientSessionId,
      "clientSessionId",
    ),
    elementCandidates,
    appStateIntents,
    fileAdditions,
  };
  const byteLength = new TextEncoder().encode(
    encodeCanonicalCanvasSceneMutationRequest(request),
  ).byteLength;
  if (byteLength <= MAX_CANVAS_SCENE_MUTATION_BYTES) return request;
  throw new CanvasSceneContractError(
    `Canvas scene mutation exceeds ${MAX_CANVAS_SCENE_MUTATION_BYTES} bytes`,
  );
};

export const encodeCanonicalCanvasSceneMutationRequest = (
  request: CanvasSceneMutationRequest,
): string =>
  canonicalStringifyCanvasScene(request);
