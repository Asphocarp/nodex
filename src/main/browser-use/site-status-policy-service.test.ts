import { describe, expect, test, vi } from "vitest";
import type { GetAuthStatusResponse } from "@nodex/codex-app-server-protocol";
import {
  BROWSER_USE_SITE_STATUS_CACHE_TTL_MS,
  BrowserUseSiteStatusPolicyService,
  type SiteStatusPolicyServiceDependencies,
} from "./site-status-policy-service";

function authStatus(token: string): GetAuthStatusResponse {
  return {
    authMethod: "chatgpt",
    authToken: token,
    requiresOpenaiAuth: false,
  };
}

function createService(overrides: Partial<SiteStatusPolicyServiceDependencies> = {}): {
  service: BrowserUseSiteStatusPolicyService;
  logger: { warn: ReturnType<typeof vi.fn> };
} {
  const logger = {
    warn: vi.fn(),
  };
  const deps: SiteStatusPolicyServiceDependencies = {
    apiBaseUrl: "https://chatgpt.com/backend-api",
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          feature_status: {
            agent: false,
          },
        }),
        { status: 200 },
      ),
    getAppVersion: () => "0.1.8",
    logger,
    readAuthStatus: async () => authStatus("test-token"),
    ...overrides,
  };
  return {
    service: new BrowserUseSiteStatusPolicyService(deps),
    logger,
  };
}

describe("Browser Use site status policy", () => {
  test("requires a complete HTTP(S) URL and otherwise fails open", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const { service } = createService({ fetchImpl });

    await expect(service.isCommentModeBlocked("example.com")).resolves.toBe(false);
    await expect(service.isCommentModeBlocked("file:///tmp/index.html")).resolves.toBe(false);
    expect(service.cachedCommentModeBlocked("not a URL")).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("sends the full URL and caches a successful decision by normalized hostname", async () => {
    let nowMs = 1_000;
    const requestedUrls: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      requestedUrls.push(url);
      return new Response(
        JSON.stringify({
          feature_status: {
            agent: true,
            page_content: false,
          },
        }),
        { status: 200 },
      );
    });
    const { service } = createService({
      fetchImpl,
      now: () => nowMs,
    });

    await expect(
      service.isCommentModeBlocked("https://www.example.com/private?q=1#section"),
    ).resolves.toBe(true);
    await expect(
      service.isCommentModeBlocked("https://example.com/a-different-page"),
    ).resolves.toBe(true);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const endpoint = new URL(requestedUrls[0] ?? "");
    expect(endpoint.pathname).toBe("/backend-api/aura/site_status");
    expect(endpoint.searchParams.get("site_url")).toBe(
      "https://www.example.com/private?q=1#section",
    );

    nowMs += BROWSER_USE_SITE_STATUS_CACHE_TTL_MS;
    await expect(service.isCommentModeBlocked("https://example.com/after-expiry")).resolves.toBe(
      true,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test("coalesces concurrent checks for the same hostname", async () => {
    let resolveResponse: (response: Response) => void = () => {
      throw new Error("Fetch did not start");
    };
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveResponse = resolve;
        }),
    );
    const { service } = createService({ fetchImpl });

    const first = service.isCommentModeBlocked("https://example.com/first");
    const second = service.isCommentModeBlocked("https://www.example.com/second");
    await vi.waitFor(() => {
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    resolveResponse(
      new Response(
        JSON.stringify({
          feature_status: {
            agent: true,
          },
        }),
        { status: 200 },
      ),
    );

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
  });

  test("refreshes authentication and retries exactly once after a 401", async () => {
    const refreshFlags: boolean[] = [];
    const authorizations: string[] = [];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      authorizations.push(new Headers(init.headers).get("Authorization") ?? "");
      if (authorizations.length === 1) {
        return new Response("unauthorized", { status: 401 });
      }
      return new Response(
        JSON.stringify({
          feature_status: {
            agent: true,
          },
        }),
        { status: 200 },
      );
    });
    const { service } = createService({
      fetchImpl,
      readAuthStatus: async ({ refreshToken }) => {
        refreshFlags.push(refreshToken);
        return authStatus(refreshToken ? "fresh-token" : "stale-token");
      },
    });

    await expect(service.isCommentModeBlocked("https://example.com")).resolves.toBe(true);
    expect(refreshFlags).toEqual([false, true]);
    expect(authorizations).toEqual(["Bearer stale-token", "Bearer fresh-token"]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  test("only blocks strict agent true and does not cache failures", async () => {
    const responses = [
      new Response(
        JSON.stringify({
          feature_status: {
            agent: false,
          },
        }),
        { status: 200 },
      ),
      new Response("not-json", { status: 200 }),
      new Response("server-error", { status: 500 }),
      new Response(
        JSON.stringify({
          feature_status: {
            agent: true,
          },
        }),
        { status: 200 },
      ),
    ];
    const fetchImpl = vi.fn(async () => {
      const response = responses.shift();
      if (!response) throw new Error("Unexpected request");
      return response;
    });
    const falseDecision = createService({ fetchImpl });
    await expect(
      falseDecision.service.isCommentModeBlocked("https://allowed.example"),
    ).resolves.toBe(false);
    await expect(
      falseDecision.service.isCommentModeBlocked("https://allowed.example/path"),
    ).resolves.toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const failureDecision = createService({ fetchImpl });
    await expect(
      failureDecision.service.isCommentModeBlocked("https://failed.example"),
    ).resolves.toBe(false);
    await expect(
      failureDecision.service.isCommentModeBlocked("https://failed.example"),
    ).resolves.toBe(false);
    await expect(
      failureDecision.service.isCommentModeBlocked("https://failed.example"),
    ).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(failureDecision.logger.warn).toHaveBeenCalledTimes(2);
    expect(failureDecision.logger.warn.mock.calls.map(([, fields]) => fields)).toEqual([
      { code: "site-status-request-failed" },
      { code: "site-status-http-error", status: 500 },
    ]);
  });
});
