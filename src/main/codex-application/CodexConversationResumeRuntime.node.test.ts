import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import type { CodexConversationSnapshot, CodexThreadStreamCheckpoint } from "../../shared/types";
import { CodexConversationResumeError, make } from "./CodexConversationResumeRuntime";

const checkpoint = {
  protocolVersion: 1,
  ownerEpoch: 1,
  revision: 1,
  canonicalHash: "0".repeat(64),
} as CodexThreadStreamCheckpoint;

const inertProjection = {
  snapshot: () => Effect.succeed(null),
  readRendererState: () =>
    Effect.succeed({
      acceptedConversation: null,
      checkpoint: null,
      freshLaunchOwnerClientId: null,
      ownerClientId: null,
      resumeState: null,
      revision: 0,
      serializedConversation: null,
    }),
  isRendererClientDisposed: () => Effect.succeed(false),
  adoptRenderer: () => Effect.succeed({ checkpoint: null, ownerClientId: null, revision: 0 }),
  releaseBuffer: () => Effect.succeed(true),
};

it.effect("coalesces identical per-Thread resume demand", () =>
  Effect.gen(function* () {
    const release = yield* Deferred.make<void>();
    let physicalRuns = 0;
    const runtime = yield* make({
      projection: inertProjection,
      run: () => {
        physicalRuns += 1;
        return Deferred.await(release).pipe(Effect.as(null));
      },
    });
    const first = yield* Effect.forkChild(runtime.resume({ threadId: "thread-1" }), {
      startImmediately: true,
    });
    const second = yield* Effect.forkChild(runtime.resume({ threadId: "thread-1" }), {
      startImmediately: true,
    });
    yield* Effect.yieldNow;
    assert.strictEqual(physicalRuns, 1);
    yield* Deferred.succeed(release, undefined);
    yield* Fiber.join(first);
    yield* Fiber.join(second);
  }),
);

it.effect("serializes incompatible replay demand as an idempotent upgrade", () =>
  Effect.gen(function* () {
    const releaseFirst = yield* Deferred.make<void>();
    const secondStarted = yield* Deferred.make<void>();
    const demands: string[] = [];
    let active = 0;
    let maxActive = 0;
    const runtime = yield* make({
      projection: inertProjection,
      run: (input) =>
        Effect.gen(function* () {
          active += 1;
          maxActive = Math.max(maxActive, active);
          demands.push(
            `${input.syncDormantConversationSnapshots}:${input.replayBufferedNotifications}`,
          );
          if (demands.length === 1) yield* Deferred.await(releaseFirst);
          else yield* Deferred.succeed(secondStarted, undefined);
          active -= 1;
          return null;
        }),
    });
    const adoption = yield* Effect.forkChild(
      runtime.resume({
        threadId: "thread-1",
        syncDormantConversationSnapshots: false,
        replayBufferedNotifications: false,
      }),
      { startImmediately: true },
    );
    const ordinary = yield* Effect.forkChild(runtime.resume({ threadId: "thread-1" }), {
      startImmediately: true,
    });
    yield* Effect.yieldNow;
    assert.deepEqual(demands, ["false:false"]);
    yield* Deferred.succeed(releaseFirst, undefined);
    yield* Fiber.join(adoption);
    yield* Deferred.await(secondStarted);
    yield* Fiber.join(ordinary);
    assert.deepEqual(demands, ["false:false", "true:true"]);
    assert.strictEqual(maxActive, 1);
  }),
);

it.effect("evicts failed work so the next resume can retry", () =>
  Effect.gen(function* () {
    let attempts = 0;
    const runtime = yield* make({
      projection: inertProjection,
      run: () => {
        attempts += 1;
        return attempts === 1
          ? Effect.fail(new CodexConversationResumeError({ cause: new Error("resume failed") }))
          : Effect.succeed(null);
      },
    });
    assert.strictEqual(
      (yield* runtime.resume({ threadId: "thread-1" }).pipe(Effect.result))._tag,
      "Failure",
    );
    yield* runtime.resume({ threadId: "thread-1" });
    assert.strictEqual(attempts, 2);
  }),
);

it.effect("Thread clear and Main Scope close interrupt physical resumes", () =>
  Effect.gen(function* () {
    const ownerScope = yield* Scope.make();
    const runtime = yield* make({ projection: inertProjection, run: () => Effect.never }).pipe(
      Effect.provideService(Scope.Scope, ownerScope),
    );
    const cleared = yield* Effect.forkChild(runtime.resume({ threadId: "thread-1" }), {
      startImmediately: true,
    });
    yield* Effect.yieldNow;
    runtime.clear("thread-1");
    assert.strictEqual((yield* Fiber.await(cleared))._tag, "Failure");

    const closed = yield* Effect.forkChild(runtime.resume({ threadId: "thread-2" }), {
      startImmediately: true,
    });
    yield* Effect.yieldNow;
    yield* Scope.close(ownerScope, Exit.void);
    assert.strictEqual((yield* Fiber.await(closed))._tag, "Failure");
  }),
);

it.effect("serializes renderer adoption and returns the later client as a follower", () =>
  Effect.gen(function* () {
    const conversation = {
      threadId: "thread-1",
      resumeState: "resumed",
    } as CodexConversationSnapshot;
    let acceptedConversation: CodexConversationSnapshot | null = null;
    let ownerClientId: string | null = null;
    let physicalRuns = 0;
    const readState = () => ({
      acceptedConversation,
      checkpoint: acceptedConversation ? checkpoint : null,
      freshLaunchOwnerClientId: null,
      ownerClientId,
      resumeState: acceptedConversation?.resumeState ?? null,
      revision: acceptedConversation ? 1 : 0,
      serializedConversation: acceptedConversation,
    });
    const runtime = yield* make({
      run: () =>
        Effect.sync(() => {
          physicalRuns += 1;
          acceptedConversation = conversation;
          return conversation;
        }),
      projection: {
        ...inertProjection,
        readRendererState: () => Effect.sync(readState),
        adoptRenderer: (input) =>
          Effect.sync(() => {
            ownerClientId = input.ownerClientId;
            return { checkpoint, ownerClientId, revision: 1 };
          }),
      },
    });

    const first = yield* Effect.forkChild(runtime.resumeForRenderer("thread-1", "renderer-a"), {
      startImmediately: true,
    });
    yield* Effect.yieldNow;
    const second = yield* Effect.forkChild(runtime.resumeForRenderer("thread-1", "renderer-b"), {
      startImmediately: true,
    });
    const owner = yield* Fiber.join(first);
    const follower = yield* Fiber.join(second);

    assert.strictEqual(physicalRuns, 1);
    assert.strictEqual(owner?.role, "owner");
    assert.strictEqual(follower?.role, "follower");
    if (follower?.role === "follower") {
      assert.strictEqual(follower.ownerClientId, "renderer-a");
    }
  }),
);

it.effect("keeps explicit buffer release behind renderer adoption for the same Thread", () =>
  Effect.gen(function* () {
    const resumeRelease = yield* Deferred.make<void>();
    const order: string[] = [];
    const conversation = {
      threadId: "thread-1",
      resumeState: "resumed",
    } as CodexConversationSnapshot;
    let acceptedConversation: CodexConversationSnapshot | null = null;
    let ownerClientId: string | null = null;
    const runtime = yield* make({
      run: () =>
        Deferred.await(resumeRelease).pipe(
          Effect.tap(() =>
            Effect.sync(() => {
              acceptedConversation = conversation;
              order.push("resume");
            }),
          ),
          Effect.as(conversation),
        ),
      projection: {
        ...inertProjection,
        readRendererState: () =>
          Effect.sync(() => ({
            acceptedConversation,
            checkpoint: acceptedConversation ? checkpoint : null,
            freshLaunchOwnerClientId: null,
            ownerClientId,
            resumeState: acceptedConversation?.resumeState ?? null,
            revision: acceptedConversation ? 1 : 0,
            serializedConversation: acceptedConversation,
          })),
        adoptRenderer: (input) =>
          Effect.sync(() => {
            ownerClientId = input.ownerClientId;
            order.push("adopt");
            return { checkpoint, ownerClientId, revision: 1 };
          }),
        releaseBuffer: () => Effect.sync(() => order.push("release")).pipe(Effect.as(true)),
      },
    });
    const adoption = yield* Effect.forkChild(runtime.resumeForRenderer("thread-1", "renderer-a"), {
      startImmediately: true,
    });
    const release = yield* Effect.forkChild(runtime.releaseBuffer("thread-1"), {
      startImmediately: true,
    });
    yield* Effect.yieldNow;
    assert.deepEqual(order, []);
    yield* Deferred.succeed(resumeRelease, undefined);
    yield* Fiber.join(adoption);
    yield* Fiber.join(release);
    assert.deepEqual(order, ["resume", "adopt", "release"]);
  }),
);
