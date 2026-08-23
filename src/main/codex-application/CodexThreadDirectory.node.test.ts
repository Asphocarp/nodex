import type { Thread } from "@nodex/codex-app-server-protocol/v2";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { CoreModuleResponseError } from "../core-client/core-client";
import type { ProjectWorkspaceReadSnapshot } from "../core-client/types";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import { CoreModules, type CoreModuleClients } from "../core-runtime/CoreModules";
import { CoreRuntimeError } from "../core-runtime/CoreRuntimeError";
import { CodexApplicationEventHub } from "./CodexApplicationEventHub";
import {
  CodexConversationProjection,
  make as makeConversationProjection,
} from "./CodexConversationProjection";
import { makeCodexConversationAggregateRegistry } from "./CodexConversationAggregate";
import { makeCodexRendererConversationRegistryState } from "./CodexRendererConversationRegistry";
import { CodexRendererConversationRegistry } from "./CodexRendererConversationRegistry";
import { ConversationRuntimeMap } from "./ConversationRuntimeMap";
import { make as makeDirectory } from "./CodexThreadDirectory";

type CoreThread = Extract<
  ProjectWorkspaceReadSnapshot["value"],
  { readonly kind: "thread" }
>["thread"];
type RequestOnHost = CodexGateway["Service"]["requestOnHost"];

const coreThread = (threadId: string, overrides: Partial<CoreThread> = {}): CoreThread =>
  ({
    thread_id: threadId,
    project_id: "project-a",
    session_id: null,
    forked_from_id: null,
    parent_thread_id: null,
    thread_source: null,
    service_name: null,
    agent_nickname: null,
    agent_role: null,
    agent_path: null,
    thread_name: threadId,
    thread_preview: "",
    model_provider: "openai",
    model_id: "gpt-test",
    harness_id: null,
    reasoning_effort: "high",
    service_tier: null,
    execution_host_id: "remote-a",
    cwd: "/repo",
    writable_roots: ["/repo"],
    managed_worktree_path: null,
    projectless_output_directory: null,
    projectless_workspace_browser_root: null,
    status: { status_type: "idle", active_flags: [] },
    archived: false,
    pinned_order: null,
    has_unread_turn: false,
    created_at: 100_000,
    updated_at: 100_000,
    recency_at: 100_000,
    linked_at: "2026-08-23T00:00:00.000Z",
    ...overrides,
  }) as CoreThread;

const appThread = (threadId: string, turns: Thread["turns"] = []): Thread => ({
  id: threadId,
  extra: null,
  sessionId: `session-${threadId}`,
  forkedFromId: null,
  parentThreadId: null,
  preview: "Hydrated transcript",
  ephemeral: false,
  section: null,
  sectionEnteredAt: null,
  historyMode: "paginated",
  modelProvider: "openai",
  createdAt: 100,
  updatedAt: 120,
  recencyAt: 120,
  status: { type: "idle" },
  path: null,
  cwd: "/repo",
  cliVersion: "test",
  source: "unknown",
  canAcceptDirectInput: true,
  threadSource: null,
  agentNickname: null,
  agentRole: null,
  gitInfo: null,
  name: "Hydrated Thread",
  turns: [...turns],
});

const notFound = (threadId: string) =>
  new CoreRuntimeError({
    message: `Missing ${threadId}`,
    operation: "workspace.read",
    reason: "operation",
    retryable: false,
    cause: new CoreModuleResponseError({
      code: "not_found",
      message: `Missing ${threadId}`,
      retryable: false,
      recovery: { kind: "none" },
    }),
  });

const makeCore = (threads: Map<string, CoreThread>): CoreModules["Service"] => {
  const read: CoreModuleClients["workspace"]["read"] = (input) => {
    if (input.kind !== "thread") return Effect.die(new Error("Unexpected Core read"));
    const threadId = input.thread_id;
    const thread = threads.get(threadId);
    return thread
      ? Effect.succeed({ value: { kind: "thread", thread } } as ProjectWorkspaceReadSnapshot)
      : Effect.fail(notFound(threadId));
  };
  const apply: CoreModuleClients["workspace"]["apply"] = (input) =>
    Effect.sync(() => {
      if (input.intent.kind !== "upsert_thread") throw new Error("Unexpected Core intent");
      const existing = threads.get(input.intent.thread_id) ?? coreThread(input.intent.thread_id);
      threads.set(input.intent.thread_id, {
        ...existing,
        ...input.intent.patch,
        thread_id: input.intent.thread_id,
      } as CoreThread);
      return {} as never;
    });
  return CoreModules.of({ workspace: { read, apply } } as unknown as CoreModuleClients);
};

const makeGateway = (requestOnHost: RequestOnHost): CodexGateway["Service"] => {
  const unsupported = () => Effect.die(new Error("Unsupported Gateway operation"));
  return CodexGateway.of({
    localHostId: "local",
    requestRawOnHost: unsupported,
    requestRawForThread: unsupported,
    events: Stream.empty,
    requestLocal: unsupported,
    requestOnHost,
    requestForThread: unsupported,
    notifyLocal: unsupported,
    connection: unsupported,
    connectionChanges: () => Stream.empty,
    awaitReady: () => Effect.void,
    reconcileHost: unsupported,
    removeHost: unsupported,
    restartHost: unsupported,
  });
};

const makeConversations = () => {
  const aggregates = makeCodexConversationAggregateRegistry();
  const runExclusive: ConversationRuntimeMap["Service"]["runExclusive"] = (_threadId, operation) =>
    operation;
  return ConversationRuntimeMap.of({
    conversation: aggregates.acquire,
    currentConversation: aggregates.current,
    runExclusive,
  } as unknown as ConversationRuntimeMap["Service"]);
};

it.effect("accepts rollback as one durable and canonical replacement", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const threads = new Map([["thread-a", coreThread("thread-a", { has_unread_turn: true })]]);
      const core = makeCore(threads);
      const conversations = makeConversations();
      conversations.conversation("thread-a").seedHasUnreadTurn(true);
      const eventHub = CodexApplicationEventHub.of({
        events: Stream.empty,
        publish: () => undefined,
      });
      const projection = yield* makeConversationProjection.pipe(
        Effect.provideService(ConversationRuntimeMap, conversations),
        Effect.provideService(
          CodexRendererConversationRegistry,
          makeCodexRendererConversationRegistryState(),
        ),
        Effect.provideService(CodexApplicationEventHub, eventHub),
        Effect.provideService(CoreModules, core),
      );
      const directory = yield* makeDirectory.pipe(
        Effect.provideService(CodexApplicationEventHub, eventHub),
        Effect.provideService(CodexConversationProjection, projection),
        Effect.provideService(
          CodexGateway,
          makeGateway((() => Effect.die("unused")) as RequestOnHost),
        ),
        Effect.provideService(ConversationRuntimeMap, conversations),
        Effect.provideService(CoreModules, core),
      );

      const accepted = yield* directory.acceptRollbackResult({
        expectedThreadId: "thread-a",
        thread: appThread("thread-a"),
        fallbackCwd: "/repo",
      });

      assert.isFalse(accepted.durable.hasUnreadTurn);
      assert.isFalse(accepted.canonical?.sidecar.hasUnreadTurn ?? true);
      assert.deepEqual(accepted.canonical?.requests, []);
      assert.deepEqual(
        conversations.currentConversation("thread-a")?.readSnapshot(),
        accepted.snapshot,
      );
    }),
  ),
);

it.effect(
  "materializes the full canonical transcript while durable execution-host ownership wins",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const threads = new Map([["thread-a", coreThread("thread-a")]]);
        const core = makeCore(threads);
        const conversations = makeConversations();
        const events: unknown[] = [];
        const eventHub = CodexApplicationEventHub.of({
          events: Stream.empty,
          publish: (event) => events.push(event),
        });
        const projection = yield* makeConversationProjection.pipe(
          Effect.provideService(ConversationRuntimeMap, conversations),
          Effect.provideService(
            CodexRendererConversationRegistry,
            makeCodexRendererConversationRegistryState(),
          ),
          Effect.provideService(CodexApplicationEventHub, eventHub),
          Effect.provideService(CoreModules, core),
        );
        const turn = {
          id: "turn-a",
          items: [
            {
              type: "userMessage",
              id: "item-a",
              content: [{ type: "text", text: "hydrate me", text_elements: [] }],
              clientId: "client-item-a",
            },
          ],
          itemsView: "full",
          status: "completed",
          error: null,
          startedAt: 101,
          completedAt: 102,
          durationMs: 1_000,
        } satisfies Thread["turns"][number];
        const gateway = makeGateway(((hostId, method, params) => {
          assert.strictEqual(hostId, "remote-a");
          assert.strictEqual(method, "thread/read");
          assert.deepEqual(params as unknown, { threadId: "thread-a", includeTurns: true });
          return Effect.succeed({ thread: appThread("thread-a", [turn]) });
        }) as RequestOnHost);
        const directory = yield* makeDirectory.pipe(
          Effect.provideService(CodexApplicationEventHub, eventHub),
          Effect.provideService(CodexConversationProjection, projection),
          Effect.provideService(CodexGateway, gateway),
          Effect.provideService(ConversationRuntimeMap, conversations),
          Effect.provideService(CoreModules, core),
        );

        const resolved = yield* directory.resolve({ threadId: "thread-a", fidelity: "full" });

        assert.strictEqual(resolved?.fidelity, "full");
        assert.strictEqual(resolved?.durable.threadName, "Hydrated Thread");
        assert.deepEqual(
          resolved?.canonical?.turns.map((candidate) => candidate.protocol.id),
          ["turn-a"],
        );
        assert.deepEqual(
          resolved?.snapshot?.turns.map((candidate) => candidate.turnId),
          ["turn-a"],
        );
        assert.strictEqual(
          conversations.currentConversation("thread-a")?.readCanonicalState(),
          resolved?.canonical,
        );
        assert.deepEqual(resolved?.snapshot?.turnPagination, {
          olderCursor: null,
          backwardsCursor: null,
          oldestLoadedTurnId: "turn-a",
          isLoadingOlder: false,
          hasLoadedOldest: true,
          loadedTurnCount: 1,
          itemsView: "full",
        });
        assert.isTrue(events.length > 0);
      }),
    ),
);

it.effect("routes an unknown remote child through root lineage and fences repeated cursors", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const threads = new Map([["root", coreThread("root", { created_at: 0 })]]);
      const core = makeCore(threads);
      const conversations = makeConversations();
      const cursors: unknown[] = [];
      const gateway = makeGateway(((hostId, method, params) => {
        assert.strictEqual(hostId, "remote-a");
        if (method === "thread/read") {
          assert.deepEqual(params as unknown, {
            threadId: "child-b",
            includeTurns: false,
          });
          return Effect.succeed({
            thread: {
              ...appThread("child-b"),
              parentThreadId: "child-a",
              source: { subAgentThreadSpawn: { parentThreadId: "child-a" } },
            },
          }) as never;
        }
        assert.strictEqual(method, "thread/list");
        const cursor = (params as { readonly cursor?: unknown }).cursor;
        cursors.push(cursor);
        return Effect.succeed(
          cursor === null
            ? {
                data: [
                  {
                    ...appThread("child-a"),
                    parentThreadId: "root",
                    source: { subAgentThreadSpawn: { parentThreadId: "root" } },
                  },
                ],
                nextCursor: "page-2",
              }
            : {
                data: [
                  {
                    ...appThread("child-b"),
                    parentThreadId: "child-a",
                    source: { subAgentThreadSpawn: { parentThreadId: "child-a" } },
                  },
                ],
                nextCursor: "page-2",
              },
        ) as never;
      }) as RequestOnHost);
      const directory = yield* makeDirectory.pipe(
        Effect.provideService(
          CodexApplicationEventHub,
          CodexApplicationEventHub.of({ events: Stream.empty, publish: () => undefined }),
        ),
        Effect.provideService(
          CodexConversationProjection,
          CodexConversationProjection.of({ hydrate: () => Effect.die("unused") } as never),
        ),
        Effect.provideService(CodexGateway, gateway),
        Effect.provideService(ConversationRuntimeMap, conversations),
        Effect.provideService(CoreModules, core),
      );

      const descendants = yield* directory.descendants({
        rootThreadId: "root",
        threadIds: ["child-b"],
        fidelity: "metadata",
      });

      assert.deepEqual(cursors, [null, "page-2"]);
      assert.deepEqual(
        ["child-a", "child-b"].map((threadId) => {
          const durable = threads.get(threadId);
          return {
            threadId,
            parentThreadId: durable?.parent_thread_id,
            projectId: durable?.project_id,
            executionHostId: durable?.execution_host_id,
          };
        }),
        [
          {
            threadId: "child-a",
            parentThreadId: "root",
            projectId: "project-a",
            executionHostId: "remote-a",
          },
          {
            threadId: "child-b",
            parentThreadId: "child-a",
            projectId: "project-a",
            executionHostId: "remote-a",
          },
        ],
      );
      assert.deepEqual(
        descendants.map(({ durable }) => durable.threadId),
        ["child-b"],
      );
    }),
  ),
);

it.effect("owner Scope close interrupts an in-flight remote hydration", () =>
  Effect.gen(function* () {
    const ownerScope = yield* Scope.make();
    const core = makeCore(new Map([["thread-a", coreThread("thread-a")]]));
    const conversations = makeConversations();
    let interrupted = false;
    const gateway = makeGateway((() =>
      Effect.never.pipe(
        Effect.onInterrupt(() => Effect.sync(() => (interrupted = true))),
      )) as RequestOnHost);
    const directory = yield* makeDirectory.pipe(
      Effect.provideService(
        CodexApplicationEventHub,
        CodexApplicationEventHub.of({ events: Stream.empty, publish: () => undefined }),
      ),
      Effect.provideService(
        CodexConversationProjection,
        CodexConversationProjection.of({ hydrate: () => Effect.die("unused") } as never),
      ),
      Effect.provideService(CodexGateway, gateway),
      Effect.provideService(ConversationRuntimeMap, conversations),
      Effect.provideService(CoreModules, core),
      Effect.provideService(Scope.Scope, ownerScope),
    );
    const resolve = yield* Effect.forkChild(
      directory.resolve({ threadId: "thread-a", fidelity: "full" }),
      { startImmediately: true },
    );
    yield* Effect.yieldNow;
    yield* Scope.close(ownerScope, Exit.void);

    assert.strictEqual((yield* Fiber.await(resolve))._tag, "Failure");
    assert.isTrue(interrupted);
  }),
);
