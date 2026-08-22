import * as Context from "effect/Context";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import * as Semaphore from "effect/Semaphore";
import type * as Scope from "effect/Scope";
import { CODEX_FRAME_TEXT_DELTA_FALLBACK_INTERVAL_MS } from "../../shared/codex-conversation-state/codex-frame-text-delta-queue";

export const DEFAULT_CODEX_OWNER_NOTIFICATION_DRAIN_TIMEOUT =
  CODEX_FRAME_TEXT_DELTA_FALLBACK_INTERVAL_MS * 8;

export interface CodexOwnerNotificationDrainDeadlineOptions {
  readonly onTimeout: (
    conversationId: string,
    sentSequence: number,
    ackSequence: number,
  ) => Effect.Effect<void>;
  readonly timeout?: Duration.Input;
}

export class CodexOwnerNotificationDrainDeadline extends Context.Service<
  CodexOwnerNotificationDrainDeadline,
  {
    readonly schedule: (
      conversationId: string,
      sentSequence: number,
      ackSequence: number,
    ) => Effect.Effect<void>;
    readonly clear: (conversationId: string) => Effect.Effect<void>;
  }
>()("nodex/main/codex-application/CodexOwnerNotificationDrainDeadline") {}

export const make = (
  options: CodexOwnerNotificationDrainDeadlineOptions,
): Effect.Effect<CodexOwnerNotificationDrainDeadline["Service"], never, Scope.Scope> =>
  Effect.gen(function* () {
    const deadlines = yield* FiberMap.make<string, void, never>();
    const admission = yield* Semaphore.make(1);

    return CodexOwnerNotificationDrainDeadline.of({
      schedule: (conversationId, sentSequence, ackSequence) =>
        admission.withPermits(1)(
          Effect.gen(function* () {
            if (yield* FiberMap.has(deadlines, conversationId)) return;
            yield* FiberMap.run(
              deadlines,
              conversationId,
              Effect.sleep(options.timeout ?? DEFAULT_CODEX_OWNER_NOTIFICATION_DRAIN_TIMEOUT).pipe(
                Effect.andThen(options.onTimeout(conversationId, sentSequence, ackSequence)),
              ),
              { startImmediately: true },
            );
          }),
        ),
      clear: (conversationId) => FiberMap.remove(deadlines, conversationId),
    });
  });

export interface CodexOwnerNotificationDrainDeadlineLegacyPort {
  readonly schedule: (conversationId: string, sentSequence: number, ackSequence: number) => void;
  readonly clear: (conversationId: string) => void;
}
