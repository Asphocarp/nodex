import type {
  PersistedAtomEvent,
  PersistedAtomMutation,
  PersistedAtomSnapshot,
} from "../shared/ipc-api";
import {
  commitPersistedAtomMutation,
  readPersistedAtomSnapshot,
} from "./local-store/persisted-atoms";

export interface PersistedAtomIpcAdapter {
  registerSync(listener: () => PersistedAtomSnapshot): void;
  registerMutation(
    listener: (originRendererId: string, mutation: PersistedAtomMutation) => PersistedAtomEvent,
  ): void;
  broadcast(event: PersistedAtomEvent): void;
}

export function registerPersistedAtomIpc(adapter: PersistedAtomIpcAdapter): void {
  adapter.registerSync(readPersistedAtomSnapshot);
  adapter.registerMutation((originRendererId, mutation) => {
    const event = commitPersistedAtomMutation(mutation, originRendererId);
    adapter.broadcast(event);
    return event;
  });
}
