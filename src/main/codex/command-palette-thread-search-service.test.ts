import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CodexThreadDetail, CommandPaletteThreadSummary } from "../../shared/types";
import { closeDatabase, getDb, initializeDatabase } from "../local-store/database";
import { upsertCodexThread } from "./codex-link-repository";
import { CommandPaletteThreadSearchService } from "./command-palette-thread-search-service";
import {
  readThreadSearchUnitsFromSession,
  resetThreadSearchSessionReaderCachesForTests,
} from "./command-palette-thread-search-session-reader";

function isUnsupportedSqliteError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("better-sqlite3") && message.includes("not yet supported");
}

async function withTempDatabase(run: () => Promise<void>): Promise<boolean> {
  closeDatabase();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-thread-search-service-"));
  process.env.NODEX_DIR = tempDir;

  try {
    await initializeDatabase();
  } catch (error) {
    if (isUnsupportedSqliteError(error)) {
      closeDatabase();
      fs.rmSync(tempDir, { recursive: true, force: true });
      delete process.env.NODEX_DIR;
      return false;
    }
    throw error;
  }

  try {
    await run();
    return true;
  } finally {
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.NODEX_DIR;
  }
}

function makeSummary(
  threadId: string,
  overrides: Partial<CommandPaletteThreadSummary> = {},
): CommandPaletteThreadSummary {
  return {
    threadId,
    sessionId: null,
    projectId: null,
    projectName: null,
    title: "Searchable thread",
    preview: "",
    cwd: null,
    projectless: true,
    pinned: false,
    pinnedOrder: null,
    statusType: "notLoaded",
    statusActiveFlags: [],
    createdAt: 1,
    updatedAt: 2,
    linkedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeDetail(threadId: string, markdownText: string): CodexThreadDetail {
  return {
    ...upsertCodexThread({
      threadId,
      threadName: "Searchable thread",
      threadPreview: "",
      modelProvider: "openai",
      updatedAt: 2,
    }),
    turns: [],
    transcript: [{
      threadId,
      turnId: "turn_1",
      itemId: "item_1",
      type: "userMessage",
      kind: "userMessage",
      role: "user",
      markdownText,
      createdAt: 1,
      updatedAt: 2,
    }],
  };
}

describe("command palette thread search service", () => {
  test("returns FTS results without content fuzzy indexing", async () => {
    const ran = await withTempDatabase(async () => {
      const service = new CommandPaletteThreadSearchService();
      try {
        const summary = makeSummary("thr_fts_ready");
        service.indexThreadDetail(summary, makeDetail(summary.threadId, "needle phrase in transcript"));

        const results = service.search({
          query: "needle",
          limit: 10,
        }, [summary]);

        expect(results.length).toBe(1);
        expect(results[0]?.threadId).toBe("thr_fts_ready");
        expect(results[0]?.matchKind).toBe("fts");
      } finally {
        service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("treats older search index versions as stale", async () => {
    const ran = await withTempDatabase(async () => {
      const summary = makeSummary("thr_stale_version");
      const service = new CommandPaletteThreadSearchService();
      try {
        service.indexThreadDetail(summary, makeDetail(summary.threadId, "versioned content"));
        getDb().prepare(`
          UPDATE thread_search_thread_state
          SET index_version = 0
          WHERE thread_id = ?
        `).run(summary.threadId);

        let backfilled = false;
        service.scheduleBackfill([summary], {
          readThreadDetail: () => {
            backfilled = true;
            return makeDetail(summary.threadId, "versioned content");
          },
        });
        await new Promise((resolve) => setTimeout(resolve, 320));

        expect(backfilled).toBeTrue();
      } finally {
        service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("processes backfill recent-first in bounded slices", async () => {
    const ran = await withTempDatabase(async () => {
      const service = new CommandPaletteThreadSearchService();
      const processedThreadIds: string[] = [];
      try {
        const oldSummary = makeSummary("thr_backfill_old", { updatedAt: 10 });
        const recentSummary = makeSummary("thr_backfill_recent", { updatedAt: 30 });
        const pinnedSummary = makeSummary("thr_backfill_pinned", {
          pinned: true,
          pinnedOrder: 0,
          updatedAt: 20,
        });

        service.scheduleBackfill([
          oldSummary,
          recentSummary,
          pinnedSummary,
          recentSummary,
        ], {
          readThreadDetail: (threadId) => {
            processedThreadIds.push(threadId);
            return makeDetail(threadId, `content for ${threadId}`);
          },
        });

        await new Promise((resolve) => setTimeout(resolve, 320));
        expect(processedThreadIds.join(",")).toBe("thr_backfill_pinned,thr_backfill_recent");

        await new Promise((resolve) => setTimeout(resolve, 320));
        expect(processedThreadIds.join(",")).toBe("thr_backfill_pinned,thr_backfill_recent,thr_backfill_old");
      } finally {
        service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });

  test("does not update unchanged search units", async () => {
    const ran = await withTempDatabase(async () => {
      const service = new CommandPaletteThreadSearchService();
      try {
        const summary = makeSummary("thr_unchanged_units");
        service.indexThreadDetail(summary, makeDetail(summary.threadId, "oldneedle transcript"));
        const firstIndexedAt = (getDb().prepare(`
          SELECT indexed_at
          FROM thread_search_units
          WHERE thread_id = ?
        `).get(summary.threadId) as { indexed_at: number } | undefined)?.indexed_at ?? 0;

        await new Promise((resolve) => setTimeout(resolve, 10));
        service.indexThreadDetail(summary, makeDetail(summary.threadId, "oldneedle transcript"));
        const secondIndexedAt = (getDb().prepare(`
          SELECT indexed_at
          FROM thread_search_units
          WHERE thread_id = ?
        `).get(summary.threadId) as { indexed_at: number } | undefined)?.indexed_at ?? 0;

        expect(secondIndexedAt).toBe(firstIndexedAt);

        await new Promise((resolve) => setTimeout(resolve, 10));
        service.indexThreadDetail(summary, makeDetail(summary.threadId, "newneedle transcript"));
        const oldHits = service.search({ query: "oldneedle", limit: 10 }, [summary]);
        const newHits = service.search({ query: "newneedle", limit: 10 }, [summary]);

        expect(oldHits.length).toBe(0);
        expect(newHits.length).toBe(1);
      } finally {
        service.shutdown();
      }
    });

    if (!ran) expect(true).toBeTrue();
  });
});

describe("command palette thread search session reader", () => {
  test("streams visible user and assistant rollout units only", async () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "nodex-thread-search-home-"));
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = tempHome;
    resetThreadSearchSessionReaderCachesForTests();

    try {
      const sessionDir = path.join(tempHome, "sessions", "2026", "06", "22");
      fs.mkdirSync(sessionDir, { recursive: true });
      fs.writeFileSync(
        path.join(sessionDir, "rollout-thr_reader.jsonl"),
        [
          JSON.stringify({ type: "turn_context", payload: { turn_id: "turn_a" } }),
          JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "visible user" } }),
          JSON.stringify({ type: "event_msg", payload: { type: "agent_message", message: "visible assistant" } }),
          JSON.stringify({ type: "event_msg", payload: { type: "agent_reasoning", text: "hidden reasoning" } }),
          "",
        ].join("\n"),
      );

      const units = await readThreadSearchUnitsFromSession("thr_reader", 1);
      const text = (units ?? []).map((unit) => unit.text).join("\n");

      expect(units?.length ?? 0).toBe(2);
      expect(text.includes("visible user")).toBeTrue();
      expect(text.includes("visible assistant")).toBeTrue();
      expect(text.includes("hidden reasoning")).toBeFalse();
    } finally {
      resetThreadSearchSessionReaderCachesForTests();
      if (previousCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = previousCodexHome;
      }
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
  });
});
