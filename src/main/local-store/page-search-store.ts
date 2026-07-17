import type Database from "better-sqlite3";
import { isWorkflowStatus } from "../../shared/workflow-status";
import type { PageSearchInput, PageSearchResult } from "../../shared/types";
import { searchDocumentBlockUnits } from "./block-document-projections";
import { authorizeProjectResourceInDatabase } from "./project-resource-grants";

const MAX_PAGE_SEARCH_RESULTS = 100;
const MAX_DOCUMENT_HITS_PER_LIBRARY = 400;

interface SearchablePageStatusRow {
  readonly page_block_id: string;
  readonly value_json: string;
}

interface CandidateHit {
  readonly projectId: string;
  readonly pageId: string;
  readonly excerpt: string;
  readonly rank: number;
}

interface ProjectSearchScope {
  readonly projectId: string;
  readonly libraryId: string;
}

const requireProjectId = (value: string): string => {
  const projectId = value.trim();
  if (projectId) return projectId;
  throw new TypeError("Page search requires non-empty Project IDs");
};

const clampLimit = (value: number | undefined): number => {
  if (value === undefined || !Number.isFinite(value)) return 50;
  return Math.max(1, Math.min(Math.trunc(value), MAX_PAGE_SEARCH_RESULTS));
};

const readProjectSearchScopes = (
  database: Database.Database,
  projectIds: readonly string[],
): readonly ProjectSearchScope[] => {
  if (projectIds.length === 0) return [];
  const placeholders = projectIds.map(() => "?").join(", ");
  const rows = database.prepare(`
    SELECT id AS projectId, library_id AS libraryId
    FROM projects WHERE id IN (${placeholders})
  `).all(...projectIds) as readonly ProjectSearchScope[];
  const byId = new Map(rows.map((row) => [row.projectId, row] as const));
  return projectIds.flatMap((projectId) => {
    const row = byId.get(projectId);
    return row ? [row] : [];
  });
};

const readSearchableStatuses = (
  database: Database.Database,
  pageIds: readonly string[],
): ReadonlyMap<string, PageSearchResult["status"]> => {
  if (pageIds.length === 0) return new Map();
  const placeholders = pageIds.map(() => "?").join(", ");
  const rows = database
    .prepare(
      `
      SELECT
        membership.page_block_id,
        value.value_json
      FROM data_source_page_memberships membership
      INNER JOIN pages page ON page.block_id = membership.page_block_id
      INNER JOIN blocks page_block
        ON page_block.id = page.block_id
        AND page_block.type = 'page'
        AND page_block.lifecycle = 'active'
      INNER JOIN data_source_properties property
        ON property.data_source_id = membership.data_source_id
        AND property.id = 'status'
        AND property.lifecycle = 'active'
      INNER JOIN data_source_property_values value
        ON value.membership_id = membership.id
        AND value.property_id = property.id
        AND value.data_source_id = membership.data_source_id
      WHERE membership.removed_at IS NULL
        AND page.parent_kind = 'data_source'
        AND page.parent_id = membership.data_source_id
        AND membership.page_block_id IN (${placeholders})
    `,
    )
    .all(...pageIds) as readonly SearchablePageStatusRow[];

  const statuses = new Map<string, PageSearchResult["status"]>();
  for (const row of rows) {
    let value: unknown;
    try {
      value = JSON.parse(row.value_json) as unknown;
    } catch {
      continue;
    }
    if (!isWorkflowStatus(value)) continue;
    statuses.set(row.page_block_id, value);
  }
  return statuses;
};

/**
 * Search current Page Document title/body units within each requested Library,
 * authorize every candidate through current Project grants, and attach the
 * current Data Source status without consulting legacy Card authority.
 */
export const searchAuthoritativePages = (
  database: Database.Database,
  input: PageSearchInput,
): PageSearchResult[] => {
  const query = input.query.trim();
  if (!query) return [];
  const projectIds = Array.from(
    new Set(input.projectIds.map(requireProjectId)),
  );
  if (projectIds.length === 0) return [];
  const limit = clampLimit(input.limit);

  return database.transaction(() => {
    const scopes = readProjectSearchScopes(database, projectIds);
    const scopesByLibrary = new Map<string, ProjectSearchScope[]>();
    for (const scope of scopes) {
      const existing = scopesByLibrary.get(scope.libraryId) ?? [];
      existing.push(scope);
      scopesByLibrary.set(scope.libraryId, existing);
    }

    const bestHitByPage = new Map<string, CandidateHit>();
    for (const [libraryId, libraryScopes] of scopesByLibrary) {
      const hits = searchDocumentBlockUnits(database, {
        libraryId,
        query,
        ownerType: "page",
        includeArchived: false,
        limit: MAX_DOCUMENT_HITS_PER_LIBRARY,
      });
      for (const hit of hits) {
        const projectId = libraryScopes.find((scope) =>
          authorizeProjectResourceInDatabase(database, {
            projectId: scope.projectId,
            resource: { kind: "page", pageId: hit.ownerBlockId },
            action: "read",
          }).allowed,
        )?.projectId;
        if (!projectId) continue;

        const existing = bestHitByPage.get(hit.ownerBlockId);
        if (existing && existing.rank <= hit.rank) continue;
        bestHitByPage.set(hit.ownerBlockId, {
          projectId,
          pageId: hit.ownerBlockId,
          excerpt: hit.excerpt,
          rank: hit.rank,
        });
      }
    }

    const candidates = [...bestHitByPage.values()];
    const statuses = readSearchableStatuses(
      database,
      candidates.map((candidate) => candidate.pageId),
    );
    return candidates
      .flatMap((candidate) => {
        const status = statuses.get(candidate.pageId);
        return status ? [{ ...candidate, status }] : [];
      })
      .sort(
        (left, right) =>
          left.rank - right.rank ||
          left.projectId.localeCompare(right.projectId) ||
          left.pageId.localeCompare(right.pageId),
      )
      .slice(0, limit)
      .map((candidate, index) => ({
        projectId: candidate.projectId,
        pageId: candidate.pageId,
        status: candidate.status,
        score: Math.max(1, 1_000_000 - index),
        excerpt: candidate.excerpt,
      }));
  })();
};
