import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import * as HashMap from "effect/HashMap";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Semaphore from "effect/Semaphore";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import type {
  CodexUserInputAutoResolutionChange,
  CodexUserInputAutoResolutionEntry,
} from "../../shared/codex-user-input-auto-resolution";
import type { CodexProtocolRequestId } from "../../shared/types";
import { CodexRendererConversationRegistry } from "./CodexRendererConversationRegistry";

export const USER_INPUT_FOREGROUND_INACTIVITY = "60 seconds";
export const USER_INPUT_AUTO_RESOLUTION_COUNTDOWN = "90 seconds";
const USER_INPUT_AUTO_RESOLUTION_COUNTDOWN_MS = 90_000;

export type CodexUserInputAutoResolutionTimeout = Extract<
  CodexUserInputAutoResolutionChange,
  { readonly type: "timedOut" }
>;

interface TrackedUserInput {
  readonly entry: CodexUserInputAutoResolutionEntry;
  readonly generation: number;
}

export class CodexUserInputAutoResolution extends Context.Service<
  CodexUserInputAutoResolution,
  {
    readonly changes: Stream.Stream<CodexUserInputAutoResolutionChange>;
    readonly timeouts: Stream.Stream<CodexUserInputAutoResolutionTimeout>;
    readonly snapshot: Effect.Effect<CodexUserInputAutoResolutionEntry[]>;
    readonly observeRequest: (
      conversationId: string,
      requestId: CodexProtocolRequestId,
    ) => Effect.Effect<void>;
    readonly observeResponse: (
      conversationId: string,
      requestId: CodexProtocolRequestId,
    ) => Effect.Effect<void>;
    readonly observeServerResolution: (
      conversationId: string,
      requestId: CodexProtocolRequestId,
    ) => Effect.Effect<void>;
    readonly reevaluatePresentation: (conversationId: string) => Effect.Effect<void>;
    readonly recordActivity: (conversationId: string) => Effect.Effect<void>;
    readonly snooze: (
      conversationId: string,
      requestId: CodexProtocolRequestId,
    ) => Effect.Effect<boolean>;
    readonly clearConversation: (conversationId: string) => Effect.Effect<void>;
    readonly reconcilePendingRequests: (
      conversationId: string,
      requestIds: readonly CodexProtocolRequestId[],
    ) => Effect.Effect<void>;
    readonly handleDisconnect: Effect.Effect<void>;
  }
>()("nodex/main/codex-application/CodexUserInputAutoResolution") {}

type RemovalReason = Extract<
  CodexUserInputAutoResolutionChange,
  { readonly type: "removed" }
>["reason"];

const sameRequestId = (left: CodexProtocolRequestId, right: CodexProtocolRequestId): boolean =>
  typeof left === typeof right && left === right;

export const make: Effect.Effect<
  CodexUserInputAutoResolution["Service"],
  never,
  CodexRendererConversationRegistry | Scope.Scope
> = Effect.gen(function* () {
  const rendererConversations = yield* CodexRendererConversationRegistry;
  const state = yield* Ref.make(HashMap.empty<string, TrackedUserInput>());
  const changes = yield* PubSub.unbounded<CodexUserInputAutoResolutionChange>();
  const timers = yield* FiberMap.make<string, void>();
  const mutations = yield* Semaphore.make(1);
  yield* Effect.addFinalizer(() => PubSub.shutdown(changes));

  const publish = (change: CodexUserInputAutoResolutionChange) =>
    PubSub.publish(changes, change).pipe(Effect.asVoid);
  const current = (conversationId: string) =>
    Ref.get(state).pipe(
      Effect.map((entries) => Option.getOrUndefined(HashMap.get(entries, conversationId))),
    );
  const isCurrent = (tracked: TrackedUserInput) =>
    current(tracked.entry.conversationId).pipe(
      Effect.map(
        (candidate) =>
          candidate?.generation === tracked.generation &&
          sameRequestId(candidate.entry.requestId, tracked.entry.requestId),
      ),
    );

  const timeout = (tracked: TrackedUserInput) =>
    mutations
      .withPermits(1)(
        Effect.gen(function* () {
          if (!(yield* isCurrent(tracked))) return;
          yield* Ref.update(state, (entries) =>
            HashMap.remove(entries, tracked.entry.conversationId),
          );
          const event: CodexUserInputAutoResolutionTimeout = {
            type: "timedOut",
            conversationId: tracked.entry.conversationId,
            requestId: tracked.entry.requestId,
          };
          yield* publish(event);
        }),
      )
      .pipe(Effect.asVoid);

  const countdown = (tracked: TrackedUserInput) =>
    Effect.sleep(USER_INPUT_AUTO_RESOLUTION_COUNTDOWN).pipe(Effect.andThen(timeout(tracked)));
  const foregroundTimer = (tracked: TrackedUserInput) =>
    Effect.sleep(USER_INPUT_FOREGROUND_INACTIVITY).pipe(
      Effect.andThen(
        mutations.withPermits(1)(
          Effect.gen(function* () {
            if (!(yield* isCurrent(tracked))) return false;
            const now = yield* Clock.currentTimeMillis;
            const scheduled: TrackedUserInput = {
              ...tracked,
              entry: {
                ...tracked.entry,
                phase: {
                  type: "scheduled",
                  deadlineMs: now + USER_INPUT_AUTO_RESOLUTION_COUNTDOWN_MS,
                },
              },
            };
            yield* Ref.update(state, (entries) =>
              HashMap.set(entries, scheduled.entry.conversationId, scheduled),
            );
            yield* publish({ type: "updated", entry: scheduled.entry });
            return true;
          }),
        ),
      ),
      Effect.flatMap((continueCountdown) => (continueCountdown ? countdown(tracked) : Effect.void)),
    );

  const schedule = (
    tracked: TrackedUserInput,
    phase: "foreground" | "background",
    publishChange: boolean,
  ) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const next: TrackedUserInput = {
        ...tracked,
        generation: tracked.generation + 1,
        entry: {
          ...tracked.entry,
          phase:
            phase === "foreground"
              ? { type: "waitingForInactivity" }
              : {
                  type: "scheduled",
                  deadlineMs: now + USER_INPUT_AUTO_RESOLUTION_COUNTDOWN_MS,
                },
        },
      };
      yield* Ref.update(state, (entries) => HashMap.set(entries, next.entry.conversationId, next));
      if (publishChange) yield* publish({ type: "updated", entry: next.entry });
      yield* FiberMap.run(
        timers,
        next.entry.conversationId,
        phase === "foreground" ? foregroundTimer(next) : countdown(next),
        { startImmediately: true },
      );
    });

  const remove = (
    conversationId: string,
    requestId: CodexProtocolRequestId,
    reason: RemovalReason,
  ) =>
    mutations.withPermits(1)(
      Effect.gen(function* () {
        const tracked = yield* current(conversationId);
        if (!tracked || !sameRequestId(tracked.entry.requestId, requestId)) return false;
        yield* FiberMap.remove(timers, conversationId);
        yield* Ref.update(state, (entries) => HashMap.remove(entries, conversationId));
        yield* publish({ type: "removed", conversationId, requestId, reason });
        return true;
      }),
    );

  const clearAll = (reason: Extract<RemovalReason, "disconnected" | "disposed">) =>
    mutations.withPermits(1)(
      Effect.gen(function* () {
        const entries = [...HashMap.values(yield* Ref.get(state))];
        yield* FiberMap.clear(timers);
        yield* Ref.set(state, HashMap.empty());
        yield* Effect.forEach(
          entries,
          (tracked) =>
            publish({
              type: "removed",
              conversationId: tracked.entry.conversationId,
              requestId: tracked.entry.requestId,
              reason,
            }),
          { discard: true },
        );
      }),
    );

  yield* Effect.addFinalizer(() => clearAll("disposed"));

  const changeStream = Stream.fromPubSub(changes);
  return CodexUserInputAutoResolution.of({
    changes: changeStream,
    timeouts: changeStream.pipe(
      Stream.filter(
        (change): change is CodexUserInputAutoResolutionTimeout => change.type === "timedOut",
      ),
    ),
    snapshot: Ref.get(state).pipe(
      Effect.map((entries) =>
        [...HashMap.values(entries)]
          .map((tracked) => tracked.entry)
          .sort((left, right) => left.conversationId.localeCompare(right.conversationId)),
      ),
    ),
    observeRequest: (conversationId, requestId) =>
      mutations.withPermits(1)(
        Effect.gen(function* () {
          const previous = yield* current(conversationId);
          if (previous && sameRequestId(previous.entry.requestId, requestId)) return;
          if (previous) {
            yield* FiberMap.remove(timers, conversationId);
            yield* publish({
              type: "removed",
              conversationId,
              requestId: previous.entry.requestId,
              reason: "replaced",
            });
          }
          const tracked: TrackedUserInput = {
            entry: { conversationId, requestId, phase: { type: "waitingForInactivity" } },
            generation: previous?.generation ?? 0,
          };
          yield* schedule(
            tracked,
            rendererConversations.isPresentedInForeground(conversationId)
              ? "foreground"
              : "background",
            true,
          );
        }),
      ),
    observeResponse: (conversationId, requestId) =>
      remove(conversationId, requestId, "responded").pipe(Effect.asVoid),
    observeServerResolution: (conversationId, requestId) =>
      remove(conversationId, requestId, "resolved").pipe(Effect.asVoid),
    reevaluatePresentation: (conversationId) =>
      mutations.withPermits(1)(
        Effect.gen(function* () {
          const tracked = yield* current(conversationId);
          if (!tracked || tracked.entry.phase.type === "snoozed") return;
          if (rendererConversations.isPresentedInForeground(conversationId)) {
            yield* schedule(tracked, "foreground", true);
            return;
          }
          if (tracked.entry.phase.type === "waitingForInactivity") {
            yield* schedule(tracked, "background", true);
          }
        }),
      ),
    recordActivity: (conversationId) =>
      mutations.withPermits(1)(
        Effect.gen(function* () {
          const tracked = yield* current(conversationId);
          if (!tracked || tracked.entry.phase.type !== "waitingForInactivity") return;
          if (!rendererConversations.isPresentedInForeground(conversationId)) return;
          yield* schedule(tracked, "foreground", false);
        }),
      ),
    snooze: (conversationId, requestId) =>
      mutations.withPermits(1)(
        Effect.gen(function* () {
          const tracked = yield* current(conversationId);
          if (!tracked || !sameRequestId(tracked.entry.requestId, requestId)) return false;
          yield* FiberMap.remove(timers, conversationId);
          const snoozed: TrackedUserInput = {
            ...tracked,
            generation: tracked.generation + 1,
            entry: { ...tracked.entry, phase: { type: "snoozed" } },
          };
          yield* Ref.update(state, (entries) => HashMap.set(entries, conversationId, snoozed));
          yield* publish({ type: "updated", entry: snoozed.entry });
          return true;
        }),
      ),
    clearConversation: (conversationId) =>
      mutations.withPermits(1)(
        Effect.gen(function* () {
          const tracked = yield* current(conversationId);
          if (!tracked) return;
          yield* FiberMap.remove(timers, conversationId);
          yield* Ref.update(state, (entries) => HashMap.remove(entries, conversationId));
          yield* publish({
            type: "removed",
            conversationId,
            requestId: tracked.entry.requestId,
            reason: "disposed",
          });
        }),
      ),
    reconcilePendingRequests: (conversationId, requestIds) =>
      mutations.withPermits(1)(
        Effect.gen(function* () {
          const tracked = yield* current(conversationId);
          if (!tracked) return;
          if (requestIds.some((requestId) => sameRequestId(requestId, tracked.entry.requestId))) {
            return;
          }
          yield* FiberMap.remove(timers, conversationId);
          yield* Ref.update(state, (entries) => HashMap.remove(entries, conversationId));
          yield* publish({
            type: "removed",
            conversationId,
            requestId: tracked.entry.requestId,
            reason: "disposed",
          });
        }),
      ),
    handleDisconnect: clearAll("disconnected"),
  });
});

export interface CodexUserInputAutoResolutionLegacyPort {
  readonly observeRequest: (conversationId: string, requestId: CodexProtocolRequestId) => void;
  readonly observeResponse: (conversationId: string, requestId: CodexProtocolRequestId) => void;
  readonly observeServerResolution: (
    conversationId: string,
    requestId: CodexProtocolRequestId,
  ) => void;
  readonly reevaluatePresentation: (conversationId: string) => void;
  readonly clearConversation: (conversationId: string) => void;
  readonly reconcilePendingRequests: (
    conversationId: string,
    requestIds: readonly CodexProtocolRequestId[],
  ) => void;
  readonly handleDisconnect: () => void;
}
