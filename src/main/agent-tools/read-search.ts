import type Database from "better-sqlite3";
import {
  searchPageMetadata,
  type PageMetadataSearchDocument,
  type PageMetadataSearchEvidence,
} from "../../shared/page-metadata-search";
import { formatDatabasePropertyDisplayValue } from "../../shared/database-property-display";
import { tokenizeSearchQuery } from "../../shared/search-text";
import {
  type JsonValue,
  type SearchInput,
} from "../../shared/nodex-agent-tools";
import type {
  DatabaseJsonValue,
  DatabasePropertyValueType,
} from "../../shared/database-kernel";
import {
  searchDocumentBlockUnits,
  type DocumentBlockSearchHit,
} from "../local-store/block-document-projections";
import {
  assertResponseSize,
  mintCursor,
  NodexAgentReadError,
  nodexAgentFingerprint,
  parseJsonValue,
  readCursorState,
  readProjectChangeLogSeq,
  requireProject,
  toBlockLocation,
} from "./read-support";

const MAX_METADATA_PAGES = 5_000;
const MAX_PROPERTY_VALUES_PER_PAGE = 64;
const MAX_PROPERTY_TEXT_BYTES_PER_PAGE = 32 * 1024;
const MAX_FTS_HITS_PER_TERM = 200;
const SEARCH_RANKING_REVISION = 1;

export interface PageSearchInput {
  readonly query: string;
  readonly target?: "pages" | "blocks";
  readonly scope?: SearchInput["scope"];
  readonly filters?: {
    readonly blockTypes?: readonly string[];
    readonly includeArchived?: boolean;
  };
  readonly page?: SearchInput["page"];
}

interface PageSearchRow {
  readonly block_id: string;
  readonly title: string;
  readonly location_kind: "space" | "document" | "database";
  readonly containing_document_id: string | null;
  readonly containing_database_id: string | null;
}

interface PropertySearchRow {
  readonly page_block_id: string;
  readonly property_id: string;
  readonly property_name: string;
  readonly value_type: DatabasePropertyValueType;
  readonly config_json: string;
  readonly value_json: string;
}

type RawPageMatch =
  | (PageMetadataSearchEvidence & { readonly term: string })
  | {
      readonly term: string;
      readonly source: "body";
      readonly quality: "exact" | "prefix";
      readonly blockId: string;
      readonly blockType: string;
      readonly excerpt: string;
    };

interface PageAggregate {
  readonly row: PageSearchRow;
  readonly matchedTerms: Set<string>;
  readonly evidence: RawPageMatch[];
  rank: number;
}

function validateScope(
  database: Database.Database,
  projectId: string,
  scope: PageSearchInput["scope"],
): void {
  if (!scope || scope.kind === "project") return;
  if (scope.kind === "database") {
    const row = database.prepare(
      `SELECT 1 AS present
       FROM database_containers container
       INNER JOIN projects project ON project.library_id = container.library_id
       WHERE container.block_id = ? AND project.id = ?
         AND container.lifecycle <> 'deleted'
       LIMIT 1`,
    ).get(scope.databaseBlockId, projectId);
    if (row) return;
  } else {
    const row = database.prepare(
      "SELECT 1 AS present FROM documents WHERE id = ? AND project_id = ? LIMIT 1",
    ).get(scope.documentId, projectId);
    if (row) return;
  }
  const resourceId = scope.kind === "database"
    ? scope.databaseBlockId
    : scope.documentId;
  throw new NodexAgentReadError(
    "not_found",
    `Search scope ${resourceId} was not found in the bound Project`,
    false,
    "none",
    { resourceId, domainCode: `${scope.kind}_not_found` },
  );
}

function readPageRows(
  database: Database.Database,
  projectId: string,
  input: PageSearchInput,
): readonly PageSearchRow[] {
  const conditions = [
    "page.project_id = ?",
    "page.type = 'page'",
    input.filters?.includeArchived ? "page.lifecycle <> 'deleted'" : "page.lifecycle = 'active'",
    "document.readiness = 'ready'",
    "materialization.generation = document.generation",
    "materialization.projected_seq = document.head_seq",
    "materialization.schema_version = document.schema_version",
  ];
  const parameters: Array<string | number> = [projectId];
  const scope = input.scope;
  if (scope?.kind === "database") {
    conditions.push("page.location_kind = 'database'", "page.containing_database_id = ?");
    parameters.push(scope.databaseBlockId);
  }
  if (scope?.kind === "document") {
    conditions.push("(ownership.document_id = ? OR page.containing_document_id = ?)");
    parameters.push(scope.documentId, scope.documentId);
  }
  parameters.push(MAX_METADATA_PAGES + 1);
  const rows = database.prepare(
    `
    SELECT
      page.id AS block_id, materialization.title,
      page.location_kind, page.containing_document_id,
      page.containing_database_id
    FROM blocks page
    INNER JOIN block_documents ownership
      ON ownership.block_id = page.id
     AND ownership.project_id = page.project_id
    INNER JOIN documents document
      ON document.id = ownership.document_id
     AND document.project_id = ownership.project_id
    INNER JOIN document_materializations materialization
      ON materialization.document_id = document.id
    WHERE ${conditions.join(" AND ")}
    ORDER BY page.id
    LIMIT ?
  `).all(...parameters) as readonly PageSearchRow[];
  if (rows.length <= MAX_METADATA_PAGES) return rows;
  throw new NodexAgentReadError(
    "result_too_large",
    "The requested Page-search scope is too large for the bounded metadata index",
    false,
    "none",
    { domainCode: "metadata_scope_too_large" },
  );
}

function readPropertyRows(
  database: Database.Database,
  projectId: string,
  pageIds: readonly string[],
): readonly PropertySearchRow[] {
  if (pageIds.length === 0) return [];
  const placeholders = pageIds.map(() => "?").join(", ");
  return database.prepare(
    `
    SELECT
      membership.page_block_id AS page_block_id,
      property.id AS property_id,
      property.name AS property_name,
      property.value_type,
      property.config_json,
      value.value_json
    FROM data_source_page_memberships membership
    INNER JOIN blocks page
      ON page.id = membership.page_block_id
     AND page.project_id = ?
    INNER JOIN data_source_properties property
      ON property.data_source_id = membership.data_source_id
     AND property.lifecycle = 'active'
    INNER JOIN data_source_property_values value
      ON value.membership_id = membership.id
     AND value.property_id = property.id
     AND value.data_source_id = membership.data_source_id
    WHERE membership.removed_at IS NULL
      AND membership.page_block_id IN (${placeholders})
    ORDER BY membership.page_block_id, property.rank_key, property.id
  `).all(projectId, ...pageIds) as readonly PropertySearchRow[];
}

function buildMetadataDocuments(
  pageRows: readonly PageSearchRow[],
  propertyRows: readonly PropertySearchRow[],
): readonly PageMetadataSearchDocument[] {
  const properties = new Map<string, PageMetadataSearchDocument["properties"][number][]>();
  const bytes = new Map<string, number>();
  for (const row of propertyRows) {
    const current = properties.get(row.page_block_id) ?? [];
    if (current.length >= MAX_PROPERTY_VALUES_PER_PAGE) continue;
    const config = parseJsonValue(row.config_json, `Database property ${row.property_id} config`);
    if (typeof config !== "object" || config === null || Array.isArray(config)) continue;
    const value = parseJsonValue(row.value_json, `Database value ${row.property_id}`);
    const text = formatDatabasePropertyDisplayValue(
      {
        valueType: row.value_type,
        config: config as Readonly<Record<string, DatabaseJsonValue>>,
      },
      value as DatabaseJsonValue,
    );
    if (!text) continue;
    const nextBytes = (bytes.get(row.page_block_id) ?? 0) + Buffer.byteLength(text, "utf8");
    if (nextBytes > MAX_PROPERTY_TEXT_BYTES_PER_PAGE) continue;
    current.push({
      propertyId: row.property_id,
      propertyName: row.property_name,
      text,
    });
    properties.set(row.page_block_id, current);
    bytes.set(row.page_block_id, nextBytes);
  }
  return pageRows.map((row) => ({
    id: row.block_id,
    identity: row.block_id,
    title: row.title,
    properties: properties.get(row.block_id) ?? [],
  }));
}

function ftsScope(input: PageSearchInput): {
  readonly databaseBlockId?: string;
  readonly documentId?: string;
} {
  if (input.scope?.kind === "database") {
    return { databaseBlockId: input.scope.databaseBlockId };
  }
  if (input.scope?.kind === "document") {
    return { documentId: input.scope.documentId };
  }
  return {};
}

function exactOrPrefix(excerpt: string, term: string): "exact" | "prefix" {
  const tokens = tokenizeSearchQuery(excerpt);
  return tokens.includes(term) ? "exact" : "prefix";
}

function matchTier(match: RawPageMatch): number {
  if (match.source === "identity") return 0;
  if (match.source === "title") return match.quality === "fuzzy" ? 2 : 1;
  if (match.source === "property") return match.quality === "fuzzy" ? 5 : 3;
  return 4;
}

function evidenceKey(match: RawPageMatch): string {
  if (match.source === "property") return `${match.term}:property:${match.propertyId}:${match.excerpt}`;
  if (match.source === "body") return `${match.term}:body:${match.blockId}:${match.excerpt}`;
  return `${match.term}:${match.source}:${match.excerpt}`;
}

function representativeEvidence(
  evidence: readonly RawPageMatch[],
  terms: readonly string[],
): readonly Omit<RawPageMatch, "term">[] {
  const unique = [...new Map(evidence.map((match) => [evidenceKey(match), match])).values()]
    .sort((left, right) =>
      matchTier(left) - matchTier(right)
      || terms.indexOf(left.term) - terms.indexOf(right.term)
      || evidenceKey(left).localeCompare(evidenceKey(right))
    );
  const selected: RawPageMatch[] = [];
  for (const term of terms) {
    const match = unique.find((candidate) => candidate.term === term && !selected.includes(candidate));
    if (match) selected.push(match);
    if (selected.length === 3) break;
  }
  for (const match of unique) {
    if (selected.length === 3) break;
    if (!selected.includes(match)) selected.push(match);
  }
  return selected.map((match) => {
    if (match.source === "body") {
      return {
        source: match.source,
        quality: match.quality,
        blockId: match.blockId,
        blockType: match.blockType,
        excerpt: match.excerpt,
      };
    }
    if (match.source === "property") {
      return {
        source: match.source,
        quality: match.quality,
        propertyId: match.propertyId,
        propertyName: match.propertyName,
        excerpt: match.excerpt,
      };
    }
    return {
      source: match.source,
      quality: match.quality,
      excerpt: match.excerpt,
    };
  });
}

function searchPages(
  database: Database.Database,
  projectId: string,
  input: PageSearchInput,
): readonly {
  readonly kind: "page";
  readonly blockId: string;
  readonly title: string;
  readonly location: ReturnType<typeof toBlockLocation>;
  readonly matches: readonly Omit<RawPageMatch, "term">[];
}[] {
  const terms = tokenizeSearchQuery(input.query).slice(0, 32);
  const rows = readPageRows(database, projectId, input);
  const rowById = new Map(rows.map((row) => [row.block_id, row] as const));
  const metadataDocuments = buildMetadataDocuments(
    rows,
    readPropertyRows(database, projectId, rows.map((row) => row.block_id)),
  );
  const aggregates = new Map<string, PageAggregate>();
  for (const hit of searchPageMetadata(metadataDocuments, input.query)) {
    const row = rowById.get(hit.id);
    if (!row) continue;
    aggregates.set(hit.id, {
      row,
      matchedTerms: new Set(hit.matchedTerms),
      evidence: [...hit.evidence],
      rank: hit.rank,
    });
  }

  for (const [termIndex, term] of terms.entries()) {
    const hits = searchDocumentBlockUnits(database, {
      projectId,
      query: term,
      ownerType: "page",
      includeArchived: input.filters?.includeArchived === true,
      sourceKinds: ["document_title", "document_block"],
      ...ftsScope(input),
      limit: MAX_FTS_HITS_PER_TERM,
    });
    hits.forEach((hit, hitIndex) => {
      const row = rowById.get(hit.ownerBlockId);
      if (!row) return;
      const aggregate = aggregates.get(hit.ownerBlockId) ?? {
        row,
        matchedTerms: new Set<string>(),
        evidence: [],
        rank: 0,
      };
      aggregate.matchedTerms.add(term);
      const quality = exactOrPrefix(hit.excerpt, term);
      aggregate.evidence.push(hit.sourceKind === "document_title"
        ? {
          term,
          source: "title",
          quality,
          excerpt: hit.excerpt,
        }
        : {
          term,
          source: "body",
          quality,
          blockId: hit.blockId,
          blockType: hit.blockType,
          excerpt: hit.excerpt,
        });
      aggregate.rank += 1 / (60 + termIndex + hitIndex);
      aggregates.set(hit.ownerBlockId, aggregate);
    });
  }

  return [...aggregates.values()]
    .filter((aggregate) => terms.every((term) => aggregate.matchedTerms.has(term)))
    .sort((left, right) => {
      const leftTier = Math.min(...left.evidence.map(matchTier));
      const rightTier = Math.min(...right.evidence.map(matchTier));
      return leftTier - rightTier
        || right.rank - left.rank
        || left.row.block_id.localeCompare(right.row.block_id);
    })
    .map((aggregate) => ({
      kind: "page",
      blockId: aggregate.row.block_id,
      title: aggregate.row.title,
      location: toBlockLocation(aggregate.row),
      matches: representativeEvidence(aggregate.evidence, terms),
    }));
}

function searchBlocks(
  database: Database.Database,
  projectId: string,
  input: PageSearchInput & { readonly target: "blocks" },
  pageOwnedBlocksOnly: boolean,
): readonly {
  readonly kind: "block";
  readonly blockId: string;
  readonly blockType: string;
  readonly ownerBlockId: string;
  readonly documentId: string;
  readonly source: "title" | "body";
  readonly quality: "exact" | "prefix";
  readonly excerpt: string;
}[] {
  const terms = tokenizeSearchQuery(input.query).slice(0, 32);
  return searchDocumentBlockUnits(database, {
    projectId,
    query: input.query,
    ...(pageOwnedBlocksOnly ? { ownerType: "page" as const } : {}),
    includeArchived: input.filters?.includeArchived === true,
    sourceKinds: ["document_title", "document_block"],
    blockTypes: input.filters?.blockTypes,
    ...ftsScope(input),
    limit: MAX_FTS_HITS_PER_TERM,
  }).map((hit: DocumentBlockSearchHit) => ({
    kind: "block",
    blockId: hit.blockId,
    blockType: hit.blockType,
    ownerBlockId: hit.ownerBlockId,
    documentId: hit.documentId,
    source: hit.sourceKind === "document_title" ? "title" : "body",
    quality: terms.every((term) => exactOrPrefix(hit.excerpt, term) === "exact")
      ? "exact"
      : "prefix",
    excerpt: hit.excerpt,
  }));
}

export function readNodexAgentSearch(
  database: Database.Database,
  projectId: string,
  input: PageSearchInput,
  options: { readonly pageOwnedBlocksOnly?: boolean } = {},
) {
  requireProject(database, projectId);
  validateScope(database, projectId, input.scope);
  const target = input.target ?? "pages";
  const changeLogSeq = readProjectChangeLogSeq(database, projectId);
  const fingerprint = nodexAgentFingerprint({
    target,
    pageOwnedBlocksOnly: options.pageOwnedBlocksOnly === true,
    query: input.query,
    scope: input.scope ?? { kind: "project" },
    filters: input.filters ?? {},
  });
  const cursorState = {
    fingerprint,
    changeLogSeq,
    rankingRevision: SEARCH_RANKING_REVISION,
  } satisfies Readonly<Record<string, JsonValue>>;
  const { offset } = readCursorState(database, {
    token: input.page?.cursor,
    projectId,
    subject: ["search", target],
    expected: cursorState,
  });
  const allResults = target === "blocks"
    ? searchBlocks(
      database,
      projectId,
      input as PageSearchInput & { readonly target: "blocks" },
      options.pageOwnedBlocksOnly === true,
    )
    : searchPages(database, projectId, input);
  const limit = input.page?.limit ?? 20;
  const results = allResults.slice(offset, offset + limit);
  const nextOffset = offset + results.length;
  const hasMore = nextOffset < allResults.length;
  const rawOutput = {
    data: { target, results },
    page: {
      hasMore,
      ...(hasMore ? {
        nextCursor: mintCursor(database, {
          projectId,
          subject: ["search", target],
          offset: nextOffset,
          state: cursorState,
        }),
      } : {}),
    },
  };
  assertResponseSize(rawOutput);
  return rawOutput;
}
