import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import type { CodexRuntimeError } from "../codex-runtime/CodexRuntimeError";
import {
  CodexConversationProjection,
  type CodexConversationProjectionError,
} from "./CodexConversationProjection";

export type CodexContextCompactionSource = "automatic" | "manual";

export class CodexManualCompactionClosedError extends Schema.TaggedError<CodexManualCompactionClosedError>()(
  "CodexManualCompactionClosedError",
  { threadId: Schema.String },
) {}

export type CodexManualCompactionError =
  | CodexRuntimeError
  | CodexConversationProjectionError
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

export const live: Layer.Layer<
  CodexManualCompactionRuntime,
  never,
  CodexConversationProjection | CodexGateway
> = Layer.effect(
  CodexManualCompactionRuntime,
  Effect.gen(function* () {
    const gateway = yield* CodexGateway;
    const projection = yield* CodexConversationProjection;
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
    ) {
      if (decrement(threadId) !== 0) return;
      const observedAtMs = yield* Clock.currentTimeMillis;
      yield* projection.rollbackManualCompaction({ threadId, observedAtMs });
    });

    const start = Effect.fn("CodexManualCompactionRuntime.start")(function* (threadId: string) {
      let registered = false;
      const operation = Effect.gen(function* () {
        const observedAtMs = yield* Clock.currentTimeMillis;
        if (!accepting) return yield* new CodexManualCompactionClosedError({ threadId });
        pendingCounts.set(threadId, (pendingCounts.get(threadId) ?? 0) + 1);
        registered = true;
        yield* projection.admitManualCompaction({ threadId, observedAtMs });
        yield* gateway.requestForThread(threadId, "thread/compact/start", { threadId });
      });

      return yield* operation.pipe(
        Effect.onExit((exit) =>
          registered && Exit.isFailure(exit) ? rollback(threadId) : Effect.void,
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
