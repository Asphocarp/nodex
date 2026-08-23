import { assert, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import type { ThreadStartParams, ThreadStartResponse } from "@nodex/codex-app-server-protocol/v2";
import type {
  CodexThreadDetail,
  CodexThreadStartForSessionInput,
  CodexThreadStartForSessionResult,
  CodexTurnSummary,
} from "../../shared/types";
import {
  ProjectRuntimeLifecycleRuntime,
  live as projectRuntimeLifecycleLive,
} from "../host-runtime/ProjectRuntimeLifecycleRuntime";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import { CodexTurnCommands, type CodexTurnCommandsService } from "./CodexTurnCommands";
import {
  CodexSessionThreadLaunchProjectionError,
  make as makeSessionThreadLaunch,
  type CodexPreparedSessionThreadLaunch,
  type CodexSessionThreadLaunchProjection,
} from "./CodexSessionThreadLaunch";

const input = (
  sessionId = "session-a",
  projectId: string | null = "project-a",
): CodexThreadStartForSessionInput => ({
  projectId,
  sessionId,
  prompt: "Ship it",
});

const startedResult = (threadId: string): CodexThreadStartForSessionResult => ({
  kind: "started",
  detail: { threadId } as CodexThreadDetail,
});

const turn = (threadId: string): CodexTurnSummary => ({
  threadId,
  turnId: `turn:${threadId}`,
  status: "inProgress",
  itemIds: [],
});

const projectionFailure = (
  operation: CodexSessionThreadLaunchProjectionError["operation"],
  sessionId: string,
) =>
  new CodexSessionThreadLaunchProjectionError({
    operation,
    sessionId,
    cause: new Error(`${operation} failed`),
  });

interface HarnessOptions {
  readonly prepare?: (
    request: CodexThreadStartForSessionInput,
  ) => Effect.Effect<CodexPreparedSessionThreadLaunch, CodexSessionThreadLaunchProjectionError>;
  readonly requestStart?: (attempt: number) => Effect.Effect<ThreadStartResponse>;
  readonly commitFailure?: boolean;
  readonly completeWithoutMainTurn?: boolean;
}

const makeHarness = (scope: Scope.Scope, options: HarnessOptions = {}) =>
  Effect.gen(function* () {
    const projectContext = yield* Layer.buildWithScope(projectRuntimeLifecycleLive, scope);
    const projectLifecycle = Context.get(projectContext, ProjectRuntimeLifecycleRuntime);
    const events: string[] = [];
    let requestAttempts = 0;

    const gateway = CodexGateway.of({
      localHostId: "local",
      requestRawOnHost: () => Effect.die(new Error("Unsupported raw host request")),
      requestLocal: ((method: string, params: { threadId?: string }) =>
        Effect.suspend(() => {
          if (method === "thread/delete") {
            events.push(`delete:${params.threadId}`);
            return Effect.succeed({});
          }
          if (method !== "thread/start") return Effect.die(`unexpected request: ${method}`);
          requestAttempts += 1;
          events.push(`request:${requestAttempts}`);
          return (
            options.requestStart?.(requestAttempts) ??
            Effect.succeed({
              thread: { id: `thread-${requestAttempts}` },
            } as unknown as ThreadStartResponse)
          );
        })) as CodexGateway["Service"]["requestLocal"],
    } as unknown as CodexGateway["Service"]);
    const turns = CodexTurnCommands.of({
      start: (threadId) =>
        Effect.sync(() => {
          events.push(`turn:${threadId}`);
          return turn(threadId);
        }),
      startRendererOwned: () => Effect.die("unused"),
      steer: () => Effect.die("unused"),
      steerRendererOwned: () => Effect.die("unused"),
    } satisfies CodexTurnCommandsService);
    const projection: CodexSessionThreadLaunchProjection = {
      prepare: (request) =>
        Effect.sync(() => events.push(`prepare:${request.sessionId}`)).pipe(
          Effect.andThen(
            options.prepare?.(request) ??
              Effect.succeed({
                kind: "immediate" as const,
                sessionId: request.sessionId,
                request: { cwd: "/workspace" } as ThreadStartParams,
                state: {},
              }),
          ),
        ),
      enqueuePending: (prepared) =>
        Effect.sync(() => {
          events.push(`enqueue:${prepared.sessionId}`);
          return {
            kind: "pending",
            pendingWorktreeId: "pending-a",
            clientThreadId: "client-a",
          };
        }),
      begin: (prepared) =>
        Effect.sync(() => {
          events.push(`begin:${prepared.sessionId}`);
        }),
      commit: (prepared, response) =>
        Effect.sync(() => events.push(`commit:${prepared.sessionId}`)).pipe(
          Effect.andThen(
            options.commitFailure
              ? Effect.fail(projectionFailure("commit", prepared.sessionId))
              : Effect.succeed({
                  sessionId: prepared.sessionId,
                  threadId: response.thread.id,
                  state: {},
                }),
          ),
        ),
      end: (prepared) =>
        Effect.sync(() => {
          events.push(`end:${prepared.sessionId}`);
        }),
      prepareCompletion: (committed) =>
        Effect.sync(() => events.push(`complete:${committed.sessionId}`)).pipe(
          Effect.as(
            options.completeWithoutMainTurn
              ? ({
                  kind: "complete",
                  result: startedResult(committed.threadId),
                } as const)
              : ({
                  kind: "main-owned-first-turn",
                  sessionId: committed.sessionId,
                  threadId: committed.threadId,
                  prompt: "Ship it",
                  overrides: {},
                  state: {},
                } as const),
          ),
        ),
      finishFirstTurn: (prepared) =>
        Effect.sync(() => {
          events.push(`finish:${prepared.sessionId}`);
          return startedResult(prepared.threadId);
        }),
      fail: ({ request, committedThreadId }) =>
        Effect.sync(() => {
          events.push(`fail:${request.sessionId}:${committedThreadId ?? "uncommitted"}`);
        }),
    };
    const commands = yield* makeSessionThreadLaunch(projection).pipe(
      Effect.provideService(CodexGateway, gateway),
      Effect.provideService(CodexTurnCommands, turns),
      Effect.provideService(ProjectRuntimeLifecycleRuntime, projectLifecycle),
      Effect.provideService(Scope.Scope, scope),
    );

    return { commands, events, requestAttempts: () => requestAttempts };
  });

it.effect("commits a Session Thread and its first Turn as one application transaction", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const harness = yield* makeHarness(scope);

    const result = yield* harness.commands.start(input(), {
      browserViewScopeId: "window-a",
      ownerClientId: null,
    });

    assert.strictEqual(result.kind, "started");
    assert.deepEqual(harness.events, [
      "prepare:session-a",
      "begin:session-a",
      "request:1",
      "commit:session-a",
      "end:session-a",
      "complete:session-a",
      "turn:thread-1",
      "finish:session-a",
    ]);
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("returns a pending worktree launch without touching the Gateway", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const harness = yield* makeHarness(scope, {
      prepare: (request) =>
        Effect.succeed({
          kind: "pending",
          sessionId: request.sessionId,
          state: {},
        }),
    });

    const result = yield* harness.commands.start(input(), {
      browserViewScopeId: "window-a",
      ownerClientId: null,
    });

    assert.strictEqual(result.kind, "pending");
    assert.strictEqual(harness.requestAttempts(), 0);
    assert.deepEqual(harness.events, ["prepare:session-a", "enqueue:session-a"]);
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("deletes an app-server Thread when its durable Session link fails", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const harness = yield* makeHarness(scope, { commitFailure: true });

    const exit = yield* Effect.exit(
      harness.commands.start(input(), {
        browserViewScopeId: "window-a",
        ownerClientId: null,
      }),
    );

    assert.isTrue(Exit.isFailure(exit));
    assert.deepEqual(harness.events, [
      "prepare:session-a",
      "begin:session-a",
      "request:1",
      "commit:session-a",
      "end:session-a",
      "delete:thread-1",
      "fail:session-a:uncommitted",
    ]);
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("serializes concurrent launches for one Session", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const firstRequest = yield* Deferred.make<void>();
    const releaseFirst = yield* Deferred.make<void>();
    const harness = yield* makeHarness(scope, {
      requestStart: (attempt) =>
        attempt === 1
          ? Deferred.succeed(firstRequest, undefined).pipe(
              Effect.andThen(Deferred.await(releaseFirst)),
              Effect.as({ thread: { id: "thread-1" } } as unknown as ThreadStartResponse),
            )
          : Effect.succeed({ thread: { id: "thread-2" } } as unknown as ThreadStartResponse),
    });
    const context = { browserViewScopeId: "window-a", ownerClientId: null };
    const first = yield* harness.commands
      .start(input("session-a", null), context)
      .pipe(Effect.forkChild({ startImmediately: true }));
    yield* Deferred.await(firstRequest);
    const second = yield* harness.commands
      .start(input("session-a", null), context)
      .pipe(Effect.forkChild({ startImmediately: true }));
    yield* Effect.yieldNow;

    assert.strictEqual(harness.requestAttempts(), 1);
    assert.deepEqual(
      harness.events.filter((event) => event.startsWith("prepare:")),
      ["prepare:session-a"],
    );
    yield* Deferred.succeed(releaseFirst, undefined);
    yield* Effect.all([Fiber.join(first), Fiber.join(second)]);
    assert.strictEqual(harness.requestAttempts(), 2);

    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("ends notification deferral and projects failure when the Main Scope closes", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const requestStarted = yield* Deferred.make<void>();
    const harness = yield* makeHarness(scope, {
      requestStart: () =>
        Deferred.succeed(requestStarted, undefined).pipe(Effect.andThen(Effect.never)),
    });
    const command = yield* harness.commands
      .start(input(), { browserViewScopeId: "window-a", ownerClientId: null })
      .pipe(Effect.forkIn(scope));
    yield* Deferred.await(requestStarted);

    yield* Scope.close(scope, Exit.void);
    const exit = yield* Fiber.await(command);

    assert.isTrue(Exit.isFailure(exit));
    assert.deepEqual(harness.events, [
      "prepare:session-a",
      "begin:session-a",
      "request:1",
      "end:session-a",
      "fail:session-a:uncommitted",
    ]);
  }),
);

it.effect("skips the Main-owned Turn for a renderer adoption launch", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const harness = yield* makeHarness(scope, { completeWithoutMainTurn: true });

    yield* harness.commands.start(input(), {
      browserViewScopeId: "window-a",
      ownerClientId: "renderer-a",
    });

    assert.isFalse(harness.events.some((event) => event.startsWith("turn:")));
    assert.deepEqual(harness.events.slice(-2), ["end:session-a", "complete:session-a"]);
    yield* Scope.close(scope, Exit.void);
  }),
);
