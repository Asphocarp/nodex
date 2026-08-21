import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { assert, it } from "@effect/vitest";
import { CoreModules } from "../core-runtime/CoreModules";
import { WorktreeEnvironmentRuntime, live } from "./WorktreeEnvironmentRuntime";

const environment = {
  version: 1 as const,
  name: "Local",
  setup: { script: "vp install", platformScripts: {} },
  cleanup: { script: null, platformScripts: {} },
  actions: [],
};

it.effect("owns project environment files for one Main Scope", () =>
  Effect.acquireUseRelease(
    Effect.tryPromise(() => mkdtemp(path.join(tmpdir(), "nodex-environment-runtime-"))),
    (workspacePath) =>
      Effect.gen(function* () {
        const core = CoreModules.of({
          workspace: {
            read: () =>
              Effect.succeed({
                value: {
                  kind: "project",
                  project: {
                    name: "Runtime Project",
                    primary_workspace_root: workspacePath,
                  },
                },
              } as never),
          },
        } as unknown as CoreModules["Service"]);
        const scope = yield* Scope.make();
        const context = yield* Layer.buildWithScope(
          live.pipe(Layer.provide(Layer.succeed(CoreModules, core))),
          scope,
        );
        const runtime = Context.get(context, WorktreeEnvironmentRuntime);

        assert.deepStrictEqual(
          yield* runtime.saveProjectConfig({
            projectId: "project-1",
            configPath: ".codex/environments/environment.toml",
            expectedRevision: null,
            environment,
          }),
          { type: "success" },
        );
        assert.strictEqual((yield* runtime.listProjectConfigs("project-1")).length, 1);
        assert.strictEqual(
          (yield* runtime.readProjectConfig("project-1")).projectName,
          "Runtime Project",
        );
        assert.include(
          yield* Effect.tryPromise(() =>
            readFile(path.join(workspacePath, ".codex/environments/environment.toml"), "utf8"),
          ),
          'name = "Local"',
        );

        yield* Scope.close(scope, Exit.void);
        const afterClose = yield* Effect.exit(
          runtime.saveProjectConfig({
            projectId: "project-1",
            configPath: ".codex/environments/environment.toml",
            expectedRevision: null,
            environment,
          }),
        );
        assert.isTrue(Exit.isFailure(afterClose));
      }),
    (workspacePath) => Effect.promise(() => rm(workspacePath, { force: true, recursive: true })),
  ),
);
