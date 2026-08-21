import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import type { IpcMainInvokeEvent } from "electron";
import type { IpcApi } from "../../../shared/ipc-api";
import { MainConfig } from "../../app/MainConfig";
import { GitActions } from "../../git-application/GitActions";
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
import type { GitActionOperationRuntimeError } from "../../host-runtime/GitActionOperationRuntime";
import { ElectronIpc } from "../../platform/electron/ElectronIpc";
import { requireTrustedAppRendererSender } from "../../platform/electron/TrustedRendererSender";
import { WindowRuntime } from "../../window-runtime/WindowRuntime";

export class GitApplicationIpcError extends Schema.TaggedError<GitApplicationIpcError>()(
  "GitApplicationIpcError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}

type Handler<Channel extends keyof IpcApi> = (
  event: IpcMainInvokeEvent,
  ...args: IpcApi[Channel]["args"]
) => Effect.Effect<IpcApi[Channel]["result"], unknown>;

export const live: Layer.Layer<
  never,
  never,
  ElectronIpc | GitActions | MainConfig | WindowRuntime
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const config = yield* MainConfig;
    const gitActions = yield* GitActions;
    const ipc = yield* ElectronIpc;
    const windows = yield* WindowRuntime;
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
    ) => handle(channel, (event, ...args) => authorize(event).pipe(Effect.andThen(task(...args))));
    yield* invoke("git:repository:identity", readGitRepositoryIdentity);
    yield* invokeEffect("git:action:commit-message:generate", (input) =>
      gitActions.generateCommitMessage(input),
    );
    yield* invokeEffect("git:action:pull-request-message:generate", (input) =>
      gitActions.generatePullRequestMessage(input),
    );
    yield* invokeEffect("git:action:commit", (input) => gitActions.commit(input));
    yield* invokeEffect("git:action:push", (input) => gitActions.push(input));
    yield* invokeEffect("git:action:cancel", (input) => gitActions.cancel(input));
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
