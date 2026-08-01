import { describe, expect, test } from "vitest";

import { cleanupBrowserRuntime } from "./probe-browser-runtime";

describe("Browser runtime probe cleanup", () => {
  test("attempts every teardown operation and preserves the first failure", async () => {
    const events: string[] = [];

    await expect(cleanupBrowserRuntime({
      closeNativePipeServer: async () => {
        events.push("close-pipe");
        throw new Error("pipe close failed");
      },
      removeStateHome: () => {
        events.push("remove-profile");
      },
      stopClient: async () => {
        events.push("stop-client");
        throw new Error("client stop failed");
      },
    })).rejects.toThrow("client stop failed");

    expect(events).toEqual(["stop-client", "close-pipe", "remove-profile"]);
  });
});
