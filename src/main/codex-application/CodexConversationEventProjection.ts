import type { CodexCanonicalConversationState } from "../../shared/types";
import type { CodexBufferedConversationEvent } from "./CodexConversationBufferedEvent";

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;

const eventThreadId = (params: Record<string, unknown> | null): string | null =>
  typeof params?.threadId === "string" ? params.threadId : null;

const eventTurnId = (params: Record<string, unknown> | null): string | null =>
  typeof params?.turnId === "string" ? params.turnId : null;

const deltaKey = (method: string, turnId: string | null, itemId: string): string =>
  `${method}:${turnId ?? ""}:${itemId}`;

/** Drops raw delta prefixes already represented by the canonical aggregate before replay. */
export const compactCodexBufferedConversationEvents = (input: {
  readonly threadId: string;
  readonly canonicalState: CodexCanonicalConversationState | null;
  readonly events: readonly CodexBufferedConversationEvent[];
}): CodexBufferedConversationEvent[] => {
  const completedAgentDeltaKeys = new Set<string>();
  const bufferedDeltasByKey = new Map<
    string,
    {
      method: "item/agentMessage/delta" | "item/commandExecution/outputDelta";
      turnId: string | null;
      itemId: string;
      text: string[];
    }
  >();

  for (const event of input.events) {
    if (event.type !== "notification") continue;
    const payload = asRecord(event.notification.params);
    if (eventThreadId(payload) !== input.threadId) continue;
    if (event.notification.method === "item/completed") {
      const item = asRecord(payload?.item);
      if (item?.type !== "agentMessage" || typeof item.id !== "string") continue;
      completedAgentDeltaKeys.add(
        deltaKey("item/agentMessage/delta", eventTurnId(payload), item.id),
      );
      continue;
    }
    if (
      event.notification.method !== "item/agentMessage/delta" &&
      event.notification.method !== "item/commandExecution/outputDelta"
    ) {
      continue;
    }
    const itemId = typeof payload?.itemId === "string" ? payload.itemId : null;
    const delta = typeof payload?.delta === "string" ? payload.delta : null;
    if (!itemId || delta === null) continue;
    const turnId = eventTurnId(payload);
    const key = deltaKey(event.notification.method, turnId, itemId);
    const existing = bufferedDeltasByKey.get(key);
    if (existing) {
      existing.text.push(delta);
      continue;
    }
    bufferedDeltasByKey.set(key, {
      method: event.notification.method,
      turnId,
      itemId,
      text: [delta],
    });
  }

  const duplicateCharactersByKey = new Map<string, number>();
  const canonicalTurns = input.canonicalState?.turns ?? [];
  for (const [key, buffered] of bufferedDeltasByKey) {
    const turn = canonicalTurns.find((candidate) => candidate.protocol.id === buffered.turnId);
    const item = turn?.items.find(
      (candidate) =>
        candidate.id === buffered.itemId &&
        (buffered.method === "item/agentMessage/delta"
          ? candidate.type === "agentMessage"
          : candidate.type === "commandExecution"),
    );
    const existingText =
      buffered.method === "item/agentMessage/delta" && item?.type === "agentMessage"
        ? item.text
        : buffered.method === "item/commandExecution/outputDelta" &&
            item?.type === "commandExecution"
          ? item.aggregatedOutput
          : null;
    const fullDelta = buffered.text.join("");
    duplicateCharactersByKey.set(
      key,
      existingText !== null && existingText.endsWith(fullDelta) ? fullDelta.length : 0,
    );
  }

  return input.events.flatMap((event): CodexBufferedConversationEvent[] => {
    if (event.type === "request") return [event];
    if (
      event.notification.method !== "item/agentMessage/delta" &&
      event.notification.method !== "item/commandExecution/outputDelta"
    ) {
      return [event];
    }
    const payload = asRecord(event.notification.params);
    const itemId = typeof payload?.itemId === "string" ? payload.itemId : null;
    const delta = typeof payload?.delta === "string" ? payload.delta : null;
    if (!itemId || delta === null) return [];
    const key = deltaKey(event.notification.method, eventTurnId(payload), itemId);
    if (
      event.notification.method === "item/agentMessage/delta" &&
      completedAgentDeltaKeys.has(key)
    ) {
      return [];
    }
    const duplicateCharacters = duplicateCharactersByKey.get(key) ?? 0;
    const consumedCharacters = Math.min(duplicateCharacters, delta.length);
    duplicateCharactersByKey.set(key, duplicateCharacters - consumedCharacters);
    const remainingDelta = delta.slice(consumedCharacters);
    if (!remainingDelta) return [];
    if (remainingDelta === delta) return [event];
    return [
      {
        type: "notification",
        notification: {
          ...event.notification,
          params: { ...event.notification.params, delta: remainingDelta },
        },
      },
    ];
  });
};
