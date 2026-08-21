import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { assert, it } from "@effect/vitest";
import { CoreModules } from "../core-runtime/CoreModules";
import { WorktreeEnvironmentRuntime, live, makeLive } from "./WorktreeEnvironmentRuntime";

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

        const snapshot = yield* runtime.readProjectConfig("project-1");
        const concurrent = yield* Effect.all(
          [
            runtime.saveProjectConfig({
              projectId: "project-1",
              configPath: snapshot.configPath,
              expectedRevision: snapshot.revision,
              environment: { ...environment, name: "First" },
            }),
            runtime.saveProjectConfig({
              projectId: "project-1",
              configPath: snapshot.configPath,
              expectedRevision: snapshot.revision,
              environment: { ...environment, name: "Second" },
            }),
          ],
          { concurrency: "unbounded" },
        );
        assert.strictEqual(concurrent.filter((result) => result.type === "success").length, 1);
        assert.strictEqual(concurrent.filter((result) => result.type === "conflict").length, 1);

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

it.effect("drains an admitted filesystem write before releasing its Scope", () =>
  Effect.acquireUseRelease(
    Effect.tryPromise(() => mkdtemp(path.join(tmpdir(), "nodex-environment-drain-"))),
    (workspacePath) =>
      Effect.gen(function* () {
        let markStarted: (() => void) | undefined;
        let finish: (() => void) | undefined;
        let calls = 0;
        let coreReads = 0;
        const started = new Promise<void>((resolve) => {
          markStarted = resolve;
        });
        const core = CoreModules.of({
          workspace: {
            read: () => {
              coreReads += 1;
              return Effect.succeed({
                value: {
                  kind: "project",
                  project: {
                    name: "Runtime Project",
                    primary_workspace_root: workspacePath,
                  },
                },
              } as never);
            },
          },
        } as unknown as CoreModules["Service"]);
        const scope = yield* Scope.make();
        const context = yield* Layer.buildWithScope(
          makeLive({
            saveFile: () => {
              calls += 1;
              markStarted?.();
              return new Promise((resolve) => {
                finish = () => resolve({ type: "success" });
              });
            },
          }).pipe(Layer.provide(Layer.succeed(CoreModules, core))),
          scope,
        );
        const runtime = Context.get(context, WorktreeEnvironmentRuntime);
        const save = yield* Effect.forkChild(
          runtime.saveProjectConfig({
            projectId: "project-1",
            configPath: ".codex/environments/environment.toml",
            expectedRevision: null,
            environment,
          }),
        );
        yield* Effect.promise(() => started);
        const queued = yield* Effect.forkChild(
          runtime.saveProjectConfig({
            projectId: "project-1",
            configPath: ".codex/environments/environment-2.toml",
            expectedRevision: null,
            environment,
          }),
        );
        yield* Effect.yieldNow;
        const closing = yield* Effect.forkChild(Scope.close(scope, Exit.void));
        yield* Effect.yieldNow;

        assert.strictEqual(calls, 1);
        assert.isUndefined(closing.pollUnsafe());
        finish?.();
        yield* Fiber.join(closing);
        assert.strictEqual((yield* Fiber.await(save))._tag, "Failure");
        assert.strictEqual((yield* Fiber.await(queued))._tag, "Failure");

        const afterClose = yield* Effect.exit(
          runtime.saveProjectConfig({
            projectId: "project-1",
            configPath: ".codex/environments/environment.toml",
            expectedRevision: null,
            environment,
          }),
        );
        assert.isTrue(Exit.isFailure(afterClose));
        assert.strictEqual(calls, 1);
        const readsBeforeClosedRequest = coreReads;
        assert.isTrue(Exit.isFailure(yield* Effect.exit(runtime.listProjectOptions("project-1"))));
        assert.strictEqual(coreReads, readsBeforeClosedRequest);
      }),
    (workspacePath) => Effect.promise(() => rm(workspacePath, { force: true, recursive: true })),
  ),
);
