import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { assert, it } from "@effect/vitest";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import { CodexConversationArchive } from "./CodexConversationArchive";
import {
  CodexConversationProjection,
  CodexConversationProjectionError,
} from "./CodexConversationProjection";
import { CodexServerRequestResponses } from "./CodexServerRequestResponses";
import { CodexThreadGoalRuntime } from "./CodexThreadGoalRuntime";
import { ConversationCommands, live } from "./ConversationCommands";
import { ConversationEntityMap } from "./internal/ConversationEntityMap";

it.effect("commits interruption without waking queued work before terminal completion", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const events: string[] = [];
      const backgroundTerminalRequests: unknown[] = [];
      const unsupported = () => Effect.die(new Error("Unsupported test operation"));
      const requestForThread: CodexGateway["Service"]["requestForThread"] = (
        threadId,
        method,
        params,
      ) => {
        events.push(`remote:${method}:${threadId}`);
        if (method === "thread/backgroundTerminals/list") {
          backgroundTerminalRequests.push(params);
          return Effect.succeed({ data: [], nextCursor: null }) as never;
        }
        return Effect.succeed({}) as never;
      };
      const gateway = CodexGateway.of({
        localHostId: "local",
        requestRawOnHost: unsupported,
        requestRawForThread: unsupported,
        events: Stream.empty,
        requestLocal: unsupported,
        requestOnHost: unsupported,
        requestForThread,
        notifyLocal: unsupported,
        connection: unsupported,
        connectionChanges: () => Stream.empty,
        awaitReady: () => Effect.void,
        reconcileHost: unsupported,
        removeHost: unsupported,
        restartHost: unsupported,
      });
      const projection = CodexConversationProjection.of({
        resolveInterruptTurn: (_threadId: string, requestedTurnId?: string) =>
          Effect.sync(() => {
            events.push(`resolve:${requestedTurnId ?? "inferred"}`);
            return requestedTurnId ?? "turn-inferred";
          }),
        commitInterruptedTurn: ({ threadId, turnId }: { threadId: string; turnId: string }) =>
          Effect.sync(() => events.push(`projection:${threadId}:${turnId}`)).pipe(
            Effect.andThen(
              Effect.fail(
                new CodexConversationProjectionError({
                  operation: "commit-interrupted-turn",
                  threadId,
                  cause: new Error("durable projection unavailable"),
                }),
              ),
            ),
          ),
      } as unknown as CodexConversationProjection["Service"]);
      const goals = CodexThreadGoalRuntime.of({
        get: (threadId: string) =>
          Effect.sync(() => {
            events.push(`goal:get:${threadId}`);
            return { status: "active" } as never;
          }),
        set: ({ threadId }: { threadId: string }) =>
          Effect.sync(() => {
            events.push(`goal:pause:${threadId}`);
            return null;
          }),
      } as unknown as CodexThreadGoalRuntime["Service"]);
      const responses = CodexServerRequestResponses.of({
        declineAllInTransaction: (threadId: string) =>
          Effect.sync(() => events.push(`requests:decline:${threadId}`)),
      } as unknown as CodexServerRequestResponses["Service"]);
      const runCommand: ConversationEntityMap["Service"]["runCommand"] = (threadId, operation) =>
        Effect.sync(() => events.push(`lane:${threadId}`)).pipe(Effect.andThen(operation));
      const runtimes = ConversationEntityMap.of({
        runCommand,
      } as unknown as ConversationEntityMap["Service"]);
      const context = yield* Layer.build(
        live.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(
                CodexConversationArchive,
                CodexConversationArchive.of({
                  archive: () => Effect.succeed(true),
                  unarchive: () => Effect.succeed(null),
                }),
              ),
              Layer.succeed(CodexConversationProjection, projection),
              Layer.succeed(CodexGateway, gateway),
              Layer.succeed(CodexServerRequestResponses, responses),
              Layer.succeed(CodexThreadGoalRuntime, goals),
              Layer.succeed(ConversationEntityMap, runtimes),
            ),
          ),
        ),
      );
      const commands = Context.get(context, ConversationCommands);

      assert.isTrue(yield* commands.interrupt("thread-a", "turn-remote-only"));
      assert.deepEqual(events, [
        "lane:thread-a",
        "resolve:turn-remote-only",
        "goal:get:thread-a",
        "goal:pause:thread-a",
        "requests:decline:thread-a",
        "remote:turn/interrupt:thread-a",
        "projection:thread-a:turn-remote-only",
      ]);
      yield* commands.listBackgroundTerminalsPage("thread-a", { cursor: null });
      assert.deepEqual(backgroundTerminalRequests, [{ threadId: "thread-a", cursor: null }]);
      assert.isFalse(Object.hasOwn(backgroundTerminalRequests[0] as object, "limit"));
    }),
  ),
);
