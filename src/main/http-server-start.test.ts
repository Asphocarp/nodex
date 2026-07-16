import { describe, expect, test } from "vitest";
import { getHttpServerOptions, resolveHttpRequestLogLevel } from "./http-server";

describe("http server startup options", () => {
  test("keeps routine requests at debug while escalating slow and failed requests", () => {
    expect(resolveHttpRequestLogLevel(200, 20)).toBe("debug");
    expect(resolveHttpRequestLogLevel(302, 1_000)).toBe("info");
    expect(resolveHttpRequestLogLevel(404, 20)).toBe("warn");
    expect(resolveHttpRequestLogLevel(500, 20)).toBe("error");
  });

  test("binds to loopback host", () => {
    const options = getHttpServerOptions(51283);

    expect(options.port).toBe(51283);
    expect(options.hostname).toBe("127.0.0.1");
    expect(typeof options.fetch).toBe("function");
  });

  test("emits CORS headers for trusted local dev origins only", async () => {
    const options = getHttpServerOptions(51283);
    const trustedResponse = await options.fetch(
      new Request("http://127.0.0.1:51283/api/not-found", {
        headers: {
          Origin: "http://localhost:51284",
        },
      }),
    );
    const untrustedResponse = await options.fetch(
      new Request("http://127.0.0.1:51283/api/not-found", {
        headers: {
          Origin: "https://evil.example",
        },
      }),
    );

    expect(trustedResponse.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:51284");
    expect(untrustedResponse.headers.get("Access-Control-Allow-Origin")).toBe(null);
  });

  test("rejects mutating requests from untrusted browser origins", async () => {
    const options = getHttpServerOptions(51283);
    const blocked = await options.fetch(
      new Request("http://127.0.0.1:51283/api/not-found", {
        method: "POST",
        headers: {
          Origin: "https://evil.example",
        },
      }),
    );

    expect(blocked.status).toBe(403);
    const payload = await blocked.json() as { error?: string };
    expect(payload.error).toBe("Forbidden origin");
  });

  test("allows mutating requests from trusted local dev origins", async () => {
    const options = getHttpServerOptions(51283);
    const allowed = await options.fetch(
      new Request("http://127.0.0.1:51283/api/not-found", {
        method: "POST",
        headers: {
          Origin: "http://localhost:51284",
        },
      }),
    );

    expect(allowed.status).toBe(404);
  });

  test("does not expose legacy Project history mutation or snapshot routes", async () => {
    const options = getHttpServerOptions(51283);
    const requests = [
      new Request("http://127.0.0.1:51283/api/projects/default/history"),
      new Request(
        "http://127.0.0.1:51283/api/projects/default/history/card?cardId=card-1",
      ),
      new Request(
        "http://127.0.0.1:51283/api/projects/default/history/card-version-preview?cardId=card-1&historyId=1",
      ),
      new Request(
        "http://127.0.0.1:51283/api/projects/default/history/revert",
        { method: "POST" },
      ),
      new Request(
        "http://127.0.0.1:51283/api/projects/default/history/restore",
        { method: "POST" },
      ),
      new Request("http://127.0.0.1:51283/api/projects/default/undo", {
        method: "POST",
      }),
      new Request("http://127.0.0.1:51283/api/projects/default/redo", {
        method: "POST",
      }),
    ];

    const responses = await Promise.all(
      requests.map((request) => options.fetch(request)),
    );
    expect(responses.every((response) => response.status === 404)).toBe(true);
  });

  test("does not expose retired Card title or body snapshot HTTP writes", async () => {
    const options = getHttpServerOptions(51283);
    const responses = await Promise.all([
      options.fetch(
        new Request("http://127.0.0.1:51283/api/projects/project-1/card", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cardId: "card-1", title: "stale title" }),
        }),
      ),
      options.fetch(
        new Request(
          "http://127.0.0.1:51283/api/projects/project-1/card/description?cardId=card-1",
          {
            method: "PUT",
            headers: { "Content-Type": "text/plain; charset=utf-8" },
            body: "stale body",
          },
        ),
      ),
    ]);
    expect(responses[0]?.status).toBe(404);
    expect(responses[1]?.status).toBe(404);
  });
});
