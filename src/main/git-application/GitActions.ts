import { stat } from "node:fs/promises";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type {
  GitActionMutationResult,
  GitCommitMessageGenerateInput,
  GitCommitMessageGenerateResult,
  GitCommitInput,
  GitPullRequestMessageGenerateInput,
  GitPullRequestMessageGenerateResult,
  GitPushInput,
  GitReviewPatchRequest,
  GitReviewPatchResult,
} from "../../shared/types";
import { CodexGitMessageGeneration } from "../codex-application/CodexGitMessageGeneration";
import {
  GitActionOperationRuntime,
  type GitActionOperationRuntimeError,
} from "../host-runtime/GitActionOperationRuntime";
import { GitWorkerRuntime } from "../host-runtime/GitWorkerRuntime";

const COMMIT_MESSAGE_DIFF_INLINE_LINE_THRESHOLD = 1_000;
const PULL_REQUEST_MESSAGE_DIFF_INLINE_LINE_THRESHOLD = 1_000;
const PULL_REQUEST_MESSAGE_FILE_PATH_LIMIT = 100;
const COMMIT_MESSAGE_TESTING_NOTE =
  "Testing note: If you mention tests, include unit tests or UI testing frameworks only. Skip lint/tsc since CI runs those.";
const COMMIT_MESSAGE_UNTRACKED_NOTE = "Untracked changes are not included.";

interface CommitMessageDiffSummary {
  readonly filesChanged: number;
  readonly linesAdded: number;
  readonly linesRemoved: number;
}

interface CommitMessagePromptInput {
  readonly commitInstructions?: string | null;
  readonly diffError?: { readonly type: "diff-too-large" } | null;
  readonly draftMessage: string;
  readonly includesUntrackedChanges: boolean;
  readonly oversizedDiffSummary?: CommitMessageDiffSummary | null;
  readonly uncommittedDiff: string | null;
}

class GitActionsExecutionError extends Data.TaggedError("GitActionsExecutionError")<{
  readonly cause: unknown;
}> {}

export class GitActions extends Context.Service<
  GitActions,
  {
    readonly generateCommitMessage: (
      input: GitCommitMessageGenerateInput,
    ) => Effect.Effect<GitCommitMessageGenerateResult, GitActionOperationRuntimeError>;
    readonly generatePullRequestMessage: (
      input: GitPullRequestMessageGenerateInput,
    ) => Effect.Effect<GitPullRequestMessageGenerateResult, GitActionOperationRuntimeError>;
    readonly commit: (
      input: GitCommitInput,
    ) => Effect.Effect<GitActionMutationResult, GitActionOperationRuntimeError>;
    readonly push: (
      input: GitPushInput,
    ) => Effect.Effect<GitActionMutationResult, GitActionOperationRuntimeError>;
    readonly cancel: GitActionOperationRuntime["Service"]["cancel"];
  }
>()("nodex/main/git-application/GitActions") {}

const summarizeUnifiedDiff = (diff: string | null): CommitMessageDiffSummary | null => {
  if (diff === null || diff.trim().length === 0) return null;

  let filesChanged = 0;
  let linesAdded = 0;
  let linesRemoved = 0;
  let insideHunk = false;
  for (const line of diff.split(/\r?\n/u)) {
    if (line.startsWith("diff --git ")) {
      filesChanged += 1;
      insideHunk = false;
      continue;
    }
    if (line.startsWith("@@")) {
      insideHunk = true;
      continue;
    }
    if (!insideHunk) continue;
    if (line.startsWith("+")) {
      linesAdded += 1;
      continue;
    }
    if (line.startsWith("-")) linesRemoved += 1;
  }
  return { filesChanged, linesAdded, linesRemoved };
};

const formatCommitMessageChanges = (
  input: Pick<
    CommitMessagePromptInput,
    "diffError" | "includesUntrackedChanges" | "oversizedDiffSummary" | "uncommittedDiff"
  >,
): string | null => {
  const untrackedNote = input.includesUntrackedChanges ? [] : ["", COMMIT_MESSAGE_UNTRACKED_NOTE];
  if (input.oversizedDiffSummary) {
    return [
      "Changes:",
      "Diff too large to include inline.",
      `Summary: ${input.oversizedDiffSummary.filesChanged} changed files, +${input.oversizedDiffSummary.linesAdded}/-${input.oversizedDiffSummary.linesRemoved} lines.`,
      ...untrackedNote,
    ].join("\n");
  }
  if (input.diffError?.type === "diff-too-large") {
    return ["Changes:", "Diff too large to include inline.", ...untrackedNote].join("\n");
  }
  if (!input.uncommittedDiff || input.uncommittedDiff.trim().length === 0) return null;
  return ["Changes:", input.uncommittedDiff, ...untrackedNote].join("\n");
};

const buildCommitMessagePrompt = (input: CommitMessagePromptInput): string => {
  const sections: string[] = [];
  const draftMessage = input.draftMessage.trim();
  if (draftMessage.length > 0) sections.push(`Draft message:\n${draftMessage}`);
  const changes = formatCommitMessageChanges({
    diffError: input.diffError ?? null,
    includesUntrackedChanges: input.includesUntrackedChanges,
    oversizedDiffSummary: input.oversizedDiffSummary ?? null,
    uncommittedDiff: input.uncommittedDiff,
  });
  if (changes) sections.push(changes);
  if (sections.length > 0) sections.push(COMMIT_MESSAGE_TESTING_NOTE);
  const commitInstructions = input.commitInstructions?.trim() ?? "";
  if (commitInstructions.length > 0) {
    sections.push(
      `Custom commit instructions (apply these to the commit message text only; do not change the required output format):\n${commitInstructions}`,
    );
  }
  return sections.join("\n\n");
};

const buildCommitMessagePromptFromDiff = (input: {
  readonly diff: string | null;
  readonly diffError: CommitMessagePromptInput["diffError"];
  readonly draftMessage: string;
  readonly includesUntrackedChanges: boolean;
}): string => {
  const diffSummary = summarizeUnifiedDiff(input.diff);
  const changedLines = (diffSummary?.linesAdded ?? 0) + (diffSummary?.linesRemoved ?? 0);
  const oversizedDiffSummary =
    changedLines > COMMIT_MESSAGE_DIFF_INLINE_LINE_THRESHOLD ? diffSummary : null;
  return buildCommitMessagePrompt({
    diffError: input.diffError,
    draftMessage: input.draftMessage,
    includesUntrackedChanges: input.includesUntrackedChanges,
    oversizedDiffSummary,
    uncommittedDiff: oversizedDiffSummary === null ? input.diff : null,
  });
};

const readUnifiedDiffFilePaths = (diff: string | null): string[] => {
  if (!diff) return [];
  const paths = new Set<string>();
  for (const line of diff.split(/\r?\n/u)) {
    if (!line.startsWith("diff --git a/")) continue;
    const filePath = /^diff --git a\/(.+) b\/(.+)$/u.exec(line)?.[2]?.trim();
    if (filePath) paths.add(filePath);
  }
  return [...paths];
};

const formatPullRequestFilePaths = (filePaths: readonly string[]): string => {
  if (filePaths.length === 0) return "- (no files listed)";
  const visiblePaths = filePaths.slice(0, PULL_REQUEST_MESSAGE_FILE_PATH_LIMIT);
  const hiddenCount = filePaths.length - visiblePaths.length;
  const lines = visiblePaths.map((filePath) => `- ${filePath}`);
  if (hiddenCount > 0) lines.push(`...and ${hiddenCount} more`);
  return lines.join("\n");
};

const formatPullRequestChanges = (diff: string | null, filePaths: readonly string[]): string => {
  const normalizedDiff = diff?.trim() ?? "";
  const diffLineCount = normalizedDiff ? normalizedDiff.split(/\r?\n/u).length : 0;
  if (!normalizedDiff || diffLineCount > PULL_REQUEST_MESSAGE_DIFF_INLINE_LINE_THRESHOLD) {
    return ["Changes:", formatPullRequestFilePaths(filePaths)].join("\n");
  }
  return ["Changes:", normalizedDiff].join("\n");
};

const buildPullRequestMessagePrompt = (input: {
  readonly title: string;
  readonly body: string;
  readonly headBranch: string | null;
  readonly baseBranch: string | null;
  readonly unifiedDiff: string | null;
}): string => {
  const sections: string[] = [];
  if (input.headBranch || input.baseBranch) {
    sections.push(
      [
        "Branches:",
        `- Head: ${input.headBranch ?? "-"}`,
        `- Base: ${input.baseBranch ?? "-"}`,
      ].join("\n"),
    );
  }
  if (input.title.length > 0 || input.body.length > 0) {
    sections.push(
      [
        "Pull request draft:",
        `Title: ${input.title || "-"}`,
        input.body.length > 0 ? `Body:\n${input.body}` : "Body: -",
      ].join("\n"),
    );
  }
  if (!input.baseBranch) {
    sections.push("Changes:\n- (no files listed)");
    return sections.join("\n\n");
  }
  sections.push(
    formatPullRequestChanges(input.unifiedDiff, readUnifiedDiffFilePaths(input.unifiedDiff)),
  );
  return sections.join("\n\n");
};

const gitErrorMessage = (error: unknown, fallback: string): string => {
  const cause = error instanceof GitActionsExecutionError ? error.cause : error;
  if (!(cause instanceof Error)) return fallback;
  const errorCode = (cause as { readonly code?: unknown }).code;
  if (cause.name === "AbortError" || errorCode === "ABORT_ERR") {
    return "Git action was canceled.";
  }
  const stderr = "stderr" in cause && typeof cause.stderr === "string" ? cause.stderr.trim() : "";
  return stderr || cause.message || fallback;
};

const gitErrorStderr = (error: unknown): string => {
  const cause = error instanceof GitActionsExecutionError ? error.cause : error;
  if (!cause || typeof cause !== "object") return "";
  return "stderr" in cause && typeof cause.stderr === "string" ? cause.stderr : "";
};

const mutationError = (
  cwd: string,
  branch: string | null,
  error: unknown,
  fallback: string,
): GitActionMutationResult => ({
  cwd,
  status: "error",
  branch,
  stdout: "",
  stderr: gitErrorStderr(error),
  errorMessage: gitErrorMessage(error, fallback),
});

export const live: Layer.Layer<
  GitActions,
  never,
  CodexGitMessageGeneration | GitActionOperationRuntime | GitWorkerRuntime
> = Layer.effect(
  GitActions,
  Effect.gen(function* () {
    const operations = yield* GitActionOperationRuntime;
    const messageGeneration = yield* CodexGitMessageGeneration;
    const worker = yield* GitWorkerRuntime;

    const ensureDirectory = Effect.fn("GitActions.ensureDirectory")(function* (cwd: string) {
      const normalizedCwd = cwd.trim();
      if (!normalizedCwd) {
        return yield* new GitActionsExecutionError({
          cause: new Error("Working directory is required"),
        });
      }
      const entry = yield* Effect.tryPromise({
        try: () => stat(normalizedCwd),
        catch: (cause) => new GitActionsExecutionError({ cause }),
      }).pipe(Effect.option);
      if (entry._tag === "None" || !entry.value.isDirectory()) {
        return yield* new GitActionsExecutionError({
          cause: new Error(`Working directory not found: ${normalizedCwd}`),
        });
      }
      return normalizedCwd;
    });

    const readReviewPatch = Effect.fn("GitActions.readReviewPatch")(function* (input: {
      readonly method: "review-patch";
      readonly params: GitReviewPatchRequest;
    }) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const result = yield* worker.request(input);
        if (!("type" in result) || result.type !== "stale-snapshot") {
          return result as GitReviewPatchResult;
        }
      }
      return yield* new GitActionsExecutionError({
        cause: new Error("Git repository changed while preparing the message."),
      });
    });

    const readCommitMessageContext = Effect.fn("GitActions.readCommitMessageContext")(function* (
      cwd: string,
      includeUnstaged: boolean,
    ) {
      const sources = includeUnstaged ? (["staged", "unstaged"] as const) : (["staged"] as const);
      const patches = yield* Effect.all(
        sources.map((source) =>
          readReviewPatch({ method: "review-patch", params: { cwd, source } }),
        ),
        { concurrency: "unbounded" },
      );
      if (patches.some((patch) => !patch.isGitRepository)) {
        return yield* new GitActionsExecutionError({
          cause: new Error("Git repository is required before generating a commit message."),
        });
      }
      if (patches.some((patch) => patch.diff.type === "error")) {
        return { unifiedDiff: null, diffError: { type: "diff-too-large" } as const };
      }
      const unifiedDiff = patches
        .flatMap((patch) => (patch.diff.type === "success" ? [patch.diff.unifiedDiff] : []))
        .filter((diff) => diff.trim().length > 0)
        .join("\n");
      return { unifiedDiff: unifiedDiff || null, diffError: null };
    });

    const generateCommitText = Effect.fn("GitActions.generateCommitText")(function* (
      cwd: string,
      draftMessage: string,
      unifiedDiff: string | null,
      includesUntrackedChanges: boolean,
      diffError: CommitMessagePromptInput["diffError"],
      hostId: string | undefined,
    ) {
      const prompt = buildCommitMessagePromptFromDiff({
        diff: unifiedDiff,
        diffError,
        draftMessage,
        includesUntrackedChanges,
      });
      const generated = yield* messageGeneration.generateCommitMessage({ hostId, prompt, cwd });
      const message = generated?.trim() ?? "";
      if (message) return message;
      return yield* new GitActionsExecutionError({
        cause: new Error("Couldn't generate a commit message"),
      });
    });

    const resolveCommitMessage = Effect.fn("GitActions.resolveCommitMessage")(function* (
      input: GitCommitInput,
      cwd: string,
      includeUnstaged: boolean,
    ) {
      const requestedMessage = input.message.trim();
      if (requestedMessage) return requestedMessage;
      const context = yield* readCommitMessageContext(cwd, includeUnstaged);
      const prompt = buildCommitMessagePromptFromDiff({
        diff: context.unifiedDiff,
        diffError: context.diffError,
        draftMessage: requestedMessage,
        includesUntrackedChanges: includeUnstaged,
      });
      const generated = yield* messageGeneration.generateCommitMessage({
        hostId: input.hostId,
        prompt,
        cwd,
      });
      const message = generated?.trim() ?? "";
      if (message) return message;
      return yield* new GitActionsExecutionError({
        cause: new Error("Couldn't generate a commit message"),
      });
    });

    const commitOperation = Effect.fn("GitActions.commitOperation")(function* (
      input: GitCommitInput,
    ) {
      let cwd = input.cwd.trim();
      let branch: string | null = null;
      return yield* Effect.gen(function* () {
        cwd = yield* ensureDirectory(input.cwd);
        const status = yield* worker.request({ method: "action-status", params: { cwd } });
        branch = status.currentBranch;
        if (!status.isGitRepository) {
          return mutationError(
            cwd,
            null,
            new Error("Git repository is required before committing."),
            "Git repository is required before committing.",
          );
        }
        const includeUnstaged = input.includeUnstaged !== false;
        const hasChanges = includeUnstaged ? status.hasUncommittedChanges : status.hasStagedChanges;
        if (!hasChanges) {
          return mutationError(
            cwd,
            branch,
            new Error("No staged changes to commit."),
            "No staged changes to commit.",
          );
        }
        const message = yield* resolveCommitMessage(input, cwd, includeUnstaged);
        const committed = yield* worker.request({
          method: "commit",
          params: { ...input, cwd, message, nextStep: "commit" },
        });
        if (committed.status !== "success" || input.nextStep !== "commit-and-push") {
          return committed;
        }
        const pushed = yield* worker.request({
          method: "push",
          params: { cwd, force: false },
        });
        if (pushed.status !== "success") return pushed;
        return {
          ...pushed,
          branch: committed.branch,
          stdout: [committed.stdout, pushed.stdout].filter(Boolean).join("\n"),
          stderr: [committed.stderr, pushed.stderr].filter(Boolean).join("\n"),
        };
      }).pipe(
        Effect.catch((error) =>
          Effect.succeed(mutationError(cwd, branch, error, "Could not commit changes.")),
        ),
      );
    });

    const commitMessageOperation = Effect.fn("GitActions.commitMessageOperation")(function* (
      input: GitCommitMessageGenerateInput,
    ) {
      let cwd = input.cwd.trim();
      return yield* Effect.gen(function* () {
        cwd = yield* ensureDirectory(input.cwd);
        const status = yield* worker.request({ method: "action-status", params: { cwd } });
        if (!status.isGitRepository) {
          return {
            cwd,
            status: "error",
            message: null,
            stderr: "",
            errorMessage: "Git repository is required before generating a commit message.",
          } as const;
        }
        const includeUnstaged = input.includeUnstaged !== false;
        const hasChanges = includeUnstaged ? status.hasUncommittedChanges : status.hasStagedChanges;
        if (!hasChanges) {
          return {
            cwd,
            status: "error",
            message: null,
            stderr: "",
            errorMessage: "No staged changes to generate a commit message for.",
          } as const;
        }
        const context = yield* readCommitMessageContext(cwd, includeUnstaged);
        const message = yield* generateCommitText(
          cwd,
          input.draftMessage?.trim() ?? "",
          context.unifiedDiff,
          includeUnstaged,
          context.diffError,
          input.hostId,
        );
        return { cwd, status: "success", message, stderr: "", errorMessage: null } as const;
      }).pipe(
        Effect.catch((error) =>
          Effect.succeed({
            cwd,
            status: "error" as const,
            message: null,
            stderr: gitErrorStderr(error),
            errorMessage: gitErrorMessage(error, "Could not generate a commit message."),
          }),
        ),
      );
    });

    const pullRequestMessageOperation = Effect.fn("GitActions.pullRequestMessageOperation")(
      function* (input: GitPullRequestMessageGenerateInput) {
        let cwd = input.cwd.trim();
        return yield* Effect.gen(function* () {
          cwd = yield* ensureDirectory(input.cwd);
          const status = yield* worker.request({ method: "action-status", params: { cwd } });
          if (!status.isGitRepository) {
            return {
              cwd,
              status: "error",
              title: null,
              body: null,
              stderr: "",
              errorMessage: "Git repository is required before generating a pull request message.",
            } as const;
          }
          const title = input.title?.trim() ?? "";
          const body = input.body?.trim() ?? "";
          const headBranch = input.headBranch?.trim() || status.currentBranch;
          const baseBranch = input.baseBranch?.trim() || status.defaultBranch;
          const patch = baseBranch
            ? yield* readReviewPatch({
                method: "review-patch",
                params: { cwd, source: "branch", baseBranch },
              })
            : null;
          const prompt = buildPullRequestMessagePrompt({
            title,
            body,
            headBranch,
            baseBranch,
            unifiedDiff: patch?.diff.type === "success" ? patch.diff.unifiedDiff : null,
          });
          const generated =
            title && body
              ? { title, body }
              : yield* messageGeneration.generatePullRequestMessage({
                  hostId: input.hostId,
                  prompt,
                  cwd,
                });
          const generatedTitle = title || generated?.title?.trim() || "";
          const generatedBody = body || generated?.body?.trim() || "";
          if (!generatedTitle || !generatedBody) {
            return yield* new GitActionsExecutionError({
              cause: new Error("Couldn't generate pull request title and body"),
            });
          }
          return {
            cwd,
            status: "success",
            title: generatedTitle,
            body: generatedBody,
            stderr: "",
            errorMessage: null,
          } as const;
        }).pipe(
          Effect.catch((error) =>
            Effect.succeed({
              cwd,
              status: "error" as const,
              title: null,
              body: null,
              stderr: gitErrorStderr(error),
              errorMessage: gitErrorMessage(
                error,
                "Could not generate pull request title and body.",
              ),
            }),
          ),
        );
      },
    );

    const pushOperation = Effect.fn("GitActions.pushOperation")(function* (input: GitPushInput) {
      let cwd = input.cwd.trim();
      let branch: string | null = null;
      return yield* Effect.gen(function* () {
        cwd = yield* ensureDirectory(input.cwd);
        const result = yield* worker.request({ method: "push", params: { ...input, cwd } });
        branch = result.branch;
        return result;
      }).pipe(
        Effect.catch((error) =>
          Effect.succeed(mutationError(cwd, branch, error, "Could not push changes.")),
        ),
      );
    });

    return GitActions.of({
      generateCommitMessage: (input) =>
        operations.run(input.operationId, commitMessageOperation(input), () => ({
          cwd: input.cwd.trim(),
          status: "error",
          message: null,
          stderr: "",
          errorMessage: "Git action was canceled.",
        })),
      generatePullRequestMessage: (input) =>
        operations.run(input.operationId, pullRequestMessageOperation(input), () => ({
          cwd: input.cwd.trim(),
          status: "error",
          title: null,
          body: null,
          stderr: "",
          errorMessage: "Git action was canceled.",
        })),
      commit: (input) =>
        operations.run(input.operationId, commitOperation(input), () => ({
          cwd: input.cwd.trim(),
          status: "error",
          branch: null,
          stdout: "",
          stderr: "",
          errorMessage: "Git action was canceled.",
        })),
      push: (input) =>
        operations.run(input.operationId, pushOperation(input), () => ({
          cwd: input.cwd.trim(),
          status: "error",
          branch: null,
          stdout: "",
          stderr: "",
          errorMessage: "Git action was canceled.",
        })),
      cancel: operations.cancel,
    });
  }),
);
