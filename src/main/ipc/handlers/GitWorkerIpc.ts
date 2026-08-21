import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import {
  GIT_WORKER_MESSAGE_FROM_VIEW_CHANNEL,
  isGitWorkerMessageFromView,
} from "../../../shared/git-worker-protocol";
import { MainConfig } from "../../app/MainConfig";
import { HostWorkerRuntime } from "../../host-runtime/HostWorkerRuntime";
import { captureMainException } from "../../observability/sentry-main";
import { ElectronIpc } from "../../platform/electron/ElectronIpc";
import { requireTrustedAppRendererSender } from "../../platform/electron/TrustedRendererSender";

export class GitWorkerIpcError extends Schema.TaggedError<GitWorkerIpcError>()(
  "GitWorkerIpcError",
  { operation: Schema.String, cause: Schema.Defect() },
) {}

export const live: Layer.Layer<never, never, ElectronIpc | MainConfig | HostWorkerRuntime> =
  Layer.effectDiscard(
    Effect.gen(function* () {
      const ipc = yield* ElectronIpc;
      const config = yield* MainConfig;
      const workers = yield* HostWorkerRuntime;
      yield* ipc.handle(GIT_WORKER_MESSAGE_FROM_VIEW_CHANNEL, (event, rawMessage: unknown) =>
        Effect.try({
          try: () => {
            requireTrustedAppRendererSender(event, "Git worker", config.rendererUrl);
            if (!isGitWorkerMessageFromView(rawMessage)) {
              throw new Error("Invalid Git worker renderer message");
            }
            workers.git.handleRendererMessage(event.sender, rawMessage);
          },
          catch: (cause) => new GitWorkerIpcError({ operation: "renderer-message", cause }),
        }).pipe(
          Effect.tapError((error) =>
            Effect.sync(() => {
              captureMainException(error.cause, {
                tags: { channel: GIT_WORKER_MESSAGE_FROM_VIEW_CHANNEL, mechanism: "ipc" },
                extra: { senderWebContentsId: event.sender.id },
              });
            }),
          ),
        ),
      );
    }),
  );
