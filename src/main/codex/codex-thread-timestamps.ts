const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MILLIS_TIMESTAMP_THRESHOLD = 10_000_000_000;

export interface CodexThreadTimestampState {
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly recencyAt?: number;
}

export interface ReconciledCodexThreadTimestamps {
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly recencyAt: number;
}

export interface ReconcileCodexThreadTimestampsInput {
  readonly threadId: string;
  readonly observedCreatedAt: unknown;
  readonly observedUpdatedAt: unknown;
  readonly observedRecencyAt?: unknown;
  readonly existing: CodexThreadTimestampState | null;
  readonly nowMs?: number;
}

function normalizeObservedTimestamp(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  const milliseconds = value > MILLIS_TIMESTAMP_THRESHOLD
    ? Math.floor(value)
    : Math.floor(value * 1_000);
  return Number.isSafeInteger(milliseconds) ? milliseconds : null;
}

function normalizeMillisecondsTimestamp(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  const milliseconds = Math.floor(value);
  return Number.isSafeInteger(milliseconds) ? milliseconds : null;
}

/** Codex-generated Thread ids are UUIDv7, whose first 48 bits are Unix milliseconds. */
export function readCodexThreadUuidV7TimestampMs(threadId: string): number | null {
  if (!UUID_V7_PATTERN.test(threadId)) return null;
  const milliseconds = Number.parseInt(
    `${threadId.slice(0, 8)}${threadId.slice(9, 13)}`,
    16,
  );
  return Number.isSafeInteger(milliseconds) ? milliseconds : null;
}

function resolveNewThreadCreatedAt(input: {
  readonly threadId: string;
  readonly observedCreatedAt: number | null;
  readonly observedUpdatedAt: number | null;
  readonly nowMs: number;
}): number {
  const { observedCreatedAt, observedUpdatedAt } = input;
  const uuidTimestamp = readCodexThreadUuidV7TimestampMs(input.threadId);
  const uuidTimestampSeconds = uuidTimestamp === null
    ? null
    : Math.floor(uuidTimestamp / 1_000) * 1_000;
  if (
    uuidTimestampSeconds !== null
    && (observedUpdatedAt === null || uuidTimestampSeconds <= observedUpdatedAt)
  ) {
    return uuidTimestampSeconds;
  }

  if (
    observedCreatedAt !== null
    && (observedUpdatedAt === null || observedUpdatedAt >= observedCreatedAt)
  ) {
    return observedCreatedAt;
  }

  if (observedUpdatedAt !== null) {
    return Math.min(observedCreatedAt ?? observedUpdatedAt, observedUpdatedAt);
  }
  return observedCreatedAt ?? input.nowMs;
}

/**
 * Reconciles compatibility-tainted app-server observations with the durable Thread clock.
 * A first observation prefers stable UUIDv7 creation evidence. Existing Core timestamps never
 * regress, and an inverted custom-id observation collapses to the only safe interval boundary.
 */
export function reconcileCodexThreadTimestamps(
  input: ReconcileCodexThreadTimestampsInput,
): ReconciledCodexThreadTimestamps {
  const observedUpdatedAt = normalizeObservedTimestamp(input.observedUpdatedAt);
  const observedRecencyAt = normalizeObservedTimestamp(input.observedRecencyAt)
    ?? observedUpdatedAt;
  if (input.existing) {
    return {
      createdAt: input.existing.createdAt,
      updatedAt: Math.max(
        input.existing.createdAt,
        input.existing.updatedAt,
        observedUpdatedAt ?? input.existing.updatedAt,
      ),
      recencyAt: Math.max(
        input.existing.createdAt,
        input.existing.recencyAt ?? input.existing.updatedAt,
        observedRecencyAt ?? input.existing.recencyAt ?? input.existing.updatedAt,
      ),
    };
  }

  const observedCreatedAt = normalizeObservedTimestamp(input.observedCreatedAt);
  const nowMs = normalizeMillisecondsTimestamp(input.nowMs ?? Date.now()) ?? Date.now();
  const createdAt = resolveNewThreadCreatedAt({
    threadId: input.threadId,
    observedCreatedAt,
    observedUpdatedAt,
    nowMs,
  });
  return {
    createdAt,
    updatedAt: Math.max(createdAt, observedUpdatedAt ?? createdAt),
    recencyAt: Math.max(createdAt, observedRecencyAt ?? createdAt),
  };
}
