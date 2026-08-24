import type { RequestId } from "@nodex/codex-app-server-protocol";
import type {
  CodexAppServerNotification,
  CodexAppServerRequest,
} from "@nodex/effect-codex-app-server/client";
import type { CodexAppServerRequestError } from "@nodex/effect-codex-app-server/errors";
import { randomUUID } from "node:crypto";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
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
  readonly protocol: CodexAppServerRequest["protocol"];
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
  readonly protocol: CodexAppServerNotification["protocol"];
  readonly hostId: string;
  readonly generation: number;
  readonly occurrenceId: string;
  readonly occurrenceToken: number;
  readonly method: string;
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
    reason: Schema.Literals(["closed", "conflict", "invalid", "overflow"]),
  },
) {}

export class CodexApplicationIngressOverflow extends Schema.TaggedError<CodexApplicationIngressOverflow>()(
  "CodexApplicationIngressOverflow",
  {
    channel: Schema.Literals(["occurrences", "settlements"]),
    capacity: Schema.Int,
    hostId: Schema.String,
    generation: Schema.Int,
    occurrenceId: Schema.String,
  },
) {}

export class CodexApplicationConsequenceFailure extends Schema.TaggedError<CodexApplicationConsequenceFailure>()(
  "CodexApplicationConsequenceFailure",
  {
    hostId: Schema.String,
    generation: Schema.Int,
    occurrenceId: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export interface CodexApplicationRequestGeneration {
  readonly hostId: string;
  readonly generation: number;
  readonly admit: (input: {
    readonly requestId: RequestId;
    readonly protocol: CodexAppServerRequest["protocol"];
    readonly method: string;
    readonly params: unknown;
  }) => Effect.Effect<
    CodexApplicationRequestOccurrence,
    CodexApplicationRequestGenerationUnavailable
  >;
  readonly settlements: Stream.Stream<CodexApplicationRequestSettlement>;
  /** Fails when canonical application interpretation can no longer preserve this generation. */
  readonly termination: Effect.Effect<never, CodexApplicationConsequenceFailure>;
  readonly rejectOutstanding: (error: CodexAppServerRequestError) => Effect.Effect<number>;
}

export interface CodexApplicationRequestInboxService {
  /** Lossless, transport-ordered ingress for requests and notifications from every Endpoint. */
  readonly occurrences: Stream.Stream<CodexApplicationProtocolOccurrence>;
  readonly publishNotification: (input: {
    readonly hostId: string;
    readonly generation: number;
    readonly protocol: CodexAppServerNotification["protocol"];
    readonly method: string;
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
  /** Fails only the exact physical generation that admitted the bad occurrence. */
  readonly failGeneration: (
    occurrence: CodexApplicationProtocolOccurrence,
    cause: unknown,
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
  readonly failed: boolean;
  readonly lease: object;
  readonly pending: ReadonlyMap<number, CodexApplicationRequestOccurrence>;
  readonly processingScope: Scope.Scope;
  readonly settlements: Queue.Queue<CodexApplicationRequestSettlement>;
  readonly termination: Deferred.Deferred<never, CodexApplicationConsequenceFailure>;
}

export interface CodexApplicationRequestInboxCapacities {
  readonly occurrences: number;
  readonly settlements: number;
}

interface InboxState {
  readonly closed: boolean;
  readonly nextOccurrenceToken: number;
  readonly generations: ReadonlyMap<string, GenerationState>;
}

type AdmissionResult =
  | { readonly _tag: "Accepted"; readonly occurrence: CodexApplicationRequestOccurrence }
  | {
      readonly _tag: "Unavailable";
      readonly reason: CodexApplicationRequestGenerationUnavailable["reason"];
    };

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
export const makeWithCapacities = (
  capacities: CodexApplicationRequestInboxCapacities,
): Effect.Effect<CodexApplicationRequestInboxService, never, Scope.Scope> =>
  Effect.gen(function* () {
    const occurrenceCapacity = Math.max(1, Math.floor(capacities.occurrences));
    const settlementCapacity = Math.max(1, Math.floor(capacities.settlements));
    const occurrences =
      yield* Queue.dropping<CodexApplicationProtocolOccurrence>(occurrenceCapacity);
    const inboxId = randomUUID();
    const state = yield* SynchronizedRef.make<InboxState>({
      closed: false,
      nextOccurrenceToken: 1,
      generations: new Map(),
    });

    const settle: CodexApplicationRequestInboxService["settle"] = (occurrence, outcome) =>
      SynchronizedRef.modifyEffect(
        state,
        (current): Effect.Effect<readonly [boolean, InboxState]> => {
          const key = generationKey(occurrence.hostId, occurrence.generation);
          const generation = current.generations.get(key);
          const pending = generation?.pending.get(occurrence.occurrenceToken);
          if (!generation || generation.failed || pending !== occurrence) {
            return Effect.succeed([false, current] as const);
          }

          const nextPending = new Map(generation.pending);
          nextPending.delete(occurrence.occurrenceToken);
          const nextGenerations = new Map(current.generations);
          nextGenerations.set(key, { ...generation, pending: nextPending });
          return Queue.offer(generation.settlements, { occurrence, outcome }).pipe(
            Effect.flatMap((accepted): Effect.Effect<readonly [boolean, InboxState]> => {
              if (accepted) {
                return Effect.succeed([
                  true,
                  { ...current, generations: nextGenerations },
                ] as const);
              }
              const failedGenerations = new Map(nextGenerations);
              failedGenerations.set(key, { ...generation, failed: true, pending: nextPending });
              return Deferred.fail(
                generation.termination,
                new CodexApplicationConsequenceFailure({
                  hostId: occurrence.hostId,
                  generation: occurrence.generation,
                  occurrenceId: occurrence.occurrenceId,
                  cause: new CodexApplicationIngressOverflow({
                    channel: "settlements",
                    capacity: settlementCapacity,
                    hostId: occurrence.hostId,
                    generation: occurrence.generation,
                    occurrenceId: occurrence.occurrenceId,
                  }),
                }),
              ).pipe(Effect.as([false, { ...current, generations: failedGenerations }] as const));
            }),
          );
        },
      );

    const settleOccurrenceToken: CodexApplicationRequestInboxService["settleOccurrenceToken"] = (
      occurrenceToken,
      outcome,
    ) =>
      SynchronizedRef.modifyEffect(
        state,
        (current): Effect.Effect<readonly [boolean, InboxState]> => {
          for (const [key, generation] of current.generations) {
            const occurrence = generation.pending.get(occurrenceToken);
            if (!occurrence) continue;
            const nextPending = new Map(generation.pending);
            nextPending.delete(occurrenceToken);
            const nextGenerations = new Map(current.generations);
            nextGenerations.set(key, { ...generation, pending: nextPending });
            if (generation.failed) return Effect.succeed([false, current] as const);
            return Queue.offer(generation.settlements, { occurrence, outcome }).pipe(
              Effect.flatMap((accepted): Effect.Effect<readonly [boolean, InboxState]> => {
                if (accepted) {
                  return Effect.succeed([
                    true,
                    { ...current, generations: nextGenerations },
                  ] as const);
                }
                const failedGenerations = new Map(nextGenerations);
                failedGenerations.set(key, { ...generation, failed: true, pending: nextPending });
                return Deferred.fail(
                  generation.termination,
                  new CodexApplicationConsequenceFailure({
                    hostId: occurrence.hostId,
                    generation: occurrence.generation,
                    occurrenceId: occurrence.occurrenceId,
                    cause: new CodexApplicationIngressOverflow({
                      channel: "settlements",
                      capacity: settlementCapacity,
                      hostId: occurrence.hostId,
                      generation: occurrence.generation,
                      occurrenceId: occurrence.occurrenceId,
                    }),
                  }),
                ).pipe(Effect.as([false, { ...current, generations: failedGenerations }] as const));
              }),
            );
          }
          return Effect.succeed([false, current] as const);
        },
      );

    const acquireGeneration = Effect.fn("CodexApplicationRequestInbox.acquireGeneration")(
      function* (hostIdInput: string, generation: number) {
        const hostId = hostIdInput.trim();
        if (hostId.length === 0 || !Number.isSafeInteger(generation) || generation <= 0) {
          return yield* unavailable(hostId, generation, "invalid");
        }
        const key = generationKey(hostId, generation);
        const settlements =
          yield* Queue.dropping<CodexApplicationRequestSettlement>(settlementCapacity);
        const termination = yield* Deferred.make<never, CodexApplicationConsequenceFailure>();
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
          generations.set(key, {
            failed: false,
            lease,
            pending: new Map(),
            processingScope,
            settlements,
            termination,
          });
          return Effect.succeed([null, { ...current, generations }] as const);
        });
        if (registered) {
          yield* Queue.shutdown(settlements);
          return yield* registered;
        }

        const admit: CodexApplicationRequestGeneration["admit"] = (input) =>
          SynchronizedRef.modifyEffect(
            state,
            (current): Effect.Effect<readonly [AdmissionResult, InboxState]> => {
              const active = current.generations.get(key);
              if (current.closed || active?.lease !== lease || active.failed) {
                return Effect.succeed([
                  { _tag: "Unavailable" as const, reason: active?.failed ? "overflow" : "closed" },
                  current,
                ] as const);
              }
              const occurrenceToken = current.nextOccurrenceToken;
              const occurrence: CodexApplicationRequestOccurrence = {
                kind: "request",
                protocol: input.protocol,
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
                Effect.flatMap(
                  (accepted): Effect.Effect<readonly [AdmissionResult, InboxState]> => {
                    if (accepted) {
                      return Effect.succeed([
                        { _tag: "Accepted" as const, occurrence },
                        {
                          ...current,
                          nextOccurrenceToken: current.nextOccurrenceToken + 1,
                          generations,
                        },
                      ] as const);
                    }
                    const failedGenerations = new Map(current.generations);
                    failedGenerations.set(key, { ...active, failed: true });
                    return Deferred.fail(
                      active.termination,
                      new CodexApplicationConsequenceFailure({
                        hostId,
                        generation,
                        occurrenceId: occurrence.occurrenceId,
                        cause: new CodexApplicationIngressOverflow({
                          channel: "occurrences",
                          capacity: occurrenceCapacity,
                          hostId,
                          generation,
                          occurrenceId: occurrence.occurrenceId,
                        }),
                      }),
                    ).pipe(
                      Effect.as([
                        { _tag: "Unavailable" as const, reason: "overflow" as const },
                        { ...current, generations: failedGenerations },
                      ] as const),
                    );
                  },
                ),
              );
            },
          ).pipe(
            Effect.flatMap((result) =>
              result._tag === "Accepted"
                ? Effect.succeed(result.occurrence)
                : Effect.fail(unavailable(hostId, generation, result.reason)),
            ),
          );

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
          termination: Deferred.await(termination),
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
        if (active?.failed || active?.pending.get(occurrence.occurrenceToken) !== occurrence) {
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

    const failGeneration: CodexApplicationRequestInboxService["failGeneration"] = (
      occurrence,
      cause,
    ) =>
      SynchronizedRef.get(state).pipe(
        Effect.flatMap((current) => {
          const active = current.generations.get(
            generationKey(occurrence.hostId, occurrence.generation),
          );
          if (!active) return Effect.succeed(false);
          return Deferred.fail(
            active.termination,
            new CodexApplicationConsequenceFailure({
              hostId: occurrence.hostId,
              generation: occurrence.generation,
              occurrenceId: occurrence.occurrenceId,
              cause,
            }),
          );
        }),
      );

    const interpretNotification: CodexApplicationRequestInboxService["interpretNotification"] = (
      occurrence,
      operation,
    ) =>
      Effect.gen(function* () {
        const current = yield* SynchronizedRef.get(state);
        const active = current.generations.get(
          generationKey(occurrence.hostId, occurrence.generation),
        );
        if (!active || active.failed) return { kind: "withdrawn" } as const;
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
        if (current.closed || !active || active.failed) {
          return Effect.succeed([undefined, current] as const);
        }
        const occurrenceToken = current.nextOccurrenceToken;
        const occurrence: CodexApplicationNotificationOccurrence = {
          kind: "notification",
          ...input,
          occurrenceId: `${input.hostId}:${input.generation}:${inboxId}:${occurrenceToken}`,
          occurrenceToken,
        };
        return Queue.offer(occurrences, occurrence).pipe(
          Effect.flatMap((accepted) => {
            if (accepted) {
              return Effect.succeed([
                undefined,
                { ...current, nextOccurrenceToken: current.nextOccurrenceToken + 1 },
              ] as const);
            }
            const generations = new Map(current.generations);
            generations.set(generationKey(input.hostId, input.generation), {
              ...active,
              failed: true,
            });
            return Deferred.fail(
              active.termination,
              new CodexApplicationConsequenceFailure({
                hostId: input.hostId,
                generation: input.generation,
                occurrenceId: occurrence.occurrenceId,
                cause: new CodexApplicationIngressOverflow({
                  channel: "occurrences",
                  capacity: occurrenceCapacity,
                  hostId: input.hostId,
                  generation: input.generation,
                  occurrenceId: occurrence.occurrenceId,
                }),
              }),
            ).pipe(Effect.as([undefined, { ...current, generations }] as const));
          }),
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
      failGeneration,
      interpret,
      interpretNotification,
    });
  });

export const make = makeWithCapacities({ occurrences: 4_096, settlements: 1_024 });
