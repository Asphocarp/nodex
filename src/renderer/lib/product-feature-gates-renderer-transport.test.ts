import { afterEach, describe, expect, test, vi } from "vitest";

import { browserRendererTransport } from "./browser-renderer-transport";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("product feature gates browser transport", () => {
  test("loads the main-owned gates through the loopback API", async () => {
    let requestedUrl: RequestInfo | URL | null = null;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      requestedUrl = input;
      return new Response(JSON.stringify({
        libraryWorkspace: true,
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      browserRendererTransport.invoke("app:feature-gates:get"),
    ).resolves.toEqual({ libraryWorkspace: true });
    expect(String(requestedUrl)).toContain(
      "/api/app/feature-gates",
    );
  });

  test("rejects malformed gate payloads so app bootstrap can fail closed", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      libraryWorkspace: "yes",
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })));

    await expect(
      browserRendererTransport.invoke("app:feature-gates:get"),
    ).rejects.toThrow();
  });
});
