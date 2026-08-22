import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { assert, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import type { CodexWorktreeWorkerCreateInput } from "./codex-worktree-worker-port";
import { makeCodexRemoteWorktreeWorker } from "./codex-remote-worktree-worker-port";
import type { CodexWorktreeWorkerHostMessage } from "../worktree-worker/worktree-worker-protocol";

const createInput = (): CodexWorktreeWorkerCreateInput => ({
  requestId: "request-1",
  hostId: "ssh:devbox",
  repositoryPath: "/repo",
  nodexHome: "/nodex",
  managedRoot: "/nodex/worktrees",
  projectId: "project-1",
  targetId: "pending-1",
  threadTitle: "Implement feature",
  startingState: { type: "branch", branchName: "main" },
  localEnvironmentConfigPath: "/repo/.codex/environments/environment.toml",
  setUpSyncedBranch: true,
  propagateLocalWorkspaceFiles: false,
});

const makeSshChild = () => {
  const child = new EventEmitter() as EventEmitter & {
    exitCode: number | null;
    signalCode: NodeJS.Signals | null;
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: (signal: NodeJS.Signals) => boolean;
  };
  child.exitCode = null;
  child.signalCode = null;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  const messages: CodexWorktreeWorkerHostMessage[] = [];
  const forcedSignals: NodeJS.Signals[] = [];
  const finish = (code: number | null, signal: NodeJS.Signals | null): void => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.exitCode = code;
    child.signalCode = signal;
    child.emit("exit", code, signal);
  };
  child.kill = (signal) => {
    forcedSignals.push(signal);
    finish(null, signal);
    return true;
  };
  let inputBuffer = "";
  child.stdin.setEncoding("utf8");
  child.stdin.on("data", (chunk: string) => {
    inputBuffer += chunk;
    while (true) {
      const newline = inputBuffer.indexOf("\n");
      if (newline < 0) return;
      const line = inputBuffer.slice(0, newline).trim();
      inputBuffer = inputBuffer.slice(newline + 1);
      if (!line) continue;
      const message = JSON.parse(line) as CodexWorktreeWorkerHostMessage;
      messages.push(message);
      if (message.type === "shutdown") {
        finish(0, null);
        continue;
      }
      if (message.type !== "request") continue;
      child.stdout.write(
        `${JSON.stringify({
          type: "ready",
          epoch: 1,
          hostId: "ssh:devbox",
          protocolVersion: 4,
        })}\n`,
      );
      child.stdout.write(
        `${JSON.stringify({
          type: "event",
          id: message.id,
          operation: "create",
          event: {
            operation: "create",
            type: "path-allocated",
            worktreeGitRoot: "/nodex/worktrees/feature/repo",
            worktreeWorkspaceRoot: "/nodex/worktrees/feature/repo",
          },
        })}\n`,
      );
      child.stdout.write(
        `${JSON.stringify({
          type: "result",
          id: message.id,
          operation: "create",
          result: {
            type: "ok",
            success: {
              operation: "create",
              value: {
                worktreeGitRoot: "/nodex/worktrees/feature/repo",
                worktreeWorkspaceRoot: "/nodex/worktrees/feature/repo",
                setupError: null,
                shellEnvironment: null,
              },
            },
          },
        })}\n`,
      );
    }
  });
  return {
    child: child as unknown as ChildProcessWithoutNullStreams,
    forcedSignals,
    messages,
  };
};

it.effect("rejects protocol drift before opening an SSH worker", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const openWorker = vi.fn(async (): Promise<ChildProcessWithoutNullStreams> => {
        throw new Error("SSH should not open");
      });
      const port = yield* makeCodexRemoteWorktreeWorker({
        hostId: "ssh:devbox",
        openWorker: () => openWorker(),
      });
      const result = yield* Effect.exit(
        Effect.promise(() =>
          port.create(createInput(), {
            signal: new AbortController().signal,
            onEvent: () => undefined,
          }),
        ),
      );
      assert.isTrue(Exit.isFailure(result));
      if (Exit.isFailure(result)) {
        assert.match(String(Cause.squash(result.cause)), /violates protocol version/u);
      }
      assert.strictEqual(openWorker.mock.calls.length, 0);
    }),
  ),
);

it.effect("frames remote requests and releases the SSH child through its Scope", () =>
  Effect.gen(function* () {
    const fixture = makeSshChild();
    const events: string[] = [];
    const result = yield* Effect.scoped(
      Effect.gen(function* () {
        const port = yield* makeCodexRemoteWorktreeWorker({
          hostId: "ssh:devbox",
          openWorker: () => Promise.resolve(fixture.child),
        });
        return yield* Effect.promise(() =>
          port.create(
            { ...createInput(), localEnvironmentConfigPath: null },
            {
              signal: new AbortController().signal,
              onEvent: (event) => events.push(event.type),
            },
          ),
        );
      }),
    );

    assert.deepEqual(events, ["path-allocated"]);
    assert.strictEqual(result.setupError, null);
    assert.deepEqual(
      fixture.messages.map((message) => message.type),
      ["request", "shutdown"],
    );
    assert.deepEqual(fixture.forcedSignals, []);
  }),
);
