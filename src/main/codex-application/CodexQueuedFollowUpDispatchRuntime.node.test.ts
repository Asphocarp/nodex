import type { CodexQueuedFollowUp } from "../../shared/types";
import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import {
  CodexQueuedFollowUpDispatchError,
  make,
  type CodexQueuedFollowUpDispatchRuntimeOptions,
} from "./CodexQueuedFollowUpDispatchRuntime";

const followUp = (id = "follow-up-1"): CodexQueuedFollowUp => ({
  followUpId: id,
  threadId: "thread-1",
  prompt: "Continue",
  createdAt: 1,
  collaborationMode: null,
  serviceTier: null,
  pausedReason: null,
});

const options = (
  overrides: Partial<CodexQueuedFollowUpDispatchRuntimeOptions> = {},
): CodexQueuedFollowUpDispatchRuntimeOptions => ({
  isEligible: () => true,
  take: () => followUp(),
  submit: () => Effect.void,
  restore: () => {},
  ...overrides,
});

const waitUntil = (label: string, predicate: () => boolean): Effect.Effect<void> =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (predicate()) return;
      yield* Effect.yieldNow;
    }
    return yield* Effect.die(new Error(`Queued follow-up test did not settle: ${label}`));
  });

it.effect("coalesces duplicate dispatch requests for one Thread", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    let takes = 0;
    let submits = 0;
    const runtime = yield* make(
      options({
        take: () => {
          takes += 1;
          return followUp();
        },
        submit: () =>
          Effect.sync(() => {
            submits += 1;
          }).pipe(
            Effect.andThen(Deferred.succeed(started, undefined)),
            Effect.andThen(Deferred.await(release)),
          ),
      }),
    );
    runtime.request("thread-1");
    yield* Deferred.await(started);
    runtime.request("thread-1");
    assert.strictEqual(takes, 1);
    assert.strictEqual(submits, 1);
    yield* Deferred.succeed(release, undefined);
  }),
);

it.effect("restores a failed follow-up exactly once and allows a later retry", () =>
  Effect.gen(function* () {
    let attempts = 0;
    const restored: string[] = [];
    const runtime = yield* make(
      options({
        submit: () => {
          attempts += 1;
          return attempts === 1
            ? Effect.fail(
                new CodexQueuedFollowUpDispatchError({ cause: new Error("submit failed") }),
              )
            : Effect.void;
        },
        restore: (_threadId, _followUp, reason) => {
          restored.push(reason);
        },
      }),
    );
    runtime.request("thread-1");
    yield* waitUntil("failed dispatch", () => restored.length === 1);
    runtime.request("thread-1");
    yield* waitUntil("dispatch retry", () => attempts === 2);
    assert.deepEqual(restored, ["submit failed"]);
  }),
);

it.effect("does not take a follow-up while the conversation is ineligible", () =>
  Effect.gen(function* () {
    let takes = 0;
    const runtime = yield* make(
      options({
        isEligible: () => false,
        take: () => {
          takes += 1;
          return followUp();
        },
      }),
    );
    runtime.request("thread-1");
    yield* Effect.yieldNow;
    assert.strictEqual(takes, 0);
  }),
);

it.effect("Thread clear and Main Scope close interrupt active dispatch", () =>
  Effect.gen(function* () {
    const ownerScope = yield* Scope.make();
    const started = yield* Deferred.make<void>();
    const interrupted = yield* Deferred.make<void>();
    let restores = 0;
    const runtime = yield* make(
      options({
        submit: () =>
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
          ),
        restore: () => {
          restores += 1;
        },
      }),
    ).pipe(Effect.provideService(Scope.Scope, ownerScope));
    runtime.request("thread-1");
    yield* Deferred.await(started);
    runtime.clear("thread-1");
    yield* Deferred.await(interrupted);
    assert.strictEqual(restores, 0);
    yield* Scope.close(ownerScope, Exit.void);
  }),
);
