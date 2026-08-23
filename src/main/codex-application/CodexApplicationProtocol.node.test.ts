import { assert, it } from "@effect/vitest";
import { CodexAppServerRequestError } from "@nodex/effect-codex-app-server/errors";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import {
  CodexApplicationRequestInbox,
  make as makeInbox,
} from "../codex-runtime/CodexApplicationRequestInbox";
import {
  CodexApplicationEventHub,
  make as makeApplicationEvents,
} from "./CodexApplicationEventHub";
import {
  CodexPendingServerRequestRuntime,
  make as makePending,
} from "./CodexPendingServerRequestRuntime";
import {
  CodexRendererConversationCoordinator,
  type CodexRendererConversationCoordinatorService,
} from "./CodexRendererConversationCoordinator";
import {
  CodexRendererConversationRegistry,
  make as makeRendererRegistry,
} from "./CodexRendererConversationRegistry";
import {
  CodexUserInputAutoResolution,
  make as makeAutoResolution,
} from "./CodexUserInputAutoResolution";
import {
  ConversationRuntimeMap,
  live as conversationRuntimeMapLive,
} from "./ConversationRuntimeMap";
import { make as makeProtocol } from "./CodexApplicationProtocol";

const coordinator = CodexRendererConversationCoordinator.of({
  forwardNotificationForConversation: () => false,
  forwardServerRequest: () => false,
  clearRequestDelivery: () => undefined,
  reconcileOwnership: () => undefined,
} as unknown as CodexRendererConversationCoordinatorService);

const userInputParams = (threadId: string) => ({
  isBlocking: true,
  itemId: `item-${threadId}`,
  questions: [
    {
      id: "answer",
      header: "Answer",
      question: "Continue?",
      isOther: false,
      isSecret: false,
      options: [
        { label: "Yes", description: "Continue" },
        { label: "No", description: "Stop" },
      ],
    },
  ],
  threadId,
  turnId: `turn-${threadId}`,
});

const invalidPickerParams = (threadId: string) => ({
  threadId,
  turnId: `turn-${threadId}`,
  callId: `call-${threadId}`,
  namespace: "codex_app",
  tool: "request_option_picker",
  arguments: { question: "Missing options" },
});

const withProtocol = <A, E>(
  run: (services: {
    readonly inbox: CodexApplicationRequestInbox["Service"];
    readonly conversations: ConversationRuntimeMap["Service"];
  }) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    const rootScope = yield* Scope.make();
    const inbox = yield* makeInbox.pipe(Effect.provideService(Scope.Scope, rootScope));
    const conversationContext = yield* Layer.buildWithScope(conversationRuntimeMapLive, rootScope);
    const conversations = Context.get(conversationContext, ConversationRuntimeMap);
    const applicationEvents = yield* makeApplicationEvents.pipe(
      Effect.provideService(Scope.Scope, rootScope),
    );
    const rendererRegistry = yield* makeRendererRegistry().pipe(
      Effect.provideService(Scope.Scope, rootScope),
    );
    const autoResolution = yield* makeAutoResolution.pipe(
      Effect.provideService(CodexRendererConversationRegistry, rendererRegistry),
      Effect.provideService(Scope.Scope, rootScope),
    );
    const pending = yield* makePending({
      respond: (_threadId, _requestId, occurrenceToken, response) =>
        inbox.settleOccurrenceToken(occurrenceToken, { kind: "result", value: response }),
      reject: (_threadId, requestId, occurrenceToken, cause) =>
        inbox.settleOccurrenceToken(occurrenceToken, {
          kind: "error",
          error: CodexAppServerRequestError.internalError(
            "Codex application request failed",
            undefined,
            { operation: "handle-request", requestId: String(requestId), cause },
          ),
        }),
    }).pipe(Effect.provideService(Scope.Scope, rootScope));

    yield* makeProtocol.pipe(
      Effect.provideService(CodexApplicationEventHub, applicationEvents),
      Effect.provideService(CodexApplicationRequestInbox, inbox),
      Effect.provideService(CodexPendingServerRequestRuntime, pending),
      Effect.provideService(CodexRendererConversationCoordinator, coordinator),
      Effect.provideService(CodexRendererConversationRegistry, rendererRegistry),
      Effect.provideService(CodexUserInputAutoResolution, autoResolution),
      Effect.provideService(ConversationRuntimeMap, conversations),
      Effect.provideService(Scope.Scope, rootScope),
    );

    const result = yield* run({ inbox, conversations }).pipe(
      Effect.provideService(Scope.Scope, rootScope),
    );
    yield* Scope.close(rootScope, Exit.void);
    return result;
  });

it.effect(
  "withdraws a generation before a blocked Thread command can mutate application state",
  () =>
    withProtocol(({ inbox, conversations }) =>
      Effect.gen(function* () {
        const generationScope = yield* Scope.make();
        const generation = yield* inbox
          .openGeneration("local", 1)
          .pipe(Effect.provideService(Scope.Scope, generationScope));
        const laneEntered = yield* Deferred.make<void>();
        const releaseLane = yield* Deferred.make<void>();
        const blocker = yield* conversations
          .runExclusive(
            "thread-a",
            Deferred.succeed(laneEntered, undefined).pipe(
              Effect.andThen(Deferred.await(releaseLane)),
            ),
          )
          .pipe(Effect.forkChild);
        yield* Deferred.await(laneEntered);

        yield* generation.admit({
          requestId: "blocked",
          method: "item/tool/requestUserInput",
          params: userInputParams("thread-a"),
        });
        yield* Effect.yieldNow;
        yield* Scope.close(generationScope, Exit.void);
        yield* Deferred.succeed(releaseLane, undefined);
        yield* Fiber.join(blocker);
        yield* Effect.yieldNow;

        assert.deepEqual(conversations.conversation("thread-a").readServerRequests(), []);
      }),
    ),
);

it.effect("lets another Thread respond while the first Thread command lane is occupied", () =>
  withProtocol(({ inbox, conversations }) =>
    Effect.gen(function* () {
      const generationScope = yield* Scope.make();
      const generation = yield* inbox
        .openGeneration("local", 2)
        .pipe(Effect.provideService(Scope.Scope, generationScope));
      const laneEntered = yield* Deferred.make<void>();
      const releaseLane = yield* Deferred.make<void>();
      const blocker = yield* conversations
        .runExclusive(
          "thread-a",
          Deferred.succeed(laneEntered, undefined).pipe(
            Effect.andThen(Deferred.await(releaseLane)),
          ),
        )
        .pipe(Effect.forkChild);
      yield* Deferred.await(laneEntered);
      yield* generation.admit({
        requestId: "blocked",
        method: "item/tool/requestUserInput",
        params: userInputParams("thread-a"),
      });
      const responseFiber = yield* generation.settlements.pipe(
        Stream.filter(({ occurrence }) => occurrence.requestId === "fast"),
        Stream.runHead,
        Effect.forkChild,
      );
      yield* generation.admit({
        requestId: "fast",
        method: "item/tool/call",
        params: invalidPickerParams("thread-b"),
      });

      const response = yield* Fiber.join(responseFiber);
      assert.strictEqual(response._tag, "Some");
      if (response._tag === "Some") {
        assert.strictEqual(response.value.outcome.kind, "result");
      }
      assert.deepEqual(conversations.conversation("thread-a").readServerRequests(), []);
      yield* Deferred.succeed(releaseLane, undefined);
      yield* Fiber.join(blocker);
      yield* Scope.close(generationScope, Exit.void);
    }),
  ),
);

it.effect("commits a request before the following resolution notification in the same Thread", () =>
  withProtocol(({ inbox, conversations }) =>
    Effect.gen(function* () {
      const generationScope = yield* Scope.make();
      const generation = yield* inbox
        .openGeneration("local", 3)
        .pipe(Effect.provideService(Scope.Scope, generationScope));
      const settled = yield* generation.settlements.pipe(Stream.runHead, Effect.forkChild);
      const request = yield* generation.admit({
        requestId: 73,
        method: "item/tool/requestUserInput",
        params: userInputParams("thread-a"),
      });
      yield* inbox.publishNotification({
        hostId: "local",
        generation: 3,
        method: "serverRequest/resolved",
        params: { threadId: "thread-a", requestId: 73 },
      });

      const settlement = yield* Fiber.join(settled);
      assert.strictEqual(settlement._tag, "Some");
      if (settlement._tag === "Some") {
        assert.strictEqual(settlement.value.occurrence, request);
        assert.strictEqual(settlement.value.outcome.kind, "result");
      }
      assert.deepEqual(conversations.conversation("thread-a").readServerRequests(), []);
      yield* Scope.close(generationScope, Exit.void);
    }),
  ),
);
