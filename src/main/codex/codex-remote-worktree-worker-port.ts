import { randomUUID } from "node:crypto";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type {
  CodexWorktreeWorkerCreateInput,
  CodexWorktreeWorkerCreateResult,
  CodexWorktreeWorkerEvent,
  CodexWorktreeWorkerInspectInput,
  CodexWorktreeWorkerInspectResult,
  CodexWorktreeWorkerListInput,
  CodexWorktreeWorkerListResult,
  CodexWorktreeWorkerOperation,
  CodexWorktreeWorkerPort,
  CodexWorktreeWorkerPrepareHandoffInput,
  CodexWorktreeWorkerPreparedHandoff,
  CodexWorktreeWorkerRollbackHandoffInput,
  CodexWorktreeWorkerRollbackHandoffResult,
  CodexWorktreeWorkerCleanupHandoffInput,
  CodexWorktreeWorkerCleanupHandoffResult,
  CodexWorktreeWorkerRemoveInput,
  CodexWorktreeWorkerRemoveResult,
  CodexWorktreeWorkerRequest,
  CodexWorktreeWorkerRequestOptions,
  CodexWorktreeWorkerRestoreInput,
  CodexWorktreeWorkerRestoreResult,
  CodexWorktreeWorkerSetOwnerInput,
  CodexWorktreeWorkerSetOwnerResult,
  CodexWorktreeWorkerSnapshotInput,
  CodexWorktreeWorkerSnapshotResult,
  CodexWorktreeWorkerSuccess,
  CodexWorktreeWorkerExportHandoffInput,
  CodexWorktreeWorkerExportHandoffResult,
  CodexWorktreeWorkerImportHandoffInput,
  CodexWorktreeWorkerImportHandoffResult,
  CodexWorktreeWorkerCleanupTransferHandoffInput,
  CodexWorktreeWorkerCleanupTransferHandoffResult,
} from "./codex-worktree-worker-port";
import {
  assertCodexWorktreeWorkerHostMessage,
  CODEX_WORKTREE_WORKER_PROTOCOL_VERSION,
  createCodexWorktreeWorkerRequestMessage,
  isCodexWorktreeWorkerThreadMessage,
  type CodexWorktreeWorkerHostMessage,
} from "../worktree-worker/worktree-worker-protocol";

interface PendingRequest {
  readonly operation: CodexWorktreeWorkerOperation;
  readonly onEvent: (event: CodexWorktreeWorkerEvent) => void;
  readonly resolve: (value: CodexWorktreeWorkerSuccess) => void;
  readonly reject: (error: Error) => void;
  readonly cleanup: () => void;
}

export class CodexRemoteExecutionUnknownStateError extends Error {
  readonly code = "remote-execution-state-unknown" as const;
  readonly hostId: string;

  constructor(hostId: string, message = "Remote execution state is unknown after the SSH connection closed") {
    super(message);
    this.name = "CodexRemoteExecutionUnknownStateError";
    this.hostId = hostId;
  }
}

function requestOptions(
  options?: Partial<CodexWorktreeWorkerRequestOptions>,
): CodexWorktreeWorkerRequestOptions {
  return {
    signal: options?.signal ?? new AbortController().signal,
    onEvent: options?.onEvent ?? (() => undefined),
  };
}

/** Persistent JSON-lines worker channel carried by one authenticated SSH process. */
export class CodexRemoteWorktreeWorkerPort implements CodexWorktreeWorkerPort {
  readonly hostId: string;
  readonly #openWorker: () => Promise<ChildProcessWithoutNullStreams>;
  readonly #onInfrastructureError: (error: Error) => void;
  readonly #requests = new Map<string, PendingRequest>();
  #child: ChildProcessWithoutNullStreams | null = null;
  #opening: Promise<ChildProcessWithoutNullStreams> | null = null;
  #stdoutBuffer = "";
  #shuttingDown = false;

  constructor(options: {
    readonly hostId: string;
    readonly openWorker: () => Promise<ChildProcessWithoutNullStreams>;
    readonly onInfrastructureError?: (error: Error) => void;
  }) {
    this.hostId = options.hostId.trim();
    if (!this.hostId) throw new Error("Remote worktree worker host id is required");
    this.#openWorker = options.openWorker;
    this.#onInfrastructureError = options.onInfrastructureError ?? (() => undefined);
  }

  async create(input: CodexWorktreeWorkerCreateInput, options: CodexWorktreeWorkerRequestOptions): Promise<CodexWorktreeWorkerCreateResult> {
    const result = await this.#request({ operation: "create", input }, options);
    if (result.operation !== "create") throw new Error("Worktree worker result mismatch");
    return result.value;
  }

  async list(input: CodexWorktreeWorkerListInput, options?: Partial<CodexWorktreeWorkerRequestOptions>): Promise<CodexWorktreeWorkerListResult> {
    const result = await this.#request({ operation: "list", input }, requestOptions(options));
    if (result.operation !== "list") throw new Error("Worktree worker result mismatch");
    return result.value;
  }

  async inspect(input: CodexWorktreeWorkerInspectInput, options?: Partial<CodexWorktreeWorkerRequestOptions>): Promise<CodexWorktreeWorkerInspectResult> {
    const result = await this.#request({ operation: "inspect", input }, requestOptions(options));
    if (result.operation !== "inspect") throw new Error("Worktree worker result mismatch");
    return result.value;
  }

  async snapshot(input: CodexWorktreeWorkerSnapshotInput, options: CodexWorktreeWorkerRequestOptions): Promise<CodexWorktreeWorkerSnapshotResult> {
    const result = await this.#request({ operation: "snapshot", input }, options);
    if (result.operation !== "snapshot") throw new Error("Worktree worker result mismatch");
    return result.value;
  }

  async remove(input: CodexWorktreeWorkerRemoveInput, options?: Partial<CodexWorktreeWorkerRequestOptions>): Promise<CodexWorktreeWorkerRemoveResult> {
    const result = await this.#request({ operation: "remove", input }, requestOptions(options));
    if (result.operation !== "remove") throw new Error("Worktree worker result mismatch");
    return result.value;
  }

  async restore(input: CodexWorktreeWorkerRestoreInput, options: CodexWorktreeWorkerRequestOptions): Promise<CodexWorktreeWorkerRestoreResult> {
    const result = await this.#request({ operation: "restore", input }, options);
    if (result.operation !== "restore") throw new Error("Worktree worker result mismatch");
    return result.value;
  }

  async setOwner(input: CodexWorktreeWorkerSetOwnerInput, options?: Partial<CodexWorktreeWorkerRequestOptions>): Promise<CodexWorktreeWorkerSetOwnerResult> {
    const result = await this.#request({ operation: "set-owner", input }, requestOptions(options));
    if (result.operation !== "set-owner") throw new Error("Worktree worker result mismatch");
    return result.value;
  }

  async prepareHandoff(input: CodexWorktreeWorkerPrepareHandoffInput, options: CodexWorktreeWorkerRequestOptions): Promise<CodexWorktreeWorkerPreparedHandoff> {
    const result = await this.#request({ operation: "prepare-handoff", input }, options);
    if (result.operation !== "prepare-handoff") throw new Error("Worktree worker result mismatch");
    return result.value;
  }

  async rollbackHandoff(input: CodexWorktreeWorkerRollbackHandoffInput, options: CodexWorktreeWorkerRequestOptions): Promise<CodexWorktreeWorkerRollbackHandoffResult> {
    const result = await this.#request({ operation: "rollback-handoff", input }, options);
    if (result.operation !== "rollback-handoff") throw new Error("Worktree worker result mismatch");
    return result.value;
  }

  async cleanupHandoff(input: CodexWorktreeWorkerCleanupHandoffInput, options?: Partial<CodexWorktreeWorkerRequestOptions>): Promise<CodexWorktreeWorkerCleanupHandoffResult> {
    const result = await this.#request({ operation: "cleanup-handoff", input }, requestOptions(options));
    if (result.operation !== "cleanup-handoff") throw new Error("Worktree worker result mismatch");
    return result.value;
  }

  async exportHandoff(input: CodexWorktreeWorkerExportHandoffInput, options: CodexWorktreeWorkerRequestOptions): Promise<CodexWorktreeWorkerExportHandoffResult> {
    const result = await this.#request({ operation: "export-handoff", input }, options);
    if (result.operation !== "export-handoff") throw new Error("Worktree worker result mismatch");
    return result.value;
  }

  async importHandoff(input: CodexWorktreeWorkerImportHandoffInput, options: CodexWorktreeWorkerRequestOptions): Promise<CodexWorktreeWorkerImportHandoffResult> {
    const result = await this.#request({ operation: "import-handoff", input }, options);
    if (result.operation !== "import-handoff") throw new Error("Worktree worker result mismatch");
    return result.value;
  }

  async cleanupTransferHandoff(input: CodexWorktreeWorkerCleanupTransferHandoffInput, options?: Partial<CodexWorktreeWorkerRequestOptions>): Promise<CodexWorktreeWorkerCleanupTransferHandoffResult> {
    const result = await this.#request({ operation: "cleanup-transfer-handoff", input }, requestOptions(options));
    if (result.operation !== "cleanup-transfer-handoff") throw new Error("Worktree worker result mismatch");
    return result.value;
  }

  async shutdown(): Promise<void> {
    if (this.#shuttingDown) return;
    this.#shuttingDown = true;
    const child = this.#child ?? await this.#opening?.catch(() => null) ?? null;
    this.#child = null;
    this.#opening = null;
    this.#failAll(new Error("Remote worktree worker is shutting down"));
    if (!child) return;
    this.#write(child, {
      type: "shutdown",
      protocolVersion: CODEX_WORKTREE_WORKER_PROTOCOL_VERSION,
    });
    child.stdin.end();
  }

  async #request(
    request: CodexWorktreeWorkerRequest,
    options: CodexWorktreeWorkerRequestOptions,
  ): Promise<CodexWorktreeWorkerSuccess> {
    if (this.#shuttingDown) throw new Error("Remote worktree worker is shutting down");
    if (request.input.hostId !== this.hostId) {
      throw new Error(`Worktree request host ${request.input.hostId} does not match ${this.hostId}`);
    }
    if (options.signal.aborted) throw new Error("Request canceled");
    const id = `${request.operation}:${randomUUID()}`;
    const message = createCodexWorktreeWorkerRequestMessage({ id, request });
    const child = await this.#ensureWorker();
    if (options.signal.aborted) throw new Error("Request canceled");
    return await new Promise((resolve, reject) => {
      const cancel = () => {
        const pending = this.#requests.get(id);
        if (!pending) return;
        this.#requests.delete(id);
        pending.cleanup();
        this.#write(child, {
          type: "cancel",
          protocolVersion: CODEX_WORKTREE_WORKER_PROTOCOL_VERSION,
          id,
          operation: request.operation,
        });
        reject(new Error("Request canceled"));
      };
      const cleanup = () => options.signal.removeEventListener("abort", cancel);
      this.#requests.set(id, {
        operation: request.operation,
        onEvent: options.onEvent,
        resolve,
        reject,
        cleanup,
      });
      options.signal.addEventListener("abort", cancel, { once: true });
      this.#write(child, message);
    });
  }

  async #ensureWorker(): Promise<ChildProcessWithoutNullStreams> {
    if (this.#child) return this.#child;
    if (this.#opening) return await this.#opening;
    const opening = this.#openWorker().then((child) => {
      if (this.#shuttingDown) {
        child.kill("SIGTERM");
        throw new Error("Remote worktree worker is shutting down");
      }
      this.#attach(child);
      this.#child = child;
      return child;
    }).finally(() => {
      if (this.#opening === opening) this.#opening = null;
    });
    this.#opening = opening;
    return await opening;
  }

  #attach(child: ChildProcessWithoutNullStreams): void {
    this.#stdoutBuffer = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      this.#stdoutBuffer += chunk;
      while (true) {
        const newline = this.#stdoutBuffer.indexOf("\n");
        if (newline < 0) break;
        const line = this.#stdoutBuffer.slice(0, newline).trim();
        this.#stdoutBuffer = this.#stdoutBuffer.slice(newline + 1);
        if (!line) continue;
        let raw: unknown;
        try {
          raw = JSON.parse(line) as unknown;
        } catch {
          this.#handleFailure(new Error("Remote worktree worker sent invalid JSON"), child);
          return;
        }
        if (!isCodexWorktreeWorkerThreadMessage(raw)) {
          this.#handleFailure(new Error("Remote worktree worker sent an invalid message"), child);
          return;
        }
        if (raw.type === "ready") {
          if (raw.hostId !== this.hostId) {
            this.#handleFailure(new Error("Remote worktree worker identity mismatch"), child);
          }
          continue;
        }
        const pending = this.#requests.get(raw.id);
        if (!pending) continue;
        if (pending.operation !== raw.operation) {
          this.#handleFailure(new Error("Remote worktree worker operation mismatch"), child);
          return;
        }
        if (raw.type === "event") {
          try {
            pending.onEvent(raw.event);
          } catch (error) {
            this.#requests.delete(raw.id);
            pending.cleanup();
            pending.reject(error instanceof Error ? error : new Error(String(error)));
          }
          continue;
        }
        this.#requests.delete(raw.id);
        pending.cleanup();
        if (raw.result.type === "error") pending.reject(new Error(raw.result.message));
        else pending.resolve(raw.result.success);
      }
    });
    child.on("error", (error) => this.#handleFailure(error, child));
    child.on("exit", (code, signal) => {
      if (this.#child !== child || this.#shuttingDown) return;
      this.#handleFailure(
        new Error(`Remote worktree SSH session exited (${String(code ?? signal)})`),
        child,
      );
    });
  }

  #write(child: ChildProcessWithoutNullStreams, message: CodexWorktreeWorkerHostMessage): void {
    assertCodexWorktreeWorkerHostMessage(message);
    if (child.stdin.destroyed) throw new CodexRemoteExecutionUnknownStateError(this.hostId);
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #handleFailure(error: Error, child: ChildProcessWithoutNullStreams): void {
    if (this.#child !== child) return;
    this.#child = null;
    this.#failAll(new CodexRemoteExecutionUnknownStateError(this.hostId));
    this.#onInfrastructureError(error);
    child.kill("SIGTERM");
  }

  #failAll(error: Error): void {
    for (const pending of this.#requests.values()) {
      pending.cleanup();
      pending.reject(error);
    }
    this.#requests.clear();
  }
}
