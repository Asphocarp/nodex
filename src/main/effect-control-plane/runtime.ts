import { Effect, Fiber, Queue, type Exit } from "effect";

export interface ControlPlaneFiber<A, E> {
  readonly result: Promise<Exit.Exit<A, E>>;
  interrupt(): void;
}

/** The only compatibility seam that starts an Effect control-plane fiber. */
export function forkControlPlane<A, E>(effect: Effect.Effect<A, E>): ControlPlaneFiber<A, E> {
  const fiber = Effect.runFork(effect);
  return {
    result: Effect.runPromise(Fiber.await(fiber)),
    interrupt: () => fiber.interruptUnsafe(),
  };
}

/** Adapt a single Effect result to an existing Promise interface. */
export function runControlPlanePromise<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
  return Effect.runPromise(effect);
}

/** Allocate an ingress queue for a compatibility facade before its worker fiber starts. */
export function makeControlPlaneQueue<A>(): Queue.Queue<A> {
  return Effect.runSync(Queue.unbounded<A>());
}
