import * as Effect from "effect/Effect";
import { assert, it } from "@effect/vitest";
import { ConversationCommands } from "./ConversationCommands";
import { CodexFreshThreadLaunchRuntime } from "./CodexFreshThreadLaunchRuntime";
import { CodexManualCompactionRuntime } from "./CodexManualCompactionRuntime";
import {
  CodexRendererConversationRuntime,
  makeCodexRendererConversationState,
} from "./CodexRendererConversationRuntime";
import { make } from "./CodexRendererOwnerCommands";
import { CodexThreadGoalRuntime } from "./CodexThreadGoalRuntime";
import { CodexThreadSettingsRuntime } from "./CodexThreadSettingsRuntime";
import { CodexThreadRollbackCommands } from "./CodexThreadRollbackCommands";
import { CodexTurnCommands, type CodexTurnStartOverrides } from "./CodexTurnCommands";

const threadId = "thread-owner-command";
const ownerClientId = "renderer-owner";

interface HarnessEvents {
  readonly starts: Array<{
    readonly threadId: string;
    readonly prompt: string;
    readonly overrides: CodexTurnStartOverrides | undefined;
  }>;
  readonly memoryModes: Array<{ readonly threadId: string; readonly mode: string }>;
  readonly terminalPages: Array<{
    readonly threadId: string;
    readonly cursor: string | null | undefined;
    readonly limit: number | undefined;
  }>;
  readonly terminated: Array<{ readonly threadId: string; readonly processId: string }>;
  readonly forks: Array<{
    readonly threadId: string;
    readonly turnId: string;
    readonly message: string;
    readonly ownerClientId: string;
  }>;
}

const makeHarness = () => {
  const events: HarnessEvents = {
    starts: [],
    memoryModes: [],
    terminalPages: [],
    terminated: [],
    forks: [],
  };
  const rendererConversations = makeCodexRendererConversationState();
  rendererConversations.setOwner(threadId, ownerClientId);
  const turnCommands = CodexTurnCommands.of({
    start: () => Effect.die("unused"),
    startRendererOwned: (startedThreadId, prompt, overrides) => {
      events.starts.push({ threadId: startedThreadId, prompt, overrides });
      return Effect.succeed({ turn: { id: "turn-started" } } as never);
    },
    steer: () => Effect.die("unused"),
    steerRendererOwned: () => Effect.die("unused"),
  });
  const conversations = ConversationCommands.of({
    archive: () => Effect.die("unused"),
    unarchive: () => Effect.die("unused"),
    setMemoryMode: (modeThreadId, mode) =>
      Effect.sync(() => {
        events.memoryModes.push({ threadId: modeThreadId, mode });
      }),
    startReview: () => Effect.die("unused"),
    uploadFeedback: () => Effect.die("unused"),
    listBackgroundTerminalsPage: (pageThreadId, options) =>
      Effect.sync(() => {
        events.terminalPages.push({
          threadId: pageThreadId,
          cursor: options?.cursor,
          limit: options?.limit,
        });
        return { data: [], nextCursor: "next" };
      }),
    listBackgroundTerminals: () => Effect.die("unused"),
    terminateBackgroundTerminal: (terminalThreadId, processId) =>
      Effect.sync(() => {
        events.terminated.push({ threadId: terminalThreadId, processId });
        return true;
      }),
    interrupt: () => Effect.die("unused"),
    cleanBackgroundTerminals: () => Effect.die("unused"),
    cleanBackgroundTerminalsSilently: () => Effect.die("unused"),
  });
  const commands = make({
    forkFromTurn: (input) =>
      Effect.sync(() => {
        events.forks.push(input);
        return { threadId: "thread-forked" };
      }),
  }).pipe(
    Effect.provideService(CodexRendererConversationRuntime, rendererConversations),
    Effect.provideService(
      CodexFreshThreadLaunchRuntime,
      CodexFreshThreadLaunchRuntime.of({
        register: () => undefined,
        reservation: () => null,
        adopt: () => Effect.die("unused"),
        start: () => Effect.die("unused"),
        releaseRenderer: () => undefined,
        clear: () => undefined,
      }),
    ),
    Effect.provideService(
      CodexManualCompactionRuntime,
      CodexManualCompactionRuntime.of({
        start: () => Effect.die("unused"),
        consumeSource: () => "automatic",
        clear: () => undefined,
      }),
    ),
    Effect.provideService(
      CodexThreadGoalRuntime,
      CodexThreadGoalRuntime.of({
        get: () => Effect.die("unused"),
        set: () => Effect.die("unused"),
        clear: () => Effect.die("unused"),
        load: () => Effect.die("unused"),
      }),
    ),
    Effect.provideService(
      CodexThreadSettingsRuntime,
      CodexThreadSettingsRuntime.of({
        update: () => Effect.die("unused"),
        awaitCurrent: () => Effect.void,
        remoteUpdateSupport: () => "unknown",
        recordRemoteUpdateSupported: () => undefined,
        recordRemoteUpdateUnsupported: () => undefined,
      }),
    ),
    Effect.provideService(
      CodexThreadRollbackCommands,
      CodexThreadRollbackCommands.of({
        rollbackLatestForEdit: () => Effect.die("unused"),
      }),
    ),
    Effect.provideService(CodexTurnCommands, turnCommands),
    Effect.provideService(ConversationCommands, conversations),
  );
  return { commands, events };
};

it.effect("rejects a non-owner before dispatching any command", () =>
  Effect.gen(function* () {
    const { commands, events } = makeHarness();
    const service = yield* commands;
    const exit = yield* Effect.exit(
      service.execute("renderer-follower", {
        conversationId: threadId,
        request: {
          method: "thread/memoryMode/set",
          params: { threadId, mode: "enabled" },
        },
      }),
    );

    assert.isTrue(exit._tag === "Failure");
    assert.deepEqual(events.memoryModes, []);
  }),
);

it.effect("routes interrupted resume through the renderer-owned Turn transaction", () =>
  Effect.gen(function* () {
    const { commands, events } = makeHarness();
    const service = yield* commands;
    yield* service.execute(ownerClientId, {
      conversationId: threadId,
      request: {
        method: "turn/resume-interrupted",
        params: {
          threadId,
          clientUserMessageId: "client-resume",
          opts: { permissionMode: "auto" },
        },
      },
    });

    assert.strictEqual(events.starts.length, 1);
    assert.strictEqual(events.starts[0]?.threadId, threadId);
    assert.strictEqual(events.starts[0]?.prompt, "");
    assert.strictEqual(events.starts[0]?.overrides?.clientUserMessageId, "client-resume");
    assert.deepEqual(events.starts[0]?.overrides?.preparedPrompt?.inputItems, []);
  }),
);

it.effect("preserves owner terminal paging and termination response contracts", () =>
  Effect.gen(function* () {
    const { commands, events } = makeHarness();
    const service = yield* commands;
    const page = yield* service.execute(ownerClientId, {
      conversationId: threadId,
      request: {
        method: "thread/backgroundTerminals/list",
        params: { threadId, cursor: "cursor-a", limit: 25 },
      },
    });
    const terminated = yield* service.execute(ownerClientId, {
      conversationId: threadId,
      request: {
        method: "thread/backgroundTerminals/terminate",
        params: { threadId, processId: "process-a" },
      },
    });

    assert.deepEqual(page, { data: [], nextCursor: "next" });
    assert.deepEqual(terminated, { terminated: true });
    assert.deepEqual(events.terminalPages, [{ threadId, cursor: "cursor-a", limit: 25 }]);
    assert.deepEqual(events.terminated, [{ threadId, processId: "process-a" }]);
  }),
);

it.effect("passes the exact renderer owner into the fork transaction", () =>
  Effect.gen(function* () {
    const { commands, events } = makeHarness();
    const service = yield* commands;
    const result = yield* service.execute(ownerClientId, {
      conversationId: threadId,
      request: {
        method: "thread/fork",
        params: { threadId, turnId: "turn-a", message: "edit" },
      },
    });

    assert.deepEqual(result, { threadId: "thread-forked" });
    assert.deepEqual(events.forks, [
      { threadId, turnId: "turn-a", message: "edit", ownerClientId },
    ]);
  }),
);
