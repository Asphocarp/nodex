import { describe, expect, test } from "vitest";
import {
  APP_RENDERER_ORIGIN,
  APP_RENDERER_URL,
  buildTopLevelRendererCsp,
} from "./app-renderer-policy";

describe("top-level renderer CSP", () => {
  test("uses the privileged packaged app origin", () => {
    expect(APP_RENDERER_ORIGIN).toBe("app://-");
    expect(APP_RENDERER_URL).toBe("app://-/index.html");
  });

  test("denies by default without inline script or eval", () => {
    const csp = buildTopLevelRendererCsp({ mode: "production" });
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("https://api.statsigcdn.com");
    expect(csp).toContain("https://cloudflare-dns.com");
    expect(csp).toContain("https://prodregistryv2.org");
  });

  test("limits development connections to the Vite origin", () => {
    const csp = buildTopLevelRendererCsp({ mode: "development" });
    expect(csp).toContain("http://localhost:*");
    expect(csp).toContain("ws://localhost:*");
    expect(csp).toContain("http://127.0.0.1:*");
    expect(csp).toContain("sha256-Z2/iFzh9VMlVkEOar1f/oSHWwQk3ve1qk/C2WdsC4Xk=");
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).not.toContain("connect-src *");
  });

  test("narrows development connections to the resolved local Vite origin", () => {
    const csp = buildTopLevelRendererCsp({
      mode: "development",
      developmentOrigin: "http://localhost:51285/",
    });

    expect(csp).toContain("http://localhost:51285");
    expect(csp).toContain("ws://localhost:51285");
    expect(csp).not.toContain("51284");
    expect(csp).not.toContain("localhost:*");
  });

  test("does not trust a non-local development origin", () => {
    const csp = buildTopLevelRendererCsp({
      mode: "development",
      developmentOrigin: "https://example.com:51285/",
    });

    expect(csp).not.toContain("example.com");
    expect(csp).toContain("http://localhost:*");
  });
});
