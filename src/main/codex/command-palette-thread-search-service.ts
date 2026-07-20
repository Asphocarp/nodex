import { createHash } from "node:crypto";
import { getDb } from "../local-store/database";
import type {
  CodexConversationSnapshot,
  CodexThreadDetail,
  CommandPaletteThreadContentSearchResult,
  CommandPaletteThreadIndexUpdatedEvent,
  CommandPaletteThreadSummary,
} from "../../shared/types";
import {
  buildThreadContentFtsMatchQuery,
  extractThreadSearchUnitsFromConversation,
  extractThreadSearchUnitsFromDetail,
  getThreadContentFtsMarkers,
  parseMarkedSnippetSegments,
  type ThreadSearchUnit,
} from "./command-palette-thread-search-helpers";
import { readThreadSearchUnitsFromSession } from "./command-palette-thread-search-session-reader";

export const THREAD_SEARCH_INDEX_VERSION = 2;
const DEFAULT_CONTENT_SEARCH_LIMIT = 60;
const MAX_CONTENT_SEARCH_LIMIT = 60;
const FTS_SEARCH_CHUNK_SIZE = 450;
const FTS_CANDIDATE_MULTIPLIER = 8;
const FTS_SNIPPET_TOKENS = 32;
const BACKFILL_CHUNK_SIZE = 2;
const BACKFILL_SLICE_BUDGET_MS = 50;
const BACKFILL_DELAY_MS = 250;
const INDEX_UPDATED_THROTTLE_MS = 1_000;
const LIVE_INDEX_DEBOUNCE_MS = 500;
const FAILED_BACKFILL_RETRY_MS = 5 * 60 * 1000;

interface ThreadSearchStateRow {
  source_updated_at: number;
  status: string;
  index_version: number | null;
  retry_after: number | null;
}

interface ThreadSearchFtsRow {
  thread_id: string;
  snippet: string;
  rank: number;
}

export interface ThreadSearchBackfillSource {
  readThreadDetail: (threadId: string) => CodexThreadDetail | null;
}

export interface ThreadSearchLiveSource {
  readConversation: (threadId: string) => CodexConversationSnapshot | null;
  readSummary: (
    threadId: string,
  ) => CommandPaletteThreadSummary | null | Promise<CommandPaletteThreadSummary | null>;
}

export interface CommandPaletteThreadSearchServiceOptions {
  onIndexUpdated?: (event: CommandPaletteThreadIndexUpdatedEvent) => void;
  log?: (level: "debug" | "info" | "warn" | "error", message: string, data?: Record<string, unknown>) => void;
}

export interface CommandPaletteThreadSearchBackfillOptions {
  force?: boolean;
}

function clampContentSearchLimit(limit: number | undefined): number {
  return Math.max(
    1,
    Math.min(
      MAX_CONTENT_SEARCH_LIMIT,
      Math.trunc(limit ?? DEFAULT_CONTENT_SEARCH_LIMIT),
    ),
  );
}

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function normalizeSnippetText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function uniqueThreadIds(summaries: CommandPaletteThreadSummary[]): string[] {
  return Array.from(new Set(summaries.map((summary) => summary.threadId)));
}

function chunkValues<T>(values: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }
  return chunks;
}

function compareBackfillSummaries(
  left: CommandPaletteThreadSummary,
  right: CommandPaletteThreadSummary,
): number {
  if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
  const leftPinnedOrder = left.pinnedOrder ?? Number.MAX_SAFE_INTEGER;
  const rightPinnedOrder = right.pinnedOrder ?? Number.MAX_SAFE_INTEGER;
  if (leftPinnedOrder !== rightPinnedOrder) return leftPinnedOrder - rightPinnedOrder;
  if (right.updatedAt !== left.updatedAt) return right.updatedAt - left.updatedAt;
  return left.threadId.localeCompare(right.threadId);
}

export class CommandPaletteThreadSearchService {
  private generation = 0;
  private backfillQueue: CommandPaletteThreadSummary[] = [];
  private queuedBackfillThreadIds = new Set<string>();
  private processingBackfillThreadIds = new Set<string>();
  private backfillTimer: ReturnType<typeof setTimeout> | null = null;
  private liveIndexTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private indexUpdatedTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingIndexUpdated = false;
  private lastIndexUpdatedAt = 0;

  constructor(private readonly options: CommandPaletteThreadSearchServiceOptions = {}) {}

  shutdown(): void {
    if (this.backfillTimer !== null) {
      clearTimeout(this.backfillTimer);
      this.backfillTimer = null;
    }
    if (this.indexUpdatedTimer !== null) {
      clearTimeout(this.indexUpdatedTimer);
      this.indexUpdatedTimer = null;
    }
    this.backfillQueue = [];
    this.queuedBackfillThreadIds.clear();
    this.processingBackfillThreadIds.clear();
    this.pendingIndexUpdated = false;
    for (const timer of this.liveIndexTimers.values()) {
      clearTimeout(timer);
    }
    this.liveIndexTimers.clear();
  }

  scheduleBackfill(
    summaries: CommandPaletteThreadSummary[],
    source?: ThreadSearchBackfillSource,
    options: CommandPaletteThreadSearchBackfillOptions = {},
  ): void {
    const staleSummaries = summaries.filter((summary) => this.isThreadIndexStale(summary, options));
    for (const summary of staleSummaries) {
      if (this.queuedBackfillThreadIds.has(summary.threadId)) continue;
      if (this.processingBackfillThreadIds.has(summary.threadId)) continue;
      this.queuedBackfillThreadIds.add(summary.threadId);
      this.backfillQueue.push(summary);
    }

    this.backfillQueue.sort(compareBackfillSummaries);
    this.scheduleBackfillTick(source);
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
        this.indexConversation(summary, conversation);
      })().catch((error) => {
        this.options.log?.("debug", "Live Thread indexing skipped", {
          error: error instanceof Error ? error.message : String(error),
          threadId,
        });
      });
    }, LIVE_INDEX_DEBOUNCE_MS);

    this.liveIndexTimers.set(threadId, timer);
  }

  indexConversation(
    summary: CommandPaletteThreadSummary,
    conversation: CodexConversationSnapshot,
  ): void {
    if (this.replaceThreadUnits(summary, extractThreadSearchUnitsFromConversation(conversation))) {
      this.markContentIndexChanged();
    }
  }

  indexThreadDetail(
    summary: CommandPaletteThreadSummary,
    detail: CodexThreadDetail,
  ): void {
    if (this.replaceThreadUnits(summary, extractThreadSearchUnitsFromDetail(detail))) {
      this.markContentIndexChanged();
    }
  }

  removeThread(threadId: string): void {
    const unitsDeleted = getDb().prepare("DELETE FROM thread_search_units WHERE thread_id = ?").run(threadId).changes;
    const statesDeleted = getDb().prepare("DELETE FROM thread_search_thread_state WHERE thread_id = ?").run(threadId).changes;
    if (unitsDeleted > 0 || statesDeleted > 0) {
      this.markContentIndexChanged();
    }
  }

  search(
    input: {
      query: string;
      limit?: number;
    },
    eligibleSummaries: CommandPaletteThreadSummary[],
  ): CommandPaletteThreadContentSearchResult[] {
    const query = input.query.trim();
    if (query.length < 2) return [];

    const limit = clampContentSearchLimit(input.limit);
    const eligibleThreadIds = uniqueThreadIds(eligibleSummaries);
    if (eligibleThreadIds.length === 0) return [];

    try {
      return this.searchFts(query, eligibleThreadIds, limit);
    } catch {
      // Content search is supplemental; metadata search should keep working.
      return [];
    }
  }

  private scheduleBackfillTick(source?: ThreadSearchBackfillSource): void {
    if (this.backfillTimer !== null || this.backfillQueue.length === 0) return;

    this.backfillTimer = setTimeout(() => {
      this.backfillTimer = null;
      void this.runBackfillBatch(source);
    }, BACKFILL_DELAY_MS);
  }

  private async runBackfillBatch(source?: ThreadSearchBackfillSource): Promise<void> {
    const sliceStartedAt = Date.now();
    let processedCount = 0;

    while (this.backfillQueue.length > 0 && processedCount < BACKFILL_CHUNK_SIZE) {
      if (processedCount > 0 && Date.now() - sliceStartedAt >= BACKFILL_SLICE_BUDGET_MS) break;

      const summary = this.backfillQueue.shift();
      if (!summary) break;
      this.processingBackfillThreadIds.add(summary.threadId);
      try {
        if (!this.isThreadIndexStale(summary)) continue;
        const startedAt = Date.now();
        const units = source
          ? extractThreadSearchUnitsFromDetail(source.readThreadDetail(summary.threadId))
          : await readThreadSearchUnitsFromSession(summary.threadId, summary.updatedAt);
        if (!units) {
          this.markThreadIndexFailed(summary, "Session transcript is not materialized");
          continue;
        }
        if (this.replaceThreadUnits(summary, units)) {
          this.markContentIndexChanged();
        }
        this.log("debug", "Indexed command palette thread search units", {
          threadId: summary.threadId,
          unitCount: units.length,
          durationMs: Date.now() - startedAt,
        });
      } catch (error) {
        this.markThreadIndexFailed(summary, error instanceof Error ? error.message : String(error));
      } finally {
        this.processingBackfillThreadIds.delete(summary.threadId);
        this.queuedBackfillThreadIds.delete(summary.threadId);
        processedCount += 1;
      }
    }

    if (this.backfillQueue.length === 0) {
      this.flushPendingIndexUpdated();
      return;
    }
    this.scheduleBackfillTick(source);
  }

  private isThreadIndexStale(
    summary: CommandPaletteThreadSummary,
    options: CommandPaletteThreadSearchBackfillOptions = {},
  ): boolean {
    if (options.force) return true;
    const row = getDb().prepare(`
      SELECT source_updated_at, status, index_version, retry_after
      FROM thread_search_thread_state
      WHERE thread_id = ?
    `).get(summary.threadId) as ThreadSearchStateRow | undefined;

    if (!row) return true;
    if (row.status === "failed" && row.retry_after !== null && row.retry_after > Date.now()) return false;
    return row.status !== "ready"
      || row.source_updated_at < summary.updatedAt
      || row.index_version !== THREAD_SEARCH_INDEX_VERSION;
  }

  private replaceThreadUnits(
    summary: CommandPaletteThreadSummary,
    units: ThreadSearchUnit[],
  ): boolean {
    const now = Date.now();
    const database = getDb();
    let changedUnits = 0;
    const replace = database.transaction(() => {
      const currentRows = database.prepare(`
        SELECT unit_key
        FROM thread_search_units
        WHERE thread_id = ?
      `).all(summary.threadId) as Array<{ unit_key: string }>;
      const nextKeys = new Set(units.map((unit) => unit.unitKey));

      const deleteUnit = database.prepare("DELETE FROM thread_search_units WHERE unit_key = ?");
      for (const row of currentRows) {
        if (nextKeys.has(row.unit_key)) continue;
        changedUnits += deleteUnit.run(row.unit_key).changes;
      }

      const upsertUnit = database.prepare(`
        INSERT INTO thread_search_units (
          unit_key,
          thread_id,
          project_id,
          session_id,
          turn_id,
          item_id,
          role,
          text,
          text_hash,
          source_updated_at,
          indexed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(unit_key) DO UPDATE SET
          project_id = excluded.project_id,
          session_id = excluded.session_id,
          turn_id = excluded.turn_id,
          item_id = excluded.item_id,
          role = excluded.role,
          text = excluded.text,
          text_hash = excluded.text_hash,
          source_updated_at = excluded.source_updated_at,
          indexed_at = excluded.indexed_at
        WHERE
          thread_search_units.project_id IS NOT excluded.project_id OR
          thread_search_units.session_id IS NOT excluded.session_id OR
          thread_search_units.turn_id IS NOT excluded.turn_id OR
          thread_search_units.item_id IS NOT excluded.item_id OR
          thread_search_units.role IS NOT excluded.role OR
          thread_search_units.text_hash IS NOT excluded.text_hash OR
          thread_search_units.source_updated_at IS NOT excluded.source_updated_at
      `);

      for (const unit of units) {
        changedUnits += upsertUnit.run(
          unit.unitKey,
          unit.threadId,
          summary.projectId,
          summary.sessionId,
          unit.turnId,
          unit.itemId,
          unit.role,
          unit.text,
          hashText(unit.text),
          summary.updatedAt,
          now,
        ).changes;
      }

      database.prepare(`
        INSERT INTO thread_search_thread_state (
          thread_id,
          source_updated_at,
          indexed_at,
          index_version,
          unit_count,
          status,
          last_error,
          failed_at,
          retry_after
        ) VALUES (?, ?, ?, ?, ?, 'ready', NULL, NULL, NULL)
        ON CONFLICT(thread_id) DO UPDATE SET
          source_updated_at = excluded.source_updated_at,
          indexed_at = excluded.indexed_at,
          index_version = excluded.index_version,
          unit_count = excluded.unit_count,
          status = excluded.status,
          last_error = excluded.last_error,
          failed_at = excluded.failed_at,
          retry_after = excluded.retry_after
      `).run(summary.threadId, summary.updatedAt, now, THREAD_SEARCH_INDEX_VERSION, units.length);
    });

    replace();
    return changedUnits > 0;
  }

  private markThreadIndexFailed(summary: CommandPaletteThreadSummary, errorMessage: string): void {
    const now = Date.now();
    getDb().prepare(`
      INSERT INTO thread_search_thread_state (
        thread_id,
        source_updated_at,
        indexed_at,
        index_version,
        unit_count,
        status,
        last_error,
        failed_at,
        retry_after
      ) VALUES (?, ?, ?, ?, 0, 'failed', ?, ?, ?)
      ON CONFLICT(thread_id) DO UPDATE SET
        source_updated_at = excluded.source_updated_at,
        indexed_at = excluded.indexed_at,
        index_version = excluded.index_version,
        unit_count = excluded.unit_count,
        status = excluded.status,
        last_error = excluded.last_error,
        failed_at = excluded.failed_at,
        retry_after = excluded.retry_after
    `).run(
      summary.threadId,
      summary.updatedAt,
      now,
      THREAD_SEARCH_INDEX_VERSION,
      errorMessage.slice(0, 500),
      now,
      now + FAILED_BACKFILL_RETRY_MS,
    );
    this.log("debug", "Command palette thread search backfill failed", {
      threadId: summary.threadId,
      error: errorMessage,
    });
  }

  private searchFts(
    query: string,
    eligibleThreadIds: string[],
    limit: number,
  ): CommandPaletteThreadContentSearchResult[] {
    const matchQuery = buildThreadContentFtsMatchQuery(query);
    if (!matchQuery) return [];

    const markers = getThreadContentFtsMarkers();
    const rows: ThreadSearchFtsRow[] = [];
    for (const chunk of chunkValues(eligibleThreadIds, FTS_SEARCH_CHUNK_SIZE)) {
      const placeholders = chunk.map(() => "?").join(", ");
      rows.push(...getDb().prepare(`
        SELECT
          u.thread_id,
          snippet(thread_search_units_fts, 0, ?, ?, '…', ?) AS snippet,
          bm25(thread_search_units_fts) AS rank
        FROM thread_search_units_fts
        JOIN thread_search_units u ON u.rowid = thread_search_units_fts.rowid
        WHERE thread_search_units_fts MATCH ?
          AND u.thread_id IN (${placeholders})
        ORDER BY rank ASC
        LIMIT ?
      `).all(
        markers.start,
        markers.end,
        FTS_SNIPPET_TOKENS,
        matchQuery,
        ...chunk,
        Math.max(limit * FTS_CANDIDATE_MULTIPLIER, limit),
      ) as ThreadSearchFtsRow[]);
    }

    rows.sort((left, right) => left.rank - right.rank);
    const byThread = new Map<string, CommandPaletteThreadContentSearchResult>();
    for (const row of rows) {
      if (byThread.has(row.thread_id)) continue;
      const snippet = normalizeSnippetText(row.snippet);
      if (!snippet) continue;
      byThread.set(row.thread_id, {
        threadId: row.thread_id,
        snippet: snippet.replaceAll(markers.start, "").replaceAll(markers.end, ""),
        score: 2_000_000 - byThread.size,
        matchKind: "fts",
        snippetSegments: parseMarkedSnippetSegments(snippet, markers),
      });
      if (byThread.size >= limit) break;
    }

    return Array.from(byThread.values());
  }

  private markContentIndexChanged(): void {
    this.generation += 1;
    this.emitIndexUpdatedThrottled();
  }

  private emitIndexUpdatedThrottled(): void {
    const now = Date.now();
    const elapsed = now - this.lastIndexUpdatedAt;
    if (elapsed >= INDEX_UPDATED_THROTTLE_MS && this.indexUpdatedTimer === null) {
      this.lastIndexUpdatedAt = now;
      this.emitIndexUpdated("backfill");
      return;
    }

    this.pendingIndexUpdated = true;
    if (this.indexUpdatedTimer !== null) return;

    this.indexUpdatedTimer = setTimeout(() => {
      this.indexUpdatedTimer = null;
      if (!this.pendingIndexUpdated) return;
      this.pendingIndexUpdated = false;
      this.lastIndexUpdatedAt = Date.now();
      this.emitIndexUpdated("backfill");
    }, Math.max(0, INDEX_UPDATED_THROTTLE_MS - elapsed));
  }

  private flushPendingIndexUpdated(): void {
    if (this.indexUpdatedTimer !== null) {
      clearTimeout(this.indexUpdatedTimer);
      this.indexUpdatedTimer = null;
    }
    if (!this.pendingIndexUpdated) return;
    this.pendingIndexUpdated = false;
    this.lastIndexUpdatedAt = Date.now();
    this.emitIndexUpdated("backfill");
  }

  private emitIndexUpdated(reason: CommandPaletteThreadIndexUpdatedEvent["reason"]): void {
    this.options.onIndexUpdated?.({
      generation: this.generation,
      reason,
    });
  }

  private log(level: "debug" | "info" | "warn" | "error", message: string, data?: Record<string, unknown>): void {
    this.options.log?.(level, message, data);
  }
}
