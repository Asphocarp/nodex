import {
  CANVAS_PRESENCE_SWEEP_MS,
  CANVAS_PRESENCE_TTL_MS,
  canonicalizeCanvasPresencePublication,
  canonicalizeCanvasPresenceRealtimeEvent,
  type CanvasPresenceEvent,
  type CanvasPresencePublication,
  type CanvasPresencePublishAck,
  type CanvasPresenceRealtimeEvent,
  type CanvasPresenceUser,
  type CanvasPresenceValue,
} from "../shared/block-documents/document-presence";
import {
  contentAccessContextKey,
  type ContentAccessIdentity,
} from "../shared/content-access-context";

const PRESENCE_COLORS = [
  "#1971c2",
  "#2f9e44",
  "#e8590c",
  "#9c36b5",
  "#0c8599",
  "#c2255c",
  "#5f3dc4",
  "#087f5b",
] as const;

export interface CanvasPresenceHubBinding extends ContentAccessIdentity {
  readonly key: string;
  readonly documentId: string;
  readonly clientSessionId: string;
  readonly targetId: number;
  readonly send: (event: CanvasPresenceRealtimeEvent) => void;
}

export interface CanvasPresenceHub {
  register(binding: CanvasPresenceHubBinding): void;
  adoptBoundary(key: string, generation: number): void;
  publish(key: string, publication: CanvasPresencePublication): CanvasPresencePublishAck;
  unregister(key: string): void;
  sweep(): void;
  destroy(): void;
}

export interface CanvasPresenceHubOptions {
  readonly now?: () => number;
  readonly scheduleSweep?: (callback: () => void, intervalMs: number) => () => void;
}

interface PresenceEntry {
  readonly binding: CanvasPresenceHubBinding;
  readonly user: CanvasPresenceUser;
  generation: number | null;
  clock: number;
  state: CanvasPresenceValue | null;
  lastUpdated: number;
}

const defaultScheduleSweep = (callback: () => void, intervalMs: number): (() => void) => {
  const timer = globalThis.setInterval(callback, intervalMs);
  timer.unref?.();
  return () => globalThis.clearInterval(timer);
};

const hashIdentity = (value: string): number => {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
};

const userForBinding = (binding: CanvasPresenceHubBinding): CanvasPresenceUser => ({
  id: `window:${binding.targetId}`,
  displayName: `Window ${binding.targetId}`,
  color:
    PRESENCE_COLORS[
      hashIdentity(`${binding.targetId}:${binding.clientSessionId}`) % PRESENCE_COLORS.length
    ],
});

const presenceEvent = (
  entry: PresenceEntry,
  state: CanvasPresenceValue | null,
): CanvasPresenceEvent => ({
  engine: "canvas_scene",
  documentId: entry.binding.documentId,
  generation: entry.generation ?? 1,
  clock: entry.clock,
  state,
  clientSessionId: entry.binding.clientSessionId,
  user: entry.user,
});

const sameBoundary = (left: PresenceEntry, right: PresenceEntry): boolean =>
  left.binding.libraryId === right.binding.libraryId &&
  contentAccessContextKey(left.binding.accessContext) ===
    contentAccessContextKey(right.binding.accessContext) &&
  left.binding.documentId === right.binding.documentId &&
  left.generation !== null &&
  left.generation === right.generation;

export const createCanvasPresenceHub = (
  options: CanvasPresenceHubOptions = {},
): CanvasPresenceHub => {
  const now = options.now ?? Date.now;
  const entries = new Map<string, PresenceEntry>();

  const broadcast = (sender: PresenceEntry, event: CanvasPresenceEvent): void => {
    for (const recipient of entries.values()) {
      if (recipient.binding.key === sender.binding.key) continue;
      if (!sameBoundary(sender, recipient)) continue;
      recipient.binding.send({
        type: "canvas_presence_updated",
        libraryId: recipient.binding.libraryId,
        accessContext: recipient.binding.accessContext,
        presence: event,
      });
    }
  };

  const removeVisibleState = (entry: PresenceEntry): void => {
    if (entry.state === null || entry.generation === null) return;
    entry.state = null;
    entry.lastUpdated = now();
    broadcast(entry, presenceEvent(entry, null));
  };

  const sweep = (): void => {
    const currentTime = now();
    for (const entry of entries.values()) {
      if (
        entry.state === null ||
        entry.generation === null ||
        currentTime - entry.lastUpdated < CANVAS_PRESENCE_TTL_MS
      ) {
        continue;
      }
      entry.state = null;
      entry.lastUpdated = currentTime;
      broadcast(entry, presenceEvent(entry, null));
    }
  };

  const cancelSweep = (options.scheduleSweep ?? defaultScheduleSweep)(
    sweep,
    CANVAS_PRESENCE_SWEEP_MS,
  );

  return {
    register(binding) {
      const existing = entries.get(binding.key);
      if (existing) removeVisibleState(existing);
      entries.set(binding.key, {
        binding,
        user: userForBinding(binding),
        generation: null,
        clock: -1,
        state: null,
        lastUpdated: now(),
      });
    },
    adoptBoundary(key, generation) {
      if (!Number.isSafeInteger(generation) || generation < 1) {
        throw new TypeError("Canvas presence generation is invalid");
      }
      const entry = entries.get(key);
      if (!entry) return;
      if (entry.generation !== generation) {
        removeVisibleState(entry);
        entry.generation = generation;
        entry.clock = -1;
        entry.state = null;
        entry.lastUpdated = now();
      }
      const presences = [...entries.values()]
        .filter(
          (candidate) =>
            candidate.binding.key !== key &&
            candidate.state !== null &&
            sameBoundary(entry, candidate),
        )
        .sort((left, right) =>
          left.binding.clientSessionId.localeCompare(right.binding.clientSessionId),
        )
        .map((candidate) => presenceEvent(candidate, candidate.state));
      const snapshotPresences: CanvasPresenceEvent[] = [];
      const overflowPresences: CanvasPresenceEvent[] = [];
      for (const presence of presences) {
        try {
          canonicalizeCanvasPresenceRealtimeEvent({
            type: "canvas_presence_snapshot",
            libraryId: entry.binding.libraryId,
            accessContext: entry.binding.accessContext,
            documentId: entry.binding.documentId,
            generation,
            presences: [...snapshotPresences, presence],
          });
          snapshotPresences.push(presence);
        } catch {
          overflowPresences.push(presence);
        }
      }
      entry.binding.send({
        type: "canvas_presence_snapshot",
        libraryId: entry.binding.libraryId,
        accessContext: entry.binding.accessContext,
        documentId: entry.binding.documentId,
        generation,
        presences: snapshotPresences,
      });
      for (const presence of overflowPresences) {
        entry.binding.send(
          canonicalizeCanvasPresenceRealtimeEvent({
            type: "canvas_presence_updated",
            libraryId: entry.binding.libraryId,
            accessContext: entry.binding.accessContext,
            presence,
          }),
        );
      }
    },
    publish(key, rawPublication) {
      const publication = canonicalizeCanvasPresencePublication(rawPublication);
      const entry = entries.get(key);
      if (!entry) {
        throw new Error("An exact Canvas subscription is required for presence");
      }
      if (
        entry.generation === null ||
        publication.documentId !== entry.binding.documentId ||
        publication.generation !== entry.generation
      ) {
        throw new Error("Canvas presence crossed its generation boundary");
      }
      const higherClock = publication.clock > entry.clock;
      const equalClockRemoval =
        publication.clock === entry.clock && publication.state === null && entry.state !== null;
      if (!higherClock && !equalClockRemoval) {
        return { accepted: true, applied: false };
      }
      canonicalizeCanvasPresenceRealtimeEvent({
        type: "canvas_presence_updated",
        libraryId: entry.binding.libraryId,
        accessContext: entry.binding.accessContext,
        presence: {
          ...publication,
          clientSessionId: entry.binding.clientSessionId,
          user: entry.user,
        },
      });
      entry.clock = publication.clock;
      entry.state = publication.state;
      entry.lastUpdated = now();
      broadcast(entry, presenceEvent(entry, publication.state));
      return { accepted: true, applied: true };
    },
    unregister(key) {
      const entry = entries.get(key);
      if (!entry) return;
      removeVisibleState(entry);
      entries.delete(key);
    },
    sweep,
    destroy() {
      cancelSweep();
      entries.clear();
    },
  };
};
