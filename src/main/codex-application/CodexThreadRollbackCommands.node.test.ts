import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { assert, it } from "@effect/vitest";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import { CodexOwnerNotificationDrainRuntime } from "./CodexOwnerNotificationDrainRuntime";
import { make } from "./CodexThreadRollbackCommands";
import { ConversationRuntimeMap } from "./ConversationRuntimeMap";
import { makeCodexConversationAggregateRegistry } from "./CodexConversationAggregate";

const unused = () => Effect.die(new Error("Unsupported test operation"));

const makeGateway = (
  requestForThread: CodexGateway["Service"]["requestForThread"],
): CodexGateway["Service"] =>
  CodexGateway.of({
    localHostId: "local",
    requestRawOnHost: () => Effect.die(new Error("Unsupported raw host request")),
    events: Stream.empty,
    requestForThread,
    requestRawForThread: () => Effect.die("unused"),
    requestLocal: unused,
    requestOnHost: unused,
    notifyLocal: unused,
    connection: unused,
    connectionChanges: () => Stream.empty,
    awaitReady: () => Effect.void,
    reconcileHost: unused,
    removeHost: unused,
    restartHost: unused,
  } as unknown as CodexGateway["Service"]);

const ownerDrain = (events: string[]): CodexOwnerNotificationDrainRuntime["Service"] =>
  CodexOwnerNotificationDrainRuntime.of({
    next: () => 1,
    ack: () => undefined,
    awaitCurrent: (threadId) => Effect.sync(() => events.push(`drain:${threadId}`)),
    resetOwner: () => undefined,
    release: () => undefined,
    clear: () => undefined,
  });

const conversationLane = (events: string[]): ConversationRuntimeMap["Service"] => {
  const conversations = makeCodexConversationAggregateRegistry();
  return ConversationRuntimeMap.of({
    conversation: conversations.acquire,
    currentConversation: conversations.current,
    requests: Stream.empty,
    runtime: () => Effect.die("unused"),
    runExclusive: (threadId, operation) =>
      Effect.sync(() => events.push(`lane:${threadId}`)).pipe(Effect.andThen(operation)),
    close: () => Effect.void,
  });
};

it.effect("runs owner drain, validation, Gateway, and projection commit in the Thread lane", () =>
  Effect.gen(function* () {
    const events: string[] = [];
    const commands = yield* make({
      prepareLatestForEdit: (input) =>
        Effect.sync(() => {
          events.push(`prepare:${input.turnId}`);
          return {
            threadId: input.threadId,
            request: { threadId: input.threadId, numTurns: input.numTurns },
            state: {},
          };
        }),
      commit: (prepared, response) =>
        Effect.sync(() => {
          events.push(`commit:${prepared.threadId}`);
          return response;
        }),
    }).pipe(
      Effect.provideService(
        CodexGateway,
        makeGateway(((threadId, method, params) =>
          Effect.sync(() => {
            const rollback = params as { readonly numTurns: number };
            events.push(`request:${threadId}:${method}:${rollback.numTurns}`);
            return { thread: { id: threadId } } as never;
          })) as CodexGateway["Service"]["requestForThread"]),
      ),
      Effect.provideService(CodexOwnerNotificationDrainRuntime, ownerDrain(events)),
      Effect.provideService(ConversationRuntimeMap, conversationLane(events)),
    );

    const response = yield* commands.rollbackLatestForEdit({
      threadId: "thread-a",
      turnId: "turn-a",
      numTurns: 1,
    });

    assert.strictEqual(response.thread.id, "thread-a");
    assert.deepEqual(events, [
      "lane:thread-a",
      "drain:thread-a",
      "prepare:turn-a",
      "request:thread-a:thread/rollback:1",
      "commit:thread-a",
    ]);
  }),
);

it.effect("rejects a mismatched response before committing canonical state", () =>
  Effect.gen(function* () {
    let commits = 0;
    const events: string[] = [];
    const commands = yield* make({
      prepareLatestForEdit: (input) =>
        Effect.succeed({
          threadId: input.threadId,
          request: { threadId: input.threadId, numTurns: input.numTurns },
          state: {},
        }),
      commit: (_prepared, response) =>
        Effect.sync(() => {
          commits += 1;
          return response;
        }),
    }).pipe(
      Effect.provideService(
        CodexGateway,
        makeGateway((() =>
          Effect.succeed({
            thread: { id: "thread-other" },
          } as never)) as CodexGateway["Service"]["requestForThread"]),
      ),
      Effect.provideService(CodexOwnerNotificationDrainRuntime, ownerDrain(events)),
      Effect.provideService(ConversationRuntimeMap, conversationLane(events)),
    );

    const exit = yield* Effect.exit(
      commands.rollbackLatestForEdit({
        threadId: "thread-a",
        turnId: "turn-a",
        numTurns: 1,
      }),
    );

    assert.isTrue(exit._tag === "Failure");
    assert.strictEqual(commits, 0);
  }),
);
