import type { RequestId } from "@nodex/codex-app-server-protocol";
import type { ServerNotificationMethod } from "@nodex/effect-codex-app-server/rpc";
import type { CodexAppServerRequestError } from "@nodex/effect-codex-app-server/errors";
import { randomUUID } from "node:crypto";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SynchronizedRef from "effect/SynchronizedRef";

export interface CodexApplicationRequestOccurrence {
  readonly kind: "request";
  readonly hostId: string;
  readonly generation: number;
  readonly occurrenceId: string;
  readonly occurrenceToken: number;
  readonly requestId: RequestId;
  readonly method: string;
  readonly params: unknown;
}

export interface CodexApplicationNotificationOccurrence {
  readonly kind: "notification";
  readonly hostId: string;
  readonly generation: number;
  readonly occurrenceId: string;
  readonly occurrenceToken: number;
  readonly method: ServerNotificationMethod;
  readonly params: unknown;
}

export type CodexApplicationProtocolOccurrence =
  | CodexApplicationRequestOccurrence
  | CodexApplicationNotificationOccurrence;

export type CodexApplicationRequestOutcome =
  | { readonly kind: "result"; readonly value: unknown }
  | { readonly kind: "error"; readonly error: CodexAppServerRequestError }
  | { readonly kind: "abandon" };

export interface CodexApplicationRequestSettlement {
  readonly occurrence: CodexApplicationRequestOccurrence;
  readonly outcome: CodexApplicationRequestOutcome;
}

export type CodexApplicationRequestInterpretation<A> =
  | { readonly kind: "completed"; readonly value: A }
  | { readonly kind: "withdrawn" };

export class CodexApplicationRequestGenerationUnavailable extends Schema.TaggedError<CodexApplicationRequestGenerationUnavailable>()(
  "CodexApplicationRequestGenerationUnavailable",
  {
    hostId: Schema.String,
    generation: Schema.Int,
    reason: Schema.Literals(["closed", "conflict", "invalid"]),
  },
) {}

export interface CodexApplicationRequestGeneration {
  readonly hostId: string;
  readonly generation: number;
  readonly admit: (input: {
    readonly requestId: RequestId;
    readonly method: string;
    readonly params: unknown;
  }) => Effect.Effect<
    CodexApplicationRequestOccurrence,
    CodexApplicationRequestGenerationUnavailable
  >;
  readonly settlements: Stream.Stream<CodexApplicationRequestSettlement>;
  readonly rejectOutstanding: (error: CodexAppServerRequestError) => Effect.Effect<number>;
}

export interface CodexApplicationRequestInboxService {
  /** Lossless, transport-ordered ingress for requests and notifications from every Endpoint. */
  readonly occurrences: Stream.Stream<CodexApplicationProtocolOccurrence>;
  readonly publishNotification: (input: {
    readonly hostId: string;
    readonly generation: number;
    readonly method: ServerNotificationMethod;
    readonly params: unknown;
  }) => Effect.Effect<void>;
  readonly openGeneration: (
    hostId: string,
    generation: number,
  ) => Effect.Effect<
    CodexApplicationRequestGeneration,
    CodexApplicationRequestGenerationUnavailable,
    Scope.Scope
  >;
  readonly settle: (
    occurrence: CodexApplicationRequestOccurrence,
    outcome: CodexApplicationRequestOutcome,
  ) => Effect.Effect<boolean>;
  /** Settles a pending occurrence retained by an application request capability. */
  readonly settleOccurrenceToken: (
    occurrenceToken: number,
    outcome: CodexApplicationRequestOutcome,
  ) => Effect.Effect<boolean>;
  /** Runs semantic interpretation only while the exact Endpoint generation remains alive. */
  readonly interpret: <A, E, R>(
    occurrence: CodexApplicationRequestOccurrence,
    operation: Effect.Effect<A, E, R>,
  ) => Effect.Effect<CodexApplicationRequestInterpretation<A>, E, R>;
  /** Observes a notification only while its exact Endpoint generation remains alive. */
  readonly interpretNotification: <A, E, R>(
    occurrence: CodexApplicationNotificationOccurrence,
    operation: Effect.Effect<A, E, R>,
  ) => Effect.Effect<CodexApplicationRequestInterpretation<A>, E, R>;
}

export class CodexApplicationRequestInbox extends Context.Service<
  CodexApplicationRequestInbox,
  CodexApplicationRequestInboxService
>()("nodex/main/codex-runtime/CodexApplicationRequestInbox") {}

interface GenerationState {
  readonly lease: object;
  readonly pending: ReadonlyMap<number, CodexApplicationRequestOccurrence>;
  readonly processingScope: Scope.Scope;
  readonly settlements: Queue.Queue<CodexApplicationRequestSettlement>;
}

interface InboxState {
  readonly closed: boolean;
  readonly nextOccurrenceToken: number;
  readonly generations: ReadonlyMap<string, GenerationState>;
}

const generationLease = Symbol("CodexApplicationRequestInbox.generationLease");
type OwnedGeneration = CodexApplicationRequestGeneration & {
  readonly [generationLease]: object;
};

const generationKey = (hostId: string, generation: number): string =>
  `${hostId}\u0000${generation}`;

const unavailable = (
  hostId: string,
  generation: number,
  reason: CodexApplicationRequestGenerationUnavailable["reason"],
) => new CodexApplicationRequestGenerationUnavailable({ hostId, generation, reason });

const isInterruptedOnly = (cause: Cause.Cause<unknown>): boolean =>
  cause.reasons.length > 0 && cause.reasons.every(Cause.isInterruptReason);

/**
 * Owns physical server-request completion before any Codex endpoint is opened. Each endpoint
 * generation receives an exact scoped lease and a lossless settlement queue, so application
 * handlers can return to the wire reader immediately without losing the eventual response.
 */
export const make: Effect.Effect<CodexApplicationRequestInboxService, never, Scope.Scope> =
  Effect.gen(function* () {
    const occurrences = yield* Queue.unbounded<CodexApplicationProtocolOccurrence>();
    const inboxId = randomUUID();
    const state = yield* SynchronizedRef.make<InboxState>({
      closed: false,
      nextOccurrenceToken: 1,
      generations: new Map(),
    });

    const settle: CodexApplicationRequestInboxService["settle"] = (occurrence, outcome) =>
      SynchronizedRef.modifyEffect(state, (current) => {
        const key = generationKey(occurrence.hostId, occurrence.generation);
        const generation = current.generations.get(key);
        const pending = generation?.pending.get(occurrence.occurrenceToken);
        if (!generation || pending !== occurrence) return Effect.succeed([false, current] as const);

        const nextPending = new Map(generation.pending);
        nextPending.delete(occurrence.occurrenceToken);
        const nextGenerations = new Map(current.generations);
        nextGenerations.set(key, { ...generation, pending: nextPending });
        return Queue.offer(generation.settlements, { occurrence, outcome }).pipe(
          Effect.as([true, { ...current, generations: nextGenerations }] as const),
        );
      });

    const settleOccurrenceToken: CodexApplicationRequestInboxService["settleOccurrenceToken"] = (
      occurrenceToken,
      outcome,
    ) =>
      SynchronizedRef.modifyEffect(state, (current) => {
        for (const [key, generation] of current.generations) {
          const occurrence = generation.pending.get(occurrenceToken);
          if (!occurrence) continue;
          const nextPending = new Map(generation.pending);
          nextPending.delete(occurrenceToken);
          const nextGenerations = new Map(current.generations);
          nextGenerations.set(key, { ...generation, pending: nextPending });
          return Queue.offer(generation.settlements, { occurrence, outcome }).pipe(
            Effect.as([true, { ...current, generations: nextGenerations }] as const),
          );
        }
        return Effect.succeed([false, current] as const);
      });

    const acquireGeneration = Effect.fn("CodexApplicationRequestInbox.acquireGeneration")(
      function* (hostIdInput: string, generation: number) {
        const hostId = hostIdInput.trim();
        if (hostId.length === 0 || !Number.isSafeInteger(generation) || generation <= 0) {
          return yield* unavailable(hostId, generation, "invalid");
        }
        const key = generationKey(hostId, generation);
        const settlements = yield* Queue.unbounded<CodexApplicationRequestSettlement>();
        const processingScope = yield* Effect.scope;
        const lease = {};
        const registered = yield* SynchronizedRef.modifyEffect(state, (current) => {
          if (current.closed) {
            return Effect.succeed([unavailable(hostId, generation, "closed"), current] as const);
          }
          if (current.generations.has(key)) {
            return Effect.succeed([unavailable(hostId, generation, "conflict"), current] as const);
          }
          const generations = new Map(current.generations);
          generations.set(key, { lease, pending: new Map(), processingScope, settlements });
          return Effect.succeed([null, { ...current, generations }] as const);
        });
        if (registered) {
          yield* Queue.shutdown(settlements);
          return yield* registered;
        }

        const admit: CodexApplicationRequestGeneration["admit"] = (input) =>
          SynchronizedRef.modifyEffect(state, (current) => {
            const active = current.generations.get(key);
            if (current.closed || active?.lease !== lease) {
              return Effect.fail(unavailable(hostId, generation, "closed"));
            }
            const occurrenceToken = current.nextOccurrenceToken;
            const occurrence: CodexApplicationRequestOccurrence = {
              kind: "request",
              hostId,
              generation,
              occurrenceId: `${hostId}:${generation}:${inboxId}:${occurrenceToken}`,
              occurrenceToken,
              requestId: input.requestId,
              method: input.method,
              params: input.params,
            };
            const pending = new Map(active.pending);
            pending.set(occurrence.occurrenceToken, occurrence);
            const generations = new Map(current.generations);
            generations.set(key, { ...active, pending });
            return Queue.offer(occurrences, occurrence).pipe(
              Effect.as([
                occurrence,
                {
                  ...current,
                  nextOccurrenceToken: current.nextOccurrenceToken + 1,
                  generations,
                },
              ] as const),
            );
          });

        const rejectOutstanding = (error: CodexAppServerRequestError) =>
          SynchronizedRef.modifyEffect(state, (current) => {
            const active = current.generations.get(key);
            if (active?.lease !== lease || active.pending.size === 0) {
              return Effect.succeed([0, current] as const);
            }
            const outstanding = [...active.pending.values()];
            const generations = new Map(current.generations);
            generations.set(key, { ...active, pending: new Map() });
            return Effect.forEach(
              outstanding,
              (occurrence) =>
                Queue.offer(active.settlements, {
                  occurrence,
                  outcome: { kind: "error", error },
                }),
              { discard: true },
            ).pipe(Effect.as([outstanding.length, { ...current, generations }] as const));
          });

        return {
          hostId,
          generation,
          admit,
          settlements: Stream.fromQueue(settlements),
          rejectOutstanding,
          [generationLease]: lease,
        } satisfies OwnedGeneration;
      },
    );

    const releaseGeneration = Effect.fn("CodexApplicationRequestInbox.releaseGeneration")((
      generation: OwnedGeneration,
    ) => {
      const key = generationKey(generation.hostId, generation.generation);
      return SynchronizedRef.modifyEffect(state, (current) => {
        const active = current.generations.get(key);
        if (active?.lease !== generation[generationLease]) {
          return Effect.succeed([undefined, current] as const);
        }
        const generations = new Map(current.generations);
        generations.delete(key);
        return Queue.shutdown(active.settlements).pipe(
          Effect.as([undefined, { ...current, generations }] as const),
        );
      });
    });

    const openGeneration: CodexApplicationRequestInboxService["openGeneration"] = (
      hostId,
      generation,
    ) =>
      Effect.acquireRelease(acquireGeneration(hostId, generation), (opened) =>
        releaseGeneration(opened),
      ).pipe(Effect.map((opened) => opened as CodexApplicationRequestGeneration));

    const interpret: CodexApplicationRequestInboxService["interpret"] = (occurrence, operation) =>
      Effect.gen(function* () {
        const current = yield* SynchronizedRef.get(state);
        const active = current.generations.get(
          generationKey(occurrence.hostId, occurrence.generation),
        );
        if (active?.pending.get(occurrence.occurrenceToken) !== occurrence) {
          return { kind: "withdrawn" } as const;
        }

        const exit = yield* Effect.acquireUseRelease(
          operation.pipe(Effect.forkIn(active.processingScope, { startImmediately: true })),
          Fiber.await,
          Fiber.interrupt,
        );
        if (Exit.isSuccess(exit)) return { kind: "completed", value: exit.value } as const;
        if (isInterruptedOnly(exit.cause)) return { kind: "withdrawn" } as const;
        return yield* Effect.failCause(exit.cause);
      });

    const interpretNotification: CodexApplicationRequestInboxService["interpretNotification"] = (
      occurrence,
      operation,
    ) =>
      Effect.gen(function* () {
        const current = yield* SynchronizedRef.get(state);
        const active = current.generations.get(
          generationKey(occurrence.hostId, occurrence.generation),
        );
        if (!active) return { kind: "withdrawn" } as const;
        const exit = yield* Effect.acquireUseRelease(
          operation.pipe(Effect.forkIn(active.processingScope, { startImmediately: true })),
          Fiber.await,
          Fiber.interrupt,
        );
        if (Exit.isSuccess(exit)) return { kind: "completed", value: exit.value } as const;
        if (isInterruptedOnly(exit.cause)) return { kind: "withdrawn" } as const;
        return yield* Effect.failCause(exit.cause);
      });

    const publishNotification: CodexApplicationRequestInboxService["publishNotification"] = (
      input,
    ) =>
      SynchronizedRef.modifyEffect(state, (current) => {
        const active = current.generations.get(generationKey(input.hostId, input.generation));
        if (current.closed || !active) return Effect.succeed([undefined, current] as const);
        const occurrenceToken = current.nextOccurrenceToken;
        const occurrence: CodexApplicationNotificationOccurrence = {
          kind: "notification",
          ...input,
          occurrenceId: `${input.hostId}:${input.generation}:${inboxId}:${occurrenceToken}`,
          occurrenceToken,
        };
        return Queue.offer(occurrences, occurrence).pipe(
          Effect.as([
            undefined,
            { ...current, nextOccurrenceToken: current.nextOccurrenceToken + 1 },
          ] as const),
        );
      });

    yield* Effect.addFinalizer(() =>
      SynchronizedRef.modifyEffect(state, (current) =>
        Effect.forEach(
          current.generations.values(),
          (generation) => Queue.shutdown(generation.settlements),
          { discard: true },
        ).pipe(
          Effect.andThen(Queue.shutdown(occurrences)),
          Effect.as([undefined, { ...current, closed: true, generations: new Map() }] as const),
        ),
      ),
    );

    return CodexApplicationRequestInbox.of({
      occurrences: Stream.fromQueue(occurrences),
      publishNotification,
      openGeneration,
      settle,
      settleOccurrenceToken,
      interpret,
      interpretNotification,
    });
  });
