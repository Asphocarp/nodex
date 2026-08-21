import { describe, expect, it, vi } from "vite-plus/test";
import {
  GIT_WORKER_PROTOCOL_VERSION,
  type GitWorkerMessageForView,
  type GitWorkerMessageFromView,
} from "../../shared/git-worker-protocol";
import {
  GitWorkerClient,
  GitWorkerTransportError,
  type GitWorkerClientBridge,
} from "./git-worker-client";

class FakeBridge implements GitWorkerClientBridge {
  readonly sent: GitWorkerMessageFromView[] = [];
  listener: ((message: GitWorkerMessageForView) => void) | null = null;

  async send(message: GitWorkerMessageFromView): Promise<void> {
    this.sent.push(message);
  }

  subscribe(listener: (message: GitWorkerMessageForView) => void): () => void {
    this.listener = listener;
    return () => {
      this.listener = null;
    };
  }

  emit(message: GitWorkerMessageForView): void {
    this.listener?.(message);
  }
}

describe("GitWorkerClient", () => {
  it("correlates typed responses and lifecycle events", async () => {
    const bridge = new FakeBridge();
    const client = new GitWorkerClient(bridge, {
      createRequestId: () => "request-1",
    });
    const onEvent = vi.fn();
    client.subscribe(onEvent);

    const result = client.request({
      method: "probe",
      params: { nonce: "hello" },
    });
    expect(bridge.sent).toHaveLength(1);
    bridge.emit({
      type: "worker-response",
      workerId: "git",
      id: "request-1",
      method: "probe",
      result: {
        type: "ok",
        value: {
          nonce: "hello",
          protocolVersion: GIT_WORKER_PROTOCOL_VERSION,
        },
      },
    });
    await expect(result).resolves.toEqual({
      nonce: "hello",
      protocolVersion: GIT_WORKER_PROTOCOL_VERSION,
    });

    bridge.emit({
      type: "worker-restarted",
      workerId: "git",
      epoch: 2,
    });
    expect(onEvent).toHaveBeenCalledWith({
      type: "worker-restarted",
      workerId: "git",
      epoch: 2,
    });
    bridge.emit({
      type: "git-live-query-event",
      workerId: "git",
      event: {
        type: "git-live-query-updated",
        subscriptionId: "subscription-1",
        generation: 1,
        requiresRecovery: false,
        phase: "complete",
        method: "base-branch",
        result: {
          cwd: "/repo",
          local: "main",
          remote: "origin/main",
          errorMessage: null,
        },
      },
    });
    expect(onEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: "git-live-query-event",
      }),
    );
    client.dispose();
  });

  it("cancels the host request when its final consumer aborts", async () => {
    const bridge = new FakeBridge();
    const client = new GitWorkerClient(bridge, {
      createRequestId: () => "request-2",
    });
    const controller = new AbortController();
    const result = client.request({
      method: "probe",
      params: { nonce: "slow" },
      signal: controller.signal,
    });

    controller.abort();

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(bridge.sent).toEqual([
      expect.objectContaining({ type: "worker-request" }),
      {
        type: "worker-request-cancel",
        workerId: "git",
        id: "request-2",
      },
    ]);
    client.dispose();
  });

  it("preserves structured infrastructure failures", async () => {
    const bridge = new FakeBridge();
    const client = new GitWorkerClient(bridge, {
      createRequestId: () => "request-3",
    });
    const result = client.request({
      method: "probe",
      params: { nonce: "hello" },
    });
    bridge.emit({
      type: "worker-response",
      workerId: "git",
      id: "request-3",
      method: "probe",
      result: {
        type: "error",
        error: {
          code: "worker-unavailable",
          message: "worker crashed",
        },
      },
    });

    await expect(result).rejects.toEqual(
      new GitWorkerTransportError("worker-unavailable", "worker crashed"),
    );
    client.dispose();
  });
});
