import { createInterface } from "node:readline";
import { executeCodexWorktreeWorkerOperation } from "../codex/codex-worktree-worker-operation";
import { CodexLocalShellEnvironmentLoader } from "../codex/codex-worktree-shell-environment";
import {
  CODEX_WORKTREE_WORKER_PROTOCOL_VERSION,
  isCodexWorktreeWorkerHostMessage,
  type CodexWorktreeWorkerThreadMessage,
} from "./worktree-worker-protocol";

const hostId = process.argv[2]?.trim();
if (!hostId) throw new Error("Remote worktree worker requires an execution host id");

const active = new Map<
  string,
  {
    readonly operation: string;
    readonly controller: AbortController;
  }
>();
let shuttingDown = false;
const shellEnvironment = new CodexLocalShellEnvironmentLoader();

function post(message: CodexWorktreeWorkerThreadMessage): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function maybeExit(): void {
  if (!shuttingDown || active.size > 0) return;
  shellEnvironment.close();
  process.exitCode = 0;
  process.stdin.pause();
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on("line", (line) => {
  if (!line.trim()) return;
  let raw: unknown;
  try {
    raw = JSON.parse(line) as unknown;
  } catch {
    throw new Error("Remote worktree worker received invalid JSON");
  }
  if (!isCodexWorktreeWorkerHostMessage(raw)) {
    throw new Error("Remote worktree worker received an invalid host message");
  }
  if (raw.type === "shutdown") {
    shuttingDown = true;
    for (const request of active.values()) request.controller.abort();
    maybeExit();
    return;
  }
  if (raw.type === "cancel") {
    const request = active.get(raw.id);
    if (request?.operation === raw.operation) request.controller.abort();
    return;
  }
  if (shuttingDown) return;
  if (active.has(raw.id)) throw new Error("Remote worktree worker received a duplicate request id");
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
    loadBaseEnvironment: () => shellEnvironment.load(),
    signal: controller.signal,
    onEvent: (event) =>
      post({
        type: "event",
        id: raw.id,
        operation: raw.request.operation,
        event,
      }),
  })
    .then((success) => {
      if (controller.signal.aborted) return;
      post({
        type: "result",
        id: raw.id,
        operation: raw.request.operation,
        result: { type: "ok", success },
      });
    })
    .catch((error: unknown) => {
      post({
        type: "result",
        id: raw.id,
        operation: raw.request.operation,
        result: {
          type: "error",
          code: controller.signal.aborted ? "canceled" : "operation-failed",
          message: controller.signal.aborted
            ? "Request canceled"
            : error instanceof Error
              ? error.message
              : String(error),
          retryable: true,
        },
      });
    })
    .finally(() => {
      active.delete(raw.id);
      maybeExit();
    });
});

lines.on("close", () => {
  shuttingDown = true;
  for (const request of active.values()) request.controller.abort();
  maybeExit();
});

post({
  type: "ready",
  epoch: 1,
  hostId,
  protocolVersion: CODEX_WORKTREE_WORKER_PROTOCOL_VERSION,
});
