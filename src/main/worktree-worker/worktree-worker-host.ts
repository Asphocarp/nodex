import { randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import type {
  CodexWorktreeWorkerCreateInput,
  CodexWorktreeWorkerCreateResult,
  CodexWorktreeWorkerEvent,
  CodexWorktreeWorkerPort,
} from "../codex/codex-worktree-worker-port";
import {
  isCodexWorktreeWorkerThreadMessage,
  type CodexWorktreeWorkerHostMessage,
} from "./worktree-worker-protocol";

interface PendingRequest {
  readonly onEvent: (event: CodexWorktreeWorkerEvent) => void;
  readonly resolve: (value: CodexWorktreeWorkerCreateResult | null) => void;
  readonly reject: (error: Error) => void;
  readonly cleanup: () => void;
}

export interface CodexWorktreeWorkerHostOptions {
  readonly workerPath: string;
  readonly onInfrastructureError?: (error: Error) => void;
}

export class CodexWorktreeWorkerHost implements CodexWorktreeWorkerPort {
  readonly #workerPath: string;
  readonly #onInfrastructureError: (error: Error) => void;
  readonly #requests = new Map<string, PendingRequest>();
  #worker: Worker | null = null;
  #epoch = 0;
  #shuttingDown = false;

  constructor(options: CodexWorktreeWorkerHostOptions) {
    this.#workerPath = options.workerPath;
    this.#onInfrastructureError = options.onInfrastructureError ?? (() => undefined);
  }

  async create(
    input: CodexWorktreeWorkerCreateInput,
    options: {
      readonly signal: AbortSignal;
      readonly onEvent: (event: CodexWorktreeWorkerEvent) => void;
    },
  ): Promise<CodexWorktreeWorkerCreateResult> {
    const result = await this.#request({
      type: "create",
      id: `create:${randomUUID()}`,
      input,
    }, options);
    if (result === null) throw new Error("Worktree worker returned no create result");
    return result;
  }

  async remove(worktreeGitRoot: string): Promise<void> {
    await this.#request({
      type: "remove",
      id: `remove:${randomUUID()}`,
      worktreeGitRoot,
    }, { signal: new AbortController().signal, onEvent: () => undefined });
  }

  async shutdown(): Promise<void> {
    if (this.#shuttingDown) return;
    this.#shuttingDown = true;
    const worker = this.#worker;
    this.#worker = null;
    this.#failAll(new Error("Worktree worker is shutting down"));
    if (!worker) return;
    worker.postMessage({ type: "shutdown" } satisfies CodexWorktreeWorkerHostMessage);
    await worker.terminate();
  }

  #request(
    message: Extract<CodexWorktreeWorkerHostMessage, { type: "create" | "remove" }>,
    options: {
      readonly signal: AbortSignal;
      readonly onEvent: (event: CodexWorktreeWorkerEvent) => void;
    },
  ): Promise<CodexWorktreeWorkerCreateResult | null> {
    if (this.#shuttingDown) return Promise.reject(new Error("Worktree worker is shutting down"));
    if (options.signal.aborted) return Promise.reject(new Error("Request canceled"));
    const worker = this.#ensureWorker();
    return new Promise((resolve, reject) => {
      const cancel = () => {
        const request = this.#requests.get(message.id);
        if (!request) return;
        this.#requests.delete(message.id);
        request.cleanup();
        worker.postMessage({ type: "cancel", id: message.id } satisfies CodexWorktreeWorkerHostMessage);
        reject(new Error("Request canceled"));
      };
      const cleanup = () => options.signal.removeEventListener("abort", cancel);
      this.#requests.set(message.id, {
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
    const worker = new Worker(this.#workerPath, {
      name: "worktree",
      workerData: { epoch: this.#epoch },
    });
    worker.on("message", (raw: unknown) => {
      if (!isCodexWorktreeWorkerThreadMessage(raw)) {
        this.#handleFailure(new Error("Worktree worker sent an invalid message"), worker);
        return;
      }
      if (raw.type === "ready") return;
      const request = this.#requests.get(raw.id);
      if (!request) return;
      if (raw.type === "event") {
        try {
          request.onEvent(raw.event);
        } catch (error) {
          this.#requests.delete(raw.id);
          request.cleanup();
          worker.postMessage({
            type: "cancel",
            id: raw.id,
          } satisfies CodexWorktreeWorkerHostMessage);
          request.reject(error instanceof Error ? error : new Error(String(error)));
        }
        return;
      }
      this.#requests.delete(raw.id);
      request.cleanup();
      if (raw.result.type === "error") request.reject(new Error(raw.result.message));
      else request.resolve(raw.result.value);
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
