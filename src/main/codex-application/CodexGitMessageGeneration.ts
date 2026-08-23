import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { CodexGateway } from "../codex-runtime/CodexGateway";
import type { CodexRuntimeError } from "../codex-runtime/CodexRuntimeError";

export interface CodexGitMessageGenerationInput {
  readonly hostId?: string | null;
  readonly prompt: string;
  readonly cwd: string;
}

export interface CodexGeneratedPullRequestMessage {
  readonly title: string | null;
  readonly body: string | null;
}

export class CodexGitMessageGeneration extends Context.Service<
  CodexGitMessageGeneration,
  {
    readonly generateCommitMessage: (
      input: CodexGitMessageGenerationInput,
    ) => Effect.Effect<string | null, CodexRuntimeError>;
    readonly generatePullRequestMessage: (
      input: CodexGitMessageGenerationInput,
    ) => Effect.Effect<CodexGeneratedPullRequestMessage, CodexRuntimeError>;
  }
>()("nodex/main/codex-application/CodexGitMessageGeneration") {}

const CommitMessageResponse = Schema.Struct({
  message: Schema.optionalKey(Schema.String),
});
const PullRequestMessageResponse = Schema.Struct({
  title: Schema.optionalKey(Schema.String),
  body: Schema.optionalKey(Schema.String),
});
const decodeCommitMessage = Schema.decodeUnknownOption(CommitMessageResponse);
const decodePullRequestMessage = Schema.decodeUnknownOption(PullRequestMessageResponse);

const normalize = (value: string | undefined): string | null => {
  const normalized = value?.trim() ?? "";
  return normalized || null;
};

export const live: Layer.Layer<CodexGitMessageGeneration, never, CodexGateway> = Layer.effect(
  CodexGitMessageGeneration,
  Effect.gen(function* () {
    const gateway = yield* CodexGateway;

    const generateCommitMessage = Effect.fn("CodexGitMessageGeneration.generateCommitMessage")(
      function* (input: CodexGitMessageGenerationInput) {
        const hostId = input.hostId?.trim() || gateway.localHostId;
        const response = yield* gateway
          .requestRawOnHost(hostId, "generate-commit-message", {
            hostId,
            prompt: input.prompt,
            cwd: input.cwd,
          })
          .pipe(
            Effect.tapError((error) =>
              Effect.logWarning("Failed to generate commit message").pipe(
                Effect.annotateLogs({ hostId, reason: error.reason }),
              ),
            ),
          );
        return normalize(Option.getOrUndefined(decodeCommitMessage(response))?.message);
      },
    );

    const generatePullRequestMessage = Effect.fn(
      "CodexGitMessageGeneration.generatePullRequestMessage",
    )(function* (input: CodexGitMessageGenerationInput) {
      const hostId = input.hostId?.trim() || gateway.localHostId;
      const response = yield* gateway
        .requestRawOnHost(hostId, "generate-pull-request-message", {
          hostId,
          prompt: input.prompt,
          cwd: input.cwd,
        })
        .pipe(
          Effect.tapError((error) =>
            Effect.logWarning("Failed to generate pull request message").pipe(
              Effect.annotateLogs({ hostId, reason: error.reason }),
            ),
          ),
        );
      const decoded = Option.getOrUndefined(decodePullRequestMessage(response));
      return {
        title: normalize(decoded?.title),
        body: normalize(decoded?.body),
      };
    });

    return CodexGitMessageGeneration.of({
      generateCommitMessage,
      generatePullRequestMessage,
    });
  }),
);
