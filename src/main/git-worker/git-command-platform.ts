import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

export type GitCommandProcessFailureReason =
  | "output_limit"
  | "spawn_failed"
  | "timed_out"
  | "wait_failed";

/**
 * Consumes stdout without decoding or retaining it in the process adapter.
 * The callback must consume or copy each transient chunk synchronously. A null
 * limit is safe only for consumers whose own memory use stays bounded.
 */
export interface GitCommandStdoutStream {
  readonly maxBytes: number | null;
  readonly onChunk: (chunk: Uint8Array) => void;
}

export interface GitCommandProcessInput {
  readonly args: readonly string[];
  readonly cwd: string;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly outputBytesCap: number;
  readonly stdin?: string | Uint8Array;
  readonly stdoutStream?: GitCommandStdoutStream;
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
