import { useState } from "react";

const MUTATION_AUDIT_SESSION_KEY = "nodex-mutation-audit-session-id";
const MAX_MUTATION_AUDIT_SESSION_ID_LENGTH = 512;

interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const isValidSessionId = (value: string | null): value is string =>
  value !== null &&
  value.length > 0 &&
  value.length <= MAX_MUTATION_AUDIT_SESSION_ID_LENGTH &&
  value === value.trim();

export function createMutationAuditSessionResolver(
  storage: SessionStorageLike | null,
  createId: () => string,
): () => string {
  let cachedSessionId: string | null = null;
  return () => {
    if (cachedSessionId) return cachedSessionId;

    if (storage) {
      try {
        const stored = storage.getItem(MUTATION_AUDIT_SESSION_KEY);
        if (isValidSessionId(stored)) {
          cachedSessionId = stored;
          return stored;
        }
      } catch {
        // An isolated renderer can deny storage access. The closure cache still
        // keeps audit attribution stable for the lifetime of this window.
      }
    }

    const created = createId();
    if (!isValidSessionId(created)) {
      throw new Error("Mutation audit session identity is invalid");
    }
    cachedSessionId = created;
    if (!storage) return created;
    try {
      storage.setItem(MUTATION_AUDIT_SESSION_KEY, created);
    } catch {
      // The closure cache is the fallback when storage is unavailable.
    }
    return created;
  };
}

const resolveSessionStorage = (): SessionStorageLike | null => {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
};

let defaultResolver: (() => string) | null = null;

export function getMutationAuditSessionId(): string {
  defaultResolver ??= createMutationAuditSessionResolver(
    resolveSessionStorage(),
    () => crypto.randomUUID(),
  );
  return defaultResolver();
}

export function useMutationAuditSessionId(): string {
  const [sessionId] = useState(getMutationAuditSessionId);
  return sessionId;
}
