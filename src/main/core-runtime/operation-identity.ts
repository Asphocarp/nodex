import { createHash } from "node:crypto";
import { createUuidV7 } from "../../shared/uuid-v7";

const RECEIPT_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_DUE_WORK_IDENTITIES = 4_096;
const currentUnixMillis = (): number => Math.trunc(performance.timeOrigin + performance.now());

interface CachedDueWorkIdentity {
  readonly operationId: string;
  readonly expiresAt: number;
}

const dueWorkIdentities = new Map<string, CachedDueWorkIdentity>();

const normalizeScope = (scope: string): string =>
  scope
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9._-]+/g, "-")
    .slice(0, 96) || "operation";

const encode = (scope: string, issuedAt: number, entropy: string): string => {
  const issued = Math.max(0, Math.trunc(issuedAt));
  return `nodexop:v1:${issued}:${issued + RECEIPT_WINDOW_MS}:${normalizeScope(scope)}:${entropy}`;
};

/** Creates a finite-window operation identity whose issue time Core can verify. */
export const createOperationId = (scope: string, issuedAt = currentUnixMillis()): string =>
  encode(scope, issuedAt, createUuidV7());

/** Derives one restart-stable bounded identity from a durable parent episode. */
export const createStableOperationId = (
  scope: string,
  issuedAt: number,
  semanticIdentity: unknown,
): string =>
  encode(
    scope,
    issuedAt,
    createHash("sha256").update(JSON.stringify(semanticIdentity)).digest("hex"),
  );

/** Creates one stable identity for every retry of a Core-authored due-work token. */
export const createDueWorkOperationId = (
  scope: string,
  workToken: string,
  payload: unknown,
  issuedAt = currentUnixMillis(),
): string => {
  const identityKey = createHash("sha256")
    .update(JSON.stringify({ workToken, payload }))
    .digest("hex");
  const normalizedScope = normalizeScope(scope);
  const cacheKey = `${normalizedScope}:${identityKey}`;
  const issued = Math.max(0, Math.trunc(issuedAt));
  const cached = dueWorkIdentities.get(cacheKey);
  if (cached && cached.expiresAt > issued) return cached.operationId;
  if (cached) dueWorkIdentities.delete(cacheKey);

  for (const [key, identity] of dueWorkIdentities) {
    if (identity.expiresAt > issued && dueWorkIdentities.size < MAX_DUE_WORK_IDENTITIES) break;
    dueWorkIdentities.delete(key);
  }
  const operationId = encode(normalizedScope, issued, identityKey);
  dueWorkIdentities.set(cacheKey, {
    operationId,
    expiresAt: issued + RECEIPT_WINDOW_MS,
  });
  return operationId;
};
