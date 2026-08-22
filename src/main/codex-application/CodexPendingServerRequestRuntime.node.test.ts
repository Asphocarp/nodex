import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { CodexAppServerNoResponse } from "@nodex/effect-codex-app-server/protocol";
import type { CodexApprovalRequest, CodexUserInputRequest } from "../../shared/types";
import type { CodexServerRequest } from "../codex-runtime/CodexApplicationProtocol";
import {
  CodexPendingServerRequestRuntimeClosedError,
  type CodexPendingServerRequestRuntimeOptions,
  make,
} from "./CodexPendingServerRequestRuntime";

interface Completion {
  readonly kind: "reject" | "respond";
  readonly occurrenceToken: number;
  readonly requestId: string | number;
  readonly response: unknown;
  readonly threadId: string;
}

const harness = (completions: Completion[]): CodexPendingServerRequestRuntimeOptions => ({
  respond: (threadId, requestId, occurrenceToken, response) =>
    Effect.sync(() => {
      completions.push({ kind: "respond", threadId, requestId, occurrenceToken, response });
      return true;
    }),
  reject: (threadId, requestId, occurrenceToken, response) =>
    Effect.sync(() => {
      completions.push({ kind: "reject", threadId, requestId, occurrenceToken, response });
      return true;
    }),
});

const approval = (
  requestId: string | number,
  threadId = "thread-1",
  turnId = "turn-1",
): CodexApprovalRequest =>
  ({
    type: "approval",
    requestId,
    kind: "command",
    projectId: "project-1",
    threadId,
    turnId,
    itemId: `item-${String(requestId)}`,
    createdAt: 1,
  }) as CodexApprovalRequest;

const userInput = (
  requestId: string | number,
  threadId = "thread-1",
  turnId = "turn-1",
): CodexUserInputRequest => ({
  type: "userInput",
  requestId,
  projectId: "project-1",
  threadId,
  turnId,
  itemId: `item-${String(requestId)}`,
  questions: [],
  isBlocking: true,
  createdAt: 1,
});

const dynamicTool = (
  requestId: string | number,
  threadId: string,
  turnId: string,
): Extract<CodexServerRequest, { readonly method: "item/tool/call" }> =>
  ({
    id: requestId,
    method: "item/tool/call",
    params: {
      threadId,
      turnId,
      callId: `call-${String(requestId)}`,
      namespace: "test",
      tool: "test",
      arguments: {},
    },
  }) as Extract<CodexServerRequest, { readonly method: "item/tool/call" }>;

it.effect(
  "keeps duplicate scalar ids in FIFO occurrence lanes without conflating scalar types",
  () =>
    Effect.gen(function* () {
      const completions: Completion[] = [];
      const runtime = yield* make(harness(completions));
      runtime.register({ kind: "approval", request: approval(7), occurrenceToken: 1 });
      runtime.register({ kind: "approval", request: approval(7), occurrenceToken: 2 });
      runtime.register({ kind: "approval", request: approval("7"), occurrenceToken: 3 });

      const numeric = runtime.takeAll("approval", 7);
      assert.deepEqual(
        numeric.map((entry) => entry.occurrenceToken),
        [1, 2],
      );
      runtime.complete(numeric[0]!, { decision: "decline" });
      runtime.complete(numeric[1]!, CodexAppServerNoResponse);
      runtime.abandonIdentity("thread-1", "7");
      yield* Effect.yieldNow;

      assert.deepEqual(
        completions.map(({ kind, occurrenceToken, requestId }) => ({
          kind,
          occurrenceToken,
          requestId,
        })),
        [
          { kind: "respond", occurrenceToken: 1, requestId: 7 },
          { kind: "respond", occurrenceToken: 2, requestId: 7 },
          { kind: "respond", occurrenceToken: 3, requestId: "7" },
        ],
      );
      assert.strictEqual(runtime.counts().total, 0);
    }),
);

it.effect("scopes same-id selection to the requested conversation", () =>
  Effect.gen(function* () {
    const completions: Completion[] = [];
    const runtime = yield* make(harness(completions));
    runtime.register({
      kind: "approval",
      request: approval("shared", "thread-1"),
      occurrenceToken: 1,
    });
    runtime.register({
      kind: "approval",
      request: approval("shared", "thread-2"),
      occurrenceToken: 2,
    });

    const second = runtime.takeAll("approval", "shared", (entry) => entry.threadId === "thread-2");
    assert.strictEqual(second.length, 1);
    runtime.complete(second[0]!, { decision: "decline" });
    assert.strictEqual(
      runtime.find("approval", "shared", (entry) => entry.threadId === "thread-1")?.threadId,
      "thread-1",
    );
    assert.isUndefined(
      runtime.find("approval", "shared", (entry) => entry.threadId === "thread-2"),
    );
  }),
);

it.effect(
  "disconnect enumeration includes UI-owned occurrences but not dispatched dynamic work",
  () =>
    Effect.gen(function* () {
      const runtime = yield* make(harness([]));
      runtime.register({ kind: "approval", request: approval("same"), occurrenceToken: 1 });
      runtime.register({ kind: "user-input", request: userInput("same"), occurrenceToken: 2 });
      runtime.register({
        kind: "dynamic-tool",
        request: dynamicTool("stored", "thread-2", "turn-2"),
        occurrenceToken: 3,
        nodexAuthority: null,
        disposition: "stored",
      });
      runtime.register({
        kind: "dynamic-tool",
        request: dynamicTool("dispatched", "thread-3", "turn-3"),
        occurrenceToken: 4,
        nodexAuthority: null,
        disposition: "dispatched",
      });

      assert.deepEqual(runtime.disconnectIdentities(), [
        { threadId: "thread-1", requestId: "same" },
        { threadId: "thread-2", requestId: "stored" },
      ]);
    }),
);

it.effect(
  "history pruning rejects both queued and claimed occurrences outside retained turns",
  () =>
    Effect.gen(function* () {
      const completions: Completion[] = [];
      const runtime = yield* make(harness(completions));
      runtime.register({
        kind: "user-input",
        request: userInput("removed", "thread-1", "turn-removed"),
        occurrenceToken: 1,
      });
      runtime.register({
        kind: "user-input",
        request: userInput("retained", "thread-1", "turn-retained"),
        occurrenceToken: 2,
      });
      const claimed = runtime.takeFirst("user-input", "removed");
      assert.isDefined(claimed);

      runtime.rejectRemovedTurns("thread-1", new Set(["turn-retained"]));
      yield* Effect.yieldNow;

      assert.deepEqual(
        completions.map(({ kind, occurrenceToken }) => ({ kind, occurrenceToken })),
        [{ kind: "reject", occurrenceToken: 1 }],
      );
      assert.strictEqual(runtime.counts().userInputs, 1);
    }),
);

it.effect("Scope shutdown rejects every unsettled occurrence exactly once", () =>
  Effect.gen(function* () {
    const completions: Completion[] = [];
    const runtime = yield* make(harness(completions));
    runtime.register({ kind: "approval", request: approval("queued"), occurrenceToken: 1 });
    runtime.register({ kind: "user-input", request: userInput("claimed"), occurrenceToken: 2 });
    const claimed = runtime.takeFirst("user-input", "claimed");
    assert.isDefined(claimed);

    yield* runtime.shutdown(new Error("closing"));
    yield* runtime.shutdown(new Error("closing again"));
    runtime.complete(claimed!, { answers: {} });
    yield* Effect.yieldNow;

    assert.deepEqual(
      completions.map(({ kind, occurrenceToken }) => ({ kind, occurrenceToken })),
      [
        { kind: "reject", occurrenceToken: 1 },
        { kind: "reject", occurrenceToken: 2 },
      ],
    );
    assert.strictEqual(runtime.counts().total, 0);
    assert.throws(
      () => runtime.register({ kind: "approval", request: approval("late"), occurrenceToken: 3 }),
      CodexPendingServerRequestRuntimeClosedError,
    );
  }),
);
