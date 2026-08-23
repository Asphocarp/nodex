import * as Context from "effect/Context";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FiberHandle from "effect/FiberHandle";
import type * as Scope from "effect/Scope";
import {
  CODEX_COMMAND_OUTPUT_FLUSH_INTERVAL_MS,
  CODEX_COMMAND_OUTPUT_MAX_BUFFERED_CHARS,
  type CodexCommandOutputUpdate,
} from "../../shared/codex-conversation-state/codex-command-output-queue";
import {
  CODEX_FRAME_TEXT_DELTA_FALLBACK_INTERVAL_MS,
  type CodexFrameTextDeltaUpdate,
} from "../../shared/codex-conversation-state/codex-frame-text-delta-queue";
import { CodexRendererConversationRegistry } from "./CodexRendererConversationRegistry";
import { ConversationRuntimeMap } from "./ConversationRuntimeMap";

export interface CodexConversationDeltaBufferRuntimeOptions {
  readonly frameFlushInterval?: Duration.Input;
  readonly outputFlushInterval?: Duration.Input;
  readonly maxBufferedOutputChars?: number;
}

export class CodexConversationDeltaBufferRuntime extends Context.Service<
  CodexConversationDeltaBufferRuntime,
  {
    readonly enqueueFrameText: (update: CodexFrameTextDeltaUpdate) => void;
    readonly enqueueCommandOutput: (update: CodexCommandOutputUpdate) => void;
    readonly drainFrameText: (conversationId: string) => void;
    readonly clear: (conversationId: string) => void;
  }
>()("nodex/main/codex-application/CodexConversationDeltaBufferRuntime") {}

export const make = (
  options: CodexConversationDeltaBufferRuntimeOptions = {},
): Effect.Effect<
  CodexConversationDeltaBufferRuntime["Service"],
  never,
  ConversationRuntimeMap | CodexRendererConversationRegistry | Scope.Scope
> =>
  Effect.gen(function* () {
    const conversations = yield* ConversationRuntimeMap;
    const rendererRegistry = yield* CodexRendererConversationRegistry;
    const frameFlush = yield* FiberHandle.make<void, never>();
    const outputFlush = yield* FiberHandle.make<void, never>();
    const runFrameFlush = yield* FiberHandle.runtime(frameFlush)();
    const runOutputFlush = yield* FiberHandle.runtime(outputFlush)();
    const pendingFrameThreads = new Set<string>();
    const pendingOutputThreads = new Set<string>();
    const maxBufferedOutputChars =
      options.maxBufferedOutputChars ?? CODEX_COMMAND_OUTPUT_MAX_BUFFERED_CHARS;

    const flushFrameThread = (threadId: string): void => {
      pendingFrameThreads.delete(threadId);
      const aggregate = conversations.currentConversation(threadId);
      if (!aggregate) return;
      const updates = aggregate.takeBufferedFrameTextDeltas();
      if (updates.length === 0) return;
      const outcomes = aggregate.commitFrameTextDeltas({
        updates,
        observedAtMs: Date.now(),
        projectReplica: !rendererRegistry.hasOwner(threadId),
      });
      for (const outcome of outcomes) {
        if (outcome.disposition === "applied") continue;
        runFrameFlush(
          Effect.logWarning("Skipping frame-text delta at canonical raw boundary").pipe(
            Effect.annotateLogs({
              threadId,
              turnId: outcome.update.turnId,
              itemId: outcome.update.itemId,
              target: outcome.update.target.type,
              disposition: outcome.disposition,
            }),
          ),
        );
      }
    };

    const flushFrameText = (): void => {
      for (const threadId of [...pendingFrameThreads]) flushFrameThread(threadId);
    };

    const flushCommandOutput = (): void => {
      const threadIds = [...pendingOutputThreads];
      pendingOutputThreads.clear();
      for (const threadId of threadIds) {
        const aggregate = conversations.currentConversation(threadId);
        if (!aggregate) continue;
        const updates = aggregate.takeBufferedCommandOutputDeltas();
        if (updates.length === 0) continue;
        aggregate.commitCommandOutputDeltas({
          updates,
          observedAtMs: Date.now(),
          projectReplica: !rendererRegistry.hasOwner(threadId),
        });
      }
    };

    const scheduleFrameFlush = (): void => {
      runFrameFlush(
        Effect.sleep(
          options.frameFlushInterval ?? CODEX_FRAME_TEXT_DELTA_FALLBACK_INTERVAL_MS,
        ).pipe(Effect.andThen(Effect.sync(flushFrameText))),
      );
    };

    const scheduleOutputFlush = (): void => {
      runOutputFlush(
        Effect.sleep(options.outputFlushInterval ?? CODEX_COMMAND_OUTPUT_FLUSH_INTERVAL_MS).pipe(
          Effect.andThen(Effect.sync(flushCommandOutput)),
        ),
      );
    };

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        for (const threadId of pendingFrameThreads) {
          conversations.currentConversation(threadId)?.clearBufferedDeltas();
        }
        for (const threadId of pendingOutputThreads) {
          conversations.currentConversation(threadId)?.clearBufferedDeltas();
        }
        pendingFrameThreads.clear();
        pendingOutputThreads.clear();
      }),
    );

    return CodexConversationDeltaBufferRuntime.of({
      enqueueFrameText: (update) => {
        const aggregate = conversations.conversation(update.conversationId);
        aggregate.bufferFrameTextDelta(update);
        const shouldSchedule = pendingFrameThreads.size === 0;
        pendingFrameThreads.add(update.conversationId);
        if (shouldSchedule) scheduleFrameFlush();
      },
      enqueueCommandOutput: (update) => {
        const aggregate = conversations.conversation(update.conversationId);
        aggregate.bufferCommandOutputDelta(update, maxBufferedOutputChars);
        const shouldSchedule = pendingOutputThreads.size === 0;
        pendingOutputThreads.add(update.conversationId);
        if (shouldSchedule) scheduleOutputFlush();
      },
      drainFrameText: (conversationId) => {
        flushFrameThread(conversationId);
        if (pendingFrameThreads.size === 0) runFrameFlush(Effect.void);
      },
      clear: (conversationId) => {
        conversations.currentConversation(conversationId)?.clearBufferedDeltas();
        pendingFrameThreads.delete(conversationId);
        pendingOutputThreads.delete(conversationId);
        if (pendingFrameThreads.size === 0) runFrameFlush(Effect.void);
        if (pendingOutputThreads.size === 0) runOutputFlush(Effect.void);
      },
    });
  });
