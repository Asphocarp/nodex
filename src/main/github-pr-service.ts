import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import type {
  GhCliStatusResult,
  GhPrCheckRun,
  GhPrChecksRequest,
  GhPrChecksResult,
  GhPrComment,
  GhPrCommentInput,
  GhPrCommentResult,
  GhPrCommentsRequest,
  GhPrCommentsResult,
  GhPrCreateInput,
  GhPrDiffRequest,
  GhPrDiffResult,
  GhPrMergeInput,
  GhPrMutationResult,
  GhPrStatusRequest,
  GhPrStatusResult,
  GhPrUpdateInput,
} from "../shared/types";

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface CommandError extends Error {
  stderr?: string;
  exitCode?: number | null;
  code?: unknown;
}

const GH_COMMAND_TIMEOUT_MS = 10_000;

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

function runCommand(
  command: string,
  args: string[],
  cwd: string,
  allowedExitCodes: number[] = [0],
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      {
        cwd,
        encoding: "utf8",
        timeout: GH_COMMAND_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        const exitCode = typeof (error as { code?: unknown } | null)?.code === "number"
          ? ((error as { code: number }).code)
          : 0;
        if (error && !allowedExitCodes.includes(exitCode)) {
          const failure = error as CommandError;
          failure.stderr = typeof stderr === "string" ? stderr : "";
          failure.exitCode = exitCode;
          reject(failure);
          return;
        }

        resolve({
          stdout: typeof stdout === "string" ? stdout : "",
          stderr: typeof stderr === "string" ? stderr : "",
          exitCode,
        });
      },
    );
  });
}

function getCommandMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;

  const stderr = "stderr" in error && typeof error.stderr === "string"
    ? error.stderr.trim()
    : "";
  return stderr || error.message || fallback;
}

function getMissingGhStatus(cwd: string, error: unknown): GhCliStatusResult {
  return {
    cwd,
    available: false,
    status: "missing-gh",
    message: getCommandMessage(error, "GitHub CLI is not installed or is not on PATH."),
  };
}

async function readGhCliStatusForDirectory(cwd: string): Promise<GhCliStatusResult> {
  try {
    await runCommand("gh", ["--version"], cwd);
  } catch (error) {
    return getMissingGhStatus(cwd, error);
  }

  const remoteResult = await runCommand("git", ["remote", "-v"], cwd, [0, 128]).catch(() => null);
  if (!remoteResult?.stdout.trim()) {
    return {
      cwd,
      available: false,
      status: "missing-remote",
      message: "GitHub pull request review requires a Git remote.",
    };
  }

  const authResult = await runCommand("gh", ["auth", "status"], cwd, [0, 1, 4]).catch((error) => error);
  if (authResult instanceof Error || authResult.exitCode !== 0) {
    return {
      cwd,
      available: false,
      status: "not-authenticated",
      message: authResult instanceof Error
        ? getCommandMessage(authResult, "GitHub CLI is not authenticated.")
        : (authResult.stderr.trim() || "GitHub CLI is not authenticated."),
    };
  }

  return {
    cwd,
    available: true,
    status: "available",
    message: null,
  };
}

async function requireGhCli(cwd: string): Promise<GhCliStatusResult> {
  const status = await readGhCliStatusForDirectory(cwd);
  return status;
}

function disabledPrStatus(cwd: string, status: GhCliStatusResult): GhPrStatusResult {
  return {
    cwd,
    available: false,
    status: "disabled",
    disabledReason: status.status,
    prNumber: null,
    title: null,
    url: null,
    state: null,
    mergeStateStatus: null,
    message: status.message,
  };
}

function disabledChecks(cwd: string, status: GhCliStatusResult): GhPrChecksResult {
  return {
    cwd,
    available: false,
    disabledReason: status.status,
    checks: [],
    message: status.message,
  };
}

function disabledComments(cwd: string, status: GhCliStatusResult): GhPrCommentsResult {
  return {
    cwd,
    available: false,
    disabledReason: status.status,
    comments: [],
    message: status.message,
  };
}

function disabledDiff(cwd: string, status: GhCliStatusResult): GhPrDiffResult {
  return {
    cwd,
    available: false,
    disabledReason: status.status,
    patch: "",
    message: status.message,
  };
}

function disabledMutation(cwd: string, status: GhCliStatusResult): GhPrMutationResult {
  return {
    cwd,
    available: false,
    disabledReason: status.status,
    url: null,
    message: status.message,
  };
}

function parseJson(value: string): unknown {
  if (!value.trim()) return null;
  return JSON.parse(value) as unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function makePrArg(prNumber?: number | null): string[] {
  return typeof prNumber === "number" && Number.isFinite(prNumber) && prNumber > 0
    ? [String(prNumber)]
    : [];
}

export async function readGhCliStatus(input: { cwd: string }): Promise<GhCliStatusResult> {
  const cwd = await ensureDirectory(input.cwd);
  return readGhCliStatusForDirectory(cwd);
}

export async function readGhPrStatus(input: GhPrStatusRequest): Promise<GhPrStatusResult> {
  const cwd = await ensureDirectory(input.cwd);
  const ghStatus = await requireGhCli(cwd);
  if (!ghStatus.available) return disabledPrStatus(cwd, ghStatus);

  try {
    const result = await runCommand("gh", [
      "pr",
      "view",
      ...makePrArg(input.prNumber),
      "--json",
      "number,title,url,state,mergeStateStatus",
    ], cwd);
    const data = asRecord(parseJson(result.stdout));
    return {
      cwd,
      available: true,
      status: "ready",
      disabledReason: null,
      prNumber: asNumber(data?.number),
      title: asString(data?.title),
      url: asString(data?.url),
      state: asString(data?.state),
      mergeStateStatus: asString(data?.mergeStateStatus),
      message: null,
    };
  } catch (error) {
    return {
      ...disabledPrStatus(cwd, { ...ghStatus, status: "error", message: getCommandMessage(error, "Could not read pull request status.") }),
      status: "error",
    };
  }
}

export async function readGhPrChecks(input: GhPrChecksRequest): Promise<GhPrChecksResult> {
  const cwd = await ensureDirectory(input.cwd);
  const ghStatus = await requireGhCli(cwd);
  if (!ghStatus.available) return disabledChecks(cwd, ghStatus);

  try {
    const result = await runCommand("gh", [
      "pr",
      "checks",
      ...makePrArg(input.prNumber),
      "--json",
      "name,status,conclusion,detailsUrl",
    ], cwd, [0, 1]);
    const data = parseJson(result.stdout);
    const checks = Array.isArray(data)
      ? data.flatMap((item): GhPrCheckRun[] => {
          const record = asRecord(item);
          if (!record) return [];
          return [{
            name: asString(record.name) ?? "Check",
            status: asString(record.status),
            conclusion: asString(record.conclusion),
            detailsUrl: asString(record.detailsUrl),
          }];
        })
      : [];
    return {
      cwd,
      available: true,
      disabledReason: null,
      checks,
      message: result.exitCode === 0 ? null : (result.stderr.trim() || null),
    };
  } catch (error) {
    return {
      ...disabledChecks(cwd, { ...ghStatus, status: "error", message: getCommandMessage(error, "Could not read pull request checks.") }),
      available: false,
    };
  }
}

export async function readGhPrComments(input: GhPrCommentsRequest): Promise<GhPrCommentsResult> {
  const cwd = await ensureDirectory(input.cwd);
  const ghStatus = await requireGhCli(cwd);
  if (!ghStatus.available) return disabledComments(cwd, ghStatus);

  try {
    const result = await runCommand("gh", [
      "pr",
      "view",
      ...makePrArg(input.prNumber),
      "--json",
      "comments",
    ], cwd);
    const commentsValue = asRecord(parseJson(result.stdout))?.comments;
    const comments = Array.isArray(commentsValue)
      ? commentsValue.flatMap((item): GhPrComment[] => {
          const record = asRecord(item);
          if (!record) return [];
          const author = asRecord(record.author);
          return [{
            id: asString(record.id) ?? asString(record.url) ?? "",
            path: asString(record.path),
            line: asNumber(record.line),
            body: asString(record.body) ?? "",
            author: asString(author?.login) ?? asString(record.author),
            url: asString(record.url),
          }];
        })
      : [];
    return {
      cwd,
      available: true,
      disabledReason: null,
      comments,
      message: null,
    };
  } catch (error) {
    return disabledComments(cwd, { ...ghStatus, status: "error", message: getCommandMessage(error, "Could not read pull request comments.") });
  }
}

export async function readGhPrDiff(input: GhPrDiffRequest): Promise<GhPrDiffResult> {
  const cwd = await ensureDirectory(input.cwd);
  const ghStatus = await requireGhCli(cwd);
  if (!ghStatus.available) return disabledDiff(cwd, ghStatus);

  try {
    const result = await runCommand("gh", [
      "pr",
      "diff",
      ...makePrArg(input.prNumber),
      "--patch",
    ], cwd);
    return {
      cwd,
      available: true,
      disabledReason: null,
      patch: result.stdout,
      message: null,
    };
  } catch (error) {
    return disabledDiff(cwd, { ...ghStatus, status: "error", message: getCommandMessage(error, "Could not read pull request diff.") });
  }
}

export async function createGhPrComment(input: GhPrCommentInput): Promise<GhPrCommentResult> {
  const cwd = await ensureDirectory(input.cwd);
  const ghStatus = await requireGhCli(cwd);
  if (!ghStatus.available) return disabledMutation(cwd, ghStatus);

  try {
    const result = await runCommand("gh", [
      "pr",
      "comment",
      String(input.prNumber),
      "--body",
      input.body,
    ], cwd);
    return {
      cwd,
      available: true,
      disabledReason: null,
      url: result.stdout.trim() || null,
      message: null,
    };
  } catch (error) {
    return disabledMutation(cwd, { ...ghStatus, status: "error", message: getCommandMessage(error, "Could not create pull request comment.") });
  }
}

export async function mergeGhPr(input: GhPrMergeInput): Promise<GhPrMutationResult> {
  const cwd = await ensureDirectory(input.cwd);
  const ghStatus = await requireGhCli(cwd);
  if (!ghStatus.available) return disabledMutation(cwd, ghStatus);

  const method = input.method ?? "merge";
  try {
    const result = await runCommand("gh", [
      "pr",
      "merge",
      String(input.prNumber),
      method === "squash" ? "--squash" : method === "rebase" ? "--rebase" : "--merge",
    ], cwd);
    return {
      cwd,
      available: true,
      disabledReason: null,
      url: null,
      message: result.stdout.trim() || null,
    };
  } catch (error) {
    return disabledMutation(cwd, { ...ghStatus, status: "error", message: getCommandMessage(error, "Could not merge pull request.") });
  }
}

export async function updateGhPr(input: GhPrUpdateInput): Promise<GhPrMutationResult> {
  const cwd = await ensureDirectory(input.cwd);
  const ghStatus = await requireGhCli(cwd);
  if (!ghStatus.available) return disabledMutation(cwd, ghStatus);

  const args = ["pr", "edit", String(input.prNumber)];
  if (input.title?.trim()) args.push("--title", input.title.trim());
  if (input.body !== undefined && input.body !== null) args.push("--body", input.body);
  if (args.length === 3) {
    return {
      cwd,
      available: true,
      disabledReason: null,
      url: null,
      message: "No pull request fields changed.",
    };
  }

  try {
    const result = await runCommand("gh", args, cwd);
    return {
      cwd,
      available: true,
      disabledReason: null,
      url: result.stdout.trim() || null,
      message: null,
    };
  } catch (error) {
    return disabledMutation(cwd, { ...ghStatus, status: "error", message: getCommandMessage(error, "Could not update pull request.") });
  }
}

export async function createGhPr(input: GhPrCreateInput): Promise<GhPrMutationResult> {
  const cwd = await ensureDirectory(input.cwd);
  const ghStatus = await requireGhCli(cwd);
  if (!ghStatus.available) return disabledMutation(cwd, ghStatus);

  const args = [
    "pr",
    "create",
    "--title",
    input.title,
    "--body",
    input.body ?? "",
  ];
  if (input.base?.trim()) args.push("--base", input.base.trim());
  if (input.head?.trim()) args.push("--head", input.head.trim());
  if (input.draft === true) args.push("--draft");

  try {
    const result = await runCommand("gh", args, cwd);
    return {
      cwd,
      available: true,
      disabledReason: null,
      url: result.stdout.trim() || null,
      message: null,
    };
  } catch (error) {
    return disabledMutation(cwd, { ...ghStatus, status: "error", message: getCommandMessage(error, "Could not create pull request.") });
  }
}
