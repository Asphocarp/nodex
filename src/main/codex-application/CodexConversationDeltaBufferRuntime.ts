import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
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
import { ConversationEntityMap } from "./internal/ConversationEntityMap";

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
    readonly drainFrameText: (conversationId: string, observedAtMs: number) => void;
    readonly clear: (conversationId: string) => void;
  }
>()("nodex/main/codex-application/CodexConversationDeltaBufferRuntime") {}

export const make = (
  options: CodexConversationDeltaBufferRuntimeOptions = {},
): Effect.Effect<
  CodexConversationDeltaBufferRuntime["Service"],
  never,
  ConversationEntityMap | CodexRendererConversationRegistry | Scope.Scope
> =>
  Effect.gen(function* () {
    const conversations = yield* ConversationEntityMap;
    const rendererRegistry = yield* CodexRendererConversationRegistry;
    const frameFlush = yield* FiberHandle.make<void, never>();
    const outputFlush = yield* FiberHandle.make<void, never>();
    const runFrameFlush = yield* FiberHandle.runtime(frameFlush)();
    const runOutputFlush = yield* FiberHandle.runtime(outputFlush)();
    const pendingFrameThreads = new Set<string>();
    const pendingOutputThreads = new Set<string>();
    const maxBufferedOutputChars =
      options.maxBufferedOutputChars ?? CODEX_COMMAND_OUTPUT_MAX_BUFFERED_CHARS;

    const flushFrameThread = (threadId: string, observedAtMs: number): void => {
      pendingFrameThreads.delete(threadId);
      const aggregate = conversations.current(threadId);
      if (!aggregate) return;
      const updates = aggregate.takeBufferedFrameTextDeltas();
      if (updates.length === 0) return;
      const outcomes = aggregate.commitFrameTextDeltas({
        updates,
        observedAtMs,
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

    const flushFrameText = Clock.currentTimeMillis.pipe(
      Effect.flatMap((observedAtMs) =>
        Effect.sync(() => {
          for (const threadId of [...pendingFrameThreads]) {
            flushFrameThread(threadId, observedAtMs);
          }
        }),
      ),
    );

    const flushCommandOutput = Clock.currentTimeMillis.pipe(
      Effect.flatMap((observedAtMs) =>
        Effect.sync(() => {
          const threadIds = [...pendingOutputThreads];
          pendingOutputThreads.clear();
          for (const threadId of threadIds) {
            const aggregate = conversations.current(threadId);
            if (!aggregate) continue;
            const updates = aggregate.takeBufferedCommandOutputDeltas();
            if (updates.length === 0) continue;
            aggregate.commitCommandOutputDeltas({
              updates,
              observedAtMs,
              projectReplica: !rendererRegistry.hasOwner(threadId),
            });
          }
        }),
      ),
    );

    const scheduleFrameFlush = (): void => {
      runFrameFlush(
        Effect.sleep(
          options.frameFlushInterval ?? CODEX_FRAME_TEXT_DELTA_FALLBACK_INTERVAL_MS,
        ).pipe(Effect.andThen(flushFrameText)),
      );
    };

    const scheduleOutputFlush = (): void => {
      runOutputFlush(
        Effect.sleep(options.outputFlushInterval ?? CODEX_COMMAND_OUTPUT_FLUSH_INTERVAL_MS).pipe(
          Effect.andThen(flushCommandOutput),
        ),
      );
    };

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        for (const threadId of pendingFrameThreads) {
          conversations.current(threadId)?.clearBufferedDeltas();
        }
        for (const threadId of pendingOutputThreads) {
          conversations.current(threadId)?.clearBufferedDeltas();
        }
        pendingFrameThreads.clear();
        pendingOutputThreads.clear();
      }),
    );

    return CodexConversationDeltaBufferRuntime.of({
      enqueueFrameText: (update) => {
        const aggregate = conversations.entity(update.conversationId);
        aggregate.bufferFrameTextDelta(update);
        const shouldSchedule = pendingFrameThreads.size === 0;
        pendingFrameThreads.add(update.conversationId);
        if (shouldSchedule) scheduleFrameFlush();
      },
      enqueueCommandOutput: (update) => {
        const aggregate = conversations.entity(update.conversationId);
        aggregate.bufferCommandOutputDelta(update, maxBufferedOutputChars);
        const shouldSchedule = pendingOutputThreads.size === 0;
        pendingOutputThreads.add(update.conversationId);
        if (shouldSchedule) scheduleOutputFlush();
      },
      drainFrameText: (conversationId, observedAtMs) => {
        flushFrameThread(conversationId, observedAtMs);
        if (pendingFrameThreads.size === 0) runFrameFlush(Effect.void);
      },
      clear: (conversationId) => {
        conversations.current(conversationId)?.clearBufferedDeltas();
        pendingFrameThreads.delete(conversationId);
        pendingOutputThreads.delete(conversationId);
        if (pendingFrameThreads.size === 0) runFrameFlush(Effect.void);
        if (pendingOutputThreads.size === 0) runOutputFlush(Effect.void);
      },
    });
  });
