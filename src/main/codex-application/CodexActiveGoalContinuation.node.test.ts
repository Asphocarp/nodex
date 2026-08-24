import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import * as TestClock from "effect/testing/TestClock";
import type { ConversationEntityState } from "./internal/ConversationEntityState";
import { make } from "./CodexActiveGoalContinuation";
import { CodexThreadGoalRuntime } from "./CodexThreadGoalRuntime";
import { CodexThreadSettingsRuntime } from "./CodexThreadSettingsRuntime";
import { CodexTurnCommands } from "./CodexTurnCommands";
import { ConversationEntityMap } from "./internal/ConversationEntityMap";

const activeConversation = (): ConversationEntityState =>
  ({
    readResumeState: () => "resumed",
    readSnapshot: () => ({
      threadGoal: { status: "active" },
      latestThreadSettings: { summary: "detailed" },
      pendingSteers: [],
      statusType: "idle",
      statusActiveFlags: [],
    }),
    readCanonicalState: () => ({ turns: [] }),
    readServerRequests: () => [],
    readStreamRole: () => "owner",
    isStreaming: () => true,
  }) as unknown as ConversationEntityState;

const makeRuntime = (input: {
  readonly eligible: () => boolean;
  readonly continueGoal: () => Effect.Effect<void>;
}) =>
  make.pipe(
    Effect.provideService(
      ConversationEntityMap,
      ConversationEntityMap.of({
        current: () => (input.eligible() ? activeConversation() : null),
      } as unknown as ConversationEntityMap["Service"]),
    ),
    Effect.provideService(
      CodexThreadSettingsRuntime,
      CodexThreadSettingsRuntime.of({
        awaitCurrent: () => Effect.void,
        update: () => Effect.die("the active fixture already has the canonical summary"),
        remoteUpdateSupport: () => "supported",
      } as unknown as CodexThreadSettingsRuntime["Service"]),
    ),
    Effect.provideService(
      CodexThreadGoalRuntime,
      CodexThreadGoalRuntime.of({
        set: () => input.continueGoal().pipe(Effect.as(null)),
      } as unknown as CodexThreadGoalRuntime["Service"]),
    ),
    Effect.provideService(
      CodexTurnCommands,
      CodexTurnCommands.of({
        continueGoal: () => Effect.die("supported settings continue through thread/goal/set"),
      } as unknown as CodexTurnCommands["Service"]),
    ),
  );

it.effect("coalesces callers behind one delayed semantic continuation", () =>
  Effect.gen(function* () {
    let attempts = 0;
    const release = yield* Deferred.make<void>();
    const runtime = yield* makeRuntime({
      eligible: () => true,
      continueGoal: () =>
        Effect.sync(() => {
          attempts += 1;
        }).pipe(Effect.andThen(Deferred.await(release))),
    });
    yield* runtime.request("thread-1");
    yield* runtime.request("thread-1");

    yield* TestClock.adjust("249 millis");
    assert.strictEqual(attempts, 0);
    yield* TestClock.adjust("1 millis");
    assert.strictEqual(attempts, 1);
    yield* Deferred.succeed(release, undefined);
    yield* Effect.yieldNow;
  }),
);

it.effect("rechecks canonical eligibility after the continuation delay", () =>
  Effect.gen(function* () {
    let eligible = true;
    let attempts = 0;
    const runtime = yield* makeRuntime({
      eligible: () => eligible,
      continueGoal: () => Effect.sync(() => void (attempts += 1)),
    });
    yield* runtime.request("thread-1");
    eligible = false;
    yield* TestClock.adjust("1 second");
    assert.strictEqual(attempts, 0);
  }),
);

it.effect("clears a pending keyed continuation", () =>
  Effect.gen(function* () {
    let attempts = 0;
    const runtime = yield* makeRuntime({
      eligible: () => true,
      continueGoal: () => Effect.sync(() => void (attempts += 1)),
    });
    yield* runtime.request("thread-1");
    yield* runtime.clear("thread-1");
    yield* TestClock.adjust("1 minute");
    assert.strictEqual(attempts, 0);
  }),
);

it.effect("interrupts active continuation work when its Scope closes", () =>
  Effect.gen(function* () {
    const scope = yield* Scope.make();
    let attempts = 0;
    let interrupted = false;
    const release = yield* Deferred.make<void>();
    const runtime = yield* makeRuntime({
      eligible: () => true,
      continueGoal: () => {
        attempts += 1;
        return Deferred.await(release).pipe(
          Effect.onInterrupt(() => Effect.sync(() => void (interrupted = true))),
        );
      },
    }).pipe(Effect.provideService(Scope.Scope, scope));
    yield* runtime.request("thread-1");
    yield* TestClock.adjust("250 millis");
    assert.strictEqual(attempts, 1);
    yield* Scope.close(scope, Exit.void);
    assert.isTrue(interrupted);
  }),
);
