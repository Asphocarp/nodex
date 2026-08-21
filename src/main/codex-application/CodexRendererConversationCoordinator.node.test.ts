import { assert, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import type { CodexConversationSnapshot } from "../../shared/types";
import { CodexApplicationEventHub } from "./CodexApplicationEventHub";
import { CodexOwnerNotificationDrainRuntime } from "./CodexOwnerNotificationDrainRuntime";
import { CodexPendingServerRequestRuntime } from "./CodexPendingServerRequestRuntime";
import { make as makeCoordinator } from "./CodexRendererConversationCoordinator";
import {
  CodexRendererConversationRegistry,
  make as makeRendererRegistry,
} from "./CodexRendererConversationRegistry";
import { CodexRendererOwnerRetention } from "./CodexRendererOwnerRetention";
import { CodexUserInputAutoResolution } from "./CodexUserInputAutoResolution";
import {
  ConversationRuntimeMap,
  live as conversationRuntimeMapLive,
} from "./ConversationRuntimeMap";

it.effect("adopts a canonical snapshot as the first accepted renderer replica", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const conversationContext = yield* Layer.buildWithScope(conversationRuntimeMapLive, scope);
    const conversations = Context.get(conversationContext, ConversationRuntimeMap);
    const registry = yield* makeRendererRegistry().pipe(Effect.provideService(Scope.Scope, scope));
    const snapshot = {
      threadId: "thread-fresh",
      resumeState: "resumed",
      turns: [],
      requests: [],
      queuedFollowUps: [],
    } as unknown as CodexConversationSnapshot;
    conversations.conversation(snapshot.threadId).installSnapshot(snapshot);
    const coordinator = yield* makeCoordinator.pipe(
      Effect.provideService(
        CodexApplicationEventHub,
        CodexApplicationEventHub.of({ events: Stream.empty, publish: () => undefined }),
      ),
      Effect.provideService(
        CodexOwnerNotificationDrainRuntime,
        CodexOwnerNotificationDrainRuntime.of({ resetOwner: () => undefined } as never),
      ),
      Effect.provideService(
        CodexPendingServerRequestRuntime,
        CodexPendingServerRequestRuntime.of({} as CodexPendingServerRequestRuntime["Service"]),
      ),
      Effect.provideService(CodexRendererConversationRegistry, registry),
      Effect.provideService(
        CodexRendererOwnerRetention,
        CodexRendererOwnerRetention.of({ reconcile: () => Effect.void } as never),
      ),
      Effect.provideService(
        CodexUserInputAutoResolution,
        CodexUserInputAutoResolution.of({} as CodexUserInputAutoResolution["Service"]),
      ),
      Effect.provideService(ConversationRuntimeMap, conversations),
      Effect.provideService(Scope.Scope, scope),
    );

    const result = yield* coordinator.adoptRendererOwner({
      conversationId: snapshot.threadId,
      ownerClientId: "renderer-fresh",
    });

    assert.strictEqual(result.ownerClientId, "renderer-fresh");
    assert.isNotNull(result.checkpoint);
    assert.deepEqual(
      coordinator.readRendererState(snapshot.threadId).acceptedConversation,
      snapshot,
    );
    yield* Scope.close(scope, Exit.void);
  }),
);
