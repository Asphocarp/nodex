import type { CodexOwnerNotificationDrainRuntimePromiseAdapter } from "../codex-application/CodexOwnerNotificationDrainRuntime";

interface TestBarrier {
  readonly sentSequence: number;
  readonly ackSequence: number;
  readonly promise: Promise<void>;
  readonly resolve: () => void;
  readonly reject: (reason: unknown) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

interface TestDrainState {
  sentSequence: number;
  ackSequence: number;
  barrier: TestBarrier | null;
}

/** Mutable vertical harness used only by the legacy CodexService test suite. */
export class TestCodexOwnerNotificationDrainRuntime implements CodexOwnerNotificationDrainRuntimePromiseAdapter {
  readonly #states = new Map<string, TestDrainState>();

  constructor(private readonly timeoutMs: number) {}

  next(conversationId: string): number {
    const state = this.#stateFor(conversationId);
    state.sentSequence += 1;
    return state.sentSequence;
  }

  ack(conversationId: string, sequence: number): void {
    const state = this.#stateFor(conversationId);
    if (sequence <= state.ackSequence) return;
    state.ackSequence = sequence;
    if (!state.barrier || state.ackSequence < state.sentSequence) return;
    this.#finishBarrier(state);
  }

  awaitCurrent(conversationId: string): Promise<void> {
    const state = this.#stateFor(conversationId);
    if (state.ackSequence >= state.sentSequence) return Promise.resolve();
    if (state.barrier) return state.barrier.promise;

    let resolve!: () => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<void>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });
    const barrier: TestBarrier = {
      sentSequence: state.sentSequence,
      ackSequence: state.ackSequence,
      promise,
      resolve,
      reject,
      timer: setTimeout(() => {
        if (state.barrier !== barrier) return;
        state.ackSequence = Math.max(state.ackSequence, barrier.sentSequence);
        state.barrier = null;
        barrier.resolve();
      }, this.timeoutMs),
    };
    state.barrier = barrier;
    return promise;
  }

  resetOwner(conversationId: string): void {
    const state = this.#stateFor(conversationId);
    state.ackSequence = state.sentSequence;
    this.#finishBarrier(state);
  }

  release(conversationId: string): void {
    const state = this.#states.get(conversationId);
    this.#states.delete(conversationId);
    this.#finishBarrier(state);
  }

  clear(conversationId: string): void {
    const state = this.#states.get(conversationId);
    this.#states.delete(conversationId);
    const barrier = state?.barrier;
    if (!barrier) return;
    clearTimeout(barrier.timer);
    state.barrier = null;
    barrier.reject(new Error(`Owner notification drain cleared for '${conversationId}'`));
  }

  dispose(): void {
    for (const conversationId of [...this.#states.keys()]) this.clear(conversationId);
  }

  #stateFor(conversationId: string): TestDrainState {
    const existing = this.#states.get(conversationId);
    if (existing) return existing;
    const state: TestDrainState = {
      sentSequence: 0,
      ackSequence: 0,
      barrier: null,
    };
    this.#states.set(conversationId, state);
    return state;
  }

  #finishBarrier(state: TestDrainState | undefined): void {
    const barrier = state?.barrier;
    if (!state || !barrier) return;
    clearTimeout(barrier.timer);
    state.barrier = null;
    barrier.resolve();
  }
}
