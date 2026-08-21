import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import { assert, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import {
  BROWSER_USE_SITE_STATUS_CACHE_TTL_MS,
  makeSiteStatusPolicyRuntime,
  type SiteStatusPolicyRuntimeDependencies,
} from "./site-status-policy-service";

const response = (agent: boolean) =>
  new Response(JSON.stringify({ feature_status: { agent } }), { status: 200 });

const makeRuntime = (overrides: Partial<SiteStatusPolicyRuntimeDependencies> = {}) =>
  Effect.gen(function* () {
    const logger = { warn: vi.fn() };
    const scope = yield* Scope.make();
    const dependencies: SiteStatusPolicyRuntimeDependencies = {
      apiBaseUrl: "https://chatgpt.com/backend-api",
      logger,
      request: () => Effect.succeed(response(false)),
      ...overrides,
    };
    const runtime = yield* makeSiteStatusPolicyRuntime(dependencies).pipe(
      Effect.provideService(Scope.Scope, scope),
    );
    return { logger, runtime, scope };
  });

it.effect("requires a complete HTTP(S) URL and otherwise fails open", () =>
  Effect.gen(function* () {
    let requests = 0;
    const { runtime, scope } = yield* makeRuntime({
      request: () => Effect.sync(() => (requests += 1)).pipe(Effect.as(response(false))),
    });

    assert.isFalse(yield* runtime.isCommentModeBlocked("example.com"));
    assert.isFalse(yield* runtime.isCommentModeBlocked("file:///tmp/index.html"));
    assert.isFalse(runtime.cachedCommentModeBlocked("not a URL"));
    assert.strictEqual(requests, 0);
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("sends the full URL and caches a successful decision by normalized hostname", () =>
  Effect.gen(function* () {
    let nowMs = 1_000;
    const inputs: Array<{ path: string; refreshOn401: boolean | undefined }> = [];
    const { runtime, scope } = yield* makeRuntime({
      now: () => nowMs,
      request: (input) =>
        Effect.sync(() => {
          inputs.push({ path: input.path, refreshOn401: input.refreshOn401 });
          return response(true);
        }),
    });

    assert.isTrue(
      yield* runtime.isCommentModeBlocked("https://www.example.com/private?q=1#section"),
    );
    assert.isTrue(yield* runtime.isCommentModeBlocked("https://example.com/other"));
    assert.lengthOf(inputs, 1);
    const endpoint = new URL(inputs[0]!.path, "https://chatgpt.com");
    assert.strictEqual(
      endpoint.searchParams.get("site_url"),
      "https://www.example.com/private?q=1#section",
    );
    assert.isTrue(inputs[0]!.refreshOn401);

    nowMs += BROWSER_USE_SITE_STATUS_CACHE_TTL_MS;
    assert.isTrue(yield* runtime.isCommentModeBlocked("https://example.com/after-expiry"));
    assert.lengthOf(inputs, 2);
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("coalesces concurrent checks for the same hostname", () =>
  Effect.gen(function* () {
    const pending = yield* Deferred.make<Response>();
    let requests = 0;
    const { runtime, scope } = yield* makeRuntime({
      request: () =>
        Effect.sync(() => {
          requests += 1;
        }).pipe(Effect.andThen(Deferred.await(pending))),
    });
    const first = yield* Effect.forkChild(
      runtime.isCommentModeBlocked("https://example.com/first"),
      { startImmediately: true },
    );
    const second = yield* Effect.forkChild(
      runtime.isCommentModeBlocked("https://www.example.com/second"),
      { startImmediately: true },
    );
    yield* Effect.yieldNow;
    assert.strictEqual(requests, 1);
    yield* Deferred.succeed(pending, response(true));
    assert.deepEqual(yield* Effect.all([Fiber.await(first), Fiber.await(second)]), [
      Exit.succeed(true),
      Exit.succeed(true),
    ]);
    yield* Scope.close(scope, Exit.void);
  }),
);

it.effect("caches valid false decisions but retries malformed and failed responses", () =>
  Effect.gen(function* () {
    const responses = [
      response(false),
      new Response("not-json", { status: 200 }),
      new Response("server-error", { status: 500 }),
      response(true),
    ];
    let requests = 0;
    const request = () =>
      Effect.sync(() => {
        requests += 1;
        const next = responses.shift();
        if (next === undefined) throw new Error("Unexpected request");
        return next;
      });

    const first = yield* makeRuntime({ request });
    assert.isFalse(yield* first.runtime.isCommentModeBlocked("https://allowed.example"));
    assert.isFalse(yield* first.runtime.isCommentModeBlocked("https://allowed.example/path"));
    assert.strictEqual(requests, 1);
    yield* Scope.close(first.scope, Exit.void);

    const second = yield* makeRuntime({ request });
    assert.isFalse(yield* second.runtime.isCommentModeBlocked("https://failed.example"));
    assert.isFalse(yield* second.runtime.isCommentModeBlocked("https://failed.example"));
    assert.isTrue(yield* second.runtime.isCommentModeBlocked("https://failed.example"));
    assert.strictEqual(requests, 4);
    assert.deepEqual(
      second.logger.warn.mock.calls.map(([, fields]) => fields),
      [{ code: "site-status-request-failed" }, { code: "site-status-http-error", status: 500 }],
    );
    yield* Scope.close(second.scope, Exit.void);
  }),
);
