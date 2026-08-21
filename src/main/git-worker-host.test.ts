import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  GIT_WORKER_PROTOCOL_VERSION,
  type GitWorkerMessageForView,
  type GitWorkerMessageFromHost,
} from "../shared/git-worker-protocol";
import {
  GitWorkerHost,
  type GitWorkerProcess,
  type GitWorkerRendererTarget,
} from "./git-worker-host";

class FakeProcess implements GitWorkerProcess {
  readonly sent: GitWorkerMessageFromHost[] = [];
  readonly events = new EventEmitter();
  terminated = false;

  postMessage(message: GitWorkerMessageFromHost): void {
    this.sent.push(message);
  }

  onMessage(listener: (message: unknown) => void): () => void {
    this.events.on("message", listener);
    return () => this.events.off("message", listener);
  }

  onError(listener: (error: Error) => void): () => void {
    this.events.on("error", listener);
    return () => this.events.off("error", listener);
  }

  onExit(listener: (code: number) => void): () => void {
    this.events.on("exit", listener);
    return () => this.events.off("exit", listener);
  }

  async terminate(): Promise<number> {
    this.terminated = true;
    this.events.emit("exit", 1);
    return 1;
  }
}

class FakeRenderer extends EventEmitter implements GitWorkerRendererTarget {
  readonly messages: GitWorkerMessageForView[] = [];
  destroyed = false;

  constructor(readonly id: number) {
    super();
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  send(_channel: string, message: GitWorkerMessageForView): void {
    this.messages.push(message);
  }

  destroy(): void {
    this.destroyed = true;
    this.emit("destroyed");
  }
}

function request(id: string, nonce = id) {
  return {
    type: "worker-request" as const,
    workerId: "git" as const,
    request: {
      id,
      method: "probe" as const,
      params: { nonce },
      enqueuedAtMs: 1,
    },
  };
}

function response(id: string, nonce = id) {
  return {
    type: "worker-response" as const,
    workerId: "git" as const,
    id,
    method: "probe" as const,
    result: {
      type: "ok" as const,
      value: {
        nonce,
        protocolVersion: GIT_WORKER_PROTOCOL_VERSION,
      },
    },
  };
}

function liveSubscriptionRequest(id: string, subscriptionId: string) {
  return {
    type: "worker-request" as const,
    workerId: "git" as const,
    request: {
      id,
      method: "subscribe-live-query" as const,
      params: {
        subscriptionId,
        query: {
          method: "base-branch" as const,
          params: { cwd: "/repo" },
        },
      },
      enqueuedAtMs: 1,
    },
  };
}

function performanceOperation(outcome: "stale" | "canceled" | "timed-out") {
  return {
    type: "git-performance-operation" as const,
    workerId: "git" as const,
    metric: {
      operation: "review-summary",
      trigger: "live" as const,
      outcome,
      durationMs: 10,
      firstResultMs: 10,
      queueDurationMs: 1,
      commandCount: 1,
      peakConcurrency: 1,
      statusCommandCount: 1,
      fullUntrackedScanCount: 0,
      unscopedAllStatusCount: 0,
      cacheHits: 0,
      cacheMisses: 1,
      coalescedQueries: 0,
      timedOut: outcome === "timed-out",
      canceled: outcome === "canceled",
      outputLimitExceeded: false,
      repoIndexSizeBucket: "unknown" as const,
    },
  };
}

describe("GitWorkerHost", () => {
  it("resolves Main-originated requests through the same worker epoch", async () => {
    const process = new FakeProcess();
    const host = new GitWorkerHost({
      workerPath: "/test/git-worker.js",
      createProcess: () => process,
    });

    const pending = host.requestFromMain({
      method: "probe",
      params: { nonce: "main" },
    });
    const sent = process.sent[0];
    expect(sent?.type).toBe("worker-request");
    if (sent?.type !== "worker-request") throw new Error("Missing request");
    process.events.emit("message", response(sent.request.id, "main"));

    await expect(pending).resolves.toEqual({
      nonce: "main",
      protocolVersion: GIT_WORKER_PROTOCOL_VERSION,
    });
  });

  it("cancels Main-originated requests with their AbortSignal", async () => {
    const process = new FakeProcess();
    const host = new GitWorkerHost({
      workerPath: "/test/git-worker.js",
      createProcess: () => process,
    });
    const controller = new AbortController();
    const pending = host.requestFromMain({
      method: "probe",
      params: { nonce: "main" },
      signal: controller.signal,
    });
    const sent = process.sent[0];
    if (sent?.type !== "worker-request") throw new Error("Missing request");

    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(process.sent.at(-1)).toEqual({
      type: "worker-request-cancel",
      workerId: "git",
      id: sent.request.id,
    });
  });

  it("routes responses only to the renderer that owns the request", () => {
    const processes: FakeProcess[] = [];
    const host = new GitWorkerHost({
      workerPath: "/test/git-worker.js",
      createProcess: () => {
        const process = new FakeProcess();
        processes.push(process);
        return process;
      },
    });
    const first = new FakeRenderer(1);
    const second = new FakeRenderer(2);

    host.handleRendererMessage(first, request("first"));
    host.handleRendererMessage(second, request("second"));
    processes[0]?.events.emit("message", response("second"));
    processes[0]?.events.emit("message", response("first"));

    expect(first.messages).toEqual([response("first")]);
    expect(second.messages).toEqual([response("second")]);
  });

  it("routes live publications to their owner and releases them on destroy", () => {
    const process = new FakeProcess();
    const host = new GitWorkerHost({
      workerPath: "/test/git-worker.js",
      createProcess: () => process,
    });
    const first = new FakeRenderer(1);
    const second = new FakeRenderer(2);
    host.handleRendererMessage(first, liveSubscriptionRequest("subscribe-1", "subscription-1"));
    host.handleRendererMessage(second, request("second"));
    process.events.emit("message", {
      type: "worker-response",
      workerId: "git",
      id: "subscribe-1",
      method: "subscribe-live-query",
      result: { type: "ok", value: { subscribed: true } },
    });
    const publication = {
      type: "git-live-query-event" as const,
      workerId: "git" as const,
      event: {
        type: "git-live-query-updated" as const,
        subscriptionId: "subscription-1",
        generation: 1,
        requiresRecovery: false,
        phase: "complete" as const,
        method: "base-branch" as const,
        result: {
          cwd: "/repo",
          local: "main",
          remote: "origin/main",
          errorMessage: null,
        },
      },
    };
    process.events.emit("message", publication);

    expect(first.messages).toContainEqual(publication);
    expect(second.messages).not.toContainEqual(publication);
    first.destroy();
    expect(process.sent.at(-1)).toMatchObject({
      type: "worker-request",
      request: {
        method: "unsubscribe-live-query",
        params: { subscriptionId: "subscription-1" },
      },
    });
  });

  it("cancels owned work when a renderer is destroyed", () => {
    const process = new FakeProcess();
    const host = new GitWorkerHost({
      workerPath: "/test/git-worker.js",
      createProcess: () => process,
    });
    const renderer = new FakeRenderer(1);
    host.handleRendererMessage(renderer, request("request-1"));

    renderer.destroy();

    expect(process.sent.at(-1)).toEqual({
      type: "worker-request-cancel",
      workerId: "git",
      id: "request-1",
    });
    process.events.emit("message", response("request-1"));
    expect(renderer.messages).toEqual([]);
  });

  it("fails pending work once and lazily starts a new epoch after a crash", () => {
    const processes: FakeProcess[] = [];
    const infrastructureError = vi.fn();
    const host = new GitWorkerHost({
      workerPath: "/test/git-worker.js",
      createProcess: () => {
        const process = new FakeProcess();
        processes.push(process);
        return process;
      },
      onInfrastructureError: infrastructureError,
    });
    const renderer = new FakeRenderer(1);
    host.handleRendererMessage(renderer, request("request-1"));
    processes[0]?.events.emit("error", new Error("boom"));

    expect(renderer.messages.at(-1)).toMatchObject({
      type: "worker-response",
      id: "request-1",
      result: {
        type: "error",
        error: { code: "worker-unavailable" },
      },
    });
    expect(infrastructureError).toHaveBeenCalledTimes(1);

    host.handleRendererMessage(renderer, request("request-2"));
    expect(processes).toHaveLength(2);
    processes[1]?.events.emit("message", {
      type: "worker-ready",
      workerId: "git",
      epoch: 2,
      protocolVersion: GIT_WORKER_PROTOCOL_VERSION,
    });
    expect(renderer.messages.at(-1)).toEqual({
      type: "worker-restarted",
      workerId: "git",
      epoch: 2,
    });
  });

  it("records expected Git outcomes without reporting infrastructure errors", () => {
    const process = new FakeProcess();
    const infrastructureError = vi.fn();
    const performance = vi.fn();
    const host = new GitWorkerHost({
      workerPath: "/test/git-worker.js",
      createProcess: () => process,
      onInfrastructureError: infrastructureError,
      onPerformanceOperation: performance,
    });
    host.handleRendererMessage(new FakeRenderer(1), request("start"));

    process.events.emit("message", performanceOperation("stale"));
    process.events.emit("message", performanceOperation("canceled"));
    process.events.emit("message", performanceOperation("timed-out"));

    expect(performance).toHaveBeenCalledTimes(3);
    expect(infrastructureError).not.toHaveBeenCalled();
    expect(process.terminated).toBe(false);
  });

  it("reports malformed worker diagnostics as an infrastructure defect", () => {
    const process = new FakeProcess();
    const infrastructureError = vi.fn();
    const performance = vi.fn();
    const host = new GitWorkerHost({
      workerPath: "/test/git-worker.js",
      createProcess: () => process,
      onInfrastructureError: infrastructureError,
      onPerformanceOperation: performance,
    });
    host.handleRendererMessage(new FakeRenderer(1), request("start"));

    process.events.emit("message", {
      ...performanceOperation("stale"),
      metric: {
        ...performanceOperation("stale").metric,
        durationMs: -1,
      },
    });

    expect(performance).not.toHaveBeenCalled();
    expect(infrastructureError).toHaveBeenCalledTimes(1);
    expect(infrastructureError).toHaveBeenCalledWith(expect.any(Error), {
      epoch: 1,
      phase: "protocol",
    });
    expect(process.terminated).toBe(true);
  });

  it("performs a bounded cooperative shutdown", async () => {
    const process = new FakeProcess();
    const host = new GitWorkerHost({
      workerPath: "/test/git-worker.js",
      createProcess: () => process,
    });
    host.handleRendererMessage(new FakeRenderer(1), request("request-1"));
    const shutdown = host.shutdown(100);
    expect(process.sent.at(-1)).toEqual({
      type: "worker-shutdown",
      workerId: "git",
    });
    process.events.emit("exit", 0);
    await shutdown;
    expect(process.terminated).toBe(false);
  });
});
