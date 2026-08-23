import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import {
  CodexQueuedFollowUpRuntimeError,
  make,
  type CodexQueuedFollowUpRuntimeOptions,
} from "./CodexQueuedFollowUpRuntime";

const failure = (threadId: string, followUpId: string, message = "submit failed") =>
  new CodexQueuedFollowUpRuntimeError({
    operation: "submit",
    threadId,
    followUpId,
    cause: new Error(message),
  });

const options = (
  overrides: Partial<CodexQueuedFollowUpRuntimeOptions> = {},
): CodexQueuedFollowUpRuntimeOptions => ({
  isSubmissionEligible: () => true,
  submit: () => Effect.void,
  project: () => undefined,
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

it.effect("owns queue creation, ordering, removal, and projection", () =>
  Effect.gen(function* () {
    const projections: string[][] = [];
    const runtime = yield* make(
      options({
        project: (_threadId, entries) => {
          projections.push(entries.map((entry) => entry.prompt));
        },
      }),
    );
    const firstId = yield* runtime.enqueue({
      threadId: " thread-1 ",
      prompt: " First ",
      serviceTier: "standard",
    });
    const secondId = yield* runtime.enqueue({
      threadId: "thread-1",
      prompt: "Second",
      serviceTier: "fast",
    });

    assert.deepEqual(
      runtime.list("thread-1").map((entry) => [entry.prompt, entry.serviceTier]),
      [
        ["First", null],
        ["Second", "fast"],
      ],
    );
    yield* runtime.reorder("thread-1", [secondId, secondId, firstId]);
    assert.deepEqual(
      runtime.list("thread-1").map((entry) => entry.followUpId),
      [secondId, firstId],
    );
    assert.isTrue(yield* runtime.remove("thread-1", secondId));
    assert.isFalse(yield* runtime.remove("thread-1", "missing"));
    assert.deepEqual(projections.at(-1), ["First"]);
  }),
);

it.effect("coalesces duplicate dispatch requests for one Thread", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    let submits = 0;
    const runtime = yield* make(
      options({
        submit: () =>
          Effect.sync(() => {
            submits += 1;
          }).pipe(
            Effect.andThen(Deferred.succeed(started, undefined)),
            Effect.andThen(Deferred.await(release)),
          ),
      }),
    );
    yield* runtime.enqueue({ threadId: "thread-1", prompt: "Continue" });
    runtime.request("thread-1");
    yield* Deferred.await(started);
    runtime.request("thread-1");
    assert.strictEqual(submits, 1);
    assert.deepEqual(runtime.list("thread-1"), []);
    yield* Deferred.succeed(release, undefined);
  }),
);

it.effect("restores one failed dispatch as paused and permits an explicit retry", () =>
  Effect.gen(function* () {
    let attempts = 0;
    const runtime = yield* make(
      options({
        submit: (_threadId, followUp) => {
          attempts += 1;
          return attempts === 1
            ? Effect.fail(failure(followUp.threadId, followUp.followUpId))
            : Effect.void;
        },
      }),
    );
    yield* runtime.enqueue({ threadId: "thread-1", prompt: "Continue" });
    runtime.request("thread-1");
    yield* waitUntil("failed dispatch", () => runtime.list("thread-1").length === 1);
    assert.strictEqual(runtime.list("thread-1")[0]?.pausedReason, "submit failed");
    assert.isTrue(runtime.clearPaused("thread-1"));
    runtime.request("thread-1");
    yield* waitUntil("dispatch retry", () => attempts === 2);
    assert.deepEqual(runtime.list("thread-1"), []);
  }),
);

it.effect("does not claim a follow-up while canonical turn state is ineligible", () =>
  Effect.gen(function* () {
    let submits = 0;
    const runtime = yield* make(
      options({
        isSubmissionEligible: () => false,
        submit: () =>
          Effect.sync(() => {
            submits += 1;
          }),
      }),
    );
    yield* runtime.enqueue({ threadId: "thread-1", prompt: "Continue" });
    runtime.request("thread-1");
    yield* Effect.yieldNow;
    assert.strictEqual(submits, 0);
    assert.strictEqual(runtime.list("thread-1").length, 1);
  }),
);

it.effect("restores a failed manual send-now transaction", () =>
  Effect.gen(function* () {
    const runtime = yield* make(
      options({
        submit: (_threadId, followUp) =>
          Effect.fail(failure(followUp.threadId, followUp.followUpId, "offline")),
      }),
    );
    const followUpId = yield* runtime.enqueue({ threadId: "thread-1", prompt: "Continue" });
    const exit = yield* Effect.exit(runtime.sendNow("thread-1", followUpId));

    assert.isTrue(Exit.isFailure(exit));
    assert.strictEqual(runtime.list("thread-1")[0]?.pausedReason, "offline");
  }),
);

it.effect("queue reset does not interrupt an already claimed submission", () =>
  Effect.gen(function* () {
    const started = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const runtime = yield* make(
      options({
        submit: (_threadId, followUp) =>
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Deferred.await(release)),
            Effect.andThen(Effect.fail(failure(followUp.threadId, followUp.followUpId))),
          ),
      }),
    );
    yield* runtime.enqueue({ threadId: "thread-1", prompt: "Continue" });
    runtime.request("thread-1");
    yield* Deferred.await(started);
    runtime.reset("thread-1");
    assert.deepEqual(runtime.list("thread-1"), []);
    yield* Deferred.succeed(release, undefined);
    yield* waitUntil("failed submission restoration", () => runtime.list("thread-1").length === 1);
    assert.strictEqual(runtime.list("thread-1")[0]?.pausedReason, "submit failed");
  }),
);

it.effect("Thread clear and Main Scope close fence interrupted claims", () =>
  Effect.gen(function* () {
    const ownerScope = yield* Scope.make();
    const started = yield* Deferred.make<void>();
    const interrupted = yield* Deferred.make<void>();
    const projections: number[] = [];
    const runtime = yield* make(
      options({
        project: (_threadId, entries) => {
          projections.push(entries.length);
        },
        submit: () =>
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() => Deferred.succeed(interrupted, undefined)),
          ),
      }),
    ).pipe(Effect.provideService(Scope.Scope, ownerScope));
    yield* runtime.enqueue({ threadId: "thread-1", prompt: "Continue" });
    runtime.request("thread-1");
    yield* Deferred.await(started);
    runtime.clear("thread-1");
    yield* Deferred.await(interrupted);
    assert.deepEqual(runtime.list("thread-1"), []);
    assert.deepEqual(projections, [1, 0]);

    yield* Scope.close(ownerScope, Exit.void);
    const enqueueAfterClose = yield* Effect.exit(
      runtime.enqueue({ threadId: "thread-1", prompt: "Late" }),
    );
    assert.isTrue(Exit.isFailure(enqueueAfterClose));
    assert.deepEqual(runtime.list("thread-1"), []);
  }),
);
