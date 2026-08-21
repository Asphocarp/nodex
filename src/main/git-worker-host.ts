import { Worker } from "node:worker_threads";
import { randomUUID } from "node:crypto";
import {
  createGitWorkerInfrastructureErrorResponse,
  GIT_WORKER_MESSAGE_FOR_VIEW_CHANNEL,
  isGitWorkerMessageFromThread,
  type GitWorkerMessageForView,
  type GitWorkerMessageFromView,
  type GitWorkerMessageFromHost,
  type GitWorkerMessageFromThread,
  type GitWorkerMethod,
  type GitWorkerMethodMap,
  type GitPerformanceOperationMetric,
  type GitWorkerRequest,
} from "../shared/git-worker-protocol";

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 1_500;

export interface GitWorkerRendererTarget {
  readonly id: number;
  isDestroyed(): boolean;
  send(channel: string, message: GitWorkerMessageForView): void;
  on(event: "destroyed", listener: () => void): unknown;
  removeListener(event: "destroyed", listener: () => void): unknown;
}

export interface GitWorkerProcess {
  postMessage(message: GitWorkerMessageFromHost): void;
  onMessage(listener: (message: unknown) => void): () => void;
  onError(listener: (error: Error) => void): () => void;
  onExit(listener: (code: number) => void): () => void;
  terminate(): Promise<number>;
}

export type GitWorkerProcessFactory = (input: {
  epoch: number;
  workerPath: string;
}) => GitWorkerProcess;

interface RendererState {
  target: GitWorkerRendererTarget;
  requestIds: Set<string>;
  subscriptionIds: Set<string>;
  onDestroyed: () => void;
}

interface RunningWorker {
  epoch: number;
  process: GitWorkerProcess;
  stopping: boolean;
  ready: boolean;
  releaseListeners: () => void;
  exitPromise: Promise<number>;
  resolveExit: (code: number) => void;
}

interface MainRequestState {
  method: GitWorkerMethod;
  resolve(value: unknown): void;
  reject(error: unknown): void;
  cleanup(): void;
}

export class GitWorkerHostError extends Error {
  readonly code: "protocol-error" | "worker-unavailable";

  constructor(code: "protocol-error" | "worker-unavailable", message: string) {
    super(message);
    this.name = "GitWorkerHostError";
    this.code = code;
  }
}

export interface GitWorkerHostOptions {
  workerPath: string;
  createProcess?: GitWorkerProcessFactory;
  onInfrastructureError?: (
    error: Error,
    context: { epoch: number; phase: "error" | "exit" | "protocol" },
  ) => void;
  onPerformanceOperation?: (metric: GitPerformanceOperationMetric) => void;
}

function createNodeGitWorkerProcess(input: {
  epoch: number;
  workerPath: string;
}): GitWorkerProcess {
  const worker = new Worker(input.workerPath, {
    name: "git",
    workerData: { epoch: input.epoch },
  });
  return {
    postMessage: (message) => worker.postMessage(message),
    onMessage: (listener) => {
      worker.on("message", listener);
      return () => worker.off("message", listener);
    },
    onError: (listener) => {
      worker.on("error", listener);
      return () => worker.off("error", listener);
    },
    onExit: (listener) => {
      worker.on("exit", listener);
      return () => worker.off("exit", listener);
    },
    terminate: async () => await worker.terminate(),
  };
}

export class GitWorkerHost {
  readonly #workerPath: string;
  readonly #createProcess: GitWorkerProcessFactory;
  readonly #onInfrastructureError: NonNullable<GitWorkerHostOptions["onInfrastructureError"]>;
  readonly #onPerformanceOperation: NonNullable<GitWorkerHostOptions["onPerformanceOperation"]>;
  readonly #renderers = new Map<number, RendererState>();
  readonly #requestOwners = new Map<
    string,
    { ownerId: number; method: GitWorkerRequest["request"]["method"] }
  >();
  readonly #mainRequests = new Map<string, MainRequestState>();
  readonly #subscriptionOwners = new Map<string, number>();
  #current: RunningWorker | null = null;
  #nextEpoch = 1;
  #shuttingDown = false;

  constructor(options: GitWorkerHostOptions) {
    this.#workerPath = options.workerPath;
    this.#createProcess = options.createProcess ?? createNodeGitWorkerProcess;
    this.#onInfrastructureError = options.onInfrastructureError ?? (() => {});
    this.#onPerformanceOperation = options.onPerformanceOperation ?? (() => {});
  }

  handleRendererMessage(target: GitWorkerRendererTarget, message: GitWorkerMessageFromView): void {
    if (message.type === "worker-request-cancel") {
      this.#cancelRendererRequest(target.id, message.id);
      return;
    }
    const renderer = this.#retainRenderer(target);
    if (this.#shuttingDown) {
      this.#sendInfrastructureError(
        renderer.target,
        message.request,
        "worker-unavailable",
        "Git worker is shutting down",
      );
      return;
    }
    if (this.#requestOwners.has(message.request.id) || this.#mainRequests.has(message.request.id)) {
      this.#sendInfrastructureError(
        renderer.target,
        message.request,
        "protocol-error",
        "Git worker request id is already active",
      );
      return;
    }
    if (!this.#authorizeLiveSubscriptionRequest(target, message)) return;
    renderer.requestIds.add(message.request.id);
    this.#requestOwners.set(message.request.id, {
      ownerId: target.id,
      method: message.request.method,
    });
    this.#ensureWorker().process.postMessage(message);
  }

  requestFromMain<Method extends GitWorkerMethod>(input: {
    method: Method;
    params: GitWorkerMethodMap[Method]["params"];
    signal?: AbortSignal;
  }): Promise<GitWorkerMethodMap[Method]["result"]> {
    if (this.#shuttingDown) {
      return Promise.reject(
        new GitWorkerHostError("worker-unavailable", "Git worker is shutting down"),
      );
    }
    if (input.signal?.aborted) {
      return Promise.reject(input.signal.reason);
    }
    const id = `main:${randomUUID()}`;
    const message = {
      type: "worker-request",
      workerId: "git",
      request: {
        id,
        method: input.method,
        params: input.params,
        enqueuedAtMs: Date.now(),
      },
    } as GitWorkerRequest;
    return new Promise<GitWorkerMethodMap[Method]["result"]>((resolve, reject) => {
      const cancel = () => {
        const pending = this.#mainRequests.get(id);
        if (!pending) return;
        this.#mainRequests.delete(id);
        pending.cleanup();
        this.#current?.process.postMessage({
          type: "worker-request-cancel",
          workerId: "git",
          id,
        });
        reject(input.signal?.reason);
      };
      const cleanup = () => input.signal?.removeEventListener("abort", cancel);
      this.#mainRequests.set(id, {
        method: input.method,
        resolve,
        reject,
        cleanup,
      });
      input.signal?.addEventListener("abort", cancel, { once: true });
      this.#ensureWorker().process.postMessage(message);
    });
  }

  async shutdown(timeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS): Promise<void> {
    if (this.#shuttingDown) return;
    this.#shuttingDown = true;
    const current = this.#current;
    if (!current) {
      this.#disposeRenderers();
      return;
    }
    current.stopping = true;
    this.#failAllRequests("Git worker is shutting down");
    current.process.postMessage({ type: "worker-shutdown", workerId: "git" });
    let timeout: ReturnType<typeof setTimeout> | null = null;
    try {
      await Promise.race([
        current.exitPromise,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error("Git worker shutdown timed out")), timeoutMs);
          timeout.unref?.();
        }),
      ]);
    } catch {
      await current.process.terminate();
    } finally {
      if (timeout) clearTimeout(timeout);
      if (this.#current === current) {
        current.releaseListeners();
        this.#current = null;
      }
      this.#disposeRenderers();
    }
  }

  #ensureWorker(): RunningWorker {
    if (this.#current) return this.#current;
    const epoch = this.#nextEpoch;
    this.#nextEpoch += 1;
    const process = this.#createProcess({ epoch, workerPath: this.#workerPath });
    let resolveExit: (code: number) => void = () => undefined;
    const exitPromise = new Promise<number>((resolve) => {
      resolveExit = resolve;
    });
    const running: RunningWorker = {
      epoch,
      process,
      stopping: false,
      ready: false,
      releaseListeners: () => {},
      exitPromise,
      resolveExit,
    };
    const removeMessage = process.onMessage((message) => {
      this.#handleWorkerMessage(running, message);
    });
    const removeError = process.onError((error) => {
      this.#handleWorkerFailure(running, error, "error");
    });
    const removeExit = process.onExit((code) => {
      running.resolveExit(code);
      if (running.stopping) {
        if (this.#current === running) this.#current = null;
        running.releaseListeners();
        return;
      }
      this.#handleWorkerFailure(
        running,
        new Error(`Git worker exited unexpectedly with code ${String(code)}`),
        "exit",
      );
    });
    running.releaseListeners = () => {
      removeMessage();
      removeError();
      removeExit();
    };
    this.#current = running;
    return running;
  }

  #handleWorkerMessage(running: RunningWorker, rawMessage: unknown): void {
    if (this.#current !== running) return;
    if (!isGitWorkerMessageFromThread(rawMessage)) {
      this.#handleWorkerFailure(
        running,
        new Error("Git worker sent an invalid protocol message"),
        "protocol",
      );
      void running.process.terminate();
      return;
    }
    const message: GitWorkerMessageFromThread = rawMessage;
    if (message.type === "worker-ready") {
      if (message.epoch !== running.epoch) {
        this.#handleWorkerFailure(
          running,
          new Error("Git worker ready epoch did not match its host epoch"),
          "protocol",
        );
        void running.process.terminate();
        return;
      }
      running.ready = true;
      if (running.epoch === 1) return;
      this.#broadcast({
        type: "worker-restarted",
        workerId: "git",
        epoch: running.epoch,
      });
      return;
    }
    if (message.type === "git-live-query-event") {
      const ownerId = this.#subscriptionOwners.get(message.event.subscriptionId);
      if (ownerId === undefined) return;
      const renderer = this.#renderers.get(ownerId);
      if (!renderer || renderer.target.isDestroyed()) return;
      renderer.target.send(GIT_WORKER_MESSAGE_FOR_VIEW_CHANNEL, message);
      return;
    }
    if (message.type === "git-performance-operation") {
      this.#onPerformanceOperation(message.metric);
      return;
    }
    const owner = this.#requestOwners.get(message.id);
    if (!owner) {
      const mainRequest = this.#mainRequests.get(message.id);
      if (!mainRequest) return;
      if (mainRequest.method !== message.method) {
        this.#handleWorkerFailure(
          running,
          new Error("Git worker response method did not match its Main request"),
          "protocol",
        );
        void running.process.terminate();
        return;
      }
      this.#mainRequests.delete(message.id);
      mainRequest.cleanup();
      if (message.result.type === "error") {
        mainRequest.reject(
          new GitWorkerHostError(message.result.error.code, message.result.error.message),
        );
      } else {
        mainRequest.resolve(message.result.value);
      }
      return;
    }
    if (owner.method !== message.method) {
      this.#handleWorkerFailure(
        running,
        new Error("Git worker response method did not match its request"),
        "protocol",
      );
      void running.process.terminate();
      return;
    }
    const renderer = this.#renderers.get(owner.ownerId);
    this.#releaseRequest(message.id, owner.ownerId);
    if (!renderer || renderer.target.isDestroyed()) return;
    renderer.target.send(GIT_WORKER_MESSAGE_FOR_VIEW_CHANNEL, message);
  }

  #handleWorkerFailure(
    running: RunningWorker,
    error: Error,
    phase: "error" | "exit" | "protocol",
  ): void {
    if (this.#current !== running) return;
    this.#current = null;
    running.releaseListeners();
    this.#failAllRequests("Git worker is temporarily unavailable");
    this.#clearLiveSubscriptionOwnership();
    this.#onInfrastructureError(error, { epoch: running.epoch, phase });
  }

  #retainRenderer(target: GitWorkerRendererTarget): RendererState {
    const existing = this.#renderers.get(target.id);
    if (existing) return existing;
    const state: RendererState = {
      target,
      requestIds: new Set(),
      subscriptionIds: new Set(),
      onDestroyed: () => this.#releaseRenderer(target.id),
    };
    this.#renderers.set(target.id, state);
    target.on("destroyed", state.onDestroyed);
    return state;
  }

  #cancelRendererRequest(ownerId: number, requestId: string): void {
    if (this.#requestOwners.get(requestId)?.ownerId !== ownerId) return;
    this.#current?.process.postMessage({
      type: "worker-request-cancel",
      workerId: "git",
      id: requestId,
    });
    this.#releaseRequest(requestId, ownerId);
  }

  #releaseRequest(requestId: string, ownerId: number): void {
    this.#requestOwners.delete(requestId);
    this.#renderers.get(ownerId)?.requestIds.delete(requestId);
  }

  #releaseRenderer(ownerId: number): void {
    const state = this.#renderers.get(ownerId);
    if (!state) return;
    for (const requestId of state.requestIds) {
      this.#current?.process.postMessage({
        type: "worker-request-cancel",
        workerId: "git",
        id: requestId,
      });
      this.#requestOwners.delete(requestId);
    }
    state.requestIds.clear();
    for (const subscriptionId of state.subscriptionIds) {
      this.#subscriptionOwners.delete(subscriptionId);
      this.#sendLiveSubscriptionCleanup(subscriptionId);
    }
    state.subscriptionIds.clear();
    state.target.removeListener("destroyed", state.onDestroyed);
    this.#renderers.delete(ownerId);
  }

  #failAllRequests(message: string): void {
    const requests = [...this.#requestOwners.entries()];
    for (const [requestId, owner] of requests) {
      const renderer = this.#renderers.get(owner.ownerId);
      const request: Pick<GitWorkerRequest["request"], "id" | "method"> = {
        id: requestId,
        method: owner.method,
      };
      this.#releaseRequest(requestId, owner.ownerId);
      if (!renderer || renderer.target.isDestroyed()) continue;
      this.#sendInfrastructureError(renderer.target, request, "worker-unavailable", message);
    }
    for (const request of this.#mainRequests.values()) {
      request.cleanup();
      request.reject(new GitWorkerHostError("worker-unavailable", message));
    }
    this.#mainRequests.clear();
  }

  #sendInfrastructureError(
    target: GitWorkerRendererTarget,
    request: Pick<GitWorkerRequest["request"], "id" | "method">,
    code: "protocol-error" | "worker-unavailable",
    message: string,
  ): void {
    if (target.isDestroyed()) return;
    target.send(
      GIT_WORKER_MESSAGE_FOR_VIEW_CHANNEL,
      createGitWorkerInfrastructureErrorResponse(request, { code, message }),
    );
  }

  #broadcast(message: GitWorkerMessageForView): void {
    for (const renderer of this.#renderers.values()) {
      if (renderer.target.isDestroyed()) continue;
      renderer.target.send(GIT_WORKER_MESSAGE_FOR_VIEW_CHANNEL, message);
    }
  }

  #disposeRenderers(): void {
    for (const ownerId of [...this.#renderers.keys()]) {
      this.#releaseRenderer(ownerId);
    }
  }

  #authorizeLiveSubscriptionRequest(
    target: GitWorkerRendererTarget,
    message: GitWorkerRequest,
  ): boolean {
    const method = message.request.method;
    if (
      method !== "subscribe-live-query" &&
      method !== "unsubscribe-live-query" &&
      method !== "recover-live-query" &&
      method !== "refresh-live-query"
    ) {
      return true;
    }
    const subscriptionId = message.request.params.subscriptionId;
    const existingOwner = this.#subscriptionOwners.get(subscriptionId);
    if (method === "subscribe-live-query") {
      if (existingOwner !== undefined && existingOwner !== target.id) {
        this.#sendInfrastructureError(
          target,
          message.request,
          "protocol-error",
          "Git live subscription belongs to another renderer",
        );
        return false;
      }
      this.#subscriptionOwners.set(subscriptionId, target.id);
      this.#retainRenderer(target).subscriptionIds.add(subscriptionId);
      return true;
    }
    if (existingOwner !== target.id) {
      this.#sendInfrastructureError(
        target,
        message.request,
        "protocol-error",
        "Git live subscription is not owned by this renderer",
      );
      return false;
    }
    if (method === "unsubscribe-live-query") {
      this.#subscriptionOwners.delete(subscriptionId);
      this.#renderers.get(target.id)?.subscriptionIds.delete(subscriptionId);
    }
    return true;
  }

  #sendLiveSubscriptionCleanup(subscriptionId: string): void {
    const current = this.#current;
    if (!current || current.stopping) return;
    current.process.postMessage({
      type: "worker-request",
      workerId: "git",
      request: {
        id: `host-cleanup:${randomUUID()}`,
        method: "unsubscribe-live-query",
        params: { subscriptionId },
        enqueuedAtMs: Date.now(),
      },
    });
  }

  #clearLiveSubscriptionOwnership(): void {
    this.#subscriptionOwners.clear();
    for (const renderer of this.#renderers.values()) {
      renderer.subscriptionIds.clear();
    }
  }
}
