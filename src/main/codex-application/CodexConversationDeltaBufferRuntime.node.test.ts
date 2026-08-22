import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Scope from "effect/Scope";
import * as TestClock from "effect/testing/TestClock";
import type { CodexCommandOutputUpdate } from "../../shared/codex-conversation-state/codex-command-output-queue";
import type { CodexFrameTextDeltaUpdate } from "../../shared/codex-conversation-state/codex-frame-text-delta-queue";
import { make } from "./CodexConversationDeltaBufferRuntime";

const frame = (
  delta: string,
  overrides: Partial<CodexFrameTextDeltaUpdate> = {},
): CodexFrameTextDeltaUpdate => ({
  conversationId: "thread-1",
  turnId: "turn-1",
  itemId: "item-1",
  target: { type: "agentMessage" },
  delta,
  ...overrides,
});

const output = (
  delta: string,
  overrides: Partial<CodexCommandOutputUpdate> = {},
): CodexCommandOutputUpdate => ({
  conversationId: "thread-1",
  turnId: "turn-1",
  itemId: "item-1",
  delta,
  ...overrides,
});

it.effect("coalesces frame-text keys behind one non-resetting Effect interval", () =>
  Effect.gen(function* () {
    const flushes: ReadonlyArray<CodexFrameTextDeltaUpdate>[] = [];
    const runtime = yield* make({
      flushFrameText: (updates) => flushes.push(updates),
      flushCommandOutput: () => {},
    });
    runtime.enqueueFrameText(frame("A"));
    yield* TestClock.adjust("8 millis");
    runtime.enqueueFrameText(frame("B"));
    runtime.enqueueFrameText(frame("C", { itemId: "item-2" }));
    yield* TestClock.adjust("8 millis");
    assert.deepEqual(
      flushes[0]?.map((update) => `${update.itemId}:${update.delta}`),
      ["item-1:AB", "item-2:C"],
    );
  }),
);

it.effect("drains frame text immediately and starts a fresh interval for later work", () =>
  Effect.gen(function* () {
    const flushed: string[] = [];
    const runtime = yield* make({
      flushFrameText: (updates) => flushed.push(updates.map((update) => update.delta).join("")),
      flushCommandOutput: () => {},
    });
    runtime.enqueueFrameText(frame("first"));
    yield* runtime.drainFrameText("thread-1");
    assert.deepEqual(flushed, ["first"]);
    runtime.enqueueFrameText(frame("second"));
    yield* TestClock.adjust("16 millis");
    assert.deepEqual(flushed, ["first", "second"]);
  }),
);

it.effect("coalesces command output as a bounded tail behind one Effect interval", () =>
  Effect.gen(function* () {
    const flushed: string[] = [];
    const runtime = yield* make({
      maxBufferedOutputChars: 5,
      flushFrameText: () => {},
      flushCommandOutput: (updates) => flushed.push(updates[0]?.delta ?? "missing"),
    });
    runtime.enqueueCommandOutput(output("1234"));
    yield* TestClock.adjust("25 millis");
    runtime.enqueueCommandOutput(output("567"));
    yield* TestClock.adjust("25 millis");
    assert.deepEqual(flushed, ["34567"]);
  }),
);

it.effect("reentrant command-output enqueue starts a fresh scheduled batch", () =>
  Effect.gen(function* () {
    const flushed: string[] = [];
    let enqueueSecond = (): void => {};
    const runtime = yield* make({
      flushFrameText: () => {},
      flushCommandOutput: (updates) => {
        const delta = updates[0]?.delta ?? "missing";
        flushed.push(delta);
        if (delta === "first") enqueueSecond();
      },
    });
    enqueueSecond = () => runtime.enqueueCommandOutput(output("second"));
    runtime.enqueueCommandOutput(output("first"));
    yield* TestClock.adjust("50 millis");
    yield* Effect.yieldNow;
    yield* TestClock.adjust("50 millis");
    yield* Effect.yieldNow;
    assert.deepEqual(flushed, ["first", "second"]);
  }),
);

it.effect("Thread clear preserves unrelated buffered work and cancels an empty lane", () =>
  Effect.gen(function* () {
    const frames: string[] = [];
    const outputs: string[] = [];
    const runtime = yield* make({
      flushFrameText: (updates) =>
        frames.push(updates.map((update) => update.conversationId).join(",")),
      flushCommandOutput: (updates) =>
        outputs.push(updates.map((update) => update.conversationId).join(",")),
    });
    runtime.enqueueFrameText(frame("a"));
    runtime.enqueueFrameText(frame("b", { conversationId: "thread-2", itemId: "item-2" }));
    runtime.enqueueCommandOutput(output("a"));
    runtime.enqueueCommandOutput(output("b", { conversationId: "thread-2", itemId: "item-2" }));
    runtime.clear("thread-1");
    yield* runtime.drainFrameText("thread-2");
    assert.deepEqual(frames, ["thread-2"]);
    yield* TestClock.adjust("50 millis");
    yield* Effect.yieldNow;
    assert.deepEqual(outputs, ["thread-2"]);

    runtime.enqueueFrameText(frame("discard"));
    runtime.enqueueCommandOutput(output("discard"));
    runtime.clear("thread-1");
    yield* TestClock.adjust("1 second");
    assert.deepEqual(frames, ["thread-2"]);
    assert.deepEqual(outputs, ["thread-2"]);
  }),
);

it.effect("Main Scope close drops buffered deltas and scheduled flushes", () =>
  Effect.gen(function* () {
    const ownerScope = yield* Scope.make();
    let flushes = 0;
    const runtime = yield* make({
      flushFrameText: () => {
        flushes += 1;
      },
      flushCommandOutput: () => {
        flushes += 1;
      },
    }).pipe(Effect.provideService(Scope.Scope, ownerScope));
    runtime.enqueueFrameText(frame("pending"));
    runtime.enqueueCommandOutput(output("pending"));
    yield* Scope.close(ownerScope, Exit.void);
    yield* TestClock.adjust("1 second");
    assert.strictEqual(flushes, 0);
  }),
);
