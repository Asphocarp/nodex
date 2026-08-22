import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";
import { assert, it } from "@effect/vitest";
import { makeBrowserLocalServerRuntime } from "./browser-local-server-runtime";

it.effect("discovers terminal routes and owns hide/remove state immutably", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const invalidated: string[] = [];
      const runtime = yield* makeBrowserLocalServerRuntime({
        fetch: () => Effect.succeed(new Response(null, { status: 204 })),
        invalidateThumbnail: (url) => Effect.sync(() => void invalidated.push(url ?? "all")),
      });
      yield* runtime.observePtyData(
        "project-1",
        'ready at http://localhost:3000/app and "https://example.com/not-local"',
      );

      const discovered = yield* runtime.snapshot("project-1");
      assert.lengthOf(discovered.servers, 1);
      assert.deepInclude(discovered.servers[0], {
        origin: "http://localhost:3000",
        online: true,
      });
      assert.deepInclude(discovered.servers[0]?.routes[0], {
        id: "http://localhost:3000/app",
        path: "/app",
      });
      assert.deepEqual(invalidated, ["http://localhost:3000", "http://localhost:3000/app"]);

      yield* runtime.applyCommand({
        type: "hide-local-server",
        projectId: "project-1",
        server: discovered.servers[0]!,
      });
      assert.isTrue((yield* runtime.snapshot("project-1")).servers[0]?.hidden);
      yield* runtime.applyCommand({
        type: "remove-local-server-route",
        projectId: "project-1",
        serverUrl: "http://localhost:3000",
        routeUrl: "/app",
      });
      assert.isEmpty((yield* runtime.snapshot("project-1")).servers[0]?.routes ?? []);
      yield* runtime.applyCommand({
        type: "unhide-local-server",
        projectId: "project-1",
        url: "http://localhost:3000",
      });
      assert.isFalse((yield* runtime.snapshot("project-1")).servers[0]?.hidden);

      yield* runtime.closeProject("project-1");
      assert.isEmpty((yield* runtime.snapshot("project-1")).servers);
    }),
  ),
);

it.effect("uses an Effect deadline and ignores superseded refresh generations", () =>
  Effect.scoped(
    Effect.gen(function* () {
      let calls = 0;
      const runtime = yield* makeBrowserLocalServerRuntime({
        fetch: () => {
          calls += 1;
          return calls === 1 ? Effect.never : Effect.succeed(new Response(null, { status: 204 }));
        },
        invalidateThumbnail: () => Effect.void,
      });
      yield* runtime.observePtyData("project-1", "http://localhost:3000/");
      const first = yield* Effect.forkChild(
        runtime.applyCommand({ type: "local-servers-refresh", projectId: "project-1" }),
        { startImmediately: true },
      );
      yield* Effect.yieldNow;
      assert.isTrue((yield* runtime.snapshot("project-1")).isLoading);

      yield* runtime.applyCommand({ type: "local-servers-refresh", projectId: "project-1" });
      assert.isTrue((yield* runtime.snapshot("project-1")).servers[0]?.online);
      yield* TestClock.adjust("750 millis");
      yield* Fiber.join(first);
      const snapshot = yield* runtime.snapshot("project-1");
      assert.isFalse(snapshot.isLoading);
      assert.isTrue(snapshot.servers[0]?.online);
    }),
  ),
);
