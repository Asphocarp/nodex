import { Effect } from "effect";

/** The scripts compatibility seam that starts an Effect control-plane program. */
export const runScriptControlPlanePromise = <A, E>(effect: Effect.Effect<A, E>): Promise<A> =>
  Effect.runPromise(effect);
