import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { AsyncLocalStorage } from "node:async_hooks";
import { devNull } from "node:os";
import { killChildProcessTree } from "../process-tree";
import { RepositoryExecutionQueue } from "./repository-execution-queue";
import type {
  GitPerformanceOperationMetric,
  GitPerformanceOperationOutcome,
  GitPerformanceOperationTrigger,
} from "../../shared/git-worker-protocol";

export const GIT_READ_TIMEOUT_MS = 60_000;
export const GIT_CAT_FILE_TIMEOUT_MS = 30_000;
export const GIT_DEFAULT_OUTPUT_BYTES_CAP = 32 * 1024 * 1024;
const GIT_KILL_ESCALATION_MS = 250;
const sharedRepositoryExecutionQueue = new RepositoryExecutionQueue();

export interface GitRepositoryExecutionIdentity {
  hostId: "local";
  root: string;
  commonDir: string;
}

export type GitCommandFailureReason =
  | "canceled"
  | "timed_out"
  | "nonzero_exit"
  | "output_limit"
  | "spawn_failed"
  | "wait_failed";

export interface GitCommandResult {
  success: boolean;
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  stdoutBytes: number;
  stderrBytes: number;
  failureReason: GitCommandFailureReason | null;
  aborted: boolean;
  timedOut: boolean;
  outputLimitExceeded: boolean;
}

export interface GitCommandOptions {
  allowedNonZeroExitCodes?: readonly number[];
  configOverrides?: readonly string[];
  env?: NodeJS.ProcessEnv;
  literalPathspecs?: boolean;
  outputBytesCap?: number;
  serialize?: boolean;
  signal?: AbortSignal;
  stdin?: string | Uint8Array;
  timeoutMs?: number | null;
}

export interface GitCommandRunner {
  run(
    repository: GitRepositoryExecutionIdentity,
    args: readonly string[],
    options?: GitCommandOptions,
  ): Promise<GitCommandResult>;
}

interface GitPerformanceOperationRuntime {
  cacheHits: number;
  cacheMisses: number;
  canceled: boolean;
  coalescedQueries: number;
  commandCount: number;
  fullUntrackedScanCount: number;
  unscopedAllStatusCount: number;
  outputLimitExceeded: boolean;
  peakConcurrency: number;
  queueDurationMs: number;
  statusCommandCount: number;
  timedOut: boolean;
}

const gitPerformanceOperationContext =
  new AsyncLocalStorage<GitPerformanceOperationRuntime>();

export function recordGitQueryCacheOutcome(
  outcome: "hit" | "miss" | "coalesced",
): void {
  const runtime = gitPerformanceOperationContext.getStore();
  if (!runtime) return;
  if (outcome === "hit") runtime.cacheHits += 1;
  if (outcome === "miss") runtime.cacheMisses += 1;
  if (outcome === "coalesced") runtime.coalescedQueries += 1;
}

export async function runGitPerformanceOperation<Result>(input: {
  operation: string;
  trigger: GitPerformanceOperationTrigger;
  classifyOutcome(result: Result): GitPerformanceOperationOutcome;
  publish(metric: GitPerformanceOperationMetric): void;
  run(): Promise<Result>;
}): Promise<Result> {
  const startedAt = performance.now();
  const runtime: GitPerformanceOperationRuntime = {
    cacheHits: 0,
    cacheMisses: 0,
    canceled: false,
    coalescedQueries: 0,
    commandCount: 0,
    fullUntrackedScanCount: 0,
    unscopedAllStatusCount: 0,
    outputLimitExceeded: false,
    peakConcurrency: 0,
    queueDurationMs: 0,
    statusCommandCount: 0,
    timedOut: false,
  };
  let outcome: GitPerformanceOperationOutcome = "infrastructure-error";
  try {
    return await gitPerformanceOperationContext.run(runtime, async () => {
      const result = await input.run();
      outcome = input.classifyOutcome(result);
      return result;
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      outcome = "canceled";
      runtime.canceled = true;
    }
    throw error;
  } finally {
    const durationMs = Math.max(0, performance.now() - startedAt);
    input.publish({
      operation: input.operation,
      trigger: input.trigger,
      outcome,
      durationMs,
      firstResultMs: durationMs,
      queueDurationMs: runtime.queueDurationMs,
      commandCount: runtime.commandCount,
      peakConcurrency: runtime.peakConcurrency,
      statusCommandCount: runtime.statusCommandCount,
      fullUntrackedScanCount: runtime.fullUntrackedScanCount,
      unscopedAllStatusCount: runtime.unscopedAllStatusCount,
      cacheHits: runtime.cacheHits,
      cacheMisses: runtime.cacheMisses,
      coalescedQueries: runtime.coalescedQueries,
      timedOut: runtime.timedOut,
      canceled: runtime.canceled,
      outputLimitExceeded: runtime.outputLimitExceeded,
      repoIndexSizeBucket: "unknown",
    });
  }
}

const GIT_CONFIG_OVERRIDES = [
  "-c",
  "diff.mnemonicPrefix=false",
  "-c",
  "diff.noprefix=false",
  "-c",
  "core.quotePath=false",
  "-c",
  `core.hooksPath=${devNull}`,
] as const;

interface SafeFsmonitorCacheEntry {
  expiresAt: number;
  value: "" | "true";
}

function createEmptyFailure(
  failureReason: GitCommandFailureReason,
  options: {
    aborted?: boolean;
    timedOut?: boolean;
    outputLimitExceeded?: boolean;
  } = {},
): GitCommandResult {
  return {
    success: false,
    code: null,
    signal: null,
    stdout: "",
    stderr: "",
    stdoutBytes: 0,
    stderrBytes: 0,
    failureReason,
    aborted: options.aborted ?? false,
    timedOut: options.timedOut ?? false,
    outputLimitExceeded: options.outputLimitExceeded ?? false,
  };
}

export class LocalGitCommandRunner implements GitCommandRunner {
  readonly #queue: RepositoryExecutionQueue;
  readonly #safeFsmonitorCache = new Map<string, SafeFsmonitorCacheEntry>();
  readonly #activeByCommonDir = new Map<string, number>();

  constructor(queue = sharedRepositoryExecutionQueue) {
    this.#queue = queue;
  }

  async run(
    repository: GitRepositoryExecutionIdentity,
    args: readonly string[],
    options: GitCommandOptions = {},
  ): Promise<GitCommandResult> {
    if (repository.hostId !== "local") {
      throw new Error(`Unsupported Git host: ${repository.hostId}`);
    }
    if (args.length === 0 || args.some((arg) => typeof arg !== "string")) {
      throw new Error("Git command requires a non-empty argument list");
    }
    if (args[0]?.startsWith("-")) {
      throw new Error("Git command arguments must begin with a subcommand");
    }
    if (options.signal?.aborted) {
      return createEmptyFailure("canceled", { aborted: true });
    }
    const enqueuedAt = performance.now();
    const execute = async () => {
      const runtime = gitPerformanceOperationContext.getStore();
      const active = (this.#activeByCommonDir.get(repository.commonDir) ?? 0) + 1;
      this.#activeByCommonDir.set(repository.commonDir, active);
      if (runtime) {
        runtime.queueDurationMs += Math.max(0, performance.now() - enqueuedAt);
        runtime.peakConcurrency = Math.max(runtime.peakConcurrency, active);
      }
      try {
        const result = await this.#execute(repository, args, options);
        if (runtime) {
          runtime.commandCount += 1;
          runtime.statusCommandCount += args[0] === "status" ? 1 : 0;
          runtime.fullUntrackedScanCount += args[0] === "status"
            && args.includes("--untracked-files=normal")
            ? 1
            : 0;
          runtime.unscopedAllStatusCount += args[0] === "status"
            && args.includes("--untracked-files=all")
            && !args.includes("--")
            ? 1
            : 0;
          runtime.timedOut ||= result.timedOut;
          runtime.canceled ||= result.aborted;
          runtime.outputLimitExceeded ||= result.outputLimitExceeded;
        }
        return result;
      } finally {
        if (active === 1) this.#activeByCommonDir.delete(repository.commonDir);
        else this.#activeByCommonDir.set(repository.commonDir, active - 1);
      }
    };
    if (options.serialize === false) return execute();
    try {
      return await this.#queue.run(repository.commonDir, execute, options.signal);
    } catch (error) {
      if (options.signal?.aborted) {
        return createEmptyFailure("canceled", { aborted: true });
      }
      throw error;
    }
  }

  async #execute(
    repository: GitRepositoryExecutionIdentity,
    args: readonly string[],
    options: GitCommandOptions,
    skipFsmonitorResolution = false,
  ): Promise<GitCommandResult> {
    const allowedExitCodes = new Set([0, ...(options.allowedNonZeroExitCodes ?? [])]);
    const outputBytesCap = options.outputBytesCap ?? GIT_DEFAULT_OUTPUT_BYTES_CAP;
    const timeoutMs = options.timeoutMs === undefined
      ? isGitReadCommand(args)
        ? GIT_READ_TIMEOUT_MS
        : null
      : options.timeoutMs;
    if (!Number.isSafeInteger(outputBytesCap) || outputBytesCap <= 0) {
      throw new Error("Git command output cap must be a positive safe integer");
    }
    if (
      timeoutMs !== null
      && (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0)
    ) {
      throw new Error("Git command timeout must be a positive safe integer");
    }

    const fsmonitorOverride = skipFsmonitorResolution
      ? null
      : await this.#resolveSafeFsmonitorOverride(repository, options);
    const callerConfigOverrides = options.configOverrides ?? [];
    if (callerConfigOverrides.some((entry) => entry.includes("\0"))) {
      throw new Error("Git config overrides cannot contain NUL bytes");
    }
    const configArgs = callerConfigOverrides.flatMap((entry) => ["-c", entry]);

    return await new Promise<GitCommandResult>((resolve) => {
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn("git", [
          ...GIT_CONFIG_OVERRIDES,
          ...configArgs,
          ...(fsmonitorOverride === null
            ? []
            : ["-c", `core.fsmonitor=${fsmonitorOverride}`]),
          ...(options.literalPathspecs ? ["--literal-pathspecs"] : []),
          ...args,
        ], {
          cwd: repository.root,
          detached: process.platform !== "win32",
          env: {
            ...process.env,
            ...options.env,
            GIT_OPTIONAL_LOCKS: "0",
            GIT_TERMINAL_PROMPT: "0",
            LANGUAGE: "C",
            LC_MESSAGES: "C",
          },
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        });
      } catch {
        resolve(createEmptyFailure("spawn_failed"));
        return;
      }
      const childStdout = child.stdout;
      const childStderr = child.stderr;
      const childStdin = child.stdin;
      if (!childStdout || !childStderr || !childStdin) {
        child.kill();
        resolve(createEmptyFailure("wait_failed"));
        return;
      }

      const stdoutDecoder = new StringDecoder("utf8");
      const stderrDecoder = new StringDecoder("utf8");
      const stdout: string[] = [];
      const stderr: string[] = [];
      let stdoutBytes = 0;
      let stderrBytes = 0;
      let aborted = false;
      let timedOut = false;
      let outputLimitExceeded = false;
      let spawnFailed = false;
      let settled = false;
      let killTimer: ReturnType<typeof setTimeout> | null = null;

      const terminate = () => {
        if (child.exitCode !== null || child.signalCode !== null) return;
        killChildProcessTree(child, "SIGTERM");
        if (killTimer) return;
        killTimer = setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) {
            killChildProcessTree(child, "SIGKILL");
          }
        }, GIT_KILL_ESCALATION_MS);
        killTimer.unref?.();
      };
      const handleAbort = () => {
        aborted = true;
        terminate();
      };
      const timeout = timeoutMs === null
        ? null
        : setTimeout(() => {
          timedOut = true;
          terminate();
        }, timeoutMs);
      timeout?.unref?.();

      const cleanup = () => {
        if (timeout) clearTimeout(timeout);
        if (killTimer) clearTimeout(killTimer);
        options.signal?.removeEventListener("abort", handleAbort);
      };
      const finish = (code: number | null, signal: NodeJS.Signals | null) => {
        if (settled) return;
        settled = true;
        cleanup();
        stdout.push(stdoutDecoder.end());
        stderr.push(stderrDecoder.end());
        const failureReason: GitCommandFailureReason | null = aborted
          ? "canceled"
          : timedOut
            ? "timed_out"
            : outputLimitExceeded
              ? "output_limit"
              : spawnFailed
                ? "spawn_failed"
                : code !== null && allowedExitCodes.has(code)
                  ? null
                  : "nonzero_exit";
        resolve({
          success: failureReason === null,
          code,
          signal,
          stdout: stdout.join(""),
          stderr: stderr.join(""),
          stdoutBytes,
          stderrBytes,
          failureReason,
          aborted,
          timedOut,
          outputLimitExceeded,
        });
      };
      const append = (
        chunk: Buffer,
        decoder: StringDecoder,
        output: string[],
        stream: "stdout" | "stderr",
      ) => {
        if (stream === "stdout") stdoutBytes += chunk.byteLength;
        else stderrBytes += chunk.byteLength;
        if (stdoutBytes + stderrBytes > outputBytesCap) {
          outputLimitExceeded = true;
          terminate();
          return;
        }
        output.push(decoder.write(chunk));
      };

      options.signal?.addEventListener("abort", handleAbort, { once: true });
      if (options.signal?.aborted) handleAbort();
      childStdout.on("data", (chunk: Buffer) => {
        append(chunk, stdoutDecoder, stdout, "stdout");
      });
      childStderr.on("data", (chunk: Buffer) => {
        append(chunk, stderrDecoder, stderr, "stderr");
      });
      child.on("error", () => {
        spawnFailed = true;
      });
      child.on("close", (code, signal) => finish(code, signal));
      childStdin.on("error", () => undefined);
      if (options.stdin === undefined) {
        childStdin.end();
      } else {
        childStdin.end(options.stdin);
      }
    });
  }

  async #resolveSafeFsmonitorOverride(
    repository: GitRepositoryExecutionIdentity,
    options: GitCommandOptions,
  ): Promise<"" | "true"> {
    if (process.platform !== "darwin" && process.platform !== "win32") {
      return "";
    }
    const cacheKey = JSON.stringify([
      repository.commonDir,
      Object.entries(options.env ?? {}).sort(([left], [right]) =>
        left.localeCompare(right)),
    ]);
    const now = performance.now();
    const cached = this.#safeFsmonitorCache.get(cacheKey);
    if (cached && cached.expiresAt > now) return cached.value;
    if (cached) this.#safeFsmonitorCache.delete(cacheKey);
    const deadline = now + 1_000;
    const value = await this.#readSafeFsmonitorOverride(repository, options);
    if (!options.signal?.aborted && performance.now() < deadline) {
      this.#safeFsmonitorCache.set(cacheKey, {
        expiresAt: deadline,
        value,
      });
    }
    return value;
  }

  async #readSafeFsmonitorOverride(
    repository: GitRepositoryExecutionIdentity,
    options: GitCommandOptions,
  ): Promise<"" | "true"> {
    try {
      const config = await this.#execute(
        repository,
        ["config", "--null", "--get", "core.fsmonitor"],
        {
          allowedNonZeroExitCodes: [1],
          env: options.env,
          signal: options.signal,
          timeoutMs: options.timeoutMs ?? GIT_READ_TIMEOUT_MS,
        },
        true,
      );
      if (config.code !== 0 || !config.stdout.endsWith("\0")) return "";
      const configuredValue = config.stdout.slice(0, -1);
      if (!configuredValue || configuredValue.includes("\0")) return "";
      const normalized = configuredValue.toLowerCase();
      let enabled = ["true", "yes", "on"].includes(normalized);
      if (!["true", "yes", "on", "false", "no", "off"].includes(normalized)) {
        const parsed = await this.#execute(
          repository,
          [
            "config",
            "--null",
            "--type=bool",
            "--fixed-value",
            "--get",
            "core.fsmonitor",
            configuredValue,
          ],
          {
            allowedNonZeroExitCodes: [1],
            env: options.env,
            signal: options.signal,
            timeoutMs: options.timeoutMs ?? GIT_READ_TIMEOUT_MS,
          },
          true,
        );
        enabled = parsed.code === 0 && parsed.stdout === "true\0";
      }
      if (!enabled) return "";
      const buildOptions = await this.#execute(
        repository,
        ["version", "--build-options"],
        {
          env: options.env,
          signal: options.signal,
          timeoutMs: options.timeoutMs ?? GIT_READ_TIMEOUT_MS,
        },
        true,
      );
      if (buildOptions.code !== 0) return "";
      return buildOptions.stdout
        .split(/\r?\n/)
        .some((line) => line.trim() === "feature: fsmonitor--daemon")
        ? "true"
        : "";
    } catch {
      return "";
    }
  }
}

export function isGitReadCommand(args: readonly string[]): boolean {
  switch (args[0]) {
    case "check-ignore":
    case "for-each-ref":
    case "merge-base":
    case "rev-list":
    case "rev-parse":
    case "show-ref":
    case "status":
      return true;
    case "cat-file":
      return args.includes("-e");
    case "ls-files":
      return args.includes("--others")
        && !args.includes("--cached")
        && !args.includes("--ignored");
    case "config":
      return args.some((arg) =>
        arg === "--get"
        || arg === "--get-all"
        || arg === "--get-regexp"
        || arg === "--list");
    case "worktree":
      return args[1] === "list";
    default:
      return false;
  }
}
