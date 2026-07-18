import type Database from "better-sqlite3";
import { createHash } from "node:crypto";

import { planBlockOwnershipClosure } from "../../shared/block-ownership-copy-plan";
import { readBlockStoreEpoch } from "./block-store-metadata";
import { replaceDocumentSecondaryProjections } from "./block-document-projections";
import { rebuildPageReadModelProjection } from "./page-read-store";
import { refreshScheduledPageIndexProjection } from "./scheduled-page-store";

export interface LibraryContentRehomePlan {
  readonly operationId: string;
  readonly callIdentity: string;
  readonly requestHash: string;
  readonly actorProjectId: string;
  readonly sourceProjectId: string;
  readonly targetProjectId: string;
  readonly libraryId: string;
  readonly storeEpoch: string;
  readonly rootPageIds: readonly string[];
  readonly blockIds: readonly string[];
  readonly documentIds: readonly string[];
  readonly databaseBlockIds: readonly string[];
  readonly databaseViewIds: readonly string[];
  readonly authorityKind?: "project" | "local_library";
}

interface ProjectRow {
  readonly id: string;
  readonly library_id: string;
  readonly lifecycle: "active" | "inactive" | "archived";
}

const compareStrings = (left: string, right: string): number =>
  left.localeCompare(right);

const uniqueSorted = (values: readonly string[]): readonly string[] =>
  [...new Set(values)].sort(compareStrings);

const placeholders = (values: readonly unknown[]): string =>
  values.map(() => "?").join(", ");

const requireProject = (
  database: Database.Database,
  projectId: string,
): ProjectRow => {
  const row = database.prepare(`
    SELECT id, library_id, lifecycle FROM projects WHERE id = ?
  `).get(projectId) as ProjectRow | undefined;
  if (row) return row;
  throw new Error(`Project not found: ${projectId}`);
};

const readOwnershipClosure = (
  database: Database.Database,
  sourceProjectId: string,
  rootPageIds: readonly string[],
): Readonly<{
  blockIds: readonly string[];
  documentIds: readonly string[];
  databaseBlockIds: readonly string[];
  databaseViewIds: readonly string[];
}> => {
  const blockIds = new Set<string>();
  const documentIds = new Set<string>();
  const databaseBlockIds = new Set<string>();
  const queuedRoots = [...rootPageIds];
  const visitedRoots = new Set<string>();
  while (queuedRoots.length > 0) {
    const roots = queuedRoots.splice(0).filter((root) => !visitedRoots.has(root));
    if (roots.length === 0) continue;
    roots.forEach((root) => visitedRoots.add(root));
    const closure = planBlockOwnershipClosure({
      readBlock: (blockId) => (
        database.prepare(`
          SELECT id AS blockId, type AS blockType,
            containing_document_id AS containingDocumentId
          FROM blocks
          WHERE id = ? AND project_id = ? AND lifecycle <> 'deleted'
        `).get(blockId, sourceProjectId) as {
          readonly blockId: string;
          readonly blockType: string;
          readonly containingDocumentId: string | null;
        } | undefined
      ) ?? null,
      readOwnedDocument: (ownerBlockId) => (
        database.prepare(`
          SELECT document.id AS documentId, ownership.block_id AS ownerBlockId,
            document.schema_key AS schemaKey,
            document.schema_version AS schemaVersion
          FROM block_documents ownership
          INNER JOIN documents document
            ON document.id = ownership.document_id
           AND document.project_id = ownership.project_id
          WHERE ownership.block_id = ? AND ownership.project_id = ?
            AND document.readiness = 'ready'
        `).get(ownerBlockId, sourceProjectId) as {
          readonly documentId: string;
          readonly ownerBlockId: string;
          readonly schemaKey: string;
          readonly schemaVersion: number;
        } | undefined
      ) ?? null,
      readDocumentBlocks: (documentId) => {
        const indexed = database.prepare(`
          SELECT block.id AS blockId, block.type AS blockType,
            block.containing_document_id AS containingDocumentId
          FROM document_block_index block_index
          INNER JOIN blocks block ON block.id = block_index.block_id
          WHERE block_index.document_id = ? AND block.project_id = ?
          ORDER BY block_index.ordinal, block.id
        `).all(documentId, sourceProjectId) as readonly {
          readonly blockId: string;
          readonly blockType: string;
          readonly containingDocumentId: string | null;
        }[];
        const physical = database.prepare(`
          SELECT id AS blockId FROM blocks
          WHERE containing_document_id = ? AND project_id = ?
            AND lifecycle <> 'deleted'
          ORDER BY id
        `).all(documentId, sourceProjectId) as readonly { readonly blockId: string }[];
        if (
          JSON.stringify(uniqueSorted(indexed.map((block) => block.blockId)))
          !== JSON.stringify(uniqueSorted(physical.map((block) => block.blockId)))
        ) {
          throw new Error(`Document ${documentId} has an unknown Block projection`);
        }
        return indexed;
      },
    }, roots);
    closure.blocks.forEach((block) => blockIds.add(block.blockId));
    closure.documents.forEach((document) => documentIds.add(document.documentId));
    const closureBlockIds = closure.blocks.map((block) => block.blockId);
    if (closureBlockIds.length === 0) continue;
    const databases = database.prepare(`
      SELECT container.block_id AS databaseBlockId,
        EXISTS (
          SELECT 1 FROM project_database_bindings binding
          WHERE binding.database_block_id = container.block_id
            AND binding.lifecycle = 'active'
        ) AS isProjectBound
      FROM database_containers container
      INNER JOIN blocks block ON block.id = container.block_id
      WHERE block.project_id = ?
        AND container.block_id IN (${placeholders(closureBlockIds)})
    `).all(sourceProjectId, ...closureBlockIds) as readonly {
      readonly databaseBlockId: string;
      readonly isProjectBound: number;
    }[];
    if (databases.some((row) => row.isProjectBound === 1)) {
      throw new Error("A Project-bound Database cannot be rehomed");
    }
    databases.forEach((row) => databaseBlockIds.add(row.databaseBlockId));
    const nextDatabases = databases.map((row) => row.databaseBlockId);
    if (nextDatabases.length === 0) continue;
    const memberPages = database.prepare(`
      SELECT membership.page_block_id AS pageId
      FROM data_source_page_memberships membership
      INNER JOIN data_sources source ON source.id = membership.data_source_id
      INNER JOIN blocks page ON page.id = membership.page_block_id
      WHERE page.project_id = ? AND membership.removed_at IS NULL
        AND source.home_database_block_id IN (${placeholders(nextDatabases)})
      ORDER BY membership.page_block_id
    `).all(sourceProjectId, ...nextDatabases) as readonly { readonly pageId: string }[];
    for (const member of memberPages) {
      if (!visitedRoots.has(member.pageId)) queuedRoots.push(member.pageId);
    }
  }
  const nextBlockIds = uniqueSorted([...blockIds]);
  const nextDocumentIds = uniqueSorted([...documentIds]);
  if (documentIds.size === 0 || blockIds.size < rootPageIds.length) {
    throw new Error("Page ownership closure is incomplete");
  }
  const invalidPageCoordinates = database.prepare(`
    SELECT page.block_id AS pageId
    FROM pages page
    INNER JOIN blocks block ON block.id = page.block_id
    LEFT JOIN block_documents ownership
      ON ownership.block_id = page.block_id
      AND ownership.document_id = page.document_id
      AND ownership.project_id = block.project_id
    LEFT JOIN documents document
      ON document.id = page.document_id
      AND document.project_id = block.project_id
    LEFT JOIN pages parent_page
      ON page.parent_kind = 'page'
      AND parent_page.block_id = page.parent_id
      AND parent_page.library_id = page.library_id
    LEFT JOIN data_sources source
      ON page.parent_kind = 'data_source'
      AND source.id = page.parent_id
      AND source.library_id = page.library_id
      AND source.lifecycle <> 'deleted'
    WHERE page.block_id IN (${placeholders(nextBlockIds)})
      AND (
        block.project_id <> ?
        OR block.type <> 'page'
        OR block.lifecycle <> page.lifecycle
        OR block.location_revision <> page.parent_revision
        OR ownership.block_id IS NULL
        OR document.id IS NULL
        OR (
          page.parent_kind = 'library'
          AND (
            block.location_kind <> 'space'
            OR NOT EXISTS (
              SELECT 1 FROM top_level_block_placements placement
              WHERE placement.block_id = page.block_id
                AND placement.project_id = block.project_id
            )
            OR NOT EXISTS (
              SELECT 1 FROM library_block_placements placement
              WHERE placement.block_id = page.block_id
                AND placement.library_id = page.library_id
            )
          )
        )
        OR (
          page.parent_kind = 'page'
          AND (
            parent_page.block_id IS NULL
            OR block.location_kind <> 'document'
            OR block.containing_document_id <> parent_page.document_id
          )
        )
        OR (
          page.parent_kind = 'data_source'
          AND (
            source.id IS NULL
            OR block.location_kind <> 'database'
            OR block.containing_database_id <> source.home_database_block_id
            OR NOT EXISTS (
              SELECT 1 FROM data_source_page_memberships membership
              WHERE membership.page_block_id = page.block_id
                AND membership.data_source_id = page.parent_id
                AND membership.removed_at IS NULL
            )
          )
        )
      )
    LIMIT 1
  `).get(...nextBlockIds, sourceProjectId) as { readonly pageId: string } | undefined;
  if (invalidPageCoordinates) {
    throw new Error(
      `Page ${invalidPageCoordinates.pageId} canonical and physical ownership coordinates diverge`,
    );
  }
  const nextDatabaseBlockIds = uniqueSorted([...databaseBlockIds]);
  const databaseViewIds = nextDatabaseBlockIds.length === 0
    ? []
    : (database.prepare(`
        SELECT id FROM database_views
        WHERE database_block_id IN (${placeholders(nextDatabaseBlockIds)})
        ORDER BY id
      `).all(...nextDatabaseBlockIds) as readonly { readonly id: string }[])
      .map((row) => row.id);
  return {
    blockIds: nextBlockIds,
    documentIds: nextDocumentIds,
    databaseBlockIds: nextDatabaseBlockIds,
    databaseViewIds,
  };
};

export const prepareLibraryContentRehome = (
  database: Database.Database,
  input: Readonly<{
    actorProjectId: string;
    operationId: string;
    callIdentity: string;
    sourceProjectId: string;
    targetProjectId: string;
    rootPageIds: readonly string[];
    storeEpoch: string;
    authorityKind?: "project" | "local_library";
  }>,
): LibraryContentRehomePlan => {
  const rootPageIds = uniqueSorted(input.rootPageIds);
  if (rootPageIds.length === 0) {
    throw new Error("Library content rehome requires at least one Page root");
  }
  if (readBlockStoreEpoch(database) !== input.storeEpoch) {
    throw new Error("Library content rehome belongs to a stale store epoch");
  }
  const actor = requireProject(database, input.actorProjectId);
  const source = requireProject(database, input.sourceProjectId);
  const target = requireProject(database, input.targetProjectId);
  const authorityKind = input.authorityKind ?? "project";
  if (
    authorityKind === "project" &&
    (actor.lifecycle !== "active" || source.lifecycle === "archived" || target.lifecycle !== "active")
  ) {
    throw new Error("Library content rehome requires active actor and target Projects");
  }
  if (
    actor.library_id !== source.library_id
    || actor.library_id !== target.library_id
  ) {
    throw new Error("Library content rehome cannot cross Library boundaries");
  }
  const closure = readOwnershipClosure(
    database,
    input.sourceProjectId,
    rootPageIds,
  );
  const requestHash = createHash("sha256").update(JSON.stringify([
    input.operationId,
    input.callIdentity,
    input.actorProjectId,
    input.sourceProjectId,
    input.targetProjectId,
    actor.library_id,
    input.storeEpoch,
    rootPageIds,
    closure.blockIds,
    closure.documentIds,
    closure.databaseBlockIds,
    closure.databaseViewIds,
    authorityKind,
  ])).digest("hex");
  return {
    operationId: input.operationId,
    callIdentity: input.callIdentity,
    requestHash,
    actorProjectId: input.actorProjectId,
    sourceProjectId: input.sourceProjectId,
    targetProjectId: input.targetProjectId,
    libraryId: actor.library_id,
    storeEpoch: input.storeEpoch,
    rootPageIds,
    blockIds: closure.blockIds,
    documentIds: closure.documentIds,
    databaseBlockIds: closure.databaseBlockIds,
    databaseViewIds: closure.databaseViewIds,
    ...(authorityKind === "local_library" ? { authorityKind } : {}),
  };
};

const updateProjectId = (
  database: Database.Database,
  table: string,
  idColumn: string,
  ids: readonly string[],
  sourceProjectId: string,
  targetProjectId: string,
): void => {
  if (ids.length === 0) return;
  database.prepare(`
    UPDATE ${table}
    SET project_id = ?
    WHERE project_id = ? AND ${idColumn} IN (${placeholders(ids)})
  `).run(targetProjectId, sourceProjectId, ...ids);
};

export const applyLibraryContentRehomeInTransaction = (
  database: Database.Database,
  expected: LibraryContentRehomePlan,
  options: Readonly<{
    faultInjector?: (point: LibraryContentRehomeFaultPoint) => void;
  }> = {},
): LibraryContentRehomePlan => {
  database.pragma("defer_foreign_keys = ON");
  const current = prepareLibraryContentRehome(database, {
    operationId: expected.operationId,
    callIdentity: expected.callIdentity,
    actorProjectId: expected.actorProjectId,
    sourceProjectId: expected.sourceProjectId,
    targetProjectId: expected.targetProjectId,
    rootPageIds: expected.rootPageIds,
    storeEpoch: expected.storeEpoch,
    ...(expected.authorityKind ? { authorityKind: expected.authorityKind } : {}),
  });
  if (JSON.stringify(current) !== JSON.stringify(expected)) {
    throw new Error("Library content ownership closure changed after prepare");
  }
  if (current.sourceProjectId === current.targetProjectId) return current;

  const pageIds = (database.prepare(`
    SELECT block_id AS pageId FROM pages
    WHERE block_id IN (${placeholders(current.blockIds)})
    ORDER BY block_id
  `).all(...current.blockIds) as readonly { readonly pageId: string }[])
    .map((row) => row.pageId);
  database.prepare(`
    DELETE FROM block_search_units
    WHERE block_id IN (${placeholders(current.blockIds)})
      OR owner_block_id IN (${placeholders(current.blockIds)})
      OR document_id IN (${placeholders(current.documentIds)})
  `).run(...current.blockIds, ...current.blockIds, ...current.documentIds);
  database.prepare(`
    DELETE FROM block_asset_refs
    WHERE block_id IN (${placeholders(current.blockIds)})
      OR owner_block_id IN (${placeholders(current.blockIds)})
      OR document_id IN (${placeholders(current.documentIds)})
  `).run(...current.blockIds, ...current.blockIds, ...current.documentIds);
  if (pageIds.length > 0) {
    database.prepare(`
      DELETE FROM page_read_model
      WHERE page_block_id IN (${placeholders(pageIds)})
    `).run(...pageIds);
    database.prepare(`
      DELETE FROM scheduled_page_index
      WHERE page_block_id IN (${placeholders(pageIds)})
    `).run(...pageIds);
  }
  options.faultInjector?.("after_derived_projection_delete");

  updateProjectId(
    database,
    "documents",
    "id",
    current.documentIds,
    current.sourceProjectId,
    current.targetProjectId,
  );
  options.faultInjector?.("after_core_owner_update");
  updateProjectId(
    database,
    "blocks",
    "id",
    current.blockIds,
    current.sourceProjectId,
    current.targetProjectId,
  );
  updateProjectId(
    database,
    "block_documents",
    "document_id",
    current.documentIds,
    current.sourceProjectId,
    current.targetProjectId,
  );
  updateProjectId(
    database,
    "top_level_block_placements",
    "block_id",
    current.rootPageIds,
    current.sourceProjectId,
    current.targetProjectId,
  );

  for (const documentId of current.documentIds) {
    replaceDocumentSecondaryProjections(database, { documentId });
  }
  rebuildPageReadModelProjection(database, current.targetProjectId, pageIds);
  refreshScheduledPageIndexProjection(
    database,
    current.targetProjectId,
    pageIds,
    new Date().toISOString(),
  );
  options.faultInjector?.("after_projection_rebuild");

  const remainingBlocks = database.prepare(`
    SELECT COUNT(*) AS count FROM blocks
    WHERE project_id <> ? AND id IN (${placeholders(current.blockIds)})
  `).get(current.targetProjectId, ...current.blockIds) as { readonly count: number };
  const remainingDocuments = database.prepare(`
    SELECT COUNT(*) AS count FROM documents
    WHERE project_id <> ? AND id IN (${placeholders(current.documentIds)})
  `).get(current.targetProjectId, ...current.documentIds) as { readonly count: number };
  if (remainingBlocks.count > 0 || remainingDocuments.count > 0) {
    throw new Error("Library content rehome left a split ownership closure");
  }
  const violations = database.pragma("foreign_key_check") as unknown[];
  if (violations.length > 0) {
    throw new Error(
      `Library content rehome produced ${violations.length} foreign-key violation(s)`,
    );
  }
  const committedAt = new Date().toISOString();
  database.prepare(`
    INSERT INTO library_content_relocations (
      operation_id, call_identity, actor_project_id, source_project_id,
      target_project_id, library_id, store_epoch, request_hash,
      root_page_ids_json, block_ids_json, document_ids_json,
      status, committed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'committed', ?)
  `).run(
    current.operationId,
    current.callIdentity,
    current.actorProjectId,
    current.sourceProjectId,
    current.targetProjectId,
    current.libraryId,
    current.storeEpoch,
    current.requestHash,
    JSON.stringify(current.rootPageIds),
    JSON.stringify(current.blockIds),
    JSON.stringify(current.documentIds),
    committedAt,
  );
  const insertMember = database.prepare(`
    INSERT INTO library_content_relocation_members (
      operation_id, resource_kind, resource_id,
      source_project_id, final_project_id
    ) VALUES (?, ?, ?, ?, ?)
  `);
  for (const blockId of current.blockIds) {
    insertMember.run(
      current.operationId,
      "block",
      blockId,
      current.sourceProjectId,
      current.targetProjectId,
    );
  }
  for (const documentId of current.documentIds) {
    insertMember.run(
      current.operationId,
      "document",
      documentId,
      current.sourceProjectId,
      current.targetProjectId,
    );
  }
  options.faultInjector?.("after_ledger_record");
  const finalViolations = database.pragma("foreign_key_check") as unknown[];
  if (finalViolations.length > 0) {
    throw new Error(
      `Library content rehome ledger produced ${finalViolations.length} foreign-key violation(s)`,
    );
  }
  return current;
};

export type LibraryContentRehomeFaultPoint =
  | "after_derived_projection_delete"
  | "after_core_owner_update"
  | "after_projection_rebuild"
  | "after_ledger_record";
