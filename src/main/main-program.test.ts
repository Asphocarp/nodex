import { describe, expect, test } from "vite-plus/test";
import { runMainProgram, type MainProgramDependencies } from "./main-program";

// oxlint-disable effecttsgo/async-function -- these tests exercise the public Promise facade.

function makeDependencies(input?: {
  readonly runtimeStartError?: Error;
  readonly runtimeStopError?: Error;
}): {
  readonly dependencies: MainProgramDependencies;
  readonly events: string[];
  readonly readShutdownRequest: () => (() => Promise<void>) | null;
} {
  const events: string[] = [];
  let shutdownRequest: (() => Promise<void>) | null = null;
  return {
    dependencies: {
      acquireServices: () => {
        events.push("services:acquire");
        return {
          release: () => {
            events.push("services:release");
          },
        };
      },
      startRuntime: async (context) => {
        events.push("runtime:start");
        shutdownRequest = context.requestShutdown ?? null;
        if (input?.runtimeStartError) throw input.runtimeStartError;
        return {
          handleOpenUrl: (url) => url === "nodex://page/one",
          handleSecondInstance: (argv) => argv.includes("--new-window"),
          shutdown: async () => {
            events.push("runtime:stop");
            if (input?.runtimeStopError) throw input.runtimeStopError;
          },
        };
      },
    },
    events,
    readShutdownRequest: () => shutdownRequest,
  };
}

describe("MainProgram", () => {
  test("acquires services before runtime and closes one process scope idempotently", async () => {
    const harness = makeDependencies();
    const controller = await runMainProgram(
      { initialArgv: ["electron", "."], startupEvents: [] },
      harness.dependencies,
    );

    expect(harness.events).toEqual(["services:acquire", "runtime:start"]);
    expect(controller.handleOpenUrl("nodex://page/one")).toBe(true);
    expect(controller.handleSecondInstance(["--new-window"])).toBe(true);

    await Promise.all([controller.shutdown(), harness.readShutdownRequest()?.()]);
    await controller.shutdown();

    expect(harness.events).toEqual([
      "services:acquire",
      "runtime:start",
      "runtime:stop",
      "services:release",
    ]);
  });

  test("rolls back activated services when runtime startup fails", async () => {
    const startupError = new Error("runtime failed to start");
    const harness = makeDependencies({ runtimeStartError: startupError });

    await expect(
      runMainProgram({ initialArgv: ["electron", "."] }, harness.dependencies),
    ).rejects.toBe(startupError);
    expect(harness.events).toEqual(["services:acquire", "runtime:start", "services:release"]);
  });

  test("runs every finalizer when runtime shutdown fails", async () => {
    const harness = makeDependencies({ runtimeStopError: new Error("runtime stop failed") });
    const controller = await runMainProgram(
      { initialArgv: ["electron", "."] },
      harness.dependencies,
    );

    await expect(controller.shutdown()).rejects.toThrow("runtime stop failed");
    expect(harness.events).toEqual([
      "services:acquire",
      "runtime:start",
      "runtime:stop",
      "services:release",
    ]);
  });
});
