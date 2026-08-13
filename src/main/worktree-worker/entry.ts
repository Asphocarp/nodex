import { parentPort, workerData } from "node:worker_threads";
import { executeCodexWorktreeWorkerCreate } from "../codex/codex-worktree-worker-operation";
import { removeManagedWorktree } from "../codex/git-worktree-service";
import {
  CODEX_WORKTREE_WORKER_PROTOCOL_VERSION,
  isCodexWorktreeWorkerHostMessage,
  type CodexWorktreeWorkerThreadMessage,
} from "./worktree-worker-protocol";

const port = (() => {
  if (!parentPort) throw new Error("Worktree worker requires a parent message port");
  return parentPort;
})();
const epoch = typeof (workerData as { epoch?: unknown } | undefined)?.epoch === "number"
  ? (workerData as { epoch: number }).epoch
  : 1;
const active = new Map<string, AbortController>();

function post(message: CodexWorktreeWorkerThreadMessage): void {
  port.postMessage(message);
}

port.on("message", (raw: unknown) => {
  if (!isCodexWorktreeWorkerHostMessage(raw)) {
    throw new Error("Worktree worker received an invalid host message");
  }
  if (raw.type === "shutdown") {
    for (const controller of active.values()) controller.abort();
    active.clear();
    port.close();
    return;
  }
  if (raw.type === "cancel") {
    active.get(raw.id)?.abort();
    return;
  }
  if (active.has(raw.id)) {
    throw new Error("Worktree worker received a duplicate request id");
  }
  const controller = new AbortController();
  active.set(raw.id, controller);
  const operation = raw.type === "remove"
    ? removeManagedWorktree(raw.worktreeGitRoot).then(() => null)
    : executeCodexWorktreeWorkerCreate(raw.input, {
        signal: controller.signal,
        onEvent: (event) => post({ type: "event", id: raw.id, event }),
      });
  void operation.then((value) => {
    if (controller.signal.aborted) return;
    post({ type: "result", id: raw.id, result: { type: "ok", value } });
  }).catch((error: unknown) => {
    if (controller.signal.aborted) return;
    post({
      type: "result",
      id: raw.id,
      result: {
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }).finally(() => {
    active.delete(raw.id);
  });
});

post({
  type: "ready",
  epoch,
  protocolVersion: CODEX_WORKTREE_WORKER_PROTOCOL_VERSION,
});
