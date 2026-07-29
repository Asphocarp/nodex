export interface CanvasViewportIdentity {
  readonly storeEpoch: string;
  readonly documentId: string;
}

export interface CanvasViewportPreference {
  readonly scrollX: number;
  readonly scrollY: number;
  readonly zoom: number;
}

interface StoredCanvasViewportPreference extends CanvasViewportPreference {
  readonly version: 1;
}

interface CanvasViewportStorage {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
}

export const canvasViewportPreferenceStoragePrefix =
  "nodex-canvas-viewport-v1:";

const MAX_IDENTITY_LENGTH = 512;
const MAX_SCROLL_MAGNITUDE = 1_000_000_000;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 30;
const DEFAULT_PERSIST_DELAY_MS = 300;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizeIdentity = (
  value: unknown,
): CanvasViewportIdentity | null => {
  if (!isRecord(value)) return null;
  const { storeEpoch, documentId } = value;
  if (
    typeof storeEpoch !== "string"
    || storeEpoch.length === 0
    || storeEpoch.length > MAX_IDENTITY_LENGTH
    || storeEpoch.trim() !== storeEpoch
    || typeof documentId !== "string"
    || documentId.length === 0
    || documentId.length > MAX_IDENTITY_LENGTH
    || documentId.trim() !== documentId
  ) {
    return null;
  }
  return { storeEpoch, documentId };
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

const resolveStorage = (): CanvasViewportStorage | null => {
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
  }:${encodeURIComponent(normalized.documentId)}`;
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

export const readCanvasViewportPreference = (
  identity: CanvasViewportIdentity,
  storage: CanvasViewportStorage | null = resolveStorage(),
): CanvasViewportPreference | null => {
  const key = getCanvasViewportPreferenceStorageKey(identity);
  if (!storage || !key) return null;
  try {
    const stored = parseStoredViewport(storage.getItem(key));
    if (!stored) return null;
    return {
      scrollX: stored.scrollX,
      scrollY: stored.scrollY,
      zoom: stored.zoom,
    };
  } catch {
    return null;
  }
};

export const writeCanvasViewportPreference = (
  identity: CanvasViewportIdentity,
  value: CanvasViewportPreference,
  storage: CanvasViewportStorage | null = resolveStorage(),
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

export interface CanvasViewportPersistence {
  readonly observe: (value: CanvasViewportPreference) => void;
  readonly flush: () => void;
  readonly dispose: () => void;
}

export const createCanvasViewportPersistence = (
  identity: CanvasViewportIdentity,
  options: {
    readonly delayMs?: number;
    readonly storage?: CanvasViewportStorage | null;
  } = {},
): CanvasViewportPersistence => {
  const storage = options.storage === undefined
    ? resolveStorage()
    : options.storage;
  const delayMs = options.delayMs ?? DEFAULT_PERSIST_DELAY_MS;
  let pending: CanvasViewportPreference | null = null;
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
    writeCanvasViewportPreference(identity, pending, storage);
    pending = null;
  };

  const observe = (value: CanvasViewportPreference): void => {
    if (disposed) return;
    const normalized = normalizeCanvasViewportPreference(value);
    if (!normalized) return;
    pending = normalized;
    cancelTimer();
    timer = setTimeout(flush, delayMs);
  };

  const dispose = (): void => {
    if (disposed) return;
    flush();
    disposed = true;
  };

  return { observe, flush, dispose };
};
