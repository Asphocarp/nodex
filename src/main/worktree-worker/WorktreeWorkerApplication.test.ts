import * as Effect from "effect/Effect";
import { assert, it } from "@effect/vitest";
import { CODEX_WORKTREE_WORKER_PROTOCOL_VERSION } from "./worktree-worker-protocol";
import {
  runWorktreeWorkerApplication,
  type WorktreeWorkerTransport,
} from "./WorktreeWorkerApplication";

it.effect("owns transport admission and release with the worker Scope", () =>
  Effect.gen(function* () {
    const messages: unknown[] = [];
    let closeCount = 0;
    let unsubscribeCount = 0;
    let listener: ((message: unknown) => void) | null = null;
    const transport: WorktreeWorkerTransport = {
      close: () => {
        closeCount += 1;
      },
      post: (message) => {
        messages.push(message);
        if (message.type === "ready") {
          listener?.({
            type: "shutdown",
            protocolVersion: CODEX_WORKTREE_WORKER_PROTOCOL_VERSION,
          });
        }
      },
      reportCancellation: false,
      subscribe: (next) => {
        listener = next;
        return () => {
          listener = null;
          unsubscribeCount += 1;
        };
      },
    };

    yield* runWorktreeWorkerApplication({ epoch: 3, hostId: "local", transport });

    assert.deepStrictEqual(messages, [
      {
        type: "ready",
        epoch: 3,
        hostId: "local",
        protocolVersion: CODEX_WORKTREE_WORKER_PROTOCOL_VERSION,
      },
    ]);
    assert.strictEqual(unsubscribeCount, 1);
    assert.strictEqual(closeCount, 1);
  }),
);
