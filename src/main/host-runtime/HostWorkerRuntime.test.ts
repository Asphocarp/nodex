import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { assert, it } from "@effect/vitest";
import type { CodexWorktreeWorkerPort } from "../codex/codex-worktree-worker-port";
import { HostWorkerRuntime, testLayer, type WorktreeWorkerHostPort } from "./HostWorkerRuntime";

it.effect("owns both worker hosts and releases them with the Main Scope", () =>
  Effect.gen(function* () {
    const releases: string[] = [];
    const git = {
      handleRendererMessage: () => undefined,
      requestFromMain: () => Promise.reject(new Error("unused")),
      shutdown: async () => {
        releases.push("git");
      },
    };
    const worktree = {
      shutdown: async () => {
        releases.push("worktree");
      },
    } as unknown as WorktreeWorkerHostPort;
    const scope = yield* Scope.make();
    const context = yield* Layer.buildWithScope(testLayer({ git, worktree }), scope);
    const runtime = Context.get(context, HostWorkerRuntime);

    assert.strictEqual(runtime.git, git);
    assert.strictEqual(runtime.worktree, worktree as CodexWorktreeWorkerPort);
    yield* Scope.close(scope, Exit.void);
    assert.deepEqual(releases.sort(), ["git", "worktree"]);
  }),
);
