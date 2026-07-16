import { describe, expect, test } from "vitest";
import { BootstrapRuntimeEventQueue } from "./bootstrap-events";

describe("BootstrapRuntimeEventQueue", () => {
  test("queues events before runtime attach and replays them in order", async () => {
    const queue = new BootstrapRuntimeEventQueue();
    const events: string[] = [];

    await queue.enqueueOpenUrl("nodex://pages/card-1");
    await queue.enqueueSecondInstance(["nodex://sessions/session-1"]);

    await queue.attachController({
      handleOpenUrl: (url) => {
        events.push(`url:${url}`);
      },
      handleSecondInstance: (argv) => {
        events.push(`argv:${argv.join(",")}`);
      },
    });

    expect(events.join("|")).toBe("url:nodex://pages/card-1|argv:nodex://sessions/session-1");
  });

  test("dispatches directly after runtime attach", async () => {
    const queue = new BootstrapRuntimeEventQueue();
    const events: string[] = [];

    await queue.attachController({
      handleOpenUrl: (url) => {
        events.push(`url:${url}`);
      },
      handleSecondInstance: (argv) => {
        events.push(`argv:${argv.length}`);
      },
    });
    await queue.enqueueOpenUrl("nodex://pages/card-2");

    expect(events.join("|")).toBe("url:nodex://pages/card-2");
  });

  test("exposes pending startup events without attaching runtime", async () => {
    const queue = new BootstrapRuntimeEventQueue();

    await queue.enqueueOpenUrl("nodex://pages/card-1");
    await queue.enqueueSecondInstance(["--flag"]);

    const pending = queue.takePendingEvents();
    expect(pending.length).toBe(2);
    expect(queue.takePendingEvents().length).toBe(0);
  });
});
