import { describe, expect, test, vi } from "vite-plus/test";
import { buildMcpAppSandboxSourceUrl } from "../../shared/mcp-app/mcp-app-sandbox-contract";
import { McpAppSandboxProtocolCache } from "./mcp-app-sandbox-protocol";

function createHandler(
  fetch: ConstructorParameters<typeof McpAppSandboxProtocolCache>[0] = vi.fn() as never,
) {
  return new McpAppSandboxProtocolCache(fetch).createHandler();
}

describe("MCP App sandbox protocol", () => {
  test("proxies only the audited Skybridge root and strips ambient headers", async () => {
    const fetch = vi.fn(
      async () =>
        new Response("<main />", {
          headers: {
            "Content-Security-Policy": "default-src 'none'",
            "Content-Type": "text/html",
            "Set-Cookie": "session=secret",
            "X-Upstream-Internal": "secret",
          },
        }),
    );
    const handler = createHandler(fetch as never);
    const source = new URL(
      buildMcpAppSandboxSourceUrl({
        subdomain: "mcp-calendar-fixture",
        locale: "zh-CN",
      }),
    );

    const response = await handler(new Request(source));

    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("https://web-sandbox.oaiusercontent.com/"),
      { credentials: "omit", redirect: "error", signal: expect.any(AbortSignal) },
    );
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'");
    expect(response.headers.get("set-cookie")).toBe(null);
    expect(response.headers.get("x-upstream-internal")).toBe(null);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("rejects foreign hosts, extra root parameters, and mutation methods", async () => {
    const handler = createHandler();
    const source = buildMcpAppSandboxSourceUrl({
      subdomain: "mcp-calendar-fixture",
      locale: "zh-CN",
    });

    await expect(
      handler(new Request(source.replace("web-sandbox.oaiusercontent.com", "example.com"))),
    ).resolves.toMatchObject({ status: 404 });
    await expect(
      handler(new Request(source.replace("deviceType=desktop", "deviceType=desktop&extra=1"))),
    ).resolves.toMatchObject({ status: 404 });
    await expect(handler(new Request(source, { method: "POST" }))).resolves.toMatchObject({
      status: 404,
    });
  });

  test("deduplicates in-flight and warm-cache requests", async () => {
    const fetch = vi.fn(
      async () =>
        new Response("cached-skybridge", {
          headers: { "Content-Type": "text/html" },
        }),
    );
    const handler = createHandler(fetch as never);
    const source = new URL(
      buildMcpAppSandboxSourceUrl({
        subdomain: "mcp-cache-fixture",
        locale: "en-cache",
      }),
    );

    const [first, second] = await Promise.all([
      handler(new Request(source)),
      handler(new Request(source)),
    ]);
    await expect(first.text()).resolves.toBe("cached-skybridge");
    await expect(second.text()).resolves.toBe("cached-skybridge");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("allows only fingerprinted Skybridge JavaScript and CSS assets", async () => {
    const fetch = vi.fn(
      async () =>
        new Response("asset", {
          headers: { "Content-Type": "text/javascript" },
        }),
    );
    const handler = createHandler(fetch as never);

    await expect(
      handler(
        new Request(
          "nodex-mcp-sandbox://fixture.web-sandbox.oaiusercontent.com/assets/main-abcdefgh.js",
        ),
      ),
    ).resolves.toMatchObject({ status: 200 });
    await expect(
      handler(
        new Request("nodex-mcp-sandbox://fixture.web-sandbox.oaiusercontent.com/assets/main.js"),
      ),
    ).resolves.toMatchObject({ status: 404 });
  });

  test("isolates caches by coordinator lifetime", async () => {
    const firstFetch = vi.fn(async () => new Response("first"));
    const secondFetch = vi.fn(async () => new Response("second"));
    const first = new McpAppSandboxProtocolCache(firstFetch as never);
    const second = new McpAppSandboxProtocolCache(secondFetch as never);
    const source = buildMcpAppSandboxSourceUrl({
      subdomain: "mcp-scope-fixture",
      locale: "en-scope",
    });

    await expect(
      first
        .createHandler()(new Request(source))
        .then((response) => response.text()),
    ).resolves.toBe("first");
    await expect(
      second
        .createHandler()(new Request(source))
        .then((response) => response.text()),
    ).resolves.toBe("second");
    expect(firstFetch).toHaveBeenCalledTimes(1);
    expect(secondFetch).toHaveBeenCalledTimes(1);
  });

  test("aborts in-flight fetches and rejects later admission when disposed", async () => {
    const fetch = vi.fn(
      async (_url: string, init: RequestInit) =>
        await new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        }),
    );
    const cache = new McpAppSandboxProtocolCache(fetch as never);
    const handler = cache.createHandler();
    const source = buildMcpAppSandboxSourceUrl({
      subdomain: "mcp-dispose-fixture",
      locale: "en-dispose",
    });
    const pending = handler(new Request(source));

    cache.dispose();

    await expect(pending).resolves.toMatchObject({ status: 404 });
    await expect(handler(new Request(source))).resolves.toMatchObject({ status: 404 });
    expect(cache.getState(source)).toBe("cold");
  });
});
