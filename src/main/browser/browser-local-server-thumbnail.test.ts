import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";
import * as TestClock from "effect/testing/TestClock";
import { assert, it } from "@effect/vitest";
import type { BrowserSidebarLocalServerThumbnailResult } from "../../shared/browser-sidebar";
import {
  BrowserLocalServerThumbnailCaptureError,
  makeBrowserLocalServerThumbnailRuntime,
  normalizeLocalServerThumbnailUrl,
} from "./browser-local-server-thumbnail";

it("accepts loopback HTTP(S) routes and rejects remote or credential URLs", () => {
  assert.strictEqual(
    normalizeLocalServerThumbnailUrl("http://localhost:3000/app#state"),
    "http://localhost:3000/app",
  );
  assert.strictEqual(
    normalizeLocalServerThumbnailUrl("https://127.0.0.1:8443/"),
    "https://127.0.0.1:8443/",
  );
  assert.strictEqual(normalizeLocalServerThumbnailUrl("http://[::1]:4173/"), "http://[::1]:4173/");
  assert.isNull(normalizeLocalServerThumbnailUrl("https://example.com/"));
  assert.isNull(normalizeLocalServerThumbnailUrl("http://user:secret@localhost:3000/"));
});

it.effect("coalesces identical work and bounds captures with an Effect semaphore", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const started = yield* Queue.unbounded<{
        readonly url: string;
        readonly release: Deferred.Deferred<string>;
      }>();
      let active = 0;
      let maximumActive = 0;
      let captures = 0;
      const runtime = yield* makeBrowserLocalServerThumbnailRuntime({
        maxConcurrency: 1,
        capture: (url) =>
          Effect.acquireUseRelease(
            Effect.gen(function* () {
              captures += 1;
              active += 1;
              maximumActive = Math.max(maximumActive, active);
              const release = yield* Deferred.make<string>();
              yield* Queue.offer(started, { url, release });
              return release;
            }),
            Deferred.await,
            () =>
              Effect.sync(() => {
                active -= 1;
              }),
          ),
      });

      const first = yield* Effect.forkChild(runtime.get("http://localhost:3000/"));
      const duplicate = yield* Effect.forkChild(runtime.get("http://localhost:3000/"));
      const second = yield* Effect.forkChild(runtime.get("http://localhost:4000/"));
      const firstCapture = yield* Queue.take(started);
      assert.strictEqual(firstCapture.url, "http://localhost:3000/");
      assert.strictEqual(captures, 1);
      yield* Deferred.succeed(firstCapture.release, "data:image/png;base64,first");
      assert.deepInclude(yield* Fiber.join(first), { status: "ready" });
      assert.deepInclude(yield* Fiber.join(duplicate), { status: "ready" });

      const secondCapture = yield* Queue.take(started);
      assert.strictEqual(secondCapture.url, "http://localhost:4000/");
      yield* Deferred.succeed(secondCapture.release, "data:image/png;base64,second");
      assert.deepInclude(yield* Fiber.join(second), { status: "ready" });
      assert.strictEqual(maximumActive, 1);

      assert.deepInclude(yield* runtime.get("http://localhost:3000/"), {
        status: "ready",
        dataUrl: "data:image/png;base64,first",
      });
      assert.strictEqual(captures, 2);
    }),
  ),
);

it.effect("negative-caches failures with the Effect clock and redacts their cause", () =>
  Effect.scoped(
    Effect.gen(function* () {
      let captures = 0;
      const runtime = yield* makeBrowserLocalServerThumbnailRuntime({
        capture: () =>
          Effect.sync(() => {
            captures += 1;
          }).pipe(
            Effect.andThen(
              Effect.fail(
                new BrowserLocalServerThumbnailCaptureError({
                  operation: "test-capture",
                  cause: new Error("private route detail"),
                }),
              ),
            ),
          ),
      });
      const expected = {
        status: "unavailable",
        message: "Local server preview is unavailable",
      } satisfies BrowserSidebarLocalServerThumbnailResult;

      assert.deepEqual(yield* runtime.get("http://localhost:3000/private"), expected);
      assert.deepEqual(yield* runtime.get("http://localhost:3000/private"), expected);
      assert.strictEqual(captures, 1);
      yield* TestClock.adjust("5 seconds");
      assert.deepEqual(yield* runtime.get("http://localhost:3000/private"), expected);
      assert.strictEqual(captures, 2);
    }),
  ),
);

it.effect("interrupts capture cleanup when the Browser runtime Scope closes", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const started = yield* Deferred.make<void>();
    let released = false;
    const runtime = yield* makeBrowserLocalServerThumbnailRuntime({
      capture: () =>
        Effect.acquireUseRelease(
          Effect.void,
          () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)),
          () =>
            Effect.sync(() => {
              released = true;
            }),
        ),
    }).pipe(Scope.provide(scope));
    const fiber = yield* Effect.forkChild(runtime.get("http://localhost:3000/"));
    yield* Deferred.await(started);
    yield* Scope.close(scope, Exit.void);
    assert.isTrue(released);
    yield* Fiber.interrupt(fiber);
  }),
);
