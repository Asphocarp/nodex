import * as Y from "yjs";
import {
  stableStringifyBlockPropertyJson,
  type BlockPropertyJsonValue,
} from "../block-property-mutations";
import { getAssetSource, parseAssetSource } from "../assets";
import type { DocumentId } from "./contracts";
export {
  CANVAS_BLOCK_TYPE,
  CANVAS_DOCUMENT_SCHEMA_KEY,
  CANVAS_DOCUMENT_SCHEMA_VERSION,
  primaryCanvasBlockId,
  primaryCanvasDocumentId,
} from "./canvas-document-identity";
import {
  CANVAS_DOCUMENT_SCHEMA_VERSION,
} from "./canvas-document-identity";

export const CANVAS_DOCUMENT_KIND = "canvas_scene";

export const CANVAS_ELEMENTS_ROOT = "elements";
export const CANVAS_ORDER_ROOT = "order";
export const CANVAS_APP_STATE_ROOT = "appState";
export const CANVAS_FILES_ROOT = "files";

export const MAX_CANVAS_ELEMENTS = 100_000;
export const MAX_CANVAS_ELEMENT_REVISIONS = 400_000;
export const MAX_CANVAS_FILES = 10_000;
export const MAX_CANVAS_ID_LENGTH = 512;
export const MAX_CANVAS_ORDER_KEY_LENGTH = 256;
export const MAX_CANVAS_SHARED_TEXT_LENGTH = 4_000_000;
// JSON escaping can expand a valid 16 MiB Yjs state by up to six times.
const MAX_CANVAS_PROJECTION_JSON_LENGTH = 128 * 1024 * 1024;
const MAX_CANVAS_PROJECTION_JSON_NODES = 2_000_000;
const MAX_CANVAS_PROJECTION_JSON_DEPTH = 64;
const MAX_CANVAS_ELEMENT_JSON_NODES = 100_000;
const MAX_CANVAS_ELEMENT_JSON_DEPTH = 32;

const CANVAS_ROOT_NAMES = [
  CANVAS_ELEMENTS_ROOT,
  CANVAS_ORDER_ROOT,
  CANVAS_APP_STATE_ROOT,
  CANVAS_FILES_ROOT,
] as const;

const DURABLE_CANVAS_APP_STATE_KEYS = new Set([
  "gridModeEnabled",
  "gridSize",
  "gridStep",
  "viewBackgroundColor",
]);

export type CanvasJsonValue = BlockPropertyJsonValue;
export type CanvasElementSnapshot = Readonly<
  Record<string, CanvasJsonValue>
>;
export interface CanvasFileSnapshot {
  readonly id: string;
  readonly mimeType: string;
  readonly source: string;
  readonly created?: number;
}
export type CanvasSharedAppState = Readonly<
  Record<string, CanvasJsonValue>
>;

export interface CanvasPageReference {
  readonly sourceElementId: string;
  readonly targetBlockId: string;
  readonly titleHint?: string;
}

export interface CanvasSceneMaterialization {
  readonly kind: typeof CANVAS_DOCUMENT_KIND;
  readonly schemaVersion: typeof CANVAS_DOCUMENT_SCHEMA_VERSION;
  readonly elements: readonly CanvasElementSnapshot[];
  readonly appState: CanvasSharedAppState;
  readonly files: Readonly<Record<string, CanvasFileSnapshot>>;
  readonly pageReferences: readonly CanvasPageReference[];
  readonly plainText: string;
  readonly preview: string;
}

export interface CanvasDocumentEnvelope {
  readonly documentId: DocumentId;
  readonly document: Y.Doc;
  readonly elements: Y.Map<CanvasElementSnapshot>;
  readonly order: Y.Map<string>;
  readonly appState: Y.Map<CanvasJsonValue>;
  readonly files: Y.Map<CanvasFileSnapshot>;
}

export interface CanvasSceneSnapshot {
  readonly elements: readonly unknown[];
  readonly appState?: Readonly<Record<string, unknown>>;
  readonly files?: Readonly<Record<string, unknown>>;
}

export interface CanvasForwardRestorePlan {
  readonly kind: "canvas_forward_restore";
  readonly restoreIdentity: string;
  readonly targetSemanticFingerprint: string;
  readonly elements: readonly CanvasElementSnapshot[];
  readonly appState: CanvasSharedAppState;
  readonly files: Readonly<Record<string, CanvasFileSnapshot>>;
  readonly restoredElementIds: readonly string[];
}

export class CanvasDocumentSchemaError extends TypeError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CanvasDocumentSchemaError";
  }
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requireIdentity = (value: unknown, field: string): string => {
  if (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_CANVAS_ID_LENGTH &&
    value === value.trim()
  ) {
    return value;
  }
  throw new CanvasDocumentSchemaError(
    `${field} must be a canonical non-empty identity`,
  );
};

const requireSafeInteger = (
  value: unknown,
  field: string,
  minimum: number,
): number => {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= minimum) {
    return value;
  }
  throw new CanvasDocumentSchemaError(
    `${field} must be a safe integer >= ${minimum}`,
  );
};

const canonicalJsonRecord = (
  value: unknown,
  field: string,
): Readonly<Record<string, CanvasJsonValue>> => {
  if (!isRecord(value)) {
    throw new CanvasDocumentSchemaError(`${field} must be a JSON object`);
  }
  try {
    const canonical = stableStringifyBlockPropertyJson(value);
    const parsed = JSON.parse(canonical) as unknown;
    if (isRecord(parsed)) {
      return parsed as Readonly<Record<string, CanvasJsonValue>>;
    }
  } catch (error) {
    throw new CanvasDocumentSchemaError(
      `${field} must contain bounded portable JSON`,
      { cause: error },
    );
  }
  throw new CanvasDocumentSchemaError(`${field} must be a JSON object`);
};

const canonicalString = (value: unknown): string =>
  stableStringifyBlockPropertyJson(value);

/**
 * Canvas state may legitimately exceed the public 2 MiB mutation envelope.
 * Element-level validation still uses the stricter property JSON codec, while
 * durable scene fingerprints need a separate bounded canonical serializer so
 * trusted genesis and forward restore can use the Adapter's 16 MiB state cap.
 */
const stableStringifyCanvasProjection = (value: unknown): string => {
  const seen = new WeakSet<object>();
  let nodes = 0;
  const visit = (candidate: unknown, depth: number): string => {
    nodes += 1;
    if (nodes > MAX_CANVAS_PROJECTION_JSON_NODES) {
      throw new CanvasDocumentSchemaError(
        "Canvas projection exceeds the JSON node limit",
      );
    }
    if (depth > MAX_CANVAS_PROJECTION_JSON_DEPTH) {
      throw new CanvasDocumentSchemaError(
        "Canvas projection exceeds the JSON depth limit",
      );
    }
    if (candidate === null || typeof candidate === "boolean") {
      return JSON.stringify(candidate);
    }
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return JSON.stringify(candidate);
    }
    if (typeof candidate === "string") return JSON.stringify(candidate);
    if (typeof candidate !== "object" || candidate === null) {
      throw new CanvasDocumentSchemaError(
        "Canvas projection must contain only JSON values",
      );
    }
    if (seen.has(candidate)) {
      throw new CanvasDocumentSchemaError("Canvas projection must not be cyclic");
    }
    seen.add(candidate);
    try {
      const serialized = Array.isArray(candidate)
        ? `[${candidate.map((entry) => visit(entry, depth + 1)).join(",")}]`
        : `{${Object.keys(candidate)
            .sort()
            .map(
              (key) =>
                `${JSON.stringify(key)}:${visit(
                  (candidate as Readonly<Record<string, unknown>>)[key],
                  depth + 1,
                )}`,
            )
            .join(",")}}`;
      if (serialized.length <= MAX_CANVAS_PROJECTION_JSON_LENGTH) {
        return serialized;
      }
      throw new CanvasDocumentSchemaError(
        "Canvas projection exceeds the canonical JSON size limit",
      );
    } finally {
      seen.delete(candidate);
    }
  };
  return visit(value, 0);
};

const hashString32 = (value: string, seed: number): string => {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};

const deterministicVersionNonce = (
  restoreIdentity: string,
  elementId: string,
): number =>
  Number.parseInt(
    hashString32(`${restoreIdentity}\0${elementId}`, 0x811c9dc5),
    16,
  );

const revisionPayloadHash = (value: CanvasElementSnapshot): string => {
  const canonical = canonicalString(value);
  return [
    hashString32(canonical, 0x811c9dc5),
    hashString32(canonical, 0x9e3779b9),
    hashString32(canonical, 0x85ebca6b),
    hashString32(canonical, 0xc2b2ae35),
  ].join("");
};

const canvasElementVersion = (
  element: CanvasElementSnapshot,
): { readonly version: number; readonly versionNonce: number } => ({
  version: requireSafeInteger(element.version, `Canvas element ${String(element.id)}.version`, 1),
  versionNonce: requireSafeInteger(
    element.versionNonce,
    `Canvas element ${String(element.id)}.versionNonce`,
    0,
  ),
});

/**
 * Excalidraw's collaboration policy treats an element as one atomic value:
 * greater version wins; equal versions use the lower versionNonce. The final
 * hash tie-break makes malformed duplicate nonces converge without depending
 * on Yjs client ids.
 */
export const chooseCanvasElementWinner = (
  left: CanvasElementSnapshot,
  right: CanvasElementSnapshot,
): CanvasElementSnapshot => {
  const leftVersion = canvasElementVersion(left);
  const rightVersion = canvasElementVersion(right);
  if (leftVersion.version !== rightVersion.version) {
    return leftVersion.version > rightVersion.version ? left : right;
  }
  if (leftVersion.versionNonce !== rightVersion.versionNonce) {
    return leftVersion.versionNonce < rightVersion.versionNonce ? left : right;
  }
  const leftCanonical = canonicalString(left);
  const rightCanonical = canonicalString(right);
  return leftCanonical <= rightCanonical ? left : right;
};

/** A unique register key keeps concurrent contenders visible after Yjs merge. */
export const canvasElementRevisionKey = (
  element: CanvasElementSnapshot,
): string => {
  const elementId = requireIdentity(element.id, "Canvas element.id");
  const { version, versionNonce } = canvasElementVersion(element);
  return `${elementId}@${version.toString(36)}:${versionNonce.toString(36)}:${revisionPayloadHash(element)}`;
};

const canonicalTitleHint = (element: CanvasElementSnapshot): string | undefined => {
  const customData = element.customData;
  if (isRecord(customData) && typeof customData.titleHint === "string") {
    return customData.titleHint.slice(0, 512);
  }
  const label = element.label;
  if (isRecord(label) && typeof label.text === "string") {
    return label.text.slice(0, 512);
  }
  return undefined;
};

const canonicalizePageReference = (
  element: Readonly<Record<string, CanvasJsonValue>>,
): Readonly<Record<string, CanvasJsonValue>> => {
  const customData = element.customData;
  if (!isRecord(customData)) return element;
  if (
    customData.type !== "nodex-card" &&
    customData.type !== "nodex-card-reference"
  ) {
    return element;
  }
  const targetBlockId = requireIdentity(
    customData.targetBlockId ?? customData.cardId,
    `Canvas element ${String(element.id)}.customData.targetBlockId`,
  );
  const titleHint =
    typeof customData.titleHint === "string"
      ? customData.titleHint.slice(0, 512)
      : undefined;
  return {
    ...element,
    customData: {
      type: "nodex-card-reference",
      targetBlockId,
      ...(titleHint ? { titleHint } : {}),
    },
  };
};

export const canonicalizeCanvasElement = (
  value: unknown,
  expectedId?: string,
): CanvasElementSnapshot => {
  const record = canonicalJsonRecord(value, "Canvas element");
  const id = requireIdentity(record.id, "Canvas element.id");
  if (expectedId !== undefined && id !== expectedId) {
    throw new CanvasDocumentSchemaError(
      `Canvas element map key ${expectedId} does not match payload ${id}`,
    );
  }
  canvasElementVersion(record);
  if (typeof record.isDeleted !== "boolean") {
    throw new CanvasDocumentSchemaError(
      `Canvas element ${id}.isDeleted must be boolean`,
    );
  }
  if (
    record.index !== undefined &&
    (typeof record.index !== "string" ||
      record.index.length === 0 ||
      record.index.length > MAX_CANVAS_ORDER_KEY_LENGTH)
  ) {
    throw new CanvasDocumentSchemaError(
      `Canvas element ${id}.index must be a bounded string when present`,
    );
  }
  return canonicalizePageReference(record);
};

interface CanvasObservationNormalizationState {
  readonly seen: WeakSet<object>;
  nodes: number;
}

/**
 * Excalidraw's live element objects are JSON-serializable rather than literal
 * JSON: optional object fields such as `customData` are present with an
 * `undefined` value and disappear at Excalidraw's own JSON save boundary.
 * Normalize only that runtime representation here. Stored Y.Doc values still
 * pass through `canonicalizeCanvasElement` without this compatibility rule.
 */
const normalizeObservedCanvasJson = (
  value: unknown,
  field: string,
  depth: number,
  state: CanvasObservationNormalizationState,
): unknown => {
  state.nodes += 1;
  if (state.nodes > MAX_CANVAS_ELEMENT_JSON_NODES) {
    throw new CanvasDocumentSchemaError(
      `${field} exceeds the JSON node limit`,
    );
  }
  if (depth > MAX_CANVAS_ELEMENT_JSON_DEPTH) {
    throw new CanvasDocumentSchemaError(
      `${field} exceeds the JSON depth limit`,
    );
  }
  if (value === null || typeof value !== "object") return value;
  if (state.seen.has(value)) {
    throw new CanvasDocumentSchemaError(`${field} must not be cyclic`);
  }
  state.seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry, index) =>
        normalizeObservedCanvasJson(
          entry,
          `${field}[${index}]`,
          depth + 1,
          state,
        ),
      );
    }
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new CanvasDocumentSchemaError(
        `${field} must contain only plain JSON objects`,
      );
    }
    const normalized: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry === undefined) continue;
      normalized[key] = normalizeObservedCanvasJson(
        entry,
        `${field}.${key}`,
        depth + 1,
        state,
      );
    }
    return normalized;
  } finally {
    state.seen.delete(value);
  }
};

const canonicalizeObservedCanvasElement = (
  value: unknown,
): CanvasElementSnapshot =>
  canonicalizeCanvasElement(
    normalizeObservedCanvasJson(value, "Canvas element", 0, {
      seen: new WeakSet<object>(),
      nodes: 0,
    }),
  );

const canonicalizeCanvasFile = (
  value: unknown,
  expectedId: string,
): CanvasFileSnapshot => {
  const record = canonicalJsonRecord(value, `Canvas file ${expectedId}`);
  const allowedKeys = new Set(["id", "mimeType", "source", "created"]);
  const unsupportedKey = Object.keys(record).find(
    (key) => !allowedKeys.has(key),
  );
  if (unsupportedKey) {
    throw new CanvasDocumentSchemaError(
      `Canvas file ${expectedId} contains unsupported field ${unsupportedKey}`,
    );
  }
  const id = requireIdentity(record.id, `Canvas file ${expectedId}.id`);
  if (id !== expectedId) {
    throw new CanvasDocumentSchemaError(
      `Canvas file map key ${expectedId} does not match payload ${id}`,
    );
  }
  if (
    typeof record.mimeType !== "string" ||
    record.mimeType.length === 0 ||
    record.mimeType.length > 256
  ) {
    throw new CanvasDocumentSchemaError(
      `Canvas file ${expectedId}.mimeType must be a bounded string`,
    );
  }
  const parsedSource =
    typeof record.source === "string" ? parseAssetSource(record.source) : null;
  if (
    !parsedSource ||
    record.source !== getAssetSource(parsedSource.fileName)
  ) {
    throw new CanvasDocumentSchemaError(
      `Canvas file ${expectedId}.source must be a managed asset URI`,
    );
  }
  if (
    record.created !== undefined &&
    (typeof record.created !== "number" ||
      !Number.isSafeInteger(record.created) ||
      record.created < 0)
  ) {
    throw new CanvasDocumentSchemaError(
      `Canvas file ${expectedId}.created must be a non-negative safe integer`,
    );
  }
  return {
    id,
    mimeType: record.mimeType,
    source: record.source,
    ...(record.created === undefined ? {} : { created: record.created }),
  };
};

export const pickDurableCanvasAppState = (
  value: Readonly<Record<string, unknown>> | undefined,
): CanvasSharedAppState => {
  if (!value) return {};
  const candidate: Record<string, unknown> = {};
  for (const key of DURABLE_CANVAS_APP_STATE_KEYS) {
    if (value[key] !== undefined) candidate[key] = value[key];
  }
  const durable = canonicalJsonRecord(candidate, "Canvas appState");
  if (
    durable.gridModeEnabled !== undefined &&
    typeof durable.gridModeEnabled !== "boolean"
  ) {
    throw new CanvasDocumentSchemaError(
      "Canvas appState.gridModeEnabled must be boolean",
    );
  }
  for (const key of ["gridSize", "gridStep"] as const) {
    const entry = durable[key];
    if (
      entry !== undefined &&
      entry !== null &&
      (typeof entry !== "number" || !Number.isFinite(entry) || entry <= 0)
    ) {
      throw new CanvasDocumentSchemaError(
        `Canvas appState.${key} must be a positive number or null`,
      );
    }
  }
  if (
    durable.viewBackgroundColor !== undefined &&
    (typeof durable.viewBackgroundColor !== "string" ||
      durable.viewBackgroundColor.length > 128)
  ) {
    throw new CanvasDocumentSchemaError(
      "Canvas appState.viewBackgroundColor must be a bounded string",
    );
  }
  return durable;
};

const fallbackOrderKey = (ordinal: number): string =>
  `legacy:${ordinal.toString(16).padStart(16, "0")}`;

const orderKeyForElement = (
  element: CanvasElementSnapshot,
  ordinal: number,
): string =>
  typeof element.index === "string" && element.index.length > 0
    ? element.index
    : fallbackOrderKey(ordinal);

const openCanvasRoots = (document: Y.Doc): Omit<CanvasDocumentEnvelope, "documentId"> => ({
  document,
  elements: document.getMap<CanvasElementSnapshot>(CANVAS_ELEMENTS_ROOT),
  order: document.getMap<string>(CANVAS_ORDER_ROOT),
  appState: document.getMap<CanvasJsonValue>(CANVAS_APP_STATE_ROOT),
  files: document.getMap<CanvasFileSnapshot>(CANVAS_FILES_ROOT),
});

export const openCanvasDocument = (input: {
  readonly documentId: DocumentId;
  readonly document: Y.Doc;
}): CanvasDocumentEnvelope => ({
  documentId: input.documentId,
  ...openCanvasRoots(input.document),
});

export const createCanvasDocument = (input: {
  readonly documentId: DocumentId;
  readonly initialScene?: CanvasSceneSnapshot;
}): CanvasDocumentEnvelope => {
  const document = new Y.Doc({ guid: input.documentId });
  const envelope = openCanvasDocument({
    documentId: input.documentId,
    document,
  });
  if (input.initialScene) {
    applyCanvasSceneSnapshot(envelope, input.initialScene, "canvas-genesis");
  }
  return envelope;
};

const canonicalCanvasElements = (
  elements: readonly unknown[],
  source: "stored" | "observation" = "stored",
): readonly CanvasElementSnapshot[] => {
  if (elements.length > MAX_CANVAS_ELEMENTS) {
    throw new CanvasDocumentSchemaError(
      `Canvas scene exceeds ${MAX_CANVAS_ELEMENTS} elements`,
    );
  }
  const canonical = elements.map((element) =>
    source === "observation"
      ? canonicalizeObservedCanvasElement(element)
      : canonicalizeCanvasElement(element),
  );
  const ids = canonical.map((element) => element.id as string);
  if (new Set(ids).size !== ids.length) {
    throw new CanvasDocumentSchemaError("Canvas scene repeats an element id");
  }
  return canonical;
};

const readCanvasElementRevisionGroups = (
  envelope: CanvasDocumentEnvelope,
): ReadonlyMap<
  string,
  readonly (readonly [string, CanvasElementSnapshot])[]
> => {
  if (envelope.elements.size > MAX_CANVAS_ELEMENT_REVISIONS) {
    throw new CanvasDocumentSchemaError(
      `Canvas scene exceeds ${MAX_CANVAS_ELEMENT_REVISIONS} element revisions`,
    );
  }
  const groups = new Map<
    string,
    Array<readonly [string, CanvasElementSnapshot]>
  >();
  for (const [revisionKey, candidateValue] of envelope.elements) {
    const candidate = canonicalizeCanvasElement(candidateValue);
    if (canvasElementRevisionKey(candidate) !== revisionKey) {
      throw new CanvasDocumentSchemaError(
        `Canvas element revision key ${revisionKey} does not match its payload`,
      );
    }
    const elementId = candidate.id as string;
    const known = groups.get(elementId) ?? [];
    known.push([revisionKey, candidate]);
    groups.set(elementId, known);
  }
  return groups;
};

const winnerFromRevisions = (
  revisions: readonly (readonly [string, CanvasElementSnapshot])[],
): CanvasElementSnapshot | null =>
  revisions
    .map(([, candidate]) => candidate)
    .reduce<CanvasElementSnapshot | null>(
      (winner, candidate) =>
        winner ? chooseCanvasElementWinner(winner, candidate) : candidate,
      null,
    );

const applyCanvasElementCandidates = (
  envelope: CanvasDocumentEnvelope,
  canonicalElements: readonly CanvasElementSnapshot[],
  revisionGroups: ReadonlyMap<
    string,
    readonly (readonly [string, CanvasElementSnapshot])[]
  >,
): void => {
  canonicalElements.forEach((element, ordinal) => {
    const elementId = element.id as string;
    const knownRevisions = revisionGroups.get(elementId) ?? [];
    const current = winnerFromRevisions(knownRevisions);
    const winner = current ? chooseCanvasElementWinner(current, element) : element;
    const candidateCanonical = canonicalString(element);
    const winnerIsCandidate = canonicalString(winner) === candidateCanonical;
    const currentIsCandidate =
      current !== null && canonicalString(current) === candidateCanonical;
    const candidateRevisionKey = canvasElementRevisionKey(element);
    const registerIsCanonical =
      knownRevisions.length === 1 &&
      knownRevisions[0]?.[0] === candidateRevisionKey;
    if (winnerIsCandidate && (!currentIsCandidate || !registerIsCanonical)) {
      for (const [revisionKey] of knownRevisions) {
        envelope.elements.delete(revisionKey);
      }
      envelope.elements.set(candidateRevisionKey, element);
    }
    if (typeof winner.index === "string" && winner.index.length > 0) {
      envelope.order.delete(elementId);
      return;
    }
    const nextOrder = orderKeyForElement(winner, ordinal);
    if (envelope.order.get(elementId) !== nextOrder) {
      envelope.order.set(elementId, nextOrder);
    }
  });
};

/**
 * Apply one complete Excalidraw scene observation. Callers must supply
 * getSceneElementsIncludingDeleted(); element absence is never interpreted as
 * deletion, while the bounded shared appState and files roots are exact.
 */
export const applyCanvasSceneSnapshot = (
  envelope: CanvasDocumentEnvelope,
  snapshot: CanvasSceneSnapshot,
  origin: unknown = "canvas-local-scene",
): void => {
  if (!Array.isArray(snapshot.elements)) {
    throw new CanvasDocumentSchemaError("Canvas scene elements must be an array");
  }
  const appState = pickDurableCanvasAppState(snapshot.appState);
  const files = snapshot.files ?? {};
  if (Object.keys(files).length > MAX_CANVAS_FILES) {
    throw new CanvasDocumentSchemaError(
      `Canvas scene exceeds ${MAX_CANVAS_FILES} files`,
    );
  }
  const canonicalElements = canonicalCanvasElements(snapshot.elements);
  const canonicalFiles = new Map(
    Object.entries(files).map(([fileId, value]) => {
      const id = requireIdentity(fileId, "Canvas file id");
      return [id, canonicalizeCanvasFile(value, id)] as const;
    }),
  );
  const revisionGroups = readCanvasElementRevisionGroups(envelope);

  envelope.document.transact(() => {
    applyCanvasElementCandidates(envelope, canonicalElements, revisionGroups);
    for (const key of [...envelope.appState.keys()]) {
      if (appState[key] === undefined) envelope.appState.delete(key);
    }
    for (const [key, value] of Object.entries(appState)) {
      const current = envelope.appState.get(key);
      if (
        current !== undefined &&
        canonicalString(current) === canonicalString(value)
      ) {
        continue;
      }
      envelope.appState.set(key, value);
    }
    for (const fileId of [...envelope.files.keys()]) {
      if (!canonicalFiles.has(fileId)) envelope.files.delete(fileId);
    }
    for (const [fileId, next] of canonicalFiles) {
      const current = envelope.files.get(fileId);
      if (current && canonicalString(current) === canonicalString(next)) continue;
      envelope.files.set(fileId, next);
    }
  }, origin);
};

export interface CanvasSharedAppStateFieldPatch {
  /** Shared value observed when the local field intent was captured. */
  readonly expected: CanvasJsonValue | undefined;
  /** Locally observed replacement; undefined means delete the durable field. */
  readonly value: CanvasJsonValue | undefined;
}

export type CanvasSharedAppStatePatch = Readonly<
  Record<string, CanvasSharedAppStateFieldPatch>
>;

const sameOptionalCanvasJsonValue = (
  left: CanvasJsonValue | undefined,
  right: CanvasJsonValue | undefined,
): boolean => {
  if (left === undefined || right === undefined) return left === right;
  return canonicalString(left) === canonicalString(right);
};

const canonicalizeCanvasAppStatePatchValue = (
  key: string,
  value: unknown,
  field: "expected" | "value",
): CanvasJsonValue | undefined => {
  if (!DURABLE_CANVAS_APP_STATE_KEYS.has(key)) {
    throw new CanvasDocumentSchemaError(
      `Canvas appState patch contains non-durable key ${key}`,
    );
  }
  if (value === undefined) return undefined;
  const validated = pickDurableCanvasAppState({ [key]: value });
  const canonical = validated[key];
  if (canonical !== undefined) return canonical;
  throw new CanvasDocumentSchemaError(
    `Canvas appState patch ${key}.${field} is invalid`,
  );
};

/**
 * Rebase a queued local surface observation onto the latest remote scene.
 * Elements remain contender-based, appState applies only local field intent,
 * and files are pruned only after resolving winners from both sides.
 */
export const applyRebasedCanvasSceneObservation = (
  envelope: CanvasDocumentEnvelope,
  input: {
    readonly elementsIncludingDeleted: readonly unknown[];
    readonly appStatePatch: CanvasSharedAppStatePatch;
    readonly fileAdditions: Readonly<Record<string, unknown>>;
  },
  origin: unknown = "canvas-local-rebased-scene",
): void => {
  const canonicalElements = canonicalCanvasElements(
    input.elementsIncludingDeleted,
    "observation",
  );
  if (Object.keys(input.fileAdditions).length > MAX_CANVAS_FILES) {
    throw new CanvasDocumentSchemaError(
      `Canvas scene exceeds ${MAX_CANVAS_FILES} file additions`,
    );
  }
  const canonicalFileAdditions = new Map<string, CanvasFileSnapshot>();
  for (const [fileId, file] of Object.entries(input.fileAdditions)) {
    const id = requireIdentity(fileId, "Canvas file id");
    const addition = canonicalizeCanvasFile(file, id);
    canonicalFileAdditions.set(id, addition);
  }
  const appStatePatch: Record<string, CanvasSharedAppStateFieldPatch> = {};
  for (const [key, patch] of Object.entries(input.appStatePatch)) {
    if (!isRecord(patch)) {
      throw new CanvasDocumentSchemaError(
        `Canvas appState patch ${key} must be an intent object`,
      );
    }
    const unsupportedKey = Object.keys(patch).find(
      (candidate) => candidate !== "expected" && candidate !== "value",
    );
    if (unsupportedKey) {
      throw new CanvasDocumentSchemaError(
        `Canvas appState patch ${key} contains unsupported field ${unsupportedKey}`,
      );
    }
    if (!("expected" in patch) || !("value" in patch)) {
      throw new CanvasDocumentSchemaError(
        `Canvas appState patch ${key} must contain expected and value`,
      );
    }
    appStatePatch[key] = {
      expected: canonicalizeCanvasAppStatePatchValue(
        key,
        patch.expected,
        "expected",
      ),
      value: canonicalizeCanvasAppStatePatchValue(key, patch.value, "value"),
    };
  }

  envelope.document.transact(() => {
    if (envelope.files.size > MAX_CANVAS_FILES) {
      throw new CanvasDocumentSchemaError(
        `Canvas scene exceeds ${MAX_CANVAS_FILES} files`,
      );
    }
    const revisionGroups = readCanvasElementRevisionGroups(envelope);
    const winners = new Map<string, CanvasElementSnapshot>();
    for (const [elementId, revisions] of revisionGroups) {
      const winner = winnerFromRevisions(revisions);
      if (winner) winners.set(elementId, winner);
    }
    for (const candidate of canonicalElements) {
      const elementId = candidate.id as string;
      const current = winners.get(elementId);
      winners.set(
        elementId,
        current ? chooseCanvasElementWinner(current, candidate) : candidate,
      );
    }
    const referencedFileIds = new Set<string>();
    for (const winner of winners.values()) {
      if (
        winner.isDeleted !== true &&
        winner.type === "image" &&
        typeof winner.fileId === "string"
      ) {
        referencedFileIds.add(winner.fileId);
      }
    }
    if (referencedFileIds.size > MAX_CANVAS_FILES) {
      throw new CanvasDocumentSchemaError(
        `Canvas scene exceeds ${MAX_CANVAS_FILES} files`,
      );
    }
    const combinedFiles = new Map<string, CanvasFileSnapshot>();
    for (const [fileId, file] of envelope.files) {
      combinedFiles.set(fileId, canonicalizeCanvasFile(file, fileId));
    }
    for (const [fileId, addition] of canonicalFileAdditions) {
      const current = combinedFiles.get(fileId);
      if (current && canonicalString(current) !== canonicalString(addition)) {
        throw new CanvasDocumentSchemaError(
          `Canvas managed file ${fileId} cannot be redefined`,
        );
      }
      combinedFiles.set(fileId, addition);
    }
    for (const fileId of referencedFileIds) {
      if (combinedFiles.has(fileId)) continue;
      throw new CanvasDocumentSchemaError(
        `Canvas image references missing managed file ${fileId}`,
      );
    }

    applyCanvasElementCandidates(envelope, canonicalElements, revisionGroups);
    for (const [key, patch] of Object.entries(appStatePatch)) {
      const current = envelope.appState.get(key);
      if (!sameOptionalCanvasJsonValue(current, patch.expected)) continue;
      if (patch.value === undefined) {
        envelope.appState.delete(key);
      } else if (
        !sameOptionalCanvasJsonValue(current, patch.value)
      ) {
        envelope.appState.set(key, patch.value);
      }
    }
    for (const [fileId, file] of combinedFiles) {
      if (referencedFileIds.has(fileId)) {
        if (
          canonicalString(envelope.files.get(fileId) ?? null) !==
          canonicalString(file)
        ) {
          envelope.files.set(fileId, file);
        }
      } else if (envelope.files.has(fileId)) {
        envelope.files.delete(fileId);
      }
    }
  }, origin);
};

const assertExactCanvasRoots = (document: Y.Doc): void => {
  const actual = [...document.share.keys()].sort();
  const expected = [...CANVAS_ROOT_NAMES].sort();
  if (actual.length === expected.length && actual.every((name, index) => name === expected[index])) {
    return;
  }
  throw new CanvasDocumentSchemaError(
    `Canvas Document roots must be exactly ${expected.join(", ")}`,
  );
};

const readCanvasPageReference = (
  element: CanvasElementSnapshot,
): CanvasPageReference | null => {
  if (element.isDeleted === true) return null;
  const customData = element.customData;
  if (!isRecord(customData) || customData.type !== "nodex-card-reference") {
    return null;
  }
  const targetBlockId = requireIdentity(
    customData.targetBlockId,
    `Canvas element ${String(element.id)}.customData.targetBlockId`,
  );
  return {
    sourceElementId: element.id as string,
    targetBlockId,
    ...(canonicalTitleHint(element)
      ? { titleHint: canonicalTitleHint(element) }
      : {}),
  };
};

const elementPlainText = (element: CanvasElementSnapshot): string => {
  if (element.isDeleted === true) return "";
  if (typeof element.text === "string") return element.text;
  const label = element.label;
  if (isRecord(label) && typeof label.text === "string") return label.text;
  return "";
};

export const inspectCanvasDocument = (
  document: Y.Doc,
): {
  readonly envelope: CanvasDocumentEnvelope;
  readonly materialization: CanvasSceneMaterialization;
} => {
  const roots = openCanvasRoots(document);
  assertExactCanvasRoots(document);
  const documentId = requireIdentity(document.guid, "Canvas documentId");
  if (roots.elements.size > MAX_CANVAS_ELEMENT_REVISIONS) {
    throw new CanvasDocumentSchemaError(
      `Canvas scene exceeds ${MAX_CANVAS_ELEMENT_REVISIONS} element revisions`,
    );
  }
  if (roots.files.size > MAX_CANVAS_FILES) {
    throw new CanvasDocumentSchemaError(
      `Canvas scene exceeds ${MAX_CANVAS_FILES} files`,
    );
  }
  const winnerByElementId = new Map<string, CanvasElementSnapshot>();
  for (const [revisionKey, value] of roots.elements) {
    const element = canonicalizeCanvasElement(value);
    const expectedRevisionKey = canvasElementRevisionKey(element);
    if (revisionKey !== expectedRevisionKey) {
      throw new CanvasDocumentSchemaError(
        `Canvas element revision key ${revisionKey} does not match its payload`,
      );
    }
    const elementId = element.id as string;
    const current = winnerByElementId.get(elementId);
    winnerByElementId.set(
      elementId,
      current ? chooseCanvasElementWinner(current, element) : element,
    );
  }
  if (winnerByElementId.size > MAX_CANVAS_ELEMENTS) {
    throw new CanvasDocumentSchemaError(
      `Canvas scene exceeds ${MAX_CANVAS_ELEMENTS} elements`,
    );
  }
  const elements = [...winnerByElementId.values()].map((element) => {
    const elementId = element.id as string;
    const indexedOrder =
      typeof element.index === "string" && element.index.length > 0
        ? element.index
        : null;
    const fallback = roots.order.get(elementId);
    if (
      indexedOrder === null &&
      (typeof fallback !== "string" ||
        fallback.length === 0 ||
        fallback.length > MAX_CANVAS_ORDER_KEY_LENGTH)
    ) {
      throw new CanvasDocumentSchemaError(
        `Canvas element ${elementId} has neither an index nor a fallback order key`,
      );
    }
    return { element, orderKey: indexedOrder ?? (fallback as string) };
  });
  for (const elementId of roots.order.keys()) {
    if (winnerByElementId.has(elementId)) continue;
    throw new CanvasDocumentSchemaError(
      `Canvas order contains unknown element ${elementId}`,
    );
  }
  elements.sort((left, right) =>
    left.orderKey === right.orderKey
      ? (left.element.id as string).localeCompare(right.element.id as string)
      : left.orderKey.localeCompare(right.orderKey),
  );
  const appStateRecord: Record<string, unknown> = {};
  for (const [key, value] of roots.appState) {
    if (!DURABLE_CANVAS_APP_STATE_KEYS.has(key)) {
      throw new CanvasDocumentSchemaError(
        `Canvas appState contains non-durable key ${key}`,
      );
    }
    appStateRecord[key] = value;
  }
  const appState = pickDurableCanvasAppState(appStateRecord);
  const files: Record<string, CanvasFileSnapshot> = {};
  for (const [fileId, value] of roots.files) {
    const id = requireIdentity(fileId, "Canvas file map key");
    files[id] = canonicalizeCanvasFile(value, id);
  }
  const orderedElements = elements.map(({ element }) => element);
  const pageReferences = orderedElements
    .map(readCanvasPageReference)
    .filter((reference): reference is CanvasPageReference => reference !== null);
  const plainText = orderedElements
    .map(elementPlainText)
    .filter((text) => text.length > 0)
    .join("\n")
    .slice(0, MAX_CANVAS_SHARED_TEXT_LENGTH);
  return {
    envelope: {
      documentId,
      ...roots,
    },
    materialization: {
      kind: CANVAS_DOCUMENT_KIND,
      schemaVersion: CANVAS_DOCUMENT_SCHEMA_VERSION,
      elements: orderedElements,
      appState,
      files,
      pageReferences,
      plainText,
      preview: plainText.replace(/\s+/gu, " ").trim().slice(0, 280),
    },
  };
};

export const canonicalCanvasSceneFingerprint = (
  materialization: CanvasSceneMaterialization,
): string =>
  stableStringifyCanvasProjection({
    schemaVersion: materialization.schemaVersion,
    elements: materialization.elements,
    appState: materialization.appState,
    files: materialization.files,
    pageReferences: materialization.pageReferences,
  });

const canvasElementSemanticValue = (
  element: CanvasElementSnapshot,
): CanvasElementSnapshot =>
  Object.fromEntries(
    Object.entries(element).filter(
      ([key]) => key !== "version" && key !== "versionNonce",
    ),
  ) as CanvasElementSnapshot;

/**
 * History restore compares visible scene semantics rather than Excalidraw's
 * monotonic merge metadata. Deleted registers are equivalent to absence:
 * forward restore retains tombstones so stale updates cannot resurrect them.
 */
export const canonicalCanvasSceneSemanticFingerprint = (
  materialization: CanvasSceneMaterialization,
): string =>
  stableStringifyCanvasProjection({
    schemaVersion: materialization.schemaVersion,
    elements: materialization.elements
      .filter((element) => element.isDeleted !== true)
      .map(canvasElementSemanticValue),
    appState: materialization.appState,
    files: materialization.files,
  });

/** Parse a persisted projection and re-derive every disposable field. */
export const parseCanvasSceneMaterialization = (input: {
  readonly documentId: DocumentId;
  readonly value: unknown;
}): CanvasSceneMaterialization => {
  if (!isRecord(input.value)) {
    throw new CanvasDocumentSchemaError(
      "Canvas materialization must be an object",
    );
  }
  const value = input.value;
  if (
    value.kind !== CANVAS_DOCUMENT_KIND ||
    value.schemaVersion !== CANVAS_DOCUMENT_SCHEMA_VERSION ||
    !Array.isArray(value.elements) ||
    !isRecord(value.appState) ||
    !isRecord(value.files) ||
    !Array.isArray(value.pageReferences) ||
    typeof value.plainText !== "string" ||
    typeof value.preview !== "string"
  ) {
    throw new CanvasDocumentSchemaError(
      "Canvas materialization has invalid field shapes",
    );
  }
  const envelope = createCanvasDocument({
    documentId: input.documentId,
    initialScene: {
      elements: value.elements,
      appState: value.appState,
      files: value.files,
    },
  });
  try {
    const derived = inspectCanvasDocument(envelope.document).materialization;
    if (
      stableStringifyCanvasProjection(derived.elements) !==
        stableStringifyCanvasProjection(value.elements) ||
      stableStringifyCanvasProjection(derived.appState) !==
        stableStringifyCanvasProjection(value.appState) ||
      stableStringifyCanvasProjection(derived.files) !==
        stableStringifyCanvasProjection(value.files) ||
      stableStringifyCanvasProjection(derived.pageReferences) !==
        stableStringifyCanvasProjection(value.pageReferences) ||
      derived.plainText !== value.plainText ||
      derived.preview !== value.preview
    ) {
      throw new CanvasDocumentSchemaError(
        "Canvas materialization does not match its derived scene projection",
      );
    }
    return derived;
  } finally {
    envelope.document.destroy();
  }
};

const nextCanvasElementVersion = (
  current: CanvasElementSnapshot | undefined,
  target: CanvasElementSnapshot,
): number => {
  const currentVersion = current ? canvasElementVersion(current).version : 0;
  const targetVersion = canvasElementVersion(target).version;
  const nextVersion = Math.max(currentVersion, targetVersion) + 1;
  if (Number.isSafeInteger(nextVersion)) return nextVersion;
  throw new CanvasDocumentSchemaError(
    `Canvas element ${String(target.id)} cannot advance beyond MAX_SAFE_INTEGER`,
  );
};

/**
 * Compile an old checkpoint into a new monotonic scene. This never rewinds a
 * Yjs log or replays the historical full update: target elements receive new
 * Excalidraw versions, while current-only elements become newer tombstones.
 */
export const compileCanvasForwardRestorePlan = (input: {
  readonly current: CanvasSceneMaterialization;
  readonly target: CanvasSceneMaterialization;
  readonly restoreIdentity: string;
}): CanvasForwardRestorePlan => {
  const restoreIdentity = requireIdentity(
    input.restoreIdentity,
    "Canvas restore identity",
  );
  const currentById = new Map(
    input.current.elements.map((element) => [element.id as string, element]),
  );
  const targetById = new Map(
    input.target.elements.map((element) => [element.id as string, element]),
  );
  const elements: CanvasElementSnapshot[] = input.target.elements.map(
    (target) => {
      const elementId = target.id as string;
      return canonicalizeCanvasElement({
        ...target,
        version: nextCanvasElementVersion(currentById.get(elementId), target),
        versionNonce: deterministicVersionNonce(restoreIdentity, elementId),
      });
    },
  );
  for (const current of input.current.elements) {
    const elementId = current.id as string;
    if (targetById.has(elementId)) continue;
    elements.push(
      canonicalizeCanvasElement({
        ...current,
        version: nextCanvasElementVersion(current, current),
        versionNonce: deterministicVersionNonce(restoreIdentity, elementId),
        isDeleted: true,
      }),
    );
  }
  const appState = pickDurableCanvasAppState(input.target.appState);
  const files = Object.fromEntries(
    Object.entries(input.target.files)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([fileId, file]) => [fileId, canonicalizeCanvasFile(file, fileId)]),
  );
  return {
    kind: "canvas_forward_restore",
    restoreIdentity,
    targetSemanticFingerprint:
      canonicalCanvasSceneSemanticFingerprint(input.target),
    elements,
    appState,
    files,
    restoredElementIds: elements
      .map((element) => element.id as string)
      .sort((left, right) => left.localeCompare(right)),
  };
};

/** Apply a compiled restore as one new Yjs transaction with exact durable roots. */
export const applyCanvasForwardRestorePlan = (
  envelope: CanvasDocumentEnvelope,
  plan: CanvasForwardRestorePlan,
  origin: unknown = `canvas-history-restore:${plan.restoreIdentity}`,
): void => {
  const revisionsByElementId = new Map<string, string[]>();
  for (const [revisionKey, value] of envelope.elements) {
    const element = canonicalizeCanvasElement(value);
    if (canvasElementRevisionKey(element) !== revisionKey) {
      throw new CanvasDocumentSchemaError(
        `Canvas element revision key ${revisionKey} does not match its payload`,
      );
    }
    const elementId = element.id as string;
    const revisions = revisionsByElementId.get(elementId) ?? [];
    revisions.push(revisionKey);
    revisionsByElementId.set(elementId, revisions);
  }
  envelope.document.transact(() => {
    plan.elements.forEach((element, ordinal) => {
      const elementId = element.id as string;
      for (const revisionKey of revisionsByElementId.get(elementId) ?? []) {
        envelope.elements.delete(revisionKey);
      }
      envelope.elements.set(canvasElementRevisionKey(element), element);
      if (typeof element.index === "string" && element.index.length > 0) {
        envelope.order.delete(elementId);
        return;
      }
      envelope.order.set(elementId, orderKeyForElement(element, ordinal));
    });
    for (const key of [...envelope.appState.keys()]) {
      if (plan.appState[key] === undefined) envelope.appState.delete(key);
    }
    for (const [key, value] of Object.entries(plan.appState)) {
      envelope.appState.set(key, value);
    }
    for (const fileId of [...envelope.files.keys()]) {
      if (plan.files[fileId] === undefined) envelope.files.delete(fileId);
    }
    for (const [fileId, file] of Object.entries(plan.files)) {
      envelope.files.set(fileId, file);
    }
  }, origin);
  const restored = inspectCanvasDocument(envelope.document).materialization;
  if (
    canonicalCanvasSceneSemanticFingerprint(restored) !==
    plan.targetSemanticFingerprint
  ) {
    throw new CanvasDocumentSchemaError(
      "Canvas forward restore did not reproduce the checkpoint semantics",
    );
  }
};
