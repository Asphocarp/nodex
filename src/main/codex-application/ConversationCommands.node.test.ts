import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { assert, it } from "@effect/vitest";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import {
  ConversationRuntimeMap,
  live as conversationRuntimeMapLive,
} from "./ConversationRuntimeMap";
import { CodexServerRequestResponses } from "./CodexServerRequestResponses";

const serverRequestResponses = CodexServerRequestResponses.of({
  approval: () => Effect.die("unused"),
  userInput: () => Effect.die("unused"),
  mcpElicitation: () => Effect.die("unused"),
  permission: () => Effect.die("unused"),
  optionPicker: () => Effect.die("unused"),
  setupContextPicker: () => Effect.die("unused"),
  setupCodexStep: () => Effect.die("unused"),
  planImplementation: () => Effect.die("unused"),
  declineAll: () => Effect.die("unused"),
  declineAllInTransaction: () => Effect.void,
});
import { ConversationCommands, live as conversationCommandsLive } from "./ConversationCommands";

it.effect("routes direct thread operations and drains background-terminal pages", () =>
  Effect.gen(function* () {
    const requests: Array<{
      readonly scope: "local" | "thread";
      readonly method: string;
      readonly params: unknown;
    }> = [];
    const projections: string[] = [];
    const respond = (scope: "local" | "thread", method: string, params: unknown) => {
      requests.push({ scope, method, params });
      if (method === "thread/backgroundTerminals/list") {
        const cursor = (params as { readonly cursor?: string | null }).cursor ?? null;
        return Effect.succeed({
          data: [
            {
              itemId: cursor === null ? "item-a" : "item-b",
              processId: cursor === null ? "process-a" : "process-b",
              command: cursor === null ? "vp run dev" : "vp run test",
              cwd: "/repo",
              osPid: null,
              cpuPercent: null,
              rssKb: null,
            },
          ],
          nextCursor: cursor === null ? "page-2" : null,
        });
      }
      if (method === "thread/backgroundTerminals/terminate") {
        return Effect.succeed({ terminated: true });
      }
      if (method === "review/start") {
        return Effect.succeed({
          reviewThreadId: "thread-a",
          turn: {
            id: "review-turn",
            items: [],
            itemsView: "full",
            status: "inProgress",
            error: null,
            startedAt: 1,
            completedAt: null,
            durationMs: null,
          },
        });
      }
      return Effect.succeed({});
    };
    const unsupported = () => Effect.die(new Error("Unsupported test operation"));
    const gateway = CodexGateway.of({
      localHostId: "local",
      requestRawOnHost: () => Effect.die(new Error("Unsupported raw host request")),
      requestRawForThread: () => Effect.die(new Error("Unsupported raw request")),
      events: Stream.empty,
      requestLocal: ((method: string, params: unknown) =>
        respond("local", method, params)) as CodexGateway["Service"]["requestLocal"],
      requestOnHost: ((_hostId: string, method: string, params: unknown) =>
        respond("local", method, params)) as CodexGateway["Service"]["requestOnHost"],
      requestForThread: ((_threadId: string, method: string, params: unknown) =>
        respond("thread", method, params)) as CodexGateway["Service"]["requestForThread"],
      notifyLocal: unsupported,
      connection: () => unsupported(),
      connectionChanges: () => Stream.empty,
      awaitReady: () => Effect.void,
      reconcileHost: unsupported,
      removeHost: unsupported,
      restartHost: unsupported,
    });
    const scope = yield* Scope.make();
    const runtimeContext = yield* Layer.buildWithScope(conversationRuntimeMapLive, scope);
    const context = yield* Layer.buildWithScope(
      conversationCommandsLive({
        archive: (threadId) =>
          Effect.sync(() => {
            projections.push(`archive:${threadId}`);
            return true;
          }),
        unarchive: (threadId) =>
          Effect.sync(() => {
            projections.push(`unarchive:${threadId}`);
            return null;
          }),
        prepareInterrupt: (threadId, turnId) =>
          Effect.sync(() => {
            const resolved = turnId ?? "turn-inferred";
            projections.push(`prepare-interrupt:${threadId}:${resolved}`);
            return resolved;
          }),
        applyInterrupt: ({ threadId, turnId, syncDormantConversationUpdates }) =>
          Effect.sync(() => {
            projections.push(
              `apply-interrupt:${threadId}:${turnId}:${syncDormantConversationUpdates}`,
            );
            return true;
          }),
        backgroundTerminalTurnIds: (threadId) =>
          Effect.sync(() => {
            projections.push(`background-turns:${threadId}`);
            return ["turn-background"];
          }),
        backgroundTerminalsCleaned: (threadId) =>
          Effect.sync(() => {
            projections.push(`background-cleaned:${threadId}`);
          }),
      }).pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(CodexGateway, gateway),
            Layer.succeed(
              ConversationRuntimeMap,
              Context.get(runtimeContext, ConversationRuntimeMap),
            ),
            Layer.succeed(
              CodexServerRequestResponses,
              CodexServerRequestResponses.of({
                ...serverRequestResponses,
                declineAllInTransaction: (threadId) =>
                  Effect.sync(() => projections.push(`decline-requests:${threadId}`)),
              }),
            ),
          ),
        ),
      ),
      scope,
    );
    const commands = Context.get(context, ConversationCommands);

    yield* commands.setMemoryMode("thread-a", "enabled");
    yield* commands.uploadFeedback({
      classification: "helpful",
      reason: "helpful",
      threadId: "thread-a",
      includeLogs: false,
    });
    const review = yield* commands.startReview({
      threadId: "thread-a",
      target: { type: "uncommittedChanges" },
    });
    const terminals = yield* commands.listBackgroundTerminals("thread-a");
    const terminated = yield* commands.terminateBackgroundTerminal("thread-a", "process-b");
    assert.isTrue(yield* commands.interrupt("thread-a", "turn-explicit"));
    assert.isTrue(yield* commands.cleanBackgroundTerminals("thread-a"));
    assert.isTrue(yield* commands.cleanBackgroundTerminalsSilently("thread-a"));
    assert.isTrue(yield* commands.archive("thread-a"));
    assert.isNull(yield* commands.unarchive("thread-a"));

    assert.deepEqual(
      terminals.map((terminal) => terminal.processId),
      ["process-a", "process-b"],
    );
    assert.isTrue(terminated);
    assert.strictEqual(review.turn.id, "review-turn");
    assert.strictEqual(
      requests.filter(({ method }) => method === "review/start")[0]?.scope,
      "thread",
    );
    assert.strictEqual(
      requests.filter(({ method }) => method === "feedback/upload")[0]?.scope,
      "local",
    );
    assert.deepEqual(
      requests
        .filter(({ method }) => method === "thread/backgroundTerminals/list")
        .map(({ params }) => (params as { readonly cursor?: string | null }).cursor ?? null),
      [null, "page-2"],
    );
    assert.deepEqual(projections, [
      "prepare-interrupt:thread-a:turn-explicit",
      "decline-requests:thread-a",
      "apply-interrupt:thread-a:turn-explicit:true",
      "background-turns:thread-a",
      "prepare-interrupt:thread-a:turn-background",
      "decline-requests:thread-a",
      "apply-interrupt:thread-a:turn-background:true",
      "background-cleaned:thread-a",
      "archive:thread-a",
      "unarchive:thread-a",
    ]);

    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("interrupts an active archive command when its owning Scope closes", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const interrupted = yield* Deferred.make<void>();
    const unsupported = () => Effect.die(new Error("Unsupported test operation"));
    const gateway = CodexGateway.of({
      localHostId: "local",
      requestRawOnHost: () => Effect.die(new Error("Unsupported raw host request")),
      requestRawForThread: () => Effect.die(new Error("Unsupported raw request")),
      events: Stream.empty,
      requestLocal: unsupported,
      requestOnHost: unsupported,
      requestForThread: ((_threadId: string, method: string) =>
        method === "thread/archive"
          ? Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Effect.never),
              Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
            )
          : unsupported()) as CodexGateway["Service"]["requestForThread"],
      notifyLocal: unsupported,
      connection: () => unsupported(),
      connectionChanges: () => Stream.empty,
      awaitReady: () => Effect.void,
      reconcileHost: unsupported,
      removeHost: unsupported,
      restartHost: unsupported,
    });
    const scope = yield* Scope.make();
    const runtimeContext = yield* Layer.buildWithScope(conversationRuntimeMapLive, scope);
    const context = yield* Layer.buildWithScope(
      conversationCommandsLive({
        archive: () => Effect.succeed(true),
        unarchive: () => Effect.succeed(null),
        prepareInterrupt: (_threadId, turnId) => Effect.succeed(turnId ?? "turn-a"),
        applyInterrupt: () => Effect.succeed(true),
        backgroundTerminalTurnIds: () => Effect.succeed([]),
        backgroundTerminalsCleaned: () => Effect.void,
      }).pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(CodexGateway, gateway),
            Layer.succeed(
              ConversationRuntimeMap,
              Context.get(runtimeContext, ConversationRuntimeMap),
            ),
            Layer.succeed(CodexServerRequestResponses, serverRequestResponses),
          ),
        ),
      ),
      scope,
    );
    const commands = Context.get(context, ConversationCommands);
    const caller = yield* Effect.forkChild(commands.archive("thread-a"));

    yield* Deferred.await(started);
    yield* Scope.close(scope, Exit.void);
    yield* Deferred.await(interrupted);
    const exit = yield* Fiber.await(caller);
    assert.isTrue(Exit.isFailure(exit));
    if (Exit.isFailure(exit)) assert.isTrue(Cause.hasInterruptsOnly(exit.cause));
  }),
);
