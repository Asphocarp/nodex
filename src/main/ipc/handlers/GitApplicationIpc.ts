import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type { IpcMainInvokeEvent } from "electron";
import type { IpcApi } from "../../../shared/ipc-api";
import type { GitReviewPatchResult } from "../../../shared/types";
import { MainConfig } from "../../app/MainConfig";
import type { CodexService } from "../../codex/codex-service";
import {
  cancelGitAction,
  commitGitChanges,
  generateGitCommitMessage,
  generateGitPullRequestMessage,
  GitActionOperationRegistry,
  pushGitChanges,
  type GitActionWorkerPort,
} from "../../git-action-service";
import { readGitRepositoryIdentity } from "../../git-repository-identity-service";
import {
  createGhPr,
  createGhPrComment,
  mergeGhPr,
  readGhCliStatus,
  readGhPrChecks,
  readGhPrComments,
  readGhPrDiff,
  readGhPrStatus,
  updateGhPr,
} from "../../github-pr-service";
import { HostWorkerRuntime } from "../../host-runtime/HostWorkerRuntime";
import { ElectronIpc } from "../../platform/electron/ElectronIpc";
import { requireTrustedAppRendererSender } from "../../platform/electron/TrustedRendererSender";
import { WindowRuntime } from "../../window-runtime/WindowRuntime";

export interface GitApplicationIpcOptions {
  readonly codex: CodexService;
}

export class GitApplicationIpcError extends Schema.TaggedError<GitApplicationIpcError>()(
  "GitApplicationIpcError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}

type Handler<Channel extends keyof IpcApi> = (
  event: IpcMainInvokeEvent,
  ...args: IpcApi[Channel]["args"]
) => Effect.Effect<IpcApi[Channel]["result"], unknown>;

export const live = (
  options: GitApplicationIpcOptions,
): Layer.Layer<never, never, ElectronIpc | HostWorkerRuntime | MainConfig | WindowRuntime> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const config = yield* MainConfig;
      const ipc = yield* ElectronIpc;
      const windows = yield* WindowRuntime;
      const workers = yield* HostWorkerRuntime;
      const operations = yield* Effect.acquireRelease(
        Effect.sync(() => new GitActionOperationRegistry()),
        (registry) => Effect.sync(() => registry.close()),
      );
      const gitWorker: GitActionWorkerPort = {
        readStatus: (cwd, signal) =>
          workers.git.requestFromMain({ method: "action-status", params: { cwd }, signal }),
        readReviewPatch: async (input, signal) => {
          for (let attempt = 0; attempt < 2; attempt += 1) {
            const result = await workers.git.requestFromMain({
              method: "review-patch",
              params: input,
              signal,
            });
            if (!("type" in result) || result.type !== "stale-snapshot") {
              return result as GitReviewPatchResult;
            }
          }
          throw new Error("Git repository changed while preparing the message.");
        },
        commit: (input, signal) =>
          workers.git.requestFromMain({
            method: "commit",
            params: { ...input, nextStep: "commit" },
            signal,
          }),
        refreshRepository: async (cwd) => {
          await workers.git.requestFromMain({ method: "refresh-repository", params: { cwd } });
        },
      };
      const handle = <Channel extends keyof IpcApi>(channel: Channel, handler: Handler<Channel>) =>
        ipc.handle(channel, handler);
      const authorize = (event: IpcMainInvokeEvent) =>
        Effect.try({
          try: () => {
            requireTrustedAppRendererSender(event, "Git", config.rendererUrl);
            if (!windows.has(event.sender.id)) {
              throw new Error("Git access requires an active Nodex window");
            }
          },
          catch: (cause) => new GitApplicationIpcError({ operation: "authorize-renderer", cause }),
        });
      const run = <A>(operation: string, task: () => A | Promise<A>) =>
        Effect.tryPromise({
          try: () => Promise.resolve(task()),
          catch: (cause) => new GitApplicationIpcError({ operation, cause }),
        });
      const invoke = <Channel extends keyof IpcApi>(
        channel: Channel,
        task: (
          ...args: IpcApi[Channel]["args"]
        ) => IpcApi[Channel]["result"] | Promise<IpcApi[Channel]["result"]>,
      ) =>
        handle(channel, (event, ...args) =>
          authorize(event).pipe(Effect.andThen(run(channel, () => task(...args)))),
        );
      const generateCommitMessage =
        (hostId: string | undefined) =>
        async ({ cwd, prompt, signal }: { cwd: string; prompt: string; signal?: AbortSignal }) => {
          if (signal?.aborted) return null;
          const message = await options.codex.generateCommitMessage({ hostId, prompt, cwd });
          return signal?.aborted ? null : message;
        };
      const generatePullRequestMessage =
        (hostId: string | undefined) =>
        async ({ cwd, prompt, signal }: { cwd: string; prompt: string; signal?: AbortSignal }) => {
          if (signal?.aborted) return null;
          const message = await options.codex.generatePullRequestMessage({ hostId, prompt, cwd });
          return signal?.aborted ? null : message;
        };

      yield* invoke("git:repository:identity", readGitRepositoryIdentity);
      yield* invoke("git:action:commit-message:generate", (input) =>
        generateGitCommitMessage(input, {
          gitWorker,
          operations,
          generateCommitMessage: generateCommitMessage(input.hostId),
        }),
      );
      yield* invoke("git:action:pull-request-message:generate", (input) =>
        generateGitPullRequestMessage(input, {
          gitWorker,
          operations,
          generatePullRequestMessage: generatePullRequestMessage(input.hostId),
        }),
      );
      yield* invoke("git:action:commit", (input) =>
        commitGitChanges(input, {
          gitWorker,
          operations,
          generateCommitMessage: generateCommitMessage(input.hostId),
        }),
      );
      yield* invoke("git:action:push", async (input) => {
        const result = await pushGitChanges(input, operations);
        await workers.git
          .requestFromMain({ method: "refresh-repository", params: { cwd: input.cwd } })
          .catch(() => undefined);
        return result;
      });
      yield* invoke("git:action:cancel", (input) => cancelGitAction(input, operations));
      yield* invoke("gh-cli-status", readGhCliStatus);
      yield* invoke("gh-pr-status", readGhPrStatus);
      yield* invoke("gh-pr-checks", readGhPrChecks);
      yield* invoke("gh-pr-comments", readGhPrComments);
      yield* invoke("gh-pr-diff", readGhPrDiff);
      yield* invoke("gh-pr-comment", createGhPrComment);
      yield* invoke("gh-pr-merge", mergeGhPr);
      yield* invoke("gh-pr-update", updateGhPr);
      yield* invoke("gh-pr-create", createGhPr);
    }),
  );
