import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

export type GitCommandProcessFailureReason =
  | "output_limit"
  | "spawn_failed"
  | "timed_out"
  | "wait_failed";

export interface GitCommandProcessInput {
  readonly args: readonly string[];
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly outputBytesCap: number;
  readonly stdin?: string | Uint8Array;
  readonly timeoutMs: number | null;
}

export interface GitCommandProcessResult {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutBytes: number;
  readonly stderrBytes: number;
  readonly failureReason: GitCommandProcessFailureReason | null;
}

/** Stable application port for one bounded, interruption-aware Git process. */
export class GitCommandPlatform extends Context.Service<
  GitCommandPlatform,
  {
    readonly run: (input: GitCommandProcessInput) => Effect.Effect<GitCommandProcessResult>;
  }
>()("nodex/main/git-worker/GitCommandPlatform") {}
