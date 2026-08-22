import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FiberHandle from "effect/FiberHandle";
import * as Queue from "effect/Queue";
import type * as Scope from "effect/Scope";
import {
  CODEX_COMMAND_OUTPUT_FLUSH_INTERVAL_MS,
  CODEX_COMMAND_OUTPUT_MAX_BUFFERED_CHARS,
  appendCodexCommandOutputTail,
  buildCodexCommandOutputKey,
  type CodexCommandOutputUpdate,
} from "../../shared/codex-conversation-state/codex-command-output-queue";
import {
  CODEX_FRAME_TEXT_DELTA_FALLBACK_INTERVAL_MS,
  buildCodexFrameTextDeltaKey,
  type CodexFrameTextDeltaUpdate,
} from "../../shared/codex-conversation-state/codex-frame-text-delta-queue";

export interface CodexConversationDeltaBufferRuntimeOptions {
  readonly flushFrameText: (updates: readonly CodexFrameTextDeltaUpdate[]) => void;
  readonly flushCommandOutput: (updates: readonly CodexCommandOutputUpdate[]) => void;
  readonly frameFlushInterval?: Duration.Input;
  readonly outputFlushInterval?: Duration.Input;
  readonly maxBufferedOutputChars?: number;
}

export class CodexConversationDeltaBufferRuntime extends Context.Service<
  CodexConversationDeltaBufferRuntime,
  {
    readonly enqueueFrameText: (update: CodexFrameTextDeltaUpdate) => void;
    readonly enqueueCommandOutput: (update: CodexCommandOutputUpdate) => void;
    readonly drainFrameText: (conversationId: string) => Effect.Effect<void>;
    readonly clear: (conversationId: string) => void;
  }
>()("nodex/main/codex-application/CodexConversationDeltaBufferRuntime") {}

type BufferCommand =
  | { readonly _tag: "EnqueueFrameText"; readonly update: CodexFrameTextDeltaUpdate }
  | { readonly _tag: "EnqueueCommandOutput"; readonly update: CodexCommandOutputUpdate }
  | { readonly _tag: "FlushFrameText" }
  | { readonly _tag: "FlushCommandOutput" }
  | { readonly _tag: "DrainFrameText"; readonly completion: Deferred.Deferred<void> }
  | { readonly _tag: "Clear"; readonly conversationId: string };

export const make = (
  options: CodexConversationDeltaBufferRuntimeOptions,
): Effect.Effect<CodexConversationDeltaBufferRuntime["Service"], never, Scope.Scope> =>
  Effect.gen(function* () {
    const commands = yield* Queue.unbounded<BufferCommand>();
    const frameText = new Map<string, CodexFrameTextDeltaUpdate>();
    const commandOutput = new Map<string, CodexCommandOutputUpdate>();
    const frameFlush = yield* FiberHandle.make<void, never>();
    const outputFlush = yield* FiberHandle.make<void, never>();
    const maxBufferedOutputChars =
      options.maxBufferedOutputChars ?? CODEX_COMMAND_OUTPUT_MAX_BUFFERED_CHARS;
    let frameFlushScheduled = false;
    let outputFlushScheduled = false;

    const flushFrameText = (): void => {
      if (frameText.size === 0) return;
      const updates = [...frameText.values()];
      frameText.clear();
      options.flushFrameText(updates);
    };

    const flushCommandOutput = (): void => {
      if (commandOutput.size === 0) return;
      const updates = [...commandOutput.values()];
      commandOutput.clear();
      options.flushCommandOutput(updates);
    };

    const scheduleFrameFlush = (): Effect.Effect<void> => {
      if (frameFlushScheduled) return Effect.void;
      frameFlushScheduled = true;
      return FiberHandle.run(
        frameFlush,
        Effect.sleep(
          options.frameFlushInterval ?? CODEX_FRAME_TEXT_DELTA_FALLBACK_INTERVAL_MS,
        ).pipe(
          Effect.andThen(
            Effect.sync(() => {
              Queue.offerUnsafe(commands, { _tag: "FlushFrameText" });
            }),
          ),
        ),
        { startImmediately: true },
      );
    };

    const scheduleOutputFlush = (): Effect.Effect<void> => {
      if (outputFlushScheduled) return Effect.void;
      outputFlushScheduled = true;
      return FiberHandle.run(
        outputFlush,
        Effect.sleep(options.outputFlushInterval ?? CODEX_COMMAND_OUTPUT_FLUSH_INTERVAL_MS).pipe(
          Effect.andThen(
            Effect.sync(() => {
              Queue.offerUnsafe(commands, { _tag: "FlushCommandOutput" });
            }),
          ),
        ),
        { startImmediately: true },
      );
    };

    const handleCommand = (command: BufferCommand): Effect.Effect<void> =>
      Effect.gen(function* () {
        switch (command._tag) {
          case "EnqueueFrameText": {
            const { update } = command;
            const key = buildCodexFrameTextDeltaKey(update);
            const existing = frameText.get(key);
            frameText.set(key, {
              ...update,
              delta: `${existing?.delta ?? ""}${update.delta}`,
            });
            yield* scheduleFrameFlush();
            return;
          }
          case "EnqueueCommandOutput": {
            const { update } = command;
            const key = buildCodexCommandOutputKey(update);
            const existing = commandOutput.get(key);
            const { next } = appendCodexCommandOutputTail({
              current: existing?.delta ?? "",
              delta: update.delta,
              maxChars: maxBufferedOutputChars,
            });
            commandOutput.set(key, { ...update, delta: next });
            yield* scheduleOutputFlush();
            return;
          }
          case "FlushFrameText":
            frameFlushScheduled = false;
            flushFrameText();
            return;
          case "FlushCommandOutput":
            outputFlushScheduled = false;
            flushCommandOutput();
            return;
          case "DrainFrameText":
            frameFlushScheduled = false;
            yield* FiberHandle.clear(frameFlush);
            flushFrameText();
            yield* Deferred.succeed(command.completion, undefined);
            return;
          case "Clear":
            for (const [key, update] of frameText) {
              if (update.conversationId === command.conversationId) frameText.delete(key);
            }
            for (const [key, update] of commandOutput) {
              if (update.conversationId === command.conversationId) commandOutput.delete(key);
            }
            if (frameText.size === 0) {
              frameFlushScheduled = false;
              yield* FiberHandle.clear(frameFlush);
            }
            if (commandOutput.size === 0) {
              outputFlushScheduled = false;
              yield* FiberHandle.clear(outputFlush);
            }
            return;
        }
      });

    yield* Effect.forkScoped(
      Effect.forever(Queue.take(commands).pipe(Effect.flatMap(handleCommand))),
    );
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        frameText.clear();
        commandOutput.clear();
      }).pipe(Effect.andThen(Queue.shutdown(commands)), Effect.asVoid),
    );

    return CodexConversationDeltaBufferRuntime.of({
      enqueueFrameText: (update) => {
        Queue.offerUnsafe(commands, { _tag: "EnqueueFrameText", update });
      },
      enqueueCommandOutput: (update) => {
        Queue.offerUnsafe(commands, { _tag: "EnqueueCommandOutput", update });
      },
      drainFrameText: (_conversationId) =>
        Effect.gen(function* () {
          const completion = yield* Deferred.make<void>();
          Queue.offerUnsafe(commands, { _tag: "DrainFrameText", completion });
          yield* Deferred.await(completion);
        }),
      clear: (conversationId) => {
        Queue.offerUnsafe(commands, { _tag: "Clear", conversationId });
      },
    });
  });

export interface CodexConversationDeltaBufferRuntimePromiseAdapter {
  readonly enqueueFrameText: (update: CodexFrameTextDeltaUpdate) => void;
  readonly enqueueCommandOutput: (update: CodexCommandOutputUpdate) => void;
  readonly drainFrameText: (conversationId: string) => Promise<void>;
  readonly clear: (conversationId: string) => void;
}
