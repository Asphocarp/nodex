import { invoke } from "./api";
import { resolveRendererTransport } from "./renderer-transport";
import type { PersistedAtomState, PersistedAtomUpdate } from "../../shared/ipc-api";

type PersistedAtomListener = (value: unknown) => void;

const memoryAtoms = new Map<string, unknown>();
const listenersByKey = new Map<string, Set<PersistedAtomListener>>();

let electronState: PersistedAtomState | null = null;
let electronSyncPromise: Promise<PersistedAtomState> | null = null;
let electronUnsubscribe: (() => void) | null = null;

function isElectronRuntime(): boolean {
  return typeof window !== "undefined" && Boolean(window.api);
}

function emitAtomUpdate(key: string, value: unknown): void {
  const listeners = listenersByKey.get(key);
  if (!listeners) return;

  for (const listener of listeners) {
    listener(value);
  }
}

function ensureElectronSubscription(): void {
  if (!isElectronRuntime() || electronUnsubscribe) return;

  electronUnsubscribe = resolveRendererTransport().subscribePersistedAtomUpdates((update) => {
    electronState = {
      ...(electronState ?? {}),
      [update.key]: update.value,
    };
    emitAtomUpdate(update.key, update.value);
  });
}

async function readElectronState(): Promise<PersistedAtomState> {
  ensureElectronSubscription();
  if (electronState !== null) return electronState;

  if (!electronSyncPromise) {
    electronSyncPromise = invoke("persisted-atom:sync-request")
      .then((state) => {
        electronState = state;
        return state;
      })
      .finally(() => {
        electronSyncPromise = null;
      });
  }

  return electronSyncPromise;
}

export async function readAtom(key: string, fallback: unknown): Promise<unknown> {
  if (!isElectronRuntime()) {
    return memoryAtoms.has(key) ? memoryAtoms.get(key) : fallback;
  }

  const state = await readElectronState();
  return Object.prototype.hasOwnProperty.call(state, key) ? state[key] : fallback;
}

export async function writeAtom(key: string, value: unknown): Promise<void> {
  if (!isElectronRuntime()) {
    memoryAtoms.set(key, value);
    emitAtomUpdate(key, value);
    return;
  }

  ensureElectronSubscription();
  const update: PersistedAtomUpdate = { key, value };
  const state = await invoke("persisted-atom:update", update);
  electronState = state;
}

export function subscribeAtom(key: string, listener: PersistedAtomListener): () => void {
  ensureElectronSubscription();

  const listeners = listenersByKey.get(key) ?? new Set<PersistedAtomListener>();
  listeners.add(listener);
  listenersByKey.set(key, listeners);

  return () => {
    const currentListeners = listenersByKey.get(key);
    if (!currentListeners) return;
    currentListeners.delete(listener);
    if (currentListeners.size === 0) {
      listenersByKey.delete(key);
    }
  };
}

export function clearPersistedAtomStoreForTests(): void {
  memoryAtoms.clear();
  listenersByKey.clear();
  electronState = null;
  electronSyncPromise = null;
  electronUnsubscribe?.();
  electronUnsubscribe = null;
}
