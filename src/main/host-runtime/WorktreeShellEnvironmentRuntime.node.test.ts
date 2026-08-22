import { assert, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import * as Exit from "effect/Exit";
import { live, WorktreeShellEnvironmentRuntime } from "./WorktreeShellEnvironmentRuntime";

it.effect("coalesces discovery within one Scope and rejects admission after release", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    let loads = 0;
    const context = yield* Layer.buildWithScope(
      live({
        baseEnvironment: { PATH: "/usr/bin" },
        platform: "darwin",
        loadInteractiveEnvironment: async () => {
          loads += 1;
          return { PATH: "/opt/bin:/usr/bin" };
        },
      }),
      scope,
    );
    const runtime = Context.get(context, WorktreeShellEnvironmentRuntime);
    const [first, second] = yield* Effect.all([runtime.load, runtime.load], {
      concurrency: "unbounded",
    });
    assert.strictEqual(first.PATH, "/opt/bin:/usr/bin");
    assert.strictEqual(second.PATH, "/opt/bin:/usr/bin");
    assert.strictEqual(loads, 1);

    yield* Scope.close(scope, Exit.void);
    const afterClose = yield* Effect.result(runtime.load);
    assert.strictEqual(afterClose._tag, "Failure");
  }),
);

it.effect("interrupts active discovery when its Scope closes", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const context = yield* Layer.buildWithScope(
      live({
        baseEnvironment: { PATH: "/usr/bin" },
        platform: "darwin",
        loadInteractiveEnvironment: (signal) =>
          new Promise<NodeJS.ProcessEnv>((_resolve, reject) => {
            markStarted?.();
            signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
          }),
      }),
      scope,
    );
    const runtime = Context.get(context, WorktreeShellEnvironmentRuntime);
    const fiber = yield* Effect.forkChild(runtime.load);
    yield* Effect.promise(() => started);
    yield* Scope.close(scope, Exit.void);
    const exit = yield* Fiber.await(fiber);
    assert.strictEqual(exit._tag, "Failure");
  }),
);

it.effect("keeps shared discovery alive when one caller stops waiting", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    let markStarted: (() => void) | undefined;
    let finish: ((environment: NodeJS.ProcessEnv) => void) | undefined;
    let aborted = false;
    let loads = 0;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const context = yield* Layer.buildWithScope(
      live({
        baseEnvironment: { PATH: "/usr/bin" },
        platform: "darwin",
        loadInteractiveEnvironment: (signal) =>
          new Promise<NodeJS.ProcessEnv>((resolve, reject) => {
            loads += 1;
            finish = resolve;
            markStarted?.();
            signal?.addEventListener(
              "abort",
              () => {
                aborted = true;
                reject(signal.reason);
              },
              { once: true },
            );
          }),
      }),
      scope,
    );
    const runtime = Context.get(context, WorktreeShellEnvironmentRuntime);
    const first = yield* Effect.forkChild(runtime.load);
    yield* Effect.promise(() => started);
    yield* Fiber.interrupt(first);

    assert.isFalse(aborted);
    finish?.({ PATH: "/opt/bin:/usr/bin" });
    const environment = yield* runtime.load;
    assert.strictEqual(environment.PATH, "/opt/bin:/usr/bin");
    assert.strictEqual(loads, 1);
    yield* Scope.close(scope, Exit.void);
  }),
);
