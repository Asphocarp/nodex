import { assert, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { CodexAppServerRequestError } from "@nodex/effect-codex-app-server/errors";
import { ProjectRuntimeLifecycleRuntime } from "../host-runtime/ProjectRuntimeLifecycleRuntime";
import { live as projectRuntimeLifecycleLive } from "../host-runtime/ProjectRuntimeLifecycleRuntime";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import { codexRuntimeError } from "../codex-runtime/CodexRuntimeError";
import {
  make as makeCommands,
  type CodexPreparedTurnStart,
  type CodexTurnCommandProjection,
} from "./CodexTurnCommands";
import {
  ConversationRuntimeMap,
  live as conversationRuntimeMapLive,
} from "./ConversationRuntimeMap";

const requestFailure = (message: string, data?: unknown) =>
  codexRuntimeError({
    operation: "gateway.request",
    reason: "request",
    retryable: false,
    hostId: "local",
    method: "turn/start",
    cause: new CodexAppServerRequestError({
      code: -32600,
      errorMessage: message,
      ...(data === undefined ? {} : { data }),
    }),
  });

const prepared = (
  threadId: string,
  rendererOwnsState: boolean,
  retry = false,
): CodexPreparedTurnStart => ({
  threadId,
  projectId: "project-a",
  rendererOwnsState,
  request: {
    threadId,
    input: [{ type: "text", text: retry ? "retry" : "first", text_elements: [] }],
  },
  state: {},
});

const makeHarness = (
  scope: Scope.Scope,
  input: {
    readonly request: (
      attempt: number,
    ) => Effect.Effect<unknown, ReturnType<typeof requestFailure>>;
    readonly rendererOwnsState?: boolean;
  },
) =>
  Effect.gen(function* () {
    const conversationContext = yield* Layer.buildWithScope(conversationRuntimeMapLive, scope);
    const conversations = Context.get(conversationContext, ConversationRuntimeMap);
    const projectContext = yield* Layer.buildWithScope(projectRuntimeLifecycleLive, scope);
    const projectLifecycle = Context.get(projectContext, ProjectRuntimeLifecycleRuntime);
    const events: string[] = [];
    let attempts = 0;
    const gateway = CodexGateway.of({
      localHostId: "local",
      requestForThread: ((_threadId: string, method: string) =>
        Effect.suspend(() => {
          if (method !== "turn/start") return Effect.die(`unexpected method: ${method}`);
          attempts += 1;
          events.push(`request:${attempts}`);
          return input.request(attempts);
        })) as CodexGateway["Service"]["requestForThread"],
    } as CodexGateway["Service"]);
    const projection: CodexTurnCommandProjection = {
      prepareStart: ({ threadId, rendererOwnsState }) =>
        Effect.sync(() => {
          events.push("prepare");
          return prepared(threadId, rendererOwnsState);
        }),
      beginStart: () => Effect.sync(() => events.push("begin")),
      recoverStart: (current) =>
        Effect.sync(() => {
          events.push("recover");
          return prepared(current.threadId, current.rendererOwnsState, true).request;
        }),
      commitStart: (_current, response) =>
        Effect.sync(() => {
          events.push("commit");
          return input.rendererOwnsState
            ? response
            : {
                threadId: "thread-a",
                turnId: "turn-a",
                status: "inProgress" as const,
                itemIds: [],
              };
        }),
      rollbackStart: () => Effect.sync(() => events.push("rollback")),
      prepareSteer: () => Effect.die("unused"),
      beginSteer: () => Effect.die("unused"),
      commitSteer: () => Effect.die("unused"),
      rollbackSteer: () => Effect.die("unused"),
    };
    const commands = yield* makeCommands(projection).pipe(
      Effect.provideService(CodexGateway, gateway),
      Effect.provideService(ConversationRuntimeMap, conversations),
      Effect.provideService(ProjectRuntimeLifecycleRuntime, projectLifecycle),
      Effect.provideService(Scope.Scope, scope),
    );
    return { attempts: () => attempts, commands, conversations, events };
  });

it.effect("retries a Main-owned start after canonical Thread recovery", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const harness = yield* makeHarness(scope, {
      request: (attempt) =>
        attempt === 1
          ? Effect.fail(requestFailure("thread not found: thread-a"))
          : Effect.succeed({ turn: { id: "turn-a" } }),
    });

    const result = yield* harness.commands.start("thread-a", "ship");

    assert.strictEqual(result?.turnId, "turn-a");
    assert.strictEqual(harness.attempts(), 2);
    assert.deepEqual(harness.events, [
      "prepare",
      "begin",
      "request:1",
      "recover",
      "request:2",
      "commit",
    ]);
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("does not recover a renderer-owned start and rolls back once", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const harness = yield* makeHarness(scope, {
      rendererOwnsState: true,
      request: () => Effect.fail(requestFailure("thread not found: thread-a")),
    });

    const exit = yield* Effect.exit(harness.commands.startRendererOwned("thread-a", "ship"));

    assert.isTrue(Exit.isFailure(exit));
    assert.strictEqual(harness.attempts(), 1);
    assert.deepEqual(harness.events, ["prepare", "begin", "request:1", "rollback"]);
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("shares the Thread generation lane with other application commands", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const harness = yield* makeHarness(scope, {
      request: () => Effect.succeed({ turn: { id: "turn-a" } }),
    });
    const occupied = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const holder = yield* harness.conversations
      .runExclusive(
        "thread-a",
        Deferred.succeed(occupied, undefined).pipe(Effect.andThen(Deferred.await(release))),
      )
      .pipe(Effect.forkChild);
    yield* Deferred.await(occupied);
    const start = yield* harness.commands.start("thread-a", "ship").pipe(Effect.forkChild);
    yield* Effect.yieldNow;

    assert.deepEqual(harness.events, []);
    yield* Deferred.succeed(release, undefined);
    yield* Fiber.join(holder);
    yield* Fiber.join(start);
    assert.deepEqual(harness.events, ["prepare", "begin", "request:1", "commit"]);
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("rolls back an admitted optimistic start when the Main Scope closes", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const started = yield* Deferred.make<void>();
    const interrupted = yield* Deferred.make<void>();
    const harness = yield* makeHarness(scope, {
      request: () =>
        Deferred.succeed(started, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
        ),
    });
    const command = yield* harness.commands.start("thread-a", "ship").pipe(Effect.forkChild);
    yield* Deferred.await(started);

    yield* Scope.close(scope, Exit.void);
    yield* Deferred.await(interrupted);
    const exit = yield* Fiber.await(command);

    assert.isTrue(Exit.isFailure(exit));
    assert.deepEqual(harness.events, ["prepare", "begin", "request:1", "rollback"]);
  }),
);

const makeSteerHarness = (
  scope: Scope.Scope,
  steerRequest: Effect.Effect<unknown, ReturnType<typeof requestFailure>>,
) =>
  Effect.gen(function* () {
    const conversationContext = yield* Layer.buildWithScope(conversationRuntimeMapLive, scope);
    const conversations = Context.get(conversationContext, ConversationRuntimeMap);
    const projectContext = yield* Layer.buildWithScope(projectRuntimeLifecycleLive, scope);
    const projectLifecycle = Context.get(projectContext, ProjectRuntimeLifecycleRuntime);
    const events: string[] = [];
    const gateway = CodexGateway.of({
      localHostId: "local",
      requestForThread: ((_threadId: string, method: string) =>
        Effect.suspend(() => {
          events.push(`request:${method}`);
          if (method === "turn/steer") return steerRequest;
          if (method === "turn/start") return Effect.succeed({ turn: { id: "turn-restarted" } });
          return Effect.die(`unexpected method: ${method}`);
        })) as CodexGateway["Service"]["requestForThread"],
    } as CodexGateway["Service"]);
    const projection: CodexTurnCommandProjection = {
      prepareStart: ({ threadId, rendererOwnsState }) =>
        Effect.sync(() => {
          events.push("prepare-start");
          return prepared(threadId, rendererOwnsState);
        }),
      beginStart: () => Effect.sync(() => events.push("begin-start")),
      recoverStart: () => Effect.die("unused"),
      commitStart: () =>
        Effect.sync(() => {
          events.push("commit-start");
          return {
            threadId: "thread-a",
            turnId: "turn-restarted",
            status: "inProgress" as const,
            itemIds: [],
          };
        }),
      rollbackStart: () => Effect.sync(() => events.push("rollback-start")),
      prepareSteer: ({ command, steerId, syncDormantConversationUpdates }) =>
        Effect.sync(() => {
          events.push("prepare-steer");
          assert.match(steerId, /^steer:thread-a:\d+:[0-9a-z]{6}$/);
          return {
            threadId: command.threadId,
            request: {
              threadId: command.threadId,
              expectedTurnId: command.expectedTurnId ?? "turn-active",
              clientUserMessageId: steerId,
              input: [{ type: "text" as const, text: command.prompt, text_elements: [] }],
            },
            fallbackStart: {
              prompt: command.prompt,
              overrides: {},
              syncDormantConversationUpdates,
            },
            state: {},
          };
        }),
      beginSteer: () => Effect.sync(() => events.push("begin-steer")),
      commitSteer: (_prepared, response) =>
        Effect.sync(() => {
          events.push("commit-steer");
          return response;
        }),
      rollbackSteer: () => Effect.sync(() => events.push("rollback-steer")),
    };
    const commands = yield* makeCommands(projection).pipe(
      Effect.provideService(CodexGateway, gateway),
      Effect.provideService(ConversationRuntimeMap, conversations),
      Effect.provideService(ProjectRuntimeLifecycleRuntime, projectLifecycle),
      Effect.provideService(Scope.Scope, scope),
    );
    return { commands, events };
  });

it.effect("commits a Main-owned steer in the shared Thread transaction", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const harness = yield* makeSteerHarness(scope, Effect.succeed({ turnId: "turn-active" }));

    const result = yield* harness.commands.steer({
      threadId: "thread-a",
      expectedTurnId: "turn-active",
      prompt: "steer",
    });

    assert.deepEqual(result, { turnId: "turn-active" });
    assert.deepEqual(harness.events, [
      "prepare-steer",
      "begin-steer",
      "request:turn/steer",
      "commit-steer",
    ]);
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("rolls back an inactive steer before starting a new Turn in the same lane", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const harness = yield* makeSteerHarness(
      scope,
      Effect.fail(
        requestFailure("active turn not steerable", {
          codexErrorInfo: { activeTurnNotSteerable: {} },
        }),
      ),
    );

    const result = yield* harness.commands.steer({
      threadId: "thread-a",
      expectedTurnId: "turn-active",
      prompt: "continue",
    });

    assert.deepEqual(result, { turnId: "turn-restarted" });
    assert.deepEqual(harness.events, [
      "prepare-steer",
      "begin-steer",
      "request:turn/steer",
      "rollback-steer",
      "prepare-start",
      "begin-start",
      "request:turn/start",
      "commit-start",
    ]);
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("routes a renderer-owned steer without mutating Main projection state", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const harness = yield* makeSteerHarness(scope, Effect.succeed({ turnId: "turn-owner" }));

    const result = yield* harness.commands.steerRendererOwned({
      threadId: "thread-a",
      expectedTurnId: "turn-owner",
      input: [{ type: "text", text: "owner steer", text_elements: [] }],
    });

    assert.deepEqual(result, { turnId: "turn-owner" });
    assert.deepEqual(harness.events, ["request:turn/steer"]);
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("rolls back an optimistic steer when the Main Scope closes", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const started = yield* Deferred.make<void>();
    const interrupted = yield* Deferred.make<void>();
    const harness = yield* makeSteerHarness(
      scope,
      Deferred.succeed(started, undefined).pipe(
        Effect.andThen(Effect.never),
        Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
      ),
    );
    const command = yield* harness.commands
      .steer({
        threadId: "thread-a",
        expectedTurnId: "turn-active",
        prompt: "steer",
      })
      .pipe(Effect.forkChild);
    yield* Deferred.await(started);

    yield* Scope.close(scope, Exit.void);
    yield* Deferred.await(interrupted);
    const exit = yield* Fiber.await(command);

    assert.isTrue(Exit.isFailure(exit));
    assert.deepEqual(harness.events, [
      "prepare-steer",
      "begin-steer",
      "request:turn/steer",
      "rollback-steer",
    ]);
  }),
);
