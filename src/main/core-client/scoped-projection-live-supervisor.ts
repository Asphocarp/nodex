import { projectionScopeKey, type ProjectionScope } from "../../shared/projection-stream";
import type {
  CoreEventEnvelope,
  CoreProjectionEventSubscription,
  ProjectionLiveBarrier,
  ProjectionLiveRepair,
} from "./types";

export interface ScopedProjectionLiveSupervisorInput {
  readonly open: (
    scopes: readonly ProjectionScope[],
    onEvent: (event: CoreEventEnvelope) => void,
    onRepair: (repair: ProjectionLiveRepair) => void,
    signal: AbortSignal,
  ) => Promise<CoreProjectionEventSubscription>;
  readonly onPacket: (event: CoreEventEnvelope) => void;
  readonly onBarrier: (
    barrier: ProjectionLiveBarrier,
    scopes: readonly ProjectionScope[],
    resetScopes: readonly ProjectionScope[],
  ) => void;
  readonly onRepair: (repair: ProjectionLiveRepair) => void;
  readonly onError?: (error: unknown) => void;
  readonly retryDelayMs?: number;
}

interface ActiveLease {
  readonly abort: AbortController;
  readonly scopes: readonly ProjectionScope[];
  readonly subscription: CoreProjectionEventSubscription;
  generation: number;
}

const MAX_OPENING_BUFFER = 512;

const canonicalScopes = (
  scopes: readonly ProjectionScope[],
): readonly ProjectionScope[] => {
  const canonical = [...new Map(
    scopes.map((scope) => [projectionScopeKey(scope), scope]),
  ).entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, scope]) => scope);
  if (canonical.length > 200) {
    throw new RangeError("Projection live broker supports at most 200 scopes");
  }
  return canonical;
};

const sameScopes = (
  left: readonly ProjectionScope[],
  right: readonly ProjectionScope[],
): boolean => left.length === right.length
  && left.every((scope, index) =>
    projectionScopeKey(scope) === projectionScopeKey(right[index]!)
  );

const addedScopes = (
  previous: readonly ProjectionScope[],
  next: readonly ProjectionScope[],
): readonly ProjectionScope[] => {
  const existing = new Set(previous.map(projectionScopeKey));
  return next.filter((scope) => !existing.has(projectionScopeKey(scope)));
};

const delay = async (milliseconds: number, signal: AbortSignal): Promise<void> => {
  if (signal.aborted) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, milliseconds);
    signal.addEventListener("abort", () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
  });
};

/**
 * Owns one multiplexed Core Projection broker. Scope changes are
 * make-before-break: the old lease remains live until the replacement has
 * installed its receiver and produced a barrier. Existing scopes therefore
 * need no canonical reset; only newly added scopes repair to the new floor.
 * An actual interruption has no overlap proof and resets every active scope.
 */
export class ScopedProjectionLiveSupervisor {
  readonly #input: ScopedProjectionLiveSupervisorInput;
  readonly #retryDelayMs: number;
  #scopes: readonly ProjectionScope[] = [];
  #generation = 0;
  #connectingAbort: AbortController | null = null;
  #active: ActiveLease | null = null;
  #stopped = false;

  constructor(input: ScopedProjectionLiveSupervisorInput) {
    this.#input = input;
    this.#retryDelayMs = Math.max(10, Math.floor(input.retryDelayMs ?? 250));
  }

  setScopes(scopes: readonly ProjectionScope[]): void {
    if (this.#stopped) return;
    const next = canonicalScopes(scopes);
    if (sameScopes(this.#scopes, next)) return;
    this.#scopes = next;
    this.#generation += 1;
    this.#connectingAbort?.abort();
    this.#connectingAbort = null;
    if (next.length === 0) {
      this.#closeActive();
      return;
    }
    if (this.#active && sameScopes(this.#active.scopes, next)) {
      this.#active.generation = this.#generation;
      return;
    }
    this.#startReplacement(this.#generation, next);
  }

  stop(): void {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#generation += 1;
    this.#connectingAbort?.abort();
    this.#connectingAbort = null;
    this.#closeActive();
    this.#scopes = [];
  }

  diagnostics(): {
    readonly activeScopes: number;
    readonly connected: boolean;
    readonly generation: number;
  } {
    return {
      activeScopes: this.#scopes.length,
      connected: this.#active !== null,
      generation: this.#generation,
    };
  }

  #startReplacement(
    generation: number,
    scopes: readonly ProjectionScope[],
  ): void {
    const abort = new AbortController();
    this.#connectingAbort = abort;
    void this.#connect(generation, scopes, abort).catch((error: unknown) => {
      if (abort.signal.aborted || generation !== this.#generation) return;
      this.#input.onError?.(error);
    });
  }

  async #connect(
    generation: number,
    scopes: readonly ProjectionScope[],
    abort: AbortController,
  ): Promise<void> {
    while (
      !abort.signal.aborted
      && !this.#stopped
      && generation === this.#generation
    ) {
      const bufferedPackets: CoreEventEnvelope[] = [];
      const bufferedRepairs: ProjectionLiveRepair[] = [];
      let activated = false;
      let attemptClosed = false;
      let openingFailure: Error | null = null;
      let subscription: CoreProjectionEventSubscription | null = null;
      try {
        subscription = await this.#input.open(
          scopes,
          (event) => {
            if (attemptClosed || abort.signal.aborted) return;
            if (activated) {
              this.#input.onPacket(event);
              return;
            }
            if (generation !== this.#generation || openingFailure) return;
            if (
              bufferedPackets.length + bufferedRepairs.length
              >= MAX_OPENING_BUFFER
            ) {
              openingFailure = new Error(
                "Projection live opening buffer exceeded its bound",
              );
              return;
            }
            bufferedPackets.push(event);
          },
          (repair) => {
            if (attemptClosed || abort.signal.aborted) return;
            if (activated) {
              this.#input.onRepair(repair);
              return;
            }
            if (generation !== this.#generation || openingFailure) return;
            if (
              bufferedPackets.length + bufferedRepairs.length
              >= MAX_OPENING_BUFFER
            ) {
              openingFailure = new Error(
                "Projection live opening buffer exceeded its bound",
              );
              return;
            }
            bufferedRepairs.push(repair);
          },
          abort.signal,
        );
        if (
          abort.signal.aborted
          || this.#stopped
          || generation !== this.#generation
        ) {
          subscription.close();
          return;
        }
        if (openingFailure) throw openingFailure;

        const previous = this.#active;
        const resetScopes = previous
          ? addedScopes(previous.scopes, scopes)
          : scopes;
        const lease: ActiveLease = { abort, generation, scopes, subscription };
        this.#input.onBarrier(subscription.barrier, scopes, resetScopes);
        activated = true;
        for (const packet of bufferedPackets) this.#input.onPacket(packet);
        for (const repair of bufferedRepairs) this.#input.onRepair(repair);
        this.#active = lease;
        if (this.#connectingAbort === abort) this.#connectingAbort = null;
        if (previous) this.#closeLease(previous);
        void subscription.done.then(
          () => this.#leaseEnded(lease, null),
          (error: unknown) => this.#leaseEnded(lease, error),
        );
        return;
      } catch (error) {
        attemptClosed = true;
        subscription?.close();
        if (abort.signal.aborted || generation !== this.#generation) return;
        this.#input.onError?.(error);
        await delay(this.#retryDelayMs, abort.signal);
      }
    }
  }

  #leaseEnded(
    lease: ActiveLease,
    error: unknown,
  ): void {
    if (this.#active !== lease) return;
    this.#active = null;
    this.#closeLease(lease);
    if (error !== null && !this.#stopped) this.#input.onError?.(error);
    if (
      this.#stopped
      || lease.generation !== this.#generation
      || this.#scopes.length === 0
    ) return;
    const generation = lease.generation;
    const reconnectAbort = new AbortController();
    this.#connectingAbort = reconnectAbort;
    void delay(this.#retryDelayMs, reconnectAbort.signal).then(() => {
      if (
        reconnectAbort.signal.aborted
        || generation !== this.#generation
        || this.#stopped
      ) return;
      this.#startReplacement(generation, this.#scopes);
    });
  }

  #closeActive(): void {
    const active = this.#active;
    this.#active = null;
    if (active) this.#closeLease(active);
  }

  #closeLease(lease: ActiveLease): void {
    lease.abort.abort();
    lease.subscription.close();
  }
}
