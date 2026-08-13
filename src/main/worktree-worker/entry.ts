import { parentPort, workerData } from "node:worker_threads";
import { executeCodexWorktreeWorkerOperation } from "../codex/codex-worktree-worker-operation";
import {
  CODEX_WORKTREE_WORKER_PROTOCOL_VERSION,
  isCodexWorktreeWorkerHostMessage,
  type CodexWorktreeWorkerThreadMessage,
} from "./worktree-worker-protocol";

const port = (() => {
  if (!parentPort) throw new Error("Worktree worker requires a parent message port");
  return parentPort;
})();
const data = workerData as { epoch?: unknown; hostId?: unknown } | undefined;
const epoch = typeof data?.epoch === "number" ? data.epoch : 1;
const hostId = typeof data?.hostId === "string" && data.hostId.trim()
  ? data.hostId.trim()
  : "local";
const active = new Map<string, {
  readonly operation: string;
  readonly controller: AbortController;
}>();

function post(message: CodexWorktreeWorkerThreadMessage): void {
  port.postMessage(message);
}

port.on("message", (raw: unknown) => {
  if (!isCodexWorktreeWorkerHostMessage(raw)) {
    throw new Error("Worktree worker received an invalid host message");
  }
  if (raw.type === "shutdown") {
    for (const request of active.values()) request.controller.abort();
    active.clear();
    port.close();
    return;
  }
  if (raw.type === "cancel") {
    const request = active.get(raw.id);
    if (request?.operation === raw.operation) request.controller.abort();
    return;
  }
  if (active.has(raw.id)) {
    throw new Error("Worktree worker received a duplicate request id");
  }
  if (raw.request.input.hostId !== hostId) {
    post({
      type: "result",
      id: raw.id,
      operation: raw.request.operation,
      result: {
        type: "error",
        code: "invalid-request",
        message: "Worktree request does not belong to this execution host",
        retryable: false,
      },
    });
    return;
  }

  const controller = new AbortController();
  active.set(raw.id, { operation: raw.request.operation, controller });
  void executeCodexWorktreeWorkerOperation(raw.request, {
    signal: controller.signal,
    onEvent: (event) => post({
      type: "event",
      id: raw.id,
      operation: raw.request.operation,
      event,
    }),
  }).then((success) => {
    if (controller.signal.aborted) return;
    post({
      type: "result",
      id: raw.id,
      operation: raw.request.operation,
      result: { type: "ok", success },
    });
  }).catch((error: unknown) => {
    if (controller.signal.aborted) return;
    post({
      type: "result",
      id: raw.id,
      operation: raw.request.operation,
      result: {
        type: "error",
        code: "operation-failed",
        message: error instanceof Error ? error.message : String(error),
        retryable: true,
      },
    });
  }).finally(() => {
    active.delete(raw.id);
  });
});

post({
  type: "ready",
  epoch,
  hostId,
  protocolVersion: CODEX_WORKTREE_WORKER_PROTOCOL_VERSION,
});
