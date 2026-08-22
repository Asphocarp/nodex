import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { assert, it } from "@effect/vitest";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import {
  ConversationRuntimeMap,
  live as conversationRuntimeMapLive,
} from "./ConversationRuntimeMap";
import { ConversationCommands, live as conversationCommandsLive } from "./ConversationCommands";

it.effect("routes direct thread operations and drains background-terminal pages", () =>
  Effect.gen(function* () {
    const requests: Array<{
      readonly scope: "local" | "thread";
      readonly method: string;
      readonly params: unknown;
    }> = [];
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
      conversationCommandsLive.pipe(
        Layer.provide(
          Layer.merge(
            Layer.succeed(CodexGateway, gateway),
            Layer.succeed(
              ConversationRuntimeMap,
              Context.get(runtimeContext, ConversationRuntimeMap),
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

    yield* Scope.close(scope, Exit.void);
  }),
);
