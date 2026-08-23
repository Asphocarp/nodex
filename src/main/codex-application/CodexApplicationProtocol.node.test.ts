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
import { CodexAutomationInbox } from "./CodexAutomationInbox";
import {
  CodexOneShotServerRequests,
  live as oneShotServerRequestsLive,
} from "./CodexOneShotServerRequests";
import {
  CodexPendingServerRequestRuntime,
  make as makePending,
} from "./CodexPendingServerRequestRuntime";
import {
  CodexProtocolNotificationProjection,
  live as protocolNotificationProjectionLive,
} from "./CodexProtocolNotificationProjection";
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
import { CodexApplicationProtocol, make as makeProtocol } from "./CodexApplicationProtocol";
import { NodexAgentProtocolTools } from "../nodex-agent-application/NodexAgentProtocolTools";

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
    readonly protocol: CodexApplicationProtocol["Service"];
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
    const oneShotContext = yield* Layer.buildWithScope(oneShotServerRequestsLive, rootScope);
    const oneShot = Context.get(oneShotContext, CodexOneShotServerRequests);
    const notificationContext = yield* Layer.buildWithScope(
      protocolNotificationProjectionLive({ supportsChatGptApps: true }).pipe(
        Layer.provide(Layer.succeed(CodexApplicationEventHub, applicationEvents)),
      ),
      rootScope,
    );
    const notificationProjection = Context.get(
      notificationContext,
      CodexProtocolNotificationProjection,
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
    const automationInbox = CodexAutomationInbox.of({
      create: () => Effect.succeed({ items: [] }),
    });
    const nodexAgentTools = NodexAgentProtocolTools.of({
      execute: (params) =>
        Effect.succeed({
          success: true,
          contentItems: [{ type: "inputText", text: params.tool }],
        }),
    });

    const protocol = yield* makeProtocol.pipe(
      Effect.provideService(CodexApplicationEventHub, applicationEvents),
      Effect.provideService(CodexApplicationRequestInbox, inbox),
      Effect.provideService(CodexAutomationInbox, automationInbox),
      Effect.provideService(CodexOneShotServerRequests, oneShot),
      Effect.provideService(CodexPendingServerRequestRuntime, pending),
      Effect.provideService(CodexProtocolNotificationProjection, notificationProjection),
      Effect.provideService(CodexRendererConversationCoordinator, coordinator),
      Effect.provideService(CodexRendererConversationRegistry, rendererRegistry),
      Effect.provideService(CodexUserInputAutoResolution, autoResolution),
      Effect.provideService(ConversationRuntimeMap, conversations),
      Effect.provideService(NodexAgentProtocolTools, nodexAgentTools),
      Effect.provideService(Scope.Scope, rootScope),
    );

    const result = yield* run({ inbox, conversations, protocol }).pipe(
      Effect.provideService(Scope.Scope, rootScope),
    );
    yield* Scope.close(rootScope, Exit.void);
    return result;
  });

it.effect(
  "withdraws a generation before a blocked Thread command can mutate application state",
  () =>
    withProtocol(({ inbox, conversations, protocol }) =>
      Effect.gen(function* () {
        const generationScope = yield* Scope.make();
        const generation = yield* inbox
          .openGeneration("local", 1)
          .pipe(Effect.provideService(Scope.Scope, generationScope));
        assert.isTrue(protocol.beginResume("thread-a"));

        yield* generation.admit({
          requestId: "blocked",
          method: "item/tool/requestUserInput",
          params: userInputParams("thread-a"),
        });
        yield* Effect.yieldNow;
        yield* Scope.close(generationScope, Exit.void);
        yield* protocol.releaseResume("thread-a");

        assert.deepEqual(conversations.conversation("thread-a").readServerRequests(), []);
      }),
    ),
);

it.effect("settles Nodex Agent calls directly from the protocol command lane", () =>
  withProtocol(({ inbox }) =>
    Effect.gen(function* () {
      const generationScope = yield* Scope.make();
      const generation = yield* inbox
        .openGeneration("local", 4)
        .pipe(Effect.provideService(Scope.Scope, generationScope));
      const settled = yield* generation.settlements.pipe(Stream.runHead, Effect.forkChild);
      yield* generation.admit({
        requestId: "nodex-call",
        method: "item/tool/call",
        params: {
          threadId: "thread-a",
          turnId: "turn-a",
          callId: "call-a",
          namespace: "nodex_app",
          tool: "get_context",
          arguments: {},
        },
      });

      const settlement = yield* Fiber.join(settled);
      assert.strictEqual(settlement._tag, "Some");
      if (settlement._tag === "Some") {
        assert.deepEqual(settlement.value.outcome, {
          kind: "result",
          value: {
            success: true,
            contentItems: [{ type: "inputText", text: "get_context" }],
          },
        });
      }
      yield* Scope.close(generationScope, Exit.void);
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

it.effect("keeps one-shot requests outside a blocked Thread command lane", () =>
  withProtocol(({ inbox, conversations }) =>
    Effect.gen(function* () {
      const generationScope = yield* Scope.make();
      const generation = yield* inbox
        .openGeneration("local", 5)
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
      const settled = yield* generation.settlements.pipe(Stream.runHead, Effect.forkChild);
      yield* generation.admit({
        requestId: "time",
        method: "currentTime/read",
        params: { threadId: "thread-a" },
      });

      const settlement = yield* Fiber.join(settled);
      assert.strictEqual(settlement._tag, "Some");
      if (settlement._tag === "Some") {
        assert.strictEqual(settlement.value.outcome.kind, "result");
      }
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
