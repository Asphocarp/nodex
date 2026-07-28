import type {
  Collaborator,
  SocketId,
} from "@excalidraw/excalidraw/types";
import {
  CANVAS_PRESENCE_HEARTBEAT_MS,
  CANVAS_PRESENCE_POINTER_INTERVAL_MS,
  type CanvasPresenceEvent,
  type CanvasPresenceRealtimeEvent,
  type CanvasPresenceValue,
} from "../../shared/block-documents";

export type CanvasPresencePublisher = (
  clock: number,
  state: CanvasPresenceValue | null,
) => Promise<unknown>;

export interface CanvasPresenceController {
  updatePointer(pointer: NonNullable<CanvasPresenceValue["pointer"]>): void;
  updateSelection(selectedElementIds: readonly string[]): void;
  setIdle(idle: CanvasPresenceValue["idle"]): void;
  setEnabled(enabled: boolean): void;
  receive(event: CanvasPresenceRealtimeEvent): void;
  getCollaborators(): ReadonlyMap<SocketId, Collaborator>;
  close(): Promise<void>;
}

export interface CanvasPresenceControllerOptions {
  readonly publish: CanvasPresencePublisher;
  readonly onCollaborators: (
    collaborators: ReadonlyMap<SocketId, Collaborator>,
  ) => void;
  readonly now?: () => number;
  readonly schedule?: (
    callback: () => void,
    delayMs: number,
  ) => () => void;
}

const defaultSchedule = (
  callback: () => void,
  delayMs: number,
): (() => void) => {
  const timeout = globalThis.setTimeout(callback, delayMs);
  return () => globalThis.clearTimeout(timeout);
};

const sameSelection = (
  left: readonly string[],
  right: readonly string[],
): boolean =>
  left.length === right.length
  && left.every((id, index) => id === right[index]);

const toCollaborator = (presence: CanvasPresenceEvent): Collaborator => {
  const state = presence.state;
  if (!state) return {};
  return {
    id: presence.user.id,
    socketId: presence.clientSessionId as SocketId,
    username: presence.user.displayName,
    userState: state.idle as Collaborator["userState"],
    color: {
      background: `${presence.user.color}33`,
      stroke: presence.user.color,
    },
    selectedElementIds: Object.fromEntries(
      state.selectedElementIds.map((id) => [id, true]),
    ),
    ...(state.pointer
      ? {
          pointer: {
            x: state.pointer.x,
            y: state.pointer.y,
            tool: state.pointer.tool,
            renderCursor: state.idle !== "away",
          },
          button: state.pointer.button,
        }
      : {}),
  };
};

export const createCanvasPresenceController = (
  options: CanvasPresenceControllerOptions,
): CanvasPresenceController => {
  const now = options.now ?? Date.now;
  const schedule = options.schedule ?? defaultSchedule;
  const remote = new Map<string, CanvasPresenceEvent>();
  let state: CanvasPresenceValue = {
    selectedElementIds: [],
    idle: "active",
  };
  let clock = 0;
  let enabled = true;
  let closed = false;
  let lastPointerPublishedAt = Number.NEGATIVE_INFINITY;
  let cancelPointer: (() => void) | null = null;
  let cancelHeartbeat: (() => void) | null = null;

  const collaborators = (): ReadonlyMap<SocketId, Collaborator> =>
    new Map(
      [...remote.entries()]
        .filter(([, presence]) => presence.state !== null)
        .map(([clientSessionId, presence]) => [
          clientSessionId as SocketId,
          toCollaborator(presence),
        ]),
    );

  const notify = (): void => {
    options.onCollaborators(collaborators());
  };

  const publish = (nextState: CanvasPresenceValue | null): Promise<void> => {
    clock += 1;
    return options.publish(clock, nextState).then(
      () => undefined,
      () => undefined,
    );
  };

  const publishCurrent = (): void => {
    if (closed || !enabled) return;
    void publish(state);
  };

  const scheduleHeartbeat = (): void => {
    cancelHeartbeat?.();
    cancelHeartbeat = schedule(() => {
      cancelHeartbeat = null;
      publishCurrent();
      if (!closed) scheduleHeartbeat();
    }, CANVAS_PRESENCE_HEARTBEAT_MS);
  };

  scheduleHeartbeat();

  return {
    updatePointer(pointer) {
      if (closed) return;
      state = { ...state, pointer, idle: "active" };
      if (!enabled || cancelPointer) return;
      const remaining = CANVAS_PRESENCE_POINTER_INTERVAL_MS
        - (now() - lastPointerPublishedAt);
      if (remaining <= 0) {
        lastPointerPublishedAt = now();
        publishCurrent();
        return;
      }
      cancelPointer = schedule(() => {
        cancelPointer = null;
        lastPointerPublishedAt = now();
        publishCurrent();
      }, remaining);
    },
    updateSelection(selectedElementIds) {
      if (closed) return;
      const canonical = [...new Set(selectedElementIds)].sort();
      if (sameSelection(state.selectedElementIds, canonical)) return;
      state = { ...state, selectedElementIds: canonical };
      publishCurrent();
    },
    setIdle(idle) {
      if (closed || state.idle === idle) return;
      state = { ...state, idle };
      publishCurrent();
    },
    setEnabled(nextEnabled) {
      if (closed || enabled === nextEnabled) return;
      enabled = nextEnabled;
      cancelPointer?.();
      cancelPointer = null;
      if (enabled) {
        scheduleHeartbeat();
        publishCurrent();
        return;
      }
      cancelHeartbeat?.();
      cancelHeartbeat = null;
      void publish(null);
      remote.clear();
      notify();
    },
    receive(event) {
      if (closed) return;
      if (event.type === "canvas_presence_snapshot") {
        remote.clear();
        for (const presence of event.presences) {
          remote.set(presence.clientSessionId, presence);
        }
        notify();
        return;
      }
      const incoming = event.presence;
      const current = remote.get(incoming.clientSessionId);
      const newer = !current || incoming.clock > current.clock;
      const equalClockRemoval =
        current !== undefined
        && current.state !== null
        && incoming.state === null
        && incoming.clock === current.clock;
      if (!newer && !equalClockRemoval) return;
      if (incoming.state === null) {
        remote.delete(incoming.clientSessionId);
      } else {
        remote.set(incoming.clientSessionId, incoming);
      }
      notify();
    },
    getCollaborators: collaborators,
    async close() {
      if (closed) return;
      closed = true;
      cancelPointer?.();
      cancelHeartbeat?.();
      cancelPointer = null;
      cancelHeartbeat = null;
      remote.clear();
      notify();
      await publish(null);
    },
  };
};
