import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import { assert, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import { buildMcpAppSandboxSourceUrl } from "../../shared/mcp-app/mcp-app-sandbox-contract";
import { makeMcpAppSandboxProtocolCache } from "./mcp-app-sandbox-protocol";

const makeCache = (fetch: Electron.Net["fetch"]) =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const cache = yield* makeMcpAppSandboxProtocolCache(fetch).pipe(
      Effect.provideService(Scope.Scope, scope),
    );
    return { cache, scope };
  });

const sourceUrl = (subdomain: string, locale: string) =>
  buildMcpAppSandboxSourceUrl({ subdomain, locale });

it.effect("proxies only the audited Skybridge root and strips ambient headers", () =>
  Effect.gen(function* () {
    const requests: Array<[string, RequestInit]> = [];
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      requests.push([url, init]);
      return new Response("<main />", {
        headers: {
          "Content-Security-Policy": "default-src 'none'",
          "Content-Type": "text/html",
          "Set-Cookie": "session=secret",
          "X-Upstream-Internal": "secret",
        },
      });
    });
    const { cache, scope } = yield* makeCache(fetch as never);
    const response = yield* Effect.promise(() =>
      cache.createHandler()(new Request(sourceUrl("mcp-calendar-fixture", "zh-CN"))),
    );

    assert.strictEqual(response.status, 200);
    assert.strictEqual(fetch.mock.calls.length, 1);
    assert.include(requests[0]![0], "https://web-sandbox.oaiusercontent.com/");
    const init = requests[0]![1];
    assert.strictEqual(init.credentials, "omit");
    assert.strictEqual(init.redirect, "error");
    assert.instanceOf(init.signal, AbortSignal);
    assert.strictEqual(response.headers.get("content-security-policy"), "default-src 'none'");
    assert.isNull(response.headers.get("set-cookie"));
    assert.isNull(response.headers.get("x-upstream-internal"));
    assert.strictEqual(response.headers.get("x-content-type-options"), "nosniff");
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("rejects foreign hosts, extra root parameters, and mutation methods", () =>
  Effect.gen(function* () {
    const { cache, scope } = yield* makeCache(vi.fn() as never);
    const handler = cache.createHandler();
    const source = sourceUrl("mcp-calendar-fixture", "zh-CN");
    const responses = yield* Effect.promise(() =>
      Promise.all([
        handler(new Request(source.replace("web-sandbox.oaiusercontent.com", "example.com"))),
        handler(new Request(source.replace("deviceType=desktop", "deviceType=desktop&extra=1"))),
        handler(new Request(source, { method: "POST" })),
      ]),
    );
    assert.deepEqual(
      responses.map((response) => response.status),
      [404, 404, 404],
    );
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("deduplicates in-flight and warm-cache requests", () =>
  Effect.gen(function* () {
    const fetch = vi.fn(
      async () =>
        new Response("cached-skybridge", {
          headers: { "Content-Type": "text/html" },
        }),
    );
    const { cache, scope } = yield* makeCache(fetch as never);
    const handler = cache.createHandler();
    const source = sourceUrl("mcp-cache-fixture", "en-cache");
    const [first, second] = yield* Effect.promise(() =>
      Promise.all([handler(new Request(source)), handler(new Request(source))]),
    );

    assert.strictEqual(yield* Effect.promise(() => first.text()), "cached-skybridge");
    assert.strictEqual(yield* Effect.promise(() => second.text()), "cached-skybridge");
    assert.strictEqual(fetch.mock.calls.length, 1);
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("coalesces prewarm and marks the complete runtime asset graph warm", () =>
  Effect.gen(function* () {
    const fetch = vi.fn(async (url: string) => {
      if (url.includes("/assets/main-abcdefgh.js")) {
        return new Response('import "/assets/run-widget-code-abcdefgh.js"');
      }
      if (url.includes("/assets/run-widget-code-abcdefgh.js")) {
        return new Response("export const ready = true");
      }
      return new Response('<script src="/assets/main-abcdefgh.js"></script>');
    });
    const { cache, scope } = yield* makeCache(fetch as never);

    yield* Effect.promise(() => Promise.all([cache.prewarm("en-US"), cache.prewarm("en-US")]));

    assert.strictEqual(fetch.mock.calls.length, 3);
    assert.strictEqual(cache.getState(sourceUrl("mcp-prewarm-fixture", "en-US")), "warm");
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("allows only fingerprinted Skybridge JavaScript and CSS assets", () =>
  Effect.gen(function* () {
    const fetch = vi.fn(
      async () => new Response("asset", { headers: { "Content-Type": "text/javascript" } }),
    );
    const { cache, scope } = yield* makeCache(fetch as never);
    const handler = cache.createHandler();
    const [allowed, denied] = yield* Effect.promise(() =>
      Promise.all([
        handler(
          new Request(
            "nodex-mcp-sandbox://fixture.web-sandbox.oaiusercontent.com/assets/main-abcdefgh.js",
          ),
        ),
        handler(
          new Request("nodex-mcp-sandbox://fixture.web-sandbox.oaiusercontent.com/assets/main.js"),
        ),
      ]),
    );
    assert.strictEqual(allowed.status, 200);
    assert.strictEqual(denied.status, 404);
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("isolates caches by coordinator lifetime", () =>
  Effect.gen(function* () {
    const firstFetch = vi.fn(async () => new Response("first"));
    const secondFetch = vi.fn(async () => new Response("second"));
    const first = yield* makeCache(firstFetch as never);
    const second = yield* makeCache(secondFetch as never);
    const source = sourceUrl("mcp-scope-fixture", "en-scope");

    const [firstResponse, secondResponse] = yield* Effect.promise(() =>
      Promise.all([
        first.cache
          .createHandler()(new Request(source))
          .then((response) => response.text()),
        second.cache
          .createHandler()(new Request(source))
          .then((response) => response.text()),
      ]),
    );
    assert.strictEqual(firstResponse, "first");
    assert.strictEqual(secondResponse, "second");
    assert.strictEqual(firstFetch.mock.calls.length, 1);
    assert.strictEqual(secondFetch.mock.calls.length, 1);
    yield* Scope.close(first.scope, Exit.void);
    yield* Scope.close(second.scope, Exit.void);
  }),
);

it.effect("aborts in-flight fetches and rejects later admission when released", () =>
  Effect.gen(function* () {
    const fetch = vi.fn(
      async (_url: string, init: RequestInit) =>
        await new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        }),
    );
    const { cache, scope } = yield* makeCache(fetch as never);
    const handler = cache.createHandler();
    const source = sourceUrl("mcp-dispose-fixture", "en-dispose");
    const pending = handler(new Request(source));

    yield* Effect.yieldNow;
    yield* Scope.close(scope, Exit.void);
    assert.strictEqual((yield* Effect.promise(() => pending)).status, 404);
    assert.strictEqual((yield* Effect.promise(() => handler(new Request(source)))).status, 404);
    assert.strictEqual(cache.getState(source), "cold");
  }),
);
