import MiniSearch, { type Options, type SearchResult } from "minisearch";
import {
  buildCommandPaletteHighlightedSegments,
  buildCommandPaletteHighlightRegex,
  buildCommandPaletteHighlightSegments,
  normalizeCommandPalettePreviewText,
} from "./command-palette-highlight";
import { normalizeSearchText, resolveFuzzyThreshold } from "./search-text";
import type {
  CommandPaletteThread,
  CommandPaletteThreadSearchDecorations,
  CommandPaletteThreadSearchPreview,
} from "./command-palette";

interface CommandPaletteThreadSearchDocument {
  id: string;
  title: string;
  preview: string;
  projectName: string;
  cwd: string;
  gitBranch: string;
  threadId: string;
}

export interface CommandPaletteThreadSearchHit {
  item: CommandPaletteThread;
  score: number;
  fieldPriority: number;
}

export interface CommandPaletteThreadSearchIndex {
  search: (query: string) => CommandPaletteThreadSearchHit[];
}

const SEARCH_FIELDS: Array<keyof CommandPaletteThreadSearchDocument> = [
  "title",
  "preview",
  "projectName",
  "cwd",
  "gitBranch",
  "threadId",
];

const FIELD_BOOSTS: Partial<Record<keyof CommandPaletteThreadSearchDocument, number>> = {
  title: 8,
  preview: 4,
  projectName: 3,
  cwd: 2,
  gitBranch: 2.5,
  threadId: 1,
};

const FIELD_PRIORITIES: Record<keyof CommandPaletteThreadSearchDocument, number> = {
  id: Number.MAX_SAFE_INTEGER,
  title: 0,
  preview: 1,
  gitBranch: 2,
  projectName: 3,
  cwd: 3,
  threadId: 4,
};

const EXCERPT_BEFORE = 80;
const EXCERPT_AFTER = 180;

function normalizeCommandPaletteThreadSearchText(value: string): string {
  return normalizeSearchText(value);
}

function buildSearchDocument(item: CommandPaletteThread): CommandPaletteThreadSearchDocument {
  return {
    id: item.id,
    title: normalizeCommandPaletteThreadSearchText(item.title),
    preview: normalizeCommandPaletteThreadSearchText(item.preview),
    projectName: normalizeCommandPaletteThreadSearchText(item.projectName ?? "Chats"),
    cwd: normalizeCommandPaletteThreadSearchText(item.cwd ?? ""),
    gitBranch: normalizeCommandPaletteThreadSearchText(item.gitBranch ?? ""),
    threadId: normalizeCommandPaletteThreadSearchText(item.threadId),
  };
}

function createMiniSearch(): MiniSearch<CommandPaletteThreadSearchDocument> {
  return new MiniSearch<CommandPaletteThreadSearchDocument>({
    fields: SEARCH_FIELDS,
    idField: "id",
    storeFields: ["id"],
    processTerm: (term) => {
      const normalized = normalizeCommandPaletteThreadSearchText(term);
      return normalized.length > 0 ? normalized : null;
    },
  } satisfies Options<CommandPaletteThreadSearchDocument>);
}

function collectMatchedTermsForField(
  result: SearchResult,
  field: keyof CommandPaletteThreadSearchDocument,
): string[] {
  return result.terms.filter((term) => result.match[term]?.includes(field));
}

function buildSearchDecorations(
  item: CommandPaletteThread,
  result: SearchResult,
): CommandPaletteThreadSearchDecorations | null {
  const titleSegments = buildCommandPaletteHighlightedSegments(
    item.title || "New thread",
    collectMatchedTermsForField(result, "title"),
  );
  const projectNameSegments = buildCommandPaletteHighlightedSegments(
    item.projectName ?? "Chats",
    collectMatchedTermsForField(result, "projectName"),
  );
  const cwdSegments = buildCommandPaletteHighlightedSegments(
    item.cwd ?? "",
    collectMatchedTermsForField(result, "cwd"),
  );
  const gitBranchSegments = buildCommandPaletteHighlightedSegments(
    item.gitBranch ?? "",
    collectMatchedTermsForField(result, "gitBranch"),
  );

  if (!titleSegments && !projectNameSegments && !cwdSegments && !gitBranchSegments) {
    return null;
  }

  return {
    titleSegments,
    projectNameSegments,
    cwdSegments,
    gitBranchSegments,
  };
}

function resolveMatchedFieldPriority(result: SearchResult): number {
  return SEARCH_FIELDS.reduce(
    (priority, field) =>
      collectMatchedTermsForField(result, field).length > 0
        ? Math.min(priority, FIELD_PRIORITIES[field])
        : priority,
    Number.MAX_SAFE_INTEGER,
  );
}

function buildPreview(
  item: CommandPaletteThread,
  result: SearchResult,
): CommandPaletteThreadSearchPreview | null {
  const preview = normalizeCommandPalettePreviewText(item.preview);
  if (!preview) {
    return null;
  }

  const previewTerms = collectMatchedTermsForField(result, "preview");
  if (previewTerms.length === 0) {
    return null;
  }

  const regex = buildCommandPaletteHighlightRegex(previewTerms);
  if (!regex) {
    return null;
  }

  regex.lastIndex = 0;
  const firstMatch = regex.exec(preview);
  if (!firstMatch) {
    return null;
  }

  const from = Math.max(0, firstMatch.index - EXCERPT_BEFORE);
  const to = Math.min(preview.length, firstMatch.index + firstMatch[0].length + EXCERPT_AFTER);
  const excerpt = `${from > 0 ? "…" : ""}${preview.slice(from, to).trim()}${to < preview.length ? "…" : ""}`;

  return {
    excerpt,
    source: "metadata",
    segments: buildCommandPaletteHighlightSegments(
      excerpt,
      buildCommandPaletteHighlightRegex(previewTerms),
    ),
  };
}

export function createCommandPaletteThreadSearchIndex(
  threads: CommandPaletteThread[],
): CommandPaletteThreadSearchIndex {
  const itemsById = new Map(threads.map((item) => [item.id, item] as const));
  const miniSearch = createMiniSearch();

  if (threads.length > 0) {
    miniSearch.addAll(threads.map(buildSearchDocument));
  }

  return {
    search(query) {
      const normalizedQuery = normalizeCommandPaletteThreadSearchText(query);
      if (!normalizedQuery) return [];

      return miniSearch
        .search(normalizedQuery, {
          combineWith: "AND",
          prefix: (term) => term.length >= 2,
          fuzzy: resolveFuzzyThreshold,
          boost: FIELD_BOOSTS,
        })
        .map((result): CommandPaletteThreadSearchHit | null => {
          const item = itemsById.get(String(result.id));
          if (!item) return null;
          return {
            item: {
              ...item,
              searchPreview: buildPreview(item, result),
              searchDecorations: buildSearchDecorations(item, result),
            },
            score: result.score,
            fieldPriority: resolveMatchedFieldPriority(result),
          };
        })
        .filter((result): result is CommandPaletteThreadSearchHit => result !== null);
    },
  };
}
