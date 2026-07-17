import type Database from "better-sqlite3";

export const MAX_PAGE_HIERARCHY_DEPTH = 512;

export type PageHierarchyErrorCode =
  | "page_not_found"
  | "parent_not_found"
  | "ownership_cycle"
  | "depth_exceeded"
  | "library_mismatch";

export class PageHierarchyError extends Error {
  constructor(
    readonly code: PageHierarchyErrorCode,
    readonly pageId: string,
    message: string,
  ) {
    super(message);
    this.name = "PageHierarchyError";
  }
}

export type PageHierarchyTerminal =
  | {
      readonly kind: "library";
      readonly libraryId: string;
    }
  | {
      readonly kind: "data_source";
      readonly dataSourceId: string;
      readonly databaseId: string;
    };

export interface PageHierarchy {
  readonly pageId: string;
  readonly libraryId: string;
  /** Page IDs from the requested Page outward through its owning ancestors. */
  readonly pageIds: readonly string[];
  readonly terminal: PageHierarchyTerminal;
}

interface PageHierarchyRow {
  readonly block_id: string;
  readonly library_id: string;
  readonly parent_kind: "library" | "page" | "data_source";
  readonly parent_id: string;
  readonly lifecycle: "active" | "archived" | "deleted";
}

export interface InvalidPageHierarchy {
  readonly pageId: string;
  readonly error: PageHierarchyError;
}

const hierarchyError = (
  code: PageHierarchyErrorCode,
  pageId: string,
  message: string,
): never => {
  throw new PageHierarchyError(code, pageId, message);
};

/**
 * Resolve Page ownership from one cycle-safe recursive read. `UNION` is
 * intentional: malformed persisted cycles terminate in SQLite, then the
 * ordered walk below classifies the corruption instead of repeating rows.
 */
export const resolvePageHierarchy = (
  database: Database.Database,
  pageId: string,
): PageHierarchy => {
  const rows = database.prepare(`
    WITH RECURSIVE ancestors(
      block_id, library_id, parent_kind, parent_id, lifecycle
    ) AS (
      SELECT block_id, library_id, parent_kind, parent_id, lifecycle
      FROM pages
      WHERE block_id = ?
      UNION
      SELECT parent.block_id, parent.library_id, parent.parent_kind,
        parent.parent_id, parent.lifecycle
      FROM ancestors current
      INNER JOIN pages parent
        ON current.parent_kind = 'page'
        AND parent.block_id = current.parent_id
    )
    SELECT block_id, library_id, parent_kind, parent_id, lifecycle
    FROM ancestors
    LIMIT ?
  `).all(pageId, MAX_PAGE_HIERARCHY_DEPTH + 1) as readonly PageHierarchyRow[];
  const root = rows.find((row) => row.block_id === pageId);
  if (!root) {
    return hierarchyError(
      "page_not_found",
      pageId,
      `Page does not exist: ${pageId}`,
    );
  }

  const byId = new Map(rows.map((row) => [row.block_id, row]));
  const seen = new Set<string>();
  const pageIds: string[] = [];
  let currentId = pageId;

  while (true) {
    if (seen.has(currentId)) {
      return hierarchyError(
        "ownership_cycle",
        pageId,
        `Page ${pageId} ownership contains a cycle at Page ${currentId}`,
      );
    }
    if (pageIds.length >= MAX_PAGE_HIERARCHY_DEPTH) {
      return hierarchyError(
        "depth_exceeded",
        pageId,
        `Page ${pageId} ownership exceeds ${MAX_PAGE_HIERARCHY_DEPTH} Page levels`,
      );
    }

    const current = byId.get(currentId);
    if (!current) {
      return hierarchyError(
        "parent_not_found",
        pageId,
        `Page ${pageId} points to missing parent Page ${currentId}`,
      );
    }
    if (current.library_id !== root.library_id) {
      return hierarchyError(
        "library_mismatch",
        pageId,
        `Page ${current.block_id} belongs to another Library`,
      );
    }
    if (current.lifecycle === "deleted" && current.block_id !== pageId) {
      return hierarchyError(
        "parent_not_found",
        pageId,
        `Page ${pageId} points through deleted parent Page ${current.block_id}`,
      );
    }

    seen.add(currentId);
    pageIds.push(currentId);
    if (current.parent_kind === "page") {
      currentId = current.parent_id;
      continue;
    }

    if (current.parent_kind === "library") {
      const library = database.prepare(`
        SELECT id FROM libraries WHERE id = ?
      `).get(current.parent_id) as { readonly id: string } | undefined;
      if (!library || library.id !== root.library_id) {
        return hierarchyError(
          "parent_not_found",
          pageId,
          `Page ${pageId} has no matching root Library`,
        );
      }
      return {
        pageId,
        libraryId: root.library_id,
        pageIds,
        terminal: { kind: "library", libraryId: library.id },
      };
    }

    const source = database.prepare(`
      SELECT id, library_id, home_database_block_id, lifecycle
      FROM data_sources WHERE id = ?
    `).get(current.parent_id) as
      | {
          readonly id: string;
          readonly library_id: string;
          readonly home_database_block_id: string;
          readonly lifecycle: "active" | "archived" | "deleted";
        }
      | undefined;
    if (
      !source ||
      source.library_id !== root.library_id ||
      source.lifecycle === "deleted"
    ) {
      return hierarchyError(
        "parent_not_found",
        pageId,
        `Page ${pageId} has no matching root Data Source`,
      );
    }
    return {
      pageId,
      libraryId: root.library_id,
      pageIds,
      terminal: {
        kind: "data_source",
        dataSourceId: source.id,
        databaseId: source.home_database_block_id,
      },
    };
  }
};

export const findInvalidPageHierarchy = (
  database: Database.Database,
): InvalidPageHierarchy | null => {
  const pages = database.prepare(`
    SELECT block_id FROM pages ORDER BY block_id
  `).all() as readonly { readonly block_id: string }[];
  for (const page of pages) {
    try {
      resolvePageHierarchy(database, page.block_id);
    } catch (error) {
      if (!(error instanceof PageHierarchyError)) throw error;
      return { pageId: page.block_id, error };
    }
  }
  return null;
};
