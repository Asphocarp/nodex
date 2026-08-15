import MiniSearch, { type AsPlainObject, type SearchResult } from "minisearch";
import { WORKFLOW_STATUS_LABELS } from "../../shared/workflow-status";
import {
  normalizeSearchText,
} from "./search-text";
import {
  collectPageSearchMatchedTerms,
  createPageSearchMiniSearch,
  createPageSearchMiniSearchOptions,
  DEFAULT_PAGE_SEARCH_FIELD_BOOSTS,
  searchPageSearchMiniSearch,
  type PageSearchDocument,
  type PageSearchField,
} from "./page-search";
import {
  buildCurrentPageKeyIndex,
  parsePageKeySearchQuery,
  searchCurrentPageKeyIndex,
  type CurrentPageKeyIndex,
} from "./page-key";
import {
  buildCommandPaletteHighlightedSegments,
  buildSearchTermHighlightPreview,
} from "./command-palette-highlight";
import type {
  CommandPalettePage,
  CommandPalettePageSearchBadge,
  CommandPalettePageSearchDecorations,
  CommandPalettePageSearchPreview,
  CommandPalettePageSearchPreviewSegment,
} from "./command-palette";

interface CommandPalettePageSearchDocument extends PageSearchDocument {
  pageKey: string;
}

export interface CommandPalettePageSearchHit {
  item: CommandPalettePage;
  score: number;
}

export interface CommandPalettePageSearchIndex {
  search: (query: string) => CommandPalettePageSearchHit[];
}

export interface CommandPalettePageSearchDocumentRef {
  id: string;
  signature: string;
}

export interface CommandPalettePageSearchCacheSnapshot {
  version: number;
  documentRefs: CommandPalettePageSearchDocumentRef[];
  data: AsPlainObject;
}

export interface CommandPalettePageSearchCacheStore {
  read: () => Promise<CommandPalettePageSearchCacheSnapshot | null>;
  write: (snapshot: CommandPalettePageSearchCacheSnapshot) => Promise<void>;
}

const FAST_FIELD_BOOSTS = {
  title: 8,
  tags: 5,
  assignee: 4,
  status: 4,
  columnName: 2,
  projectName: 2,
  description: 1,
  pageId: 1,
} as const;

const SEARCH_CACHE_VERSION = 4;
const SEARCH_CACHE_DB_NAME = "nodex/command-palette-page-search";
const SEARCH_CACHE_DB_VERSION = 1;
const SEARCH_CACHE_STORE_NAME = "search-cache";
const SEARCH_CACHE_RECORD_KEY = "pages";

interface CommandPalettePageSearchSource {
  documents: CommandPalettePageSearchDocument[];
  documentRefs: CommandPalettePageSearchDocumentRef[];
  itemsById: Map<string, CommandPalettePage>;
  pageKeyIndex: CurrentPageKeyIndex<CommandPalettePageSearchDocument>;
}

interface PersistedCommandPalettePageSearchCacheRecord extends CommandPalettePageSearchCacheSnapshot {
  key: string;
  updatedAt: string;
}

interface CommandPalettePageSearchRuntimeCache {
  documentRefs: CommandPalettePageSearchDocumentRef[];
  miniSearch: MiniSearch<CommandPalettePageSearchDocument>;
}

interface CommandPalettePageFastSearchRecord {
  item: CommandPalettePage;
  document: CommandPalettePageSearchDocument;
  status: string;
}

let commandPalettePageSearchDbPromise: Promise<IDBDatabase> | null = null;
let commandPalettePageSearchRuntimeCache: CommandPalettePageSearchRuntimeCache | null = null;

export function normalizeCommandPaletteSearchText(value: string): string {
  return normalizeSearchText(value);
}

function buildSearchDocument(item: CommandPalettePage): CommandPalettePageSearchDocument {
  return {
    id: item.id,
    pageKey: normalizeCommandPaletteSearchText(item.page.pageKey ?? ""),
    title: normalizeCommandPaletteSearchText(item.page.title),
    description: normalizeCommandPaletteSearchText(item.page.descriptionPreview),
    tags: normalizeCommandPaletteSearchText(item.tagLabels.join(" ")),
    assignee: normalizeCommandPaletteSearchText(item.page.assignee ?? ""),
    columnName: normalizeCommandPaletteSearchText(item.columnName),
    projectName: normalizeCommandPaletteSearchText(item.projectName),
    pageId: normalizeCommandPaletteSearchText(item.page.id),
  };
}

function buildFullTextSearchDocumentSignature(
  document: CommandPalettePageSearchDocument,
): string {
  return [
    document.id,
    document.title,
    document.description,
    document.tags,
    document.assignee,
    document.columnName,
    document.projectName,
    document.pageId,
  ].join("\u0001");
}

function buildCommandPalettePageSearchSource(
  pages: CommandPalettePage[],
): CommandPalettePageSearchSource {
  const itemsById = new Map(pages.map((item) => [item.id, item] as const));
  const documents = pages.map(buildSearchDocument);
  const documentRefs = documents.map((document) => ({
    id: document.id,
    signature: buildFullTextSearchDocumentSignature(document),
  }));

  return {
    documents,
    documentRefs,
    itemsById,
    pageKeyIndex: buildCurrentPageKeyIndex(
      documents,
      (document) => document.id,
      (document) => document.pageKey,
    ),
  };
}

function createMiniSearch(): MiniSearch<CommandPalettePageSearchDocument> {
  return createPageSearchMiniSearch<CommandPalettePageSearchDocument>();
}

function cloneDocumentRefs(
  refs: CommandPalettePageSearchDocumentRef[],
): CommandPalettePageSearchDocumentRef[] {
  return refs.map((ref) => ({ ...ref }));
}

function cacheRuntimeSearchIndex(
  documentRefs: CommandPalettePageSearchDocumentRef[],
  miniSearch: MiniSearch<CommandPalettePageSearchDocument>,
): void {
  commandPalettePageSearchRuntimeCache = {
    documentRefs: cloneDocumentRefs(documentRefs),
    miniSearch,
  };
}

function hasMatchingDocumentRefs(
  left: CommandPalettePageSearchDocumentRef[],
  right: CommandPalettePageSearchDocumentRef[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  const rightById = new Map(right.map((ref) => [ref.id, ref.signature] as const));
  return left.every((ref) => rightById.get(ref.id) === ref.signature);
}

function collectMatchedTermsForField(
  result: SearchResult,
  field: PageSearchField,
): string[] {
  return collectPageSearchMatchedTerms(result, field);
}

function buildHighlightedSegments(
  text: string,
  terms: string[],
): CommandPalettePageSearchPreviewSegment[] | null {
  return buildCommandPaletteHighlightedSegments(text, terms);
}

function buildBadge(
  id: string,
  label: string,
  value: string,
  terms: string[],
  tone?: "default" | "monospace",
): CommandPalettePageSearchBadge | null {
  const segments = buildHighlightedSegments(value, terms);
  if (!segments) {
    return null;
  }

  return {
    id,
    label,
    segments,
    tone,
  };
}

function buildSearchDecorations(
  item: CommandPalettePage,
  result: SearchResult,
): CommandPalettePageSearchDecorations | null {
  const titleSegments = buildHighlightedSegments(item.page.title || "Untitled", collectMatchedTermsForField(result, "title"));
  const projectNameSegments = buildHighlightedSegments(item.projectName, collectMatchedTermsForField(result, "projectName"));
  const columnNameSegments = buildHighlightedSegments(item.columnName, collectMatchedTermsForField(result, "columnName"));
  const badges: CommandPalettePageSearchBadge[] = [];

  const tagTerms = collectMatchedTermsForField(result, "tags");
  if (tagTerms.length > 0) {
    item.tagLabels.forEach((tag) => {
      const badge = buildBadge(`tag:${tag}`, "tag", tag, tagTerms);
      if (badge) {
        badges.push(badge);
      }
    });
  }

  const assigneeTerms = collectMatchedTermsForField(result, "assignee");
  const assigneeBadge = buildBadge("assignee", "assignee", item.page.assignee ?? "", assigneeTerms);
  if (assigneeBadge) {
    badges.push(assigneeBadge);
  }

  const pageIdTerms = collectMatchedTermsForField(result, "pageId");
  const pageIdBadge = buildBadge("id", "id", item.page.id, pageIdTerms, "monospace");
  if (pageIdBadge) {
    badges.push(pageIdBadge);
  }

  if (!titleSegments && !projectNameSegments && !columnNameSegments && badges.length === 0) {
    return null;
  }

  return {
    pageKeySegments: null,
    titleSegments,
    projectNameSegments,
    columnNameSegments,
    badges,
  };
}

function buildDescriptionPreview(
  item: CommandPalettePage,
  result: SearchResult,
): CommandPalettePageSearchPreview | null {
  const descriptionTerms = result.terms.filter((term) => result.match[term]?.includes("description"));
  const previewTerms = descriptionTerms.length > 0
    ? descriptionTerms
    : result.terms;
  const preview = buildSearchTermHighlightPreview(
    item.page.descriptionPreview,
    previewTerms,
    { maxCharacters: 320, leadingContextCharacters: 96 },
  );
  return preview?.segments.some(({ highlight }) => highlight)
    ? preview
    : null;
}

function buildDescriptionPreviewFromTerms(
  item: CommandPalettePage,
  terms: string[],
): CommandPalettePageSearchPreview | null {
  const preview = buildSearchTermHighlightPreview(
    item.page.descriptionPreview,
    terms,
    { maxCharacters: 320, leadingContextCharacters: 96 },
  );
  return preview?.segments.some(({ highlight }) => highlight)
    ? preview
    : null;
}

function collectFastMatchedTerms(value: string, terms: readonly string[]): string[] {
  return terms.filter((term) => value.includes(term));
}

function scoreFastSearchField(
  value: string,
  normalizedQuery: string,
  terms: readonly string[],
  boost: number,
): number {
  if (!value) return 0;

  let score = 0;
  if (value === normalizedQuery) {
    score += 500 * boost;
  } else if (value.startsWith(normalizedQuery)) {
    score += 350 * boost;
  } else if (value.includes(normalizedQuery)) {
    score += 200 * boost;
  }

  terms.forEach((term) => {
    if (value === term) {
      score += 80 * boost;
      return;
    }
    if (value.startsWith(term)) {
      score += 50 * boost;
      return;
    }
    if (value.includes(term)) {
      score += 20 * boost;
    }
  });

  return score;
}

function buildFastSearchDecorations(
  record: CommandPalettePageFastSearchRecord,
  terms: readonly string[],
): CommandPalettePageSearchDecorations | null {
  const item = record.item;
  const pageKeySegments = buildHighlightedSegments(
    item.page.pageKey ?? "",
    collectFastMatchedTerms(record.document.pageKey, terms)
      .filter((term) => record.document.pageKey === term || record.document.pageKey.startsWith(term)),
  );
  const titleSegments = buildHighlightedSegments(item.page.title || "Untitled", collectFastMatchedTerms(record.document.title, terms));
  const projectNameSegments = buildHighlightedSegments(item.projectName, collectFastMatchedTerms(record.document.projectName, terms));
  const columnNameSegments = buildHighlightedSegments(item.columnName, collectFastMatchedTerms(record.document.columnName, terms));
  const badges: CommandPalettePageSearchBadge[] = [];

  const tagTerms = collectFastMatchedTerms(record.document.tags, terms);
  if (tagTerms.length > 0) {
    item.tagLabels.forEach((tag) => {
      const badge = buildBadge(`tag:${tag}`, "tag", tag, tagTerms);
      if (badge) badges.push(badge);
    });
  }

  const assigneeBadge = buildBadge("assignee", "assignee", item.page.assignee ?? "", collectFastMatchedTerms(record.document.assignee, terms));
  if (assigneeBadge) badges.push(assigneeBadge);

  const statusBadge = buildBadge("workflow-status", "status", WORKFLOW_STATUS_LABELS[item.page.status] ?? item.page.status, collectFastMatchedTerms(record.status, terms));
  if (statusBadge) badges.push(statusBadge);

  const pageIdBadge = buildBadge("id", "id", item.page.id, collectFastMatchedTerms(record.document.pageId, terms), "monospace");
  if (pageIdBadge) badges.push(pageIdBadge);

  if (!pageKeySegments && !titleSegments && !projectNameSegments && !columnNameSegments && badges.length === 0) {
    return null;
  }

  return {
    pageKeySegments,
    titleSegments,
    projectNameSegments,
    columnNameSegments,
    badges,
  };
}

function decoratePageKeyMatch(
  item: CommandPalettePage,
  terms: string[],
): CommandPalettePage {
  const pageKeySegments = buildHighlightedSegments(item.page.pageKey ?? "", terms);
  return {
    ...item,
    searchDecorations: {
      pageKeySegments,
      titleSegments: item.searchDecorations?.titleSegments ?? null,
      projectNameSegments: item.searchDecorations?.projectNameSegments ?? null,
      columnNameSegments: item.searchDecorations?.columnNameSegments ?? null,
      badges: item.searchDecorations?.badges ?? [],
    },
  };
}

function createCommandPalettePageSearchIndexFromSource(
  source: CommandPalettePageSearchSource,
  miniSearch: MiniSearch<CommandPalettePageSearchDocument>,
): CommandPalettePageSearchIndex {
  return {
    search(query) {
      const pageKeyQuery = parsePageKeySearchQuery(query);
      const { normalizedQuery } = pageKeyQuery;
      if (!normalizedQuery) return [];

      const hitsById = new Map<string, CommandPalettePageSearchHit>();
      if (!pageKeyQuery.explicit) {
        searchPageSearchMiniSearch(
          miniSearch,
          normalizedQuery,
          DEFAULT_PAGE_SEARCH_FIELD_BOOSTS,
        )
          .forEach((result) => {
            const item = source.itemsById.get(String(result.id));
            if (!item) return;
            const pageWithPreview: CommandPalettePage = {
              ...item,
              searchPreview: buildDescriptionPreview(item, result),
              searchDecorations: buildSearchDecorations(item, result),
            };
            hitsById.set(item.id, {
              item: pageWithPreview,
              score: result.score,
            });
          });
      }

      searchCurrentPageKeyIndex(source.pageKeyIndex, pageKeyQuery).forEach((hit) => {
        const document = hit.value;
        const keyMatch = hit.match;
        const item = source.itemsById.get(document.id);
        if (!item) return;
        const existing = hitsById.get(document.id);
        hitsById.set(document.id, {
          item: decoratePageKeyMatch(existing?.item ?? item, keyMatch.terms),
          score: Math.max(existing?.score ?? 0, keyMatch.score),
        });
      });

      return [...hitsById.values()].sort((left, right) => right.score - left.score);
    },
  };
}

function createCommandPalettePageSearchSnapshot(
  source: CommandPalettePageSearchSource,
  miniSearch: MiniSearch<CommandPalettePageSearchDocument>,
): CommandPalettePageSearchCacheSnapshot {
  return {
    version: SEARCH_CACHE_VERSION,
    documentRefs: cloneDocumentRefs(source.documentRefs),
    data: miniSearch.toJSON(),
  };
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionToPromise(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

function openCommandPalettePageSearchDatabase(): Promise<IDBDatabase> {
  if (commandPalettePageSearchDbPromise) {
    return commandPalettePageSearchDbPromise;
  }

  commandPalettePageSearchDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(SEARCH_CACHE_DB_NAME, SEARCH_CACHE_DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(SEARCH_CACHE_STORE_NAME)) {
        database.createObjectStore(SEARCH_CACHE_STORE_NAME, { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      commandPalettePageSearchDbPromise = null;
      reject(request.error ?? new Error("IndexedDB open failed"));
    };
    request.onblocked = () => {
      commandPalettePageSearchDbPromise = null;
      reject(new Error("IndexedDB open blocked"));
    };
  });

  return commandPalettePageSearchDbPromise;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isValidDocumentRef(value: unknown): value is CommandPalettePageSearchDocumentRef {
  return isPlainObject(value)
    && typeof value.id === "string"
    && typeof value.signature === "string";
}

function isPersistedCommandPalettePageSearchCacheRecord(
  value: unknown,
): value is PersistedCommandPalettePageSearchCacheRecord {
  return isPlainObject(value)
    && value.key === SEARCH_CACHE_RECORD_KEY
    && typeof value.version === "number"
    && Array.isArray(value.documentRefs)
    && value.documentRefs.every((entry) => isValidDocumentRef(entry))
    && isPlainObject(value.data);
}

export const commandPalettePageSearchCacheStore: CommandPalettePageSearchCacheStore = {
  async read() {
    if (typeof indexedDB === "undefined") {
      return null;
    }

    try {
      const database = await openCommandPalettePageSearchDatabase();
      const transaction = database.transaction(SEARCH_CACHE_STORE_NAME, "readonly");
      const record = await requestToPromise(
        transaction.objectStore(SEARCH_CACHE_STORE_NAME).get(SEARCH_CACHE_RECORD_KEY),
      );
      await transactionToPromise(transaction);

      if (!isPersistedCommandPalettePageSearchCacheRecord(record)) {
        return null;
      }

      return {
        version: record.version,
        documentRefs: cloneDocumentRefs(record.documentRefs),
        data: record.data,
      };
    } catch {
      return null;
    }
  },
  async write(snapshot) {
    if (typeof indexedDB === "undefined") {
      return;
    }

    try {
      const database = await openCommandPalettePageSearchDatabase();
      const transaction = database.transaction(SEARCH_CACHE_STORE_NAME, "readwrite");
      transaction.objectStore(SEARCH_CACHE_STORE_NAME).put({
        key: SEARCH_CACHE_RECORD_KEY,
        updatedAt: new Date().toISOString(),
        version: snapshot.version,
        documentRefs: cloneDocumentRefs(snapshot.documentRefs),
        data: snapshot.data,
      } satisfies PersistedCommandPalettePageSearchCacheRecord);
      await transactionToPromise(transaction);
    } catch {
      // Ignore cache write failures.
    }
  },
};

function reconcileCommandPalettePageSearchIndex(
  miniSearch: MiniSearch<CommandPalettePageSearchDocument>,
  source: CommandPalettePageSearchSource,
  cachedDocumentRefs: CommandPalettePageSearchDocumentRef[],
): boolean {
  const currentSignatures = new Map(source.documentRefs.map((ref) => [ref.id, ref.signature] as const));
  const cachedSignatures = new Map(cachedDocumentRefs.map((ref) => [ref.id, ref.signature] as const));
  const removedIds = cachedDocumentRefs
    .filter((ref) => !currentSignatures.has(ref.id))
    .map((ref) => ref.id);
  let changed = removedIds.length > 0;

  if (removedIds.length > 0) {
    miniSearch.discardAll(removedIds);
  }

  source.documents.forEach((document) => {
    const signature = currentSignatures.get(document.id);
    if (!signature || cachedSignatures.get(document.id) === signature) {
      return;
    }

    if (miniSearch.has(document.id)) {
      miniSearch.replace(document);
    } else {
      miniSearch.add(document);
    }
    changed = true;
  });

  return changed;
}

export function getCachedCommandPalettePageSearchIndex(
  pages: CommandPalettePage[],
): CommandPalettePageSearchIndex | null {
  const source = buildCommandPalettePageSearchSource(pages);
  if (!commandPalettePageSearchRuntimeCache) {
    return null;
  }

  if (!hasMatchingDocumentRefs(commandPalettePageSearchRuntimeCache.documentRefs, source.documentRefs)) {
    return null;
  }

  return createCommandPalettePageSearchIndexFromSource(
    source,
    commandPalettePageSearchRuntimeCache.miniSearch,
  );
}

export async function hydrateCommandPalettePageSearchIndex(
  pages: CommandPalettePage[],
  cacheStore: CommandPalettePageSearchCacheStore = commandPalettePageSearchCacheStore,
): Promise<CommandPalettePageSearchIndex> {
  const source = buildCommandPalettePageSearchSource(pages);
  if (commandPalettePageSearchRuntimeCache
    && hasMatchingDocumentRefs(commandPalettePageSearchRuntimeCache.documentRefs, source.documentRefs)) {
    return createCommandPalettePageSearchIndexFromSource(
      source,
      commandPalettePageSearchRuntimeCache.miniSearch,
    );
  }

  const persistedSnapshot = await cacheStore.read();
  let miniSearch = createMiniSearch();
  let shouldWriteSnapshot = source.documents.length > 0 || Boolean(persistedSnapshot);

  if (persistedSnapshot?.version === SEARCH_CACHE_VERSION) {
    try {
      miniSearch = await MiniSearch.loadJSAsync(
        persistedSnapshot.data,
        createPageSearchMiniSearchOptions<CommandPalettePageSearchDocument>(),
      );
      shouldWriteSnapshot = reconcileCommandPalettePageSearchIndex(
        miniSearch,
        source,
        persistedSnapshot.documentRefs,
      );
      shouldWriteSnapshot = shouldWriteSnapshot
        || !hasMatchingDocumentRefs(persistedSnapshot.documentRefs, source.documentRefs);
    } catch {
      miniSearch = createMiniSearch();
    }
  }

  if (!persistedSnapshot || persistedSnapshot.version !== SEARCH_CACHE_VERSION) {
    shouldWriteSnapshot = source.documents.length > 0 || Boolean(persistedSnapshot);
  }

  if (
    !persistedSnapshot
    || persistedSnapshot.version !== SEARCH_CACHE_VERSION
    || (source.documents.length > 0 && miniSearch.documentCount === 0)
  ) {
    miniSearch = createMiniSearch();
    if (source.documents.length > 0) {
      await miniSearch.addAllAsync(source.documents, { chunkSize: 200 });
    }
    shouldWriteSnapshot = true;
  }

  cacheRuntimeSearchIndex(source.documentRefs, miniSearch);

  if (shouldWriteSnapshot) {
    await cacheStore.write(createCommandPalettePageSearchSnapshot(source, miniSearch));
  }

  return createCommandPalettePageSearchIndexFromSource(source, miniSearch);
}

export function createCommandPalettePageSearchIndex(
  pages: CommandPalettePage[],
): CommandPalettePageSearchIndex {
  const source = buildCommandPalettePageSearchSource(pages);
  const miniSearch = createMiniSearch();

  if (source.documents.length > 0) {
    miniSearch.addAll(source.documents);
  }

  cacheRuntimeSearchIndex(source.documentRefs, miniSearch);
  return createCommandPalettePageSearchIndexFromSource(source, miniSearch);
}

export function createCommandPalettePageFastSearchIndex(
  pages: CommandPalettePage[],
): CommandPalettePageSearchIndex {
  const records = pages.map((item): CommandPalettePageFastSearchRecord => ({
    item,
    document: buildSearchDocument(item),
    status: normalizeCommandPaletteSearchText(WORKFLOW_STATUS_LABELS[item.page.status] ?? item.page.status),
  }));
  const pageKeyIndex = buildCurrentPageKeyIndex(
    records,
    (record) => record.item.id,
    (record) => record.document.pageKey,
  );

  return {
    search(query) {
      const pageKeyQuery = parsePageKeySearchQuery(query);
      const { normalizedQuery } = pageKeyQuery;
      if (!normalizedQuery) return [];

      const terms = normalizedQuery.split(/\s+/).filter((term) => term.length > 0);
      if (terms.length === 0) return [];
      const pageKeyHits = searchCurrentPageKeyIndex(pageKeyIndex, pageKeyQuery);
      if (pageKeyQuery.explicit) {
        return pageKeyHits.map(({ value: record, match }) => ({
          item: decoratePageKeyMatch(record.item, match.terms),
          score: match.score,
        }));
      }
      const pageKeyMatches = new Map(
        pageKeyHits.map(({ value, match }) => [value.item.id, match] as const),
      );

      return records
        .map((record): CommandPalettePageSearchHit | null => {
          const keyMatch = pageKeyMatches.get(record.item.id);
          const fields = [
            { value: record.document.title, boost: FAST_FIELD_BOOSTS.title },
            { value: record.document.description, boost: FAST_FIELD_BOOSTS.description },
            { value: record.document.tags, boost: FAST_FIELD_BOOSTS.tags },
            { value: record.document.assignee, boost: FAST_FIELD_BOOSTS.assignee },
            { value: record.status, boost: FAST_FIELD_BOOSTS.status },
            { value: record.document.columnName, boost: FAST_FIELD_BOOSTS.columnName },
            { value: record.document.projectName, boost: FAST_FIELD_BOOSTS.projectName },
            { value: record.document.pageId, boost: FAST_FIELD_BOOSTS.pageId },
          ];
          if (!keyMatch && !terms.every((term) => (
            fields.some((field) => field.value.includes(term))
          ))) {
            return null;
          }

          const fieldScore = fields.reduce(
            (sum, field) => sum + scoreFastSearchField(field.value, normalizedQuery, terms, field.boost),
            0,
          );
          return {
            item: {
              ...record.item,
              searchPreview: buildDescriptionPreviewFromTerms(record.item, terms),
              searchDecorations: buildFastSearchDecorations(record, terms),
            },
            score: fieldScore + (keyMatch?.score ?? 0),
          };
        })
        .filter((result): result is CommandPalettePageSearchHit => result !== null);
    },
  };
}

export function resetCommandPalettePageSearchCacheForTests(): void {
  commandPalettePageSearchRuntimeCache = null;
}
