import * as Effect from "effect/Effect";
import { assert, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import { makeBrowserSiteInfoRuntime } from "./browser-site-info-provider";

const identity = {
  browserConversationId: "conversation",
  browserViewScopeId: "scope",
  browserTabId: "tab",
};

it.effect("returns Main-owned origin, cookie count, and fail-closed permissions", () =>
  Effect.gen(function* () {
    const cookies = { get: vi.fn(async () => [{}, {}]) };
    const runtime = makeBrowserSiteInfoRuntime(
      { getTabSnapshot: () => ({ url: "https://example.com/path?private=1" }) },
      cookies,
    );

    const siteInfo = yield* runtime.get(identity);
    assert.deepInclude(siteInfo, {
      ...identity,
      origin: "https://example.com",
      connection: "secure",
      cookieCount: 2,
    });
    assert.deepInclude(siteInfo.permissions, { permission: "camera", state: "block" });
    assert.deepInclude(siteInfo.permissions, { permission: "notifications", state: "block" });
    assert.deepEqual(cookies.get.mock.calls[0], [{ url: "https://example.com/path?private=1" }]);
  }),
);

it.effect("classifies localhost separately from insecure remote HTTP", () =>
  Effect.gen(function* () {
    const cookieStore = { get: async () => [] };
    const local = makeBrowserSiteInfoRuntime(
      { getTabSnapshot: () => ({ url: "http://localhost:3000/" }) },
      cookieStore,
    );
    const remote = makeBrowserSiteInfoRuntime(
      { getTabSnapshot: () => ({ url: "http://example.com/" }) },
      cookieStore,
    );

    assert.strictEqual((yield* local.get(identity)).connection, "local");
    assert.strictEqual((yield* remote.get(identity)).connection, "insecure");
  }),
);
