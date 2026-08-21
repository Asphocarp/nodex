import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FiberMap from "effect/FiberMap";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type * as Scope from "effect/Scope";
import type { CodexQueuedFollowUp } from "../../shared/types";
import { CodexConversationProjection } from "./CodexConversationProjection";
import { CodexQueuedFollowUps } from "./CodexQueuedFollowUps";
import { CodexTurnCommands } from "./CodexTurnCommands";

export class CodexQueuedFollowUpDispatchError extends Schema.TaggedError<CodexQueuedFollowUpDispatchError>()(
  "CodexQueuedFollowUpDispatchError",
  {
    threadId: Schema.String,
    followUpId: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export class CodexQueuedFollowUpDispatcher extends Context.Service<
  CodexQueuedFollowUpDispatcher,
  {
    readonly sendNow: (
      threadId: string,
      followUpId: string,
    ) => Effect.Effect<void, CodexQueuedFollowUpDispatchError>;
    readonly cancel: (threadId: string) => Effect.Effect<void>;
  }
>()("nodex/main/codex-application/CodexQueuedFollowUpDispatcher") {}

const reason = (cause: unknown): string => (cause instanceof Error ? cause.message : String(cause));

export const make: Effect.Effect<
  CodexQueuedFollowUpDispatcher["Service"],
  never,
  CodexConversationProjection | CodexQueuedFollowUps | CodexTurnCommands | Scope.Scope
> = Effect.gen(function* () {
  const projection = yield* CodexConversationProjection;
  const queued = yield* CodexQueuedFollowUps;
  const turns = yield* CodexTurnCommands;
  const dispatches = yield* FiberMap.make<string, void, CodexQueuedFollowUpDispatchError>();

  const submit = (
    followUp: CodexQueuedFollowUp,
    activeTurnId: string | null,
  ): Effect.Effect<void, import("./CodexTurnCommands").CodexTurnCommandsError> => {
    if (activeTurnId) {
      return turns
        .steer({
          threadId: followUp.threadId,
          expectedTurnId: activeTurnId,
          prompt: followUp.prompt,
          ...(followUp.promptInput ? { promptInput: followUp.promptInput } : {}),
          collaborationMode: followUp.collaborationMode,
          serviceTier: followUp.serviceTier,
          summary: followUp.summary,
        })
        .pipe(Effect.asVoid);
    }
    return turns
      .start(followUp.threadId, followUp.prompt, {
        collaborationMode: followUp.collaborationMode ?? undefined,
        serviceTier: followUp.serviceTier,
        summary: followUp.summary,
        ...(followUp.promptInput ? { promptInput: followUp.promptInput } : {}),
      })
      .pipe(Effect.asVoid);
  };

  const dispatch = (
    threadId: string,
    followUpId: string | undefined,
    allowActiveTurn: boolean,
  ): Effect.Effect<void, CodexQueuedFollowUpDispatchError> =>
    Effect.gen(function* () {
      const state = yield* projection.read(threadId);
      const activeTurnId =
        state.canonical.turns.findLast((turn) => turn.protocol.status === "inProgress")?.protocol
          .id ?? null;
      if (activeTurnId && !allowActiveTurn) return;
      if (!allowActiveTurn && queued.list(threadId)[0]?.pausedReason) return;
      const claim = yield* queued.claim(threadId, followUpId);
      if (!claim) return;
      yield* submit(claim.followUp, activeTurnId).pipe(
        Effect.tapError((cause) =>
          queued.restore(threadId, claim, reason(cause)).pipe(Effect.asVoid),
        ),
        Effect.onInterrupt(() =>
          queued
            .restore(threadId, claim, "Queued follow-up submission was interrupted")
            .pipe(Effect.asVoid),
        ),
      );
    }).pipe(
      Effect.mapError(
        (cause) =>
          new CodexQueuedFollowUpDispatchError({
            threadId,
            followUpId: followUpId ?? "",
            cause,
          }),
      ),
    );

  const forkDispatch = (
    threadId: string,
    effect: Effect.Effect<void, CodexQueuedFollowUpDispatchError>,
  ) =>
    Effect.gen(function* () {
      const running = Option.getOrUndefined(FiberMap.getUnsafe(dispatches, threadId));
      if (running) return running;
      // Register the fiber before it can claim a queue entry; release/cancel must never miss it.
      const fiber = yield* Effect.forkChild(effect, { startImmediately: false });
      FiberMap.setUnsafe(dispatches, threadId, fiber, { onlyIfMissing: true });
      return Option.getOrUndefined(FiberMap.getUnsafe(dispatches, threadId)) ?? fiber;
    });

  yield* Effect.forever(
    queued.takeDispatchIntent.pipe(
      Effect.tap((intent) =>
        forkDispatch(intent.threadId, dispatch(intent.threadId, undefined, false)).pipe(
          Effect.asVoid,
        ),
      ),
    ),
  ).pipe(Effect.forkScoped);

  return CodexQueuedFollowUpDispatcher.of({
    sendNow: (threadId, followUpId) =>
      Effect.gen(function* () {
        const running = Option.getOrUndefined(FiberMap.getUnsafe(dispatches, threadId));
        if (running) yield* Fiber.join(running);
        const fiber = yield* forkDispatch(threadId, dispatch(threadId, followUpId, true));
        yield* Fiber.join(fiber);
      }),
    cancel: (threadId) => FiberMap.remove(dispatches, threadId),
  });
});
