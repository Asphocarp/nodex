import MiniSearch, { type SearchResult } from "minisearch";
import { normalizeSearchText, resolveFuzzyThreshold, tokenizeSearchQuery } from "./search-text";

export type PageMetadataMatchQuality = "exact" | "prefix" | "fuzzy";

export interface PageMetadataSearchProperty {
  readonly propertyId: string;
  readonly propertyName: string;
  readonly text: string;
}

export interface PageMetadataSearchDocument {
  readonly id: string;
  readonly identity: string;
  readonly title: string;
  readonly properties: readonly PageMetadataSearchProperty[];
}

export interface PageMetadataSearchEvidence {
  readonly term: string;
  readonly source: "identity" | "title" | "property";
  readonly quality: PageMetadataMatchQuality;
  readonly excerpt: string;
  readonly propertyId?: string;
  readonly propertyName?: string;
}

export interface PageMetadataSearchHit {
  readonly id: string;
  readonly matchedTerms: readonly string[];
  readonly evidence: readonly PageMetadataSearchEvidence[];
  /** Private rank used only for deterministic fusion; never expose it on the tool wire. */
  readonly rank: number;
}

interface MiniSearchDocument {
  readonly id: string;
  readonly identity: string;
  readonly title: string;
  readonly properties: string;
}

const SEARCH_FIELDS: Array<keyof Omit<MiniSearchDocument, "id">> = [
  "identity",
  "title",
  "properties",
];

function fieldQuality(text: string, term: string): PageMetadataMatchQuality | null {
  const tokens = tokenizeSearchQuery(text);
  if (tokens.some((token) => token === term)) return "exact";
  if (term.length >= 2 && tokens.some((token) => token.startsWith(term))) return "prefix";
  return null;
}

function matchedFields(result: SearchResult): ReadonlySet<string> {
  return new Set(Object.values(result.match).flat());
}

function matchedTermsForField(result: SearchResult, field: string): ReadonlySet<string> {
  return new Set(
    Object.entries(result.match)
      .filter(([, fields]) => fields.includes(field))
      .map(([matchedTerm]) => matchedTerm),
  );
}

function evidenceForResult(
  source: PageMetadataSearchDocument,
  term: string,
  result: SearchResult,
): PageMetadataSearchEvidence[] {
  const fields = matchedFields(result);
  const evidence: PageMetadataSearchEvidence[] = [];
  if (fields.has("identity")) {
    evidence.push({
      term,
      source: "identity",
      quality: fieldQuality(source.identity, term) ?? "fuzzy",
      excerpt: source.identity,
    });
  }
  if (fields.has("title")) {
    evidence.push({
      term,
      source: "title",
      quality: fieldQuality(source.title, term) ?? "fuzzy",
      excerpt: source.title,
    });
  }
  if (fields.has("properties")) {
    const matchedTerms = matchedTermsForField(result, "properties");
    for (const property of source.properties) {
      const quality = fieldQuality(property.text, term);
      const propertyTokens = tokenizeSearchQuery(property.text);
      const hasMatchedIndexedTerm = propertyTokens.some((token) => matchedTerms.has(token));
      if (!quality && !hasMatchedIndexedTerm) continue;
      evidence.push({
        term,
        source: "property",
        quality: quality ?? "fuzzy",
        propertyId: property.propertyId,
        propertyName: property.propertyName,
        excerpt: property.text,
      });
    }
  }
  return evidence;
}

/** Search each normalized term independently so body and metadata can jointly satisfy AND. */
export function searchPageMetadata(
  documents: readonly PageMetadataSearchDocument[],
  query: string,
): readonly PageMetadataSearchHit[] {
  const terms = tokenizeSearchQuery(query).slice(0, 32);
  if (terms.length === 0 || documents.length === 0) return [];
  const sourceById = new Map(documents.map((document) => [document.id, document] as const));
  const miniSearch = new MiniSearch<MiniSearchDocument>({
    idField: "id",
    fields: SEARCH_FIELDS,
    storeFields: ["id"],
    processTerm: (term) => normalizeSearchText(term) || null,
  });
  miniSearch.addAll(
    documents.map((document) => ({
      id: document.id,
      identity: normalizeSearchText(document.identity),
      title: normalizeSearchText(document.title),
      properties: normalizeSearchText(
        document.properties.map((property) => property.text).join(" "),
      ),
    })),
  );

  const hits = new Map<
    string,
    {
      evidence: PageMetadataSearchEvidence[];
      matchedTerms: Set<string>;
      rank: number;
    }
  >();
  for (const [termIndex, term] of terms.entries()) {
    const exactIdentityResults = miniSearch.search(term, {
      fields: ["identity"],
      combineWith: "AND",
      prefix: (candidate) => candidate.length >= 2,
      fuzzy: false,
      boost: { identity: 10 },
    });
    const humanTextResults = miniSearch.search(term, {
      fields: ["title", "properties"],
      combineWith: "AND",
      prefix: (candidate) => candidate.length >= 2,
      fuzzy: resolveFuzzyThreshold,
      boost: { title: 8, properties: 4 },
    });
    const results = [...exactIdentityResults, ...humanTextResults].sort(
      (left, right) => right.score - left.score || String(left.id).localeCompare(String(right.id)),
    );
    results.forEach((result, resultIndex) => {
      const source = sourceById.get(String(result.id));
      if (!source) return;
      const hit = hits.get(source.id) ?? {
        evidence: [],
        matchedTerms: new Set<string>(),
        rank: 0,
      };
      hit.matchedTerms.add(term);
      hit.evidence.push(...evidenceForResult(source, term, result));
      hit.rank += 1 / (60 + termIndex + resultIndex);
      hits.set(source.id, hit);
    });
  }

  return [...hits.entries()].map(([id, hit]) => ({
    id,
    matchedTerms: [...hit.matchedTerms],
    evidence: hit.evidence,
    rank: hit.rank,
  }));
}
