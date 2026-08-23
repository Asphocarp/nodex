import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FiberMap from "effect/FiberMap";
import * as FiberSet from "effect/FiberSet";
import * as Option from "effect/Option";
import type * as Scope from "effect/Scope";
import type { CodexConversationSnapshot } from "../../shared/types";

export interface CodexConversationHistoryLoadInput {
  readonly threadId: string;
  readonly loadCompleteHistory: boolean;
  readonly broadcastResult: boolean;
}

export class CodexConversationHistoryError extends Data.TaggedError(
  "CodexConversationHistoryError",
)<{
  readonly cause: unknown;
}> {}

export interface CodexConversationHistoryRuntimeOptions {
  readonly shouldLoadRemaining: (threadId: string) => boolean;
  readonly load: (
    input: CodexConversationHistoryLoadInput,
  ) => Effect.Effect<void, CodexConversationHistoryError>;
  readonly snapshot: (
    threadId: string,
  ) => Effect.Effect<CodexConversationSnapshot | null, CodexConversationHistoryError>;
}

export class CodexConversationHistoryRuntime extends Context.Service<
  CodexConversationHistoryRuntime,
  {
    readonly loadPage: (
      threadId: string,
    ) => Effect.Effect<CodexConversationSnapshot | null, CodexConversationHistoryError>;
    readonly loadComplete: (
      threadId: string,
      broadcastResult: boolean,
    ) => Effect.Effect<CodexConversationSnapshot | null, CodexConversationHistoryError>;
    readonly requestRemaining: (threadId: string) => void;
    readonly clear: (threadId: string) => void;
  }
>()("nodex/main/codex-application/CodexConversationHistoryRuntime") {}

export const make = (
  options: CodexConversationHistoryRuntimeOptions,
): Effect.Effect<CodexConversationHistoryRuntime["Service"], never, Scope.Scope> =>
  Effect.gen(function* () {
    const loads = yield* FiberMap.make<string, void, CodexConversationHistoryError>();
    const runLoad = yield* FiberMap.runtime(loads)();
    const runBackground = yield* FiberSet.makeRuntime<never, void, never>();
    const active = new Map<
      string,
      { readonly token: object; readonly loadCompleteHistory: boolean }
    >();

    const load = (
      input: CodexConversationHistoryLoadInput,
    ): Effect.Effect<void, CodexConversationHistoryError> =>
      Effect.suspend(() => {
        const existing = FiberMap.getUnsafe(loads, input.threadId);
        if (Option.isSome(existing)) {
          const existingLoadsCompleteHistory =
            active.get(input.threadId)?.loadCompleteHistory === true;
          return Fiber.join(existing.value).pipe(
            Effect.andThen(
              input.loadCompleteHistory && !existingLoadsCompleteHistory
                ? load(input)
                : Effect.void,
            ),
          );
        }

        const token = {};
        active.set(input.threadId, {
          token,
          loadCompleteHistory: input.loadCompleteHistory,
        });
        const physical = options.load(input).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              if (active.get(input.threadId)?.token === token) active.delete(input.threadId);
            }),
          ),
        );
        return Fiber.join(runLoad(input.threadId, physical));
      });

    const requestRemaining = (threadId: string): void => {
      if (!options.shouldLoadRemaining(threadId)) return;
      runBackground(
        load({ threadId, loadCompleteHistory: true, broadcastResult: true }).pipe(
          Effect.catch((error) =>
            Effect.logWarning("Could not load remaining Thread history after resume").pipe(
              Effect.annotateLogs({ threadId, error: String(error.cause) }),
            ),
          ),
        ),
      );
    };

    const clear = (threadId: string): void => {
      active.delete(threadId);
      runLoad(threadId, Effect.void);
    };

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        active.clear();
      }),
    );

    return CodexConversationHistoryRuntime.of({
      loadPage: (threadId) =>
        load({ threadId, loadCompleteHistory: false, broadcastResult: true }).pipe(
          Effect.andThen(options.snapshot(threadId)),
        ),
      loadComplete: (threadId, broadcastResult) =>
        load({ threadId, loadCompleteHistory: true, broadcastResult }).pipe(
          Effect.andThen(options.snapshot(threadId)),
        ),
      requestRemaining,
      clear,
    });
  });
