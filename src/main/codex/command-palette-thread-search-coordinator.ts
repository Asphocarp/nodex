import { Worker } from "node:worker_threads";
import { getLogger } from "../logging/logger";
import { getNodexHome } from "../local-store/config";
import type {
  CodexConversationSnapshot,
  CommandPaletteThreadContentSearchInput,
  CommandPaletteThreadContentSearchResult,
  CommandPaletteThreadIndexUpdatedEvent,
  CommandPaletteThreadSummary,
} from "../../shared/types";
import {
  CommandPaletteThreadSearchService,
  type CommandPaletteThreadSearchBackfillOptions,
} from "./command-palette-thread-search-service";
import type {
  ThreadSearchWorkerEvent,
  ThreadSearchWorkerMessage,
  ThreadSearchWorkerRequest,
} from "./command-palette-thread-search-worker-protocol";

const LIVE_INDEX_DEBOUNCE_MS = 500;
const SEARCH_TIMEOUT_MS = 1_500;

const logger = getLogger({ subsystem: "codex", component: "thread-search-indexer" });
type ThreadSearchWorkerRequestInput = ThreadSearchWorkerRequest extends infer Request
  ? Request extends { id: number }
    ? Omit<Request, "id">
    : never
  : never;

export interface ThreadSearchLiveSource {
  readConversation: (threadId: string) => CodexConversationSnapshot | null;
  readSummary: (
    threadId: string,
  ) => CommandPaletteThreadSummary | null | Promise<CommandPaletteThreadSummary | null>;
}

export interface CommandPaletteThreadSearchClient {
  enqueueBackfill: (
    summaries: CommandPaletteThreadSummary[],
    options?: CommandPaletteThreadSearchBackfillOptions,
  ) => void;
  search: (
    input: CommandPaletteThreadContentSearchInput,
    eligibleSummaries: CommandPaletteThreadSummary[],
  ) => Promise<CommandPaletteThreadContentSearchResult[]>;
  indexConversation: (summary: CommandPaletteThreadSummary, conversation: CodexConversationSnapshot) => void;
  removeThread: (threadId: string) => void;
  shutdown: () => void;
}

export interface CommandPaletteThreadSearchCoordinatorOptions {
  client?: CommandPaletteThreadSearchClient;
  onIndexUpdated?: (event: CommandPaletteThreadIndexUpdatedEvent) => void;
}

class WorkerThreadSearchClient implements CommandPaletteThreadSearchClient {
  private worker: Worker | null = null;
  private terminating = false;
  private nextRequestId = 1;
  private pending = new Map<number, {
    resolve: (result: CommandPaletteThreadContentSearchResult[] | undefined) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }>();

  constructor(private readonly onIndexUpdated?: (event: CommandPaletteThreadIndexUpdatedEvent) => void) {}

  enqueueBackfill(
    summaries: CommandPaletteThreadSummary[],
    options?: CommandPaletteThreadSearchBackfillOptions,
  ): void {
    if (summaries.length === 0) return;
    this.sendNoWait({
      type: "enqueueBackfill",
      payload: { summaries, options },
    });
  }

  async search(
    input: CommandPaletteThreadContentSearchInput,
    eligibleSummaries: CommandPaletteThreadSummary[],
  ): Promise<CommandPaletteThreadContentSearchResult[]> {
    const result = await this.send({
      type: "search",
      payload: {
        query: input.query,
        limit: input.limit,
        eligibleSummaries,
      },
    });
    return result ?? [];
  }

  indexConversation(summary: CommandPaletteThreadSummary, conversation: CodexConversationSnapshot): void {
    this.sendNoWait({
      type: "indexConversation",
      payload: { summary, conversation },
    });
  }

  removeThread(threadId: string): void {
    this.sendNoWait({
      type: "removeThread",
      payload: { threadId },
    });
  }

  shutdown(): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Thread search worker shut down"));
      this.pending.delete(id);
    }
    if (!this.worker) return;
    const worker = this.worker;
    this.worker = null;
    this.terminating = true;
    void worker.terminate();
  }

  private async send(
    request: ThreadSearchWorkerRequestInput,
  ): Promise<CommandPaletteThreadContentSearchResult[] | undefined> {
    const worker = this.ensureWorker();
    if (!worker) return undefined;

    const id = this.nextRequestId;
    this.nextRequestId += 1;

    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Thread search worker request timed out"));
      }, SEARCH_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timeout });
      worker.postMessage({ ...request, id });
    });
  }

  private sendNoWait(request: ThreadSearchWorkerRequestInput): void {
    void this.send(request).catch((error) => {
      logger.debug("Command palette thread search worker request skipped", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  private ensureWorker(): Worker | null {
    if (this.worker) return this.worker;

    try {
      const workerUrl = new URL("./command-palette-thread-search-worker.js", import.meta.url);
      this.worker = new Worker(workerUrl, {
        env: {
          ...process.env,
          NODEX_HOME: getNodexHome(),
        },
      });
      this.worker.on("message", (message: ThreadSearchWorkerMessage) => this.handleWorkerMessage(message));
      this.worker.on("error", (error) => {
        this.handleWorkerFailure(error instanceof Error ? error : new Error(String(error)));
      });
      this.worker.on("exit", (code) => {
        if (this.terminating) {
          this.terminating = false;
          return;
        }
        if (code !== 0) {
          this.handleWorkerFailure(new Error(`Thread search worker exited with code ${code}`));
        }
      });
      logger.info("Started command palette thread search worker");
      return this.worker;
    } catch (error) {
      logger.warn("Could not start command palette thread search worker", {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private handleWorkerMessage(message: ThreadSearchWorkerMessage): void {
    if ("type" in message) {
      this.handleWorkerEvent(message);
      return;
    }

    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timeout);
    if (message.ok) {
      pending.resolve(message.result);
      return;
    }
    pending.reject(new Error(message.error));
  }

  private handleWorkerEvent(event: ThreadSearchWorkerEvent): void {
    if (event.type === "indexUpdated") {
      this.onIndexUpdated?.(event.payload);
      return;
    }

    if (event.payload.level === "debug") {
      logger.debug(event.payload.message, event.payload.data);
      return;
    }
    if (event.payload.level === "info") {
      logger.info(event.payload.message, event.payload.data);
      return;
    }
    if (event.payload.level === "warn") {
      logger.warn(event.payload.message, event.payload.data);
      return;
    }
    logger.error(event.payload.message, event.payload.data);
  }

  private handleWorkerFailure(error: Error): void {
    logger.warn("Command palette thread search worker failed", { error: error.message });
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pending.delete(id);
    }
    this.worker = null;
  }
}

class InlineThreadSearchClient implements CommandPaletteThreadSearchClient {
  private readonly searchService: CommandPaletteThreadSearchService;

  constructor(onIndexUpdated?: (event: CommandPaletteThreadIndexUpdatedEvent) => void) {
    this.searchService = new CommandPaletteThreadSearchService({ onIndexUpdated });
  }

  enqueueBackfill(
    summaries: CommandPaletteThreadSummary[],
    options?: CommandPaletteThreadSearchBackfillOptions,
  ): void {
    this.searchService.scheduleBackfill(summaries, undefined, options);
  }

  async search(
    input: CommandPaletteThreadContentSearchInput,
    eligibleSummaries: CommandPaletteThreadSummary[],
  ): Promise<CommandPaletteThreadContentSearchResult[]> {
    return this.searchService.search({
      query: input.query,
      limit: input.limit,
    }, eligibleSummaries);
  }

  indexConversation(summary: CommandPaletteThreadSummary, conversation: CodexConversationSnapshot): void {
    this.searchService.indexConversation(summary, conversation);
  }

  removeThread(threadId: string): void {
    this.searchService.removeThread(threadId);
  }

  shutdown(): void {
    this.searchService.shutdown();
  }
}

export function createInlineCommandPaletteThreadSearchClient(
  onIndexUpdated?: (event: CommandPaletteThreadIndexUpdatedEvent) => void,
): CommandPaletteThreadSearchClient {
  return new InlineThreadSearchClient(onIndexUpdated);
}

export class CommandPaletteThreadSearchCoordinator {
  private readonly client: CommandPaletteThreadSearchClient;
  private readonly liveIndexTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(options: CommandPaletteThreadSearchCoordinatorOptions = {}) {
    this.client = options.client ?? new WorkerThreadSearchClient(options.onIndexUpdated);
  }

  shutdown(): void {
    for (const timer of this.liveIndexTimers.values()) {
      clearTimeout(timer);
    }
    this.liveIndexTimers.clear();
    this.client.shutdown();
  }

  enqueueBackfill(
    summaries: CommandPaletteThreadSummary[],
    options?: CommandPaletteThreadSearchBackfillOptions,
  ): void {
    this.client.enqueueBackfill(summaries, options);
  }

  scheduleLiveIndex(threadId: string, source: ThreadSearchLiveSource): void {
    const existing = this.liveIndexTimers.get(threadId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      void (async () => {
        this.liveIndexTimers.delete(threadId);
        const summary = await source.readSummary(threadId);
        if (!summary) {
          this.removeThread(threadId);
          return;
        }
        const conversation = source.readConversation(threadId);
        if (!conversation) return;
        this.client.indexConversation(summary, conversation);
      })().catch((error) => {
        logger.debug("Live Thread indexing skipped", {
          error: error instanceof Error ? error.message : String(error),
          threadId,
        });
      });
    }, LIVE_INDEX_DEBOUNCE_MS);

    this.liveIndexTimers.set(threadId, timer);
  }

  async search(
    input: CommandPaletteThreadContentSearchInput,
    eligibleSummaries: CommandPaletteThreadSummary[],
  ): Promise<CommandPaletteThreadContentSearchResult[]> {
    const startedAt = Date.now();
    try {
      const results = await this.client.search(input, eligibleSummaries);
      logger.debug("Completed command palette thread content search", {
        durationMs: Date.now() - startedAt,
        eligibleCount: eligibleSummaries.length,
        resultCount: results.length,
      });
      return results;
    } catch (error) {
      logger.warn("Command palette thread content search failed closed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  removeThread(threadId: string): void {
    this.client.removeThread(threadId);
  }
}
