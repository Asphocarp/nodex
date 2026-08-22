import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import { expect } from "vite-plus/test";
import {
  makeBrowserEarlyPageRestoreRuntime,
  type BrowserEarlyPageRestoreLease,
} from "./BrowserEarlyPageRestoreRuntime";

it.effect("starts restoration synchronously and keeps its result until guest release", () =>
  Effect.gen(function* () {
    const runtime = yield* makeBrowserEarlyPageRestoreRuntime<number>();
    let started = false;
    expect(
      runtime.start(11, async () => {
        started = true;
        return 42;
      }),
    ).toBe(true);
    expect(started).toBe(true);
    expect(runtime.start(11, async () => 99)).toBe(false);
    yield* Effect.promise(() => expect(runtime.result(11)?.promise).resolves.toBe(42));

    runtime.release(11);
    expect(runtime.result(11)).toBe(null);
    expect(runtime.start(11, async () => 99)).toBe(true);
    yield* Effect.promise(() => expect(runtime.result(11)?.promise).resolves.toBe(99));
  }),
);

it.effect("fences a non-cancelable restore continuation when its guest is released", () =>
  Effect.gen(function* () {
    const runtime = yield* makeBrowserEarlyPageRestoreRuntime<number>();
    let resolveRestore!: (value: number) => void;
    let committed = false;
    runtime.start(11, async (lease) => {
      const value = await new Promise<number>((resolve) => {
        resolveRestore = resolve;
      });
      if (lease.isActive()) committed = true;
      return value;
    });
    const result = runtime.result(11)!;
    const interrupted = result.promise.then(
      () => false,
      () => true,
    );

    runtime.release(11);
    resolveRestore(42);
    yield* Effect.promise(() => Promise.resolve());

    expect(yield* Effect.promise(() => interrupted)).toBe(true);
    expect(committed).toBe(false);
    expect(runtime.result(11)).toBe(null);
  }),
);

it.effect("closes admission and fences every restore with its Scope", () =>
  Effect.gen(function* () {
    const parentScope = yield* Scope.Scope;
    const runtimeScope = yield* Scope.fork(parentScope);
    const runtime = yield* makeBrowserEarlyPageRestoreRuntime<number>().pipe(
      Scope.provide(runtimeScope),
    );
    const restoreLease: { current: BrowserEarlyPageRestoreLease | null } = { current: null };
    runtime.start(11, async (lease) => {
      restoreLease.current = lease;
      await new Promise(() => undefined);
      return 42;
    });
    runtime.result(11)!.promise.catch(() => undefined);
    expect(restoreLease.current?.isActive()).toBe(true);

    yield* Scope.close(runtimeScope, Exit.void);

    expect(restoreLease.current?.isActive()).toBe(false);
    expect(runtime.result(11)).toBe(null);
    expect(runtime.start(12, async () => 99)).toBe(false);
  }),
);
