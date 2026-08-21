import * as Runtime from "effect/Runtime";

/**
 * Runs a process whose termination signals are owned by the Effect program.
 *
 * Unlike NodeRuntime.runMain, this runner does not install SIGINT/SIGTERM
 * handlers that can interrupt a domain shutdown transaction halfway through.
 */
export const runProcessMain = Runtime.makeRunMain(({ fiber, teardown }) => {
  fiber.addObserver((exit) => {
    teardown(exit, (code) => {
      if (process.exitCode === undefined) process.exitCode = code;
    });
  });
});
