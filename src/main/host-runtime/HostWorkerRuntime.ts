import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type { CodexWorktreeWorkerPort } from "../codex/codex-worktree-worker-port";
import { CODEX_APP_LOCAL_HOST_ID } from "../codex/codex-app-meta-thread-tools";
import { GitWorkerHost } from "../git-worker-host";
import { getLogger } from "../logging/logger";
import { captureMainException } from "../observability/sentry-main";
import { CodexWorktreeWorkerHost } from "../worktree-worker/worktree-worker-host";

export type GitWorkerHostPort = Pick<
  GitWorkerHost,
  "handleRendererMessage" | "requestFromMain" | "shutdown"
>;

export type WorktreeWorkerHostPort = CodexWorktreeWorkerPort & {
  readonly shutdown: () => Promise<void>;
};

export class HostWorkerRuntime extends Context.Service<
  HostWorkerRuntime,
  {
    readonly git: GitWorkerHostPort;
    readonly worktree: CodexWorktreeWorkerPort;
  }
>()("nodex/main/host-runtime/HostWorkerRuntime") {}

interface HostWorkerPorts {
  readonly git: GitWorkerHostPort;
  readonly worktree: WorktreeWorkerHostPort;
}

class HostWorkerShutdownError extends Schema.TaggedError<HostWorkerShutdownError>()(
  "HostWorkerShutdownError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}

const shutdown = (operation: string, task: () => Promise<void>): Effect.Effect<void> =>
  Effect.tryPromise({
    try: task,
    catch: (cause) => new HostWorkerShutdownError({ operation, cause }),
  }).pipe(
    Effect.catch((error) =>
      Effect.logWarning("Could not release host worker").pipe(
        Effect.annotateLogs({ operation: error.operation, error: String(error.cause) }),
      ),
    ),
  );

const release = (ports: HostWorkerPorts): Effect.Effect<void> =>
  Effect.all(
    [
      shutdown("git", () => ports.git.shutdown()),
      shutdown("worktree", () => ports.worktree.shutdown()),
    ],
    { concurrency: "unbounded", discard: true },
  ).pipe(Effect.asVoid);

const fromPorts = (acquire: Effect.Effect<HostWorkerPorts>): Layer.Layer<HostWorkerRuntime> =>
  Layer.effect(
    HostWorkerRuntime,
    Effect.acquireRelease(acquire, release).pipe(
      Effect.map((ports) => HostWorkerRuntime.of(ports)),
    ),
  );

export interface HostWorkerRuntimeOptions {
  readonly gitWorkerPath: string;
  readonly worktreeWorkerPath: string;
}

export const live = (options: HostWorkerRuntimeOptions): Layer.Layer<HostWorkerRuntime> => {
  const logger = getLogger({ component: "host-worker-runtime" });
  return fromPorts(
    Effect.sync(() => ({
      git: new GitWorkerHost({
        workerPath: options.gitWorkerPath,
        onInfrastructureError: (error, context) => {
          logger.error("Git worker infrastructure failed", {
            epoch: context.epoch,
            error: error.message,
            phase: context.phase,
          });
          captureMainException(error, {
            tags: { component: "git-worker", phase: context.phase },
            extra: { epoch: context.epoch },
          });
        },
        onPerformanceOperation: (metric) => logger.debug("Git worker operation", metric),
      }),
      worktree: new CodexWorktreeWorkerHost({
        hostId: CODEX_APP_LOCAL_HOST_ID,
        workerPath: options.worktreeWorkerPath,
        onInfrastructureError: (error) => {
          logger.error("Worktree worker infrastructure failed", { error: error.message });
          captureMainException(error, { tags: { component: "worktree-worker" } });
        },
      }),
    })),
  );
};

export const testLayer = (ports: HostWorkerPorts): Layer.Layer<HostWorkerRuntime> =>
  fromPorts(Effect.succeed(ports));
