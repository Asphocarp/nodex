export interface CanvasViewportIdentity {
  readonly storeEpoch: string;
  readonly documentId: string;
  readonly preferenceScope: string;
}

export interface CanvasViewportPreference {
  readonly scrollX: number;
  readonly scrollY: number;
  readonly zoom: number;
}

interface StoredCanvasViewportPreference extends CanvasViewportPreference {
  readonly version: 1;
}

export interface CanvasInlineFrameIdentity {
  readonly storeEpoch: string;
  readonly canvasBlockId: string;
}

export interface CanvasInlineFramePreference {
  readonly heightPx: number;
}

interface StoredCanvasInlineFramePreference
  extends CanvasInlineFramePreference {
  readonly version: 1;
}

interface CanvasPreferenceStorage {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
  readonly length?: number;
  readonly key?: (index: number) => string | null;
}

export const canvasViewportPreferenceStoragePrefix =
  "nodex-canvas-viewport-v3:";
const legacyCanvasViewportPreferenceStoragePrefix =
  "nodex-canvas-viewport-v2:";
export const canvasInlineFramePreferenceStoragePrefix =
  "nodex-canvas-inline-frame-v1:";

const MAX_IDENTITY_LENGTH = 512;
const MAX_SCROLL_MAGNITUDE = 1_000_000_000;
const MAX_LEGACY_VIEWPORT_KEYS_TO_SCAN = 512;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 30;
const DEFAULT_PERSIST_DELAY_MS = 300;
export const DEFAULT_CANVAS_INLINE_FRAME_HEIGHT_PX = 288;
export const MIN_CANVAS_INLINE_FRAME_HEIGHT_PX = 224;
export const MAX_CANVAS_INLINE_FRAME_HEIGHT_PX = 1_600;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isCanonicalIdentityPart = (value: unknown): value is string =>
  typeof value === "string"
  && value.length > 0
  && value.length <= MAX_IDENTITY_LENGTH
  && value === value.trim()
  && !/[\u0000-\u001f\u007f]/u.test(value);

const normalizeIdentity = (
  value: unknown,
): CanvasViewportIdentity | null => {
  if (!isRecord(value)) return null;
  const { storeEpoch, documentId, preferenceScope } = value;
  if (
    !isCanonicalIdentityPart(storeEpoch)
    || !isCanonicalIdentityPart(documentId)
    || !isCanonicalIdentityPart(preferenceScope)
  ) {
    return null;
  }
  return { storeEpoch, documentId, preferenceScope };
};

const normalizeInlineFrameIdentity = (
  value: unknown,
): CanvasInlineFrameIdentity | null => {
  if (!isRecord(value)) return null;
  const { storeEpoch, canvasBlockId } = value;
  if (
    !isCanonicalIdentityPart(storeEpoch)
    || !isCanonicalIdentityPart(canvasBlockId)
  ) {
    return null;
  }
  return { storeEpoch, canvasBlockId };
};

export const normalizeCanvasViewportPreference = (
  value: unknown,
): CanvasViewportPreference | null => {
  if (!isRecord(value)) return null;
  const { scrollX, scrollY, zoom } = value;
  if (
    typeof scrollX !== "number"
    || !Number.isFinite(scrollX)
    || Math.abs(scrollX) > MAX_SCROLL_MAGNITUDE
    || typeof scrollY !== "number"
    || !Number.isFinite(scrollY)
    || Math.abs(scrollY) > MAX_SCROLL_MAGNITUDE
    || typeof zoom !== "number"
    || !Number.isFinite(zoom)
    || zoom < MIN_ZOOM
    || zoom > MAX_ZOOM
  ) {
    return null;
  }
  return { scrollX, scrollY, zoom };
};

export const normalizeCanvasInlineFramePreference = (
  value: unknown,
): CanvasInlineFramePreference | null => {
  if (!isRecord(value)) return null;
  const { heightPx } = value;
  if (typeof heightPx !== "number" || !Number.isFinite(heightPx)) {
    return null;
  }
  return {
    heightPx: Math.min(
      MAX_CANVAS_INLINE_FRAME_HEIGHT_PX,
      Math.max(
        MIN_CANVAS_INLINE_FRAME_HEIGHT_PX,
        Math.round(heightPx),
      ),
    ),
  };
};

const resolveStorage = (): CanvasPreferenceStorage | null => {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
};

export const getCanvasViewportPreferenceStorageKey = (
  identity: CanvasViewportIdentity,
): string | null => {
  const normalized = normalizeIdentity(identity);
  if (!normalized) return null;
  return `${canvasViewportPreferenceStoragePrefix}${
    encodeURIComponent(normalized.storeEpoch)
  }:${encodeURIComponent(normalized.documentId)}:${
    encodeURIComponent(normalized.preferenceScope)
  }`;
};

export const getCanvasInlineFramePreferenceStorageKey = (
  identity: CanvasInlineFrameIdentity,
): string | null => {
  const normalized = normalizeInlineFrameIdentity(identity);
  if (!normalized) return null;
  return `${canvasInlineFramePreferenceStoragePrefix}${
    encodeURIComponent(normalized.storeEpoch)
  }:${encodeURIComponent(normalized.canvasBlockId)}`;
};

const parseStoredViewport = (
  value: string | null,
): StoredCanvasViewportPreference | null => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    const viewport = normalizeCanvasViewportPreference(parsed);
    if (
      !viewport
      || !isRecord(parsed)
      || parsed.version !== 1
    ) {
      return null;
    }
    return {
      version: 1,
      ...viewport,
    };
  } catch {
    return null;
  }
};

interface StableStagePreferenceScope {
  readonly windowSessionId: string;
  readonly projectSessionId: string;
}

const parseStableStagePreferenceScope = (
  value: string,
): StableStagePreferenceScope | null => {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      !Array.isArray(parsed)
      || parsed.length !== 3
      || parsed[0] !== "stage"
      || !isCanonicalIdentityPart(parsed[1])
      || !isCanonicalIdentityPart(parsed[2])
    ) {
      return null;
    }
    return {
      windowSessionId: parsed[1],
      projectSessionId: parsed[2],
    };
  } catch {
    return null;
  }
};

const legacyStageScopeMatches = (
  value: string,
  stable: StableStagePreferenceScope,
  format: "v2" | "v3",
): boolean => {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return false;
    if (format === "v3") {
      return parsed.length === 4
        && parsed[0] === "stage"
        && parsed[1] === stable.windowSessionId
        && parsed[2] === stable.projectSessionId
        && isCanonicalIdentityPart(parsed[3]);
    }
    return parsed.length === 3
      && parsed[0] === stable.windowSessionId
      && parsed[1] === stable.projectSessionId
      && isCanonicalIdentityPart(parsed[2]);
  } catch {
    return false;
  }
};

const readLegacyStageViewportPreference = (
  identity: CanvasViewportIdentity,
  storage: CanvasPreferenceStorage,
): CanvasViewportPreference | null => {
  const stableScope = parseStableStagePreferenceScope(
    identity.preferenceScope,
  );
  const storageLength = storage.length;
  if (
    !stableScope
    || !storage.key
    || storageLength === undefined
    || !Number.isInteger(storageLength)
    || storageLength <= 0
  ) {
    return null;
  }
  const encodedDocumentCoordinate = `${
    encodeURIComponent(identity.storeEpoch)
  }:${encodeURIComponent(identity.documentId)}:`;
  const formats = [
    {
      format: "v3",
      documentPrefix:
        `${canvasViewportPreferenceStoragePrefix}${encodedDocumentCoordinate}`,
    },
    {
      format: "v2",
      documentPrefix:
        `${legacyCanvasViewportPreferenceStoragePrefix}${encodedDocumentCoordinate}`,
    },
  ] as const;
  const firstIndex = storageLength - 1;
  const finalIndex = Math.max(
    -1,
    storageLength - MAX_LEGACY_VIEWPORT_KEYS_TO_SCAN - 1,
  );

  for (let index = firstIndex; index > finalIndex; index -= 1) {
    const key = storage.key(index);
    if (!key) continue;
    for (const { format, documentPrefix } of formats) {
      if (!key.startsWith(documentPrefix)) continue;
      const encodedScope = key.slice(documentPrefix.length);
      let legacyScope: string;
      try {
        legacyScope = decodeURIComponent(encodedScope);
      } catch {
        continue;
      }
      if (!legacyStageScopeMatches(legacyScope, stableScope, format)) continue;
      const stored = parseStoredViewport(storage.getItem(key));
      if (!stored) continue;
      return {
        scrollX: stored.scrollX,
        scrollY: stored.scrollY,
        zoom: stored.zoom,
      };
    }
  }
  return null;
};

const parseStoredInlineFrame = (
  value: string | null,
): StoredCanvasInlineFramePreference | null => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    const frame = normalizeCanvasInlineFramePreference(parsed);
    if (!frame || !isRecord(parsed) || parsed.version !== 1) return null;
    return { version: 1, ...frame };
  } catch {
    return null;
  }
};

export const readCanvasViewportPreference = (
  identity: CanvasViewportIdentity,
  storage: CanvasPreferenceStorage | null = resolveStorage(),
): CanvasViewportPreference | null => {
  const key = getCanvasViewportPreferenceStorageKey(identity);
  if (!storage || !key) return null;
  try {
    const stored = parseStoredViewport(storage.getItem(key));
    if (stored) {
      return {
        scrollX: stored.scrollX,
        scrollY: stored.scrollY,
        zoom: stored.zoom,
      };
    }
    const legacy = readLegacyStageViewportPreference(identity, storage);
    if (!legacy) return null;
    writeCanvasViewportPreference(identity, legacy, storage);
    return legacy;
  } catch {
    return null;
  }
};

export const writeCanvasViewportPreference = (
  identity: CanvasViewportIdentity,
  value: CanvasViewportPreference,
  storage: CanvasPreferenceStorage | null = resolveStorage(),
): void => {
  const key = getCanvasViewportPreferenceStorageKey(identity);
  const normalizedViewport = normalizeCanvasViewportPreference(value);
  if (!storage || !key || !normalizedViewport) return;
  try {
    storage.setItem(key, JSON.stringify({
      version: 1,
      ...normalizedViewport,
    } satisfies StoredCanvasViewportPreference));
  } catch {
    // Renderer-local presentation preferences degrade silently.
  }
};

export const readCanvasInlineFramePreference = (
  identity: CanvasInlineFrameIdentity,
  storage: CanvasPreferenceStorage | null = resolveStorage(),
): CanvasInlineFramePreference | null => {
  const key = getCanvasInlineFramePreferenceStorageKey(identity);
  if (!storage || !key) return null;
  try {
    const stored = parseStoredInlineFrame(storage.getItem(key));
    return stored ? { heightPx: stored.heightPx } : null;
  } catch {
    return null;
  }
};

export const writeCanvasInlineFramePreference = (
  identity: CanvasInlineFrameIdentity,
  value: CanvasInlineFramePreference,
  storage: CanvasPreferenceStorage | null = resolveStorage(),
): void => {
  const key = getCanvasInlineFramePreferenceStorageKey(identity);
  const normalized = normalizeCanvasInlineFramePreference(value);
  if (!storage || !key || !normalized) return;
  try {
    storage.setItem(key, JSON.stringify({
      version: 1,
      ...normalized,
    } satisfies StoredCanvasInlineFramePreference));
  } catch {
    // Renderer-local presentation preferences degrade silently.
  }
};

export interface CanvasViewportPersistence {
  readonly observe: (value: CanvasViewportPreference) => void;
  readonly flush: () => void;
  readonly dispose: () => void;
}

export interface CanvasInlineFramePersistence {
  readonly observe: (value: CanvasInlineFramePreference) => void;
  readonly flush: () => void;
  readonly dispose: () => void;
}

const createDebouncedPreferencePersistence = <Value>(input: {
  readonly delayMs: number;
  readonly normalize: (value: unknown) => Value | null;
  readonly write: (value: Value) => void;
}): {
  readonly observe: (value: Value) => void;
  readonly flush: () => void;
  readonly dispose: () => void;
} => {
  let pending: Value | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const cancelTimer = (): void => {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
  };
  const flush = (): void => {
    cancelTimer();
    if (!pending) return;
    input.write(pending);
    pending = null;
  };
  const observe = (value: Value): void => {
    if (disposed) return;
    const normalized = input.normalize(value);
    if (!normalized) return;
    pending = normalized;
    cancelTimer();
    timer = setTimeout(flush, input.delayMs);
  };
  const dispose = (): void => {
    if (disposed) return;
    flush();
    disposed = true;
  };
  return { observe, flush, dispose };
};

export const createCanvasViewportPersistence = (
  identity: CanvasViewportIdentity,
  options: {
    readonly delayMs?: number;
    readonly storage?: CanvasPreferenceStorage | null;
  } = {},
): CanvasViewportPersistence => {
  const storage = options.storage === undefined
    ? resolveStorage()
    : options.storage;
  return createDebouncedPreferencePersistence({
    delayMs: options.delayMs ?? DEFAULT_PERSIST_DELAY_MS,
    normalize: normalizeCanvasViewportPreference,
    write: (value) =>
      writeCanvasViewportPreference(identity, value, storage),
  });
};

export const createCanvasInlineFramePersistence = (
  identity: CanvasInlineFrameIdentity,
  options: {
    readonly delayMs?: number;
    readonly storage?: CanvasPreferenceStorage | null;
  } = {},
): CanvasInlineFramePersistence => {
  const storage = options.storage === undefined
    ? resolveStorage()
    : options.storage;
  return createDebouncedPreferencePersistence({
    delayMs: options.delayMs ?? DEFAULT_PERSIST_DELAY_MS,
    normalize: normalizeCanvasInlineFramePreference,
    write: (value) =>
      writeCanvasInlineFramePreference(identity, value, storage),
  });
};

const canonicalScopePart = (value: string, label: string): string => {
  if (isCanonicalIdentityPart(value)) return value;
  throw new TypeError(`${label} must be a canonical bounded string`);
};

export const makeCanvasViewportPreferenceScope = (
  input:
    | {
        readonly variant: "inline";
        readonly canvasBlockId: string;
      }
    | {
        readonly variant: "stage";
        readonly windowSessionId: string;
        readonly projectSessionId: string;
      },
): string => {
  if (input.variant === "inline") {
    return JSON.stringify([
      input.variant,
      canonicalScopePart(input.canvasBlockId, "canvasBlockId"),
    ]);
  }
  return JSON.stringify([
    input.variant,
    canonicalScopePart(input.windowSessionId, "windowSessionId"),
    canonicalScopePart(input.projectSessionId, "projectSessionId"),
  ]);
};
