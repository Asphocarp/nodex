import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import {
  CodexForkSidePanelTransferError,
  CodexForkSidePanelAdapterError,
  make,
  type CodexForkSidePanelSnapshotAdapter,
} from "./CodexForkSidePanelTransferRuntime";

interface TestSnapshot {
  readonly value: string;
}

const makeAdapter = (options?: {
  readonly events?: string[];
  readonly failApply?: () => boolean;
  readonly failRebase?: () => boolean;
}): CodexForkSidePanelSnapshotAdapter<TestSnapshot> => ({
  capture: (sourceConversationId) =>
    Effect.sync(() => {
      options?.events?.push(`capture:${sourceConversationId}`);
      return { value: sourceConversationId };
    }),
  rebase: (snapshot, input) =>
    Effect.gen(function* () {
      options?.events?.push(
        [
          "rebase",
          snapshot.value,
          input.targetConversationId,
          input.sourceWorkspaceRoot ?? "-",
          input.targetWorkspaceRoot ?? "-",
        ].join(":"),
      );
      if (options?.failRebase?.()) {
        return yield* Effect.fail(
          new CodexForkSidePanelAdapterError({ cause: new Error("rebase failed") }),
        );
      }
      return { value: `${snapshot.value}->${input.targetConversationId}` };
    }),
  apply: (snapshot, input) =>
    Effect.gen(function* () {
      options?.events?.push(`apply:${snapshot.value}:${input.targetProjectSessionId}`);
      if (options?.failApply?.()) {
        return yield* Effect.fail(
          new CodexForkSidePanelAdapterError({ cause: new Error("apply failed") }),
        );
      }
    }),
});

it.effect("keeps pending and target namespaces atomic across promotion and consumption", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const runtime = yield* make(makeAdapter()).pipe(Effect.provideService(Scope.Scope, scope));

    yield* runtime.capturePending({
      pendingWorktreeId: "shared",
      sourceConversationId: "source-a",
      sourceWorkspaceRoot: "/source-a",
    });
    yield* runtime.stageDirect({
      sourceConversationId: "source-direct",
      targetConversationId: "shared",
    });
    yield* runtime.capturePending({
      pendingWorktreeId: "shared",
      sourceConversationId: "source-b",
      sourceWorkspaceRoot: "/source-b",
    });

    assert.strictEqual((yield* runtime.getPendingSnapshot("shared"))?.value, "source-b");
    assert.strictEqual(
      (yield* runtime.getTargetSnapshot("shared"))?.value,
      "source-direct->shared",
    );
    assert.isTrue(
      yield* runtime.promotePending({
        pendingWorktreeId: "shared",
        targetConversationId: "target",
        targetWorkspaceRoot: "/target",
      }),
    );
    assert.isNull(yield* runtime.getPendingSnapshot("shared"));
    assert.strictEqual(
      (yield* runtime.consumeTarget({
        routeKind: "local-thread",
        targetConversationId: "target",
        targetProjectSessionId: "session-target",
      }))?.value,
      "source-b->target",
    );
    assert.isNull(yield* runtime.getTargetSnapshot("target"));
  }),
);

it.effect("retains the previous durable slot when rebase or apply fails", () =>
  Effect.gen(function* () {
    let failRebase = false;
    let failApply = false;
    const scope = yield* Scope.make();
    const runtime = yield* make(
      makeAdapter({
        failApply: () => failApply,
        failRebase: () => failRebase,
      }),
    ).pipe(Effect.provideService(Scope.Scope, scope));
    yield* runtime.stageDirect({
      sourceConversationId: "old-source",
      targetConversationId: "target",
    });
    yield* runtime.capturePending({
      pendingWorktreeId: "pending",
      sourceConversationId: "new-source",
      sourceWorkspaceRoot: "/source",
    });

    failRebase = true;
    const rebaseError = yield* Effect.flip(
      runtime.promotePending({
        pendingWorktreeId: "pending",
        targetConversationId: "target",
        targetWorkspaceRoot: "/target",
      }),
    );
    assert.instanceOf(rebaseError, CodexForkSidePanelTransferError);
    assert.strictEqual((rebaseError.cause as Error).message, "rebase failed");
    assert.strictEqual((yield* runtime.getPendingSnapshot("pending"))?.value, "new-source");
    assert.strictEqual((yield* runtime.getTargetSnapshot("target"))?.value, "old-source->target");

    failRebase = false;
    failApply = true;
    const applyError = yield* Effect.flip(
      runtime.consumeTarget({
        routeKind: "local-thread",
        targetConversationId: "target",
        targetProjectSessionId: "session-target",
      }),
    );
    assert.instanceOf(applyError, CodexForkSidePanelTransferError);
    assert.strictEqual((applyError.cause as Error).message, "apply failed");
    assert.strictEqual((yield* runtime.getTargetSnapshot("target"))?.value, "old-source->target");
  }),
);

it.effect("serializes capture transitions instead of racing last completion", () =>
  Effect.gen(function* () {
    const firstStarted = yield* Deferred.make<void>();
    const releaseFirst = yield* Deferred.make<void>();
    const events: string[] = [];
    const scope = yield* Scope.make();
    const runtime = yield* make<TestSnapshot>({
      capture: (sourceConversationId) =>
        Effect.gen(function* () {
          events.push(`capture:${sourceConversationId}`);
          if (sourceConversationId === "source-a") {
            yield* Deferred.succeed(firstStarted, undefined);
            yield* Deferred.await(releaseFirst);
          }
          return { value: sourceConversationId };
        }),
      rebase: (snapshot) => Effect.succeed(snapshot),
      apply: () => Effect.void,
    }).pipe(Effect.provideService(Scope.Scope, scope));

    const first = yield* Effect.forkChild(
      runtime.capturePending({
        pendingWorktreeId: "pending",
        sourceConversationId: "source-a",
        sourceWorkspaceRoot: "/source-a",
      }),
    );
    yield* Deferred.await(firstStarted);
    const second = yield* Effect.forkChild(
      runtime.capturePending({
        pendingWorktreeId: "pending",
        sourceConversationId: "source-b",
        sourceWorkspaceRoot: "/source-b",
      }),
    );
    yield* Effect.yieldNow;
    assert.deepEqual(events, ["capture:source-a"]);

    yield* Deferred.succeed(releaseFirst, undefined);
    yield* Fiber.join(first);
    yield* Fiber.join(second);
    assert.deepEqual(events, ["capture:source-a", "capture:source-b"]);
    assert.strictEqual((yield* runtime.getPendingSnapshot("pending"))?.value, "source-b");
  }),
);

it.effect("closes admission and atomically clears all transfer state with Main Scope", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    const runtime = yield* make(makeAdapter()).pipe(Effect.provideService(Scope.Scope, scope));
    yield* runtime.capturePending({
      pendingWorktreeId: "pending",
      sourceConversationId: "source",
      sourceWorkspaceRoot: "/source",
    });
    yield* runtime.stageDirect({
      sourceConversationId: "source",
      targetConversationId: "target",
    });

    yield* Scope.close(scope, Exit.void);

    assert.isNull(yield* runtime.getPendingSnapshot("pending"));
    assert.isNull(yield* runtime.getTargetSnapshot("target"));
    const error = yield* Effect.flip(runtime.discardPending("pending"));
    assert.strictEqual(error.operation, "admission");
  }),
);

it.effect("rejects an adapter result that returns after the owning Scope has closed", () =>
  Effect.gen(function* () {
    const captureStarted = yield* Deferred.make<void>();
    const releaseCapture = yield* Deferred.make<void>();
    const scope = yield* Scope.make();
    const runtime = yield* make<TestSnapshot>({
      capture: (sourceConversationId) =>
        Deferred.succeed(captureStarted, undefined).pipe(
          Effect.andThen(Deferred.await(releaseCapture)),
          Effect.as({ value: sourceConversationId }),
        ),
      rebase: (snapshot) => Effect.succeed(snapshot),
      apply: () => Effect.void,
    }).pipe(Effect.provideService(Scope.Scope, scope));
    const capture = yield* Effect.forkChild(
      runtime.capturePending({
        pendingWorktreeId: "pending",
        sourceConversationId: "source",
        sourceWorkspaceRoot: "/source",
      }),
    );
    yield* Deferred.await(captureStarted);

    yield* Scope.close(scope, Exit.void);
    yield* Deferred.succeed(releaseCapture, undefined);

    const error = yield* Effect.flip(Fiber.join(capture));
    assert.strictEqual(error.operation, "admission");
    assert.isNull(yield* runtime.getPendingSnapshot("pending"));
  }),
);
