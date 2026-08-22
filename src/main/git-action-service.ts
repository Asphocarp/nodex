import { stat } from "node:fs/promises";
import path from "node:path";
import type {
  GitActionMutationResult,
  GitActionStatusResult,
  GitCommitMessageGenerateInput,
  GitCommitMessageGenerateResult,
  GitCommitInput,
  GitPullRequestMessageGenerateInput,
  GitPullRequestMessageGenerateResult,
  GitPushInput,
  GitReviewPatchRequest,
  GitReviewPatchResult,
} from "../shared/types";

const GENERATED_COMMIT_SUBJECT_MAX_LENGTH = 72;
const COMMIT_MESSAGE_DIFF_INLINE_LINE_THRESHOLD = 1_000;
const PULL_REQUEST_MESSAGE_DIFF_INLINE_LINE_THRESHOLD = 1_000;
const PULL_REQUEST_MESSAGE_FILE_PATH_LIMIT = 100;
const COMMIT_MESSAGE_TESTING_NOTE =
  "Testing note: If you mention tests, include unit tests or UI testing frameworks only. Skip lint/tsc since CI runs those.";
const COMMIT_MESSAGE_UNTRACKED_NOTE = "Untracked changes are not included.";
interface CommitMessageDiffSummary {
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
}

interface CommitMessagePromptInput {
  commitInstructions?: string | null;
  diffError?: { type: "diff-too-large" } | null;
  draftMessage: string;
  includesUntrackedChanges: boolean;
  oversizedDiffSummary?: CommitMessageDiffSummary | null;
  uncommittedDiff: string | null;
}

export interface GitCommitMessageGenerationRequest {
  cwd: string;
  prompt: string;
  signal?: AbortSignal;
}

export interface GitPullRequestMessageGenerationRequest {
  cwd: string;
  prompt: string;
  signal?: AbortSignal;
}

export interface GitPullRequestMessageGenerationResponse {
  title: string | null;
  body: string | null;
}

export interface GitActionMutationOptions {
  gitWorker: GitActionWorkerPort;
}

export interface CommitGitChangesOptions extends GitActionMutationOptions {
  generateCommitMessage?: (input: GitCommitMessageGenerationRequest) => Promise<string | null>;
  generatePullRequestMessage?: (
    input: GitPullRequestMessageGenerationRequest,
  ) => Promise<GitPullRequestMessageGenerationResponse | null>;
}

export interface GitActionWorkerPort {
  readStatus(cwd: string, signal?: AbortSignal): Promise<GitActionStatusResult>;
  readReviewPatch(
    input: Omit<GitReviewPatchRequest, "requestId">,
    signal?: AbortSignal,
  ): Promise<GitReviewPatchResult>;
  commit(input: GitCommitInput, signal?: AbortSignal): Promise<GitActionMutationResult>;
  push(input: GitPushInput, signal?: AbortSignal): Promise<GitActionMutationResult>;
}

async function ensureDirectory(cwd: string, signal?: AbortSignal): Promise<string> {
  throwIfAborted(signal);
  const normalizedCwd = cwd.trim();
  if (!normalizedCwd) {
    throw new Error("Working directory is required");
  }

  const entry = await stat(normalizedCwd).catch(() => null);
  throwIfAborted(signal);
  if (!entry?.isDirectory()) {
    throw new Error(`Working directory not found: ${normalizedCwd}`);
  }

  return normalizedCwd;
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const errorCode = (error as { code?: unknown }).code;
  return error.name === "AbortError" || errorCode === "ABORT_ERR";
}

function gitErrorMessage(error: unknown, fallback: string): string {
  if (isAbortError(error)) return "Git action was canceled.";
  if (!(error instanceof Error)) return fallback;

  const stderr = "stderr" in error && typeof error.stderr === "string" ? error.stderr.trim() : "";
  return stderr || error.message || fallback;
}

function gitErrorStderr(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  return "stderr" in error && typeof error.stderr === "string" ? error.stderr : "";
}

function fileBasename(filePath: string): string {
  return path.posix.basename(filePath) || filePath;
}

function truncateCommitSubject(subject: string): string {
  const normalized = subject.replace(/\s+/g, " ").trim();
  if (normalized.length <= GENERATED_COMMIT_SUBJECT_MAX_LENGTH) return normalized;

  return `${normalized.slice(0, GENERATED_COMMIT_SUBJECT_MAX_LENGTH - 3).trimEnd()}...`;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;

  const error = new Error("Git action was canceled.");
  error.name = "AbortError";
  throw error;
}

function summarizeUnifiedDiff(diff: string | null): CommitMessageDiffSummary | null {
  if (diff === null || diff.trim().length === 0) return null;

  let filesChanged = 0;
  let linesAdded = 0;
  let linesRemoved = 0;
  let insideHunk = false;

  for (const line of diff.split(/\r?\n/)) {
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
    if (line.startsWith("-")) {
      linesRemoved += 1;
    }
  }

  return { filesChanged, linesAdded, linesRemoved };
}

function formatCommitMessageChanges(
  input: Pick<
    CommitMessagePromptInput,
    "diffError" | "includesUntrackedChanges" | "oversizedDiffSummary" | "uncommittedDiff"
  >,
): string | null {
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
}

function buildCommitMessagePrompt(input: CommitMessagePromptInput): string {
  const sections: string[] = [];
  const draftMessage = input.draftMessage.trim();
  if (draftMessage.length > 0) {
    sections.push(`Draft message:\n${draftMessage}`);
  }

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
}

function buildCommitMessagePromptFromDiff(input: {
  diff: string | null;
  diffError: CommitMessagePromptInput["diffError"];
  draftMessage: string;
  includesUntrackedChanges: boolean;
}): string {
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
}

function formatPullRequestFilePaths(filePaths: readonly string[]): string {
  if (filePaths.length === 0) return "- (no files listed)";

  const visiblePaths = filePaths.slice(0, PULL_REQUEST_MESSAGE_FILE_PATH_LIMIT);
  const hiddenCount = filePaths.length - visiblePaths.length;
  const lines = visiblePaths.map((filePath) => `- ${filePath}`);
  if (hiddenCount > 0) lines.push(`...and ${hiddenCount} more`);
  return lines.join("\n");
}

function formatPullRequestChanges(diff: string | null, filePaths: readonly string[]): string {
  const normalizedDiff = diff?.trim() ?? "";
  const diffLineCount = normalizedDiff ? normalizedDiff.split(/\r?\n/).length : 0;
  if (!normalizedDiff || diffLineCount > PULL_REQUEST_MESSAGE_DIFF_INLINE_LINE_THRESHOLD) {
    return ["Changes:", formatPullRequestFilePaths(filePaths)].join("\n");
  }

  return ["Changes:", normalizedDiff].join("\n");
}

function buildPullRequestMessagePrompt({
  title,
  body,
  headBranch,
  baseBranch,
  unifiedDiff,
}: {
  title: string;
  body: string;
  headBranch: string | null;
  baseBranch: string | null;
  unifiedDiff: string | null;
}): string {
  const sections: string[] = [];
  if (headBranch || baseBranch) {
    sections.push(
      ["Branches:", `- Head: ${headBranch ?? "-"}`, `- Base: ${baseBranch ?? "-"}`].join("\n"),
    );
  }

  if (title.length > 0 || body.length > 0) {
    sections.push(
      [
        "Pull request draft:",
        `Title: ${title || "-"}`,
        body.length > 0 ? `Body:\n${body}` : "Body: -",
      ].join("\n"),
    );
  }

  if (!baseBranch) {
    sections.push("Changes:\n- (no files listed)");
    return sections.join("\n\n");
  }

  const filePaths = readUnifiedDiffFilePaths(unifiedDiff);
  sections.push(formatPullRequestChanges(unifiedDiff, filePaths));
  return sections.join("\n\n");
}

function readUnifiedDiffFilePaths(diff: string | null): string[] {
  if (!diff) return [];
  const paths = new Set<string>();
  for (const line of diff.split(/\r?\n/u)) {
    if (!line.startsWith("diff --git a/")) continue;
    const match = /^diff --git a\/(.+) b\/(.+)$/u.exec(line);
    const filePath = match?.[2]?.trim();
    if (filePath) paths.add(filePath);
  }
  return [...paths];
}

function fallbackPullRequestTitle(branch: string | null): string {
  const normalizedBranch = branch
    ?.split("/")
    .filter(Boolean)
    .at(-1)
    ?.replace(/[-_]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!normalizedBranch) return "Update branch";

  return normalizedBranch.charAt(0).toUpperCase() + normalizedBranch.slice(1);
}

async function generatePullRequestMessage(
  cwd: string,
  input: {
    title: string;
    body: string;
    headBranch: string | null;
    baseBranch: string | null;
    unifiedDiff: string | null;
  },
  options: CommitGitChangesOptions,
  signal?: AbortSignal,
): Promise<{ title: string; body: string }> {
  throwIfAborted(signal);
  if (input.title.length > 0 && input.body.length > 0) {
    return {
      title: input.title,
      body: input.body,
    };
  }

  const prompt = buildPullRequestMessagePrompt({
    title: input.title,
    body: input.body,
    headBranch: input.headBranch,
    baseBranch: input.baseBranch,
    unifiedDiff: input.unifiedDiff,
  });

  if (!options.generatePullRequestMessage) {
    return {
      title: input.title || fallbackPullRequestTitle(input.headBranch),
      body: input.body || prompt,
    };
  }

  const generated = await options.generatePullRequestMessage({ cwd, prompt, signal });
  throwIfAborted(signal);
  const title = input.title || generated?.title?.trim() || "";
  const body = input.body || generated?.body?.trim() || "";
  if (title.length > 0 && body.length > 0) {
    return { title, body };
  }

  throw new Error("Couldn't generate pull request title and body");
}

async function generateCommitMessage(
  cwd: string,
  draftMessage: string,
  unifiedDiff: string | null,
  includesUntrackedChanges: boolean,
  diffError: CommitMessagePromptInput["diffError"],
  options: CommitGitChangesOptions,
  signal?: AbortSignal,
): Promise<string> {
  throwIfAborted(signal);
  const prompt = buildCommitMessagePromptFromDiff({
    diff: unifiedDiff,
    diffError,
    draftMessage,
    includesUntrackedChanges,
  });
  if (!options.generateCommitMessage) {
    return summarizeUnifiedDiffPaths(unifiedDiff);
  }

  const generatedMessage = await options.generateCommitMessage({ cwd, prompt, signal });
  throwIfAborted(signal);

  const normalizedGeneratedMessage = generatedMessage?.trim() ?? "";
  if (normalizedGeneratedMessage.length > 0) return normalizedGeneratedMessage;

  throw new Error("Couldn't generate a commit message");
}

async function readCommitMessageContext(
  cwd: string,
  includeUnstaged: boolean,
  gitWorker: GitActionWorkerPort,
  signal?: AbortSignal,
): Promise<{
  unifiedDiff: string | null;
  diffError: CommitMessagePromptInput["diffError"];
}> {
  const sources = includeUnstaged ? (["staged", "unstaged"] as const) : (["staged"] as const);
  const patches = await Promise.all(
    sources.map(async (source) => await gitWorker.readReviewPatch({ cwd, source }, signal)),
  );
  throwIfAborted(signal);

  const repositoryFailure = patches.find((patch) => !patch.isGitRepository);
  if (repositoryFailure) {
    throw new Error("Git repository is required before generating a commit message.");
  }
  const patchFailure = patches.find((patch) => patch.diff.type === "error");
  if (patchFailure?.diff.type === "error") {
    return {
      unifiedDiff: null,
      diffError: { type: "diff-too-large" },
    };
  }

  const unifiedDiff = patches
    .flatMap((patch) => (patch.diff.type === "success" ? [patch.diff.unifiedDiff] : []))
    .filter((diff) => diff.trim().length > 0)
    .join("\n");
  return {
    unifiedDiff: unifiedDiff || null,
    diffError: null,
  };
}

async function resolveCommitMessage(
  cwd: string,
  requestedMessage: string,
  includeUnstaged: boolean,
  options: CommitGitChangesOptions,
  signal?: AbortSignal,
): Promise<string> {
  if (requestedMessage) return requestedMessage;
  const context = await readCommitMessageContext(cwd, includeUnstaged, options.gitWorker, signal);
  return await generateCommitMessage(
    cwd,
    requestedMessage,
    context.unifiedDiff,
    includeUnstaged,
    context.diffError,
    options,
    signal,
  );
}

function summarizeUnifiedDiffPaths(diff: string | null): string {
  const filePaths = readUnifiedDiffFilePaths(diff);
  if (filePaths.length === 0) return "Update working tree";
  if (filePaths.length === 1 && filePaths[0]) {
    return truncateCommitSubject(`Update ${fileBasename(filePaths[0])}`);
  }
  return `Update ${filePaths.length} files`;
}

function mutationError(
  cwd: string,
  branch: string | null,
  error: unknown,
  fallback: string,
): GitActionMutationResult {
  return {
    cwd,
    status: "error",
    branch,
    stdout: "",
    stderr: gitErrorStderr(error),
    errorMessage: gitErrorMessage(error, fallback),
  };
}

function commitMessageGenerationError(
  cwd: string,
  error: unknown,
  fallback: string,
): GitCommitMessageGenerateResult {
  return {
    cwd,
    status: "error",
    message: null,
    stderr: gitErrorStderr(error),
    errorMessage: gitErrorMessage(error, fallback),
  };
}

function pullRequestMessageGenerationError(
  cwd: string,
  error: unknown,
  fallback: string,
): GitPullRequestMessageGenerateResult {
  return {
    cwd,
    status: "error",
    title: null,
    body: null,
    stderr: gitErrorStderr(error),
    errorMessage: gitErrorMessage(error, fallback),
  };
}

export function commitGitChanges(
  input: GitCommitInput,
  options: CommitGitChangesOptions,
  signal?: AbortSignal,
): Promise<GitActionMutationResult> {
  const requestedMessage = input.message.trim();
  return (async () => {
    let cwd = input.cwd.trim();
    let branch: string | null = null;

    try {
      cwd = await ensureDirectory(input.cwd, signal);
      const status = await options.gitWorker.readStatus(cwd, signal);
      branch = status.currentBranch;
      if (!status.isGitRepository) {
        return {
          cwd,
          status: "error",
          branch: null,
          stdout: "",
          stderr: "",
          errorMessage: "Git repository is required before committing.",
        };
      }

      const includeUnstaged = input.includeUnstaged !== false;
      const hasCommitChanges = includeUnstaged
        ? status.hasUncommittedChanges
        : status.hasStagedChanges;
      if (!hasCommitChanges) {
        return {
          cwd,
          status: "error",
          branch,
          stdout: "",
          stderr: "",
          errorMessage: "No staged changes to commit.",
        };
      }

      const message = await resolveCommitMessage(
        cwd,
        requestedMessage,
        includeUnstaged,
        options,
        signal,
      );
      const committed = await options.gitWorker.commit(
        {
          ...input,
          cwd,
          message,
          nextStep: "commit",
        },
        signal,
      );
      if (committed.status !== "success" || input.nextStep !== "commit-and-push") {
        return committed;
      }

      const pushed = await options.gitWorker.push({ cwd, force: false }, signal);
      if (pushed.status !== "success") return pushed;
      return {
        ...pushed,
        branch: committed.branch,
        stdout: [committed.stdout, pushed.stdout].filter(Boolean).join("\n"),
        stderr: [committed.stderr, pushed.stderr].filter(Boolean).join("\n"),
      };
    } catch (error) {
      return mutationError(cwd, branch, error, "Could not commit changes.");
    }
  })();
}

export function generateGitCommitMessage(
  input: GitCommitMessageGenerateInput,
  options: CommitGitChangesOptions,
  signal?: AbortSignal,
): Promise<GitCommitMessageGenerateResult> {
  const draftMessage = input.draftMessage?.trim() ?? "";
  return (async () => {
    let cwd = input.cwd.trim();

    try {
      cwd = await ensureDirectory(input.cwd, signal);
      const status = await options.gitWorker.readStatus(cwd, signal);
      if (!status.isGitRepository) {
        return {
          cwd,
          status: "error",
          message: null,
          stderr: "",
          errorMessage: "Git repository is required before generating a commit message.",
        };
      }

      const includeUnstaged = input.includeUnstaged !== false;
      const hasCommitChanges = includeUnstaged
        ? status.hasUncommittedChanges
        : status.hasStagedChanges;
      if (!hasCommitChanges) {
        return {
          cwd,
          status: "error",
          message: null,
          stderr: "",
          errorMessage: "No staged changes to generate a commit message for.",
        };
      }

      const context = await readCommitMessageContext(
        cwd,
        includeUnstaged,
        options.gitWorker,
        signal,
      );
      const message = await generateCommitMessage(
        cwd,
        draftMessage,
        context.unifiedDiff,
        includeUnstaged,
        context.diffError,
        options,
        signal,
      );
      return {
        cwd,
        status: "success",
        message,
        stderr: "",
        errorMessage: null,
      };
    } catch (error) {
      return commitMessageGenerationError(cwd, error, "Could not generate a commit message.");
    }
  })();
}

export function generateGitPullRequestMessage(
  input: GitPullRequestMessageGenerateInput,
  options: CommitGitChangesOptions,
  signal?: AbortSignal,
): Promise<GitPullRequestMessageGenerateResult> {
  const title = input.title?.trim() ?? "";
  const body = input.body?.trim() ?? "";
  return (async () => {
    let cwd = input.cwd.trim();

    try {
      cwd = await ensureDirectory(input.cwd, signal);
      const status = await options.gitWorker.readStatus(cwd, signal);
      if (!status.isGitRepository) {
        return {
          cwd,
          status: "error",
          title: null,
          body: null,
          stderr: "",
          errorMessage: "Git repository is required before generating a pull request message.",
        };
      }

      const headBranch = input.headBranch?.trim() || status.currentBranch;
      const baseBranch = input.baseBranch?.trim() || status.defaultBranch;
      const patch = baseBranch
        ? await options.gitWorker.readReviewPatch(
            {
              cwd,
              source: "branch",
              baseBranch,
            },
            signal,
          )
        : null;
      const unifiedDiff = patch?.diff.type === "success" ? patch.diff.unifiedDiff : null;
      const generated = await generatePullRequestMessage(
        cwd,
        {
          title,
          body,
          headBranch,
          baseBranch,
          unifiedDiff,
        },
        options,
        signal,
      );

      return {
        cwd,
        status: "success",
        title: generated.title,
        body: generated.body,
        stderr: "",
        errorMessage: null,
      };
    } catch (error) {
      return pullRequestMessageGenerationError(
        cwd,
        error,
        "Could not generate pull request title and body.",
      );
    }
  })();
}

export function pushGitChanges(
  input: GitPushInput,
  options: GitActionMutationOptions,
  signal?: AbortSignal,
): Promise<GitActionMutationResult> {
  return (async () => {
    let cwd = input.cwd.trim();
    let branch: string | null = null;

    try {
      cwd = await ensureDirectory(input.cwd, signal);
      const result = await options.gitWorker.push({ ...input, cwd }, signal);
      branch = result.branch;
      return result;
    } catch (error) {
      return mutationError(cwd, branch, error, "Could not push changes.");
    }
  })();
}
