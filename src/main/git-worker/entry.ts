import { parentPort, workerData } from "node:worker_threads";
import {
  GIT_WORKER_PROTOCOL_VERSION,
  isGitWorkerMessageFromHost,
  type GitWorkerResponse,
  type GitWorkerMessageFromThread,
} from "../../shared/git-worker-protocol";
import { GitWorkerModule } from "./git-worker-module";

interface GitWorkerEntryData {
  epoch?: unknown;
}

const port = (() => {
  if (!parentPort) {
    throw new Error("Git worker requires a parent message port");
  }
  return parentPort;
})();

const entryData = workerData as GitWorkerEntryData | undefined;
const epoch =
  typeof entryData?.epoch === "number" && Number.isInteger(entryData.epoch) && entryData.epoch >= 1
    ? entryData.epoch
    : 1;

const activeRequests = new Map<string, AbortController>();

function postMessage(message: GitWorkerMessageFromThread): void {
  port.postMessage(message);
}

const module = new GitWorkerModule({ publish: postMessage });

port.on("message", (rawMessage: unknown) => {
  if (!isGitWorkerMessageFromHost(rawMessage)) {
    throw new Error("Git worker received an invalid host message");
  }
  if (rawMessage.type === "worker-shutdown") {
    for (const controller of activeRequests.values()) controller.abort();
    activeRequests.clear();
    module.dispose();
    port.close();
    return;
  }
  if (rawMessage.type === "worker-request-cancel") {
    activeRequests.get(rawMessage.id)?.abort();
    activeRequests.delete(rawMessage.id);
    return;
  }

  const { request } = rawMessage;
  if (activeRequests.has(request.id)) {
    throw new Error("Git worker received a duplicate active request id");
  }
  const controller = new AbortController();
  activeRequests.set(request.id, controller);
  void module
    .execute(request, controller.signal)
    .then((value) => {
      if (controller.signal.aborted) return;
      postMessage({
        type: "worker-response",
        workerId: "git",
        id: request.id,
        method: request.method,
        result: { type: "ok", value },
      } as GitWorkerResponse);
    })
    .catch((error: unknown) => {
      if (controller.signal.aborted) return;
      queueMicrotask(() => {
        throw error;
      });
    })
    .finally(() => {
      if (activeRequests.get(request.id) === controller) {
        activeRequests.delete(request.id);
      }
    });
});

postMessage({
  type: "worker-ready",
  workerId: "git",
  epoch,
  protocolVersion: GIT_WORKER_PROTOCOL_VERSION,
});
