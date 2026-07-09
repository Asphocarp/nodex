import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import type { CodexStoredShellEnvironment } from "./codex-thread-launch-context";

const CODEX_SHELL_ENVIRONMENT_DELIMITER = "_SHELL_ENV_DELIMITER_";
const CODEX_SHELL_ENVIRONMENT_COMMAND = [
  `echo -n "${CODEX_SHELL_ENVIRONMENT_DELIMITER}"`,
  "command env",
  `echo -n "${CODEX_SHELL_ENVIRONMENT_DELIMITER}"`,
  "exit",
].join("; ");

const CODEX_INTERACTIVE_SHELL_ENVIRONMENT = {
  CODEX_SHELL: "1",
  DISABLE_AUTO_UPDATE: "true",
  ZSH_TMUX_AUTOSTART: "false",
  ZSH_TMUX_AUTOSTARTED: "true",
} as const;

let cachedCodexLocalShellEnvironment: Promise<NodeJS.ProcessEnv> | null = null;

const CODEX_VOLATILE_SETUP_ENVIRONMENT_KEYS = new Set([
  "CODEX_SOURCE_TREE_PATH",
  "CODEX_WORKTREE_PATH",
  "CODEX_SETUP_EXIT_CODE",
  "OLDPWD",
  "PWD",
  "SHELLOPTS",
  "SHLVL",
  "_",
  "CODEX_SHELL",
]);

interface CodexEnvironmentEntry {
  readonly key: string;
  readonly value: string;
}

function normalizeCodexEnvironmentKey(key: string, platform: NodeJS.Platform): string {
  return platform === "win32" ? key.toUpperCase() : key;
}

function indexCodexEnvironment(
  environment: Readonly<Record<string, string>>,
  platform: NodeJS.Platform,
): Map<string, CodexEnvironmentEntry> {
  const entries = new Map<string, CodexEnvironmentEntry>();
  for (const [key, value] of Object.entries(environment)) {
    entries.set(normalizeCodexEnvironmentKey(key, platform), { key, value });
  }
  return entries;
}

function isExcludedCodexEnvironmentKey(key: string, platform: NodeJS.Platform): boolean {
  const normalizedKey = normalizeCodexEnvironmentKey(key, platform);
  return CODEX_VOLATILE_SETUP_ENVIRONMENT_KEYS.has(normalizedKey)
    || normalizedKey.startsWith("BASH_FUNC_");
}

function hasLineBreak(value: string | undefined): boolean {
  return value?.includes("\n") === true || value?.includes("\r") === true;
}

function compactProcessEnvironment(
  environment: NodeJS.ProcessEnv,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environment).filter((entry): entry is [string, string] =>
      typeof entry[1] === "string"),
  );
}

function withoutCodexShellEnvironment(
  environment: NodeJS.ProcessEnv,
): Record<string, string> {
  const compact = compactProcessEnvironment(environment);
  delete compact.CODEX_SHELL;
  return compact;
}

function resolveCodexLoginShell(
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv,
): string {
  try {
    const shell = userInfo().shell;
    if (shell) return shell;
  } catch {
    // Match the reference fallback when userInfo is unavailable.
  }
  if (platform === "darwin") return environment.SHELL || "/bin/zsh";
  return environment.SHELL || "/bin/sh";
}

/** Exact shell-env delimiter parser used by `O0/eI`. */
export function parseCodexInteractiveShellEnvironment(
  output: string,
): Record<string, string> {
  const environmentBlock = output.split(CODEX_SHELL_ENVIRONMENT_DELIMITER)[1];
  if (environmentBlock === undefined) {
    throw new Error("Shell output did not contain env delimiters");
  }

  const environment: Record<string, string> = {};
  for (const line of environmentBlock.replace(/\r\n/g, "\n").split("\n")) {
    const normalizedLine = line.trimEnd();
    if (!normalizedLine) continue;
    const separatorIndex = normalizedLine.indexOf("=");
    if (separatorIndex <= 0) continue;
    environment[normalizedLine.slice(0, separatorIndex)] = normalizedLine.slice(separatorIndex + 1);
  }
  return environment;
}

function readCodexLoginShellEnvironment(input: {
  readonly shell: string;
  readonly baseEnvironment: NodeJS.ProcessEnv;
}): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.shell, ["-ilc", CODEX_SHELL_ENVIRONMENT_COMMAND], {
      env: {
        ...input.baseEnvironment,
        ...CODEX_INTERACTIVE_SHELL_ENVIRONMENT,
      },
      windowsHide: true,
    });
    const stdoutDecoder = new StringDecoder("utf8");
    const stderrDecoder = new StringDecoder("utf8");
    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += stdoutDecoder.write(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += stderrDecoder.write(chunk);
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      stdout += stdoutDecoder.end();
      stderr += stderrDecoder.end();
      if (code === 0 && signal === null) {
        try {
          resolve(parseCodexInteractiveShellEnvironment(stdout));
        } catch (error) {
          reject(error);
        }
        return;
      }
      reject(new Error(
        `Interactive login shell environment failed (${signal ?? `exit ${code ?? "unknown"}`}).${stderr.trim() ? `\n${stderr.trim()}` : ""}`,
      ));
    });
  });
}

async function readCodexInteractiveShellEnvironment(
  baseEnvironment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): Promise<Record<string, string>> {
  const preferredShell = resolveCodexLoginShell(platform, baseEnvironment);
  const shells = [preferredShell, "/bin/zsh", "/bin/bash"].filter(
    (shell, index, candidates) => candidates.indexOf(shell) === index,
  );
  let lastError: unknown = null;

  for (const shell of shells) {
    try {
      return await readCodexLoginShellEnvironment({ shell, baseEnvironment });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("No interactive login shell is available");
}

export async function loadCodexLocalShellEnvironment(input: {
  readonly baseEnvironment?: NodeJS.ProcessEnv;
  readonly loadInteractiveEnvironment?: () => Promise<NodeJS.ProcessEnv>;
  readonly onError?: (error: unknown) => void;
  readonly platform?: NodeJS.Platform;
} = {}): Promise<NodeJS.ProcessEnv> {
  const baseEnvironment = input.baseEnvironment ?? process.env;
  const platform = input.platform ?? process.platform;
  if (platform === "win32") return compactProcessEnvironment(baseEnvironment);

  const load = async (): Promise<NodeJS.ProcessEnv> => {
    try {
      const interactiveEnvironment = await (
        input.loadInteractiveEnvironment?.()
        ?? readCodexInteractiveShellEnvironment(baseEnvironment, platform)
      );
      return withoutCodexShellEnvironment({
        ...baseEnvironment,
        ...interactiveEnvironment,
      });
    } catch (error) {
      input.onError?.(error);
      return withoutCodexShellEnvironment(baseEnvironment);
    }
  };

  if (input.baseEnvironment || input.loadInteractiveEnvironment || input.platform) {
    return await load();
  }
  cachedCodexLocalShellEnvironment ??= load();
  return await cachedCodexLocalShellEnvironment;
}

/** Exact `L0`: parse newline-delimited `env` output, retaining the final duplicate. */
export function parseCodexCapturedEnvironment(value: string): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const line of value.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    if (!line) continue;
    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) continue;
    environment[line.slice(0, separatorIndex)] = line.slice(separatorIndex + 1);
  }
  return environment;
}

/** Exact `R0`: persist only stable setup-created changes and removals. */
export function captureCodexShellEnvironmentDelta(
  before: Readonly<Record<string, string>>,
  after: Readonly<Record<string, string>>,
  platform: NodeJS.Platform = process.platform,
): CodexStoredShellEnvironment | null {
  const beforeByKey = indexCodexEnvironment(before, platform);
  const afterByKey = indexCodexEnvironment(after, platform);
  const normalizedKeys = new Set([...beforeByKey.keys(), ...afterByKey.keys()]);
  const set: Record<string, string> = {};
  const exclude: string[] = [];

  for (const normalizedKey of normalizedKeys) {
    const beforeEntry = beforeByKey.get(normalizedKey);
    const afterEntry = afterByKey.get(normalizedKey);
    const key = afterEntry?.key ?? beforeEntry?.key;
    if (
      !key
      || isExcludedCodexEnvironmentKey(key, platform)
      || hasLineBreak(beforeEntry?.value)
      || hasLineBreak(afterEntry?.value)
    ) continue;

    if (!afterEntry) {
      exclude.push(key);
      continue;
    }
    if (beforeEntry?.value !== afterEntry.value) set[key] = afterEntry.value;
  }

  if (exclude.length === 0 && Object.keys(set).length === 0) return null;
  exclude.sort();
  return {
    version: 1,
    set: Object.fromEntries(
      Object.entries(set).sort(([left], [right]) => left.localeCompare(right)),
    ),
    exclude,
  };
}

function quotePosixShellValue(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** Exact `B0`: source setup in-process and capture the post-success shell environment. */
export function buildCodexPosixSetupCaptureWrapper(input: {
  readonly scriptPath: string;
  readonly capturePath: string;
  readonly beforeCapturePath: string;
}): string {
  return [
    "set -xeo pipefail",
    `capture_path=${quotePosixShellValue(input.capturePath)}`,
    `before_capture_path=${quotePosixShellValue(input.beforeCapturePath)}`,
    'env > "$before_capture_path"',
    `trap 'code=$?; if [ "$code" -eq 0 ]; then env > "$capture_path"; fi' EXIT`,
    `. ${quotePosixShellValue(input.scriptPath)}`,
  ].join("\n");
}

function appendOutputTail(currentTail: string, chunk: string, maxChars = 64_000): string {
  const merged = `${currentTail}${chunk}`;
  return merged.length <= maxChars ? merged : merged.slice(merged.length - maxChars);
}

export interface RunCodexWorktreeSetupScriptInput {
  readonly script: string;
  readonly cwd: string;
  readonly environment?: NodeJS.ProcessEnv;
  readonly signal?: AbortSignal;
  readonly onOutput?: (output: { stream: "stdout" | "stderr"; data: string }) => void;
  readonly onCaptureError?: (error: unknown) => void;
  readonly loadBaseEnvironment?: () => Promise<NodeJS.ProcessEnv>;
  readonly onShellEnvironmentError?: (error: unknown) => void;
  readonly readEnvironmentCapture?: (filePath: string) => Promise<string>;
}

/** Exact `I0/B0/K0`: source setup, preserve output, and capture env only after success. */
export async function runCodexWorktreeSetupScript(
  input: RunCodexWorktreeSetupScriptInput,
): Promise<CodexStoredShellEnvironment | null> {
  if (input.signal?.aborted) {
    throw new Error("Worktree environment setup canceled.");
  }
  const captureRoot = await mkdtemp(path.join(tmpdir(), "nodex-worktree-shell-environment-"));
  const scriptPath = path.join(captureRoot, `${randomUUID()}-setup-script.sh`);
  const wrapperPath = path.join(captureRoot, `${randomUUID()}-setup-wrapper.sh`);
  const beforeCapturePath = path.join(captureRoot, `${randomUUID()}-before-env.txt`);
  const capturePath = path.join(captureRoot, `${randomUUID()}-captured-env.txt`);
  await writeFile(scriptPath, input.script, "utf8");
  await writeFile(wrapperPath, buildCodexPosixSetupCaptureWrapper({
    scriptPath,
    capturePath,
    beforeCapturePath,
  }), "utf8");

  try {
    const baseEnvironment = input.loadBaseEnvironment
      ? await input.loadBaseEnvironment()
      : await loadCodexLocalShellEnvironment({
          onError: input.onShellEnvironmentError,
        });
    if (input.signal?.aborted) {
      throw new Error("Worktree environment setup canceled.");
    }
    return await new Promise<CodexStoredShellEnvironment | null>((resolve, reject) => {
      const child = spawn("bash", [wrapperPath], {
        cwd: input.cwd,
        env: {
          ...baseEnvironment,
          COLORTERM: "truecolor",
          FORCE_COLOR: "1",
          TERM: "xterm-256color",
          ...input.environment,
        },
        windowsHide: true,
      });
      const stdoutDecoder = new StringDecoder("utf8");
      const stderrDecoder = new StringDecoder("utf8");
      let stdoutTail = "";
      let stderrTail = "";
      let settled = false;
      let canceled = false;
      const onAbort = (): void => {
        canceled = true;
        child.kill();
      };
      input.signal?.addEventListener("abort", onAbort, { once: true });
      if (input.signal?.aborted) onAbort();

      child.stdout?.on("data", (chunk: Buffer) => {
        const text = stdoutDecoder.write(chunk);
        if (!text) return;
        stdoutTail = appendOutputTail(stdoutTail, text);
        input.onOutput?.({ stream: "stdout", data: text });
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        const text = stderrDecoder.write(chunk);
        if (!text) return;
        stderrTail = appendOutputTail(stderrTail, text);
        input.onOutput?.({ stream: "stderr", data: text });
      });

      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        input.signal?.removeEventListener("abort", onAbort);
        if (canceled) {
          reject(new Error("Worktree environment setup canceled."));
          return;
        }
        reject(new Error(`Worktree environment setup script failed.\n${String(error)}`));
      });

      child.on("close", async (code) => {
        if (settled) return;
        settled = true;

        const trailingStdout = stdoutDecoder.end();
        if (trailingStdout) {
          stdoutTail = appendOutputTail(stdoutTail, trailingStdout);
          input.onOutput?.({ stream: "stdout", data: trailingStdout });
        }
        const trailingStderr = stderrDecoder.end();
        if (trailingStderr) {
          stderrTail = appendOutputTail(stderrTail, trailingStderr);
          input.onOutput?.({ stream: "stderr", data: trailingStderr });
        }

        if (canceled) {
          input.signal?.removeEventListener("abort", onAbort);
          reject(new Error("Worktree environment setup canceled."));
          return;
        }

        if (code === 0) {
          try {
            const readEnvironmentCapture = input.readEnvironmentCapture
              ?? ((filePath: string) => readFile(filePath, "utf8"));
            const [beforeCapture, afterCapture] = await Promise.all([
              readEnvironmentCapture(beforeCapturePath),
              readEnvironmentCapture(capturePath),
            ]);
            if (canceled) {
              reject(new Error("Worktree environment setup canceled."));
              return;
            }
            resolve(captureCodexShellEnvironmentDelta(
              parseCodexCapturedEnvironment(beforeCapture),
              parseCodexCapturedEnvironment(afterCapture),
            ));
          } catch (error) {
            if (canceled) {
              reject(new Error("Worktree environment setup canceled."));
              return;
            }
            input.onCaptureError?.(error);
            resolve(null);
          } finally {
            input.signal?.removeEventListener("abort", onAbort);
          }
          return;
        }

        input.signal?.removeEventListener("abort", onAbort);
        const output = [stdoutTail.trim(), stderrTail.trim()]
          .filter((chunk) => chunk.length > 0)
          .join("\n");
        reject(new Error(
          `Worktree environment setup script failed.${output ? `\n${output}` : ""}`,
        ));
      });
    });
  } finally {
    await rm(captureRoot, { recursive: true, force: true });
  }
}

/** Exact `q2/Y2/X2`: resolve the worktree-local git path, then write or clear it. */
export async function persistCodexWorktreeShellEnvironment(input: {
  readonly cwd: string;
  readonly shellEnvironment: CodexStoredShellEnvironment | null;
  readonly resolveGitPath: (
    cwd: string,
    fileName: "codex-shell-environment.json",
  ) => Promise<string | null>;
}): Promise<void> {
  const gitPath = await input.resolveGitPath(input.cwd, "codex-shell-environment.json");
  if (!gitPath) {
    throw new Error("No git repository found for worktree shell environment");
  }
  const configPath = path.isAbsolute(gitPath) ? gitPath : path.resolve(input.cwd, gitPath);
  if (input.shellEnvironment === null) {
    await rm(configPath, { force: true });
    return;
  }
  await writeFile(
    configPath,
    `${JSON.stringify(input.shellEnvironment, null, 2)}\n`,
    "utf8",
  );
}
