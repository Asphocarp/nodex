import { describe, expect, test } from "vitest";

import type { CardDetailCommandResult } from "../../shared/card-detail";
import { browserRendererTransport } from "./browser-renderer-transport";
import {
  createElectronRendererTransport,
  type ElectronRendererBridge,
} from "./electron-renderer-transport";

const missing: CardDetailCommandResult = {
  ok: false,
  error: {
    code: "card_not_found",
    message: "Card does not exist in the requested Project",
    retryable: false,
  },
};

describe("Card Detail renderer transport", () => {
  test("preserves the typed not-found result across browser HTTP and Electron IPC", async () => {
    const originalFetch = globalThis.fetch;
    let capturedUrl = "";
    globalThis.fetch = (async (input) => {
      capturedUrl = String(input);
      return new Response(JSON.stringify(missing), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    try {
      const browserResult = await browserRendererTransport.invoke(
        "card:get",
        "project/one",
        "card/one",
      );
      expect(browserResult).toEqual(missing);
      expect(capturedUrl).toContain(
        "/api/projects/project%2Fone/card?cardId=card%2Fone",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }

    const calls: Array<{ readonly channel: string; readonly args: unknown[] }> = [];
    const bridge = {
      invoke: async (channel: string, ...args: unknown[]) => {
        calls.push({ channel, args });
        return missing;
      },
    } as unknown as ElectronRendererBridge;
    const electronResult = await createElectronRendererTransport(bridge).invoke(
      "card:get",
      "project/one",
      "card/one",
    );
    expect(electronResult).toEqual(missing);
    expect(calls).toEqual([
      {
        channel: "card:get",
        args: ["project/one", "card/one"],
      },
    ]);
  });
});
