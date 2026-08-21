import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import { assert, it } from "@effect/vitest";
import type { IpcMainInvokeEvent } from "electron";
import { GIT_WORKER_MESSAGE_FROM_VIEW_CHANNEL } from "../../../shared/git-worker-protocol";
import { MainConfig } from "../../app/MainConfig";
import { HostWorkerRuntime } from "../../host-runtime/HostWorkerRuntime";
import { ElectronIpc } from "../../platform/electron/ElectronIpc";
import { live } from "./GitWorkerIpc";

type Handler = (
  event: IpcMainInvokeEvent,
  ...args: readonly unknown[]
) => Effect.Effect<unknown, unknown>;

it.effect("registers and releases the Git worker renderer ingress with the Main Scope", () =>
  Effect.gen(function* () {
    const handlers = new Map<string, Handler>();
    const ipc = ElectronIpc.of({
      handle: (channel, handler) =>
        Effect.acquireRelease(
          Effect.sync(() => handlers.set(channel, handler as Handler)),
          () => Effect.sync(() => handlers.delete(channel)),
        ).pipe(Effect.asVoid),
      on: () => Effect.void,
    });
    const workers = HostWorkerRuntime.of({
      git: {
        handleRendererMessage: () => undefined,
        requestFromMain: () => Promise.reject(new Error("unused")),
        shutdown: async () => undefined,
      },
      worktree: {} as never,
    });
    const scope = yield* Scope.make();
    yield* Layer.buildWithScope(
      live.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(ElectronIpc, ipc),
            Layer.succeed(
              MainConfig,
              MainConfig.of({
                assistantStreamingDebug: false,
                appVersion: "test",
                arch: "arm64",
                argv: [],
                documentsPath: "/tmp/Documents",
                environmentPath: null,
                initialProjectsDirectory: null,
                isDefaultApp: false,
                isPackaged: false,
                nodexHome: "/tmp/nodex-test",
                platform: "darwin",
                profileId: "test",
                projectRootPath: "/repo",
                rendererUrl: "http://localhost:5173",
                resourcesPath: "/resources",
                runtimeBinaryPath: "/electron",
              }),
            ),
            Layer.succeed(HostWorkerRuntime, workers),
          ),
        ),
      ),
      scope,
    );

    assert.isTrue(handlers.has(GIT_WORKER_MESSAGE_FROM_VIEW_CHANNEL));
    yield* Scope.close(scope, Exit.void);
    assert.isFalse(handlers.has(GIT_WORKER_MESSAGE_FROM_VIEW_CHANNEL));
  }),
);
