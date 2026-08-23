import { assert, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import type { Thread, ThreadForkResponse } from "@nodex/codex-app-server-protocol/v2";
import type { CodexConversationSnapshot } from "../../shared/types";
import { CodexGateway, CodexThreadHostResolver } from "../codex-runtime/CodexGateway";
import {
  CodexEphemeralThreadRouting,
  live as codexEphemeralThreadRoutingLive,
} from "../codex-runtime/CodexEphemeralThreadRouting";
import { codexRuntimeError, type CodexRuntimeError } from "../codex-runtime/CodexRuntimeError";
import { CodexTurnCommands, type CodexTurnCommandsService } from "./CodexTurnCommands";
import { CodexConversationProjection } from "./CodexConversationProjection";
import { CodexThreadDirectory } from "./CodexThreadDirectory";
import {
  ConversationRuntimeMap,
  live as conversationRuntimeMapLive,
} from "./ConversationRuntimeMap";
import { make as makeCommands } from "./CodexSideChatCommands";
import { SIDE_CHAT_BOUNDARY_TEXT } from "./CodexSideChatPolicy";

const parentThreadId = "parent-a";
const sideThreadId = "side-a";
const remoteHostId = "remote-a";

const protocolThread = (threadId: string): Thread =>
  ({
    id: threadId,
    turns: [],
    cwd: "/workspace",
    createdAt: 100,
    updatedAt: 100,
    preview: "",
    name: null,
    modelProvider: "openai",
  }) as unknown as Thread;

const forkResponse = {
  thread: protocolThread(sideThreadId),
  cwd: "/workspace",
  model: "gpt-test",
  reasoningEffort: null,
  modelProvider: "openai",
  approvalPolicy: "never",
  approvalsReviewer: "user",
  sandbox: { type: "workspaceWrite", writableRoots: ["/workspace"] },
  activePermissionProfile: null,
  runtimeWorkspaceRoots: ["/workspace"],
} as unknown as ThreadForkResponse;

const requestFailure = (method: string): CodexRuntimeError =>
  codexRuntimeError({
    operation: "gateway.request",
    reason: "request",
    retryable: false,
    hostId: remoteHostId,
    method,
    cause: new Error(`${method} failed`),
  });

interface SideChatHarnessOptions {
  readonly hostResolution?: Effect.Effect<string, CodexRuntimeError>;
  readonly inject?: Effect.Effect<unknown, CodexRuntimeError>;
  readonly initialTurn?: Effect.Effect<void, CodexRuntimeError>;
  readonly unsubscribe?: Effect.Effect<unknown, CodexRuntimeError>;
}

const makeHarness = (scope: Scope.Scope, options: SideChatHarnessOptions = {}) =>
  Effect.gen(function* () {
    const conversationContext = yield* Layer.buildWithScope(conversationRuntimeMapLive, scope);
    const conversations = Context.get(conversationContext, ConversationRuntimeMap);
    const routingContext = yield* Layer.buildWithScope(codexEphemeralThreadRoutingLive, scope);
    const routing = Context.get(routingContext, CodexEphemeralThreadRouting);
    const events: string[] = [];

    const gateway = CodexGateway.of({
      localHostId: "local",
      requestRawOnHost: () => Effect.die(new Error("Unsupported raw host request")),
      requestOnHost: ((hostId: string, method: string, params: { threadId?: string }) =>
        Effect.suspend(() => {
          events.push(`request:${hostId}:${method}:${params.threadId ?? parentThreadId}`);
          if (method === "thread/fork") return Effect.succeed(forkResponse);
          if (method === "thread/inject_items") {
            const boundaryText = (
              params as {
                items?: ReadonlyArray<{
                  content?: ReadonlyArray<{ text?: string }>;
                }>;
              }
            ).items?.[0]?.content?.[0]?.text;
            assert.strictEqual(boundaryText, SIDE_CHAT_BOUNDARY_TEXT);
            return options.inject ?? Effect.succeed({});
          }
          if (method === "thread/unsubscribe") {
            return options.unsubscribe ?? Effect.succeed({});
          }
          return Effect.die(`unexpected request: ${method}`);
        })) as CodexGateway["Service"]["requestOnHost"],
    } as unknown as CodexGateway["Service"]);
    const hostResolver = CodexThreadHostResolver.of({
      resolve: (threadId) =>
        Effect.sync(() => events.push(`resolve:${threadId}`)).pipe(
          Effect.andThen(options.hostResolution ?? Effect.succeed(remoteHostId)),
        ),
    });
    const turns = CodexTurnCommands.of({
      start: (threadId) =>
        Effect.gen(function* () {
          const hostId = yield* routing.resolve(threadId);
          events.push(`turn:${threadId}:${hostId ?? "unrouted"}`);
          yield* options.initialTurn ?? Effect.void;
          return null;
        }),
      startRendererOwned: () => Effect.die("unused"),
      acceptPreparedRendererTurn: () => Effect.die("unused"),
      steer: () => Effect.die("unused"),
      steerRendererOwned: () => Effect.die("unused"),
    } satisfies CodexTurnCommandsService);
    const parentSnapshot = {
      threadId: parentThreadId,
      projectId: "project-a",
      source: { parentThreadId: null },
      cwd: "/workspace",
      executionProfile: null,
      queuedFollowUps: [],
    } as unknown as CodexConversationSnapshot;
    const directory = CodexThreadDirectory.of({
      resolve: () =>
        Effect.succeed({
          fidelity: "full",
          durable: { cwd: "/workspace" },
          summary: parentSnapshot,
          canonical: null,
          snapshot: parentSnapshot,
        } as never),
      descendants: () => Effect.die("unused"),
      acceptRollbackResult: () => Effect.die("unused"),
    });
    const projection = CodexConversationProjection.of({
      hydrate: (input: Parameters<CodexConversationProjection["Service"]["hydrate"]>[0]) =>
        Effect.sync(() => {
          events.push("commit");
          const snapshot = {
            ...input.summary,
            source: input.summary.source,
            resumeState: "resumed",
            turns: [],
            requests: [],
            queuedFollowUps: [],
          } as unknown as CodexConversationSnapshot;
          const aggregate = conversations.conversation(input.threadId);
          aggregate.acceptCanonicalState(input.canonical);
          aggregate.installSnapshot(snapshot);
          return snapshot;
        }),
    } as unknown as CodexConversationProjection["Service"]);
    const commands = yield* makeCommands.pipe(
      Effect.provideService(CodexConversationProjection, projection),
      Effect.provideService(CodexGateway, gateway),
      Effect.provideService(CodexThreadHostResolver, hostResolver),
      Effect.provideService(CodexEphemeralThreadRouting, routing),
      Effect.provideService(CodexThreadDirectory, directory),
      Effect.provideService(CodexTurnCommands, turns),
      Effect.provideService(ConversationRuntimeMap, conversations),
    );

    return {
      commands,
      conversations,
      events,
      markExisting: () => {
        conversations.conversation(sideThreadId).installSnapshot({
          ...parentSnapshot,
          threadId: sideThreadId,
          source: { parentThreadId, sideConversation: true },
        });
      },
      routing,
    };
  });

it.effect("keeps a remote side chat on its parent's host through the initial Turn", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const harness = yield* makeHarness(scope);

    const result = yield* harness.commands.start({ parentThreadId, prompt: "question" });

    assert.strictEqual(result.threadId, sideThreadId);
    assert.strictEqual(yield* harness.routing.resolve(sideThreadId), remoteHostId);
    assert.deepEqual(harness.events, [
      `resolve:${parentThreadId}`,
      `request:${remoteHostId}:thread/fork:${parentThreadId}`,
      `request:${remoteHostId}:thread/inject_items:${sideThreadId}`,
      "commit",
      `turn:${sideThreadId}:${remoteHostId}`,
    ]);
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("compensates the fork when the initial Turn is rejected", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const harness = yield* makeHarness(scope, {
      initialTurn: Effect.fail(requestFailure("turn/start")),
    });

    const exit = yield* Effect.exit(harness.commands.start({ parentThreadId, prompt: "question" }));

    assert.isTrue(Exit.isFailure(exit));
    assert.isNull(yield* harness.routing.resolve(sideThreadId));
    assert.deepEqual(harness.events.slice(-2), [
      `turn:${sideThreadId}:${remoteHostId}`,
      `request:${remoteHostId}:thread/unsubscribe:${sideThreadId}`,
    ]);
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("discards local ownership even when the remote unsubscribe fails", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const harness = yield* makeHarness(scope, {
      unsubscribe: Effect.fail(requestFailure("thread/unsubscribe")),
    });
    harness.markExisting();
    yield* harness.routing.register(sideThreadId, remoteHostId);
    const before = yield* harness.conversations.runtime(sideThreadId);

    assert.isTrue(yield* harness.commands.discard(sideThreadId));

    const after = yield* harness.conversations.runtime(sideThreadId);
    assert.notStrictEqual(after, before);
    assert.isNull(yield* harness.routing.resolve(sideThreadId));
    assert.deepEqual(harness.events, [
      `request:${remoteHostId}:thread/unsubscribe:${sideThreadId}`,
    ]);
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("discards local ownership when the parent host is unavailable", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const harness = yield* makeHarness(scope, {
      hostResolution: Effect.fail(requestFailure("resolve-host")),
    });
    harness.markExisting();
    const before = yield* harness.conversations.runtime(sideThreadId);

    assert.isTrue(yield* harness.commands.discard(sideThreadId));

    const after = yield* harness.conversations.runtime(sideThreadId);
    assert.notStrictEqual(after, before);
    assert.deepEqual(harness.events, [`resolve:${parentThreadId}`]);
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("rolls back an in-flight fork when the Main Scope closes", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const injectStarted = yield* Deferred.make<void>();
    const harness = yield* makeHarness(scope, {
      inject: Deferred.succeed(injectStarted, undefined).pipe(Effect.andThen(Effect.never)),
    });
    const command = yield* harness.commands.start({ parentThreadId }).pipe(Effect.forkIn(scope));
    yield* Deferred.await(injectStarted);

    yield* Scope.close(scope, Exit.void);
    const exit = yield* Fiber.await(command);

    assert.isTrue(Exit.isFailure(exit));
    assert.isNull(yield* harness.routing.resolve(sideThreadId));
    assert.deepEqual(harness.events.slice(-1), [
      `request:${remoteHostId}:thread/unsubscribe:${sideThreadId}`,
    ]);
  }),
);
