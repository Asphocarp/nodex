import { isCodexClientThreadId } from "../../shared/codex-client-thread";
import { readPersistedAtomState, updatePersistedAtom } from "../local-store/persisted-atoms";

const CODEX_CLIENT_THREAD_ID_ATOM_PREFIX = "thread-client-id-v1:";

export interface CodexClientThreadIdentity {
  readonly hostId: string;
  readonly threadId: string;
  readonly clientThreadId: string;
}

export function codexClientThreadIdentityAtomKey(hostId: string, threadId: string): string {
  return `${CODEX_CLIENT_THREAD_ID_ATOM_PREFIX}${encodeURIComponent(`${hostId}:${threadId}`)}`;
}

export function setCodexClientThreadIdentity(identity: CodexClientThreadIdentity): boolean {
  const hostId = identity.hostId.trim();
  const threadId = identity.threadId.trim();
  const clientThreadId = identity.clientThreadId.trim();
  if (!hostId || !threadId || !isCodexClientThreadId(clientThreadId)) return false;

  updatePersistedAtom({
    key: codexClientThreadIdentityAtomKey(hostId, threadId),
    value: clientThreadId,
  });
  return true;
}

export function getCodexClientThreadId(hostId: string, threadId: string): string | null {
  const value = readPersistedAtomState()[codexClientThreadIdentityAtomKey(hostId, threadId)];
  return isCodexClientThreadId(value) ? value : null;
}

export function listCodexClientThreadIdentities(
  hostId: string,
  threadIds: readonly string[],
): CodexClientThreadIdentity[] {
  const state = readPersistedAtomState();
  return threadIds.flatMap((threadId) => {
    const clientThreadId = state[codexClientThreadIdentityAtomKey(hostId, threadId)];
    return isCodexClientThreadId(clientThreadId) ? [{ hostId, threadId, clientThreadId }] : [];
  });
}

export function resolveCodexThreadIdForClientThreadId(
  hostId: string,
  clientThreadId: string,
): string | null {
  if (!isCodexClientThreadId(clientThreadId)) return null;
  const identityPrefix = `${hostId}:`;
  for (const [key, value] of Object.entries(readPersistedAtomState())) {
    if (value !== clientThreadId || !key.startsWith(CODEX_CLIENT_THREAD_ID_ATOM_PREFIX)) continue;
    try {
      const identity = decodeURIComponent(key.slice(CODEX_CLIENT_THREAD_ID_ATOM_PREFIX.length));
      if (!identity.startsWith(identityPrefix)) continue;
      const threadId = identity.slice(identityPrefix.length);
      if (threadId) return threadId;
    } catch {
      // Ignore malformed persisted keys; exact lookups remain usable.
    }
  }
  return null;
}
