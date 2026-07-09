import type {
  ServerNotification,
} from "@nodex/codex-app-server-protocol";
import type { Thread } from "@nodex/codex-app-server-protocol/v2/Thread";
import type { CodexCanonicalServerRequest } from "./codex-conversation-state";

export type CodexConversationReplayEvent =
  | {
    readonly type: "notification";
    readonly notification: ServerNotification;
  }
  | {
    readonly type: "request";
    readonly request: CodexCanonicalServerRequest;
  };

export type CodexConversationReplayProvenanceKind =
  | "bundle-synthesized"
  | "exact-cdp-captured"
  | "adjacent-version-corroboration";

export interface CodexConversationReplayTarget {
  readonly version: string;
  readonly build: number;
  readonly asarSha256: string;
}

export interface CodexConversationReplayProvenance {
  readonly kind: CodexConversationReplayProvenanceKind;
  readonly target: CodexConversationReplayTarget;
  readonly evidence: readonly string[];
  readonly runtimeEvidence: string;
}

export interface CodexConversationReplaySanitization {
  readonly status: "sanitized";
  readonly substitutions: readonly string[];
}

export interface CodexConversationReplayFixture {
  readonly id: string;
  readonly threadId: string;
  readonly targetState: string;
  readonly provenance: CodexConversationReplayProvenance;
  readonly sanitization: CodexConversationReplaySanitization;
  readonly initialThread: Thread | null;
  readonly events: readonly CodexConversationReplayEvent[];
}

export interface CodexConversationReplayContext {
  readonly sourceIndex: number;
}

export type CodexConversationReplayReducer<TState> = (
  state: TState,
  event: CodexConversationReplayEvent,
  context: CodexConversationReplayContext,
) => TState;

export interface ReplayCodexConversationEventsInput<TState> {
  /** Events released from one per-thread buffer, never a cross-thread stream. */
  readonly threadId: string;
  readonly initialState: TState;
  readonly hydratedThread: Thread | null;
  readonly events: readonly CodexConversationReplayEvent[];
  readonly reduce: CodexConversationReplayReducer<TState>;
}

type ReplayTextDeltaNotification = Extract<
  ServerNotification,
  {
    method: "item/agentMessage/delta" | "item/commandExecution/outputDelta";
  }
>;

interface BufferedTextDelta {
  readonly notification: ReplayTextDeltaNotification;
  readonly parts: string[];
}

interface ReplayTextDeltaScan {
  readonly completedAgentMessageKeys: ReadonlySet<string>;
  readonly hydratedSuffixLengthByKey: ReadonlyMap<string, number>;
}

function isReplayTextDeltaNotification(
  notification: ServerNotification,
): notification is ReplayTextDeltaNotification {
  return notification.method === "item/agentMessage/delta"
    || notification.method === "item/commandExecution/outputDelta";
}

function buildTextDeltaKey(
  method: ReplayTextDeltaNotification["method"],
  turnId: string,
  itemId: string,
): string {
  return `${method}:${turnId}:${itemId}`;
}

function getHydratedTextSuffixLength(
  thread: Thread | null,
  notification: ReplayTextDeltaNotification,
  bufferedText: string,
): number {
  if (thread === null) {
    return 0;
  }

  const turn = thread.turns.find((candidate) => candidate.id === notification.params.turnId);
  const item = turn?.items.find((candidate) => candidate.id === notification.params.itemId);

  if (notification.method === "item/agentMessage/delta") {
    if (item?.type !== "agentMessage") {
      return 0;
    }

    return item.text.endsWith(bufferedText) ? bufferedText.length : 0;
  }

  if (item?.type !== "commandExecution" || item.aggregatedOutput === null) {
    return 0;
  }

  return item.aggregatedOutput.endsWith(bufferedText) ? bufferedText.length : 0;
}

function scanReplayTextDeltas(
  events: readonly CodexConversationReplayEvent[],
  hydratedThread: Thread | null,
): ReplayTextDeltaScan {
  const completedAgentMessageKeys = new Set<string>();
  const bufferedTextDeltas = new Map<string, BufferedTextDelta>();

  for (const event of events) {
    if (event.type !== "notification") {
      continue;
    }

    const { notification } = event;
    if (
      notification.method === "item/completed"
      && notification.params.item.type === "agentMessage"
    ) {
      completedAgentMessageKeys.add(buildTextDeltaKey(
        "item/agentMessage/delta",
        notification.params.turnId,
        notification.params.item.id,
      ));
      continue;
    }

    if (!isReplayTextDeltaNotification(notification)) {
      continue;
    }

    const key = buildTextDeltaKey(
      notification.method,
      notification.params.turnId,
      notification.params.itemId,
    );
    const buffered = bufferedTextDeltas.get(key);
    if (buffered === undefined) {
      bufferedTextDeltas.set(key, {
        notification,
        parts: [notification.params.delta],
      });
      continue;
    }

    buffered.parts.push(notification.params.delta);
  }

  const hydratedSuffixLengthByKey = new Map<string, number>();
  for (const [key, buffered] of bufferedTextDeltas) {
    const bufferedText = buffered.parts.join("");
    hydratedSuffixLengthByKey.set(
      key,
      getHydratedTextSuffixLength(hydratedThread, buffered.notification, bufferedText),
    );
  }

  return {
    completedAgentMessageKeys,
    hydratedSuffixLengthByKey,
  };
}

function replaceTextDelta(
  notification: ReplayTextDeltaNotification,
  delta: string,
): ReplayTextDeltaNotification {
  if (notification.method === "item/agentMessage/delta") {
    return {
      ...notification,
      params: {
        ...notification.params,
        delta,
      },
    };
  }

  return {
    ...notification,
    params: {
      ...notification.params,
      delta,
    },
  };
}

function prepareReplayEvent(
  event: CodexConversationReplayEvent,
  scan: ReplayTextDeltaScan,
  remainingHydratedSuffixByKey: Map<string, number>,
): CodexConversationReplayEvent | null {
  if (event.type === "request") {
    return event;
  }

  const { notification } = event;
  if (!isReplayTextDeltaNotification(notification)) {
    return event;
  }

  const key = buildTextDeltaKey(
    notification.method,
    notification.params.turnId,
    notification.params.itemId,
  );
  if (
    notification.method === "item/agentMessage/delta"
    && scan.completedAgentMessageKeys.has(key)
  ) {
    return null;
  }

  const remainingHydratedLength = remainingHydratedSuffixByKey.get(key) ?? 0;
  const trimLength = Math.min(remainingHydratedLength, notification.params.delta.length);
  remainingHydratedSuffixByKey.set(key, remainingHydratedLength - trimLength);
  const delta = notification.params.delta.slice(trimLength);
  if (delta.length === 0) {
    return null;
  }

  if (trimLength === 0) {
    return event;
  }

  return {
    type: "notification",
    notification: replaceTextDelta(notification, delta),
  };
}

/**
 * Replays the interleaved app-server request/notification stream in arrival order.
 * Hydration-aware delta suppression mirrors the reference resume boundary so a
 * thread snapshot and its buffered tail do not duplicate text or command output.
 */
export function replayCodexConversationEvents<TState>(
  input: ReplayCodexConversationEventsInput<TState>,
): TState {
  if (input.hydratedThread !== null && input.hydratedThread.id !== input.threadId) {
    throw new Error("Hydrated thread does not match the replay buffer");
  }

  const scan = scanReplayTextDeltas(input.events, input.hydratedThread);
  const remainingHydratedSuffixByKey = new Map(scan.hydratedSuffixLengthByKey);
  let state = input.initialState;

  for (const [sourceIndex, event] of input.events.entries()) {
    const replayEvent = prepareReplayEvent(event, scan, remainingHydratedSuffixByKey);
    if (replayEvent === null) {
      continue;
    }

    state = input.reduce(state, replayEvent, { sourceIndex });
  }

  return state;
}

export function replayCodexConversationFixture<TState>(
  fixture: CodexConversationReplayFixture,
  initialState: TState,
  reduce: CodexConversationReplayReducer<TState>,
): TState {
  return replayCodexConversationEvents({
    threadId: fixture.threadId,
    initialState,
    hydratedThread: fixture.initialThread,
    events: fixture.events,
    reduce,
  });
}
