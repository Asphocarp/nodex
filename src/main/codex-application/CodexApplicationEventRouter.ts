import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import type { ServerNotificationMethod } from "@nodex/effect-codex-app-server/rpc";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import { ConversationRuntimeMap } from "./ConversationRuntimeMap";

const directThreadNotifications = new Set<ServerNotificationMethod>([
  "error",
  "thread/status/changed",
  "thread/archived",
  "thread/deleted",
  "thread/unarchived",
  "thread/closed",
  "thread/name/updated",
  "thread/goal/updated",
  "thread/goal/cleared",
  "thread/environment/connected",
  "thread/environment/disconnected",
  "thread/settings/updated",
  "thread/tokenUsage/updated",
  "thread/compacted",
  "turn/started",
  "turn/completed",
  "turn/diff/updated",
  "turn/plan/updated",
  "turn/moderationMetadata",
  "hook/started",
  "hook/completed",
  "item/started",
  "item/autoApprovalReview/started",
  "item/autoApprovalReview/completed",
  "item/completed",
  "rawResponseItem/completed",
  "rawResponse/completed",
  "item/agentMessage/delta",
  "item/plan/delta",
  "item/commandExecution/outputDelta",
  "item/commandExecution/terminalInteraction",
  "item/fileChange/outputDelta",
  "item/fileChange/patchUpdated",
  "serverRequest/resolved",
  "item/mcpToolCall/progress",
  "item/reasoning/summaryTextDelta",
  "item/reasoning/summaryPartAdded",
  "item/reasoning/textDelta",
  "model/rerouted",
  "model/verification",
  "model/safetyBuffering/updated",
  "warning",
  "guardianWarning",
  "thread/realtime/started",
  "thread/realtime/itemAdded",
  "thread/realtime/transcript/delta",
  "thread/realtime/transcript/done",
  "thread/realtime/outputAudio/delta",
  "thread/realtime/sdp",
  "thread/realtime/error",
  "thread/realtime/closed",
]);

const asRecord = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;

/** Explicit notification ownership metadata. Global notifications intentionally return undefined. */
export const serverNotificationThreadId = (
  method: ServerNotificationMethod,
  params: unknown,
): string | undefined => {
  const record = asRecord(params);
  if (record === undefined) return undefined;
  if (method === "thread/started") {
    const thread = asRecord(record.thread);
    return typeof thread?.id === "string" ? thread.id : undefined;
  }
  if (!directThreadNotifications.has(method)) return undefined;
  return typeof record.threadId === "string" ? record.threadId : undefined;
};

/** Routes already-decoded, generation-fenced notifications to independent thread runtimes. */
export const live: Layer.Layer<never, never, CodexGateway | ConversationRuntimeMap> =
  Layer.effectDiscard(
    Effect.gen(function* () {
      const gateway = yield* CodexGateway;
      const conversations = yield* ConversationRuntimeMap;
      yield* gateway.events.pipe(
        Stream.filter((event) => event.kind === "notification"),
        Stream.runForEach((event) => {
          if (event.kind !== "notification") return Effect.void;
          const threadId = serverNotificationThreadId(event.value.method, event.value.params);
          if (threadId === undefined) return Effect.void;
          return conversations.runtime(threadId).pipe(
            Effect.flatMap((runtime) =>
              runtime.publish({
                kind: "notification",
                method: event.value.method,
                params: event.value.params,
              }),
            ),
          );
        }),
        Effect.forkScoped,
      );
    }),
  );
