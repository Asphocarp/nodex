import { describe, expect, test } from "bun:test";

function restoreWindow(originalWindowDescriptor: PropertyDescriptor | undefined): void {
  delete (globalThis as { window?: unknown }).window;
  if (originalWindowDescriptor) {
    Object.defineProperty(globalThis, "window", originalWindowDescriptor);
  }
}

describe("renderer api transport", () => {
  test("uses the Electron bridge even when window.api appears after import", async () => {
    const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    delete (globalThis as { window?: unknown }).window;

    try {
      const { invoke } = await import(`./api?transport-test=${Date.now()}`);
      const invokeCalls: unknown[][] = [];

      Object.defineProperty(globalThis, "window", {
        configurable: true,
        writable: true,
        value: {
          api: {
            invoke: async (...args: unknown[]) => {
              invokeCalls.push(args);
              return "ok";
            },
          },
        },
      });

      const result = await invoke("window:new");

      expect(result).toBe("ok");
      expect(JSON.stringify(invokeCalls)).toBe(JSON.stringify([
        ["window:new"],
      ]));
    } finally {
      restoreWindow(originalWindowDescriptor);
    }
  });

  test("updateCardDescription stages chunks without splitting surrogate pairs", async () => {
    const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    const calls: unknown[][] = [];

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      writable: true,
      value: {
        api: {
          invoke: async (channel: string, ...args: unknown[]) => {
            calls.push([channel, ...args]);
            if (channel === "card:description:update:start") return { stagingId: "stage-1" };
            if (channel === "card:description:update:chunk") return { ok: true, bytes: 0 };
            if (channel === "card:description:update:finish") {
              return {
                status: "updated",
                projectId: "project-1",
                cardId: "card-1",
                revision: 2,
                summary: null,
                changedFields: ["description"],
                didMutate: true,
              };
            }
            throw new Error(`Unexpected channel: ${channel}`);
          },
        },
      },
    });

    try {
      const { updateCardDescription } = await import(`./api?description-chunks-test=${Date.now()}`);
      const description = `${"a".repeat((16 * 1024) - 1)}🙂tail`;

      const result = await updateCardDescription({
        projectId: "project-1",
        columnId: "draft",
        cardId: "card-1",
        description,
        expectedRevision: 1,
      });

      const chunks = calls
        .filter((call) => call[0] === "card:description:update:chunk")
        .map((call) => call[2] as string);
      const firstChunk = chunks[0] ?? "";
      const firstChunkLastCodeUnit = firstChunk.charCodeAt(firstChunk.length - 1);

      expect(result.status).toBe("updated");
      expect(chunks.length).toBe(2);
      expect(firstChunkLastCodeUnit >= 0xd800 && firstChunkLastCodeUnit <= 0xdbff).toBeFalse();
      expect(chunks.join("")).toBe(description);
      expect(JSON.stringify(calls[0]?.[1]).includes("description")).toBeFalse();
    } finally {
      restoreWindow(originalWindowDescriptor);
    }
  });

  test("updateCardDescription aborts staging after a chunk failure", async () => {
    const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
    const calls: unknown[][] = [];

    Object.defineProperty(globalThis, "window", {
      configurable: true,
      writable: true,
      value: {
        api: {
          invoke: async (channel: string, ...args: unknown[]) => {
            calls.push([channel, ...args]);
            if (channel === "card:description:update:start") return { stagingId: "stage-2" };
            if (channel === "card:description:update:chunk") throw new Error("chunk failed");
            if (channel === "card:description:update:abort") return true;
            throw new Error(`Unexpected channel: ${channel}`);
          },
        },
      },
    });

    try {
      const { updateCardDescription } = await import(`./api?description-abort-test=${Date.now()}`);
      let errorMessage = "";

      try {
        await updateCardDescription({
          projectId: "project-1",
          columnId: "draft",
          cardId: "card-1",
          description: "body",
        });
      } catch (error) {
        errorMessage = error instanceof Error ? error.message : String(error);
      }

      expect(errorMessage).toBe("chunk failed");
      expect(calls.some((call) => call[0] === "card:description:update:abort")).toBeTrue();
    } finally {
      restoreWindow(originalWindowDescriptor);
    }
  });
});
