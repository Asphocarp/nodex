import type Database from "better-sqlite3";
import { createHash } from "node:crypto";

import {
  parseDatabaseId,
  parseDatabaseViewId,
  parseDataSourceId,
} from "../../shared/database-identities";
import type { DatabaseViewKind } from "../../shared/database-kernel";
import type { PageParent } from "../../shared/page";
import {
  createPageDocumentGenesis,
} from "../../shared/block-documents/block-document-codec";
import {
  PAGE_DOCUMENT_SCHEMA_KEY,
  PAGE_DOCUMENT_SCHEMA_VERSION,
} from "../../shared/block-documents/page-document";
import { DOCUMENT_OPERATION_CONTRACT_VERSION } from "../../shared/block-documents/document-operations";
import { planFractionalRank, type FractionalRankedItem } from "../../shared/fractional-rank";
import {
  LIBRARY_MODULE_CONTRACT_VERSION,
  type LibraryCatalogEntry,
  type LibraryApplyOperation,
  type LibraryDatabaseNavigationNode,
  type LibraryModuleApplyReceipt,
  type LibraryModuleApplyRequest,
  type LibraryModuleApplyResult,
  type LibraryModuleErrorCode,
  type LibraryModuleReadRequest,
  type LibraryModuleReadResult,
  type LibraryNavigationNode,
  type LibraryNavigationParent,
  type LibraryPageNavigationNode,
  type LibraryReadValue,
  type LibraryRouteTarget,
  type LibraryViewNavigationNode,
  type LibraryWriteParent,
} from "../../shared/library-module";
import {
  parseLibraryModuleApplyResult,
  libraryModuleFailure,
  resolveLibraryReadLimit,
} from "../../shared/library-module-transport";
import { requireBlockStoreEpoch } from "./block-store-metadata";
import {
  decodeLibraryCursor,
  LibraryCursorError,
  mintLibraryCursor,
} from "./library-cursor-codec";
import { requireLocalProfileLibraryInDatabase } from "./local-profile-library";
import {
  AuthoritativeOperationReceiptError,
  persistAuthoritativeOperationReceipt,
  prepareAuthoritativeOperation,
} from "./authoritative-operation-receipts";
import { initializePageDocumentGenesis } from "./block-document-store";
import { applyDocumentOperationBatch } from "./block-document-operations";
import { createDatabaseAuthorityRecordsInDatabase } from "./initial-database-authority";
import { insertDefaultPageIntrinsicProperties } from "./default-page-intrinsic-properties";
import {
  applyLibraryContentRehomeInTransaction,
  prepareLibraryContentRehome,
} from "./library-content-rehome";
import {
  authorizeProjectResourceInDatabase,
  putProjectResourceGrantInDatabase,
} from "./project-resource-grants";
import { resolvePageHierarchy } from "./page-hierarchy";
import {
  PageStoreStateError,
  readPageInDatabase,
  readPagesInDatabase,
} from "./pages";

interface BlockShellRow {
  readonly id: string;
  readonly type: "page" | "database";
}

interface DatabaseNodeRow {
  readonly databaseId: string;
  readonly title: string;
  readonly defaultViewId: string | null;
  readonly metadataRevision: number;
  readonly locationRevision: number;
  readonly updatedAt: string;
  readonly viewCount: number;
}

interface ViewNodeRow {
  readonly viewId: string;
  readonly databaseId: string;
  readonly dataSourceId: string;
  readonly title: string;
  readonly viewKind: DatabaseViewKind;
  readonly defaultViewId: string | null;
  readonly revision: number;
}

export class LibraryModuleStateError extends Error {
  public constructor(
    public readonly code: Exclude<LibraryModuleErrorCode, "unknown">,
    message: string,
  ) {
    super(message);
    this.name = "LibraryModuleStateError";
  }
}

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const readChangeLogSeq = (database: Database.Database): number =>
  (database.prepare(`
    SELECT COALESCE(MAX(seq), 0) AS seq FROM change_log
  `).get() as { readonly seq: number }).seq;

const readDatabaseNodes = (
  database: Database.Database,
  databaseIds: readonly string[],
): ReadonlyMap<string, LibraryDatabaseNavigationNode> => {
  if (databaseIds.length === 0) return new Map();
  const placeholders = databaseIds.map(() => "?").join(", ");
  const rows = database.prepare(`
    SELECT container.block_id AS databaseId, container.name AS title,
      container.default_view_id AS defaultViewId,
      container.metadata_revision AS metadataRevision,
      block.location_revision AS locationRevision,
      container.updated_at AS updatedAt,
      COUNT(view.id) AS viewCount
    FROM database_containers container
    INNER JOIN blocks block ON block.id = container.block_id
    LEFT JOIN database_views view
      ON view.database_block_id = container.block_id
      AND view.lifecycle = 'active'
    WHERE container.block_id IN (${placeholders})
      AND container.lifecycle = 'active'
    GROUP BY container.block_id
    ORDER BY container.block_id
  `).all(...databaseIds) as readonly DatabaseNodeRow[];
  return new Map(rows.map((row) => {
    if (!row.defaultViewId) {
      throw new LibraryModuleStateError(
        "state_corrupt",
        `Database ${row.databaseId} has no default View`,
      );
    }
    const node: LibraryDatabaseNavigationNode = {
      kind: "database",
      databaseId: parseDatabaseId(row.databaseId),
      title: row.title,
      defaultViewId: parseDatabaseViewId(row.defaultViewId),
      hasMultipleViews: row.viewCount > 1,
      metadataRevision: row.metadataRevision,
      locationRevision: row.locationRevision,
      updatedAt: row.updatedAt,
    };
    return [row.databaseId, node] as const;
  }));
};

const pageHasChildren = (
  database: Database.Database,
  documentId: string,
): boolean => Boolean(database.prepare(`
  SELECT 1
  FROM document_block_index projection
  INNER JOIN blocks block ON block.id = projection.block_id
  LEFT JOIN pages page ON page.block_id = block.id
  LEFT JOIN database_containers container ON container.block_id = block.id
  WHERE projection.document_id = ?
    AND block.type IN ('page', 'database')
    AND block.lifecycle = 'active'
    AND COALESCE(page.lifecycle, container.lifecycle) = 'active'
  LIMIT 1
`).get(documentId));

const readPageNodes = (
  database: Database.Database,
  pageIds: readonly string[],
): ReadonlyMap<string, LibraryPageNavigationNode> => {
  let pages;
  try {
    pages = readPagesInDatabase(database, pageIds);
  } catch (error) {
    if (!(error instanceof PageStoreStateError)) throw error;
    throw new LibraryModuleStateError("state_corrupt", error.message);
  }
  return new Map([...pages].map(([pageId, page]) => [pageId, {
    kind: "page",
    pageId,
    title: page.title,
    hasChildren: pageHasChildren(database, page.documentId),
    parentRevision: page.parentRevision,
    metadataRevision: page.metadataRevision,
    documentGeneration: page.documentGeneration,
    documentHeadSeq: page.documentHeadSeq,
    updatedAt: page.updatedAt,
  }] as const));
};

const hydrateShells = (
  database: Database.Database,
  shells: readonly BlockShellRow[],
): readonly LibraryNavigationNode[] => {
  const pageNodes = readPageNodes(
    database,
    shells.filter((shell) => shell.type === "page").map((shell) => shell.id),
  );
  const databaseNodes = readDatabaseNodes(
    database,
    shells.filter((shell) => shell.type === "database").map((shell) => shell.id),
  );
  return shells.map((shell) => {
    const node = shell.type === "page"
      ? pageNodes.get(shell.id)
      : databaseNodes.get(shell.id);
    if (node) return node;
    throw new LibraryModuleStateError(
      "state_corrupt",
      `${shell.type === "page" ? "Page" : "Database"} ${shell.id} has no active Library projection`,
    );
  });
};

const readRootShells = (
  database: Database.Database,
  libraryId: string,
): readonly BlockShellRow[] => database.prepare(`
  SELECT block.id, block.type
  FROM library_block_placements placement
  INNER JOIN blocks block ON block.id = placement.block_id
  LEFT JOIN pages page ON page.block_id = block.id
  LEFT JOIN database_containers container ON container.block_id = block.id
  WHERE placement.library_id = ?
    AND block.type IN ('page', 'database')
    AND block.lifecycle = 'active'
    AND COALESCE(page.lifecycle, container.lifecycle) = 'active'
  ORDER BY placement.rank_key, block.id
`).all(libraryId) as readonly BlockShellRow[];

const readPageChildShells = (
  database: Database.Database,
  libraryId: string,
  pageId: string,
): readonly BlockShellRow[] => {
  let page;
  try {
    page = readPageInDatabase(database, pageId);
  } catch (error) {
    if (!(error instanceof PageStoreStateError)) throw error;
    throw new LibraryModuleStateError("state_corrupt", error.message);
  }
  if (!page || page.libraryId !== libraryId || page.lifecycle !== "active") {
    throw new LibraryModuleStateError(
      "resource_not_found",
      `Page ${pageId} is not available in this Library`,
    );
  }
  return database.prepare(`
    WITH RECURSIVE ordered(block_id, path) AS (
      SELECT projection.block_id,
        printf('%010d', projection.ordinal) || ':' || projection.block_id
      FROM document_block_index projection
      WHERE projection.document_id = ? AND projection.parent_block_id IS NULL
      UNION ALL
      SELECT child.block_id,
        ordered.path || '/' || printf('%010d', child.ordinal) || ':' || child.block_id
      FROM ordered
      INNER JOIN document_block_index child
        ON child.document_id = ? AND child.parent_block_id = ordered.block_id
    )
    SELECT block.id, block.type
    FROM ordered
    INNER JOIN blocks block ON block.id = ordered.block_id
    LEFT JOIN pages nested_page ON nested_page.block_id = block.id
    LEFT JOIN database_containers container ON container.block_id = block.id
    WHERE block.type IN ('page', 'database')
      AND block.lifecycle = 'active'
      AND COALESCE(nested_page.lifecycle, container.lifecycle) = 'active'
    ORDER BY ordered.path
  `).all(page.documentId, page.documentId) as readonly BlockShellRow[];
};

const readViewNodes = (
  database: Database.Database,
  libraryId: string,
  databaseId: string,
): readonly LibraryViewNavigationNode[] => {
  const container = database.prepare(`
    SELECT 1 FROM database_containers
    WHERE block_id = ? AND library_id = ? AND lifecycle = 'active'
  `).get(databaseId, libraryId);
  if (!container) {
    throw new LibraryModuleStateError(
      "resource_not_found",
      `Database ${databaseId} is not available in this Library`,
    );
  }
  const rows = database.prepare(`
    SELECT view.id AS viewId, view.database_block_id AS databaseId,
      view.data_source_id AS dataSourceId, view.name AS title,
      view.kind AS viewKind, container.default_view_id AS defaultViewId,
      view.revision
    FROM database_views view
    INNER JOIN database_containers container
      ON container.block_id = view.database_block_id
    WHERE view.database_block_id = ? AND view.lifecycle = 'active'
    ORDER BY view.rank_key, view.id
  `).all(databaseId) as readonly ViewNodeRow[];
  return rows.map((row) => ({
    kind: "view",
    viewId: parseDatabaseViewId(row.viewId),
    databaseId: parseDatabaseId(row.databaseId),
    dataSourceId: parseDataSourceId(row.dataSourceId),
    title: row.title,
    viewKind: row.viewKind,
    isDefault: row.viewId === row.defaultViewId,
    revision: row.revision,
  }));
};

const parentSubject = (parent: LibraryNavigationParent): readonly string[] => {
  if (parent.kind === "library") return ["children", "library"];
  if (parent.kind === "page") return ["children", "page", parent.pageId];
  return ["children", "database", parent.databaseId];
};

const nodeMatchesTarget = (
  node: LibraryNavigationNode,
  target: LibraryRouteTarget,
): boolean => node.kind === target.kind && (
  node.kind === "page" && target.kind === "page"
    ? node.pageId === target.pageId
    : node.kind === "database" && target.kind === "database"
      ? node.databaseId === target.databaseId
      : node.kind === "view" && target.kind === "view"
        ? node.viewId === target.viewId
        : false
);

const readChildren = (
  database: Database.Database,
  input: Readonly<{
    libraryId: string;
    changeLogSeq: number;
    request: Extract<LibraryModuleReadRequest["read"], { mode: "children" }>;
  }>,
): LibraryReadValue => {
  const subject = parentSubject(input.request.parent);
  const offset = input.request.cursor
    ? decodeLibraryCursor(database, input.request.cursor, {
        libraryId: input.libraryId,
        subject,
      }).offset
    : 0;
  if (input.request.cursor) {
    const cursor = decodeLibraryCursor(database, input.request.cursor, {
      libraryId: input.libraryId,
      subject,
    });
    if (cursor.changeLogSeq !== input.changeLogSeq) {
      throw new LibraryModuleStateError(
        "stale_cursor",
        "Library content changed while this list was being paged",
      );
    }
  }

  const nodes = input.request.parent.kind === "library"
    ? hydrateShells(database, readRootShells(database, input.libraryId))
    : input.request.parent.kind === "page"
      ? hydrateShells(
          database,
          readPageChildShells(
            database,
            input.libraryId,
            input.request.parent.pageId,
          ),
        )
      : readViewNodes(
          database,
          input.libraryId,
          input.request.parent.databaseId,
        );
  const limit = resolveLibraryReadLimit(input.request.limit);
  const page = nodes.slice(offset, offset + limit);
  const forced = input.request.forceIncludeTarget
    ? nodes.find((node) => nodeMatchesTarget(node, input.request.forceIncludeTarget!))
    : undefined;
  const items = forced && !page.some((node) => nodeMatchesTarget(
      node,
      input.request.forceIncludeTarget!,
    ))
    ? [...page, forced]
    : page;
  const nextOffset = offset + limit;
  const hasMore = nextOffset < nodes.length;
  return {
    kind: "children",
    parent: input.request.parent,
    items,
    nextCursor: hasMore
      ? mintLibraryCursor(database, {
          libraryId: input.libraryId,
          subject,
          offset: nextOffset,
          changeLogSeq: input.changeLogSeq,
        })
      : null,
    hasMore,
    total: nodes.length,
  };
};

const readDatabaseHostPageId = (
  database: Database.Database,
  databaseId: string,
): string | null =>
  (database.prepare(`
    SELECT page.block_id AS pageId
    FROM blocks block
    INNER JOIN block_documents ownership
      ON ownership.document_id = block.containing_document_id
    INNER JOIN pages page ON page.block_id = ownership.block_id
    WHERE block.id = ? AND block.location_kind = 'document'
  `).get(databaseId) as { readonly pageId: string } | undefined)?.pageId ?? null;

const readPagePath = (
  database: Database.Database,
  libraryId: string,
  pageId: string,
): readonly LibraryNavigationNode[] => {
  const page = readPageInDatabase(database, pageId);
  if (!page || page.libraryId !== libraryId || page.lifecycle === "deleted") {
    throw new LibraryModuleStateError(
      "resource_not_found",
      `Page ${pageId} is not available in this Library`,
    );
  }
  if (page.parent.kind === "data_source") {
    const source = database.prepare(`
      SELECT home_database_block_id AS databaseId
      FROM data_sources
      WHERE id = ? AND library_id = ? AND lifecycle <> 'deleted'
    `).get(page.parent.dataSourceId, libraryId) as
      | { readonly databaseId: string }
      | undefined;
    if (!source) {
      throw new LibraryModuleStateError(
        "state_corrupt",
        `Page ${pageId} has no owning Data Source`,
      );
    }
    return [...readDatabasePath(database, libraryId, source.databaseId)];
  }
  const ancestorIds: string[] = [pageId];
  let parent: PageParent = page.parent;
  const seen = new Set(ancestorIds);
  while (parent.kind === "page") {
    if (seen.has(parent.pageId)) {
      throw new LibraryModuleStateError("state_corrupt", "Page hierarchy contains a cycle");
    }
    seen.add(parent.pageId);
    const owner = readPageInDatabase(database, parent.pageId);
    if (!owner || owner.libraryId !== libraryId || owner.lifecycle === "deleted") {
      throw new LibraryModuleStateError(
        "state_corrupt",
        `Page ${pageId} has a missing ancestor`,
      );
    }
    ancestorIds.push(owner.pageId);
    parent = owner.parent;
  }
  if (parent.kind === "data_source") {
    throw new LibraryModuleStateError(
      "state_corrupt",
      `Nested Page ${pageId} terminates at a Data Source unexpectedly`,
    );
  }
  const orderedIds = ancestorIds.reverse();
  const nodes = readPageNodes(database, orderedIds);
  return orderedIds.map((id) => {
    const node = nodes.get(id);
    if (node) return node;
    throw new LibraryModuleStateError("state_corrupt", `Page ${id} is unavailable`);
  });
};

const readDatabasePath = (
  database: Database.Database,
  libraryId: string,
  databaseId: string,
): readonly LibraryNavigationNode[] => {
  const databaseNode = readDatabaseNodes(database, [databaseId]).get(databaseId);
  if (!databaseNode) {
    throw new LibraryModuleStateError(
      "resource_not_found",
      `Database ${databaseId} is not available in this Library`,
    );
  }
  const hostPageId = readDatabaseHostPageId(database, databaseId);
  return hostPageId
    ? [...readPagePath(database, libraryId, hostPageId), databaseNode]
    : [databaseNode];
};

const readPath = (
  database: Database.Database,
  libraryId: string,
  target: LibraryRouteTarget,
): LibraryReadValue => {
  if (target.kind === "page") {
    return {
      kind: "path",
      target,
      nodes: readPagePath(database, libraryId, target.pageId),
    };
  }
  if (target.kind === "database") {
    return {
      kind: "path",
      target,
      nodes: readDatabasePath(database, libraryId, target.databaseId),
    };
  }
  const view = database.prepare(`
    SELECT database_block_id AS databaseId
    FROM database_views WHERE id = ? AND lifecycle = 'active'
  `).get(target.viewId) as { readonly databaseId: string } | undefined;
  if (!view) {
    throw new LibraryModuleStateError(
      "resource_not_found",
      `View ${target.viewId} is not available in this Library`,
    );
  }
  const viewNode = readViewNodes(database, libraryId, view.databaseId)
    .find((node) => node.viewId === target.viewId);
  if (!viewNode) {
    throw new LibraryModuleStateError(
      "resource_not_found",
      `View ${target.viewId} is not available in this Library`,
    );
  }
  return {
    kind: "path",
    target,
    nodes: [...readDatabasePath(database, libraryId, view.databaseId), viewNode],
  };
};

const readPageLocationLabel = (
  database: Database.Database,
  pageId: string,
): string => {
  const page = readPageInDatabase(database, pageId);
  if (!page) return "Library";
  if (page.parent.kind === "library") return "Library";
  if (page.parent.kind === "page") {
    return readPageInDatabase(database, page.parent.pageId)?.title ?? "Page";
  }
  return (database.prepare(`
    SELECT container.name
    FROM data_sources source
    INNER JOIN database_containers container
      ON container.block_id = source.home_database_block_id
    WHERE source.id = ?
  `).get(page.parent.dataSourceId) as { readonly name: string } | undefined)?.name
    ?? "Database";
};

const readDatabaseLocationLabel = (
  database: Database.Database,
  databaseId: string,
): string => {
  const hostPageId = readDatabaseHostPageId(database, databaseId);
  if (!hostPageId) return "Library";
  return readPageInDatabase(database, hostPageId)?.title ?? "Page";
};

const readCatalog = (
  database: Database.Database,
  input: Readonly<{
    libraryId: string;
    changeLogSeq: number;
    request: Extract<LibraryModuleReadRequest["read"], { mode: "catalog" }>;
  }>,
): LibraryReadValue => {
  const lifecycle = input.request.lifecycle ?? "active";
  const kinds = input.request.kinds ?? ["page", "database"];
  const query = input.request.query?.toLocaleLowerCase() ?? "";
  const subject = ["catalog", lifecycle, kinds.join(","), query] as const;
  const decoded = input.request.cursor
    ? decodeLibraryCursor(database, input.request.cursor, {
        libraryId: input.libraryId,
        subject,
      })
    : null;
  if (decoded && decoded.changeLogSeq !== input.changeLogSeq) {
    throw new LibraryModuleStateError(
      "stale_cursor",
      "Library content changed while the catalog was being paged",
    );
  }
  const entries: LibraryCatalogEntry[] = [];
  if (kinds.includes("page")) {
    const pageIds = database.prepare(`
      SELECT block_id AS pageId FROM pages
      WHERE library_id = ? AND lifecycle = ?
      ORDER BY updated_at DESC, block_id
    `).all(input.libraryId, lifecycle) as readonly { readonly pageId: string }[];
    const pages = readPagesInDatabase(database, pageIds.map((row) => row.pageId));
    for (const { pageId } of pageIds) {
      const page = pages.get(pageId);
      if (!page || (query && !page.title.toLocaleLowerCase().includes(query))) continue;
      entries.push({
        target: { kind: "page", pageId },
        title: page.title,
        kind: "page",
        lifecycle,
        locationLabel: readPageLocationLabel(database, pageId),
        updatedAt: page.updatedAt,
        locationRevision: page.parentRevision,
        metadataRevision: page.metadataRevision,
      });
    }
  }
  if (kinds.includes("database")) {
    const rows = database.prepare(`
      SELECT container.block_id AS databaseId, container.name,
        container.updated_at AS updatedAt,
        block.location_revision AS locationRevision,
        container.metadata_revision AS metadataRevision
      FROM database_containers container
      INNER JOIN blocks block ON block.id = container.block_id
      WHERE container.library_id = ? AND container.lifecycle = ?
      ORDER BY container.updated_at DESC, container.block_id
    `).all(input.libraryId, lifecycle) as readonly {
      readonly databaseId: string;
      readonly name: string;
      readonly updatedAt: string;
      readonly locationRevision: number;
      readonly metadataRevision: number;
    }[];
    for (const row of rows) {
      if (query && !row.name.toLocaleLowerCase().includes(query)) continue;
      entries.push({
        target: { kind: "database", databaseId: parseDatabaseId(row.databaseId) },
        title: row.name,
        kind: "database",
        lifecycle,
        locationLabel: readDatabaseLocationLabel(database, row.databaseId),
        updatedAt: row.updatedAt,
        locationRevision: row.locationRevision,
        metadataRevision: row.metadataRevision,
      });
    }
  }
  entries.sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt)
    || compareStrings(left.kind, right.kind)
    || compareStrings(
      left.target.kind === "page" ? left.target.pageId : left.target.databaseId,
      right.target.kind === "page" ? right.target.pageId : right.target.databaseId,
    ));
  const offset = decoded?.offset ?? 0;
  const limit = resolveLibraryReadLimit(input.request.limit);
  const items = entries.slice(offset, offset + limit);
  const nextOffset = offset + limit;
  const hasMore = nextOffset < entries.length;
  return {
    kind: "catalog",
    items,
    nextCursor: hasMore
      ? mintLibraryCursor(database, {
          libraryId: input.libraryId,
          subject,
          offset: nextOffset,
          changeLogSeq: input.changeLogSeq,
        })
      : null,
    hasMore,
    total: entries.length,
  };
};

const runRead = (
  database: Database.Database,
  request: LibraryModuleReadRequest,
): LibraryModuleReadResult => {
  const identity = requireLocalProfileLibraryInDatabase(database);
  const storeEpoch = requireBlockStoreEpoch(database);
  const changeLogSeq = readChangeLogSeq(database);
  let value: LibraryReadValue;
  if (request.read.mode === "metadata") {
    value = { kind: "metadata" };
  } else if (request.read.mode === "children") {
    value = readChildren(database, {
      libraryId: identity.libraryId,
      changeLogSeq,
      request: request.read,
    });
  } else if (request.read.mode === "path") {
    value = readPath(database, identity.libraryId, request.read.target);
  } else {
    value = readCatalog(database, {
      libraryId: identity.libraryId,
      changeLogSeq,
      request: request.read,
    });
  }
  return {
    ok: true,
    value: {
      version: LIBRARY_MODULE_CONTRACT_VERSION,
      profileId: identity.profileId,
      libraryId: identity.libraryId,
      storeEpoch,
      changeLogSeq,
      value,
    },
  };
};

export const readLibraryModuleInDatabase = (
  database: Database.Database,
  request: LibraryModuleReadRequest,
): LibraryModuleReadResult => {
  try {
    return database.transaction(() => runRead(database, request)).deferred();
  } catch (error) {
    if (error instanceof LibraryCursorError) {
      return {
        ok: false,
        error: libraryModuleFailure(
          error.code === "invalid_cursor" ? "invalid_request" : "stale_cursor",
          error.message,
        ),
      };
    }
    if (error instanceof LibraryModuleStateError) {
      return {
        ok: false,
        error: libraryModuleFailure(error.code, error.message),
      };
    }
    return {
      ok: false,
      error: libraryModuleFailure(
        "unknown",
        error instanceof Error ? error.message : "Library read failed",
        true,
      ),
    };
  }
};

interface LibraryBlockAuthorityRow {
  readonly id: string;
  readonly projectId: string;
  readonly type: "page" | "database";
  readonly lifecycle: "active" | "archived" | "deleted";
  readonly locationKind: "space" | "document" | "database";
  readonly containingDocumentId: string | null;
  readonly locationRevision: number;
  readonly metadataRevision: number;
}

interface ResolvedWriteParent {
  readonly kind: "library" | "page";
  readonly parentKey: string;
  readonly pageId: string | null;
  readonly projectId: string;
  readonly documentId: string | null;
  readonly documentGeneration: number | null;
  readonly documentHeadSeq: number | null;
  readonly beforeBlockId: string | null;
}

interface LibraryMutationEffects {
  readonly didMutate: boolean;
  readonly createdTarget: LibraryModuleApplyReceipt["createdTarget"];
  readonly affectedParentKeys: readonly string[];
  readonly affectedPageIds: readonly string[];
  readonly affectedDatabaseIds: readonly ReturnType<typeof parseDatabaseId>[];
  readonly affectedViewIds: readonly ReturnType<typeof parseDatabaseViewId>[];
  readonly affectedDocumentIds: readonly string[];
  readonly committedRevisions: Readonly<Record<string, number>>;
}

const unique = (values: readonly string[]): readonly string[] =>
  [...new Set(values)].sort(compareStrings);

const stableReceiptProjectId = (
  database: Database.Database,
  libraryId: string,
): string => {
  const project = database.prepare(`
    SELECT id FROM projects
    WHERE library_id = ?
    ORDER BY created ASC, id ASC
    LIMIT 1
  `).get(libraryId) as { readonly id: string } | undefined;
  if (project) return project.id;
  throw new LibraryModuleStateError(
    "state_corrupt",
    "Library has no compatibility Project owner",
  );
};

const preferredCompatibilityProjectId = (
  database: Database.Database,
  libraryId: string,
): string => {
  const project = database.prepare(`
    SELECT id FROM projects
    WHERE library_id = ?
    ORDER BY CASE lifecycle WHEN 'active' THEN 0 WHEN 'inactive' THEN 1 ELSE 2 END,
      created ASC, id ASC
    LIMIT 1
  `).get(libraryId) as { readonly id: string } | undefined;
  if (project) return project.id;
  throw new LibraryModuleStateError(
    "state_corrupt",
    "Library has no compatibility Project owner",
  );
};

const readLibraryBlockAuthority = (
  database: Database.Database,
  libraryId: string,
  target: Extract<
    LibraryApplyOperation,
    { readonly kind: "move_block" | "archive_resource" | "restore_resource" }
  >["target"],
): LibraryBlockAuthorityRow => {
  const id = target.kind === "page" ? target.pageId : target.databaseId;
  const row = database.prepare(`
    SELECT block.id, block.project_id AS projectId, block.type,
      block.lifecycle, block.location_kind AS locationKind,
      block.containing_document_id AS containingDocumentId,
      block.location_revision AS locationRevision,
      block.metadata_revision AS metadataRevision
    FROM blocks block
    LEFT JOIN pages page ON page.block_id = block.id
    LEFT JOIN database_containers container ON container.block_id = block.id
    WHERE block.id = ? AND block.type = ?
      AND COALESCE(page.library_id, container.library_id) = ?
  `).get(id, target.kind, libraryId) as LibraryBlockAuthorityRow | undefined;
  if (row) return row;
  throw new LibraryModuleStateError(
    "resource_not_found",
    `${target.kind === "page" ? "Page" : "Database"} ${id} is not in this Library`,
  );
};

const resolveDocumentOwnerPageId = (
  database: Database.Database,
  documentId: string,
): string => {
  const owner = database.prepare(`
    SELECT page.block_id AS pageId
    FROM block_documents ownership
    INNER JOIN pages page ON page.block_id = ownership.block_id
    WHERE ownership.document_id = ?
  `).get(documentId) as { readonly pageId: string } | undefined;
  if (owner) return owner.pageId;
  throw new LibraryModuleStateError(
    "state_corrupt",
    `Document ${documentId} has no Page owner`,
  );
};

const sourceParentKey = (
  database: Database.Database,
  block: LibraryBlockAuthorityRow,
): string => {
  if (block.locationKind === "space") return "library";
  if (block.locationKind === "document" && block.containingDocumentId) {
    return `page:${resolveDocumentOwnerPageId(database, block.containingDocumentId)}`;
  }
  throw new LibraryModuleStateError(
    "invalid_parent",
    `${block.type === "page" ? "Page" : "Database"} ${block.id} is not Library/Page placed`,
  );
};

const assertAnchor = (
  database: Database.Database,
  libraryId: string,
  parent: LibraryWriteParent,
): string | null => {
  if (!parent.before) return null;
  const row = parent.kind === "library"
    ? database.prepare(`
        SELECT block.location_revision AS locationRevision
        FROM library_block_placements placement
        INNER JOIN blocks block ON block.id = placement.block_id
        WHERE placement.library_id = ? AND placement.block_id = ?
          AND block.lifecycle = 'active'
      `).get(libraryId, parent.before.blockId)
    : database.prepare(`
        SELECT block.location_revision AS locationRevision
        FROM pages owner
        INNER JOIN document_block_index indexed
          ON indexed.document_id = owner.document_id
          AND indexed.block_id = ?
          AND indexed.parent_block_id IS NULL
        INNER JOIN blocks block ON block.id = indexed.block_id
        WHERE owner.block_id = ? AND owner.library_id = ?
          AND block.lifecycle = 'active'
      `).get(parent.before.blockId, parent.pageId, libraryId);
  const anchor = row as { readonly locationRevision: number } | undefined;
  if (!anchor) {
    throw new LibraryModuleStateError(
      "invalid_parent",
      `Placement anchor ${parent.before.blockId} is unavailable in the target parent`,
    );
  }
  if (anchor.locationRevision !== parent.before.expectedLocationRevision) {
    throw new LibraryModuleStateError(
      "revision_conflict",
      `Placement anchor ${parent.before.blockId} changed`,
    );
  }
  return parent.before.blockId;
};

const resolveWriteParent = (
  database: Database.Database,
  libraryId: string,
  parent: LibraryWriteParent,
): ResolvedWriteParent => {
  const beforeBlockId = assertAnchor(database, libraryId, parent);
  if (parent.kind === "library") {
    return {
      kind: "library",
      parentKey: "library",
      pageId: null,
      projectId: preferredCompatibilityProjectId(database, libraryId),
      documentId: null,
      documentGeneration: null,
      documentHeadSeq: null,
      beforeBlockId,
    };
  }
  const page = readPageInDatabase(database, parent.pageId);
  if (!page || page.libraryId !== libraryId || page.lifecycle !== "active") {
    throw new LibraryModuleStateError(
      "invalid_parent",
      `Target Page ${parent.pageId} is unavailable`,
    );
  }
  if (
    page.documentGeneration !== parent.expectedDocumentGeneration ||
    page.documentHeadSeq !== parent.expectedDocumentHeadSeq
  ) {
    throw new LibraryModuleStateError(
      "document_conflict",
      `Target Page ${parent.pageId} content changed`,
    );
  }
  const block = database.prepare(`
    SELECT project_id AS projectId FROM blocks WHERE id = ?
  `).get(parent.pageId) as { readonly projectId: string } | undefined;
  if (!block) {
    throw new LibraryModuleStateError(
      "state_corrupt",
      `Target Page ${parent.pageId} has no Block authority`,
    );
  }
  return {
    kind: "page",
    parentKey: `page:${parent.pageId}`,
    pageId: parent.pageId,
    projectId: block.projectId,
    documentId: page.documentId,
    documentGeneration: page.documentGeneration,
    documentHeadSeq: page.documentHeadSeq,
    beforeBlockId,
  };
};

const applyDocumentOperations = (
  database: Database.Database,
  input: Readonly<{
    operationId: string;
    projectId: string;
    storeEpoch: string;
    documentId: string;
    generation: number;
    headSeq: number;
    operations: Parameters<typeof applyDocumentOperationBatch>[1]["operations"];
    stagedOwnerIds?: readonly string[];
    stagedBlockIds?: readonly string[];
    preserveRemovedIds?: readonly string[];
  }>,
): number => {
  const result = applyDocumentOperationBatch(
    database,
    {
      version: DOCUMENT_OPERATION_CONTRACT_VERSION,
      mutationId: input.operationId,
      projectId: input.projectId,
      storeEpoch: input.storeEpoch,
      clientSessionId: "library-module",
      actor: { kind: "local_library" },
      documentId: input.documentId,
      generation: input.generation,
      expectedHeadSeq: input.headSeq,
      operations: input.operations,
    },
    {
      ...(input.stagedOwnerIds
        ? { allowStagedDocumentBearingBlockIds: input.stagedOwnerIds }
        : {}),
      ...(input.stagedBlockIds
        ? { allowStagedReparentedBlockIds: input.stagedBlockIds }
        : {}),
      ...(input.preserveRemovedIds
        ? { preserveRemovedBlockIds: input.preserveRemovedIds }
        : {}),
    },
  );
  if (result.ok) return result.value.headSeq;
  if (
    result.error.code === "document_head_conflict" ||
    result.error.code === "document_generation_conflict"
  ) {
    throw new LibraryModuleStateError("document_conflict", result.error.message);
  }
  if (result.error.code === "invalid_anchor") {
    throw new LibraryModuleStateError("invalid_parent", result.error.message);
  }
  throw new LibraryModuleStateError("state_corrupt", result.error.message);
};

const applyFractionalPlacement = (
  database: Database.Database,
  input: Readonly<{
    libraryId: string;
    blockId: string;
    beforeBlockId: string | null;
    now: string;
  }>,
): number => {
  const items = database.prepare(`
    SELECT block_id AS id, rank_key AS rankKey
    FROM library_block_placements
    WHERE library_id = ?
    ORDER BY rank_key, block_id
  `).all(input.libraryId) as readonly FractionalRankedItem[];
  const plan = planFractionalRank({
    items,
    targetId: input.blockId,
    ...(input.beforeBlockId ? { beforeId: input.beforeBlockId } : {}),
  });
  const update = database.prepare(`
    UPDATE library_block_placements
    SET rank_key = ?, revision = revision + 1, updated_at = ?
    WHERE block_id = ? AND library_id = ?
  `);
  for (const [blockId, rankKey] of plan.rebalancedRankKeys) {
    update.run(rankKey, input.now, blockId, input.libraryId);
  }
  const current = database.prepare(`
    SELECT revision FROM library_block_placements
    WHERE block_id = ? AND library_id = ?
  `).get(input.blockId, input.libraryId) as { readonly revision: number } | undefined;
  if (current) {
    update.run(plan.rankKey, input.now, input.blockId, input.libraryId);
    return current.revision + 1;
  }
  database.prepare(`
    INSERT INTO library_block_placements (
      block_id, library_id, rank_key, revision, created_at, updated_at
    ) VALUES (?, ?, ?, 1, ?, ?)
  `).run(input.blockId, input.libraryId, plan.rankKey, input.now, input.now);
  return 1;
};

const insertPhysicalTopLevelPlacement = (
  database: Database.Database,
  input: Readonly<{
    blockId: string;
    projectId: string;
    now: string;
  }>,
): void => {
  const items = database.prepare(`
    SELECT block_id AS id, rank_key AS rankKey
    FROM top_level_block_placements
    WHERE project_id = ?
    ORDER BY rank_key, block_id
  `).all(input.projectId) as readonly FractionalRankedItem[];
  const plan = planFractionalRank({ items, targetId: input.blockId });
  const update = database.prepare(`
    UPDATE top_level_block_placements SET rank_key = ?, updated_at = ?
    WHERE block_id = ? AND project_id = ?
  `);
  for (const [blockId, rankKey] of plan.rebalancedRankKeys) {
    update.run(rankKey, input.now, blockId, input.projectId);
  }
  database.prepare(`
    INSERT INTO top_level_block_placements (
      block_id, project_id, rank_key, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?)
  `).run(input.blockId, input.projectId, plan.rankKey, input.now, input.now);
};

const genesisUpdateId = (operationId: string): string =>
  `library-page-genesis:${createHash("sha256").update(operationId).digest("hex")}`;

const createPage = (
  database: Database.Database,
  input: Readonly<{
    identity: ReturnType<typeof requireLocalProfileLibraryInDatabase>;
    request: LibraryModuleApplyRequest;
    operation: Extract<LibraryApplyOperation, { readonly kind: "create_page" }>;
    now: string;
  }>,
): LibraryMutationEffects => {
  const parent = resolveWriteParent(
    database,
    input.identity.libraryId,
    input.operation.parent,
  );
  if (
    database.prepare("SELECT 1 FROM blocks WHERE id = ?").get(input.operation.pageId) ||
    database.prepare("SELECT 1 FROM documents WHERE id = ?").get(input.operation.documentId)
  ) {
    throw new LibraryModuleStateError(
      "identity_conflict",
      "New Page or Document identity already exists",
    );
  }
  const genesis = createPageDocumentGenesis({
    documentId: input.operation.documentId,
    title: input.operation.title,
    nfm: "",
  });
  database.prepare(`
    INSERT INTO blocks (
      id, project_id, type, lifecycle, location_kind,
      containing_document_id, containing_database_id,
      location_revision, metadata_revision, created_at, updated_at
    ) VALUES (?, ?, 'page', 'active', ?, ?, NULL, 1, 1, ?, ?)
  `).run(
    input.operation.pageId,
    parent.projectId,
    parent.kind === "library" ? "space" : "document",
    parent.documentId,
    input.now,
    input.now,
  );
  if (parent.kind === "library") {
    insertPhysicalTopLevelPlacement(database, {
      blockId: input.operation.pageId,
      projectId: parent.projectId,
      now: input.now,
    });
    applyFractionalPlacement(database, {
      libraryId: input.identity.libraryId,
      blockId: input.operation.pageId,
      beforeBlockId: parent.beforeBlockId,
      now: input.now,
    });
  }
  database.prepare(`
    INSERT INTO documents (
      id, project_id, generation, head_seq, schema_key, schema_version,
      state_vector, state_hash, readiness, authority,
      genesis_source_revision, created_at, updated_at
    ) VALUES (?, ?, 1, 0, ?, ?, X'', '', 'pending_genesis',
      'legacy_shadow', NULL, ?, ?)
  `).run(
    input.operation.documentId,
    parent.projectId,
    PAGE_DOCUMENT_SCHEMA_KEY,
    PAGE_DOCUMENT_SCHEMA_VERSION,
    input.now,
    input.now,
  );
  database.prepare(`
    INSERT INTO block_documents (block_id, document_id, project_id, created_at)
    VALUES (?, ?, ?, ?)
  `).run(
    input.operation.pageId,
    input.operation.documentId,
    parent.projectId,
    input.now,
  );
  database.prepare(`
    INSERT OR IGNORE INTO pages (
      block_id, library_id, document_id, parent_kind, parent_id,
      lifecycle, parent_revision, metadata_revision, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'active', 1, 1, ?, ?)
  `).run(
    input.operation.pageId,
    input.identity.libraryId,
    input.operation.documentId,
    parent.kind,
    parent.kind === "library" ? input.identity.libraryId : parent.pageId,
    input.now,
    input.now,
  );
  insertDefaultPageIntrinsicProperties(database, {
    pageId: input.operation.pageId,
    projectId: parent.projectId,
    now: input.now,
  });
  initializePageDocumentGenesis(database, {
    documentId: input.operation.documentId,
    storeEpoch: input.request.storeEpoch,
    generation: 1,
    updateId: genesisUpdateId(input.request.operationId),
    clientSessionId: "library-module",
    update: genesis.update,
    finalAuthority: "ydoc_primary",
  });
  let parentHeadSeq: number | null = null;
  if (
    parent.kind === "page" &&
    parent.documentId &&
    parent.documentGeneration !== null &&
    parent.documentHeadSeq !== null
  ) {
    parentHeadSeq = applyDocumentOperations(database, {
      operationId: `${input.request.operationId}:parent`,
      projectId: parent.projectId,
      storeEpoch: input.request.storeEpoch,
      documentId: parent.documentId,
      generation: parent.documentGeneration,
      headSeq: parent.documentHeadSeq,
      operations: [{
        kind: "insert_block",
        block: { id: input.operation.pageId, type: "page", props: {}, children: [] },
        ...(parent.beforeBlockId ? { beforeBlockId: parent.beforeBlockId } : {}),
      }],
      stagedOwnerIds: [input.operation.pageId],
    });
  }
  const created = readPageInDatabase(database, input.operation.pageId);
  if (!created) {
    throw new LibraryModuleStateError("state_corrupt", "Created Page has no read model");
  }
  return {
    didMutate: true,
    createdTarget: { kind: "page", pageId: input.operation.pageId },
    affectedParentKeys: [parent.parentKey],
    affectedPageIds: unique([
      input.operation.pageId,
      ...(parent.pageId ? [parent.pageId] : []),
    ]),
    affectedDatabaseIds: [],
    affectedViewIds: [],
    affectedDocumentIds: unique([
      input.operation.documentId,
      ...(parent.documentId ? [parent.documentId] : []),
    ]),
    committedRevisions: {
      [`blockLocation:${input.operation.pageId}`]: created.parentRevision,
      [`blockMetadata:${input.operation.pageId}`]: created.metadataRevision,
      [`documentHead:${input.operation.documentId}`]: created.documentHeadSeq,
      ...(parentHeadSeq === null || !parent.documentId
        ? {}
        : { [`documentHead:${parent.documentId}`]: parentHeadSeq }),
    },
  };
};

const createDatabase = (
  database: Database.Database,
  input: Readonly<{
    identity: ReturnType<typeof requireLocalProfileLibraryInDatabase>;
    request: LibraryModuleApplyRequest;
    operation: Extract<LibraryApplyOperation, { readonly kind: "create_database" }>;
    now: string;
  }>,
): LibraryMutationEffects => {
  const parent = resolveWriteParent(
    database,
    input.identity.libraryId,
    input.operation.parent,
  );
  const identities = [
    input.operation.databaseId,
    input.operation.dataSourceId,
    input.operation.viewId,
  ];
  if (
    database.prepare(`
      SELECT 1
      WHERE EXISTS (SELECT 1 FROM blocks WHERE id = ?)
        OR EXISTS (SELECT 1 FROM data_sources WHERE id = ?)
        OR EXISTS (SELECT 1 FROM database_views WHERE id = ?)
    `).get(...identities)
  ) {
    throw new LibraryModuleStateError(
      "identity_conflict",
      "New Database, Data Source, or View identity already exists",
    );
  }
  database.prepare(`
    INSERT INTO blocks (
      id, project_id, type, lifecycle, location_kind,
      containing_document_id, containing_database_id,
      location_revision, metadata_revision, created_at, updated_at
    ) VALUES (?, ?, 'database', 'active', ?, ?, NULL, 1, 1, ?, ?)
  `).run(
    input.operation.databaseId,
    parent.projectId,
    parent.kind === "library" ? "space" : "document",
    parent.documentId,
    input.now,
    input.now,
  );
  if (parent.kind === "library") {
    insertPhysicalTopLevelPlacement(database, {
      blockId: input.operation.databaseId,
      projectId: parent.projectId,
      now: input.now,
    });
    applyFractionalPlacement(database, {
      libraryId: input.identity.libraryId,
      blockId: input.operation.databaseId,
      beforeBlockId: parent.beforeBlockId,
      now: input.now,
    });
  }
  createDatabaseAuthorityRecordsInDatabase(database, {
    libraryId: input.identity.libraryId,
    identities: {
      databaseId: input.operation.databaseId,
      dataSourceId: input.operation.dataSourceId,
      viewId: input.operation.viewId,
    },
    now: input.now,
    name: input.operation.name,
  });
  let parentHeadSeq: number | null = null;
  if (
    parent.kind === "page" &&
    parent.documentId &&
    parent.documentGeneration !== null &&
    parent.documentHeadSeq !== null
  ) {
    parentHeadSeq = applyDocumentOperations(database, {
      operationId: `${input.request.operationId}:parent`,
      projectId: parent.projectId,
      storeEpoch: input.request.storeEpoch,
      documentId: parent.documentId,
      generation: parent.documentGeneration,
      headSeq: parent.documentHeadSeq,
      operations: [{
        kind: "insert_block",
        block: {
          id: input.operation.databaseId,
          type: "database",
          props: {},
          children: [],
        },
        ...(parent.beforeBlockId ? { beforeBlockId: parent.beforeBlockId } : {}),
      }],
      stagedBlockIds: [input.operation.databaseId],
    });
  }
  const block = database.prepare(`
    SELECT location_revision AS locationRevision,
      metadata_revision AS metadataRevision
    FROM blocks WHERE id = ?
  `).get(input.operation.databaseId) as {
    readonly locationRevision: number;
    readonly metadataRevision: number;
  } | undefined;
  if (!block) {
    throw new LibraryModuleStateError("state_corrupt", "Created Database has no Block");
  }
  return {
    didMutate: true,
    createdTarget: {
      kind: "database",
      databaseId: input.operation.databaseId,
    },
    affectedParentKeys: [parent.parentKey],
    affectedPageIds: parent.pageId ? [parent.pageId] : [],
    affectedDatabaseIds: [input.operation.databaseId],
    affectedViewIds: [input.operation.viewId],
    affectedDocumentIds: parent.documentId ? [parent.documentId] : [],
    committedRevisions: {
      [`blockLocation:${input.operation.databaseId}`]: block.locationRevision,
      [`blockMetadata:${input.operation.databaseId}`]: block.metadataRevision,
      [`databaseMetadata:${input.operation.databaseId}`]: 1,
      [`dataSourceSchema:${input.operation.dataSourceId}`]: 1,
      [`view:${input.operation.viewId}`]: 1,
      ...(parentHeadSeq === null || !parent.documentId
        ? {}
        : { [`documentHead:${parent.documentId}`]: parentHeadSeq }),
    },
  };
};

const removeFromSourceDocument = (
  database: Database.Database,
  input: Readonly<{
    request: LibraryModuleApplyRequest;
    block: LibraryBlockAuthorityRow;
  }>,
): { readonly documentId: string; readonly headSeq: number } | null => {
  if (input.block.locationKind === "space") return null;
  if (input.block.locationKind !== "document" || !input.block.containingDocumentId) {
    throw new LibraryModuleStateError(
      "invalid_parent",
      `Block ${input.block.id} cannot move from ${input.block.locationKind}`,
    );
  }
  const document = database.prepare(`
    SELECT generation, head_seq AS headSeq FROM documents WHERE id = ?
  `).get(input.block.containingDocumentId) as {
    readonly generation: number;
    readonly headSeq: number;
  } | undefined;
  if (!document) {
    throw new LibraryModuleStateError(
      "state_corrupt",
      `Source Document ${input.block.containingDocumentId} is unavailable`,
    );
  }
  return {
    documentId: input.block.containingDocumentId,
    headSeq: applyDocumentOperations(database, {
      operationId: `${input.request.operationId}:source`,
      projectId: input.block.projectId,
      storeEpoch: input.request.storeEpoch,
      documentId: input.block.containingDocumentId,
      generation: document.generation,
      headSeq: document.headSeq,
      operations: [{ kind: "delete_block", blockId: input.block.id }],
      preserveRemovedIds: [input.block.id],
    }),
  };
};

const rehomePageForParent = (
  database: Database.Database,
  input: Readonly<{
    request: LibraryModuleApplyRequest;
    pageId: string;
    sourceProjectId: string;
    targetProjectId: string;
  }>,
): void => {
  if (input.sourceProjectId === input.targetProjectId) return;
  const plan = prepareLibraryContentRehome(database, {
    operationId: `${input.request.operationId}:rehome`,
    callIdentity: "library-module",
    actorProjectId: input.targetProjectId,
    sourceProjectId: input.sourceProjectId,
    targetProjectId: input.targetProjectId,
    rootPageIds: [input.pageId],
    storeEpoch: input.request.storeEpoch,
    authorityKind: "local_library",
  });
  applyLibraryContentRehomeInTransaction(database, plan);
};

const rehomeStandaloneDatabaseForParent = (
  database: Database.Database,
  input: Readonly<{
    databaseId: string;
    sourceProjectId: string;
    targetProjectId: string;
  }>,
): void => {
  if (input.sourceProjectId === input.targetProjectId) return;
  const capability = database.prepare(`
    SELECT 1 FROM database_capabilities WHERE block_id = ?
  `).get(input.databaseId);
  if (capability) {
    throw new LibraryModuleStateError(
      "invalid_parent",
      "A compatibility-bound Database cannot move into another Project-owned Document",
    );
  }
  database.pragma("defer_foreign_keys = ON");
  const updated = database.prepare(`
    UPDATE blocks SET project_id = ?
    WHERE id = ? AND project_id = ? AND type = 'database'
  `).run(input.targetProjectId, input.databaseId, input.sourceProjectId);
  if (updated.changes !== 1) {
    throw new LibraryModuleStateError(
      "revision_conflict",
      `Database ${input.databaseId} changed during rehome`,
    );
  }
};

const synchronizePageCoordinates = (
  database: Database.Database,
  input: Readonly<{
    pageId: string;
    libraryId: string;
    parent: ResolvedWriteParent;
    now: string;
  }>,
): void => {
  const updated = database.prepare(`
    UPDATE pages
    SET parent_kind = ?, parent_id = ?,
      lifecycle = (SELECT lifecycle FROM blocks WHERE id = pages.block_id),
      parent_revision = (
        SELECT location_revision FROM blocks WHERE id = pages.block_id
      ),
      metadata_revision = (
        SELECT metadata_revision FROM blocks WHERE id = pages.block_id
      ),
      updated_at = ?
    WHERE block_id = ? AND library_id = ?
  `).run(
    input.parent.kind,
    input.parent.kind === "library" ? input.libraryId : input.parent.pageId,
    input.now,
    input.pageId,
    input.libraryId,
  );
  if (updated.changes === 1) return;
  throw new LibraryModuleStateError(
    "state_corrupt",
    `Page ${input.pageId} lost its canonical coordinates`,
  );
};

const moveBlock = (
  database: Database.Database,
  input: Readonly<{
    identity: ReturnType<typeof requireLocalProfileLibraryInDatabase>;
    request: LibraryModuleApplyRequest;
    operation: Extract<LibraryApplyOperation, { readonly kind: "move_block" }>;
    now: string;
  }>,
): LibraryMutationEffects => {
  const block = readLibraryBlockAuthority(
    database,
    input.identity.libraryId,
    input.operation.target,
  );
  if (block.lifecycle !== "active") {
    throw new LibraryModuleStateError(
      "resource_not_found",
      `Block ${block.id} is not active`,
    );
  }
  if (block.locationRevision !== input.operation.target.expectedLocationRevision) {
    throw new LibraryModuleStateError(
      "revision_conflict",
      `Block ${block.id} moved since this action began`,
    );
  }
  if (block.type === "page") {
    const page = readPageInDatabase(database, block.id);
    if (!page || page.parent.kind === "data_source") {
      throw new LibraryModuleStateError(
        "invalid_parent",
        "A Data Source row Page must move through the Database Module",
      );
    }
  }
  const parent = resolveWriteParent(
    database,
    input.identity.libraryId,
    input.operation.parent,
  );
  if (block.type === "page" && parent.kind === "page") {
    const hierarchy = resolvePageHierarchy(database, parent.pageId!);
    if (hierarchy.pageIds.includes(block.id)) {
      throw new LibraryModuleStateError(
        "hierarchy_cycle",
        `Page ${block.id} cannot move below itself`,
      );
    }
  }
  const previousParentKey = sourceParentKey(database, block);
  if (
    block.locationKind === "document" &&
    block.containingDocumentId === parent.documentId
  ) {
    if (
      parent.kind !== "page" ||
      !parent.documentId ||
      parent.documentGeneration === null ||
      parent.documentHeadSeq === null
    ) {
      throw new LibraryModuleStateError("state_corrupt", "Document parent is incomplete");
    }
    const headSeq = applyDocumentOperations(database, {
      operationId: `${input.request.operationId}:move`,
      projectId: block.projectId,
      storeEpoch: input.request.storeEpoch,
      documentId: parent.documentId,
      generation: parent.documentGeneration,
      headSeq: parent.documentHeadSeq,
      operations: [{
        kind: "move_block",
        blockId: block.id,
        ...(parent.beforeBlockId ? { beforeBlockId: parent.beforeBlockId } : {}),
      }],
    });
    const moved = readLibraryBlockAuthority(
      database,
      input.identity.libraryId,
      input.operation.target,
    );
    if (block.type === "page") {
      synchronizePageCoordinates(database, {
        pageId: block.id,
        libraryId: input.identity.libraryId,
        parent,
        now: input.now,
      });
    }
    return {
      didMutate: true,
      createdTarget: null,
      affectedParentKeys: [parent.parentKey],
      affectedPageIds: unique([
        ...(block.type === "page" ? [block.id] : []),
        parent.pageId!,
      ]),
      affectedDatabaseIds: block.type === "database"
        ? [parseDatabaseId(block.id)]
        : [],
      affectedViewIds: [],
      affectedDocumentIds: [parent.documentId],
      committedRevisions: {
        [`blockLocation:${block.id}`]: moved.locationRevision,
        [`documentHead:${parent.documentId}`]: headSeq,
      },
    };
  }

  const sourceCommit = removeFromSourceDocument(database, {
    request: input.request,
    block,
  });
  if (block.locationKind === "space" && parent.kind === "page") {
    database.prepare(`
      DELETE FROM top_level_block_placements WHERE block_id = ?
    `).run(block.id);
  }
  const targetProjectId = parent.kind === "library"
    ? block.projectId
    : parent.projectId;
  if (block.type === "page") {
    rehomePageForParent(database, {
      request: input.request,
      pageId: block.id,
      sourceProjectId: block.projectId,
      targetProjectId,
    });
  } else {
    rehomeStandaloneDatabaseForParent(database, {
      databaseId: block.id,
      sourceProjectId: block.projectId,
      targetProjectId,
    });
  }
  const currentOwner = targetProjectId;
  if (parent.kind === "library") {
    if (block.locationKind !== "space") {
      database.prepare(`
        UPDATE blocks
        SET location_kind = 'space', containing_document_id = NULL,
          containing_database_id = NULL,
          location_revision = location_revision + 1, updated_at = ?
        WHERE id = ?
      `).run(input.now, block.id);
      insertPhysicalTopLevelPlacement(database, {
        blockId: block.id,
        projectId: currentOwner,
        now: input.now,
      });
    } else {
      database.prepare(`
        UPDATE blocks SET location_revision = location_revision + 1, updated_at = ?
        WHERE id = ?
      `).run(input.now, block.id);
    }
    applyFractionalPlacement(database, {
      libraryId: input.identity.libraryId,
      blockId: block.id,
      beforeBlockId: parent.beforeBlockId,
      now: input.now,
    });
  } else {
    if (
      !parent.documentId ||
      parent.documentGeneration === null ||
      parent.documentHeadSeq === null
    ) {
      throw new LibraryModuleStateError("state_corrupt", "Document parent is incomplete");
    }
    database.prepare(`
      UPDATE blocks
      SET location_kind = 'document', containing_document_id = ?,
        containing_database_id = NULL,
        location_revision = location_revision + 1, updated_at = ?
      WHERE id = ?
    `).run(parent.documentId, input.now, block.id);
    applyDocumentOperations(database, {
      operationId: `${input.request.operationId}:target`,
      projectId: currentOwner,
      storeEpoch: input.request.storeEpoch,
      documentId: parent.documentId,
      generation: parent.documentGeneration,
      headSeq: parent.documentHeadSeq,
      operations: [{
        kind: "insert_block",
        block: { id: block.id, type: block.type, props: {}, children: [] },
        ...(parent.beforeBlockId ? { beforeBlockId: parent.beforeBlockId } : {}),
      }],
      ...(block.type === "page"
        ? { stagedOwnerIds: [block.id] }
        : { stagedBlockIds: [block.id] }),
    });
  }
  if (block.type === "page") {
    synchronizePageCoordinates(database, {
      pageId: block.id,
      libraryId: input.identity.libraryId,
      parent,
      now: input.now,
    });
  }
  const moved = readLibraryBlockAuthority(
    database,
    input.identity.libraryId,
    input.operation.target,
  );
  const targetPageId = parent.pageId;
  return {
    didMutate: true,
    createdTarget: null,
    affectedParentKeys: unique([previousParentKey, parent.parentKey]),
    affectedPageIds: unique([
      ...(block.type === "page" ? [block.id] : []),
      ...(targetPageId ? [targetPageId] : []),
    ]),
    affectedDatabaseIds: block.type === "database"
      ? [parseDatabaseId(block.id)]
      : [],
    affectedViewIds: [],
    affectedDocumentIds: unique([
      ...(sourceCommit ? [sourceCommit.documentId] : []),
      ...(parent.documentId ? [parent.documentId] : []),
    ]),
    committedRevisions: {
      [`blockLocation:${block.id}`]: moved.locationRevision,
      ...(sourceCommit
        ? { [`documentHead:${sourceCommit.documentId}`]: sourceCommit.headSeq }
        : {}),
      ...(parent.documentId
        ? {
            [`documentHead:${parent.documentId}`]: (
              database.prepare("SELECT head_seq AS headSeq FROM documents WHERE id = ?")
                .get(parent.documentId) as { readonly headSeq: number }
            ).headSeq,
          }
        : {}),
    },
  };
};

const changeResourceLifecycle = (
  database: Database.Database,
  input: Readonly<{
    identity: ReturnType<typeof requireLocalProfileLibraryInDatabase>;
    operation: Extract<
      LibraryApplyOperation,
      { readonly kind: "archive_resource" | "restore_resource" }
    >;
    now: string;
  }>,
): LibraryMutationEffects => {
  const block = readLibraryBlockAuthority(
    database,
    input.identity.libraryId,
    input.operation.target,
  );
  const from = input.operation.kind === "archive_resource" ? "active" : "archived";
  const to = input.operation.kind === "archive_resource" ? "archived" : "active";
  if (block.lifecycle !== from) {
    throw new LibraryModuleStateError(
      "revision_conflict",
      `${block.type === "page" ? "Page" : "Database"} ${block.id} is ${block.lifecycle}`,
    );
  }
  const currentMetadataRevision = block.type === "database"
    ? (database.prepare(`
        SELECT metadata_revision AS revision
        FROM database_containers WHERE block_id = ?
      `).get(block.id) as { readonly revision: number } | undefined)?.revision
    : block.metadataRevision;
  if (currentMetadataRevision === undefined) {
    throw new LibraryModuleStateError(
      "state_corrupt",
      `${block.type === "page" ? "Page" : "Database"} ${block.id} lost metadata authority`,
    );
  }
  if (currentMetadataRevision !== input.operation.target.expectedMetadataRevision) {
    throw new LibraryModuleStateError(
      "revision_conflict",
      `${block.type === "page" ? "Page" : "Database"} ${block.id} metadata changed`,
    );
  }
  if (block.type === "database" && to === "archived") {
    const binding = database.prepare(`
      SELECT project_id FROM project_database_bindings
      WHERE database_block_id = ? AND lifecycle = 'active'
      LIMIT 1
    `).get(block.id) as { readonly project_id: string } | undefined;
    if (binding) {
      throw new LibraryModuleStateError(
        "primary_database_bound",
        `Database ${block.id} is the active primary Database of a Project`,
      );
    }
  }
  if (block.type === "page" && to === "active") {
    const page = readPageInDatabase(database, block.id);
    if (!page) {
      throw new LibraryModuleStateError("state_corrupt", `Page ${block.id} is unavailable`);
    }
    if (page.parent.kind === "page") {
      const parent = readPageInDatabase(database, page.parent.pageId);
      if (!parent || parent.lifecycle !== "active") {
        throw new LibraryModuleStateError(
          "invalid_parent",
          "Restore the parent Page before restoring this Page",
        );
      }
    }
    if (page.parent.kind === "data_source") {
      const source = database.prepare(`
        SELECT lifecycle FROM data_sources WHERE id = ?
      `).get(page.parent.dataSourceId) as { readonly lifecycle: string } | undefined;
      if (source?.lifecycle !== "active") {
        throw new LibraryModuleStateError(
          "invalid_parent",
          "The Page's Data Source is unavailable",
        );
      }
    }
  }
  const updatedBlock = database.prepare(`
    UPDATE blocks
    SET lifecycle = ?, metadata_revision = metadata_revision + 1, updated_at = ?
    WHERE id = ? AND lifecycle = ? AND metadata_revision = ?
  `).run(to, input.now, block.id, from, block.metadataRevision);
  if (updatedBlock.changes !== 1) {
    throw new LibraryModuleStateError(
      "revision_conflict",
      `Block ${block.id} changed during lifecycle transition`,
    );
  }
  if (block.type === "page") {
    const updatedPage = database.prepare(`
      UPDATE pages
      SET lifecycle = (
          SELECT lifecycle FROM blocks WHERE id = pages.block_id
        ),
        metadata_revision = (
          SELECT metadata_revision FROM blocks WHERE id = pages.block_id
        ),
        updated_at = ?
      WHERE block_id = ?
    `).run(
      input.now,
      block.id,
    );
    if (updatedPage.changes !== 1) {
      throw new LibraryModuleStateError(
        "revision_conflict",
        `Page ${block.id} changed during lifecycle transition`,
      );
    }
  }
  let committedMetadataRevision = block.metadataRevision + 1;
  if (block.type === "database") {
    const updatedContainer = database.prepare(`
      UPDATE database_containers
      SET lifecycle = ?, metadata_revision = metadata_revision + 1, updated_at = ?
      WHERE block_id = ? AND lifecycle = ? AND metadata_revision = ?
    `).run(
      to,
      input.now,
      block.id,
      from,
      currentMetadataRevision,
    );
    if (updatedContainer.changes !== 1) {
      throw new LibraryModuleStateError(
        "revision_conflict",
        `Database ${block.id} changed during lifecycle transition`,
      );
    }
    committedMetadataRevision = currentMetadataRevision + 1;
  }
  const parentKey = sourceParentKey(database, { ...block, lifecycle: to });
  return {
    didMutate: true,
    createdTarget: null,
    affectedParentKeys: [parentKey],
    affectedPageIds: block.type === "page" ? [block.id] : [],
    affectedDatabaseIds: block.type === "database"
      ? [parseDatabaseId(block.id)]
      : [],
    affectedViewIds: [],
    affectedDocumentIds: block.type === "page"
      ? [
          (database.prepare("SELECT document_id AS documentId FROM pages WHERE block_id = ?")
            .get(block.id) as { readonly documentId: string }).documentId,
        ]
      : [],
    committedRevisions: {
      [`blockMetadata:${block.id}`]: block.metadataRevision + 1,
      ...(block.type === "database"
        ? { [`databaseMetadata:${block.id}`]: committedMetadataRevision }
        : {}),
    },
  };
};

const grantProjectAccess = (
  database: Database.Database,
  input: Readonly<{
    identity: ReturnType<typeof requireLocalProfileLibraryInDatabase>;
    operation: Extract<
      LibraryApplyOperation,
      { readonly kind: "grant_project_access" }
    >;
    now: string;
  }>,
): LibraryMutationEffects => {
  const project = database.prepare(`
    SELECT library_id AS libraryId, lifecycle
    FROM projects WHERE id = ?
  `).get(input.operation.projectId) as {
    readonly libraryId: string;
    readonly lifecycle: "active" | "inactive" | "archived";
  } | undefined;
  if (!project || project.libraryId !== input.identity.libraryId) {
    throw new LibraryModuleStateError(
      "resource_not_found",
      `Project ${input.operation.projectId} is unavailable in this Library`,
    );
  }
  if (project.lifecycle !== "active") {
    throw new LibraryModuleStateError(
      "project_inactive",
      `Project ${input.operation.projectId} must be active before it can receive access`,
    );
  }
  const resource = input.operation.target.kind === "page"
    ? { kind: "page" as const, pageId: input.operation.target.pageId }
    : { kind: "database" as const, databaseId: input.operation.target.databaseId };
  const authorization = authorizeProjectResourceInDatabase(database, {
    projectId: input.operation.projectId,
    resource,
    action: input.operation.access === "read" ? "read" : "write",
  });
  let revision = 0;
  if (!authorization.allowed) {
    const grant = putProjectResourceGrantInDatabase(database, {
      projectId: input.operation.projectId,
      root: resource,
      access: input.operation.access,
    }, input.now);
    revision = grant.revision;
  } else if (authorization.grantId) {
    revision = (database.prepare(`
      SELECT revision FROM project_resource_grants WHERE id = ?
    `).get(authorization.grantId) as { readonly revision: number } | undefined)?.revision ?? 0;
  }
  return {
    didMutate: !authorization.allowed,
    createdTarget: null,
    affectedParentKeys: [],
    affectedPageIds: resource.kind === "page" ? [resource.pageId] : [],
    affectedDatabaseIds: resource.kind === "database"
      ? [parseDatabaseId(resource.databaseId)]
      : [],
    affectedViewIds: [],
    affectedDocumentIds: [],
    committedRevisions: revision > 0
      ? { [`projectGrant:${input.operation.projectId}`]: revision }
      : {},
  };
};

const executeApplyOperation = (
  database: Database.Database,
  input: Readonly<{
    identity: ReturnType<typeof requireLocalProfileLibraryInDatabase>;
    request: LibraryModuleApplyRequest;
    now: string;
  }>,
): LibraryMutationEffects => {
  const operation = input.request.operation;
  if (operation.kind === "create_page") {
    return createPage(database, { ...input, operation });
  }
  if (operation.kind === "create_database") {
    return createDatabase(database, { ...input, operation });
  }
  if (operation.kind === "move_block") {
    return moveBlock(database, { ...input, operation });
  }
  if (
    operation.kind === "archive_resource" ||
    operation.kind === "restore_resource"
  ) {
    return changeResourceLifecycle(database, { ...input, operation });
  }
  return grantProjectAccess(database, { ...input, operation });
};

const parseStoredApplyReceipt = (value: unknown): LibraryModuleApplyReceipt => {
  const parsed = parseLibraryModuleApplyResult({ ok: true, value });
  if (parsed.ok) return parsed.value;
  throw new Error(parsed.error.message);
};

const runApply = (
  database: Database.Database,
  request: LibraryModuleApplyRequest,
  now: string,
): LibraryModuleApplyResult => {
  const identity = requireLocalProfileLibraryInDatabase(database);
  const storeEpoch = requireBlockStoreEpoch(database);
  if (request.storeEpoch !== storeEpoch) {
    throw new LibraryModuleStateError(
      "store_epoch_mismatch",
      "Library operation belongs to a stale store epoch",
    );
  }
  const receiptProjectId = stableReceiptProjectId(database, identity.libraryId);
  const prepared = prepareAuthoritativeOperation(database, {
    operationId: request.operationId,
    projectId: receiptProjectId,
    mutationKind: "library_module",
    logicalRequest: {
      version: request.version,
      storeEpoch: request.storeEpoch,
      operation: request.operation,
    },
    actor: {
      kind: "local_library",
      profileId: identity.profileId,
      libraryId: identity.libraryId,
    },
    clientSessionId: "library-module",
  }, parseStoredApplyReceipt);
  if (prepared.kind === "replay") {
    return {
      ok: true,
      value: { ...prepared.result, duplicate: true },
    };
  }
  const effects = executeApplyOperation(database, { identity, request, now });
  const targetBlockIds = unique([
    ...effects.affectedPageIds,
    ...effects.affectedDatabaseIds,
  ]);
  const persisted = persistAuthoritativeOperationReceipt(database, {
    evidence: prepared.evidence,
    targetBlockIds,
    affectedDocumentIds: effects.affectedDocumentIds,
    affectedDatabaseBlockIds: effects.affectedDatabaseIds,
    expectedRevisions: {},
    committedRevisions: effects.committedRevisions,
    changePayload: {
      operationKind: request.operation.kind,
      didMutate: effects.didMutate,
      affectedParentKeys: effects.affectedParentKeys,
      affectedPageIds: effects.affectedPageIds,
      affectedDatabaseIds: effects.affectedDatabaseIds,
      affectedViewIds: effects.affectedViewIds,
    },
    committedAt: now,
    makeResult: (changeLogSeq): LibraryModuleApplyReceipt => ({
      version: LIBRARY_MODULE_CONTRACT_VERSION,
      operationId: request.operationId,
      storeEpoch,
      libraryId: identity.libraryId,
      operationKind: request.operation.kind,
      duplicate: false,
      didMutate: effects.didMutate,
      createdTarget: effects.createdTarget,
      affectedParentKeys: effects.affectedParentKeys,
      affectedPageIds: effects.affectedPageIds,
      affectedDatabaseIds: effects.affectedDatabaseIds,
      affectedViewIds: effects.affectedViewIds,
      committedRevisions: effects.committedRevisions,
      changeLogSeq,
      committedAt: now,
    }),
  });
  return { ok: true, value: persisted.result };
};

export interface ApplyLibraryModuleOptions {
  readonly now?: () => string;
}

export const applyLibraryModuleInDatabase = (
  database: Database.Database,
  request: LibraryModuleApplyRequest,
  options: ApplyLibraryModuleOptions = {},
): LibraryModuleApplyResult => {
  try {
    return database.transaction(() =>
      runApply(database, request, options.now?.() ?? new Date().toISOString())
    ).immediate();
  } catch (error) {
    if (error instanceof LibraryModuleStateError) {
      return {
        ok: false,
        error: libraryModuleFailure(error.code, error.message),
      };
    }
    if (error instanceof AuthoritativeOperationReceiptError) {
      return {
        ok: false,
        error: libraryModuleFailure(
          error.code === "operation_id_collision"
            ? "identity_conflict"
            : "state_corrupt",
          error.message,
        ),
      };
    }
    return {
      ok: false,
      error: libraryModuleFailure(
        "unknown",
        error instanceof Error ? error.message : "Library operation failed",
        true,
      ),
    };
  }
};
