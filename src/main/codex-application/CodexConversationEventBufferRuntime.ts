import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FiberMap from "effect/FiberMap";
import * as Option from "effect/Option";
import * as Semaphore from "effect/Semaphore";
import type * as Scope from "effect/Scope";
import type {
  CodexServerNotification,
  CodexServerRequest,
} from "../codex-runtime/CodexApplicationClient";

export type CodexConversationEventBufferPhase = "resume" | "thread-start";

export interface CodexBufferedConversationNotification {
  readonly type: "notification";
  readonly notification: CodexServerNotification;
}

export interface CodexBufferedConversationRequest {
  readonly type: "request";
  readonly request: CodexServerRequest;
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason?: unknown) => void;
}

export type CodexBufferedConversationEvent =
  | CodexBufferedConversationNotification
  | CodexBufferedConversationRequest;

export interface CodexBufferedConversationRequestCompletion {
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason?: unknown) => void;
}

export class CodexConversationEventBufferError extends Data.TaggedError(
  "CodexConversationEventBufferError",
)<{
  readonly cause: unknown;
  readonly phase: CodexConversationEventBufferPhase;
  readonly threadId: string;
}> {}

export interface CodexConversationEventBufferRuntimeOptions {
  readonly compact: (
    threadId: string,
    events: readonly CodexBufferedConversationEvent[],
  ) => readonly CodexBufferedConversationEvent[];
  readonly replayNotification: (input: {
    readonly phase: CodexConversationEventBufferPhase;
    readonly threadId: string;
    readonly notification: CodexServerNotification;
  }) => Effect.Effect<void, CodexConversationEventBufferError>;
  readonly replayRequest: (input: {
    readonly phase: CodexConversationEventBufferPhase;
    readonly threadId: string;
    readonly event: CodexBufferedConversationRequest;
  }) => Effect.Effect<void>;
  readonly reportThreadStartReplayFailure?: (input: {
    readonly threadId: string;
    readonly cause: unknown;
  }) => void;
}

export interface CodexConversationEventBufferRuntimeService {
  readonly beginResume: (threadId: string) => boolean;
  readonly hasResume: (threadId: string) => boolean;
  readonly beginThreadStartDeferral: () => void;
  readonly offerNotification: (input: {
    readonly threadId: string;
    readonly notification: CodexServerNotification;
    readonly bypassResume?: boolean;
    readonly startsThread?: boolean;
  }) => boolean;
  readonly offerRequest: (input: {
    readonly threadId: string;
    readonly request: CodexServerRequest;
    readonly completion: () => CodexBufferedConversationRequestCompletion;
  }) => boolean;
  readonly completeThreadStartDeferral: (threadId: string | null) => Effect.Effect<void>;
  readonly endThreadStartDeferral: Effect.Effect<void>;
  readonly releaseResume: (
    threadId: string,
  ) => Effect.Effect<void, CodexConversationEventBufferError>;
  readonly discardResume: (threadId: string, reason: unknown) => void;
  readonly clear: (threadId: string, reason: unknown) => void;
  readonly shutdown: (reason: unknown) => Effect.Effect<void>;
}

export class CodexConversationEventBufferRuntime extends Context.Service<
  CodexConversationEventBufferRuntime,
  CodexConversationEventBufferRuntimeService
>()("nodex/main/codex-application/CodexConversationEventBufferRuntime") {}

const replayKey = (phase: CodexConversationEventBufferPhase, threadId: string): string =>
  `${phase}\0${threadId}`;

const rejectRequests = (
  events: Iterable<CodexBufferedConversationEvent>,
  reason: unknown,
): void => {
  for (const event of events) {
    if (event.type === "request") event.reject(reason);
  }
};

export const make = (
  options: CodexConversationEventBufferRuntimeOptions,
): Effect.Effect<CodexConversationEventBufferRuntimeService, never, Scope.Scope> =>
  Effect.gen(function* () {
    const replays = yield* FiberMap.make<string, void, CodexConversationEventBufferError>();
    const runReplayFiber = yield* FiberMap.runtime(replays)();
    const admission = yield* Semaphore.make(1);
    const resumeBuffers = new Map<string, CodexBufferedConversationEvent[]>();
    const threadStartBuffers = new Map<string, CodexBufferedConversationEvent[]>();
    const deferredThreadStarts = new Set<string>();
    const readyThreadStarts = new Set<string>();
    const interruptionReasons = new Map<string, unknown>();
    let threadStartDeferralDepth = 0;
    let shutdownReason: unknown = new Error("Codex conversation event buffer closed");
    let closed = false;

    const replayBatch = (
      phase: CodexConversationEventBufferPhase,
      threadId: string,
      buffered: readonly CodexBufferedConversationEvent[],
    ): Effect.Effect<void, CodexConversationEventBufferError> =>
      Effect.gen(function* () {
        const events = yield* Effect.try({
          try: () => [...options.compact(threadId, buffered)],
          catch: (cause) => new CodexConversationEventBufferError({ cause, phase, threadId }),
        }).pipe(Effect.tapError((failure) => Effect.sync(() => rejectRequests(buffered, failure))));
        let nextIndex = 0;
        const replay = Effect.forEach(
          events,
          (event) => {
            if (event.type === "request") {
              const outerThreadStart = threadStartBuffers.get(threadId);
              if (outerThreadStart) {
                outerThreadStart.push(event);
                nextIndex += 1;
                return Effect.void;
              }
              return options.replayRequest({ phase, threadId, event }).pipe(
                Effect.uninterruptible,
                Effect.ensuring(
                  Effect.sync(() => {
                    nextIndex += 1;
                  }),
                ),
              );
            }

            const replayNotification = options.replayNotification({
              phase,
              threadId,
              notification: event.notification,
            });
            const guarded =
              phase === "resume"
                ? replayNotification
                : replayNotification.pipe(
                    Effect.catch((failure) =>
                      Effect.sync(() => {
                        options.reportThreadStartReplayFailure?.({
                          threadId,
                          cause: failure.cause,
                        });
                      }),
                    ),
                  );
            return guarded.pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  nextIndex += 1;
                }),
              ),
            );
          },
          { discard: true },
        );
        yield* replay.pipe(
          Effect.onExit((exit) => {
            if (Exit.isSuccess(exit)) return Effect.void;
            const key = replayKey(phase, threadId);
            const reason =
              interruptionReasons.get(key) ??
              (closed
                ? shutdownReason
                : new CodexConversationEventBufferError({
                    cause: exit.cause,
                    phase,
                    threadId,
                  }));
            interruptionReasons.delete(key);
            return Effect.sync(() => rejectRequests(events.slice(nextIndex), reason));
          }),
        );
      });

    const acquireReplay = (
      phase: CodexConversationEventBufferPhase,
      threadId: string,
    ): Effect.Effect<Option.Option<Fiber.Fiber<void, CodexConversationEventBufferError>>> =>
      admission.withPermits(1)(
        Effect.gen(function* () {
          const key = replayKey(phase, threadId);
          const current = yield* FiberMap.get(replays, key);
          if (Option.isSome(current)) return current;
          if (closed) return Option.none();

          const buffered =
            phase === "resume"
              ? resumeBuffers.get(threadId)
              : deferredThreadStarts.delete(threadId)
                ? threadStartBuffers.get(threadId)
                : undefined;
          if (buffered === undefined) return Option.none();
          if (phase === "resume") resumeBuffers.delete(threadId);
          else threadStartBuffers.delete(threadId);
          const fiber = yield* FiberMap.run(replays, key, replayBatch(phase, threadId, buffered), {
            startImmediately: true,
          });
          return Option.some(fiber);
        }),
      );

    const release = (
      phase: CodexConversationEventBufferPhase,
      threadId: string,
    ): Effect.Effect<void, CodexConversationEventBufferError> =>
      Effect.gen(function* () {
        for (;;) {
          const fiber = yield* acquireReplay(phase, threadId);
          if (Option.isNone(fiber)) return;
          yield* Fiber.join(fiber.value);
        }
      });

    const releaseThreadStart = (threadId: string): Effect.Effect<void> =>
      release("thread-start", threadId).pipe(
        Effect.catch((failure) =>
          Effect.sync(() => {
            options.reportThreadStartReplayFailure?.({
              threadId,
              cause: failure.cause,
            });
          }),
        ),
      );

    const interruptReplay = (
      phase: CodexConversationEventBufferPhase,
      threadId: string,
      reason: unknown,
    ): void => {
      const key = replayKey(phase, threadId);
      if (!FiberMap.hasUnsafe(replays, key)) return;
      interruptionReasons.set(key, reason);
      runReplayFiber(key, Effect.void);
    };

    const discardStored = (
      buffers: Map<string, CodexBufferedConversationEvent[]>,
      threadId: string,
      reason: unknown,
    ): void => {
      const buffered = buffers.get(threadId);
      buffers.delete(threadId);
      if (buffered) rejectRequests(buffered, reason);
    };

    const shutdown = (reason: unknown): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (closed) return;
        closed = true;
        shutdownReason = reason;
        for (const buffered of resumeBuffers.values()) rejectRequests(buffered, reason);
        for (const buffered of threadStartBuffers.values()) rejectRequests(buffered, reason);
        resumeBuffers.clear();
        threadStartBuffers.clear();
        deferredThreadStarts.clear();
        readyThreadStarts.clear();
        threadStartDeferralDepth = 0;
        yield* FiberMap.clear(replays);
        interruptionReasons.clear();
      });

    yield* Effect.addFinalizer(() =>
      shutdown(new Error("Codex conversation event buffer Main Scope closed")),
    );

    return CodexConversationEventBufferRuntime.of({
      beginResume: (threadId) => {
        if (closed || resumeBuffers.has(threadId)) return false;
        resumeBuffers.set(threadId, []);
        return true;
      },
      hasResume: (threadId) => resumeBuffers.has(threadId),
      beginThreadStartDeferral: () => {
        if (!closed) threadStartDeferralDepth += 1;
      },
      offerNotification: ({ threadId, notification, bypassResume, startsThread }) => {
        if (closed) return false;
        const resume = bypassResume ? undefined : resumeBuffers.get(threadId);
        if (resume) {
          resume.push({ type: "notification", notification });
          return true;
        }

        const existingThreadStart = threadStartBuffers.get(threadId);
        if (existingThreadStart) {
          existingThreadStart.push({ type: "notification", notification });
          return true;
        }
        if (!startsThread || threadStartDeferralDepth === 0 || readyThreadStarts.has(threadId)) {
          return false;
        }
        deferredThreadStarts.add(threadId);
        threadStartBuffers.set(threadId, [{ type: "notification", notification }]);
        return true;
      },
      offerRequest: ({ threadId, request, completion }) => {
        if (closed) return false;
        const buffer = resumeBuffers.get(threadId) ?? threadStartBuffers.get(threadId);
        if (!buffer) return false;
        buffer.push({ type: "request", request, ...completion() });
        return true;
      },
      completeThreadStartDeferral: (threadId) => {
        if (!threadId || closed) return Effect.void;
        readyThreadStarts.add(threadId);
        return releaseThreadStart(threadId);
      },
      endThreadStartDeferral: Effect.gen(function* () {
        if (closed || threadStartDeferralDepth <= 0) return;
        threadStartDeferralDepth -= 1;
        if (threadStartDeferralDepth > 0) return;
        const pendingThreadIds = [...deferredThreadStarts];
        yield* Effect.forEach(pendingThreadIds, releaseThreadStart, { discard: true });
        // A new creation may have opened while an older generation replayed.
        if (threadStartDeferralDepth === 0) readyThreadStarts.clear();
      }),
      releaseResume: (threadId) => release("resume", threadId),
      discardResume: (threadId, reason) => {
        discardStored(resumeBuffers, threadId, reason);
        interruptReplay("resume", threadId, reason);
      },
      clear: (threadId, reason) => {
        discardStored(resumeBuffers, threadId, reason);
        discardStored(threadStartBuffers, threadId, reason);
        deferredThreadStarts.delete(threadId);
        readyThreadStarts.delete(threadId);
        interruptReplay("resume", threadId, reason);
        interruptReplay("thread-start", threadId, reason);
      },
      shutdown,
    });
  });
