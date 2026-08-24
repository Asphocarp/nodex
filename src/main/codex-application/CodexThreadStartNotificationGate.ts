import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

export interface CodexThreadStartNotificationRelease {
  readonly hostId: string;
  readonly threadId: string;
}

export interface CodexThreadStartNotificationGateService {
  /**
   * Fences one app-server operation until its returned Thread has been materialized locally, then
   * releases any notification that won the response race without delaying the committed caller.
   */
  readonly materialize: <A, E, R>(
    hostId: string,
    operation: Effect.Effect<A, E, R>,
    threadId: (value: A) => string | null,
  ) => Effect.Effect<A, E, R>;
  /** Claims an arriving `thread/started` for an open materialization on the same host. */
  readonly defer: (hostId: string, threadId: string) => boolean;
  /** Internal protocol-consumer stream. */
  readonly releases: Stream.Stream<CodexThreadStartNotificationRelease>;
  readonly clear: (threadId: string) => void;
}

export class CodexThreadStartNotificationGate extends Context.Service<
  CodexThreadStartNotificationGate,
  CodexThreadStartNotificationGateService
>()("nodex/main/codex-application/CodexThreadStartNotificationGate") {}

/**
 * Owns the response/notification race shared by every app-server Thread materializer. The gate is
 * host-scoped because `thread/started` can arrive before the response continuation reveals which
 * concurrent request created it; exact Thread ids become ready as soon as their local transaction
 * commits. Release is intentionally one-way: application commits never wait on the protocol actor.
 */
export const make: Effect.Effect<CodexThreadStartNotificationGateService, never, Scope.Scope> =
  Effect.gen(function* () {
    const releases = yield* Queue.unbounded<CodexThreadStartNotificationRelease>();
    const hosts = new Map<
      string,
      {
        active: number;
        readonly deferredThreadIds: Set<string>;
        readonly readyThreadIds: Set<string>;
      }
    >();

    yield* Effect.addFinalizer(() => Queue.shutdown(releases).pipe(Effect.asVoid));

    const normalizeHostId = (hostId: string): string => hostId.trim();
    const hostState = (hostId: string) => {
      const existing = hosts.get(hostId);
      if (existing) return existing;
      const created = {
        active: 0,
        deferredThreadIds: new Set<string>(),
        readyThreadIds: new Set<string>(),
      };
      hosts.set(hostId, created);
      return created;
    };

    const offerRelease = (hostId: string, threadId: string): Effect.Effect<void> =>
      Queue.offer(releases, { hostId, threadId }).pipe(Effect.asVoid);

    const release = (hostId: string, threadId: string): Effect.Effect<void> =>
      Effect.suspend(() => {
        const normalizedHostId = normalizeHostId(hostId);
        const normalizedThreadId = threadId.trim();
        if (!normalizedHostId || !normalizedThreadId) return Effect.void;
        const state = hostState(normalizedHostId);
        state.readyThreadIds.add(normalizedThreadId);
        if (!state.deferredThreadIds.delete(normalizedThreadId)) return Effect.void;
        return offerRelease(normalizedHostId, normalizedThreadId);
      });

    const end = (hostId: string): Effect.Effect<void> =>
      Effect.suspend(() => {
        const state = hosts.get(hostId);
        if (!state || state.active <= 0) return Effect.void;
        state.active -= 1;
        if (state.active > 0) return Effect.void;
        const pending = [...state.deferredThreadIds];
        hosts.delete(hostId);
        return Effect.forEach(pending, (threadId) => offerRelease(hostId, threadId), {
          discard: true,
        });
      });

    return CodexThreadStartNotificationGate.of({
      materialize: (hostId, operation, threadId) =>
        Effect.suspend(() => {
          const normalizedHostId = normalizeHostId(hostId);
          if (!normalizedHostId) return operation;
          hostState(normalizedHostId).active += 1;
          return operation.pipe(
            Effect.tap((value) => {
              const identified = threadId(value);
              return identified === null ? Effect.void : release(normalizedHostId, identified);
            }),
            Effect.ensuring(end(normalizedHostId)),
          );
        }),
      defer: (hostId, threadId) => {
        const normalizedHostId = normalizeHostId(hostId);
        const normalizedThreadId = threadId.trim();
        const state = hosts.get(normalizedHostId);
        if (
          !normalizedHostId ||
          !normalizedThreadId ||
          !state ||
          state.active === 0 ||
          state.readyThreadIds.has(normalizedThreadId)
        ) {
          return false;
        }
        state.deferredThreadIds.add(normalizedThreadId);
        return true;
      },
      releases: Stream.fromQueue(releases),
      clear: (threadId) => {
        const normalized = threadId.trim();
        if (!normalized) return;
        for (const state of hosts.values()) {
          state.deferredThreadIds.delete(normalized);
          state.readyThreadIds.delete(normalized);
        }
      },
    });
  });
