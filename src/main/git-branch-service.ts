import { execFile } from "node:child_process";
import { watchFile, unwatchFile } from "node:fs";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";

export interface GitBranchState {
  currentBranch: string | null;
  defaultBranch: string | null;
  branches: string[];
}

interface GitCommandResult {
  stdout: string;
  stderr: string;
}

interface GitCommandError extends Error {
  stderr?: string;
  code?: number | string | null;
}

const GIT_COMMAND_TIMEOUT_MS = 5_000;
const GIT_WATCH_DEBOUNCE_MS = 75;
const GIT_WATCH_POLL_INTERVAL_MS = 100;
const EMPTY_GIT_BRANCH_STATE: GitBranchState = {
  currentBranch: null,
  defaultBranch: null,
  branches: [],
};

function normalizeBranchName(value: string): string {
  return value.trim();
}

async function ensureDirectory(cwd: string, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted();
  const normalizedCwd = cwd.trim();
  if (!normalizedCwd) {
    throw new Error("Working directory is required");
  }

  const entry = await stat(normalizedCwd).catch(() => null);
  signal?.throwIfAborted();
  if (!entry?.isDirectory()) {
    throw new Error(`Working directory not found: ${normalizedCwd}`);
  }

  return normalizedCwd;
}

function runGitCommand(args: string[], cwd: string, signal?: AbortSignal): Promise<GitCommandResult> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      {
        cwd,
        encoding: "utf8",
        timeout: GIT_COMMAND_TIMEOUT_MS,
        windowsHide: true,
        signal,
      },
      (error, stdout, stderr) => {
        if (error) {
          const failure = error as GitCommandError;
          failure.stderr = typeof stderr === "string" ? stderr : "";
          reject(failure);
          return;
        }

        resolve({
          stdout: typeof stdout === "string" ? stdout : "",
          stderr: typeof stderr === "string" ? stderr : "",
        });
      },
    );
  });
}

function isNotGitRepositoryError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const stderr = "stderr" in error && typeof error.stderr === "string" ? error.stderr : "";
  const message = `${error.message}\n${stderr}`.toLowerCase();
  return message.includes("not a git repository");
}

async function loadGitBranchState(cwd: string, signal?: AbortSignal): Promise<GitBranchState> {
  const [currentBranchResult, branchListResult, defaultBranchResult] = await Promise.all([
    runGitCommand(["branch", "--show-current"], cwd, signal),
    runGitCommand(["branch", "--format=%(refname:short)"], cwd, signal),
    runGitCommand(["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], cwd, signal).catch((error) => {
      signal?.throwIfAborted();
      if (error instanceof Error && error.name === "AbortError") throw error;
      return null;
    }),
  ]);

  const currentBranch = normalizeBranchName(currentBranchResult.stdout) || null;
  const branches = branchListResult.stdout
    .split(/\r?\n/)
    .map((branch) => normalizeBranchName(branch))
    .filter((branch, index, items) => branch.length > 0 && items.indexOf(branch) === index);
  const remoteDefaultRaw = defaultBranchResult?.stdout
    ? normalizeBranchName(defaultBranchResult.stdout)
    : "";
  const defaultBranch = remoteDefaultRaw.startsWith("origin/")
    ? remoteDefaultRaw.slice("origin/".length)
    : (remoteDefaultRaw || null);

  return {
    currentBranch,
    defaultBranch,
    branches,
  };
}

async function assertValidBranchName(branch: string, cwd: string): Promise<void> {
  await runGitCommand(["check-ref-format", "--branch", branch], cwd);
}

async function resolveGitHeadPath(cwd: string): Promise<string> {
  const result = await runGitCommand(["rev-parse", "--git-path", "HEAD"], cwd);
  const rawPath = result.stdout.trim();
  if (!rawPath) {
    throw new Error("Could not resolve Git HEAD path");
  }

  return resolve(cwd, rawPath);
}

export async function readGitBranchState(cwd: string, signal?: AbortSignal): Promise<GitBranchState> {
  const normalizedCwd = await ensureDirectory(cwd, signal);

  try {
    return await loadGitBranchState(normalizedCwd, signal);
  } catch (error) {
    if (isNotGitRepositoryError(error)) {
      return EMPTY_GIT_BRANCH_STATE;
    }
    throw error;
  }
}

export async function checkoutGitBranch(input: {
  cwd: string;
  branch: string;
}): Promise<GitBranchState> {
  const normalizedCwd = await ensureDirectory(input.cwd);
  const branch = normalizeBranchName(input.branch);

  if (!branch) {
    throw new Error("Branch name is required");
  }

  await assertValidBranchName(branch, normalizedCwd);
  await runGitCommand(["checkout", branch], normalizedCwd);
  return loadGitBranchState(normalizedCwd);
}

export async function createAndCheckoutGitBranch(input: {
  cwd: string;
  branch: string;
}): Promise<GitBranchState> {
  const normalizedCwd = await ensureDirectory(input.cwd);
  const branch = normalizeBranchName(input.branch);

  if (!branch) {
    throw new Error("Branch name is required");
  }

  await assertValidBranchName(branch, normalizedCwd);
  await runGitCommand(["checkout", "-b", branch], normalizedCwd);
  return loadGitBranchState(normalizedCwd);
}

export async function watchGitBranch(
  cwd: string,
  onChange: () => void,
): Promise<() => void> {
  const normalizedCwd = await ensureDirectory(cwd);
  let headPath = "";

  try {
    headPath = await resolveGitHeadPath(normalizedCwd);
  } catch (error) {
    if (isNotGitRepositoryError(error)) {
      return () => { };
    }
    throw error;
  }

  let closed = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const emitChange = () => {
    if (closed) return;
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      if (closed) return;
      onChange();
    }, GIT_WATCH_DEBOUNCE_MS);
  };

  const handleHeadChange = () => {
    if (closed) return;
    emitChange();
  };

  watchFile(
    headPath,
    {
      persistent: false,
      interval: GIT_WATCH_POLL_INTERVAL_MS,
    },
    handleHeadChange,
  );

  return () => {
    closed = true;

    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

    unwatchFile(headPath, handleHeadChange);
  };
}
