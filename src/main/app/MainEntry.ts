import type * as Effect from "effect/Effect";
import { runProcessMain } from "./EffectProcessEntry";

/** The only production Effect runtime entry for the Electron Main process. */
export const runMain = <E>(program: Effect.Effect<void, E>): void =>
  runProcessMain(program, { disableErrorReporting: true });
