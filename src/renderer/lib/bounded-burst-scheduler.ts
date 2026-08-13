export interface BoundedBurstTiming {
  /** Run after this much inactivity inside one burst. */
  readonly quietMs: number;
  /** Run by this deadline even when the burst never becomes quiet. */
  readonly maxMs: number;
}

export type BurstUrgency = "deferred" | "immediate";

const requireDelay = (value: number, field: string): number => {
  if (Number.isFinite(value) && value >= 0) return value;
  throw new TypeError(`${field} must be a non-negative finite number`);
};

/**
 * Turns an unbounded notification burst into one callback after a quiet period,
 * while the maximum delay keeps continuous input from starving convergence.
 * It owns timing only; callers remain responsible for single-flight I/O and for
 * merging the semantic work represented by the notifications.
 */
export class BoundedBurstScheduler {
  readonly #quietMs: number;
  readonly #maxMs: number;
  readonly #onReady: () => void;

  #quietTimer: ReturnType<typeof setTimeout> | null = null;
  #deadlineTimer: ReturnType<typeof setTimeout> | null = null;
  #queued = false;
  #generation = 0;
  #disposed = false;

  constructor(input: BoundedBurstTiming & { readonly onReady: () => void }) {
    this.#quietMs = requireDelay(input.quietMs, "quietMs");
    this.#maxMs = requireDelay(input.maxMs, "maxMs");
    this.#onReady = input.onReady;
  }

  request(urgency: BurstUrgency = "deferred"): void {
    if (this.#disposed) return;
    // Work arriving before an already-queued microtask is observed by that
    // callback's owner, so it must not leave a redundant timer behind.
    if (this.#queued) return;
    if (urgency === "immediate" || this.#maxMs === 0) {
      this.flush();
      return;
    }

    if (this.#quietTimer !== null) clearTimeout(this.#quietTimer);
    this.#quietTimer = setTimeout(() => this.#queueReady(), this.#quietMs);
    this.#deadlineTimer ??= setTimeout(
      () => this.#queueReady(),
      this.#maxMs,
    );
  }

  flush(): void {
    if (this.#disposed) return;
    this.#queueReady();
  }

  cancel(): void {
    this.#generation += 1;
    this.#queued = false;
    this.#clearTimers();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.cancel();
    this.#disposed = true;
  }

  get scheduled(): boolean {
    return this.#queued
      || this.#quietTimer !== null
      || this.#deadlineTimer !== null;
  }

  #queueReady(): void {
    this.#clearTimers();
    if (this.#queued || this.#disposed) return;
    this.#queued = true;
    const generation = ++this.#generation;
    queueMicrotask(() => {
      if (
        this.#disposed
        || !this.#queued
        || generation !== this.#generation
      ) {
        return;
      }
      this.#queued = false;
      this.#onReady();
    });
  }

  #clearTimers(): void {
    if (this.#quietTimer !== null) clearTimeout(this.#quietTimer);
    if (this.#deadlineTimer !== null) clearTimeout(this.#deadlineTimer);
    this.#quietTimer = null;
    this.#deadlineTimer = null;
  }
}
