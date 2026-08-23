import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { assert, it } from "@effect/vitest";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import type { CodexConversationSnapshot } from "../../shared/types";
import { CodexConversationProjection } from "./CodexConversationProjection";
import { CodexOwnerNotificationDrainRuntime } from "./CodexOwnerNotificationDrainRuntime";
import { CodexThreadDirectory } from "./CodexThreadDirectory";
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
    runExclusive: (threadId, operation) =>
      Effect.sync(() => events.push(`lane:${threadId}`)).pipe(Effect.andThen(operation)),
    markAllNeedsResume: conversations.markAllNeedsResume,
    close: () => Effect.void,
  });
};

const editableSnapshot = {
  cwd: "/repo",
  turns: [
    {
      turnId: "turn-a",
      status: "completed",
      items: [{ turnId: "turn-a", semanticKind: "userMessage", kind: "userMessage" }],
    },
  ],
} as unknown as CodexConversationSnapshot;

const projection = CodexConversationProjection.of({
  read: () => Effect.succeed({ canonical: {} as never, snapshot: editableSnapshot }),
} as unknown as CodexConversationProjection["Service"]);

it.effect("runs owner drain, validation, Gateway, and projection commit in the Thread lane", () =>
  Effect.gen(function* () {
    const events: string[] = [];
    const directory = CodexThreadDirectory.of({
      acceptRollbackResult: ({ expectedThreadId }: { readonly expectedThreadId: string }) =>
        Effect.sync(() => {
          events.push(`commit:${expectedThreadId}`);
          return {} as never;
        }),
      acceptForkResult: () => Effect.die("unused"),
      observeMetadata: () => Effect.die("unused"),
      acceptSessionStart: () => Effect.die("unused"),
    } as unknown as CodexThreadDirectory["Service"]);
    const commands = yield* make.pipe(
      Effect.provideService(
        CodexGateway,
        makeGateway(((threadId, method, params) =>
          Effect.sync(() => {
            const rollback = params as { readonly numTurns: number };
            events.push(`request:${threadId}:${method}:${rollback.numTurns}`);
            return { thread: { id: threadId } } as never;
          })) as CodexGateway["Service"]["requestForThread"]),
      ),
      Effect.provideService(CodexConversationProjection, projection),
      Effect.provideService(CodexThreadDirectory, directory),
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
      "request:thread-a:thread/rollback:1",
      "commit:thread-a",
    ]);
  }),
);

it.effect("rejects a mismatched response before committing canonical state", () =>
  Effect.gen(function* () {
    let commits = 0;
    const events: string[] = [];
    const directory = CodexThreadDirectory.of({
      acceptRollbackResult: () =>
        Effect.sync(() => {
          commits += 1;
          return {} as never;
        }),
      acceptForkResult: () => Effect.die("unused"),
      observeMetadata: () => Effect.die("unused"),
      acceptSessionStart: () => Effect.die("unused"),
    } as unknown as CodexThreadDirectory["Service"]);
    const commands = yield* make.pipe(
      Effect.provideService(
        CodexGateway,
        makeGateway((() =>
          Effect.succeed({
            thread: { id: "thread-other" },
          } as never)) as CodexGateway["Service"]["requestForThread"]),
      ),
      Effect.provideService(CodexConversationProjection, projection),
      Effect.provideService(CodexThreadDirectory, directory),
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
