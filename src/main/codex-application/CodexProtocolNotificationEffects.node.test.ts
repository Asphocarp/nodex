import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import type { CodexServerNotification } from "../codex-runtime/CodexApplicationProtocol";
import { BrowserUseRuntime } from "../host-runtime/BrowserUseRuntime";
import { CodexActiveGoalContinuation } from "./CodexActiveGoalContinuation";
import { CodexApplicationEventHub } from "./CodexApplicationEventHub";
import { CodexAutomationTurnCompletion } from "./CodexAutomationTurnCompletion";
import { CodexConversationDeltaBufferRuntime } from "./CodexConversationDeltaBufferRuntime";
import { CodexConversationLifecycle } from "./CodexConversationLifecycle";
import { CodexConversationProjection } from "./CodexConversationProjection";
import { CodexManualCompactionRuntime } from "./CodexManualCompactionRuntime";
import { CodexPendingServerRequestRuntime } from "./CodexPendingServerRequestRuntime";
import { make } from "./CodexProtocolNotificationEffects";
import { CodexProtocolNotificationProjection } from "./CodexProtocolNotificationProjection";
import { CodexQueuedFollowUps } from "./CodexQueuedFollowUps";
import { CodexRendererConversationCoordinator } from "./CodexRendererConversationCoordinator";
import { CodexRendererConversationRegistry } from "./CodexRendererConversationRegistry";
import { CodexThreadDurableProjection } from "./CodexThreadDurableProjection";
import { CodexThreadDirectory } from "./CodexThreadDirectory";
import { CodexThreadGoalRuntime } from "./CodexThreadGoalRuntime";
import { CodexUserInputAutoResolution } from "./CodexUserInputAutoResolution";
import { ConversationRuntimeMap } from "./ConversationRuntimeMap";

it.effect("drains frame text before terminal turn consequences", () =>
  Effect.gen(function* () {
    const trace: string[] = [];
    const service = yield* make.pipe(
      Effect.provideService(
        CodexActiveGoalContinuation,
        CodexActiveGoalContinuation.of({} as CodexActiveGoalContinuation["Service"]),
      ),
      Effect.provideService(
        CodexApplicationEventHub,
        CodexApplicationEventHub.of({ events: Stream.empty, publish: () => undefined }),
      ),
      Effect.provideService(
        CodexAutomationTurnCompletion,
        CodexAutomationTurnCompletion.of({
          complete: () => Effect.sync(() => trace.push("automation")).pipe(Effect.as(true)),
        }),
      ),
      Effect.provideService(
        CodexConversationDeltaBufferRuntime,
        CodexConversationDeltaBufferRuntime.of({
          drainFrameText: () => {
            trace.push("drain");
          },
        } as unknown as CodexConversationDeltaBufferRuntime["Service"]),
      ),
      Effect.provideService(
        CodexConversationLifecycle,
        CodexConversationLifecycle.of({} as CodexConversationLifecycle["Service"]),
      ),
      Effect.provideService(
        CodexConversationProjection,
        CodexConversationProjection.of({
          reconcileThreadStatus: () => Effect.void,
        } as unknown as CodexConversationProjection["Service"]),
      ),
      Effect.provideService(
        CodexManualCompactionRuntime,
        CodexManualCompactionRuntime.of({} as CodexManualCompactionRuntime["Service"]),
      ),
      Effect.provideService(
        CodexPendingServerRequestRuntime,
        CodexPendingServerRequestRuntime.of({} as CodexPendingServerRequestRuntime["Service"]),
      ),
      Effect.provideService(
        CodexProtocolNotificationProjection,
        CodexProtocolNotificationProjection.of({ observe: () => Effect.succeed(false) }),
      ),
      Effect.provideService(
        CodexQueuedFollowUps,
        CodexQueuedFollowUps.of({
          list: () => [],
          requestDispatch: () => Effect.sync(() => trace.push("queue")),
        } as unknown as CodexQueuedFollowUps["Service"]),
      ),
      Effect.provideService(
        CodexRendererConversationCoordinator,
        CodexRendererConversationCoordinator.of({
          forwardNotificationForConversation: () => false,
        } as unknown as CodexRendererConversationCoordinator["Service"]),
      ),
      Effect.provideService(
        CodexRendererConversationRegistry,
        CodexRendererConversationRegistry.of({} as CodexRendererConversationRegistry["Service"]),
      ),
      Effect.provideService(
        CodexThreadDurableProjection,
        CodexThreadDurableProjection.of({
          observe: ({ hostId, generation }) =>
            Effect.sync(() => trace.push(`durable:${hostId}:${generation}`)),
        }),
      ),
      Effect.provideService(
        CodexThreadDirectory,
        CodexThreadDirectory.of({
          descendants: () => Effect.succeed([]),
        } as unknown as CodexThreadDirectory["Service"]),
      ),
      Effect.provideService(
        CodexThreadGoalRuntime,
        CodexThreadGoalRuntime.of({} as CodexThreadGoalRuntime["Service"]),
      ),
      Effect.provideService(
        CodexUserInputAutoResolution,
        CodexUserInputAutoResolution.of({} as CodexUserInputAutoResolution["Service"]),
      ),
      Effect.provideService(
        ConversationRuntimeMap,
        ConversationRuntimeMap.of({
          currentConversation: () => null,
        } as unknown as ConversationRuntimeMap["Service"]),
      ),
      Effect.provideService(
        BrowserUseRuntime,
        BrowserUseRuntime.of({
          turnEnded: () => Effect.sync(() => trace.push("browser")),
        } as unknown as BrowserUseRuntime["Service"]),
      ),
    );
    const notification = {
      method: "turn/completed",
      params: {
        threadId: "thread-a",
        turn: {
          id: "turn-a",
          status: "completed",
          items: [],
          error: null,
          startedAt: 1,
          completedAt: 2,
          durationMs: 1,
        },
      },
    } as unknown as CodexServerNotification;

    yield* service.apply({
      hostId: "remote-a",
      generation: 7,
      notification,
      occurrenceId: "remote-a:7:inbox-a:91",
      occurrenceToken: 91,
    });

    assert.deepEqual(trace, ["drain", "browser", "automation", "queue", "durable:remote-a:7"]);
  }),
);
