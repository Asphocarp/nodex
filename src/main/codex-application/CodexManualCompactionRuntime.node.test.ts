import type { Thread } from "@nodex/codex-app-server-protocol/v2";
import { assert, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import {
  createCodexCanonicalConversationState,
  type CodexCanonicalConversationState,
  type CodexCanonicalTurnParams,
} from "../../shared/codex-conversation-state/codex-conversation-state";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import { codexRuntimeError } from "../codex-runtime/CodexRuntimeError";
import {
  CodexManualCompactionClosedError,
  CodexManualCompactionRuntime,
  live,
  type CodexManualCompactionProjectionPort,
} from "./CodexManualCompactionRuntime";

const threadId = "thread-manual-compaction";
const turnId = "turn-manual-compaction";

const turnParams: CodexCanonicalTurnParams = {
  threadId,
  input: [],
  approvalPolicy: "on-request",
  approvalsReviewer: "user",
  sandboxPolicy: {
    type: "workspaceWrite",
    writableRoots: [],
    networkAccess: false,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  },
  model: "fixture-model",
  cwd: "/workspace/project",
  attachments: [],
  effort: "high",
  summary: "none",
  personality: null,
  outputSchema: null,
  collaborationMode: null,
};

const thread = (status: "inProgress" | "completed" = "inProgress"): Thread => ({
  id: threadId,
  extra: null,
  sessionId: "session-manual-compaction",
  forkedFromId: null,
  parentThreadId: null,
  preview: "Manual compaction fixture",
  ephemeral: false,
  section: null,
  sectionEnteredAt: null,
  historyMode: "paginated",
  modelProvider: "openai",
  createdAt: 1,
  updatedAt: 2,
  recencyAt: 2,
  status: { type: "active", activeFlags: [] },
  path: null,
  cwd: "/workspace/project",
  cliVersion: "fixture",
  source: "unknown",
  canAcceptDirectInput: true,
  threadSource: null,
  agentNickname: null,
  agentRole: null,
  gitInfo: null,
  name: "Manual compaction fixture",
  turns: [
    {
      id: turnId,
      items: [],
      itemsView: "full",
      status,
      error: null,
      startedAt: 1,
      completedAt: status === "completed" ? 2 : null,
      durationMs: status === "completed" ? 1 : null,
    },
  ],
});

const state = (status: "inProgress" | "completed" = "inProgress") =>
  createCodexCanonicalConversationState(thread(status), {
    turnParamsById: { [turnId]: turnParams },
  });

const gateway = (request: CodexGateway["Service"]["requestForThread"]): CodexGateway["Service"] => {
  const unsupported = () => Effect.die(new Error("Unsupported test operation"));
  return CodexGateway.of({
    localHostId: "local",
    requestRawOnHost: () => Effect.die(new Error("Unsupported raw host request")),
    requestRawForThread: () => Effect.die(new Error("Unsupported raw request")),
    events: Stream.empty,
    requestLocal: unsupported as CodexGateway["Service"]["requestLocal"],
    requestOnHost: unsupported as CodexGateway["Service"]["requestOnHost"],
    requestForThread: request,
    notifyLocal: unsupported,
    connection: unsupported,
    connectionChanges: () => Stream.empty,
    awaitReady: unsupported,
    reconcileHost: unsupported,
    removeHost: unsupported,
    restartHost: unsupported,
  });
};

const makeProjection = (initial: CodexCanonicalConversationState) => {
  let current = initial;
  const publications: Array<string | null> = [];
  const projection: CodexManualCompactionProjectionPort = {
    read: () => current,
    commit: (input) => {
      current = input.after;
    },
    publish: (_threadId, publishedTurnId) => publications.push(publishedTurnId),
  };
  return {
    projection,
    publications,
    state: () => current,
  };
};

const build = Effect.fn("CodexManualCompactionRuntimeTest.build")(function* (
  projection: CodexManualCompactionProjectionPort,
  request: CodexGateway["Service"]["requestForThread"],
  scope: Scope.Scope,
) {
  const context = yield* Layer.buildWithScope(
    live(projection).pipe(Layer.provide(Layer.succeed(CodexGateway, gateway(request)))),
    scope,
  );
  return Context.get(context, CodexManualCompactionRuntime);
});

it.effect("admits a manual compaction once and correlates the accepted lifecycle source", () =>
  Effect.gen(function* () {
    const projection = makeProjection(state());
    const scope = yield* Scope.make();
    const runtime = yield* build(
      projection.projection,
      ((_threadId, method) => {
        assert.strictEqual(method, "thread/compact/start");
        return Effect.succeed({});
      }) as CodexGateway["Service"]["requestForThread"],
      scope,
    );

    yield* runtime.start(threadId);
    assert.strictEqual(
      projection.state().turns[0]?.items[0]?.id,
      "pending-manual-context-compaction",
    );
    assert.deepEqual(projection.publications, [turnId]);
    assert.strictEqual(runtime.consumeSource(threadId), "manual");
    assert.strictEqual(runtime.consumeSource(threadId), "automatic");

    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("rolls back only the failed admission and preserves pre-existing local turns", () =>
  Effect.gen(function* () {
    const initial = state("completed");
    const projection = makeProjection(initial);
    const scope = yield* Scope.make();
    const failure = codexRuntimeError({
      operation: "manual-compaction-test",
      reason: "request",
      retryable: false,
    });
    const runtime = yield* build(
      projection.projection,
      (() => Effect.fail(failure)) as CodexGateway["Service"]["requestForThread"],
      scope,
    );

    assert.strictEqual(yield* runtime.start(threadId).pipe(Effect.flip), failure);
    assert.deepEqual(projection.state(), initial);
    assert.deepEqual(projection.publications, [null, null]);
    assert.strictEqual(runtime.consumeSource(threadId), "automatic");

    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("retains the optimistic row while another admitted request can still be accepted", () =>
  Effect.gen(function* () {
    const projection = makeProjection(state());
    const firstStarted = yield* Deferred.make<void>();
    const secondStarted = yield* Deferred.make<void>();
    const releaseFirst = yield* Deferred.make<void>();
    const releaseSecond = yield* Deferred.make<void>();
    const failure = codexRuntimeError({
      operation: "manual-compaction-test",
      reason: "request",
      retryable: false,
    });
    let requestCount = 0;
    const scope = yield* Scope.make();
    const runtime = yield* build(
      projection.projection,
      (() => {
        requestCount += 1;
        return requestCount === 1
          ? Deferred.succeed(firstStarted, undefined).pipe(
              Effect.andThen(Deferred.await(releaseFirst)),
              Effect.andThen(Effect.fail(failure)),
            )
          : Deferred.succeed(secondStarted, undefined).pipe(
              Effect.andThen(Deferred.await(releaseSecond)),
              Effect.as({}),
            );
      }) as CodexGateway["Service"]["requestForThread"],
      scope,
    );
    const first = yield* Effect.forkChild(runtime.start(threadId));
    yield* Deferred.await(firstStarted);
    const second = yield* Effect.forkChild(runtime.start(threadId));
    yield* Deferred.await(secondStarted);

    yield* Deferred.succeed(releaseFirst, undefined);
    assert.strictEqual(yield* Fiber.join(first).pipe(Effect.flip), failure);
    assert.strictEqual(
      projection.state().turns[0]?.items[0]?.id,
      "pending-manual-context-compaction",
    );
    yield* Deferred.succeed(releaseSecond, undefined);
    yield* Fiber.join(second);
    assert.strictEqual(runtime.consumeSource(threadId), "manual");
    assert.strictEqual(runtime.consumeSource(threadId), "automatic");

    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("interrupts an admitted request with its Scope, compensates, and closes admission", () =>
  Effect.gen(function* () {
    const initial = state();
    const projection = makeProjection(initial);
    const started = yield* Deferred.make<void>();
    let interrupted = false;
    const scope = yield* Scope.make();
    const runtime = yield* build(
      projection.projection,
      (() =>
        Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.onInterrupt(() => Effect.sync(() => void (interrupted = true))),
        )) as CodexGateway["Service"]["requestForThread"],
      scope,
    );
    const fiber = yield* runtime.start(threadId).pipe(Effect.forkIn(scope));
    yield* Deferred.await(started);

    yield* Scope.close(scope, Exit.void);
    yield* Fiber.await(fiber);
    assert.isTrue(interrupted);
    assert.deepEqual(projection.state(), initial);
    assert.strictEqual(runtime.consumeSource(threadId), "automatic");
    const closed = yield* runtime.start(threadId).pipe(Effect.flip);
    assert.instanceOf(closed, CodexManualCompactionClosedError);
  }),
);
