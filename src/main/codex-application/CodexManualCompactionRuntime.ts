import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type { CodexCanonicalConversationState } from "../../shared/types";
import { CODEX_PENDING_MANUAL_CONTEXT_COMPACTION_ITEM_ID } from "../../shared/codex-conversation-state/codex-conversation-reducer";
import {
  appendCodexCanonicalInProgressSyntheticItem,
  removeCodexCanonicalLocalSyntheticItem,
  type CodexCanonicalContextCompactionItem,
} from "../../shared/codex-conversation-state/codex-conversation-state";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import type { CodexRuntimeError } from "../codex-runtime/CodexRuntimeError";

export interface CodexManualCompactionProjectionPort {
  readonly read: (threadId: string) => CodexCanonicalConversationState | null;
  readonly commit: (input: {
    readonly threadId: string;
    readonly before: CodexCanonicalConversationState;
    readonly after: CodexCanonicalConversationState;
    readonly observedAtMs: number;
  }) => void;
  readonly publish: (threadId: string, turnId: string | null) => void;
}

export type CodexContextCompactionSource = "automatic" | "manual";

export class CodexManualCompactionProjectionError extends Schema.TaggedError<CodexManualCompactionProjectionError>()(
  "CodexManualCompactionProjectionError",
  {
    operation: Schema.Literals(["admit", "rollback"]),
    threadId: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export class CodexManualCompactionClosedError extends Schema.TaggedError<CodexManualCompactionClosedError>()(
  "CodexManualCompactionClosedError",
  { threadId: Schema.String },
) {}

export type CodexManualCompactionError =
  | CodexRuntimeError
  | CodexManualCompactionProjectionError
  | CodexManualCompactionClosedError;

export class CodexManualCompactionRuntime extends Context.Service<
  CodexManualCompactionRuntime,
  {
    readonly start: (threadId: string) => Effect.Effect<void, CodexManualCompactionError>;
    /** Synchronous projection seam used by the still-pure canonical reducer. */
    readonly consumeSource: (threadId: string) => CodexContextCompactionSource;
    readonly clear: (threadId: string) => void;
  }
>()("nodex/main/codex-application/CodexManualCompactionRuntime") {}

const pendingPlaceholder: CodexCanonicalContextCompactionItem = {
  type: "contextCompaction",
  id: CODEX_PENDING_MANUAL_CONTEXT_COMPACTION_ITEM_ID,
  completed: false,
  source: "manual",
};

const resolvePendingTurnId = (state: CodexCanonicalConversationState): string | null => {
  const turnIndex = state.turns.findLastIndex((turn) =>
    turn.items.some((item) => item.id === pendingPlaceholder.id),
  );
  return state.turns[turnIndex]?.protocol.id ?? null;
};

export const live = (
  projection: CodexManualCompactionProjectionPort,
): Layer.Layer<CodexManualCompactionRuntime, never, CodexGateway> =>
  Layer.effect(
    CodexManualCompactionRuntime,
    Effect.gen(function* () {
      const gateway = yield* CodexGateway;
      const pendingCounts = new Map<string, number>();
      let accepting = true;

      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          accepting = false;
          pendingCounts.clear();
        }),
      );

      const decrement = (threadId: string): number => {
        const pendingCount = pendingCounts.get(threadId) ?? 0;
        if (pendingCount <= 1) {
          pendingCounts.delete(threadId);
          return 0;
        }
        const next = pendingCount - 1;
        pendingCounts.set(threadId, next);
        return next;
      };

      const rollback = Effect.fn("CodexManualCompactionRuntime.rollback")(function* (
        threadId: string,
        turnId: string | null,
      ) {
        if (decrement(threadId) !== 0) return;
        const observedAtMs = yield* Clock.currentTimeMillis;
        yield* Effect.try({
          try: () => {
            const current = projection.read(threadId);
            if (!current) return;
            const after = removeCodexCanonicalLocalSyntheticItem(
              current,
              CODEX_PENDING_MANUAL_CONTEXT_COMPACTION_ITEM_ID,
            );
            projection.commit({ threadId, before: current, after, observedAtMs });
            projection.publish(threadId, turnId);
          },
          catch: (cause) =>
            new CodexManualCompactionProjectionError({
              operation: "rollback",
              threadId,
              cause,
            }),
        });
      });

      const start = Effect.fn("CodexManualCompactionRuntime.start")(function* (threadId: string) {
        let registered = false;
        let pendingTurnId: string | null = null;
        const operation = Effect.gen(function* () {
          const observedAtMs = yield* Clock.currentTimeMillis;
          yield* Effect.try({
            try: () => {
              if (!accepting) throw new CodexManualCompactionClosedError({ threadId });
              const before = projection.read(threadId);
              if (!before) {
                throw new Error(
                  `Cannot compact '${threadId}' before canonical conversation state is loaded`,
                );
              }
              pendingCounts.set(threadId, (pendingCounts.get(threadId) ?? 0) + 1);
              registered = true;
              const after = appendCodexCanonicalInProgressSyntheticItem(
                before,
                pendingPlaceholder,
                observedAtMs,
              );
              pendingTurnId = resolvePendingTurnId(after);
              projection.commit({ threadId, before, after, observedAtMs });
              projection.publish(threadId, pendingTurnId);
            },
            catch: (cause) => {
              if (cause instanceof CodexManualCompactionClosedError) return cause;
              return new CodexManualCompactionProjectionError({
                operation: "admit",
                threadId,
                cause,
              });
            },
          });
          yield* gateway.requestForThread(threadId, "thread/compact/start", { threadId });
        });

        return yield* operation.pipe(
          Effect.onExit((exit) =>
            registered && Exit.isFailure(exit) ? rollback(threadId, pendingTurnId) : Effect.void,
          ),
        );
      });

      return CodexManualCompactionRuntime.of({
        start,
        consumeSource: (threadId) => {
          if ((pendingCounts.get(threadId) ?? 0) === 0) return "automatic";
          decrement(threadId);
          return "manual";
        },
        clear: (threadId) => pendingCounts.delete(threadId),
      });
    }),
  );
