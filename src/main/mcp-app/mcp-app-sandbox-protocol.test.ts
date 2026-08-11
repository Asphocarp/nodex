import { describe, expect, test, vi } from "vitest";
import { buildMcpAppSandboxSourceUrl } from "../../shared/mcp-app/mcp-app-sandbox-contract";
import { createMcpAppSandboxProtocolHandler } from "./mcp-app-sandbox-protocol";

describe("MCP App sandbox protocol", () => {
  test("proxies only the audited Skybridge root and strips ambient headers", async () => {
    const fetch = vi.fn(async () => new Response("<main />", {
      headers: {
        "Content-Security-Policy": "default-src 'none'",
        "Content-Type": "text/html",
        "Set-Cookie": "session=secret",
        "X-Upstream-Internal": "secret",
      },
    }));
    const handler = createMcpAppSandboxProtocolHandler({
      fetch: fetch as never,
    });
    const source = new URL(buildMcpAppSandboxSourceUrl({
      subdomain: "mcp-calendar-fixture",
      locale: "zh-CN",
    }));

    const response = await handler(new Request(source));

    expect(response.status).toBe(200);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("https://web-sandbox.oaiusercontent.com/"),
      { credentials: "omit", redirect: "error" },
    );
    expect(response.headers.get("content-security-policy")).toBe("default-src 'none'");
    expect(response.headers.get("set-cookie")).toBe(null);
    expect(response.headers.get("x-upstream-internal")).toBe(null);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  test("rejects foreign hosts, extra root parameters, and mutation methods", async () => {
    const handler = createMcpAppSandboxProtocolHandler({
      fetch: vi.fn() as never,
    });
    const source = buildMcpAppSandboxSourceUrl({
      subdomain: "mcp-calendar-fixture",
      locale: "zh-CN",
    });

    await expect(handler(new Request(source.replace(
      "web-sandbox.oaiusercontent.com",
      "example.com",
    ))))
      .resolves.toMatchObject({ status: 404 });
    await expect(handler(new Request(source.replace("deviceType=desktop", "deviceType=desktop&extra=1"))))
      .resolves.toMatchObject({ status: 404 });
    await expect(handler(new Request(source, { method: "POST" })))
      .resolves.toMatchObject({ status: 404 });
  });

  test("deduplicates in-flight and warm-cache requests", async () => {
    const fetch = vi.fn(async () => new Response("cached-skybridge", {
      headers: { "Content-Type": "text/html" },
    }));
    const handler = createMcpAppSandboxProtocolHandler({ fetch: fetch as never });
    const source = new URL(buildMcpAppSandboxSourceUrl({
      subdomain: "mcp-cache-fixture",
      locale: "en-cache",
    }));

    const [first, second] = await Promise.all([
      handler(new Request(source)),
      handler(new Request(source)),
    ]);
    await expect(first.text()).resolves.toBe("cached-skybridge");
    await expect(second.text()).resolves.toBe("cached-skybridge");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  test("allows only fingerprinted Skybridge JavaScript and CSS assets", async () => {
    const fetch = vi.fn(async () => new Response("asset", {
      headers: { "Content-Type": "text/javascript" },
    }));
    const handler = createMcpAppSandboxProtocolHandler({ fetch: fetch as never });

    await expect(handler(new Request(
      "nodex-mcp-sandbox://fixture.web-sandbox.oaiusercontent.com/assets/main-abcdefgh.js",
    ))).resolves.toMatchObject({ status: 200 });
    await expect(handler(new Request(
      "nodex-mcp-sandbox://fixture.web-sandbox.oaiusercontent.com/assets/main.js",
    ))).resolves.toMatchObject({ status: 404 });
  });
});
