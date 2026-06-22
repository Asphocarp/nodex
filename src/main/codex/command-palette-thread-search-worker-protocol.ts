import type {
  CodexConversationSnapshot,
  CommandPaletteThreadContentSearchResult,
  CommandPaletteThreadIndexUpdatedEvent,
  CommandPaletteThreadSummary,
} from "../../shared/types";
import type { CommandPaletteThreadSearchBackfillOptions } from "./command-palette-thread-search-service";

export interface ThreadSearchWorkerBackfillRequest {
  summaries: CommandPaletteThreadSummary[];
  options?: CommandPaletteThreadSearchBackfillOptions;
}

export interface ThreadSearchWorkerSearchRequest {
  query: string;
  limit?: number;
  eligibleSummaries: CommandPaletteThreadSummary[];
}

export interface ThreadSearchWorkerIndexConversationRequest {
  summary: CommandPaletteThreadSummary;
  conversation: CodexConversationSnapshot;
}

export type ThreadSearchWorkerRequest =
  | {
    id: number;
    type: "enqueueBackfill";
    payload: ThreadSearchWorkerBackfillRequest;
  }
  | {
    id: number;
    type: "search";
    payload: ThreadSearchWorkerSearchRequest;
  }
  | {
    id: number;
    type: "indexConversation";
    payload: ThreadSearchWorkerIndexConversationRequest;
  }
  | {
    id: number;
    type: "removeThread";
    payload: { threadId: string };
  }
  | {
    id: number;
    type: "shutdown";
  };

export type ThreadSearchWorkerResponse =
  | {
    id: number;
    ok: true;
    result?: CommandPaletteThreadContentSearchResult[];
  }
  | {
    id: number;
    ok: false;
    error: string;
  };

export type ThreadSearchWorkerEvent =
  | {
    type: "indexUpdated";
    payload: CommandPaletteThreadIndexUpdatedEvent;
  }
  | {
    type: "log";
    payload: {
      level: "debug" | "info" | "warn" | "error";
      message: string;
      data?: Record<string, unknown>;
    };
  };

export type ThreadSearchWorkerMessage = ThreadSearchWorkerResponse | ThreadSearchWorkerEvent;
