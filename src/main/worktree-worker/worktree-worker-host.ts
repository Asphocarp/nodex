import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
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
} from "../codex/codex-worktree-worker-port";
import {
  CODEX_WORKTREE_WORKER_PROTOCOL_VERSION,
  createCodexWorktreeWorkerRequestMessage,
  isCodexWorktreeWorkerThreadMessage,
  type CodexWorktreeWorkerHostMessage,
} from "./worktree-worker-protocol";

interface PendingRequest {
  readonly operation: CodexWorktreeWorkerOperation;
  readonly onEvent: (event: CodexWorktreeWorkerEvent) => void;
  readonly resolve: (value: CodexWorktreeWorkerSuccess) => void;
  readonly reject: (error: Error) => void;
  readonly cleanup: () => void;
}

export interface CodexWorktreeWorkerHostOptions {
  readonly hostId: string;
  readonly workerPath: string;
  readonly onInfrastructureError?: (error: Error) => void;
}

function defaultRequestOptions(
  options?: Partial<CodexWorktreeWorkerRequestOptions>,
): CodexWorktreeWorkerRequestOptions {
  return {
    signal: options?.signal ?? new AbortController().signal,
    onEvent: options?.onEvent ?? (() => undefined),
  };
}

export class CodexWorktreeWorkerHost implements CodexWorktreeWorkerPort {
  readonly hostId: string;
  readonly #workerPath: string;
  readonly #onInfrastructureError: (error: Error) => void;
  readonly #requests = new Map<string, PendingRequest>();
  #worker: Worker | null = null;
  #epoch = 0;
  #shuttingDown = false;

  constructor(options: CodexWorktreeWorkerHostOptions) {
    this.hostId = options.hostId.trim();
    if (!this.hostId) throw new Error("Worktree worker host id is required");
    this.#workerPath = options.workerPath;
    this.#onInfrastructureError = options.onInfrastructureError ?? (() => undefined);
  }

  async create(
    input: CodexWorktreeWorkerCreateInput,
    options: CodexWorktreeWorkerRequestOptions,
  ): Promise<CodexWorktreeWorkerCreateResult> {
    const success = await this.#request({ operation: "create", input }, options);
    if (success.operation !== "create") throw new Error("Worktree worker result mismatch");
    return success.value;
  }

  async list(
    input: CodexWorktreeWorkerListInput,
    options?: Partial<CodexWorktreeWorkerRequestOptions>,
  ): Promise<CodexWorktreeWorkerListResult> {
    const success = await this.#request(
      { operation: "list", input },
      defaultRequestOptions(options),
    );
    if (success.operation !== "list") throw new Error("Worktree worker result mismatch");
    return success.value;
  }

  async inspect(
    input: CodexWorktreeWorkerInspectInput,
    options?: Partial<CodexWorktreeWorkerRequestOptions>,
  ): Promise<CodexWorktreeWorkerInspectResult> {
    const success = await this.#request(
      { operation: "inspect", input },
      defaultRequestOptions(options),
    );
    if (success.operation !== "inspect") throw new Error("Worktree worker result mismatch");
    return success.value;
  }

  async snapshot(
    input: CodexWorktreeWorkerSnapshotInput,
    options: CodexWorktreeWorkerRequestOptions,
  ): Promise<CodexWorktreeWorkerSnapshotResult> {
    const success = await this.#request({ operation: "snapshot", input }, options);
    if (success.operation !== "snapshot") throw new Error("Worktree worker result mismatch");
    return success.value;
  }

  async remove(
    input: CodexWorktreeWorkerRemoveInput,
    options?: Partial<CodexWorktreeWorkerRequestOptions>,
  ): Promise<CodexWorktreeWorkerRemoveResult> {
    const success = await this.#request(
      { operation: "remove", input },
      defaultRequestOptions(options),
    );
    if (success.operation !== "remove") throw new Error("Worktree worker result mismatch");
    return success.value;
  }

  async restore(
    input: CodexWorktreeWorkerRestoreInput,
    options: CodexWorktreeWorkerRequestOptions,
  ): Promise<CodexWorktreeWorkerRestoreResult> {
    const success = await this.#request({ operation: "restore", input }, options);
    if (success.operation !== "restore") throw new Error("Worktree worker result mismatch");
    return success.value;
  }

  async setOwner(
    input: CodexWorktreeWorkerSetOwnerInput,
    options?: Partial<CodexWorktreeWorkerRequestOptions>,
  ): Promise<CodexWorktreeWorkerSetOwnerResult> {
    const success = await this.#request(
      { operation: "set-owner", input },
      defaultRequestOptions(options),
    );
    if (success.operation !== "set-owner") throw new Error("Worktree worker result mismatch");
    return success.value;
  }

  async prepareHandoff(
    input: CodexWorktreeWorkerPrepareHandoffInput,
    options: CodexWorktreeWorkerRequestOptions,
  ): Promise<CodexWorktreeWorkerPreparedHandoff> {
    const success = await this.#request({ operation: "prepare-handoff", input }, options);
    if (success.operation !== "prepare-handoff") {
      throw new Error("Worktree worker result mismatch");
    }
    return success.value;
  }

  async rollbackHandoff(
    input: CodexWorktreeWorkerRollbackHandoffInput,
    options: CodexWorktreeWorkerRequestOptions,
  ): Promise<CodexWorktreeWorkerRollbackHandoffResult> {
    const success = await this.#request({ operation: "rollback-handoff", input }, options);
    if (success.operation !== "rollback-handoff") {
      throw new Error("Worktree worker result mismatch");
    }
    return success.value;
  }

  async cleanupHandoff(
    input: CodexWorktreeWorkerCleanupHandoffInput,
    options?: Partial<CodexWorktreeWorkerRequestOptions>,
  ): Promise<CodexWorktreeWorkerCleanupHandoffResult> {
    const success = await this.#request(
      { operation: "cleanup-handoff", input },
      defaultRequestOptions(options),
    );
    if (success.operation !== "cleanup-handoff") {
      throw new Error("Worktree worker result mismatch");
    }
    return success.value;
  }

  async exportHandoff(
    input: CodexWorktreeWorkerExportHandoffInput,
    options: CodexWorktreeWorkerRequestOptions,
  ): Promise<CodexWorktreeWorkerExportHandoffResult> {
    const success = await this.#request({ operation: "export-handoff", input }, options);
    if (success.operation !== "export-handoff") throw new Error("Worktree worker result mismatch");
    return success.value;
  }

  async importHandoff(
    input: CodexWorktreeWorkerImportHandoffInput,
    options: CodexWorktreeWorkerRequestOptions,
  ): Promise<CodexWorktreeWorkerImportHandoffResult> {
    const success = await this.#request({ operation: "import-handoff", input }, options);
    if (success.operation !== "import-handoff") throw new Error("Worktree worker result mismatch");
    return success.value;
  }

  async cleanupTransferHandoff(
    input: CodexWorktreeWorkerCleanupTransferHandoffInput,
    options?: Partial<CodexWorktreeWorkerRequestOptions>,
  ): Promise<CodexWorktreeWorkerCleanupTransferHandoffResult> {
    const success = await this.#request(
      { operation: "cleanup-transfer-handoff", input },
      defaultRequestOptions(options),
    );
    if (success.operation !== "cleanup-transfer-handoff") {
      throw new Error("Worktree worker result mismatch");
    }
    return success.value;
  }

  async shutdown(): Promise<void> {
    if (this.#shuttingDown) return;
    this.#shuttingDown = true;
    const worker = this.#worker;
    this.#worker = null;
    this.#failAll(new Error("Worktree worker is shutting down"));
    if (!worker) return;
    worker.postMessage({
      type: "shutdown",
      protocolVersion: CODEX_WORKTREE_WORKER_PROTOCOL_VERSION,
    } satisfies CodexWorktreeWorkerHostMessage);
    await worker.terminate();
  }

  #request(
    request: CodexWorktreeWorkerRequest,
    options: CodexWorktreeWorkerRequestOptions,
  ): Promise<CodexWorktreeWorkerSuccess> {
    if (this.#shuttingDown) return Promise.reject(new Error("Worktree worker is shutting down"));
    if (request.input.hostId !== this.hostId) {
      return Promise.reject(
        new Error(`Worktree request host ${request.input.hostId} does not match ${this.hostId}`),
      );
    }
    if (options.signal.aborted) return Promise.reject(new Error("Request canceled"));
    const id = `${request.operation}:${randomUUID()}`;
    let message: CodexWorktreeWorkerHostMessage;
    try {
      message = createCodexWorktreeWorkerRequestMessage({ id, request });
    } catch (error) {
      return Promise.reject(error);
    }
    const worker = this.#ensureWorker();
    return new Promise((resolve, reject) => {
      const cancel = () => {
        const pending = this.#requests.get(id);
        if (!pending) return;
        this.#requests.delete(id);
        pending.cleanup();
        worker.postMessage({
          type: "cancel",
          protocolVersion: CODEX_WORKTREE_WORKER_PROTOCOL_VERSION,
          id,
          operation: request.operation,
        } satisfies CodexWorktreeWorkerHostMessage);
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
      worker.postMessage(message);
    });
  }

  #ensureWorker(): Worker {
    if (this.#worker) return this.#worker;
    this.#epoch += 1;
    const epoch = this.#epoch;
    const worker = new Worker(this.#workerPath, {
      name: `worktree:${this.hostId}`,
      workerData: { epoch, hostId: this.hostId },
    });
    worker.on("message", (raw: unknown) => {
      if (!isCodexWorktreeWorkerThreadMessage(raw)) {
        this.#handleFailure(new Error("Worktree worker sent an invalid message"), worker);
        return;
      }
      if (raw.type === "ready") {
        if (raw.epoch !== epoch || raw.hostId !== this.hostId) {
          this.#handleFailure(new Error("Worktree worker identity mismatch"), worker);
        }
        return;
      }
      const request = this.#requests.get(raw.id);
      if (!request) return;
      if (raw.operation !== request.operation) {
        this.#handleFailure(new Error("Worktree worker operation mismatch"), worker);
        return;
      }
      if (raw.type === "event") {
        try {
          request.onEvent(raw.event);
        } catch (error) {
          this.#requests.delete(raw.id);
          request.cleanup();
          worker.postMessage({
            type: "cancel",
            protocolVersion: CODEX_WORKTREE_WORKER_PROTOCOL_VERSION,
            id: raw.id,
            operation: raw.operation,
          } satisfies CodexWorktreeWorkerHostMessage);
          request.reject(error instanceof Error ? error : new Error(String(error)));
        }
        return;
      }
      this.#requests.delete(raw.id);
      request.cleanup();
      if (raw.result.type === "error") request.reject(new Error(raw.result.message));
      else request.resolve(raw.result.success);
    });
    worker.on("error", (error) => this.#handleFailure(error, worker));
    worker.on("exit", (code) => {
      if (this.#worker !== worker || this.#shuttingDown) return;
      this.#handleFailure(new Error(`Worktree worker exited with code ${String(code)}`), worker);
    });
    this.#worker = worker;
    return worker;
  }

  #handleFailure(error: Error, worker: Worker): void {
    if (this.#worker !== worker) return;
    this.#worker = null;
    this.#failAll(new Error("Worktree worker is temporarily unavailable"));
    this.#onInfrastructureError(error);
    void worker.terminate();
  }

  #failAll(error: Error): void {
    for (const request of this.#requests.values()) {
      request.cleanup();
      request.reject(error);
    }
    this.#requests.clear();
  }
}
