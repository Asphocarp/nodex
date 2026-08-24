import { assert, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as TestClock from "effect/testing/TestClock";
import type { CodexFrameTextDeltaUpdate } from "../../shared/codex-conversation-state/codex-frame-text-delta-queue";
import {
  CodexConversationDeltaBufferRuntime,
  make,
  type CodexConversationDeltaBufferRuntimeOptions,
} from "./CodexConversationDeltaBufferRuntime";
import {
  CodexRendererConversationRegistry,
  makeCodexRendererConversationRegistryState,
} from "./CodexRendererConversationRegistry";
import {
  ConversationRuntimeMap,
  live as conversationRuntimeMapLive,
} from "./ConversationRuntimeMap";

const frame = (delta: string): CodexFrameTextDeltaUpdate => ({
  conversationId: "thread-1",
  turnId: "turn-1",
  itemId: "item-1",
  target: { type: "agentMessage" },
  delta,
});

const withRuntime = <A, E>(
  use: (
    runtime: CodexConversationDeltaBufferRuntime["Service"],
    conversations: ConversationRuntimeMap["Service"],
  ) => Effect.Effect<A, E>,
  options: CodexConversationDeltaBufferRuntimeOptions = {},
): Effect.Effect<A, E, Scope.Scope> =>
  Effect.gen(function* () {
    const ownerScope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(conversationRuntimeMapLive, ownerScope);
    const conversations = Context.get(context, ConversationRuntimeMap);
    const runtime = yield* make(options).pipe(
      Effect.provideService(ConversationRuntimeMap, conversations),
      Effect.provideService(
        CodexRendererConversationRegistry,
        makeCodexRendererConversationRegistryState(),
      ),
    );
    const result = yield* use(runtime, conversations);
    yield* Scope.close(ownerScope, Exit.void);
    return result;
  });

it.effect("drains one Thread synchronously and keeps another Thread scheduled", () =>
  withRuntime((runtime, conversations) =>
    Effect.gen(function* () {
      runtime.enqueueFrameText(frame("a"));
      runtime.enqueueFrameText({ ...frame("b"), conversationId: "thread-2" });
      runtime.drainFrameText("thread-1", 1_000);
      assert.isFalse(conversations.conversation("thread-1").hasBufferedFrameTextDeltas());
      assert.isTrue(conversations.conversation("thread-2").hasBufferedFrameTextDeltas());
      yield* TestClock.adjust("20 millis");
      assert.isFalse(conversations.conversation("thread-2").hasBufferedFrameTextDeltas());
    }),
  ),
);

it.effect("clear removes the aggregate-owned buffer before its timer fires", () =>
  withRuntime((runtime, conversations) =>
    Effect.gen(function* () {
      runtime.enqueueFrameText(frame("discard"));
      runtime.clear("thread-1");
      yield* TestClock.adjust("1 second");
      assert.isFalse(conversations.conversation("thread-1").hasBufferedFrameTextDeltas());
    }),
  ),
);
