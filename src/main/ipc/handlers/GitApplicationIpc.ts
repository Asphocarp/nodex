import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type { IpcMainInvokeEvent } from "electron";
import type { IpcApi } from "../../../shared/ipc-api";
import type {
  GitActionMutationResult,
  GitCommitMessageGenerateResult,
  GitPullRequestMessageGenerateResult,
  GitReviewPatchResult,
} from "../../../shared/types";
import { MainConfig } from "../../app/MainConfig";
import { ScopedCallbackRuntime } from "../../app/ScopedCallbackRuntime";
import type { CodexService } from "../../codex/codex-service";
import {
  commitGitChanges,
  generateGitCommitMessage,
  generateGitPullRequestMessage,
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
import {
  GitActionOperationRuntime,
  type GitActionOperationRuntimeError,
} from "../../host-runtime/GitActionOperationRuntime";
import { GitWorkerRuntime } from "../../host-runtime/GitWorkerRuntime";
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
): Layer.Layer<
  never,
  never,
  | ElectronIpc
  | GitActionOperationRuntime
  | GitWorkerRuntime
  | MainConfig
  | ScopedCallbackRuntime
  | WindowRuntime
> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const config = yield* MainConfig;
      const callbacks = yield* ScopedCallbackRuntime;
      const ipc = yield* ElectronIpc;
      const windows = yield* WindowRuntime;
      const worker = yield* GitWorkerRuntime;
      const operations = yield* GitActionOperationRuntime;
      const gitWorker: GitActionWorkerPort = {
        readStatus: (cwd, signal) =>
          callbacks.runPromise(
            worker.request({ method: "action-status", params: { cwd }, signal }),
          ),
        readReviewPatch: async (input, signal) => {
          for (let attempt = 0; attempt < 2; attempt += 1) {
            const result = await callbacks.runPromise(
              worker.request({ method: "review-patch", params: input, signal }),
            );
            if (!("type" in result) || result.type !== "stale-snapshot") {
              return result as GitReviewPatchResult;
            }
          }
          throw new Error("Git repository changed while preparing the message.");
        },
        commit: (input, signal) =>
          callbacks.runPromise(
            worker.request({
              method: "commit",
              params: { ...input, nextStep: "commit" },
              signal,
            }),
          ),
        push: (input, signal) =>
          callbacks.runPromise(worker.request({ method: "push", params: input, signal })),
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
      const invokeEffect = <Channel extends keyof IpcApi>(
        channel: Channel,
        task: (
          ...args: IpcApi[Channel]["args"]
        ) => Effect.Effect<IpcApi[Channel]["result"], GitActionOperationRuntimeError>,
      ) =>
        handle(channel, (event, ...args) => authorize(event).pipe(Effect.andThen(task(...args))));
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
      yield* invokeEffect("git:action:commit-message:generate", (input) =>
        operations.run(
          input.operationId,
          Effect.promise((signal) =>
            generateGitCommitMessage(
              input,
              {
                gitWorker,
                generateCommitMessage: generateCommitMessage(input.hostId),
              },
              signal,
            ),
          ),
          (): GitCommitMessageGenerateResult => ({
            cwd: input.cwd.trim(),
            status: "error",
            message: null,
            stderr: "",
            errorMessage: "Git action was canceled.",
          }),
        ),
      );
      yield* invokeEffect("git:action:pull-request-message:generate", (input) =>
        operations.run(
          input.operationId,
          Effect.promise((signal) =>
            generateGitPullRequestMessage(
              input,
              {
                gitWorker,
                generatePullRequestMessage: generatePullRequestMessage(input.hostId),
              },
              signal,
            ),
          ),
          (): GitPullRequestMessageGenerateResult => ({
            cwd: input.cwd.trim(),
            status: "error",
            title: null,
            body: null,
            stderr: "",
            errorMessage: "Git action was canceled.",
          }),
        ),
      );
      yield* invokeEffect("git:action:commit", (input) =>
        operations.run(
          input.operationId,
          Effect.promise((signal) =>
            commitGitChanges(
              input,
              {
                gitWorker,
                generateCommitMessage: generateCommitMessage(input.hostId),
              },
              signal,
            ),
          ),
          (): GitActionMutationResult => ({
            cwd: input.cwd.trim(),
            status: "error",
            branch: null,
            stdout: "",
            stderr: "",
            errorMessage: "Git action was canceled.",
          }),
        ),
      );
      yield* invokeEffect("git:action:push", (input) =>
        operations.run(
          input.operationId,
          Effect.promise((signal) => pushGitChanges(input, { gitWorker }, signal)),
          (): GitActionMutationResult => ({
            cwd: input.cwd.trim(),
            status: "error",
            branch: null,
            stdout: "",
            stderr: "",
            errorMessage: "Git action was canceled.",
          }),
        ),
      );
      yield* invokeEffect("git:action:cancel", (input) => operations.cancel(input));
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
