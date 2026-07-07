import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import path from "node:path";
import type {
  GitActionCancelInput,
  GitActionCancelResult,
  GitActionMutationResult,
  GitActionStatusResult,
  GitCommitMessageGenerateInput,
  GitCommitMessageGenerateResult,
  GitCommitInput,
  GitPullRequestMessageGenerateInput,
  GitPullRequestMessageGenerateResult,
  GitPushInput,
} from "../shared/types";
import { readGitBranchState } from "./git-branch-service";

interface GitCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface GitCommandError extends Error {
  stderr?: string;
  exitCode?: number | null;
}

const GIT_ACTION_COMMAND_TIMEOUT_MS = 30_000;
const GENERATED_COMMIT_SUBJECT_MAX_LENGTH = 72;
const COMMIT_MESSAGE_DIFF_INLINE_LINE_THRESHOLD = 1_000;
const PULL_REQUEST_MESSAGE_DIFF_INLINE_LINE_THRESHOLD = 1_000;
const PULL_REQUEST_MESSAGE_FILE_PATH_LIMIT = 100;
const COMMIT_MESSAGE_TESTING_NOTE =
  "Testing note: If you mention tests, include unit tests or UI testing frameworks only. Skip lint/tsc since CI runs those.";
const COMMIT_MESSAGE_UNTRACKED_NOTE = "Untracked changes are not included.";
const activeGitActionOperations = new Map<string, AbortController>();

interface StagedNameStatusChange {
  status: "added" | "copied" | "deleted" | "modified" | "renamed" | "other";
  path: string;
  previousPath: string | null;
}

interface CommitMessageDiffSummary {
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
}

interface CommitMessagePromptInput {
  commitInstructions?: string | null;
  diffError?: { type: "diff-too-large" } | null;
  draftMessage: string;
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

export interface CommitGitChangesOptions {
  generateCommitMessage?: (input: GitCommitMessageGenerationRequest) => Promise<string | null>;
  generatePullRequestMessage?: (
    input: GitPullRequestMessageGenerationRequest
  ) => Promise<GitPullRequestMessageGenerationResponse | null>;
}

async function ensureDirectory(cwd: string): Promise<string> {
  const normalizedCwd = cwd.trim();
  if (!normalizedCwd) {
    throw new Error("Working directory is required");
  }

  const entry = await stat(normalizedCwd).catch(() => null);
  if (!entry?.isDirectory()) {
    throw new Error(`Working directory not found: ${normalizedCwd}`);
  }

  return normalizedCwd;
}

function runGitCommand(
  args: string[],
  cwd: string,
  allowedExitCodes: number[] = [0],
  signal?: AbortSignal,
): Promise<GitCommandResult> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      {
        cwd,
        encoding: "utf8",
        timeout: GIT_ACTION_COMMAND_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
        signal,
      },
      (error, stdout, stderr) => {
        const errorCode = (error as { code?: unknown } | null)?.code;
        const exitCode = typeof errorCode === "number" ? errorCode : null;
        if (error && (exitCode === null || !allowedExitCodes.includes(exitCode))) {
          const failure = error as GitCommandError;
          failure.stderr = typeof stderr === "string" ? stderr : "";
          failure.exitCode = exitCode;
          reject(failure);
          return;
        }

        resolve({
          stdout: typeof stdout === "string" ? stdout : "",
          stderr: typeof stderr === "string" ? stderr : "",
          exitCode: exitCode ?? 0,
        });
      },
    );
  });
}

function createGitActionOperation(operationId: string | undefined): {
  signal: AbortSignal | undefined;
  cleanup: () => void;
} {
  const normalizedOperationId = operationId?.trim();
  if (!normalizedOperationId) {
    return {
      signal: undefined,
      cleanup: () => undefined,
    };
  }

  activeGitActionOperations.get(normalizedOperationId)?.abort();
  const controller = new AbortController();
  activeGitActionOperations.set(normalizedOperationId, controller);

  return {
    signal: controller.signal,
    cleanup: () => {
      if (activeGitActionOperations.get(normalizedOperationId) !== controller) return;
      activeGitActionOperations.delete(normalizedOperationId);
    },
  };
}

async function runGitActionOperation<T>(
  operationId: string | undefined,
  action: (signal: AbortSignal | undefined) => Promise<T>,
): Promise<T> {
  const operation = createGitActionOperation(operationId);
  try {
    return await action(operation.signal);
  } finally {
    operation.cleanup();
  }
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

function isNotGitRepositoryError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const stderr = "stderr" in error && typeof error.stderr === "string" ? error.stderr : "";
  const message = `${error.message}\n${stderr}`.toLowerCase();
  return message.includes("not a git repository");
}

async function isGitRepository(cwd: string): Promise<boolean> {
  const result = await runGitCommand(["rev-parse", "--is-inside-work-tree"], cwd).catch(() => null);
  return result?.stdout.trim() === "true";
}

async function hasHeadCommit(cwd: string): Promise<boolean> {
  const result = await runGitCommand(["rev-parse", "--verify", "HEAD"], cwd, [0, 128]).catch(() => null);
  return result?.exitCode === 0;
}

async function hasDiff(cwd: string, args: string[], signal?: AbortSignal): Promise<boolean> {
  const result = await runGitCommand(["diff", "--quiet", ...args], cwd, [0, 1], signal);
  return result.exitCode === 1;
}

function resolveNameStatus(statusCode: string): StagedNameStatusChange["status"] {
  if (statusCode === "A") return "added";
  if (statusCode === "D") return "deleted";
  if (statusCode === "M") return "modified";
  return "other";
}

function parseGitNameStatus(stdout: string): StagedNameStatusChange[] {
  const tokens = stdout.split("\0").filter((token) => token.length > 0);
  const changes: StagedNameStatusChange[] = [];
  let index = 0;

  while (index < tokens.length) {
    const statusToken = tokens[index] ?? "";
    index += 1;
    const statusCode = statusToken[0] ?? "";

    if (statusCode === "R" || statusCode === "C") {
      const previousPath = tokens[index] ?? "";
      const nextPath = tokens[index + 1] ?? "";
      index += 2;
      if (!nextPath) continue;

      changes.push({
        status: statusCode === "R" ? "renamed" : "copied",
        path: nextPath,
        previousPath: previousPath || null,
      });
      continue;
    }

    const changedPath = tokens[index] ?? "";
    index += 1;
    if (!changedPath) continue;

    changes.push({
      status: resolveNameStatus(statusCode),
      path: changedPath,
      previousPath: null,
    });
  }

  return changes;
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

function summarizeSingleStagedChange(change: StagedNameStatusChange): string {
  if (change.status === "added") return `Add ${fileBasename(change.path)}`;
  if (change.status === "copied") return `Copy ${fileBasename(change.path)}`;
  if (change.status === "deleted") return `Remove ${fileBasename(change.path)}`;
  if (change.status === "renamed" && change.previousPath) {
    return `Rename ${fileBasename(change.previousPath)} to ${fileBasename(change.path)}`;
  }

  return `Update ${fileBasename(change.path)}`;
}

function summarizeStagedChanges(changes: StagedNameStatusChange[]): string {
  if (changes.length === 0) return "Update working tree";
  const firstChange = changes[0];
  if (changes.length === 1 && firstChange) return truncateCommitSubject(summarizeSingleStagedChange(firstChange));

  const changedCount = changes.length;
  const allAdded = changes.every((change) => change.status === "added" || change.status === "copied");
  const allDeleted = changes.every((change) => change.status === "deleted");
  const allRenamed = changes.every((change) => change.status === "renamed");

  if (allAdded) return `Add ${changedCount} files`;
  if (allDeleted) return `Remove ${changedCount} files`;
  if (allRenamed) return `Rename ${changedCount} files`;
  return `Update ${changedCount} files`;
}

async function generateCommitMessageFromStagedChanges(cwd: string, signal?: AbortSignal): Promise<string> {
  const result = await runGitCommand(["diff", "--cached", "--name-status", "-z"], cwd, [0], signal);
  return summarizeStagedChanges(parseGitNameStatus(result.stdout));
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

function parseGitNumstat(stdout: string): CommitMessageDiffSummary {
  const summary: CommitMessageDiffSummary = {
    filesChanged: 0,
    linesAdded: 0,
    linesRemoved: 0,
  };

  for (const line of stdout.split(/\r?\n/)) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    const [addedText, removedText] = trimmedLine.split(/\t/u);
    summary.filesChanged += 1;

    const added = Number.parseInt(addedText ?? "", 10);
    const removed = Number.parseInt(removedText ?? "", 10);
    if (Number.isFinite(added)) summary.linesAdded += added;
    if (Number.isFinite(removed)) summary.linesRemoved += removed;
  }

  return summary;
}

async function readStagedDiffSummary(cwd: string, signal?: AbortSignal): Promise<CommitMessageDiffSummary | null> {
  const result = await runGitCommand(["diff", "--cached", "--numstat"], cwd, [0], signal).catch(() => null);
  return result ? parseGitNumstat(result.stdout) : null;
}

async function readStagedUnifiedDiff(cwd: string, signal?: AbortSignal): Promise<{
  diff: string | null;
  diffError: CommitMessagePromptInput["diffError"];
  fallbackSummary: CommitMessageDiffSummary | null;
}> {
  try {
    const result = await runGitCommand(["diff", "--cached", "--no-ext-diff", "--unified=3"], cwd, [0], signal);
    return {
      diff: result.stdout,
      diffError: null,
      fallbackSummary: null,
    };
  } catch (error) {
    if (isAbortError(error)) throw error;

    return {
      diff: null,
      diffError: { type: "diff-too-large" },
      fallbackSummary: await readStagedDiffSummary(cwd, signal),
    };
  }
}

function formatCommitMessageChanges(input: Pick<CommitMessagePromptInput, "diffError" | "oversizedDiffSummary" | "uncommittedDiff">): string | null {
  if (input.oversizedDiffSummary) {
    return [
      "Changes:",
      "Diff too large to include inline.",
      `Summary: ${input.oversizedDiffSummary.filesChanged} changed files, +${input.oversizedDiffSummary.linesAdded}/-${input.oversizedDiffSummary.linesRemoved} lines.`,
      "",
      COMMIT_MESSAGE_UNTRACKED_NOTE,
    ].join("\n");
  }

  if (input.diffError?.type === "diff-too-large") {
    return ["Changes:", "Diff too large to include inline.", "", COMMIT_MESSAGE_UNTRACKED_NOTE].join("\n");
  }

  if (!input.uncommittedDiff || input.uncommittedDiff.trim().length === 0) return null;
  return ["Changes:", input.uncommittedDiff, COMMIT_MESSAGE_UNTRACKED_NOTE].join("\n");
}

function buildCommitMessagePrompt(input: CommitMessagePromptInput): string {
  const sections: string[] = [];
  const draftMessage = input.draftMessage.trim();
  if (draftMessage.length > 0) {
    sections.push(`Draft message:\n${draftMessage}`);
  }

  const changes = formatCommitMessageChanges({
    diffError: input.diffError ?? null,
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

async function buildStagedCommitMessagePrompt(cwd: string, draftMessage: string, signal?: AbortSignal): Promise<string> {
  const { diff, diffError, fallbackSummary } = await readStagedUnifiedDiff(cwd, signal);
  const diffSummary = fallbackSummary ?? summarizeUnifiedDiff(diff);
  const changedLines = (diffSummary?.linesAdded ?? 0) + (diffSummary?.linesRemoved ?? 0);
  const oversizedDiffSummary = changedLines > COMMIT_MESSAGE_DIFF_INLINE_LINE_THRESHOLD
    ? diffSummary
    : null;

  return buildCommitMessagePrompt({
    diffError,
    draftMessage,
    oversizedDiffSummary,
    uncommittedDiff: oversizedDiffSummary === null ? diff : null,
  });
}

async function readPullRequestUnifiedDiff(cwd: string, baseBranch: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const result = await runGitCommand(["diff", "--no-ext-diff", "--unified=3", `${baseBranch}...HEAD`], cwd, [0], signal);
    return result.stdout;
  } catch (error) {
    if (isAbortError(error)) throw error;
    return null;
  }
}

async function readPullRequestFilePaths(cwd: string, baseBranch: string, signal?: AbortSignal): Promise<string[]> {
  const result = await runGitCommand(["diff", "--name-only", `${baseBranch}...HEAD`], cwd, [0], signal).catch((error) => {
    if (isAbortError(error)) throw error;
    return null;
  });
  if (!result) return [];

  return result.stdout
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
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

async function buildPullRequestMessagePrompt({
  cwd,
  title,
  body,
  headBranch,
  baseBranch,
  signal,
}: {
  cwd: string;
  title: string;
  body: string;
  headBranch: string | null;
  baseBranch: string | null;
  signal?: AbortSignal;
}): Promise<string> {
  const sections: string[] = [];
  if (headBranch || baseBranch) {
    sections.push([
      "Branches:",
      `- Head: ${headBranch ?? "-"}`,
      `- Base: ${baseBranch ?? "-"}`,
    ].join("\n"));
  }

  if (title.length > 0 || body.length > 0) {
    sections.push([
      "Pull request draft:",
      `Title: ${title || "-"}`,
      body.length > 0 ? `Body:\n${body}` : "Body: -",
    ].join("\n"));
  }

  if (!baseBranch) {
    sections.push("Changes:\n- (no files listed)");
    return sections.join("\n\n");
  }

  const [diff, filePaths] = await Promise.all([
    readPullRequestUnifiedDiff(cwd, baseBranch, signal),
    readPullRequestFilePaths(cwd, baseBranch, signal),
  ]);
  sections.push(formatPullRequestChanges(diff, filePaths));
  return sections.join("\n\n");
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

  const prompt = await buildPullRequestMessagePrompt({
    cwd,
    title: input.title,
    body: input.body,
    headBranch: input.headBranch,
    baseBranch: input.baseBranch,
    signal,
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
  options: CommitGitChangesOptions,
  signal?: AbortSignal,
): Promise<string> {
  throwIfAborted(signal);
  const prompt = await buildStagedCommitMessagePrompt(cwd, draftMessage, signal);
  if (!options.generateCommitMessage) {
    return generateCommitMessageFromStagedChanges(cwd, signal);
  }

  const generatedMessage = await options.generateCommitMessage({ cwd, prompt, signal });
  throwIfAborted(signal);

  const normalizedGeneratedMessage = generatedMessage?.trim() ?? "";
  if (normalizedGeneratedMessage.length > 0) return normalizedGeneratedMessage;

  throw new Error("Couldn't generate a commit message");
}

async function resolveCommitMessage(
  cwd: string,
  requestedMessage: string,
  options: CommitGitChangesOptions,
  signal?: AbortSignal,
): Promise<string> {
  if (requestedMessage) return requestedMessage;
  return generateCommitMessage(cwd, requestedMessage, options, signal);
}

async function listUntrackedFiles(cwd: string): Promise<string[]> {
  const result = await runGitCommand(["ls-files", "--others", "--exclude-standard", "-z"], cwd);
  return result.stdout
    .split("\0")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

async function readRemotes(cwd: string): Promise<string[]> {
  const result = await runGitCommand(["remote"], cwd, [0, 128]).catch(() => null);
  if (!result) return [];
  return result.stdout
    .split(/\r?\n/)
    .map((remote) => remote.trim())
    .filter((remote, index, remotes) => remote.length > 0 && remotes.indexOf(remote) === index);
}

async function readUpstreamBranch(cwd: string): Promise<string | null> {
  const result = await runGitCommand(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], cwd, [0, 128])
    .catch(() => null);
  const upstream = result?.exitCode === 0 ? result.stdout.trim() : "";
  return upstream || null;
}

async function readCommitsAhead(cwd: string, upstreamBranch: string | null): Promise<number> {
  if (!upstreamBranch) return 0;

  const result = await runGitCommand(["rev-list", "--count", `${upstreamBranch}..HEAD`], cwd, [0, 128])
    .catch(() => null);
  const count = Number.parseInt(result?.stdout.trim() ?? "0", 10);
  return Number.isFinite(count) ? count : 0;
}

function emptyStatus(cwd: string): GitActionStatusResult {
  return {
    cwd,
    isGitRepository: false,
    currentBranch: null,
    defaultBranch: null,
    upstreamBranch: null,
    remotes: [],
    hasHeadCommit: false,
    hasStagedChanges: false,
    hasUnstagedChanges: false,
    hasUntrackedFiles: false,
    hasUncommittedChanges: false,
    commitsAhead: 0,
    canCommit: false,
    canPush: false,
    pushNeedsUpstream: false,
    errorMessage: null,
  };
}

export async function readGitActionStatus(input: { cwd: string }): Promise<GitActionStatusResult> {
  const cwd = await ensureDirectory(input.cwd);

  try {
    const repository = await isGitRepository(cwd);
    if (!repository) return emptyStatus(cwd);

    const [
      branchState,
      headCommit,
      stagedChanges,
      unstagedTrackedChanges,
      untrackedFiles,
      remotes,
      upstreamBranch,
    ] = await Promise.all([
      readGitBranchState(cwd),
      hasHeadCommit(cwd),
      hasDiff(cwd, ["--cached"]),
      hasDiff(cwd, []),
      listUntrackedFiles(cwd),
      readRemotes(cwd),
      readUpstreamBranch(cwd),
    ]);
    const commitsAhead = await readCommitsAhead(cwd, upstreamBranch);
    const hasUntrackedFiles = untrackedFiles.length > 0;
    const hasUnstagedChanges = unstagedTrackedChanges || hasUntrackedFiles;
    const hasUncommittedChanges = stagedChanges || hasUnstagedChanges;
    const pushNeedsUpstream = headCommit && branchState.currentBranch !== null && upstreamBranch === null;
    const canPush = headCommit
      && branchState.currentBranch !== null
      && (upstreamBranch !== null ? commitsAhead > 0 : remotes.includes("origin"));

    return {
      cwd,
      isGitRepository: true,
      currentBranch: branchState.currentBranch,
      defaultBranch: branchState.defaultBranch,
      upstreamBranch,
      remotes,
      hasHeadCommit: headCommit,
      hasStagedChanges: stagedChanges,
      hasUnstagedChanges,
      hasUntrackedFiles,
      hasUncommittedChanges,
      commitsAhead,
      canCommit: hasUncommittedChanges,
      canPush,
      pushNeedsUpstream,
      errorMessage: null,
    };
  } catch (error) {
    if (isNotGitRepositoryError(error)) return emptyStatus(cwd);

    return {
      ...emptyStatus(cwd),
      errorMessage: gitErrorMessage(error, "Could not read Git action status."),
    };
  }
}

function mutationError(cwd: string, branch: string | null, error: unknown, fallback: string): GitActionMutationResult {
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

async function pushGitBranch(
  cwd: string,
  force: boolean | undefined,
  signal?: AbortSignal,
): Promise<GitCommandResult> {
  const status = await readGitActionStatus({ cwd });
  if (!status.currentBranch) {
    throw new Error("Current branch is required before pushing.");
  }

  if (status.upstreamBranch) {
    return runGitCommand(["push", ...(force ? ["--force-with-lease"] : [])], cwd, [0], signal);
  }

  if (!status.remotes.includes("origin")) {
    throw new Error("No upstream branch or origin remote is configured.");
  }

  return runGitCommand([
    "push",
    ...(force ? ["--force-with-lease"] : []),
    "-u",
    "origin",
    status.currentBranch,
  ], cwd, [0], signal);
}

export async function commitGitChanges(
  input: GitCommitInput,
  options: CommitGitChangesOptions = {},
): Promise<GitActionMutationResult> {
  const cwd = await ensureDirectory(input.cwd);
  const requestedMessage = input.message.trim();
  const status = await readGitActionStatus({ cwd });
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

  return runGitActionOperation(input.operationId, async (signal) => {
    try {
      if (input.includeUnstaged !== false) {
        await runGitCommand(["add", "-A"], cwd, [0], signal);
      }

      const hasStagedChanges = await hasDiff(cwd, ["--cached"], signal);
      if (!hasStagedChanges) {
        return {
          cwd,
          status: "error",
          branch: status.currentBranch,
          stdout: "",
          stderr: "",
          errorMessage: "No staged changes to commit.",
        };
      }

      const message = await resolveCommitMessage(cwd, requestedMessage, options, signal);
      const commitResult = await runGitCommand(["commit", "-m", message], cwd, [0], signal);
      if (input.nextStep === "commit-and-push") {
        const pushResult = await pushGitBranch(cwd, false, signal);
        return {
          cwd,
          status: "success",
          branch: status.currentBranch,
          stdout: [commitResult.stdout, pushResult.stdout].filter(Boolean).join("\n"),
          stderr: [commitResult.stderr, pushResult.stderr].filter(Boolean).join("\n"),
          errorMessage: null,
        };
      }

      return {
        cwd,
        status: "success",
        branch: status.currentBranch,
        stdout: commitResult.stdout,
        stderr: commitResult.stderr,
        errorMessage: null,
      };
    } catch (error) {
      return mutationError(cwd, status.currentBranch, error, "Could not commit changes.");
    }
  });
}

export async function generateGitCommitMessage(
  input: GitCommitMessageGenerateInput,
  options: CommitGitChangesOptions = {},
): Promise<GitCommitMessageGenerateResult> {
  const cwd = await ensureDirectory(input.cwd);
  const draftMessage = input.draftMessage?.trim() ?? "";
  const status = await readGitActionStatus({ cwd });
  if (!status.isGitRepository) {
    return {
      cwd,
      status: "error",
      message: null,
      stderr: "",
      errorMessage: "Git repository is required before generating a commit message.",
    };
  }

  return runGitActionOperation(input.operationId, async (signal) => {
    try {
      if (input.includeUnstaged !== false) {
        await runGitCommand(["add", "-A"], cwd, [0], signal);
      }

      const hasStagedChanges = await hasDiff(cwd, ["--cached"], signal);
      if (!hasStagedChanges) {
        return {
          cwd,
          status: "error",
          message: null,
          stderr: "",
          errorMessage: "No staged changes to generate a commit message for.",
        };
      }

      const message = await generateCommitMessage(cwd, draftMessage, options, signal);
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
  });
}

export async function generateGitPullRequestMessage(
  input: GitPullRequestMessageGenerateInput,
  options: CommitGitChangesOptions = {},
): Promise<GitPullRequestMessageGenerateResult> {
  const cwd = await ensureDirectory(input.cwd);
  const status = await readGitActionStatus({ cwd });
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

  const title = input.title?.trim() ?? "";
  const body = input.body?.trim() ?? "";
  const headBranch = input.headBranch?.trim() || status.currentBranch;
  const baseBranch = input.baseBranch?.trim() || status.defaultBranch;

  return runGitActionOperation(input.operationId, async (signal) => {
    try {
      const generated = await generatePullRequestMessage(
        cwd,
        {
          title,
          body,
          headBranch,
          baseBranch,
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
      return pullRequestMessageGenerationError(cwd, error, "Could not generate pull request title and body.");
    }
  });
}

export async function pushGitChanges(input: GitPushInput): Promise<GitActionMutationResult> {
  const cwd = await ensureDirectory(input.cwd);
  const status = await readGitActionStatus({ cwd });
  if (!status.isGitRepository) {
    return {
      cwd,
      status: "error",
      branch: null,
      stdout: "",
      stderr: "",
      errorMessage: "Git repository is required before pushing.",
    };
  }

  return runGitActionOperation(input.operationId, async (signal) => {
    try {
      const result = await pushGitBranch(cwd, input.force, signal);
      return {
        cwd,
        status: "success",
        branch: status.currentBranch,
        stdout: result.stdout,
        stderr: result.stderr,
        errorMessage: null,
      };
    } catch (error) {
      return mutationError(cwd, status.currentBranch, error, "Could not push changes.");
    }
  });
}

export function cancelGitAction(input: GitActionCancelInput): GitActionCancelResult {
  const operationId = input.operationId.trim();
  if (!operationId) return { canceled: false };

  const controller = activeGitActionOperations.get(operationId);
  if (!controller) return { canceled: false };

  controller.abort();
  activeGitActionOperations.delete(operationId);
  return { canceled: true };
}
