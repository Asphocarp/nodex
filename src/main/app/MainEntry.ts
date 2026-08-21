import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import type * as Effect from "effect/Effect";

/** The only production Effect runtime entry for the Electron Main process. */
export const runMain = <E>(program: Effect.Effect<void, E>): void =>
  NodeRuntime.runMain(program, { disableErrorReporting: true });
