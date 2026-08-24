import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import { assert, it } from "@effect/vitest";
import {
  ProjectWorkspace,
  type DesktopProjectWorkspaceThread,
  type ProjectWorkspaceService,
} from "../project-application/ProjectWorkspace";
import { CodexApplicationEventHub, make as makeEventHub } from "./CodexApplicationEventHub";
import {
  CodexRendererConversationRegistry,
  make as makeCodexRendererConversationRegistry,
} from "./CodexRendererConversationRegistry";
import { make } from "./CodexThreadReadState";
import {
  ConversationEntityMap,
  live as conversationRuntimeMapLive,
} from "./internal/ConversationEntityMap";

const buildRuntime = Effect.fn("CodexThreadReadStateTest.buildRuntime")(function* (
  workspace: ProjectWorkspaceService,
) {
  const scope = yield* Scope.make();
  const conversationsContext = yield* Layer.buildWithScope(conversationRuntimeMapLive, scope);
  const conversations = Context.get(conversationsContext, ConversationEntityMap);
  const events = yield* makeEventHub.pipe(Effect.provideService(Scope.Scope, scope));
  const rendererConversations = yield* makeCodexRendererConversationRegistry().pipe(
    Effect.provideService(Scope.Scope, scope),
  );
  const readState = yield* make.pipe(
    Effect.provideService(CodexApplicationEventHub, events),
    Effect.provideService(CodexRendererConversationRegistry, rendererConversations),
    Effect.provideService(ConversationEntityMap, conversations),
    Effect.provideService(ProjectWorkspace, ProjectWorkspace.of(workspace)),
    Effect.provideService(Scope.Scope, scope),
  );
  return { scope, conversations, events, readState };
});

it.effect(
  "commits durable Workspace state and the canonical aggregate through one capability",
  () =>
    Effect.gen(function* () {
      let workspaceUnread = true;
      const workspaceThread = () =>
        ({
          threadId: "thread-a",
          archived: false,
          hasUnreadTurn: workspaceUnread,
        }) as DesktopProjectWorkspaceThread;
      const runtime = yield* buildRuntime({
        getThread: () => Effect.succeed(workspaceThread()),
        setThreadUnread: (_threadId: string, hasUnreadTurn: boolean) => {
          workspaceUnread = hasUnreadTurn;
          return Effect.succeed(workspaceThread());
        },
      } as unknown as ProjectWorkspaceService);
      const aggregate = runtime.conversations.entity("thread-a");
      aggregate.seedHasUnreadTurn(true);
      const published = yield* Stream.runHead(runtime.events.events).pipe(
        Effect.forkIn(runtime.scope, { startImmediately: true }),
      );

      assert.isTrue(yield* runtime.readState.set({ threadId: "thread-a", hasUnreadTurn: false }));
      assert.isFalse(workspaceUnread);
      assert.isFalse(aggregate.readHasUnreadTurn());
      const event = yield* Fiber.join(published);
      assert.isTrue(Option.isSome(event));
      if (Option.isSome(event)) {
        assert.strictEqual(event.value.kind, "hostMessage");
        if (event.value.kind === "hostMessage") {
          assert.strictEqual(event.value.value.type, "threadReadStateChanged");
        }
      }
      yield* Scope.close(runtime.scope, Exit.void);
    }),
);

it.effect("persists reducer commits from the typed application event path", () =>
  Effect.gen(function* () {
    const writes: boolean[] = [];
    const runtime = yield* buildRuntime({
      getThread: () => Effect.succeed(null),
      setThreadUnread: (_threadId: string, hasUnreadTurn: boolean) => {
        writes.push(hasUnreadTurn);
        return Effect.succeed({ hasUnreadTurn } as DesktopProjectWorkspaceThread);
      },
    } as unknown as ProjectWorkspaceService);

    runtime.events.publish({
      kind: "conversationReadStateCommitted",
      value: { threadId: "thread-a", hasUnreadTurn: true },
    });
    for (let attempt = 0; attempt < 100 && writes.length === 0; attempt += 1) {
      yield* Effect.yieldNow;
    }
    assert.deepEqual(writes, [true]);
    yield* Scope.close(runtime.scope, Exit.void);
  }),
);
