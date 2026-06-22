import { parentPort } from "node:worker_threads";
import { closeDatabase } from "../kanban/db-service";
import { CommandPaletteThreadSearchService } from "./command-palette-thread-search-service";
import type {
  ThreadSearchWorkerMessage,
  ThreadSearchWorkerRequest,
  ThreadSearchWorkerResponse,
} from "./command-palette-thread-search-worker-protocol";

function postMessage(message: ThreadSearchWorkerMessage): void {
  parentPort?.postMessage(message);
}

function postResponse(response: ThreadSearchWorkerResponse): void {
  postMessage(response);
}

const searchService = new CommandPaletteThreadSearchService({
  onIndexUpdated: (event) => postMessage({ type: "indexUpdated", payload: event }),
  log: (level, message, data) => postMessage({ type: "log", payload: { level, message, data } }),
});

async function handleRequest(request: ThreadSearchWorkerRequest): Promise<void> {
  try {
    if (request.type === "enqueueBackfill") {
      searchService.scheduleBackfill(request.payload.summaries, undefined, request.payload.options);
      postResponse({ id: request.id, ok: true });
      return;
    }

    if (request.type === "search") {
      const results = searchService.search({
        query: request.payload.query,
        limit: request.payload.limit,
      }, request.payload.eligibleSummaries);
      postResponse({ id: request.id, ok: true, result: results });
      return;
    }

    if (request.type === "indexConversation") {
      searchService.indexConversation(request.payload.summary, request.payload.conversation);
      postResponse({ id: request.id, ok: true });
      return;
    }

    if (request.type === "removeThread") {
      searchService.removeThread(request.payload.threadId);
      postResponse({ id: request.id, ok: true });
      return;
    }

    searchService.shutdown();
    closeDatabase();
    postResponse({ id: request.id, ok: true });
  } catch (error) {
    postResponse({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

parentPort?.on("message", (message: ThreadSearchWorkerRequest) => {
  void handleRequest(message);
});
