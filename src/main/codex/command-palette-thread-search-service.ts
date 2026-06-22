import MiniSearch, { type Options, type SearchResult } from "minisearch";
import { createHash } from "node:crypto";
import { getDb } from "../kanban/db-service";
import type {
  CodexConversationSnapshot,
  CodexThreadDetail,
  CommandPaletteThreadContentSearchResult,
  CommandPaletteThreadIndexUpdatedEvent,
  CommandPaletteThreadSummary,
  CommandPaletteSearchSnippetSegment,
} from "../../shared/types";
import {
  normalizeSearchText,
  resolveFuzzyThreshold,
} from "../../shared/search-text";
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
const FUZZY_UNIT_TEXT_LIMIT = 20_000;
const FUZZY_TOTAL_TEXT_LIMIT = 30 * 1024 * 1024;
const FUZZY_EXCERPT_BEFORE = 80;
const FUZZY_EXCERPT_AFTER = 180;
const BACKFILL_CHUNK_SIZE = 4;
const BACKFILL_DELAY_MS = 25;
const FUZZY_BUILD_DEBOUNCE_MS = 200;
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

interface MiniSearchDocument {
  id: string;
  text: string;
}

interface MiniSearchSourceRow {
  rowid: number;
  threadId: string;
  text: string;
}

export interface ThreadSearchBackfillSource {
  readThreadDetail: (threadId: string) => CodexThreadDetail | null;
}

export interface ThreadSearchLiveSource {
  readConversation: (threadId: string) => CodexConversationSnapshot | null;
  readSummary: (threadId: string) => CommandPaletteThreadSummary | null;
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

function createMiniSearch(): MiniSearch<MiniSearchDocument> {
  return new MiniSearch<MiniSearchDocument>({
    fields: ["text"],
    idField: "id",
    storeFields: ["id"],
    processTerm: (term) => {
      const normalized = normalizeSearchText(term);
      return normalized.length > 0 ? normalized : null;
    },
  } satisfies Options<MiniSearchDocument>);
}

function buildFuzzyHighlightRegex(terms: string[]): RegExp | null {
  const normalizedTerms = Array.from(new Set(
    terms
      .map((term) => term.trim())
      .filter(Boolean)
      .sort((left, right) => right.length - left.length),
  ));
  if (normalizedTerms.length === 0) return null;
  const escaped = normalizedTerms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`(${escaped.join("|")})`, "gi");
}

function buildFuzzySnippet(
  text: string,
  matchedTerms: string[],
): { snippet: string; segments: CommandPaletteSearchSnippetSegment[] } | null {
  const normalized = normalizeSnippetText(text);
  if (!normalized) return null;

  const regex = buildFuzzyHighlightRegex(matchedTerms);
  if (!regex) {
    const snippet = normalized.slice(0, FUZZY_EXCERPT_BEFORE + FUZZY_EXCERPT_AFTER).trim();
    return {
      snippet,
      segments: [{ text: snippet, highlight: false }],
    };
  }

  regex.lastIndex = 0;
  const match = regex.exec(normalized);
  if (!match) {
    const snippet = normalized.slice(0, FUZZY_EXCERPT_BEFORE + FUZZY_EXCERPT_AFTER).trim();
    return {
      snippet,
      segments: [{ text: snippet, highlight: false }],
    };
  }

  const from = Math.max(0, match.index - FUZZY_EXCERPT_BEFORE);
  const to = Math.min(normalized.length, match.index + match[0].length + FUZZY_EXCERPT_AFTER);
  const snippet = `${from > 0 ? "…" : ""}${normalized.slice(from, to).trim()}${to < normalized.length ? "…" : ""}`;
  regex.lastIndex = 0;

  const segments: CommandPaletteSearchSnippetSegment[] = [];
  let lastIndex = 0;
  let segmentMatch: RegExpExecArray | null = null;
  while ((segmentMatch = regex.exec(snippet)) !== null) {
    if (segmentMatch.index > lastIndex) {
      segments.push({
        text: snippet.slice(lastIndex, segmentMatch.index),
        highlight: false,
      });
    }
    segments.push({
      text: segmentMatch[0],
      highlight: true,
    });
    lastIndex = segmentMatch.index + segmentMatch[0].length;
  }
  if (lastIndex < snippet.length) {
    segments.push({
      text: snippet.slice(lastIndex),
      highlight: false,
    });
  }

  return {
    snippet,
    segments: segments.length > 0 ? segments : [{ text: snippet, highlight: false }],
  };
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

export class CommandPaletteThreadSearchService {
  private miniSearch: MiniSearch<MiniSearchDocument> | null = null;
  private miniSearchRowsById = new Map<string, MiniSearchSourceRow>();
  private miniSearchDirty = true;
  private miniSearchReady = false;
  private miniSearchBuildInFlight = false;
  private miniSearchBuildTimer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private backfillQueue: CommandPaletteThreadSummary[] = [];
  private queuedBackfillThreadIds = new Set<string>();
  private backfillTimer: ReturnType<typeof setTimeout> | null = null;
  private liveIndexTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(private readonly options: CommandPaletteThreadSearchServiceOptions = {}) {}

  shutdown(): void {
    if (this.backfillTimer !== null) {
      clearTimeout(this.backfillTimer);
      this.backfillTimer = null;
    }
    if (this.miniSearchBuildTimer !== null) {
      clearTimeout(this.miniSearchBuildTimer);
      this.miniSearchBuildTimer = null;
    }
    this.backfillQueue = [];
    this.queuedBackfillThreadIds.clear();
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
      this.queuedBackfillThreadIds.add(summary.threadId);
      this.backfillQueue.push(summary);
    }

    this.backfillQueue.sort((left, right) => right.updatedAt - left.updatedAt);
    this.scheduleBackfillTick(source);
  }

  scheduleLiveIndex(threadId: string, source: ThreadSearchLiveSource): void {
    const existing = this.liveIndexTimers.get(threadId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.liveIndexTimers.delete(threadId);
      const summary = source.readSummary(threadId);
      if (!summary) {
        this.removeThread(threadId);
        return;
      }
      const conversation = source.readConversation(threadId);
      if (!conversation) return;
      this.indexConversation(summary, conversation);
    }, LIVE_INDEX_DEBOUNCE_MS);

    this.liveIndexTimers.set(threadId, timer);
  }

  indexConversation(
    summary: CommandPaletteThreadSummary,
    conversation: CodexConversationSnapshot,
  ): void {
    this.replaceThreadUnits(summary, extractThreadSearchUnitsFromConversation(conversation));
  }

  indexThreadDetail(
    summary: CommandPaletteThreadSummary,
    detail: CodexThreadDetail,
  ): void {
    this.replaceThreadUnits(summary, extractThreadSearchUnitsFromDetail(detail));
  }

  removeThread(threadId: string): void {
    getDb().prepare("DELETE FROM thread_search_units WHERE thread_id = ?").run(threadId);
    getDb().prepare("DELETE FROM thread_search_thread_state WHERE thread_id = ?").run(threadId);
    this.markMiniSearchDirty();
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

    const eligibleOrder = new Map(eligibleThreadIds.map((threadId, index) => [threadId, index] as const));
    const merged = new Map<string, CommandPaletteThreadContentSearchResult>();

    try {
      for (const hit of this.searchFts(query, eligibleThreadIds, limit)) {
        merged.set(hit.threadId, hit);
      }
    } catch {
      // Content search is supplemental; metadata search should keep working.
    }

    try {
      for (const hit of this.searchFuzzy(query, eligibleThreadIds, limit)) {
        if (merged.has(hit.threadId)) continue;
        merged.set(hit.threadId, hit);
      }
    } catch {
      // Content search is supplemental; metadata search should keep working.
    }

    return Array.from(merged.values())
      .sort((left, right) => {
        if (right.score !== left.score) return right.score - left.score;
        return (eligibleOrder.get(left.threadId) ?? Number.MAX_SAFE_INTEGER)
          - (eligibleOrder.get(right.threadId) ?? Number.MAX_SAFE_INTEGER);
      })
      .slice(0, limit);
  }

  private scheduleBackfillTick(source?: ThreadSearchBackfillSource): void {
    if (this.backfillTimer !== null || this.backfillQueue.length === 0) return;

    this.backfillTimer = setTimeout(() => {
      this.backfillTimer = null;
      void this.runBackfillBatch(source);
    }, BACKFILL_DELAY_MS);
  }

  private async runBackfillBatch(source?: ThreadSearchBackfillSource): Promise<void> {
    const batch = this.backfillQueue.splice(0, BACKFILL_CHUNK_SIZE);
    for (const summary of batch) {
      this.queuedBackfillThreadIds.delete(summary.threadId);
      if (!this.isThreadIndexStale(summary)) continue;
      const startedAt = Date.now();
      try {
        const units = source
          ? extractThreadSearchUnitsFromDetail(source.readThreadDetail(summary.threadId))
          : await readThreadSearchUnitsFromSession(summary.threadId, summary.updatedAt);
        if (!units) {
          this.markThreadIndexFailed(summary, "Session transcript is not materialized");
          continue;
        }
        this.replaceThreadUnits(summary, units);
        this.log("debug", "Indexed command palette thread search units", {
          threadId: summary.threadId,
          unitCount: units.length,
          durationMs: Date.now() - startedAt,
        });
      } catch (error) {
        this.markThreadIndexFailed(summary, error instanceof Error ? error.message : String(error));
      }
    }
    this.emitIndexUpdated("backfill");
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
  ): void {
    const now = Date.now();
    const database = getDb();
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
        deleteUnit.run(row.unit_key);
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
      `);

      for (const unit of units) {
        upsertUnit.run(
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
        );
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
    this.markMiniSearchDirty();
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

  private searchFuzzy(
    query: string,
    eligibleThreadIds: string[],
    limit: number,
  ): CommandPaletteThreadContentSearchResult[] {
    if (!this.miniSearchReady || this.miniSearchDirty || !this.miniSearch) {
      this.scheduleFuzzyBuild();
      return [];
    }

    const miniSearch = this.miniSearch;
    const normalizedQuery = normalizeSearchText(query);
    if (!normalizedQuery) return [];

    const eligible = new Set(eligibleThreadIds);
    const results = miniSearch.search(normalizedQuery, {
      combineWith: "AND",
      prefix: (term) => term.length >= 2,
      fuzzy: resolveFuzzyThreshold,
    });

    const byThread = new Map<string, CommandPaletteThreadContentSearchResult>();
    for (const result of results) {
      const source = this.miniSearchRowsById.get(String(result.id));
      if (!source || !eligible.has(source.threadId) || byThread.has(source.threadId)) continue;
      const snippet = buildFuzzySnippet(source.text, collectMatchedFuzzyTerms(result));
      if (!snippet) continue;
      byThread.set(source.threadId, {
        threadId: source.threadId,
        snippet: snippet.snippet,
        score: 1_000_000 - byThread.size,
        matchKind: "fuzzy",
        snippetSegments: snippet.segments,
      });
      if (byThread.size >= limit) break;
    }

    return Array.from(byThread.values());
  }

  private scheduleFuzzyBuild(): void {
    if (this.miniSearchBuildInFlight || this.miniSearchBuildTimer !== null || !this.miniSearchDirty) return;

    this.miniSearchBuildTimer = setTimeout(() => {
      this.miniSearchBuildTimer = null;
      void this.rebuildMiniSearch();
    }, FUZZY_BUILD_DEBOUNCE_MS);
  }

  private async rebuildMiniSearch(): Promise<void> {
    if (this.miniSearchBuildInFlight || !this.miniSearchDirty) return;

    this.miniSearchBuildInFlight = true;
    const startedAt = Date.now();
    const generation = this.generation;
    try {
      const miniSearch = createMiniSearch();
      const rows = getDb().prepare(`
        SELECT rowid, thread_id, text
        FROM thread_search_units
        ORDER BY source_updated_at DESC, rowid DESC
      `).all() as Array<{ rowid: number; thread_id: string; text: string }>;

      this.miniSearchRowsById = new Map();
      const documents: MiniSearchDocument[] = [];
      let indexedBytes = 0;
      for (const row of rows) {
        const text = row.text.slice(0, FUZZY_UNIT_TEXT_LIMIT);
        indexedBytes += Buffer.byteLength(text, "utf8");
        if (indexedBytes > FUZZY_TOTAL_TEXT_LIMIT) break;
        const id = String(row.rowid);
        this.miniSearchRowsById.set(id, {
          rowid: row.rowid,
          threadId: row.thread_id,
          text: row.text,
        });
        documents.push({ id, text });
      }

      if (documents.length > 0) {
        await miniSearch.addAllAsync(documents, { chunkSize: 1_000 });
      }

      if (generation !== this.generation) {
        this.log("debug", "Discarded stale command palette thread fuzzy index build", {
          buildGeneration: generation,
          currentGeneration: this.generation,
          durationMs: Date.now() - startedAt,
        });
        return;
      }

      this.miniSearch = miniSearch;
      this.miniSearchDirty = false;
      this.miniSearchReady = true;
      this.log("info", "Built command palette thread fuzzy index", {
        generation,
        documentCount: documents.length,
        indexedBytes,
        durationMs: Date.now() - startedAt,
      });
      this.emitIndexUpdated("fuzzy-ready");
    } catch (error) {
      this.log("warn", "Could not build command palette thread fuzzy index", {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.miniSearchBuildInFlight = false;
      if (this.miniSearchDirty) {
        this.scheduleFuzzyBuild();
      }
    }
  }

  private markMiniSearchDirty(): void {
    this.generation += 1;
    this.miniSearchDirty = true;
    this.miniSearchReady = false;
    this.scheduleFuzzyBuild();
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

function collectMatchedFuzzyTerms(result: SearchResult): string[] {
  const resultTerms = result.terms.map((term) => term.trim()).filter(Boolean);
  return Array.from(new Set(resultTerms));
}
