import MiniSearch, { type AsPlainObject, type Options, type SearchResult } from "minisearch";
import { CARD_STATUS_LABELS } from "../../shared/card-status";
import {
  normalizeSearchText,
  resolveFuzzyThreshold,
} from "./search-text";
import {
  buildCommandPaletteHighlightedSegments,
  buildCommandPaletteHighlightRegex,
  buildCommandPaletteHighlightSegments,
  normalizeCommandPalettePreviewText,
} from "./command-palette-highlight";
import type {
  CommandPaletteCard,
  CommandPaletteCardSearchBadge,
  CommandPaletteCardSearchDecorations,
  CommandPaletteCardSearchPreview,
  CommandPaletteCardSearchPreviewSegment,
} from "./command-palette";

interface CommandPaletteCardSearchDocument {
  id: string;
  title: string;
  description: string;
  tags: string;
  assignee: string;
  agentStatus: string;
  columnName: string;
  projectName: string;
  cardId: string;
}

export interface CommandPaletteCardSearchHit {
  item: CommandPaletteCard;
  score: number;
}

export interface CommandPaletteCardSearchIndex {
  search: (query: string) => CommandPaletteCardSearchHit[];
}

export interface CommandPaletteCardSearchDocumentRef {
  id: string;
  signature: string;
}

export interface CommandPaletteCardSearchCacheSnapshot {
  version: number;
  documentRefs: CommandPaletteCardSearchDocumentRef[];
  data: AsPlainObject;
}

export interface CommandPaletteCardSearchCacheStore {
  read: () => Promise<CommandPaletteCardSearchCacheSnapshot | null>;
  write: (snapshot: CommandPaletteCardSearchCacheSnapshot) => Promise<void>;
}

const SEARCH_FIELDS: Array<keyof CommandPaletteCardSearchDocument> = [
  "title",
  "description",
  "tags",
  "assignee",
  "agentStatus",
  "columnName",
  "projectName",
  "cardId",
];

const FIELD_BOOSTS: Partial<Record<keyof CommandPaletteCardSearchDocument, number>> = {
  title: 8,
  tags: 5,
  assignee: 4,
  agentStatus: 3,
  columnName: 2,
  projectName: 2,
  description: 1,
  cardId: 1,
};
const FAST_FIELD_BOOSTS = {
  title: 8,
  tags: 5,
  assignee: 4,
  status: 4,
  agentStatus: 3,
  columnName: 2,
  projectName: 2,
  description: 1,
  cardId: 1,
} as const;

const EXCERPT_BEFORE = 96;
const EXCERPT_AFTER = 220;
const SEARCH_CACHE_VERSION = 1;
const SEARCH_CACHE_DB_NAME = "nodex/command-palette-card-search";
const SEARCH_CACHE_DB_VERSION = 1;
const SEARCH_CACHE_STORE_NAME = "search-cache";
const SEARCH_CACHE_RECORD_KEY = "cards";

interface CommandPaletteCardSearchSource {
  documents: CommandPaletteCardSearchDocument[];
  documentRefs: CommandPaletteCardSearchDocumentRef[];
  itemsById: Map<string, CommandPaletteCard>;
}

interface PersistedCommandPaletteCardSearchCacheRecord extends CommandPaletteCardSearchCacheSnapshot {
  key: string;
  updatedAt: string;
}

interface CommandPaletteCardSearchRuntimeCache {
  documentRefs: CommandPaletteCardSearchDocumentRef[];
  miniSearch: MiniSearch<CommandPaletteCardSearchDocument>;
}

interface CommandPaletteCardFastSearchRecord {
  item: CommandPaletteCard;
  document: CommandPaletteCardSearchDocument;
  status: string;
}

let commandPaletteCardSearchDbPromise: Promise<IDBDatabase> | null = null;
let commandPaletteCardSearchRuntimeCache: CommandPaletteCardSearchRuntimeCache | null = null;

export function normalizeCommandPaletteSearchText(value: string): string {
  return normalizeSearchText(value);
}

function buildSearchDocument(item: CommandPaletteCard): CommandPaletteCardSearchDocument {
  return {
    id: item.id,
    title: normalizeCommandPaletteSearchText(item.card.title),
    description: normalizeCommandPaletteSearchText(item.card.descriptionPreview),
    tags: normalizeCommandPaletteSearchText(item.card.tags.join(" ")),
    assignee: normalizeCommandPaletteSearchText(item.card.assignee ?? ""),
    agentStatus: normalizeCommandPaletteSearchText(item.card.agentStatus ?? ""),
    columnName: normalizeCommandPaletteSearchText(item.columnName),
    projectName: normalizeCommandPaletteSearchText(item.projectName),
    cardId: normalizeCommandPaletteSearchText(item.card.id),
  };
}

function buildSearchDocumentSignature(document: CommandPaletteCardSearchDocument): string {
  return [
    document.id,
    document.title,
    document.description,
    document.tags,
    document.assignee,
    document.agentStatus,
    document.columnName,
    document.projectName,
    document.cardId,
  ].join("\u0001");
}

function buildCommandPaletteCardSearchSource(
  cards: CommandPaletteCard[],
): CommandPaletteCardSearchSource {
  const itemsById = new Map(cards.map((item) => [item.id, item] as const));
  const documents = cards.map(buildSearchDocument);
  const documentRefs = documents.map((document) => ({
    id: document.id,
    signature: buildSearchDocumentSignature(document),
  }));

  return {
    documents,
    documentRefs,
    itemsById,
  };
}

function createCommandPaletteCardSearchOptions(): Options<CommandPaletteCardSearchDocument> {
  return {
    fields: SEARCH_FIELDS,
    idField: "id",
    storeFields: ["id"],
    processTerm: (term) => {
      const normalized = normalizeCommandPaletteSearchText(term);
      return normalized.length > 0 ? normalized : null;
    },
  };
}

function createMiniSearch(): MiniSearch<CommandPaletteCardSearchDocument> {
  return new MiniSearch<CommandPaletteCardSearchDocument>(createCommandPaletteCardSearchOptions());
}

function cloneDocumentRefs(
  refs: CommandPaletteCardSearchDocumentRef[],
): CommandPaletteCardSearchDocumentRef[] {
  return refs.map((ref) => ({ ...ref }));
}

function cacheRuntimeSearchIndex(
  documentRefs: CommandPaletteCardSearchDocumentRef[],
  miniSearch: MiniSearch<CommandPaletteCardSearchDocument>,
): void {
  commandPaletteCardSearchRuntimeCache = {
    documentRefs: cloneDocumentRefs(documentRefs),
    miniSearch,
  };
}

function hasMatchingDocumentRefs(
  left: CommandPaletteCardSearchDocumentRef[],
  right: CommandPaletteCardSearchDocumentRef[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  const rightById = new Map(right.map((ref) => [ref.id, ref.signature] as const));
  return left.every((ref) => rightById.get(ref.id) === ref.signature);
}

function collectMatchedTermsForField(result: SearchResult, field: keyof CommandPaletteCardSearchDocument): string[] {
  return result.terms.filter((term) => result.match[term]?.includes(field));
}

function buildHighlightedSegments(
  text: string,
  terms: string[],
): CommandPaletteCardSearchPreviewSegment[] | null {
  return buildCommandPaletteHighlightedSegments(text, terms);
}

function buildBadge(
  id: string,
  label: string,
  value: string,
  terms: string[],
  tone?: "default" | "monospace",
): CommandPaletteCardSearchBadge | null {
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
  item: CommandPaletteCard,
  result: SearchResult,
): CommandPaletteCardSearchDecorations | null {
  const titleSegments = buildHighlightedSegments(item.card.title || "Untitled", collectMatchedTermsForField(result, "title"));
  const projectNameSegments = buildHighlightedSegments(item.projectName, collectMatchedTermsForField(result, "projectName"));
  const columnNameSegments = buildHighlightedSegments(item.columnName, collectMatchedTermsForField(result, "columnName"));
  const badges: CommandPaletteCardSearchBadge[] = [];

  const tagTerms = collectMatchedTermsForField(result, "tags");
  if (tagTerms.length > 0) {
    item.card.tags.forEach((tag) => {
      const badge = buildBadge(`tag:${tag}`, "tag", tag, tagTerms);
      if (badge) {
        badges.push(badge);
      }
    });
  }

  const assigneeTerms = collectMatchedTermsForField(result, "assignee");
  const assigneeBadge = buildBadge("assignee", "assignee", item.card.assignee ?? "", assigneeTerms);
  if (assigneeBadge) {
    badges.push(assigneeBadge);
  }

  const statusTerms = collectMatchedTermsForField(result, "agentStatus");
  const statusBadge = buildBadge("agent-status", "status", item.card.agentStatus ?? "", statusTerms);
  if (statusBadge) {
    badges.push(statusBadge);
  }

  const cardIdTerms = collectMatchedTermsForField(result, "cardId");
  const cardIdBadge = buildBadge("id", "id", item.card.id, cardIdTerms, "monospace");
  if (cardIdBadge) {
    badges.push(cardIdBadge);
  }

  if (!titleSegments && !projectNameSegments && !columnNameSegments && badges.length === 0) {
    return null;
  }

  return {
    titleSegments,
    projectNameSegments,
    columnNameSegments,
    badges,
  };
}

function buildDescriptionPreview(
  item: CommandPaletteCard,
  result: SearchResult,
): CommandPaletteCardSearchPreview | null {
  const description = normalizeCommandPalettePreviewText(item.card.descriptionPreview);
  if (!description) {
    return null;
  }

  const descriptionTerms = result.terms.filter((term) => result.match[term]?.includes("description"));
  const previewTerms = descriptionTerms.length > 0
    ? descriptionTerms
    : result.terms;
  const regex = buildCommandPaletteHighlightRegex(previewTerms);
  if (!regex) {
    return null;
  }

  regex.lastIndex = 0;
  const firstMatch = regex.exec(description);
  if (!firstMatch) {
    return null;
  }

  const from = Math.max(0, firstMatch.index - EXCERPT_BEFORE);
  const to = Math.min(description.length, firstMatch.index + firstMatch[0].length + EXCERPT_AFTER);
  const excerpt = `${from > 0 ? "…" : ""}${description.slice(from, to).trim()}${to < description.length ? "…" : ""}`;

  return {
    excerpt,
    segments: buildCommandPaletteHighlightSegments(excerpt, buildCommandPaletteHighlightRegex(previewTerms)),
  };
}

function buildDescriptionPreviewFromTerms(
  item: CommandPaletteCard,
  terms: string[],
): CommandPaletteCardSearchPreview | null {
  const description = normalizeCommandPalettePreviewText(item.card.descriptionPreview);
  if (!description) return null;

  const regex = buildCommandPaletteHighlightRegex(terms);
  if (!regex) return null;

  regex.lastIndex = 0;
  const firstMatch = regex.exec(description);
  if (!firstMatch) return null;

  const from = Math.max(0, firstMatch.index - EXCERPT_BEFORE);
  const to = Math.min(description.length, firstMatch.index + firstMatch[0].length + EXCERPT_AFTER);
  const excerpt = `${from > 0 ? "…" : ""}${description.slice(from, to).trim()}${to < description.length ? "…" : ""}`;

  return {
    excerpt,
    segments: buildCommandPaletteHighlightSegments(excerpt, buildCommandPaletteHighlightRegex(terms)),
  };
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
  record: CommandPaletteCardFastSearchRecord,
  terms: readonly string[],
): CommandPaletteCardSearchDecorations | null {
  const item = record.item;
  const titleSegments = buildHighlightedSegments(item.card.title || "Untitled", collectFastMatchedTerms(record.document.title, terms));
  const projectNameSegments = buildHighlightedSegments(item.projectName, collectFastMatchedTerms(record.document.projectName, terms));
  const columnNameSegments = buildHighlightedSegments(item.columnName, collectFastMatchedTerms(record.document.columnName, terms));
  const badges: CommandPaletteCardSearchBadge[] = [];

  const tagTerms = collectFastMatchedTerms(record.document.tags, terms);
  if (tagTerms.length > 0) {
    item.card.tags.forEach((tag) => {
      const badge = buildBadge(`tag:${tag}`, "tag", tag, tagTerms);
      if (badge) badges.push(badge);
    });
  }

  const assigneeBadge = buildBadge("assignee", "assignee", item.card.assignee ?? "", collectFastMatchedTerms(record.document.assignee, terms));
  if (assigneeBadge) badges.push(assigneeBadge);

  const agentStatusBadge = buildBadge("agent-status", "status", item.card.agentStatus ?? "", collectFastMatchedTerms(record.document.agentStatus, terms));
  if (agentStatusBadge) badges.push(agentStatusBadge);

  const statusBadge = buildBadge("card-status", "status", CARD_STATUS_LABELS[item.card.status] ?? item.card.status, collectFastMatchedTerms(record.status, terms));
  if (statusBadge) badges.push(statusBadge);

  const cardIdBadge = buildBadge("id", "id", item.card.id, collectFastMatchedTerms(record.document.cardId, terms), "monospace");
  if (cardIdBadge) badges.push(cardIdBadge);

  if (!titleSegments && !projectNameSegments && !columnNameSegments && badges.length === 0) {
    return null;
  }

  return {
    titleSegments,
    projectNameSegments,
    columnNameSegments,
    badges,
  };
}

function createCommandPaletteCardSearchIndexFromSource(
  source: CommandPaletteCardSearchSource,
  miniSearch: MiniSearch<CommandPaletteCardSearchDocument>,
): CommandPaletteCardSearchIndex {
  return {
    search(query) {
      const normalizedQuery = normalizeCommandPaletteSearchText(query);
      if (!normalizedQuery) return [];

      return miniSearch
        .search(normalizedQuery, {
          combineWith: "AND",
          prefix: (term) => term.length >= 2,
          fuzzy: resolveFuzzyThreshold,
          boost: FIELD_BOOSTS,
        })
        .map((result): CommandPaletteCardSearchHit | null => {
          const item = source.itemsById.get(String(result.id));
          if (!item) return null;
          const cardWithPreview: CommandPaletteCard = {
            ...item,
            searchPreview: buildDescriptionPreview(item, result),
            searchDecorations: buildSearchDecorations(item, result),
          };
          return {
            item: cardWithPreview,
            score: result.score,
          };
        })
        .filter((result): result is CommandPaletteCardSearchHit => result !== null);
    },
  };
}

function createCommandPaletteCardSearchSnapshot(
  source: CommandPaletteCardSearchSource,
  miniSearch: MiniSearch<CommandPaletteCardSearchDocument>,
): CommandPaletteCardSearchCacheSnapshot {
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

function openCommandPaletteCardSearchDatabase(): Promise<IDBDatabase> {
  if (commandPaletteCardSearchDbPromise) {
    return commandPaletteCardSearchDbPromise;
  }

  commandPaletteCardSearchDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(SEARCH_CACHE_DB_NAME, SEARCH_CACHE_DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(SEARCH_CACHE_STORE_NAME)) {
        database.createObjectStore(SEARCH_CACHE_STORE_NAME, { keyPath: "key" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      commandPaletteCardSearchDbPromise = null;
      reject(request.error ?? new Error("IndexedDB open failed"));
    };
    request.onblocked = () => {
      commandPaletteCardSearchDbPromise = null;
      reject(new Error("IndexedDB open blocked"));
    };
  });

  return commandPaletteCardSearchDbPromise;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isValidDocumentRef(value: unknown): value is CommandPaletteCardSearchDocumentRef {
  return isPlainObject(value)
    && typeof value.id === "string"
    && typeof value.signature === "string";
}

function isPersistedCommandPaletteCardSearchCacheRecord(
  value: unknown,
): value is PersistedCommandPaletteCardSearchCacheRecord {
  return isPlainObject(value)
    && value.key === SEARCH_CACHE_RECORD_KEY
    && typeof value.version === "number"
    && Array.isArray(value.documentRefs)
    && value.documentRefs.every((entry) => isValidDocumentRef(entry))
    && isPlainObject(value.data);
}

export const commandPaletteCardSearchCacheStore: CommandPaletteCardSearchCacheStore = {
  async read() {
    if (typeof indexedDB === "undefined") {
      return null;
    }

    try {
      const database = await openCommandPaletteCardSearchDatabase();
      const transaction = database.transaction(SEARCH_CACHE_STORE_NAME, "readonly");
      const record = await requestToPromise(
        transaction.objectStore(SEARCH_CACHE_STORE_NAME).get(SEARCH_CACHE_RECORD_KEY),
      );
      await transactionToPromise(transaction);

      if (!isPersistedCommandPaletteCardSearchCacheRecord(record)) {
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
      const database = await openCommandPaletteCardSearchDatabase();
      const transaction = database.transaction(SEARCH_CACHE_STORE_NAME, "readwrite");
      transaction.objectStore(SEARCH_CACHE_STORE_NAME).put({
        key: SEARCH_CACHE_RECORD_KEY,
        updatedAt: new Date().toISOString(),
        version: snapshot.version,
        documentRefs: cloneDocumentRefs(snapshot.documentRefs),
        data: snapshot.data,
      } satisfies PersistedCommandPaletteCardSearchCacheRecord);
      await transactionToPromise(transaction);
    } catch {
      // Ignore cache write failures.
    }
  },
};

function reconcileCommandPaletteCardSearchIndex(
  miniSearch: MiniSearch<CommandPaletteCardSearchDocument>,
  source: CommandPaletteCardSearchSource,
  cachedDocumentRefs: CommandPaletteCardSearchDocumentRef[],
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

export function getCachedCommandPaletteCardSearchIndex(
  cards: CommandPaletteCard[],
): CommandPaletteCardSearchIndex | null {
  const source = buildCommandPaletteCardSearchSource(cards);
  if (!commandPaletteCardSearchRuntimeCache) {
    return null;
  }

  if (!hasMatchingDocumentRefs(commandPaletteCardSearchRuntimeCache.documentRefs, source.documentRefs)) {
    return null;
  }

  return createCommandPaletteCardSearchIndexFromSource(
    source,
    commandPaletteCardSearchRuntimeCache.miniSearch,
  );
}

export async function hydrateCommandPaletteCardSearchIndex(
  cards: CommandPaletteCard[],
  cacheStore: CommandPaletteCardSearchCacheStore = commandPaletteCardSearchCacheStore,
): Promise<CommandPaletteCardSearchIndex> {
  const source = buildCommandPaletteCardSearchSource(cards);
  if (commandPaletteCardSearchRuntimeCache
    && hasMatchingDocumentRefs(commandPaletteCardSearchRuntimeCache.documentRefs, source.documentRefs)) {
    return createCommandPaletteCardSearchIndexFromSource(
      source,
      commandPaletteCardSearchRuntimeCache.miniSearch,
    );
  }

  const persistedSnapshot = await cacheStore.read();
  let miniSearch = createMiniSearch();
  let shouldWriteSnapshot = source.documents.length > 0 || Boolean(persistedSnapshot);

  if (persistedSnapshot?.version === SEARCH_CACHE_VERSION) {
    try {
      miniSearch = await MiniSearch.loadJSAsync(
        persistedSnapshot.data,
        createCommandPaletteCardSearchOptions(),
      );
      shouldWriteSnapshot = reconcileCommandPaletteCardSearchIndex(
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
    await cacheStore.write(createCommandPaletteCardSearchSnapshot(source, miniSearch));
  }

  return createCommandPaletteCardSearchIndexFromSource(source, miniSearch);
}

export function createCommandPaletteCardSearchIndex(
  cards: CommandPaletteCard[],
): CommandPaletteCardSearchIndex {
  const source = buildCommandPaletteCardSearchSource(cards);
  const miniSearch = createMiniSearch();

  if (source.documents.length > 0) {
    miniSearch.addAll(source.documents);
  }

  cacheRuntimeSearchIndex(source.documentRefs, miniSearch);
  return createCommandPaletteCardSearchIndexFromSource(source, miniSearch);
}

export function createCommandPaletteCardFastSearchIndex(
  cards: CommandPaletteCard[],
): CommandPaletteCardSearchIndex {
  const records = cards.map((item): CommandPaletteCardFastSearchRecord => ({
    item,
    document: buildSearchDocument(item),
    status: normalizeCommandPaletteSearchText(CARD_STATUS_LABELS[item.card.status] ?? item.card.status),
  }));

  return {
    search(query) {
      const normalizedQuery = normalizeCommandPaletteSearchText(query);
      if (!normalizedQuery) return [];

      const terms = normalizedQuery.split(/\s+/).filter((term) => term.length > 0);
      if (terms.length === 0) return [];

      return records
        .map((record): CommandPaletteCardSearchHit | null => {
          const fields = [
            { value: record.document.title, boost: FAST_FIELD_BOOSTS.title },
            { value: record.document.description, boost: FAST_FIELD_BOOSTS.description },
            { value: record.document.tags, boost: FAST_FIELD_BOOSTS.tags },
            { value: record.document.assignee, boost: FAST_FIELD_BOOSTS.assignee },
            { value: record.document.agentStatus, boost: FAST_FIELD_BOOSTS.agentStatus },
            { value: record.status, boost: FAST_FIELD_BOOSTS.status },
            { value: record.document.columnName, boost: FAST_FIELD_BOOSTS.columnName },
            { value: record.document.projectName, boost: FAST_FIELD_BOOSTS.projectName },
            { value: record.document.cardId, boost: FAST_FIELD_BOOSTS.cardId },
          ];
          if (!terms.every((term) => fields.some((field) => field.value.includes(term)))) {
            return null;
          }

          const score = fields.reduce(
            (sum, field) => sum + scoreFastSearchField(field.value, normalizedQuery, terms, field.boost),
            0,
          );
          return {
            item: {
              ...record.item,
              searchPreview: buildDescriptionPreviewFromTerms(record.item, terms),
              searchDecorations: buildFastSearchDecorations(record, terms),
            },
            score,
          };
        })
        .filter((result): result is CommandPaletteCardSearchHit => result !== null);
    },
  };
}

export function resetCommandPaletteCardSearchCacheForTests(): void {
  commandPaletteCardSearchRuntimeCache = null;
}
