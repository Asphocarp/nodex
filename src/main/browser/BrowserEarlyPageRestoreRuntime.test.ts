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
      runtime.start(11, () =>
        Effect.sync(() => {
          started = true;
          return 42;
        }),
      ),
    ).toBe(true);
    expect(started).toBe(true);
    expect(runtime.start(11, () => Effect.succeed(99))).toBe(false);
    expect(yield* runtime.result(11)!.await).toBe(42);

    runtime.release(11);
    expect(runtime.result(11)).toBe(null);
    expect(runtime.start(11, () => Effect.succeed(99))).toBe(true);
    expect(yield* runtime.result(11)!.await).toBe(99);
  }),
);

it.effect("fences a non-cancelable restore continuation when its guest is released", () =>
  Effect.gen(function* () {
    const runtime = yield* makeBrowserEarlyPageRestoreRuntime<number>();
    let resolveRestore!: (value: number) => void;
    let committed = false;
    runtime.start(11, (lease) =>
      Effect.promise<number>(
        () =>
          new Promise<number>((resolve) => {
            resolveRestore = resolve;
          }),
      ).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            if (lease.isActive()) committed = true;
          }),
        ),
      ),
    );
    const result = runtime.result(11)!;

    runtime.release(11);
    resolveRestore(42);
    expect((yield* Effect.exit(result.await))._tag).toBe("Failure");
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
    runtime.start(11, (lease) =>
      Effect.sync(() => {
        restoreLease.current = lease;
      }).pipe(Effect.andThen(Effect.never)),
    );
    expect(restoreLease.current?.isActive()).toBe(true);

    yield* Scope.close(runtimeScope, Exit.void);

    expect(restoreLease.current?.isActive()).toBe(false);
    expect(runtime.result(11)).toBe(null);
    expect(runtime.start(12, () => Effect.succeed(99))).toBe(false);
  }),
);
