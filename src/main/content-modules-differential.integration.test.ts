import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { afterEach, describe, expect, test } from "vitest";

import {
  parseDatabaseId,
  parseDatabaseViewId,
  parseDataSourceId,
  parseDataSourceOptionId,
  parseDataSourcePropertyId,
} from "../shared/database-identities";
import { DATABASE_MODULE_V2_CONTRACT_VERSION } from "../shared/database-module-v2";
import { LIBRARY_MODULE_CONTRACT_VERSION } from "../shared/library-module";
import { DOCUMENT_VERSION_CONTRACT_VERSION } from "../shared/block-documents/document-history";
import { primaryCanvasBlockId } from "../shared/block-documents";
import { createUuidV7 } from "../shared/uuid-v7";
import { closeDatabase, getDb, initializeDatabase } from "./local-store/database";
import { createPage } from "./local-store/database-pages";
import {
  createProject,
  listProjects,
  reorderProjects,
  setProjectLifecycle,
  setProjectPinned,
  updateProject,
} from "./local-store/projects";
import {
  archiveProjectSession,
  createProjectSession,
  createProjectSessionTab,
  deleteProjectSession,
  deleteProjectSessionTab,
  getProjectSession,
  listProjectSessionSummaries,
  listProjectlessSessionSummaries,
  markProjectSessionUnread,
  moveProjectSessionToProject,
  moveProjectSessionTab,
  reorderProjectSessions,
  setPinnedProjectSessionOrder,
  setProjectSessionPinned,
  unarchiveProjectSession,
  updateProjectSession,
  updateProjectSessionTab,
  updateProjectSessionTabState,
  upsertProjectSessionThreadLink,
} from "./local-store/project-sessions";
import {
  applyDatabaseModuleV2,
  readDatabaseModuleV2,
} from "./local-store/database-module-v2-runtime";
import {
  applyLibraryModuleInDatabase,
  readLibraryModuleInDatabase,
} from "./local-store/library-module-runtime";
import { searchDocumentBlockUnits } from "./local-store/block-document-projections";
import { readLibraryPageDetailInDatabase } from "./local-store/page-detail";
import { listPageHistory } from "./local-store/page-history";
import { createDocumentVersionCheckpoint } from "./local-store/document-versions";
import { getOwnedDocumentDescriptor } from "./local-store/block-document-cutover";
import {
  getCodexThread,
  setCodexThreadHasUnreadTurn,
  setCodexThreadPinned,
  upsertCodexThread,
} from "./codex/codex-link-repository";
import {
  getCodexThreadDynamicToolCatalogs,
  replaceCodexThreadDynamicToolCatalogs,
} from "./codex/codex-dynamic-tool-catalog-repository";
import {
  getCodexProjectPermissionModeSelection,
  putCodexProjectPermissionModeSelection,
} from "./local-store/codex-project-permission-modes";
import {
  getCodexThreadWritableRoots,
  mergeCodexThreadWritableRoots,
  replaceCodexThreadWritableRoots,
} from "./local-store/codex-thread-writable-roots";
import {
  listCodexBackgroundProcesses,
  upsertCodexBackgroundProcess,
} from "./local-store/codex-background-processes";
import {
  getCodexProjectThreadOrder,
  moveCodexProjectThread,
  setCodexProjectThreadOrder,
} from "./local-store/codex-project-thread-move";
import {
  getCodexSidebarChatOrder,
  setCodexSidebarChatOrder,
} from "./local-store/codex-sidebar-chat-order";
import { CodexNodexAgentAuthorityRegistry } from "./codex/codex-nodex-agent-authority";
import { CommandPaletteThreadSearchService } from "./codex/command-palette-thread-search-service";
import { CoreClient, CoreModuleResponseError } from "./core-client/core-client";
import { DuplicatePageV3InputSchema } from "../shared/nodex-agent-tools";
import {
  executeNodexAgentDuplicatePage,
  prepareNodexAgentDuplicatePage,
} from "./agent-tools/transfer-service";

const CORE_BINARY = path.resolve("target/debug/nodex-core");
const tempDirectories: string[] = [];
const children: ChildProcessWithoutNullStreams[] = [];

const stage = async <Value>(
  label: string,
  operation: Promise<Value>,
): Promise<Value> => {
  try {
    return await operation;
  } catch (error) {
    throw new Error(`Gate C differential failed during ${label}`, { cause: error });
  }
};

const temporaryDirectory = (prefix: string): string => {
  const directory = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirectories.push(directory);
  return directory;
};

const spawnCore = (nodexHome: string): ChildProcessWithoutNullStreams => {
  const child = spawn(CORE_BINARY, ["--home", nodexHome], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  children.push(child);
  return child;
};

const waitForDescriptor = (
  child: ChildProcessWithoutNullStreams,
): Promise<void> =>
  new Promise((resolve, reject) => {
    const lines = createInterface({ input: child.stdout });
    const timeout = setTimeout(() => {
      lines.close();
      reject(new Error("Core did not publish its runtime descriptor"));
    }, 5_000);
    lines.once("line", () => {
      clearTimeout(timeout);
      lines.close();
      resolve();
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      lines.close();
      reject(error);
    });
  });

const waitForExit = (
  child: ChildProcessWithoutNullStreams,
): Promise<number | null> => {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve) => child.once("exit", resolve));
};

const withoutVolatileFields = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(withoutVolatileFields);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) =>
        key !== "createdAt"
        && key !== "updatedAt"
        && key !== "created_at"
        && key !== "updated_at"
      )
      .map(([key, entry]) => [key, withoutVolatileFields(entry)]),
  );
};

const withSnakeCaseKeys = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(withSnakeCaseKeys);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key.replaceAll(/([a-z0-9])([A-Z])/gu, "$1_$2").toLowerCase(),
      withSnakeCaseKeys(entry),
    ]),
  );
};

const readOraclePageContent = (
  database: ReturnType<typeof getDb>,
  pageId: string,
) => {
  const row = database.prepare(`
    SELECT page.library_id AS libraryId, metadata.store_epoch AS storeEpoch,
      (SELECT COALESCE(MAX(seq), 0) FROM change_log) AS changeLogSeq,
      page.block_id AS pageId, page.metadata_revision AS metadataRevision,
      document.id AS documentId, document.generation AS documentGeneration,
      document.head_seq AS documentHeadSeq, document.schema_key AS schemaKey,
      document.schema_version AS schemaVersion, materialization.title,
      materialization.title_rich_json AS richTitleJson,
      materialization.nfm AS bodyNfm, materialization.plain_text AS plainText,
      materialization.preview, materialization.references_json AS referencesJson,
      materialization.asset_refs_json AS assetRefsJson
    FROM pages page
    INNER JOIN documents document ON document.id = page.document_id
    INNER JOIN document_materializations materialization
      ON materialization.document_id = document.id
      AND materialization.generation = document.generation
      AND materialization.projected_seq = document.head_seq
      AND materialization.schema_version = document.schema_version
    INNER JOIN block_store_metadata metadata ON metadata.id = 1
    WHERE page.block_id = ? AND page.lifecycle <> 'deleted'
      AND document.readiness = 'ready'
  `).get(pageId) as {
    readonly libraryId: string;
    readonly storeEpoch: string;
    readonly changeLogSeq: number;
    readonly pageId: string;
    readonly metadataRevision: number;
    readonly documentId: string;
    readonly documentGeneration: number;
    readonly documentHeadSeq: number;
    readonly schemaKey: string;
    readonly schemaVersion: number;
    readonly title: string;
    readonly richTitleJson: string;
    readonly bodyNfm: string;
    readonly plainText: string;
    readonly preview: string;
    readonly referencesJson: string;
    readonly assetRefsJson: string;
  } | undefined;
  if (!row) throw new Error(`Page ${pageId} has no exact TypeScript content projection`);
  return {
    version: 1,
    library_id: row.libraryId,
    store_epoch: row.storeEpoch,
    change_log_seq: row.changeLogSeq,
    page_id: row.pageId,
    metadata_revision: row.metadataRevision,
    document_id: row.documentId,
    document_generation: row.documentGeneration,
    document_head_seq: row.documentHeadSeq,
    schema_key: row.schemaKey,
    schema_version: row.schemaVersion,
    title: row.title,
    rich_title: JSON.parse(row.richTitleJson) as unknown,
    body_nfm: row.bodyNfm,
    plain_text: row.plainText,
    preview: row.preview,
    references: JSON.parse(row.referencesJson) as unknown,
    asset_refs: JSON.parse(row.assetRefsJson) as unknown,
    access_context: { kind: "library" as const },
  };
};

afterEach(async () => {
  closeDatabase();
  delete process.env.NODEX_HOME;
  for (const child of children.splice(0)) {
    if (child.exitCode === null) child.kill();
    await waitForExit(child);
  }
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("TypeScript/Rust content Module differential", () => {
  test("preserves normalized Library and Database semantics on independent copies", async () => {
    expect(existsSync(CORE_BINARY), "build nodex-core before the differential gate").toBe(true);
    const typescriptHome = temporaryDirectory("nodex-core-ts-oracle-");
    const rustHome = temporaryDirectory("nodex-core-rust-candidate-");
    process.env.NODEX_HOME = typescriptHome;
    await initializeDatabase();
    const oracle = getDb();
    const coordinates = oracle.prepare(`
      SELECT project.id AS projectId, profile.id AS profileId,
        library.id AS libraryId, metadata.store_epoch AS storeEpoch,
        project.database_block_id AS primaryDatabaseId,
        source.id AS primaryDataSourceId,
        source.schema_revision AS primaryDataSourceRevision
      FROM projects project
      INNER JOIN libraries library ON library.id = project.library_id
      INNER JOIN profiles profile ON profile.id = library.profile_id
      INNER JOIN block_store_metadata metadata ON metadata.id = 1
      INNER JOIN data_sources source
        ON source.home_database_block_id = project.database_block_id
      ORDER BY project.created, project.id, source.rank_key, source.id
      LIMIT 1
    `).get() as {
      readonly projectId: string;
      readonly profileId: string;
      readonly libraryId: string;
      readonly storeEpoch: string;
      readonly primaryDatabaseId: string;
      readonly primaryDataSourceId: string;
      readonly primaryDataSourceRevision: number;
    };
    const sourcePage = await createPage(coordinates.projectId, "triage", {
      title: "Gate C imported row",
    });
    const anchorPage = await createPage(coordinates.projectId, "triage", {
      title: "Secondary imported row",
    });
    const sourceDocument = oracle.prepare(`
      SELECT document.id, document.generation, document.head_seq
      FROM pages page INNER JOIN documents document ON document.id = page.document_id
      WHERE page.block_id = ?
    `).get(sourcePage.id) as {
      readonly id: string;
      readonly generation: number;
      readonly head_seq: number;
    };
    createDocumentVersionCheckpoint(oracle, {
      version: DOCUMENT_VERSION_CONTRACT_VERSION,
      projectId: coordinates.projectId,
      storeEpoch: coordinates.storeEpoch,
      documentId: sourceDocument.id,
      expectedGeneration: sourceDocument.generation,
      expectedHeadSeq: sourceDocument.head_seq,
      cause: "manual",
      label: "Gate C imported checkpoint",
      actor: { displayName: "Gate C" },
      revisionKind: "manual",
    });
    closeDatabase();
    cpSync(typescriptHome, rustHome, { recursive: true });
    await initializeDatabase();

    const child = spawnCore(rustHome);
    await waitForDescriptor(child);
    const candidate = await stage("Core connect", CoreClient.connect({
      nodexHome: rustHome,
      clientKind: "test",
      buildId: "content-modules-gate-c",
      projectId: coordinates.projectId,
    }));
    expect(candidate.handshake).toMatchObject({
      profile_id: coordinates.profileId,
      library_id: coordinates.libraryId,
      store_epoch: coordinates.storeEpoch,
      schema_version: 83,
    });

    const oracleWorkspaceProjects = listProjects();
    const oracleWorkspaceSessions = [
      ...listProjectlessSessionSummaries(),
      ...oracleWorkspaceProjects.flatMap((project) =>
        listProjectSessionSummaries(project.id),
      ),
    ];
    const candidateWorkspace = await stage(
      "Project Workspace startup",
      candidate.workspaceRead({ kind: "startup" }),
    );
    if (candidateWorkspace.value.kind !== "startup") {
      throw new Error("Expected Project Workspace startup snapshot");
    }
    expect(candidateWorkspace.value.projects).toEqual(
      oracleWorkspaceProjects.map((project) => ({
        id: project.id,
        library_id: project.libraryId,
        database_id: project.databaseId,
        lifecycle: project.lifecycle,
        binding_revision: project.bindingRevision,
        name: project.name,
        description: project.description,
        icon: project.icon || null,
        sources: project.sources,
        primary_workspace_root: project.primaryWorkspaceRoot,
        pinned: project.pinned,
        pinned_order: project.pinnedOrder,
        created_at: project.created.toISOString(),
        updated_at: project.updated.toISOString(),
      })),
    );
    const comparableSessions = (
      sessions: readonly {
        readonly id: string;
        readonly project_id?: string | null;
        readonly no_thread_fallback_title: string;
        readonly display_title: string;
        readonly order: number;
        readonly pinned: boolean;
        readonly pinned_order?: number | null;
        readonly archived: boolean;
        readonly archived_at?: string | null;
        readonly unread: boolean;
        readonly left_pane_collapsed: boolean;
        readonly thread_id?: string | null;
        readonly created_at: string;
        readonly updated_at: string;
      }[],
    ) => sessions
      .map((session) => ({
        ...session,
        project_id: session.project_id ?? null,
        pinned_order: session.pinned_order ?? null,
        archived_at: session.archived_at ?? null,
        thread_id: session.thread_id ?? null,
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
    expect(comparableSessions(candidateWorkspace.value.sessions)).toEqual(
      comparableSessions(oracleWorkspaceSessions.map((session) => ({
        id: session.id,
        project_id: session.projectId,
        no_thread_fallback_title: session.noThreadFallbackTitle,
        display_title: session.displayTitle,
        order: session.order,
        pinned: session.pinned,
        pinned_order: session.pinnedOrder,
        archived: session.archived,
        archived_at: session.archivedAt,
        unread: session.unread,
        left_pane_collapsed: session.leftPaneCollapsed,
        thread_id: session.thread?.threadId ?? null,
        created_at: session.createdAt,
        updated_at: session.updatedAt,
      }))),
    );
    const oracleWorkspaceSession = oracleWorkspaceSessions[0];
    if (oracleWorkspaceSession) {
      const oracleSession = getProjectSession(oracleWorkspaceSession.id);
      if (!oracleSession) throw new Error("Oracle Project Session disappeared");
      const candidateSession = await stage(
        "Project Workspace Session",
        candidate.workspaceRead({
          kind: "session",
          session_id: oracleWorkspaceSession.id,
        }),
      );
      if (candidateSession.value.kind !== "session") {
        throw new Error("Expected Project Workspace Session snapshot");
      }
      expect(candidateSession.value.session).toEqual(
        comparableSessions([{
          id: oracleSession.id,
          project_id: oracleSession.projectId,
          no_thread_fallback_title: oracleSession.noThreadFallbackTitle,
          display_title: oracleSession.displayTitle,
          order: oracleSession.order,
          pinned: oracleSession.pinned,
          pinned_order: oracleSession.pinnedOrder,
          archived: oracleSession.archived,
          archived_at: oracleSession.archivedAt,
          unread: oracleSession.unread,
          left_pane_collapsed: oracleSession.leftPaneCollapsed,
          thread_id: oracleSession.thread?.threadId ?? null,
          created_at: oracleSession.createdAt,
          updated_at: oracleSession.updatedAt,
        }])[0],
      );
      expect(candidateSession.value.panels).toEqual(oracleSession.panels);
    }

    const oracleImportedDetail = readLibraryPageDetailInDatabase(
      getDb(),
      sourcePage.id,
      "app_window",
    );
    if (!oracleImportedDetail.ok) {
      throw new Error(oracleImportedDetail.error.message);
    }
    const candidateImportedDetail = await stage(
      "Library imported Data Source Page detail",
      candidate.libraryRead({
        kind: "page_detail",
        page_id: sourcePage.id,
      }),
    );
    if (candidateImportedDetail.value.kind !== "page_detail") {
      throw new Error("Expected imported Rust Page detail");
    }
    expect(candidateImportedDetail.value.value).toMatchObject({
      version: oracleImportedDetail.value.version,
      library_id: oracleImportedDetail.value.libraryId,
      store_epoch: oracleImportedDetail.value.storeEpoch,
      change_log_seq: oracleImportedDetail.value.changeLogSeq,
      access_context: { kind: oracleImportedDetail.value.accessContext.kind },
    });
    const oracleImportedContext = oracleImportedDetail.value.dataSourceContext;
    if (oracleImportedContext.kind !== "member") {
      throw new Error("Expected imported TypeScript Data Source context");
    }
    expect(withoutVolatileFields(candidateImportedDetail.value.value.page)).toEqual(
      withoutVolatileFields(oracleImportedDetail.value.page),
    );
    expect(withoutVolatileFields(candidateImportedDetail.value.value.data_source_context)).toEqual(
      withoutVolatileFields({
        kind: "member",
        membership: {
          membership_id: oracleImportedContext.membership.membershipId,
          data_source_id: oracleImportedContext.membership.dataSourceId,
          revision: oracleImportedContext.membership.revision,
          created_at: oracleImportedContext.membership.createdAt,
        },
        database: oracleImportedContext.database,
        data_source: oracleImportedContext.dataSource,
        properties: oracleImportedContext.properties,
        values: oracleImportedContext.values,
      }),
    );
    const oracleImportedContent = readOraclePageContent(getDb(), sourcePage.id);
    const candidateImportedContent = await stage(
      "Library imported Page content",
      candidate.libraryRead({
        kind: "page_content",
        page_id: sourcePage.id,
      }),
    );
    if (candidateImportedContent.value.kind !== "page_content") {
      throw new Error("Expected imported Rust Page content");
    }
    expect(candidateImportedContent.value.value).toEqual(oracleImportedContent);

    const oracleImportedHistory = listPageHistory(getDb(), {
      version: 1,
      requestingProjectId: coordinates.projectId,
      pageId: sourcePage.id,
      pageSize: 1,
    });
    const candidateImportedHistory = await stage(
      "Library imported Page history",
      candidate.libraryRead({
        kind: "page_history",
        page_id: sourcePage.id,
        before: null,
        limit: 1,
      }),
    );
    if (candidateImportedHistory.value.kind !== "page_history") {
      throw new Error("Expected imported Rust Page history");
    }
    expect(candidateImportedHistory.value.value).toEqual(
      withSnakeCaseKeys(oracleImportedHistory),
    );
    if (!oracleImportedHistory.nextCursor) {
      throw new Error("Expected imported Page history to exercise its cursor");
    }
    const oracleImportedHistoryNext = listPageHistory(getDb(), {
      version: 1,
      requestingProjectId: coordinates.projectId,
      pageId: sourcePage.id,
      pageSize: 1,
      before: oracleImportedHistory.nextCursor,
    });
    const candidateImportedHistoryNext = await stage(
      "Library imported Page history next page",
      candidate.libraryRead({
        kind: "page_history",
        page_id: sourcePage.id,
        before: candidateImportedHistory.value.value.next_cursor,
        limit: 1,
      }),
    );
    if (candidateImportedHistoryNext.value.kind !== "page_history") {
      throw new Error("Expected imported Rust Page history next page");
    }
    expect(candidateImportedHistoryNext.value.value).toEqual(
      withSnakeCaseKeys(oracleImportedHistoryNext),
    );

    const oracleLibraryRead = (
      read: Parameters<typeof readLibraryModuleInDatabase>[1]["read"],
    ) => {
      const result = readLibraryModuleInDatabase(getDb(), {
        version: LIBRARY_MODULE_CONTRACT_VERSION,
        read,
      });
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    };
    const oracleLibraryApply = (
      operationId: string,
      operation: Parameters<typeof applyLibraryModuleInDatabase>[1]["operation"],
    ) => applyLibraryModuleInDatabase(getDb(), {
      version: LIBRARY_MODULE_CONTRACT_VERSION,
      operationId,
      storeEpoch: coordinates.storeEpoch,
      operation,
    });

    const pageId = createUuidV7();
    const documentId = createUuidV7();
    const createPageOperationId = "gate-c-library-create-page";
    const oraclePage = oracleLibraryApply(createPageOperationId, {
      kind: "create_page",
      pageId,
      documentId,
      title: "Gate C parity",
      parent: { kind: "library" },
    });
    const candidatePage = await stage("Library create Page", candidate.libraryApply({
      operationId: createPageOperationId,
      intent: {
        kind: "create_page",
        page_id: pageId,
        document_id: documentId,
        title: "Gate C parity",
        parent: { kind: "library", before: null },
      },
    }));
    expect(oraclePage).toMatchObject({ ok: true, value: { duplicate: false } });
    if (!oraclePage.ok) throw new Error(oraclePage.error.message);
    expect(candidatePage.receipt).toMatchObject({
      duplicate: oraclePage.value.duplicate,
      operation_kind: oraclePage.value.operationKind,
      did_mutate: oraclePage.value.didMutate,
      affected_page_ids: oraclePage.value.affectedPageIds,
      affected_database_ids: oraclePage.value.affectedDatabaseIds,
    });

    const oraclePath = oracleLibraryRead({
      mode: "path",
      target: { kind: "page", pageId },
    });
    const candidatePath = await stage("Library Page path", candidate.libraryRead({
      kind: "path",
      target: { kind: "page", page_id: pageId },
    }));
    if (oraclePath.value.kind !== "path" || candidatePath.value.kind !== "path") {
      throw new Error("Expected Page paths from both Library authorities");
    }
    const oraclePageNode = oraclePath.value.nodes.at(-1);
    const candidatePageNode = candidatePath.value.nodes.at(-1);
    expect(candidatePageNode).toMatchObject({
      kind: "page",
      page_id: pageId,
      title: "Gate C parity",
      parent_revision: oraclePageNode?.kind === "page"
        ? oraclePageNode.parentRevision
        : -1,
      metadata_revision: oraclePageNode?.kind === "page"
        ? oraclePageNode.metadataRevision
        : -1,
      document_generation: oraclePageNode?.kind === "page"
        ? oraclePageNode.documentGeneration
        : -1,
      document_head_seq: oraclePageNode?.kind === "page"
        ? oraclePageNode.documentHeadSeq
        : -1,
    });
    const oracleDetail = readLibraryPageDetailInDatabase(
      getDb(),
      pageId,
      "app_window",
    );
    if (!oracleDetail.ok) throw new Error(oracleDetail.error.message);
    const candidateDetail = await stage("Library Page detail", candidate.libraryRead({
      kind: "page_detail",
      page_id: pageId,
    }));
    if (candidateDetail.value.kind !== "page_detail") {
      throw new Error("Expected Rust Page detail");
    }
    expect(candidateDetail.value.value).toMatchObject({
      version: oracleDetail.value.version,
      library_id: oracleDetail.value.libraryId,
      store_epoch: oracleDetail.value.storeEpoch,
      change_log_seq: oracleDetail.value.changeLogSeq,
      access_context: { kind: oracleDetail.value.accessContext.kind },
    });
    expect(withoutVolatileFields(candidateDetail.value.value.page)).toEqual(
      withoutVolatileFields(oracleDetail.value.page),
    );
    expect(candidateDetail.value.value).toMatchObject({
      document: {
        readiness: oracleDetail.value.document.readiness,
        schema_key: oracleDetail.value.document.schemaKey,
        schema_version: oracleDetail.value.document.schemaVersion,
      },
      intrinsic_properties: oracleDetail.value.intrinsicProperties.map((property) => ({
        key: property.key,
        value_type: property.valueType,
        value: property.value,
        revision: property.revision,
      })),
      data_source_context: { kind: "standalone" },
    });
    const oracleContent = readOraclePageContent(getDb(), pageId);
    const candidateContent = await stage("Library Page content", candidate.libraryRead({
      kind: "page_content",
      page_id: pageId,
    }));
    if (candidateContent.value.kind !== "page_content") {
      throw new Error("Expected Rust Page content");
    }
    expect(candidateContent.value.value).toEqual(oracleContent);

    const oracleSearch = searchDocumentBlockUnits(getDb(), {
      libraryId: coordinates.libraryId,
      query: "Gate C",
      ownerType: "page",
      includeArchived: true,
      sourceKinds: ["document_title"],
      limit: 100,
    });
    const firstSearch = await stage("Library search first page", candidate.libraryRead({
      kind: "search",
      query: "Gate C",
      include_archived: true,
      source_kinds: ["document_title"],
      block_types: null,
      cursor: null,
      limit: 1,
    }));
    if (firstSearch.value.kind !== "search") {
      throw new Error("Expected Rust Library search");
    }
    const staleSearchCursor = firstSearch.value.next_cursor;
    if (!staleSearchCursor) {
      throw new Error("Expected a paged Rust Library search cursor");
    }
    const secondSearch = firstSearch.value.has_more
      ? await stage("Library search next page", candidate.libraryRead({
          kind: "search",
          query: "Gate C",
          include_archived: true,
          source_kinds: ["document_title"],
          block_types: null,
          cursor: firstSearch.value.next_cursor,
          limit: 100,
        }))
      : null;
    if (secondSearch && secondSearch.value.kind !== "search") {
      throw new Error("Expected paged Rust Library search");
    }
    const candidateSearch = [
      ...firstSearch.value.items,
      ...(secondSearch?.value.kind === "search" ? secondSearch.value.items : []),
    ];
    expect(candidateSearch).toHaveLength(oracleSearch.length);
    candidateSearch.forEach((hit, index) => {
      const oracleHit = oracleSearch[index];
      expect(oracleHit).toBeDefined();
      expect(hit).toMatchObject({
        project_id: oracleHit?.projectId,
        owner_page_id: oracleHit?.ownerBlockId,
        document_id: oracleHit?.documentId,
        block_id: oracleHit?.blockId,
        block_type: oracleHit?.blockType,
        document_generation: oracleHit?.generation,
        projected_seq: oracleHit?.projectedSeq,
        source_kind: oracleHit?.sourceKind,
        field_key: oracleHit?.fieldKey,
        excerpt: oracleHit?.excerpt,
      });
      expect(hit.rank).toBeCloseTo(oracleHit?.rank ?? Number.NaN, 10);
    });

    const databaseId = parseDatabaseId(createUuidV7());
    const dataSourceId = parseDataSourceId(createUuidV7());
    const viewId = parseDatabaseViewId(createUuidV7());
    const createDatabaseOperationId = "gate-c-library-create-database";
    const oracleDatabase = oracleLibraryApply(createDatabaseOperationId, {
      kind: "create_database",
      databaseId,
      dataSourceId,
      viewId,
      name: "Gate C data",
      parent: { kind: "library" },
    });
    const candidateDatabase = await stage("Library create Database", candidate.libraryApply({
      operationId: createDatabaseOperationId,
      intent: {
        kind: "create_database",
        database_id: databaseId,
        data_source_id: dataSourceId,
        view_id: viewId,
        name: "Gate C data",
        parent: { kind: "library", before: null },
      },
    }));
    if (!oracleDatabase.ok) throw new Error(oracleDatabase.error.message);
    expect(candidateDatabase.receipt).toMatchObject({
      duplicate: false,
      operation_kind: oracleDatabase.value.operationKind,
      affected_database_ids: oracleDatabase.value.affectedDatabaseIds,
      affected_view_ids: oracleDatabase.value.affectedViewIds,
    });

    const grantOperationId = "gate-c-library-grant-database";
    const oracleGrant = oracleLibraryApply(grantOperationId, {
      kind: "grant_project_access",
      projectId: coordinates.projectId,
      target: { kind: "database", databaseId },
      access: "read_write",
    });
    const candidateGrant = await stage("Library grant Database", candidate.libraryApply({
      operationId: grantOperationId,
      intent: {
        kind: "grant_project_access",
        project_id: coordinates.projectId,
        target: { kind: "database", database_id: databaseId },
        access: "read_write",
      },
    }));
    if (!oracleGrant.ok) throw new Error(oracleGrant.error.message);
    expect(candidateGrant.receipt).toMatchObject({
      duplicate: oracleGrant.value.duplicate,
      did_mutate: oracleGrant.value.didMutate,
      affected_database_ids: oracleGrant.value.affectedDatabaseIds,
    });

    const oracleDatabaseRead = (targetDataSourceId = dataSourceId) => {
      const result = readDatabaseModuleV2(getDb(), {
        version: DATABASE_MODULE_V2_CONTRACT_VERSION,
        projectId: coordinates.projectId,
        read: {
          target: {
            kind: "data_source",
            dataSourceId: parseDataSourceId(targetDataSourceId),
          },
          mode: "data_source",
        },
      });
      if (!result.ok || result.value.value.kind !== "data_source") {
        throw new Error(result.ok ? "Expected Data Source" : result.error.message);
      }
      return result.value.value.value;
    };
    const candidateDatabaseRead = async (targetDataSourceId = dataSourceId) => {
      const result = await stage("Database read Data Source", candidate.databaseRead({
        target: { kind: "data_source", data_source_id: targetDataSourceId },
        mode: "data_source",
        filter: null,
        sort: null,
      }));
      if (result.value.kind !== "data_source") {
        throw new Error("Expected Rust Data Source");
      }
      return result.value.value;
    };
    const oracleDataSourceQuery = (targetDataSourceId = dataSourceId) => {
      const result = readDatabaseModuleV2(getDb(), {
        version: DATABASE_MODULE_V2_CONTRACT_VERSION,
        projectId: coordinates.projectId,
        read: {
          target: {
            kind: "data_source",
            dataSourceId: parseDataSourceId(targetDataSourceId),
          },
          mode: "query",
        },
      });
      if (!result.ok || result.value.value.kind !== "data_source_query") {
        throw new Error(result.ok ? "Expected Data Source query" : result.error.message);
      }
      return result.value.value.value;
    };
    const candidateDataSourceQuery = async (targetDataSourceId = dataSourceId) => {
      const result = await stage("Database query Data Source", candidate.databaseRead({
        target: { kind: "data_source", data_source_id: targetDataSourceId },
        mode: "query",
        filter: null,
        sort: null,
      }));
      if (result.value.kind !== "data_source_query") {
        throw new Error("Expected Rust Data Source query");
      }
      return result.value.value;
    };
    const oracleDatabaseDescriptor = (targetDatabaseId: string) => {
      const result = readDatabaseModuleV2(getDb(), {
        version: DATABASE_MODULE_V2_CONTRACT_VERSION,
        projectId: coordinates.projectId,
        read: {
          target: {
            kind: "database",
            databaseId: parseDatabaseId(targetDatabaseId),
          },
          mode: "database",
        },
      });
      if (!result.ok || result.value.value.kind !== "database") {
        throw new Error(result.ok ? "Expected Database" : result.error.message);
      }
      return result.value.value.value;
    };
    const candidateDatabaseDescriptor = async (targetDatabaseId: string) => {
      const result = await stage("Database read Database", candidate.databaseRead({
        target: { kind: "database", database_id: targetDatabaseId },
        mode: "database",
        filter: null,
        sort: null,
      }));
      if (result.value.kind !== "database") {
        throw new Error("Expected Rust Database");
      }
      return result.value.value;
    };
    const oracleViewRead = (targetViewId: string, mode: "view" | "query") => {
      const result = readDatabaseModuleV2(getDb(), {
        version: DATABASE_MODULE_V2_CONTRACT_VERSION,
        projectId: coordinates.projectId,
        read: {
          target: {
            kind: "view",
            viewId: parseDatabaseViewId(targetViewId),
          },
          mode,
        },
      });
      if (!result.ok) throw new Error(result.error.message);
      return result.value.value;
    };
    const candidateViewRead = async (targetViewId: string, mode: "view" | "query") => {
      const result = await stage(`Database read View ${mode}`, candidate.databaseRead({
        target: { kind: "view", view_id: targetViewId },
        mode,
        filter: null,
        sort: null,
      }));
      return result.value;
    };
    expect(withoutVolatileFields(await candidateDatabaseRead())).toEqual(
      withoutVolatileFields(oracleDatabaseRead()),
    );

    const propertyId = parseDataSourcePropertyId("p_GateCRsk");
    const deniedOperationId = "gate-c-database-denied-schema";
    const oracleDenied = applyDatabaseModuleV2(getDb(), {
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      operationId: deniedOperationId,
      projectId: coordinates.projectId,
      storeEpoch: coordinates.storeEpoch,
      actor: { kind: "differential-test" },
      operations: [{
        kind: "put_property",
        dataSourceId,
        propertyId,
        expectedDataSourceRevision: 1,
        expectedPropertyRevision: 0,
        name: "Denied",
        valueType: "select",
        config: {},
      }],
    });
    expect(oracleDenied).toMatchObject({
      ok: false,
      error: { code: "authorization_denied" },
    });
    await expect(candidate.databaseApply({
      operationId: deniedOperationId,
      intent: [{
        kind: "put_property",
        data_source_id: dataSourceId,
        property_id: propertyId,
        expected_data_source_revision: 1,
        expected_property_revision: 0,
        name: "Denied",
        value_type: "select",
        before_property_id: null,
      }],
    })).rejects.toMatchObject({
      name: CoreModuleResponseError.name,
      coreError: { code: "unauthorized" },
    });

    const primaryDataSourceId = parseDataSourceId(
      coordinates.primaryDataSourceId,
    );
    const propertyOperationId = "gate-c-database-put-property";
    const oracleProperty = applyDatabaseModuleV2(getDb(), {
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      operationId: propertyOperationId,
      projectId: coordinates.projectId,
      storeEpoch: coordinates.storeEpoch,
      actor: { kind: "differential-test" },
      operations: [{
        kind: "put_property",
        dataSourceId: primaryDataSourceId,
        propertyId,
        expectedDataSourceRevision: coordinates.primaryDataSourceRevision,
        expectedPropertyRevision: 0,
        name: "Risk",
        valueType: "select",
        config: {},
      }],
    }, { now: () => "2026-07-19T00:00:00.000Z" });
    const candidateProperty = await stage("Database put Property", candidate.databaseApply({
      operationId: propertyOperationId,
      intent: [{
        kind: "put_property",
        data_source_id: primaryDataSourceId,
        property_id: propertyId,
        expected_data_source_revision: coordinates.primaryDataSourceRevision,
        expected_property_revision: 0,
        name: "Risk",
        value_type: "select",
        before_property_id: null,
      }],
    }));
    if (!oracleProperty.ok) throw new Error(oracleProperty.error.message);
    expect(candidateProperty).toMatchObject({
      value: { operation_count: oracleProperty.value.operationKinds.length },
      receipt: {
        duplicate: oracleProperty.value.duplicate,
        affected_database_ids: oracleProperty.value.affectedDatabaseIds,
        affected_data_source_ids: oracleProperty.value.affectedDataSourceIds,
        affected_page_ids: oracleProperty.value.affectedPageIds,
        affected_view_ids: oracleProperty.value.affectedViewIds,
      },
    });
    expect(withoutVolatileFields(await candidateDatabaseRead(primaryDataSourceId))).toEqual(
      withoutVolatileFields(oracleDatabaseRead(primaryDataSourceId)),
    );

    const oracleReplay = applyDatabaseModuleV2(getDb(), {
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      operationId: propertyOperationId,
      projectId: coordinates.projectId,
      storeEpoch: coordinates.storeEpoch,
      actor: { kind: "differential-test" },
      operations: [{
        kind: "put_property",
        dataSourceId: primaryDataSourceId,
        propertyId,
        expectedDataSourceRevision: coordinates.primaryDataSourceRevision,
        expectedPropertyRevision: 0,
        name: "Risk",
        valueType: "select",
        config: {},
      }],
    });
    const candidateReplay = await stage("Database exact replay", candidate.databaseApply({
      operationId: propertyOperationId,
      intent: [{
        kind: "put_property",
        data_source_id: primaryDataSourceId,
        property_id: propertyId,
        expected_data_source_revision: coordinates.primaryDataSourceRevision,
        expected_property_revision: 0,
        name: "Risk",
        value_type: "select",
        before_property_id: null,
      }],
    }));
    expect(oracleReplay).toMatchObject({ ok: true, value: { duplicate: true } });
    expect(candidateReplay.receipt.duplicate).toBe(true);

    const oracleCollision = applyDatabaseModuleV2(getDb(), {
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      operationId: propertyOperationId,
      projectId: coordinates.projectId,
      storeEpoch: coordinates.storeEpoch,
      actor: { kind: "differential-test" },
      operations: [{
        kind: "put_property",
        dataSourceId: primaryDataSourceId,
        propertyId,
        expectedDataSourceRevision: coordinates.primaryDataSourceRevision,
        expectedPropertyRevision: 0,
        name: "Different",
        valueType: "select",
        config: {},
      }],
    });
    expect(oracleCollision).toMatchObject({
      ok: false,
      error: { code: "operation_id_collision" },
    });
    await expect(candidate.databaseApply({
      operationId: propertyOperationId,
      intent: [{
        kind: "put_property",
        data_source_id: primaryDataSourceId,
        property_id: propertyId,
        expected_data_source_revision: coordinates.primaryDataSourceRevision,
        expected_property_revision: 0,
        name: "Different",
        value_type: "select",
        before_property_id: null,
      }],
    })).rejects.toMatchObject({
      name: CoreModuleResponseError.name,
      coreError: { code: "idempotency_key_reused" },
    });

    const optionLowId = parseDataSourceOptionId({
      propertyId,
      value: "o_GateCLow",
    });
    const optionHighId = parseDataSourceOptionId({
      propertyId,
      value: "o_GateCHgh",
    });
    const propertyAfterCreate = oracleDatabaseRead(primaryDataSourceId)
      .properties.find((property) => property.propertyId === propertyId);
    if (!propertyAfterCreate) throw new Error("Gate C Risk Property is missing");
    const putLowOperationId = "gate-c-database-put-option-low";
    const oraclePutLow = applyDatabaseModuleV2(getDb(), {
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      operationId: putLowOperationId,
      projectId: coordinates.projectId,
      storeEpoch: coordinates.storeEpoch,
      actor: { kind: "differential-test" },
      operations: [{
        kind: "put_option",
        dataSourceId: primaryDataSourceId,
        propertyId,
        optionId: optionLowId,
        name: "Low",
        color: "green",
        expectedPropertyRevision: propertyAfterCreate.revision,
      }],
    }, { now: () => "2026-07-19T00:01:00.000Z" });
    const candidatePutLow = await stage("Database put Option Low", candidate.databaseApply({
      operationId: putLowOperationId,
      intent: [{
        kind: "put_option",
        data_source_id: primaryDataSourceId,
        property_id: propertyId,
        option_id: optionLowId,
        name: "Low",
        color: "green",
        expected_property_revision: propertyAfterCreate.revision,
      }],
    }));
    if (!oraclePutLow.ok) throw new Error(oraclePutLow.error.message);
    expect(candidatePutLow).toMatchObject({
      value: { operation_count: oraclePutLow.value.operationKinds.length },
      receipt: {
        duplicate: oraclePutLow.value.duplicate,
        affected_database_ids: oraclePutLow.value.affectedDatabaseIds,
        affected_data_source_ids: oraclePutLow.value.affectedDataSourceIds,
        affected_page_ids: oraclePutLow.value.affectedPageIds,
        affected_view_ids: oraclePutLow.value.affectedViewIds,
      },
    });
    expect(withoutVolatileFields(await candidateDatabaseRead(primaryDataSourceId))).toEqual(
      withoutVolatileFields(oracleDatabaseRead(primaryDataSourceId)),
    );

    const propertyAfterLow = oracleDatabaseRead(primaryDataSourceId)
      .properties.find((property) => property.propertyId === propertyId);
    if (!propertyAfterLow) throw new Error("Gate C Risk Property disappeared");
    const putHighOperationId = "gate-c-database-put-option-high";
    const oraclePutHigh = applyDatabaseModuleV2(getDb(), {
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      operationId: putHighOperationId,
      projectId: coordinates.projectId,
      storeEpoch: coordinates.storeEpoch,
      actor: { kind: "differential-test" },
      operations: [{
        kind: "put_option",
        dataSourceId: primaryDataSourceId,
        propertyId,
        optionId: optionHighId,
        name: "High",
        expectedPropertyRevision: propertyAfterLow.revision,
      }],
    }, { now: () => "2026-07-19T00:02:00.000Z" });
    const candidatePutHigh = await stage("Database put Option High", candidate.databaseApply({
      operationId: putHighOperationId,
      intent: [{
        kind: "put_option",
        data_source_id: primaryDataSourceId,
        property_id: propertyId,
        option_id: optionHighId,
        name: "High",
        color: null,
        expected_property_revision: propertyAfterLow.revision,
      }],
    }));
    if (!oraclePutHigh.ok) throw new Error(oraclePutHigh.error.message);
    expect(candidatePutHigh).toMatchObject({
      value: { operation_count: oraclePutHigh.value.operationKinds.length },
      receipt: {
        duplicate: oraclePutHigh.value.duplicate,
        affected_database_ids: oraclePutHigh.value.affectedDatabaseIds,
        affected_data_source_ids: oraclePutHigh.value.affectedDataSourceIds,
        affected_page_ids: oraclePutHigh.value.affectedPageIds,
        affected_view_ids: oraclePutHigh.value.affectedViewIds,
      },
    });
    expect(withoutVolatileFields(await candidateDatabaseRead(primaryDataSourceId))).toEqual(
      withoutVolatileFields(oracleDatabaseRead(primaryDataSourceId)),
    );

    const sourceRowBeforeRisk = oracleDataSourceQuery(primaryDataSourceId)
      .rows.find((row) => row.page.pageId === sourcePage.id);
    if (!sourceRowBeforeRisk) throw new Error("Gate C source Page is missing");
    const setRiskOperationId = "gate-c-database-set-risk";
    const expectedRiskRevision = sourceRowBeforeRisk.values[propertyId]?.revision ?? 0;
    const oracleSetRisk = applyDatabaseModuleV2(getDb(), {
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      operationId: setRiskOperationId,
      projectId: coordinates.projectId,
      storeEpoch: coordinates.storeEpoch,
      actor: { kind: "differential-test" },
      operations: [{
        kind: "set_value",
        pageId: sourcePage.id,
        dataSourceId: primaryDataSourceId,
        propertyId,
        expectedValueRevision: expectedRiskRevision,
        value: optionHighId,
      }],
    }, { now: () => "2026-07-19T00:03:00.000Z" });
    const candidateSetRisk = await stage("Database set Risk value", candidate.databaseApply({
      operationId: setRiskOperationId,
      intent: [{
        kind: "set_value",
        page_id: sourcePage.id,
        data_source_id: primaryDataSourceId,
        property_id: propertyId,
        expected_value_revision: expectedRiskRevision,
        value: optionHighId,
      }],
    }));
    if (!oracleSetRisk.ok) throw new Error(oracleSetRisk.error.message);
    expect(candidateSetRisk).toMatchObject({
      value: { operation_count: oracleSetRisk.value.operationKinds.length },
      receipt: {
        duplicate: oracleSetRisk.value.duplicate,
        affected_database_ids: oracleSetRisk.value.affectedDatabaseIds,
        affected_data_source_ids: oracleSetRisk.value.affectedDataSourceIds,
        affected_page_ids: oracleSetRisk.value.affectedPageIds,
        affected_view_ids: oracleSetRisk.value.affectedViewIds,
      },
    });
    expect(withoutVolatileFields(await candidateDataSourceQuery(primaryDataSourceId))).toEqual(
      withoutVolatileFields(oracleDataSourceQuery(primaryDataSourceId)),
    );

    const tagsPropertyId = parseDataSourcePropertyId("p_GateCTag");
    const tagOneId = parseDataSourceOptionId({
      propertyId: tagsPropertyId,
      value: "o_GateCOne",
    });
    const tagTwoId = parseDataSourceOptionId({
      propertyId: tagsPropertyId,
      value: "o_GateCTwo",
    });
    const sourceBeforeTags = oracleDatabaseRead(primaryDataSourceId).dataSource;
    const putTagsOperationId = "gate-c-database-put-tags-schema";
    const oraclePutTags = applyDatabaseModuleV2(getDb(), {
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      operationId: putTagsOperationId,
      projectId: coordinates.projectId,
      storeEpoch: coordinates.storeEpoch,
      actor: { kind: "differential-test" },
      operations: [
        {
          kind: "put_property",
          dataSourceId: primaryDataSourceId,
          propertyId: tagsPropertyId,
          expectedDataSourceRevision: sourceBeforeTags.schemaRevision,
          expectedPropertyRevision: 0,
          name: "Gate C tags",
          valueType: "multi_select",
          config: {},
        },
        {
          kind: "put_option",
          dataSourceId: primaryDataSourceId,
          propertyId: tagsPropertyId,
          optionId: tagOneId,
          name: "One",
          color: "blue",
          expectedPropertyRevision: 1,
        },
        {
          kind: "put_option",
          dataSourceId: primaryDataSourceId,
          propertyId: tagsPropertyId,
          optionId: tagTwoId,
          name: "Two",
          expectedPropertyRevision: 2,
        },
      ],
    }, { now: () => "2026-07-19T00:04:00.000Z" });
    const candidatePutTags = await stage("Database put multi-select schema", candidate.databaseApply({
      operationId: putTagsOperationId,
      intent: [
        {
          kind: "put_property",
          data_source_id: primaryDataSourceId,
          property_id: tagsPropertyId,
          expected_data_source_revision: sourceBeforeTags.schemaRevision,
          expected_property_revision: 0,
          name: "Gate C tags",
          value_type: "multi_select",
          before_property_id: null,
        },
        {
          kind: "put_option",
          data_source_id: primaryDataSourceId,
          property_id: tagsPropertyId,
          option_id: tagOneId,
          name: "One",
          color: "blue",
          expected_property_revision: 1,
        },
        {
          kind: "put_option",
          data_source_id: primaryDataSourceId,
          property_id: tagsPropertyId,
          option_id: tagTwoId,
          name: "Two",
          color: null,
          expected_property_revision: 2,
        },
      ],
    }));
    if (!oraclePutTags.ok) throw new Error(oraclePutTags.error.message);
    expect(candidatePutTags).toMatchObject({
      value: { operation_count: oraclePutTags.value.operationKinds.length },
      receipt: {
        duplicate: oraclePutTags.value.duplicate,
        affected_database_ids: oraclePutTags.value.affectedDatabaseIds,
        affected_data_source_ids: oraclePutTags.value.affectedDataSourceIds,
        affected_page_ids: oraclePutTags.value.affectedPageIds,
        affected_view_ids: oraclePutTags.value.affectedViewIds,
      },
    });
    expect(withoutVolatileFields(await candidateDatabaseRead(primaryDataSourceId))).toEqual(
      withoutVolatileFields(oracleDatabaseRead(primaryDataSourceId)),
    );

    const sourceRowBeforeBatch = oracleDataSourceQuery(primaryDataSourceId)
      .rows.find((row) => row.page.pageId === sourcePage.id);
    if (!sourceRowBeforeBatch) throw new Error("Gate C source Page is missing");
    const setValuesOperationId = "gate-c-database-set-values";
    const expectedRiskBatchRevision = sourceRowBeforeBatch.values[propertyId]?.revision ?? 0;
    const expectedTagsRevision = sourceRowBeforeBatch.values[tagsPropertyId]?.revision ?? 0;
    const oracleSetValues = applyDatabaseModuleV2(getDb(), {
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      operationId: setValuesOperationId,
      projectId: coordinates.projectId,
      storeEpoch: coordinates.storeEpoch,
      actor: { kind: "differential-test" },
      operations: [{
        kind: "set_values",
        values: [
          {
            pageId: sourcePage.id,
            dataSourceId: primaryDataSourceId,
            propertyId,
            expectedValueRevision: expectedRiskBatchRevision,
            value: optionLowId,
          },
          {
            pageId: sourcePage.id,
            dataSourceId: primaryDataSourceId,
            propertyId: tagsPropertyId,
            expectedValueRevision: expectedTagsRevision,
            value: [tagOneId],
          },
        ],
      }],
    }, { now: () => "2026-07-19T00:05:00.000Z" });
    const candidateSetValues = await stage("Database set value batch", candidate.databaseApply({
      operationId: setValuesOperationId,
      intent: [{
        kind: "set_values",
        values: [
          {
            page_id: sourcePage.id,
            data_source_id: primaryDataSourceId,
            property_id: propertyId,
            expected_value_revision: expectedRiskBatchRevision,
            value: optionLowId,
          },
          {
            page_id: sourcePage.id,
            data_source_id: primaryDataSourceId,
            property_id: tagsPropertyId,
            expected_value_revision: expectedTagsRevision,
            value: [tagOneId],
          },
        ],
      }],
    }));
    if (!oracleSetValues.ok) throw new Error(oracleSetValues.error.message);
    expect(candidateSetValues).toMatchObject({
      value: { operation_count: oracleSetValues.value.operationKinds.length },
      receipt: {
        duplicate: oracleSetValues.value.duplicate,
        affected_database_ids: oracleSetValues.value.affectedDatabaseIds,
        affected_data_source_ids: oracleSetValues.value.affectedDataSourceIds,
        affected_page_ids: oracleSetValues.value.affectedPageIds,
        affected_view_ids: oracleSetValues.value.affectedViewIds,
      },
    });
    expect(withoutVolatileFields(await candidateDataSourceQuery(primaryDataSourceId))).toEqual(
      withoutVolatileFields(oracleDataSourceQuery(primaryDataSourceId)),
    );

    const addRemoveOperationId = "gate-c-database-add-remove-value";
    const oracleAddRemove = applyDatabaseModuleV2(getDb(), {
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      operationId: addRemoveOperationId,
      projectId: coordinates.projectId,
      storeEpoch: coordinates.storeEpoch,
      actor: { kind: "differential-test" },
      operations: [{
        kind: "add_remove_value",
        pageId: sourcePage.id,
        dataSourceId: primaryDataSourceId,
        propertyId: tagsPropertyId,
        add: [tagTwoId],
        remove: [tagOneId],
      }],
    }, { now: () => "2026-07-19T00:06:00.000Z" });
    const candidateAddRemove = await stage("Database add/remove value", candidate.databaseApply({
      operationId: addRemoveOperationId,
      intent: [{
        kind: "add_remove_value",
        page_id: sourcePage.id,
        data_source_id: primaryDataSourceId,
        property_id: tagsPropertyId,
        add: [tagTwoId],
        remove: [tagOneId],
      }],
    }));
    if (!oracleAddRemove.ok) throw new Error(oracleAddRemove.error.message);
    expect(candidateAddRemove).toMatchObject({
      value: { operation_count: oracleAddRemove.value.operationKinds.length },
      receipt: {
        duplicate: oracleAddRemove.value.duplicate,
        affected_database_ids: oracleAddRemove.value.affectedDatabaseIds,
        affected_data_source_ids: oracleAddRemove.value.affectedDataSourceIds,
        affected_page_ids: oracleAddRemove.value.affectedPageIds,
        affected_view_ids: oracleAddRemove.value.affectedViewIds,
      },
    });
    expect(withoutVolatileFields(await candidateDataSourceQuery(primaryDataSourceId))).toEqual(
      withoutVolatileFields(oracleDataSourceQuery(primaryDataSourceId)),
    );

    const primaryDatabaseId = parseDatabaseId(coordinates.primaryDatabaseId);
    const baseDatabase = oracleDatabaseDescriptor(primaryDatabaseId);
    const baseView = baseDatabase.views.find((view) => view.isDefault)
      ?? baseDatabase.views[0];
    if (!baseView) throw new Error("Primary Database has no View template");
    const differentialViewId = parseDatabaseViewId(createUuidV7());
    const putViewOperationId = "gate-c-database-put-view";
    const oraclePutView = applyDatabaseModuleV2(getDb(), {
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      operationId: putViewOperationId,
      projectId: coordinates.projectId,
      storeEpoch: coordinates.storeEpoch,
      actor: { kind: "differential-test" },
      operations: [{
        kind: "put_view",
        databaseId: primaryDatabaseId,
        dataSourceId: primaryDataSourceId,
        viewId: differentialViewId,
        expectedRevision: 0,
        name: "Gate C list",
        viewKind: "list",
        config: baseView.config,
        isDefault: false,
      }],
    }, { now: () => "2026-07-19T00:07:00.000Z" });
    const candidatePutView = await stage("Database put View", candidate.databaseApply({
      operationId: putViewOperationId,
      intent: [{
        kind: "put_view",
        database_id: primaryDatabaseId,
        data_source_id: primaryDataSourceId,
        view_id: differentialViewId,
        expected_revision: 0,
        name: "Gate C list",
        view_kind: "list",
        config: baseView.config,
        is_default: false,
        before_view_id: null,
      }],
    }));
    if (!oraclePutView.ok) throw new Error(oraclePutView.error.message);
    expect(candidatePutView).toMatchObject({
      value: { operation_count: oraclePutView.value.operationKinds.length },
      receipt: {
        duplicate: oraclePutView.value.duplicate,
        affected_database_ids: oraclePutView.value.affectedDatabaseIds,
        affected_data_source_ids: oraclePutView.value.affectedDataSourceIds,
        affected_page_ids: oraclePutView.value.affectedPageIds,
        affected_view_ids: oraclePutView.value.affectedViewIds,
      },
    });
    expect(withoutVolatileFields(await candidateDatabaseDescriptor(primaryDatabaseId))).toEqual(
      withoutVolatileFields(oracleDatabaseDescriptor(primaryDatabaseId)),
    );
    expect(withoutVolatileFields(await candidateViewRead(differentialViewId, "view"))).toEqual(
      withoutVolatileFields(oracleViewRead(differentialViewId, "view")),
    );

    const updateViewOperationId = "gate-c-database-update-view";
    const oracleUpdateView = applyDatabaseModuleV2(getDb(), {
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      operationId: updateViewOperationId,
      projectId: coordinates.projectId,
      storeEpoch: coordinates.storeEpoch,
      actor: { kind: "differential-test" },
      operations: [{
        kind: "put_view",
        databaseId: primaryDatabaseId,
        dataSourceId: primaryDataSourceId,
        viewId: differentialViewId,
        expectedRevision: 1,
        name: "Gate C queue",
        viewKind: "list",
        config: baseView.config,
        isDefault: false,
      }],
    }, { now: () => "2026-07-19T00:08:00.000Z" });
    const candidateUpdateView = await stage("Database update View", candidate.databaseApply({
      operationId: updateViewOperationId,
      intent: [{
        kind: "put_view",
        database_id: primaryDatabaseId,
        data_source_id: primaryDataSourceId,
        view_id: differentialViewId,
        expected_revision: 1,
        name: "Gate C queue",
        view_kind: "list",
        config: baseView.config,
        is_default: false,
        before_view_id: null,
      }],
    }));
    if (!oracleUpdateView.ok) throw new Error(oracleUpdateView.error.message);
    expect(candidateUpdateView).toMatchObject({
      value: { operation_count: oracleUpdateView.value.operationKinds.length },
      receipt: {
        duplicate: oracleUpdateView.value.duplicate,
        affected_database_ids: oracleUpdateView.value.affectedDatabaseIds,
        affected_data_source_ids: oracleUpdateView.value.affectedDataSourceIds,
        affected_page_ids: oracleUpdateView.value.affectedPageIds,
        affected_view_ids: oracleUpdateView.value.affectedViewIds,
      },
    });
    expect(withoutVolatileFields(await candidateViewRead(differentialViewId, "view"))).toEqual(
      withoutVolatileFields(oracleViewRead(differentialViewId, "view")),
    );

    const initialViewQuery = oracleViewRead(differentialViewId, "query");
    if (initialViewQuery.kind !== "query") {
      throw new Error("Expected Gate C View query");
    }
    const movingRow = initialViewQuery.value.rows.find(
      (row) => row.page.pageId === anchorPage.id,
    );
    const anchorRow = initialViewQuery.value.rows.find(
      (row) => row.page.pageId === sourcePage.id,
    );
    if (!movingRow || !anchorRow) {
      throw new Error("Gate C View is missing imported rows");
    }
    const positionPageOperationId = "gate-c-database-position-page";
    const positionGroupKey = movingRow.position?.groupKey
      ?? movingRow.effectiveGroupKey;
    const oraclePositionPage = applyDatabaseModuleV2(getDb(), {
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      operationId: positionPageOperationId,
      projectId: coordinates.projectId,
      storeEpoch: coordinates.storeEpoch,
      actor: { kind: "differential-test" },
      operations: [{
        kind: "position_page",
        viewId: differentialViewId,
        pageId: anchorPage.id,
        expectedPositionRevision: movingRow.position?.revision ?? 0,
        groupKey: positionGroupKey,
        beforePageId: sourcePage.id,
      }],
    }, { now: () => "2026-07-19T00:09:00.000Z" });
    const candidatePositionPage = await stage("Database position Page", candidate.databaseApply({
      operationId: positionPageOperationId,
      intent: [{
        kind: "position_page",
        view_id: differentialViewId,
        page_id: anchorPage.id,
        expected_position_revision: movingRow.position?.revision ?? 0,
        group_key: positionGroupKey,
        before_page_id: sourcePage.id,
      }],
    }));
    if (!oraclePositionPage.ok) throw new Error(oraclePositionPage.error.message);
    expect(candidatePositionPage).toMatchObject({
      value: { operation_count: oraclePositionPage.value.operationKinds.length },
      receipt: {
        duplicate: oraclePositionPage.value.duplicate,
        affected_database_ids: oraclePositionPage.value.affectedDatabaseIds,
        affected_data_source_ids: oraclePositionPage.value.affectedDataSourceIds,
        affected_page_ids: oraclePositionPage.value.affectedPageIds,
        affected_view_ids: oraclePositionPage.value.affectedViewIds,
      },
    });
    expect(withoutVolatileFields(await candidateViewRead(differentialViewId, "query"))).toEqual(
      withoutVolatileFields(oracleViewRead(differentialViewId, "query")),
    );

    const positionedViewQuery = oracleViewRead(differentialViewId, "query");
    if (positionedViewQuery.kind !== "query") {
      throw new Error("Expected positioned Gate C View query");
    }
    const sourcePosition = positionedViewQuery.value.rows.find(
      (row) => row.page.pageId === sourcePage.id,
    )?.position;
    const anchorPosition = positionedViewQuery.value.rows.find(
      (row) => row.page.pageId === anchorPage.id,
    )?.position;
    if (!sourcePosition || !anchorPosition) {
      throw new Error("Gate C View positions are missing");
    }
    const positionPagesOperationId = "gate-c-database-position-pages";
    const oraclePositionPages = applyDatabaseModuleV2(getDb(), {
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      operationId: positionPagesOperationId,
      projectId: coordinates.projectId,
      storeEpoch: coordinates.storeEpoch,
      actor: { kind: "differential-test" },
      operations: [{
        kind: "position_pages",
        viewId: differentialViewId,
        pages: [
          {
            pageId: sourcePage.id,
            expectedPositionRevision: sourcePosition.revision,
          },
          {
            pageId: anchorPage.id,
            expectedPositionRevision: anchorPosition.revision,
          },
        ],
        groupKey: positionGroupKey,
      }],
    }, { now: () => "2026-07-19T00:10:00.000Z" });
    const candidatePositionPages = await stage("Database position Pages", candidate.databaseApply({
      operationId: positionPagesOperationId,
      intent: [{
        kind: "position_pages",
        view_id: differentialViewId,
        pages: [
          {
            page_id: sourcePage.id,
            expected_position_revision: sourcePosition.revision,
          },
          {
            page_id: anchorPage.id,
            expected_position_revision: anchorPosition.revision,
          },
        ],
        group_key: positionGroupKey,
        before_page_id: null,
      }],
    }));
    if (!oraclePositionPages.ok) throw new Error(oraclePositionPages.error.message);
    expect(candidatePositionPages).toMatchObject({
      value: { operation_count: oraclePositionPages.value.operationKinds.length },
      receipt: {
        duplicate: oraclePositionPages.value.duplicate,
        affected_database_ids: oraclePositionPages.value.affectedDatabaseIds,
        affected_data_source_ids: oraclePositionPages.value.affectedDataSourceIds,
        affected_page_ids: oraclePositionPages.value.affectedPageIds,
        affected_view_ids: oraclePositionPages.value.affectedViewIds,
      },
    });
    expect(withoutVolatileFields(await candidateViewRead(differentialViewId, "query"))).toEqual(
      withoutVolatileFields(oracleViewRead(differentialViewId, "query")),
    );

    const deleteViewOperationId = "gate-c-database-delete-view";
    const oracleDeleteView = applyDatabaseModuleV2(getDb(), {
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      operationId: deleteViewOperationId,
      projectId: coordinates.projectId,
      storeEpoch: coordinates.storeEpoch,
      actor: { kind: "differential-test" },
      operations: [{
        kind: "delete_view",
        databaseId: primaryDatabaseId,
        viewId: differentialViewId,
        expectedRevision: 2,
      }],
    }, { now: () => "2026-07-19T00:11:00.000Z" });
    const candidateDeleteView = await stage("Database delete View", candidate.databaseApply({
      operationId: deleteViewOperationId,
      intent: [{
        kind: "delete_view",
        database_id: primaryDatabaseId,
        view_id: differentialViewId,
        expected_revision: 2,
      }],
    }));
    if (!oracleDeleteView.ok) throw new Error(oracleDeleteView.error.message);
    expect(candidateDeleteView).toMatchObject({
      value: { operation_count: oracleDeleteView.value.operationKinds.length },
      receipt: {
        duplicate: oracleDeleteView.value.duplicate,
        affected_database_ids: oracleDeleteView.value.affectedDatabaseIds,
        affected_data_source_ids: oracleDeleteView.value.affectedDataSourceIds,
        affected_page_ids: oracleDeleteView.value.affectedPageIds,
        affected_view_ids: oracleDeleteView.value.affectedViewIds,
      },
    });
    expect(withoutVolatileFields(await candidateDatabaseDescriptor(primaryDatabaseId))).toEqual(
      withoutVolatileFields(oracleDatabaseDescriptor(primaryDatabaseId)),
    );

    const restoreViewOperationId = "gate-c-database-restore-view";
    const oracleRestoreView = applyDatabaseModuleV2(getDb(), {
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      operationId: restoreViewOperationId,
      projectId: coordinates.projectId,
      storeEpoch: coordinates.storeEpoch,
      actor: { kind: "differential-test" },
      operations: [{
        kind: "put_view",
        databaseId: primaryDatabaseId,
        dataSourceId: primaryDataSourceId,
        viewId: differentialViewId,
        expectedRevision: 3,
        name: "Gate C restored",
        viewKind: "list",
        config: baseView.config,
        isDefault: false,
      }],
    }, { now: () => "2026-07-19T00:12:00.000Z" });
    const candidateRestoreView = await stage("Database restore View", candidate.databaseApply({
      operationId: restoreViewOperationId,
      intent: [{
        kind: "put_view",
        database_id: primaryDatabaseId,
        data_source_id: primaryDataSourceId,
        view_id: differentialViewId,
        expected_revision: 3,
        name: "Gate C restored",
        view_kind: "list",
        config: baseView.config,
        is_default: false,
        before_view_id: null,
      }],
    }));
    if (!oracleRestoreView.ok) throw new Error(oracleRestoreView.error.message);
    expect(candidateRestoreView).toMatchObject({
      value: { operation_count: oracleRestoreView.value.operationKinds.length },
      receipt: {
        duplicate: oracleRestoreView.value.duplicate,
        affected_database_ids: oracleRestoreView.value.affectedDatabaseIds,
        affected_data_source_ids: oracleRestoreView.value.affectedDataSourceIds,
        affected_page_ids: oracleRestoreView.value.affectedPageIds,
        affected_view_ids: oracleRestoreView.value.affectedViewIds,
      },
    });
    expect(withoutVolatileFields(await candidateDatabaseDescriptor(primaryDatabaseId))).toEqual(
      withoutVolatileFields(oracleDatabaseDescriptor(primaryDatabaseId)),
    );

    const normalizedOraclePageDetail = (targetPageId: string) => {
      const result = readLibraryPageDetailInDatabase(
        getDb(),
        targetPageId,
        "app_window",
      );
      if (!result.ok) throw new Error(result.error.message);
      const context = result.value.dataSourceContext;
      return {
        version: result.value.version,
        library_id: result.value.libraryId,
        store_epoch: result.value.storeEpoch,
        change_log_seq: result.value.changeLogSeq,
        page: result.value.page,
        document: {
          readiness: result.value.document.readiness,
          schema_key: result.value.document.schemaKey,
          schema_version: result.value.document.schemaVersion,
        },
        intrinsic_properties: result.value.intrinsicProperties.map((property) => ({
          key: property.key,
          value_type: property.valueType,
          value: property.value,
          revision: property.revision,
        })),
        data_source_context: context.kind === "standalone"
          ? { kind: "standalone" as const }
          : {
              kind: "member" as const,
              membership: {
                membership_id: context.membership.membershipId,
                data_source_id: context.membership.dataSourceId,
                revision: context.membership.revision,
                created_at: context.membership.createdAt,
              },
              database: context.database,
              data_source: context.dataSource,
              properties: context.properties,
              values: context.values,
            },
        access_context: { kind: "library" as const },
      };
    };
    const candidatePageDetail = async (targetPageId: string) => {
      const result = await stage("Library read transferred Page detail", candidate.libraryRead({
        kind: "page_detail",
        page_id: targetPageId,
      }));
      if (result.value.kind !== "page_detail") {
        throw new Error("Expected Rust transferred Page detail");
      }
      return result.value.value;
    };
    const sourceDetailBeforeTransfer = normalizedOraclePageDetail(sourcePage.id);
    if (sourceDetailBeforeTransfer.data_source_context.kind !== "member") {
      throw new Error("Gate C source Page lost its primary membership");
    }
    const transferToSourceOperationId = "gate-c-database-transfer-source";
    const oracleTransferToSource = applyDatabaseModuleV2(getDb(), {
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      operationId: transferToSourceOperationId,
      projectId: coordinates.projectId,
      storeEpoch: coordinates.storeEpoch,
      actor: { kind: "differential-test" },
      operations: [{
        kind: "transfer_page",
        pageId: sourcePage.id,
        expectedParentRevision: sourceDetailBeforeTransfer.page.parentRevision,
        expectedActiveMembershipRevision:
          sourceDetailBeforeTransfer.data_source_context.membership.revision,
        target: { kind: "data_source", dataSourceId },
      }],
    }, { now: () => "2026-07-19T00:13:00.000Z" });
    const candidateTransferToSource = await stage(
      "Database transfer Page to Data Source",
      candidate.databaseApply({
        operationId: transferToSourceOperationId,
        intent: [{
          kind: "transfer_page",
          page_id: sourcePage.id,
          expected_parent_revision: sourceDetailBeforeTransfer.page.parentRevision,
          expected_active_membership_revision:
            sourceDetailBeforeTransfer.data_source_context.membership.revision,
          target: { kind: "data_source", data_source_id: dataSourceId },
        }],
      }),
    );
    if (!oracleTransferToSource.ok) {
      throw new Error(oracleTransferToSource.error.message);
    }
    expect(candidateTransferToSource).toMatchObject({
      value: { operation_count: oracleTransferToSource.value.operationKinds.length },
      receipt: {
        duplicate: oracleTransferToSource.value.duplicate,
        affected_database_ids: oracleTransferToSource.value.affectedDatabaseIds,
        affected_data_source_ids: oracleTransferToSource.value.affectedDataSourceIds,
        affected_page_ids: oracleTransferToSource.value.affectedPageIds,
        affected_view_ids: oracleTransferToSource.value.affectedViewIds,
      },
    });
    const candidateDetailAfterSource = await candidatePageDetail(sourcePage.id);
    if (candidateDetailAfterSource.data_source_context.kind !== "member") {
      throw new Error("Rust transferred Page has no target membership");
    }
    expect(candidateDetailAfterSource.data_source_context.membership.created_at).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u,
    );
    expect(withoutVolatileFields(candidateDetailAfterSource)).toEqual(
      withoutVolatileFields(normalizedOraclePageDetail(sourcePage.id)),
    );
    expect(withoutVolatileFields(await candidateDataSourceQuery(primaryDataSourceId))).toEqual(
      withoutVolatileFields(oracleDataSourceQuery(primaryDataSourceId)),
    );
    expect(withoutVolatileFields(await candidateDataSourceQuery(dataSourceId))).toEqual(
      withoutVolatileFields(oracleDataSourceQuery(dataSourceId)),
    );

    const sourceDetailBeforeLibrary = normalizedOraclePageDetail(sourcePage.id);
    if (sourceDetailBeforeLibrary.data_source_context.kind !== "member") {
      throw new Error("Gate C transferred Page has no target membership");
    }
    const transferToLibraryOperationId = "gate-c-database-transfer-library";
    const oracleTransferToLibrary = applyDatabaseModuleV2(getDb(), {
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      operationId: transferToLibraryOperationId,
      projectId: coordinates.projectId,
      storeEpoch: coordinates.storeEpoch,
      actor: { kind: "differential-test" },
      operations: [{
        kind: "transfer_page",
        pageId: sourcePage.id,
        expectedParentRevision: sourceDetailBeforeLibrary.page.parentRevision,
        expectedActiveMembershipRevision:
          sourceDetailBeforeLibrary.data_source_context.membership.revision,
        target: { kind: "library", libraryId: coordinates.libraryId },
      }],
    }, { now: () => "2026-07-19T00:14:00.000Z" });
    const candidateTransferToLibrary = await stage(
      "Database transfer Page to Library",
      candidate.databaseApply({
        operationId: transferToLibraryOperationId,
        intent: [{
          kind: "transfer_page",
          page_id: sourcePage.id,
          expected_parent_revision: sourceDetailBeforeLibrary.page.parentRevision,
          expected_active_membership_revision:
            sourceDetailBeforeLibrary.data_source_context.membership.revision,
          target: { kind: "library", library_id: coordinates.libraryId },
        }],
      }),
    );
    if (!oracleTransferToLibrary.ok) {
      throw new Error(oracleTransferToLibrary.error.message);
    }
    expect(candidateTransferToLibrary).toMatchObject({
      value: { operation_count: oracleTransferToLibrary.value.operationKinds.length },
      receipt: {
        duplicate: oracleTransferToLibrary.value.duplicate,
        affected_database_ids: oracleTransferToLibrary.value.affectedDatabaseIds,
        affected_data_source_ids: oracleTransferToLibrary.value.affectedDataSourceIds,
        affected_page_ids: oracleTransferToLibrary.value.affectedPageIds,
        affected_view_ids: oracleTransferToLibrary.value.affectedViewIds,
      },
    });
    expect(withoutVolatileFields(await candidatePageDetail(sourcePage.id))).toEqual(
      withoutVolatileFields(normalizedOraclePageDetail(sourcePage.id)),
    );
    expect(withoutVolatileFields(await candidateDataSourceQuery(dataSourceId))).toEqual(
      withoutVolatileFields(oracleDataSourceQuery(dataSourceId)),
    );

    const grantTransferredPageOperationId = "gate-c-library-grant-transferred-page";
    const oracleTransferredPageGrant = oracleLibraryApply(
      grantTransferredPageOperationId,
      {
        kind: "grant_project_access",
        projectId: coordinates.projectId,
        target: { kind: "page", pageId: sourcePage.id },
        access: "read_write",
      },
    );
    const candidateTransferredPageGrant = await stage(
      "Library grant transferred Page",
      candidate.libraryApply({
        operationId: grantTransferredPageOperationId,
        intent: {
          kind: "grant_project_access",
          project_id: coordinates.projectId,
          target: { kind: "page", page_id: sourcePage.id },
          access: "read_write",
        },
      }),
    );
    if (!oracleTransferredPageGrant.ok) {
      throw new Error(oracleTransferredPageGrant.error.message);
    }
    expect(candidateTransferredPageGrant.receipt).toMatchObject({
      duplicate: oracleTransferredPageGrant.value.duplicate,
      did_mutate: oracleTransferredPageGrant.value.didMutate,
      affected_page_ids: oracleTransferredPageGrant.value.affectedPageIds,
    });

    const sourceDetailBeforeReturn = normalizedOraclePageDetail(sourcePage.id);
    if (sourceDetailBeforeReturn.data_source_context.kind !== "standalone") {
      throw new Error("Gate C Library Page retained a Data Source membership");
    }
    const transferToPrimaryOperationId = "gate-c-database-transfer-primary";
    const oracleTransferToPrimary = applyDatabaseModuleV2(getDb(), {
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      operationId: transferToPrimaryOperationId,
      projectId: coordinates.projectId,
      storeEpoch: coordinates.storeEpoch,
      actor: { kind: "differential-test" },
      operations: [{
        kind: "transfer_page",
        pageId: sourcePage.id,
        expectedParentRevision: sourceDetailBeforeReturn.page.parentRevision,
        expectedActiveMembershipRevision: 0,
        target: { kind: "data_source", dataSourceId: primaryDataSourceId },
      }],
    }, { now: () => "2026-07-19T00:15:00.000Z" });
    const candidateTransferToPrimary = await stage(
      "Database transfer Page to primary Data Source",
      candidate.databaseApply({
        operationId: transferToPrimaryOperationId,
        intent: [{
          kind: "transfer_page",
          page_id: sourcePage.id,
          expected_parent_revision: sourceDetailBeforeReturn.page.parentRevision,
          expected_active_membership_revision: 0,
          target: {
            kind: "data_source",
            data_source_id: primaryDataSourceId,
          },
        }],
      }),
    );
    if (!oracleTransferToPrimary.ok) {
      throw new Error(oracleTransferToPrimary.error.message);
    }
    expect(candidateTransferToPrimary).toMatchObject({
      value: { operation_count: oracleTransferToPrimary.value.operationKinds.length },
      receipt: {
        duplicate: oracleTransferToPrimary.value.duplicate,
        affected_database_ids: oracleTransferToPrimary.value.affectedDatabaseIds,
        affected_data_source_ids: oracleTransferToPrimary.value.affectedDataSourceIds,
        affected_page_ids: oracleTransferToPrimary.value.affectedPageIds,
        affected_view_ids: oracleTransferToPrimary.value.affectedViewIds,
      },
    });
    expect(withoutVolatileFields(await candidatePageDetail(sourcePage.id))).toEqual(
      withoutVolatileFields(normalizedOraclePageDetail(sourcePage.id)),
    );
    expect(withoutVolatileFields(await candidateDataSourceQuery(primaryDataSourceId))).toEqual(
      withoutVolatileFields(oracleDataSourceQuery(primaryDataSourceId)),
    );

    const sourceAfterReturn = oracleDataSourceQuery(primaryDataSourceId);
    const returnedSourceRow = sourceAfterReturn.rows.find(
      (row) => row.page.pageId === sourcePage.id,
    );
    if (!returnedSourceRow) throw new Error("Returned Gate C Page is missing");
    expect(returnedSourceRow.values[tagsPropertyId]?.value).toEqual([tagTwoId]);
    const tagsBeforeDelete = sourceAfterReturn.properties.find(
      (property) => property.propertyId === tagsPropertyId,
    );
    if (!tagsBeforeDelete) throw new Error("Gate C tags Property is missing");
    const deleteInUseOperationId = "gate-c-database-delete-in-use-option";
    const oracleDeleteInUse = applyDatabaseModuleV2(getDb(), {
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      operationId: deleteInUseOperationId,
      projectId: coordinates.projectId,
      storeEpoch: coordinates.storeEpoch,
      actor: { kind: "differential-test" },
      operations: [{
        kind: "delete_option",
        dataSourceId: primaryDataSourceId,
        propertyId: tagsPropertyId,
        optionId: tagTwoId,
        expectedPropertyRevision: tagsBeforeDelete.revision,
      }],
    });
    expect(oracleDeleteInUse).toMatchObject({
      ok: false,
      error: { code: "unsupported_operation" },
    });
    await expect(candidate.databaseApply({
      operationId: deleteInUseOperationId,
      intent: [{
        kind: "delete_option",
        data_source_id: primaryDataSourceId,
        property_id: tagsPropertyId,
        option_id: tagTwoId,
        expected_property_revision: tagsBeforeDelete.revision,
      }],
    })).rejects.toMatchObject({
      name: CoreModuleResponseError.name,
      coreError: { code: "revision_conflict" },
    });

    const deleteUnusedOperationId = "gate-c-database-delete-unused-option";
    const oracleDeleteUnused = applyDatabaseModuleV2(getDb(), {
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      operationId: deleteUnusedOperationId,
      projectId: coordinates.projectId,
      storeEpoch: coordinates.storeEpoch,
      actor: { kind: "differential-test" },
      operations: [{
        kind: "delete_option",
        dataSourceId: primaryDataSourceId,
        propertyId: tagsPropertyId,
        optionId: tagOneId,
        expectedPropertyRevision: tagsBeforeDelete.revision,
      }],
    }, { now: () => "2026-07-19T00:16:00.000Z" });
    const candidateDeleteUnused = await stage(
      "Database delete unused Option",
      candidate.databaseApply({
        operationId: deleteUnusedOperationId,
        intent: [{
          kind: "delete_option",
          data_source_id: primaryDataSourceId,
          property_id: tagsPropertyId,
          option_id: tagOneId,
          expected_property_revision: tagsBeforeDelete.revision,
        }],
      }),
    );
    if (!oracleDeleteUnused.ok) throw new Error(oracleDeleteUnused.error.message);
    expect(candidateDeleteUnused).toMatchObject({
      value: { operation_count: oracleDeleteUnused.value.operationKinds.length },
      receipt: {
        duplicate: oracleDeleteUnused.value.duplicate,
        affected_database_ids: oracleDeleteUnused.value.affectedDatabaseIds,
        affected_data_source_ids: oracleDeleteUnused.value.affectedDataSourceIds,
        affected_page_ids: oracleDeleteUnused.value.affectedPageIds,
        affected_view_ids: oracleDeleteUnused.value.affectedViewIds,
      },
    });
    expect(withoutVolatileFields(await candidateDatabaseRead(primaryDataSourceId))).toEqual(
      withoutVolatileFields(oracleDatabaseRead(primaryDataSourceId)),
    );

    const riskBeforeDelete = oracleDatabaseRead(primaryDataSourceId)
      .properties.find((property) => property.propertyId === propertyId);
    if (!riskBeforeDelete) throw new Error("Gate C Risk Property is missing");
    const deleteHighOperationId = "gate-c-database-delete-high-option";
    const oracleDeleteHigh = applyDatabaseModuleV2(getDb(), {
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      operationId: deleteHighOperationId,
      projectId: coordinates.projectId,
      storeEpoch: coordinates.storeEpoch,
      actor: { kind: "differential-test" },
      operations: [{
        kind: "delete_option",
        dataSourceId: primaryDataSourceId,
        propertyId,
        optionId: optionHighId,
        expectedPropertyRevision: riskBeforeDelete.revision,
      }],
    }, { now: () => "2026-07-19T00:17:00.000Z" });
    const candidateDeleteHigh = await stage(
      "Database delete unused Risk Option",
      candidate.databaseApply({
        operationId: deleteHighOperationId,
        intent: [{
          kind: "delete_option",
          data_source_id: primaryDataSourceId,
          property_id: propertyId,
          option_id: optionHighId,
          expected_property_revision: riskBeforeDelete.revision,
        }],
      }),
    );
    if (!oracleDeleteHigh.ok) throw new Error(oracleDeleteHigh.error.message);
    expect(candidateDeleteHigh).toMatchObject({
      value: { operation_count: oracleDeleteHigh.value.operationKinds.length },
      receipt: {
        duplicate: oracleDeleteHigh.value.duplicate,
        affected_database_ids: oracleDeleteHigh.value.affectedDatabaseIds,
        affected_data_source_ids: oracleDeleteHigh.value.affectedDataSourceIds,
        affected_page_ids: oracleDeleteHigh.value.affectedPageIds,
        affected_view_ids: oracleDeleteHigh.value.affectedViewIds,
      },
    });

    const tagsBeforePropertyDelete = oracleDatabaseRead(primaryDataSourceId)
      .properties.find((property) => property.propertyId === tagsPropertyId);
    const sourceBeforePropertyDelete = oracleDatabaseRead(primaryDataSourceId).dataSource;
    if (!tagsBeforePropertyDelete) {
      throw new Error("Gate C tags Property disappeared before delete");
    }
    const deletePropertyOperationId = "gate-c-database-delete-property";
    const oracleDeleteProperty = applyDatabaseModuleV2(getDb(), {
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      operationId: deletePropertyOperationId,
      projectId: coordinates.projectId,
      storeEpoch: coordinates.storeEpoch,
      actor: { kind: "differential-test" },
      operations: [{
        kind: "delete_property",
        dataSourceId: primaryDataSourceId,
        propertyId: tagsPropertyId,
        expectedDataSourceRevision: sourceBeforePropertyDelete.schemaRevision,
        expectedPropertyRevision: tagsBeforePropertyDelete.revision,
      }],
    }, { now: () => "2026-07-19T00:18:00.000Z" });
    const candidateDeleteProperty = await stage(
      "Database delete Property",
      candidate.databaseApply({
        operationId: deletePropertyOperationId,
        intent: [{
          kind: "delete_property",
          data_source_id: primaryDataSourceId,
          property_id: tagsPropertyId,
          expected_data_source_revision: sourceBeforePropertyDelete.schemaRevision,
          expected_property_revision: tagsBeforePropertyDelete.revision,
        }],
      }),
    );
    if (!oracleDeleteProperty.ok) {
      throw new Error(oracleDeleteProperty.error.message);
    }
    expect(candidateDeleteProperty).toMatchObject({
      value: { operation_count: oracleDeleteProperty.value.operationKinds.length },
      receipt: {
        duplicate: oracleDeleteProperty.value.duplicate,
        affected_database_ids: oracleDeleteProperty.value.affectedDatabaseIds,
        affected_data_source_ids: oracleDeleteProperty.value.affectedDataSourceIds,
        affected_page_ids: oracleDeleteProperty.value.affectedPageIds,
        affected_view_ids: oracleDeleteProperty.value.affectedViewIds,
      },
    });
    expect(withoutVolatileFields(await candidateDatabaseRead(primaryDataSourceId))).toEqual(
      withoutVolatileFields(oracleDatabaseRead(primaryDataSourceId)),
    );
    expect(withoutVolatileFields(await candidateDataSourceQuery(primaryDataSourceId))).toEqual(
      withoutVolatileFields(oracleDataSourceQuery(primaryDataSourceId)),
    );

    const deletedTags = oracleDatabaseRead(primaryDataSourceId)
      .properties.find((property) => property.propertyId === tagsPropertyId);
    const sourceBeforeRestore = oracleDatabaseRead(primaryDataSourceId).dataSource;
    if (!deletedTags || deletedTags.lifecycle !== "deleted") {
      throw new Error("Gate C tags Property was not tombstoned");
    }
    const restorePropertyOperationId = "gate-c-database-restore-property";
    const oracleRestoreProperty = applyDatabaseModuleV2(getDb(), {
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      operationId: restorePropertyOperationId,
      projectId: coordinates.projectId,
      storeEpoch: coordinates.storeEpoch,
      actor: { kind: "differential-test" },
      operations: [{
        kind: "put_property",
        dataSourceId: primaryDataSourceId,
        propertyId: tagsPropertyId,
        expectedDataSourceRevision: sourceBeforeRestore.schemaRevision,
        expectedPropertyRevision: deletedTags.revision,
        name: "Gate C tags restored",
        valueType: "multi_select",
        config: {},
      }],
    }, { now: () => "2026-07-19T00:19:00.000Z" });
    const candidateRestoreProperty = await stage(
      "Database restore Property",
      candidate.databaseApply({
        operationId: restorePropertyOperationId,
        intent: [{
          kind: "put_property",
          data_source_id: primaryDataSourceId,
          property_id: tagsPropertyId,
          expected_data_source_revision: sourceBeforeRestore.schemaRevision,
          expected_property_revision: deletedTags.revision,
          name: "Gate C tags restored",
          value_type: "multi_select",
          before_property_id: null,
        }],
      }),
    );
    if (!oracleRestoreProperty.ok) {
      throw new Error(oracleRestoreProperty.error.message);
    }
    expect(candidateRestoreProperty).toMatchObject({
      value: { operation_count: oracleRestoreProperty.value.operationKinds.length },
      receipt: {
        duplicate: oracleRestoreProperty.value.duplicate,
        affected_database_ids: oracleRestoreProperty.value.affectedDatabaseIds,
        affected_data_source_ids: oracleRestoreProperty.value.affectedDataSourceIds,
        affected_page_ids: oracleRestoreProperty.value.affectedPageIds,
        affected_view_ids: oracleRestoreProperty.value.affectedViewIds,
      },
    });
    expect(withoutVolatileFields(await candidateDataSourceQuery(primaryDataSourceId))).toEqual(
      withoutVolatileFields(oracleDataSourceQuery(primaryDataSourceId)),
    );

    const restoredTags = oracleDatabaseRead(primaryDataSourceId)
      .properties.find((property) => property.propertyId === tagsPropertyId);
    if (!restoredTags) throw new Error("Gate C tags Property was not restored");
    const staleOptionOperationId = "gate-c-database-stale-option";
    const oracleStaleOption = applyDatabaseModuleV2(getDb(), {
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      operationId: staleOptionOperationId,
      projectId: coordinates.projectId,
      storeEpoch: coordinates.storeEpoch,
      actor: { kind: "differential-test" },
      operations: [{
        kind: "put_option",
        dataSourceId: primaryDataSourceId,
        propertyId: tagsPropertyId,
        optionId: tagOneId,
        name: "Stale",
        expectedPropertyRevision: restoredTags.revision - 1,
      }],
    });
    expect(oracleStaleOption).toMatchObject({
      ok: false,
      error: { code: "revision_conflict" },
    });
    await expect(candidate.databaseApply({
      operationId: staleOptionOperationId,
      intent: [{
        kind: "put_option",
        data_source_id: primaryDataSourceId,
        property_id: tagsPropertyId,
        option_id: tagOneId,
        name: "Stale",
        color: null,
        expected_property_revision: restoredTags.revision - 1,
      }],
    })).rejects.toMatchObject({
      name: CoreModuleResponseError.name,
      coreError: { code: "revision_conflict" },
    });

    const sourceBeforeRollback = oracleDatabaseRead(primaryDataSourceId).dataSource;
    const rollbackOperationId = "gate-c-database-atomic-rollback";
    const missingPropertyId = parseDataSourcePropertyId("p_AAAAAAAA");
    const oracleRollback = applyDatabaseModuleV2(getDb(), {
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      operationId: rollbackOperationId,
      projectId: coordinates.projectId,
      storeEpoch: coordinates.storeEpoch,
      actor: { kind: "differential-test" },
      operations: [
        {
          kind: "put_option",
          dataSourceId: primaryDataSourceId,
          propertyId: tagsPropertyId,
          optionId: tagOneId,
          name: "Must roll back",
          expectedPropertyRevision: restoredTags.revision,
        },
        {
          kind: "delete_property",
          dataSourceId: primaryDataSourceId,
          propertyId: missingPropertyId,
          expectedDataSourceRevision: sourceBeforeRollback.schemaRevision + 1,
          expectedPropertyRevision: 1,
        },
      ],
    });
    expect(oracleRollback).toMatchObject({
      ok: false,
      error: { code: "resource_not_found" },
    });
    await expect(candidate.databaseApply({
      operationId: rollbackOperationId,
      intent: [
        {
          kind: "put_option",
          data_source_id: primaryDataSourceId,
          property_id: tagsPropertyId,
          option_id: tagOneId,
          name: "Must roll back",
          color: null,
          expected_property_revision: restoredTags.revision,
        },
        {
          kind: "delete_property",
          data_source_id: primaryDataSourceId,
          property_id: missingPropertyId,
          expected_data_source_revision: sourceBeforeRollback.schemaRevision + 1,
          expected_property_revision: 1,
        },
      ],
    })).rejects.toMatchObject({
      name: CoreModuleResponseError.name,
      coreError: { code: "not_found" },
    });
    expect(withoutVolatileFields(await candidateDatabaseRead(primaryDataSourceId))).toEqual(
      withoutVolatileFields(oracleDatabaseRead(primaryDataSourceId)),
    );
    await expect(candidate.libraryRead({
      kind: "search",
      query: "Gate C",
      include_archived: true,
      source_kinds: ["document_title"],
      block_types: null,
      cursor: staleSearchCursor,
      limit: 100,
    })).rejects.toMatchObject({
      name: CoreModuleResponseError.name,
      coreError: { code: "revision_conflict" },
    });

    const sourceCopyEvidence = getDb().prepare(`
      SELECT block.location_revision AS locationRevision,
        page.parent_revision AS parentRevision,
        COALESCE((
          SELECT membership.revision
          FROM data_source_page_memberships membership
          WHERE membership.page_block_id = page.block_id
            AND membership.removed_at IS NULL
        ), 0) AS activeMembershipRevision,
        document.generation AS documentGeneration,
        document.head_seq AS documentHeadSeq
      FROM pages page
      INNER JOIN blocks block ON block.id = page.block_id AND block.type = 'page'
      INNER JOIN documents document ON document.id = page.document_id
      WHERE page.block_id = ?
    `).get(sourcePage.id) as {
      readonly locationRevision: number;
      readonly parentRevision: number;
      readonly activeMembershipRevision: number;
      readonly documentGeneration: number;
      readonly documentHeadSeq: number;
    } | undefined;
    if (!sourceCopyEvidence) throw new Error("Imported Page copy evidence is unavailable");

    const copyOperationId = "gate-c-library-copy-page";
    const copyInput = DuplicatePageV3InputSchema.parse({
      pageId: sourcePage.id,
      destination: { kind: "library" },
      return: ["block_map"],
    });
    const preparedOracleCopy = prepareNodexAgentDuplicatePage(getDb(), {
      threadId: "gate-c-library-copy-thread",
      callId: copyOperationId,
      projectId: coordinates.projectId,
      input: copyInput,
    });
    if (!preparedOracleCopy.ok || preparedOracleCopy.value.kind !== "prepared") {
      throw new Error(`TypeScript Page copy was not prepared: ${JSON.stringify(preparedOracleCopy)}`);
    }
    const oracleCopy = executeNodexAgentDuplicatePage(
      getDb(),
      preparedOracleCopy.value.command,
    );
    if (!oracleCopy.ok) throw new Error(oracleCopy.error.message);
    const oracleCopiedPageId = oracleCopy.value.output.data.pageId;
    const oracleBlockMap = oracleCopy.value.output.data.blockMap;
    if (!oracleBlockMap) throw new Error("TypeScript Page copy omitted its Block map");

    const candidateCopy = await stage("Library copy complete Page", candidate.libraryApply({
      operationId: copyOperationId,
      intent: {
        kind: "copy_page",
        source_page_id: sourcePage.id,
        expected_location_revision: sourceCopyEvidence.locationRevision,
        expected_parent_revision: sourceCopyEvidence.parentRevision,
        expected_active_membership_revision: sourceCopyEvidence.activeMembershipRevision,
        expected_document_generation: sourceCopyEvidence.documentGeneration,
        expected_document_head_seq: sourceCopyEvidence.documentHeadSeq,
        destination: { kind: "library", before: null },
      },
    }));
    const candidateCopyResult = candidateCopy.value.page_copy;
    if (!candidateCopyResult) throw new Error("Rust Page copy omitted its identity map");
    expect(candidateCopy.receipt).toMatchObject({
      duplicate: false,
      operation_kind: "copy_page",
      did_mutate: true,
      affected_page_ids: expect.arrayContaining([candidateCopyResult.page_id]),
    });
    expect(candidateCopyResult).toMatchObject({
      source_page_id: sourcePage.id,
      page_id: candidateCopyResult.block_ids[sourcePage.id],
    });
    expect(Object.keys(candidateCopyResult.block_ids).sort()).toEqual(
      Object.keys(oracleBlockMap).sort(),
    );

    const oracleCopiedContent = readOraclePageContent(getDb(), oracleCopiedPageId);
    const candidateCopiedContent = await stage(
      "Library copied Page content",
      candidate.libraryRead({
        kind: "page_content",
        page_id: candidateCopyResult.page_id,
      }),
    );
    if (candidateCopiedContent.value.kind !== "page_content") {
      throw new Error("Expected copied Rust Page content");
    }
    const comparableCopiedContent = ({
      schema_key,
      schema_version,
      title,
      rich_title,
      body_nfm,
      plain_text,
      preview,
      references,
      asset_refs,
      access_context,
    }: {
      readonly schema_key: string;
      readonly schema_version: number;
      readonly title: string;
      readonly rich_title: unknown;
      readonly body_nfm: string;
      readonly plain_text: string;
      readonly preview: string;
      readonly references: unknown;
      readonly asset_refs: unknown;
      readonly access_context: unknown;
    }) => ({
      schema_key,
      schema_version,
      title,
      rich_title,
      body_nfm,
      plain_text,
      preview,
      references,
      asset_refs,
      access_context,
    });
    expect(comparableCopiedContent(candidateCopiedContent.value.value)).toEqual(
      comparableCopiedContent(oracleCopiedContent),
    );

    const oracleCopiedPath = oracleLibraryRead({
      mode: "path",
      target: { kind: "page", pageId: oracleCopiedPageId },
    });
    const candidateCopiedPath = await stage(
      "Library copied Page path",
      candidate.libraryRead({
        kind: "path",
        target: { kind: "page", page_id: candidateCopyResult.page_id },
      }),
    );
    if (
      oracleCopiedPath.value.kind !== "path"
      || candidateCopiedPath.value.kind !== "path"
    ) {
      throw new Error("Expected copied Page paths from both Library authorities");
    }
    const oracleCopiedNode = oracleCopiedPath.value.nodes.at(-1);
    const candidateCopiedNode = candidateCopiedPath.value.nodes.at(-1);
    if (oracleCopiedNode?.kind !== "page" || candidateCopiedNode?.kind !== "page") {
      throw new Error("Expected copied Page path nodes");
    }
    expect(candidateCopiedPath.value.nodes.map((node) => node.kind)).toEqual(
      oracleCopiedPath.value.nodes.map((node) => node.kind),
    );
    expect(candidateCopiedNode).toMatchObject({
      kind: "page",
      title: oracleCopiedNode.title,
      has_children: oracleCopiedNode.hasChildren,
      parent_revision: oracleCopiedNode.parentRevision,
      metadata_revision: oracleCopiedNode.metadataRevision,
      document_generation: oracleCopiedNode.documentGeneration,
      document_head_seq: oracleCopiedNode.documentHeadSeq,
    });

    const replayedOracleCopy = prepareNodexAgentDuplicatePage(getDb(), {
      threadId: "gate-c-library-copy-thread",
      callId: copyOperationId,
      projectId: coordinates.projectId,
      input: copyInput,
    });
    if (!replayedOracleCopy.ok || replayedOracleCopy.value.kind !== "completed") {
      throw new Error("TypeScript Page copy did not replay its durable result");
    }
    const replayedCandidateCopy = await stage(
      "Library replay copied Page",
      candidate.libraryApply({
        operationId: copyOperationId,
        intent: {
          kind: "copy_page",
          source_page_id: sourcePage.id,
          expected_location_revision: sourceCopyEvidence.locationRevision,
          expected_parent_revision: sourceCopyEvidence.parentRevision,
          expected_active_membership_revision: sourceCopyEvidence.activeMembershipRevision,
          expected_document_generation: sourceCopyEvidence.documentGeneration,
          expected_document_head_seq: sourceCopyEvidence.documentHeadSeq,
          destination: { kind: "library", before: null },
        },
      }),
    );
    expect(replayedOracleCopy.value.output).toEqual(oracleCopy.value.output);
    expect(replayedCandidateCopy.receipt).toMatchObject({
      duplicate: true,
      did_mutate: true,
    });
    expect(replayedCandidateCopy.value.page_copy).toEqual(candidateCopyResult);

    const workspaceRoot = path.join(tmpdir(), "nodex-gate-c-workspace");
    const oracleCreatedProject = createProject({
      name: "Gate C workspace",
      description: "Atomic Project aggregate",
      icon: "🧭",
      sources: [workspaceRoot, workspaceRoot],
    });
    const candidateProjectId = createUuidV7();
    const createWorkspaceInput = {
      operationId: "gate-c-workspace-create-project",
      intent: {
        kind: "create_project" as const,
        project_id: candidateProjectId,
        name: "Gate C workspace",
        description: "Atomic Project aggregate",
        icon: "🧭",
        source_roots: [workspaceRoot, workspaceRoot],
      },
    };
    const candidateCreatedProject = await stage(
      "Project Workspace create Project",
      candidate.workspaceApply(createWorkspaceInput),
    );
    expect(candidateCreatedProject.receipt).toMatchObject({
      operation_id: createWorkspaceInput.operationId,
      duplicate: false,
      affected_project_ids: [candidateProjectId],
    });
    expect(candidateCreatedProject.value).toMatchObject({
      affected_project_ids: [candidateProjectId],
      affected_session_ids: [expect.any(String)],
      affected_thread_ids: [],
    });
    const replayedCandidateProject = await stage(
      "Project Workspace replay Project creation",
      candidate.workspaceApply(createWorkspaceInput),
    );
    expect(replayedCandidateProject.event_sequence).toBe(
      candidateCreatedProject.event_sequence,
    );
    expect(replayedCandidateProject.receipt.duplicate).toBe(true);

    const candidateProjectSnapshot = await stage(
      "Project Workspace created Project snapshot",
      candidate.workspaceRead({
        kind: "project",
        project_id: candidateProjectId,
      }),
    );
    if (candidateProjectSnapshot.value.kind !== "project") {
      throw new Error("Expected created Rust Project snapshot");
    }
    expect(withoutVolatileFields(candidateProjectSnapshot.value.project)).toEqual(
      withoutVolatileFields({
        id: candidateProjectId,
        library_id: oracleCreatedProject.libraryId,
        database_id: candidateProjectSnapshot.value.project.database_id,
        lifecycle: oracleCreatedProject.lifecycle,
        binding_revision: oracleCreatedProject.bindingRevision,
        name: oracleCreatedProject.name,
        description: oracleCreatedProject.description,
        icon: oracleCreatedProject.icon || null,
        sources: oracleCreatedProject.sources,
        primary_workspace_root: oracleCreatedProject.primaryWorkspaceRoot,
        pinned: oracleCreatedProject.pinned,
        pinned_order: oracleCreatedProject.pinnedOrder,
      }),
    );

    const threadId = "gate-c-thread-execution-context";
    const threadLinkedAt = "2026-07-19T06:00:00.000Z";
    upsertCodexThread({
      projectId: oracleCreatedProject.id,
      threadId,
      forkedFromId: "gate-c-thread-origin",
      threadSource: "appServer",
      serviceName: "codex",
      agentNickname: "@Nash",
      agentRole: "worker",
      threadName: "Gate C execution context",
      threadPreview: "Persisted Thread launch metadata",
      modelProvider: "openai",
      cwd: workspaceRoot,
      managedWorktreePath: path.join(workspaceRoot, ".worktrees", threadId),
      statusType: "active",
      statusActiveFlags: ["waitingOnApproval"],
      createdAt: 100,
      updatedAt: 200,
      linkedAt: threadLinkedAt,
    });
    replaceCodexThreadDynamicToolCatalogs(threadId, [
      { namespace: "zeta", toolsetRevision: 3 },
      { namespace: "nodex_app", toolsetRevision: 5 },
    ]);
    putCodexProjectPermissionModeSelection(
      oracleCreatedProject.id,
      "guardian-approvals",
      threadLinkedAt,
    );
    setCodexThreadPinned(threadId, true);
    setCodexThreadHasUnreadTurn(threadId, true);

    const candidateThreadInput = {
      operationId: "gate-c-workspace-upsert-thread",
      intent: {
        kind: "upsert_thread" as const,
        thread_id: threadId,
        patch: {
          project_id: candidateProjectId,
          forked_from_id: "gate-c-thread-origin",
          thread_source: "appServer",
          service_name: "codex",
          agent_nickname: "@Nash",
          agent_role: "worker",
          thread_name: "Gate C execution context",
          thread_preview: "Persisted Thread launch metadata",
          model_provider: "openai",
          cwd: workspaceRoot,
          managed_worktree_path: path.join(workspaceRoot, ".worktrees", threadId),
          status: {
            status_type: "active" as const,
            active_flags: ["waitingOnApproval" as const],
          },
          created_at: 100,
          updated_at: 200,
          linked_at: threadLinkedAt,
        },
      },
    };
    const candidateThreadCommit = await stage(
      "Project Workspace upsert Thread execution context",
      candidate.workspaceApply(candidateThreadInput),
    );
    const candidateThreadReplay = await stage(
      "Project Workspace replay Thread execution context",
      candidate.workspaceApply(candidateThreadInput),
    );
    expect(candidateThreadReplay.event_sequence).toBe(
      candidateThreadCommit.event_sequence,
    );
    expect(candidateThreadReplay.receipt.duplicate).toBe(true);
    await stage(
      "Project Workspace bind Thread dynamic tool catalogs",
      candidate.workspaceApply({
        operationId: "gate-c-workspace-thread-catalogs",
        intent: {
          kind: "replace_thread_dynamic_tool_catalogs",
          thread_id: threadId,
          catalogs: [
            { namespace: "zeta", toolset_revision: 3 },
            { namespace: "nodex_app", toolset_revision: 5 },
          ],
        },
      }),
    );
    await stage(
      "Project Workspace select Codex permission mode",
      candidate.workspaceApply({
        operationId: "gate-c-workspace-thread-permission",
        intent: {
          kind: "set_project_permission_mode",
          project_id: candidateProjectId,
          mode: "guardian-approvals",
        },
      }),
    );
    await stage(
      "Project Workspace pin Codex Thread",
      candidate.workspaceApply({
        operationId: "gate-c-workspace-thread-pin",
        intent: {
          kind: "set_thread_pinned",
          thread_id: threadId,
          pinned: true,
        },
      }),
    );
    await stage(
      "Project Workspace mark Codex Thread unread",
      candidate.workspaceApply({
        operationId: "gate-c-workspace-thread-unread",
        intent: {
          kind: "set_thread_unread",
          thread_id: threadId,
          unread: true,
        },
      }),
    );

    upsertCodexThread({
      threadId,
      serviceName: null,
      managedWorktreePath: null,
      threadPreview: "Persisted Thread launch metadata",
      modelProvider: "openai",
      statusType: "active",
      statusActiveFlags: ["waitingOnApproval"],
      updatedAt: 300,
    });
    await stage(
      "Project Workspace clear nullable Thread launch metadata",
      candidate.workspaceApply({
        operationId: "gate-c-workspace-thread-clear-launch-metadata",
        intent: {
          kind: "upsert_thread",
          thread_id: threadId,
          patch: {
            service_name: null,
            managed_worktree_path: null,
            thread_preview: "Persisted Thread launch metadata",
            model_provider: "openai",
            status: {
              status_type: "active",
              active_flags: ["waitingOnApproval"],
            },
            updated_at: 300,
          },
        },
      }),
    );

    const oracleThreadContext = getCodexThread(threadId);
    const candidateThreadContext = await stage(
      "Project Workspace read Thread execution context",
      candidate.workspaceRead({ kind: "execution_context", thread_id: threadId }),
    );
    if (!oracleThreadContext || candidateThreadContext.value.kind !== "execution_context") {
      throw new Error("Expected Thread execution contexts from both authorities");
    }
    const candidateContext = candidateThreadContext.value.context;
    expect(candidateContext.permission_mode).toBe(
      getCodexProjectPermissionModeSelection(oracleCreatedProject.id),
    );
    expect(candidateContext.project).toMatchObject({
      id: candidateProjectId,
      name: oracleCreatedProject.name,
      database_id: expect.any(String),
    });
    expect(candidateContext.thread).toEqual({
      thread_id: oracleThreadContext.threadId,
      project_id: candidateProjectId,
      session_id: null,
      forked_from_id: oracleThreadContext.forkedFromId ?? null,
      parent_thread_id: oracleThreadContext.source?.parentThreadId ?? null,
      thread_name: oracleThreadContext.threadName ?? null,
      thread_source: oracleThreadContext.threadSource ?? null,
      service_name: oracleThreadContext.serviceName ?? null,
      agent_nickname: oracleThreadContext.agentNickname ?? null,
      agent_role: oracleThreadContext.agentRole ?? null,
      thread_preview: oracleThreadContext.threadPreview,
      model_provider: oracleThreadContext.modelProvider,
      cwd: oracleThreadContext.cwd ?? null,
      managed_worktree_path: oracleThreadContext.managedWorktreePath ?? null,
      projectless_output_directory:
        oracleThreadContext.projectlessOutputDirectory ?? null,
      projectless_workspace_browser_root:
        oracleThreadContext.projectlessWorkspaceBrowserRoot ?? null,
      status: {
        status_type: oracleThreadContext.statusType,
        active_flags: oracleThreadContext.statusActiveFlags,
      },
      archived: oracleThreadContext.archived,
      pinned_order: expect.any(Number),
      has_unread_turn: oracleThreadContext.hasUnreadTurn,
      dynamic_tool_catalogs: withSnakeCaseKeys(
        getCodexThreadDynamicToolCatalogs(threadId),
      ),
      writable_roots: [],
      created_at: oracleThreadContext.createdAt,
      updated_at: oracleThreadContext.updatedAt,
      linked_at: oracleThreadContext.linkedAt,
    });

    replaceCodexThreadWritableRoots(threadId, [
      "relative",
      " /workspace/ignored ",
      path.join(workspaceRoot, "writable-a"),
      path.join(workspaceRoot, "writable-a"),
    ]);
    await stage(
      "Project Workspace replace Thread writable roots",
      candidate.workspaceApply({
        operationId: "gate-c-workspace-thread-writable-roots-replace",
        intent: {
          kind: "replace_thread_writable_roots",
          thread_id: threadId,
          roots: [
            "relative",
            " /workspace/ignored ",
            path.join(workspaceRoot, "writable-a"),
            path.join(workspaceRoot, "writable-a"),
          ],
        },
      }),
    );
    mergeCodexThreadWritableRoots(threadId, [
      path.join(workspaceRoot, "writable-b"),
      path.join(workspaceRoot, "writable-a"),
    ]);
    await stage(
      "Project Workspace merge Thread writable roots",
      candidate.workspaceApply({
        operationId: "gate-c-workspace-thread-writable-roots-merge",
        intent: {
          kind: "merge_thread_writable_roots",
          thread_id: threadId,
          roots: [
            path.join(workspaceRoot, "writable-b"),
            path.join(workspaceRoot, "writable-a"),
          ],
        },
      }),
    );
    const candidateThreadWithRoots = await stage(
      "Project Workspace read Thread writable roots",
      candidate.workspaceRead({ kind: "thread", thread_id: threadId }),
    );
    if (candidateThreadWithRoots.value.kind !== "thread") {
      throw new Error("Expected Thread writable roots");
    }
    expect(candidateThreadWithRoots.value.thread.writable_roots).toEqual(
      getCodexThreadWritableRoots(threadId),
    );

    const initialBackgroundProcess = {
      id: `${threadId}:item-1`,
      threadId,
      threadTitle: "Gate C background execution",
      itemId: "item-1",
      turnId: "turn-background",
      command: "pnpm test",
      cwd: workspaceRoot,
      processId: "process-1",
      osPid: 42,
      terminalSessionId: "terminal-1",
      source: "app-server" as const,
      startedAtMs: 10,
      updatedAtMs: 20,
    };
    const initialCandidateBackgroundProcess = {
      id: initialBackgroundProcess.id,
      thread_id: initialBackgroundProcess.threadId,
      thread_title: initialBackgroundProcess.threadTitle,
      item_id: initialBackgroundProcess.itemId,
      turn_id: initialBackgroundProcess.turnId,
      command: initialBackgroundProcess.command,
      cwd: initialBackgroundProcess.cwd,
      process_id: initialBackgroundProcess.processId,
      os_pid: initialBackgroundProcess.osPid,
      terminal_session_id: initialBackgroundProcess.terminalSessionId,
      source: initialBackgroundProcess.source,
      started_at_ms: initialBackgroundProcess.startedAtMs,
      updated_at_ms: initialBackgroundProcess.updatedAtMs,
    };
    upsertCodexBackgroundProcess(initialBackgroundProcess);
    await stage(
      "Project Workspace record background process",
      candidate.workspaceApply({
        operationId: "gate-c-workspace-background-process-create",
        intent: {
          kind: "upsert_background_process",
          process: initialCandidateBackgroundProcess,
          preserve_started_at: true,
        },
      }),
    );
    const updatedBackgroundProcess = {
      ...initialBackgroundProcess,
      threadTitle: null,
      turnId: null,
      command: "pnpm test:all",
      cwd: null,
      processId: null,
      osPid: null,
      terminalSessionId: null,
      startedAtMs: 99,
      updatedAtMs: 30,
    };
    const updatedCandidateBackgroundProcess = {
      ...initialCandidateBackgroundProcess,
      thread_title: null,
      turn_id: null,
      command: updatedBackgroundProcess.command,
      cwd: null,
      process_id: null,
      os_pid: null,
      terminal_session_id: null,
      started_at_ms: updatedBackgroundProcess.startedAtMs,
      updated_at_ms: updatedBackgroundProcess.updatedAtMs,
    };
    upsertCodexBackgroundProcess(updatedBackgroundProcess);
    await stage(
      "Project Workspace update background process",
      candidate.workspaceApply({
        operationId: "gate-c-workspace-background-process-update",
        intent: {
          kind: "upsert_background_process",
          process: updatedCandidateBackgroundProcess,
          preserve_started_at: true,
        },
      }),
    );
    const candidateBackgroundProcesses = await stage(
      "Project Workspace read background processes",
      candidate.workspaceRead({
        kind: "background_processes",
        thread_id: threadId,
      }),
    );
    if (candidateBackgroundProcesses.value.kind !== "background_processes") {
      throw new Error("Expected background process records");
    }
    expect(candidateBackgroundProcesses.value.processes).toEqual(
      withSnakeCaseKeys(listCodexBackgroundProcesses(threadId)),
    );

    const authorityThreadId = "gate-c-thread-turn-authority";
    upsertCodexThread({
      projectId: coordinates.projectId,
      threadId: authorityThreadId,
      threadName: "Gate C Turn authority",
      threadPreview: "",
      modelProvider: "openai",
      createdAt: 300,
      updatedAt: 300,
      linkedAt: threadLinkedAt,
    });
    await stage(
      "Project Workspace create Turn authority Thread",
      candidate.workspaceApply({
        operationId: "gate-c-workspace-authority-thread-create",
        intent: {
          kind: "upsert_thread",
          thread_id: authorityThreadId,
          patch: {
            project_id: coordinates.projectId,
            thread_name: "Gate C Turn authority",
            thread_preview: "",
            model_provider: "openai",
            created_at: 300,
            updated_at: 300,
            linked_at: threadLinkedAt,
          },
        },
      }),
    );
    putCodexProjectPermissionModeSelection(
      coordinates.projectId,
      "full-access",
      threadLinkedAt,
    );
    await stage(
      "Project Workspace select authority full access",
      candidate.workspaceApply({
        operationId: "gate-c-workspace-authority-full-access",
        intent: {
          kind: "set_project_permission_mode",
          project_id: coordinates.projectId,
          mode: "full-access",
        },
      }),
    );
    const authorityRegistry = new CodexNodexAgentAuthorityRegistry();
    const authorityLaunch = authorityRegistry.beginTurn({
      threadId: authorityThreadId,
      rootThreadId: authorityThreadId,
      actorProjectId: coordinates.projectId,
      builtinFullAccess: true,
    });
    const oracleTurnAuthority = authorityRegistry.bindTurn(
      authorityLaunch,
      "turn-builtin",
    );
    if (!oracleTurnAuthority) {
      throw new Error("Expected TypeScript frozen Turn authority");
    }
    await stage(
      "Project Workspace freeze Turn authority",
      candidate.workspaceApply({
        operationId: "gate-c-workspace-freeze-turn-authority",
        intent: {
          kind: "freeze_turn_authority",
          thread_id: authorityThreadId,
          turn_id: "turn-builtin",
          root_thread_id: authorityThreadId,
          actor_project_id: coordinates.projectId,
          source: "builtin_full_access",
          inherited_from: null,
        },
      }),
    );
    const candidateTurnAuthority = await stage(
      "Project Workspace read Turn authority",
      candidate.workspaceRead({
        kind: "turn_authority",
        thread_id: authorityThreadId,
        turn_id: "turn-builtin",
        root_thread_id: authorityThreadId,
        actor_project_id: coordinates.projectId,
      }),
    );
    if (candidateTurnAuthority.value.kind !== "turn_authority") {
      throw new Error("Expected frozen Turn authority");
    }
    expect(candidateTurnAuthority.value.resolution).toEqual({
      authority: withSnakeCaseKeys(oracleTurnAuthority),
      persisted: true,
    });
    const oracleFallbackAuthority = authorityRegistry.capture({
      threadId: authorityThreadId,
      turnId: "turn-unrecorded",
      rootThreadId: authorityThreadId,
      actorProjectId: coordinates.projectId,
    });
    const candidateFallbackAuthority = await stage(
      "Project Workspace read unrecorded Turn authority",
      candidate.workspaceRead({
        kind: "turn_authority",
        thread_id: authorityThreadId,
        turn_id: "turn-unrecorded",
        root_thread_id: authorityThreadId,
        actor_project_id: coordinates.projectId,
      }),
    );
    if (
      !oracleFallbackAuthority
      || candidateFallbackAuthority.value.kind !== "turn_authority"
    ) {
      throw new Error("Expected Project-scoped Turn authority fallback");
    }
    expect(candidateFallbackAuthority.value.resolution).toEqual({
      authority: withSnakeCaseKeys(oracleFallbackAuthority),
      persisted: false,
    });

    const oracleCreatedSessions = listProjectSessionSummaries(
      oracleCreatedProject.id,
    );
    const candidateCreatedSessions = await stage(
      "Project Workspace created Session snapshot",
      candidate.workspaceRead({
        kind: "sessions",
        project_id: candidateProjectId,
        include_archived: false,
      }),
    );
    if (candidateCreatedSessions.value.kind !== "sessions") {
      throw new Error("Expected created Rust Session summaries");
    }
    expect(oracleCreatedSessions).toHaveLength(1);
    expect(candidateCreatedSessions.value.sessions).toHaveLength(1);
    expect(candidateCreatedSessions.value.sessions[0]).toMatchObject({
      display_title: oracleCreatedSessions[0]?.displayTitle,
      order: oracleCreatedSessions[0]?.order,
      pinned: oracleCreatedSessions[0]?.pinned,
      archived: oracleCreatedSessions[0]?.archived,
      unread: oracleCreatedSessions[0]?.unread,
      thread_id: null,
    });
    const oracleCreatedSession = getProjectSession(
      oracleCreatedSessions[0]?.id ?? "",
    );
    const candidateCreatedSession = await stage(
      "Project Workspace created Session detail",
      candidate.workspaceRead({
        kind: "session",
        session_id: candidateCreatedSessions.value.sessions[0]?.id ?? "",
      }),
    );
    if (!oracleCreatedSession || candidateCreatedSession.value.kind !== "session") {
      throw new Error("Expected created Session details from both authorities");
    }
    const normalizePanelTabs = (value: unknown): unknown => {
      if (Array.isArray(value)) {
        return value.map(() => "tab");
      }
      if (value === null || typeof value !== "object") {
        return typeof value === "string" && value.length > 20 ? "tab" : value;
      }
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [
          key,
          ["tabIds", "mruTabIds"].includes(key)
            ? Array.isArray(entry) ? entry.map(() => "tab") : entry
            : key === "activeTabId" && entry !== null
              ? "tab"
              : normalizePanelTabs(entry),
        ]),
      );
    };
    expect(normalizePanelTabs(candidateCreatedSession.value.panels)).toEqual(
      normalizePanelTabs(oracleCreatedSession.panels),
    );

    const oracleMutatedSession = updateProjectSession(oracleCreatedSession.id, {
      noThreadFallbackTitle: "Gate C renamed Session",
    });
    if (!oracleMutatedSession) throw new Error("TypeScript Session update disappeared");
    setProjectSessionPinned(oracleCreatedSession.id, { pinned: false });
    markProjectSessionUnread(oracleCreatedSession.id, { unread: true });
    const candidateRenameSessionInput = {
      operationId: "gate-c-workspace-rename-session",
      intent: {
        kind: "mutate_session" as const,
        session_id: candidateCreatedSession.value.session.id,
        intent: {
          kind: "rename" as const,
          title: "Gate C renamed Session",
        },
      },
    };
    const candidateRenamedSession = await stage(
      "Project Workspace rename Session",
      candidate.workspaceApply(candidateRenameSessionInput),
    );
    expect(candidateRenamedSession.value).toMatchObject({
      affected_project_ids: [candidateProjectId],
      affected_session_ids: [candidateCreatedSession.value.session.id],
      affected_thread_ids: [],
    });
    const candidateRenamedSessionReplay = await stage(
      "Project Workspace replay Session rename",
      candidate.workspaceApply(candidateRenameSessionInput),
    );
    expect(candidateRenamedSessionReplay.event_sequence).toBe(
      candidateRenamedSession.event_sequence,
    );
    expect(candidateRenamedSessionReplay.receipt.duplicate).toBe(true);
    await stage(
      "Project Workspace unpin Session",
      candidate.workspaceApply({
        operationId: "gate-c-workspace-unpin-session",
        intent: {
          kind: "mutate_session",
          session_id: candidateCreatedSession.value.session.id,
          intent: { kind: "set_pinned", pinned: false },
        },
      }),
    );
    await stage(
      "Project Workspace mark Session unread",
      candidate.workspaceApply({
        operationId: "gate-c-workspace-unread-session",
        intent: {
          kind: "mutate_session",
          session_id: candidateCreatedSession.value.session.id,
          intent: { kind: "set_unread", unread: true },
        },
      }),
    );
    const oracleMutatedSessionSummary = listProjectSessionSummaries(
      oracleCreatedProject.id,
    )[0];
    const candidateMutatedSession = await stage(
      "Project Workspace mutated Session snapshot",
      candidate.workspaceRead({
        kind: "session",
        session_id: candidateCreatedSession.value.session.id,
      }),
    );
    if (!oracleMutatedSessionSummary || candidateMutatedSession.value.kind !== "session") {
      throw new Error("Expected mutated Session snapshots from both authorities");
    }
    expect(candidateMutatedSession.value.session).toMatchObject({
      display_title: oracleMutatedSessionSummary.displayTitle,
      order: oracleMutatedSessionSummary.order,
      pinned: oracleMutatedSessionSummary.pinned,
      archived: oracleMutatedSessionSummary.archived,
      unread: oracleMutatedSessionSummary.unread,
      thread_id: null,
    });

    const oraclePanelSession = getProjectSession(oracleCreatedSession.id);
    if (!oraclePanelSession) throw new Error("TypeScript panel Session disappeared");
    const oracleDatabaseTab = oraclePanelSession.tabs.find((tab) => tab.kind === "db_view");
    const candidateDatabaseTab = candidateMutatedSession.value.tabs.find(
      (tab) => tab.kind === "db_view",
    );
    if (!oracleDatabaseTab || !candidateDatabaseTab) {
      throw new Error("Default Database View tab disappeared");
    }
    const oracleSplitSession = updateProjectSession(oraclePanelSession.id, {
      panels: {
        right: {
          layout: {
            version: 2,
            root: {
              type: "split",
              id: "gate-c-branch",
              direction: "horizontal",
              ratio: 0.5,
              first: {
                type: "leaf",
                id: "main",
                tabIds: [oracleDatabaseTab.id],
                activeTabId: oracleDatabaseTab.id,
                mruTabIds: [oracleDatabaseTab.id],
              },
              second: {
                type: "leaf",
                id: "gate-c-target",
                tabIds: [],
                activeTabId: null,
                mruTabIds: [],
              },
            },
            activeLeafId: "gate-c-target",
            mruLeafIds: ["gate-c-target", "main"],
            maximizedLeafId: null,
          },
        },
      },
    });
    if (!oracleSplitSession) throw new Error("TypeScript split layout disappeared");
    await stage(
      "Project Workspace replace panel layout",
      candidate.workspaceApply({
        operationId: "gate-c-workspace-split-layout",
        intent: {
          kind: "mutate_session",
          session_id: candidateCreatedSession.value.session.id,
          intent: {
            kind: "replace_panel_layout",
            panel_id: "right",
            layout: {
              version: 2,
              root: {
                type: "split",
                id: "gate-c-branch",
                direction: "horizontal",
                ratio: 0.5,
                first: {
                  type: "leaf",
                  id: "main",
                  tabIds: [candidateDatabaseTab.id],
                  activeTabId: candidateDatabaseTab.id,
                  mruTabIds: [candidateDatabaseTab.id],
                },
                second: {
                  type: "leaf",
                  id: "gate-c-target",
                  tabIds: [],
                  activeTabId: null,
                  mruTabIds: [],
                },
              },
              activeLeafId: "gate-c-target",
              mruLeafIds: ["gate-c-target", "main"],
              maximizedLeafId: null,
            },
          },
        },
      }),
    );
    createProjectSessionTab({
      sessionId: oraclePanelSession.id,
      projectId: oracleCreatedProject.id,
      panelId: "right",
      targetLeafId: "gate-c-target",
      clientTabId: "gate-c-terminal-tab",
      kind: "terminal",
      title: "Gate C terminal",
      config: {
        projectId: oracleCreatedProject.id,
        terminalSessionId: "gate-c-terminal-session",
      },
    });
    await stage(
      "Project Workspace create terminal tab",
      candidate.workspaceApply({
        operationId: "gate-c-workspace-create-terminal-tab",
        intent: {
          kind: "mutate_session",
          session_id: candidateCreatedSession.value.session.id,
          intent: {
            kind: "create_tab",
            tab_id: "gate-c-terminal-tab",
            panel_id: "right",
            target_leaf_id: "gate-c-target",
            browser_tab_id: null,
            tab_kind: "terminal",
            title: "Gate C terminal",
            config: {
              projectId: candidateProjectId,
              terminalSessionId: "gate-c-terminal-session",
            },
          },
        },
      }),
    );
    createProjectSessionTab({
      sessionId: oraclePanelSession.id,
      projectId: oracleCreatedProject.id,
      panelId: "right",
      targetLeafId: "gate-c-target",
      clientTabId: "gate-c-browser-tab",
      browserTabId: "gate-c-browser-identity",
      kind: "browser",
      title: "Gate C browser",
      config: {
        projectId: oracleCreatedProject.id,
        url: "https://example.test/gate-c",
      },
    });
    const candidateBrowserCreateInput = {
      operationId: "gate-c-workspace-create-browser-tab",
      intent: {
        kind: "mutate_session" as const,
        session_id: candidateCreatedSession.value.session.id,
        intent: {
          kind: "create_tab" as const,
          tab_id: "gate-c-browser-tab",
          panel_id: "right" as const,
          target_leaf_id: "gate-c-target",
          browser_tab_id: "gate-c-browser-identity",
          tab_kind: "browser" as const,
          title: "Gate C browser",
          config: {
            projectId: candidateProjectId,
            url: "https://example.test/gate-c",
          },
        },
      },
    };
    const candidateBrowserCreate = await stage(
      "Project Workspace create browser tab",
      candidate.workspaceApply(candidateBrowserCreateInput),
    );
    const candidateBrowserReplay = await stage(
      "Project Workspace replay browser tab creation",
      candidate.workspaceApply(candidateBrowserCreateInput),
    );
    expect(candidateBrowserReplay.event_sequence).toBe(
      candidateBrowserCreate.event_sequence,
    );
    expect(candidateBrowserReplay.receipt.duplicate).toBe(true);
    moveProjectSessionTab({
      tabId: "gate-c-terminal-tab",
      targetPanelId: "bottom",
    });
    await stage(
      "Project Workspace move terminal tab",
      candidate.workspaceApply({
        operationId: "gate-c-workspace-move-terminal-tab",
        intent: {
          kind: "mutate_session",
          session_id: candidateCreatedSession.value.session.id,
          intent: {
            kind: "move_tab",
            tab_id: "gate-c-terminal-tab",
            panel_id: "bottom",
            target_leaf_id: null,
            before_tab_id: null,
          },
        },
      }),
    );
    expect(deleteProjectSessionTab("gate-c-browser-tab")).toBe(true);
    await stage(
      "Project Workspace delete browser tab",
      candidate.workspaceApply({
        operationId: "gate-c-workspace-delete-browser-tab",
        intent: {
          kind: "mutate_session",
          session_id: candidateCreatedSession.value.session.id,
          intent: {
            kind: "delete_tab",
            tab_id: "gate-c-browser-tab",
          },
        },
      }),
    );
    const oraclePanelResult = getProjectSession(oraclePanelSession.id);
    const candidatePanelResult = await stage(
      "Project Workspace panel and tab snapshot",
      candidate.workspaceRead({
        kind: "session",
        session_id: candidateCreatedSession.value.session.id,
      }),
    );
    if (!oraclePanelResult || candidatePanelResult.value.kind !== "session") {
      throw new Error("Expected final panel and tab snapshots from both authorities");
    }
    expect(normalizePanelTabs(candidatePanelResult.value.panels)).toEqual(
      normalizePanelTabs(oraclePanelResult.panels),
    );
    expect(candidatePanelResult.value.tabs.map((tab) => ({
      id: tab.kind === "db_view" ? "database-tab" : tab.id,
      panelId: tab.panel_id,
      kind: tab.kind,
      title: tab.title,
      order: tab.order,
      stateKey: tab.state_key,
    }))).toEqual(oraclePanelResult.tabs.map((tab) => ({
      id: tab.kind === "db_view" ? "database-tab" : tab.id,
      panelId: tab.panelId,
      kind: tab.kind,
      title: tab.title,
      order: tab.order,
      stateKey: tab.stateKey,
    })));

    const oracleViewState = updateProjectSession(oraclePanelSession.id, {
      leftPaneCollapsed: true,
      panels: {
        right: {
          collapsed: false,
          size: { widthPx: 720, fullWidth: true },
        },
        bottom: {
          collapsed: false,
          size: { heightPx: 360 },
        },
      },
    });
    if (!oracleViewState) throw new Error("TypeScript Session view-state patch disappeared");
    await stage(
      "Project Workspace patch Session view state",
      candidate.workspaceApply({
        operationId: "gate-c-workspace-patch-session-view-state",
        intent: {
          kind: "mutate_session",
          session_id: candidateCreatedSession.value.session.id,
          intent: {
            kind: "patch_view_state",
            left_pane_collapsed: true,
            right_panel: {
              collapsed: false,
              size: { width_px: 720, full_width: true },
            },
            bottom_panel: {
              collapsed: false,
              size: { height_px: 360 },
            },
          },
        },
      }),
    );
    const oracleUpdatedTerminal = updateProjectSessionTab("gate-c-terminal-tab", {
      title: "Gate C updated shell",
      config: {
        projectId: oracleCreatedProject.id,
        terminalSessionId: "gate-c-terminal-session-2",
      },
    });
    if (!oracleUpdatedTerminal) throw new Error("TypeScript terminal update disappeared");
    await stage(
      "Project Workspace update terminal tab",
      candidate.workspaceApply({
        operationId: "gate-c-workspace-update-terminal-tab",
        intent: {
          kind: "mutate_session",
          session_id: candidateCreatedSession.value.session.id,
          intent: {
            kind: "update_tab",
            tab_id: "gate-c-terminal-tab",
            title: "Gate C updated shell",
            config: {
              projectId: candidateProjectId,
              terminalSessionId: "gate-c-terminal-session-2",
            },
          },
        },
      }),
    );
    const oracleStatefulTerminal = updateProjectSessionTabState(
      "gate-c-terminal-tab",
      2,
      { cwd: "/tmp/gate-c" },
    );
    if (!oracleStatefulTerminal) throw new Error("TypeScript terminal state disappeared");
    const candidateReplaceTabStateInput = {
      operationId: "gate-c-workspace-replace-terminal-state",
      intent: {
        kind: "mutate_session" as const,
        session_id: candidateCreatedSession.value.session.id,
        intent: {
          kind: "replace_tab_state" as const,
          tab_id: "gate-c-terminal-tab",
          state_key: 2,
          state: { cwd: "/tmp/gate-c" },
        },
      },
    };
    const candidateStatefulTerminal = await stage(
      "Project Workspace replace terminal tab state",
      candidate.workspaceApply(candidateReplaceTabStateInput),
    );
    const candidateStatefulTerminalReplay = await stage(
      "Project Workspace replay terminal tab state",
      candidate.workspaceApply(candidateReplaceTabStateInput),
    );
    expect(candidateStatefulTerminalReplay.event_sequence).toBe(
      candidateStatefulTerminal.event_sequence,
    );
    expect(candidateStatefulTerminalReplay.receipt.duplicate).toBe(true);

    createProjectSessionTab({
      sessionId: oraclePanelSession.id,
      projectId: oracleCreatedProject.id,
      panelId: "right",
      clientTabId: "gate-c-cross-project-page-tab",
      kind: "page_stage",
      title: "Gate C cross-project Page",
      config: {
        projectId: coordinates.projectId,
        pageId: "gate-c-cross-project-page",
        titleSnapshot: "Initial",
      },
    });
    await stage(
      "Project Workspace create cross-Project Page tab",
      candidate.workspaceApply({
        operationId: "gate-c-workspace-create-cross-project-page-tab",
        intent: {
          kind: "mutate_session",
          session_id: candidateCreatedSession.value.session.id,
          intent: {
            kind: "create_tab",
            tab_id: "gate-c-cross-project-page-tab",
            panel_id: "right",
            target_leaf_id: null,
            browser_tab_id: null,
            tab_kind: "page_stage",
            title: "Gate C cross-project Page",
            config: {
              projectId: coordinates.projectId,
              pageId: "gate-c-cross-project-page",
              titleSnapshot: "Initial",
            },
          },
        },
      }),
    );
    const oracleUpdatedPageTab = updateProjectSessionTab(
      "gate-c-cross-project-page-tab",
      {
        config: {
          projectId: coordinates.projectId,
          pageId: "gate-c-cross-project-page",
          titleSnapshot: "Updated",
        },
      },
    );
    if (!oracleUpdatedPageTab) throw new Error("TypeScript Page tab update disappeared");
    await stage(
      "Project Workspace update cross-Project Page tab",
      candidate.workspaceApply({
        operationId: "gate-c-workspace-update-cross-project-page-tab",
        intent: {
          kind: "mutate_session",
          session_id: candidateCreatedSession.value.session.id,
          intent: {
            kind: "update_tab",
            tab_id: "gate-c-cross-project-page-tab",
            config: {
              projectId: coordinates.projectId,
              pageId: "gate-c-cross-project-page",
              titleSnapshot: "Updated",
            },
          },
        },
      }),
    );

    const oracleUpdatedViewResult = getProjectSession(oraclePanelSession.id);
    const candidateUpdatedViewResult = await stage(
      "Project Workspace updated view and tab snapshot",
      candidate.workspaceRead({
        kind: "session",
        session_id: candidateCreatedSession.value.session.id,
      }),
    );
    if (!oracleUpdatedViewResult || candidateUpdatedViewResult.value.kind !== "session") {
      throw new Error("Expected updated view and tab snapshots from both authorities");
    }
    expect(candidateUpdatedViewResult.value.session.left_pane_collapsed).toBe(
      oracleUpdatedViewResult.leftPaneCollapsed,
    );
    expect(normalizePanelTabs(candidateUpdatedViewResult.value.panels)).toEqual(
      normalizePanelTabs(oracleUpdatedViewResult.panels),
    );
    const candidateUpdatedTerminal = candidateUpdatedViewResult.value.tabs.find(
      (tab) => tab.id === "gate-c-terminal-tab",
    );
    expect(candidateUpdatedTerminal).toMatchObject({
      title: oracleStatefulTerminal.title,
      state_key: oracleStatefulTerminal.stateKey,
      state: oracleStatefulTerminal.state,
      config: {
        projectId: candidateProjectId,
        terminalSessionId: "gate-c-terminal-session-2",
      },
    });
    const candidateUpdatedPageTab = candidateUpdatedViewResult.value.tabs.find(
      (tab) => tab.id === "gate-c-cross-project-page-tab",
    );
    expect(candidateUpdatedPageTab).toMatchObject({
      project_id: candidateProjectId,
      config: oracleUpdatedPageTab.config,
    });

    const oracleLifecycleSessionA = createProjectSession({
      projectId: oracleCreatedProject.id,
      noThreadFallbackTitle: "Gate C lifecycle A",
    });
    const candidateLifecycleSessionAId = "gate-c-lifecycle-session-a";
    const candidateCreateSessionAInput = {
      operationId: "gate-c-workspace-create-session-a",
      intent: {
        kind: "create_session" as const,
        session_id: candidateLifecycleSessionAId,
        project_id: candidateProjectId,
        title: "Gate C lifecycle A",
      },
    };
    const candidateCreatedSessionA = await stage(
      "Project Workspace create explicit Session A",
      candidate.workspaceApply(candidateCreateSessionAInput),
    );
    const candidateReplayedSessionA = await stage(
      "Project Workspace replay explicit Session A creation",
      candidate.workspaceApply(candidateCreateSessionAInput),
    );
    expect(candidateReplayedSessionA.event_sequence).toBe(
      candidateCreatedSessionA.event_sequence,
    );
    expect(candidateReplayedSessionA.receipt.duplicate).toBe(true);

    const oracleLifecycleSessionB = createProjectSession({
      projectId: oracleCreatedProject.id,
      noThreadFallbackTitle: "Gate C lifecycle B",
    });
    const candidateLifecycleSessionBId = "gate-c-lifecycle-session-b";
    await stage(
      "Project Workspace create explicit Session B",
      candidate.workspaceApply({
        operationId: "gate-c-workspace-create-session-b",
        intent: {
          kind: "create_session",
          session_id: candidateLifecycleSessionBId,
          project_id: candidateProjectId,
          title: "Gate C lifecycle B",
        },
      }),
    );

    const lifecyclePairs = [
      {
        oracleId: oracleCreatedSession.id,
        candidateId: candidateCreatedSession.value.session.id,
        stableId: "default",
      },
      {
        oracleId: oracleLifecycleSessionA.id,
        candidateId: candidateLifecycleSessionAId,
        stableId: "a",
      },
      {
        oracleId: oracleLifecycleSessionB.id,
        candidateId: candidateLifecycleSessionBId,
        stableId: "b",
      },
    ] as const;
    for (const pair of lifecyclePairs) {
      setProjectSessionPinned(pair.oracleId, { pinned: true });
      await stage(
        `Project Workspace pin lifecycle Session ${pair.stableId}`,
        candidate.workspaceApply({
          operationId: `gate-c-workspace-pin-session-${pair.stableId}`,
          intent: {
            kind: "mutate_session",
            session_id: pair.candidateId,
            intent: { kind: "set_pinned", pinned: true },
          },
        }),
      );
    }
    reorderProjectSessions(oracleCreatedProject.id, [
      oracleLifecycleSessionB.id,
      oracleLifecycleSessionA.id,
    ]);
    await stage(
      "Project Workspace reorder Sessions",
      candidate.workspaceApply({
        operationId: "gate-c-workspace-reorder-sessions",
        intent: {
          kind: "reorder_sessions",
          project_id: candidateProjectId,
          session_ids: [candidateLifecycleSessionBId, candidateLifecycleSessionAId],
        },
      }),
    );
    setPinnedProjectSessionOrder(oracleCreatedProject.id, {
      orderedSessionIds: [oracleCreatedSession.id, oracleLifecycleSessionB.id],
    });
    await stage(
      "Project Workspace reorder pinned Sessions",
      candidate.workspaceApply({
        operationId: "gate-c-workspace-reorder-pinned-sessions",
        intent: {
          kind: "reorder_pinned_sessions",
          project_id: candidateProjectId,
          session_ids: [
            candidateCreatedSession.value.session.id,
            candidateLifecycleSessionBId,
          ],
        },
      }),
    );

    const oracleArchivedSessionB = archiveProjectSession(oracleLifecycleSessionB.id);
    if (!oracleArchivedSessionB) throw new Error("TypeScript Session archive disappeared");
    await stage(
      "Project Workspace archive Session",
      candidate.workspaceApply({
        operationId: "gate-c-workspace-archive-session-b",
        intent: {
          kind: "mutate_session",
          session_id: candidateLifecycleSessionBId,
          intent: { kind: "set_archived", archived: true },
        },
      }),
    );
    const candidateArchivedSessionB = await stage(
      "Project Workspace archived Session snapshot",
      candidate.workspaceRead({
        kind: "session",
        session_id: candidateLifecycleSessionBId,
      }),
    );
    if (candidateArchivedSessionB.value.kind !== "session") {
      throw new Error("Expected archived Rust Session snapshot");
    }
    expect({
      archived: candidateArchivedSessionB.value.session.archived,
      archivedAtPresent: candidateArchivedSessionB.value.session.archived_at != null,
      pinned: candidateArchivedSessionB.value.session.pinned,
      pinnedOrder: candidateArchivedSessionB.value.session.pinned_order,
      unread: candidateArchivedSessionB.value.session.unread,
    }).toEqual({
      archived: oracleArchivedSessionB.archived,
      archivedAtPresent: oracleArchivedSessionB.archivedAt !== null,
      pinned: oracleArchivedSessionB.pinned,
      pinnedOrder: oracleArchivedSessionB.pinnedOrder,
      unread: oracleArchivedSessionB.unread,
    });
    const oracleRestoredSessionB = unarchiveProjectSession(oracleLifecycleSessionB.id);
    if (!oracleRestoredSessionB) throw new Error("TypeScript Session restore disappeared");
    await stage(
      "Project Workspace restore Session",
      candidate.workspaceApply({
        operationId: "gate-c-workspace-restore-session-b",
        intent: {
          kind: "mutate_session",
          session_id: candidateLifecycleSessionBId,
          intent: { kind: "set_archived", archived: false },
        },
      }),
    );

    const normalizeOracleLifecycleSession = (
      stableId: string,
      session: {
        readonly projectId: string | null;
        readonly noThreadFallbackTitle: string;
        readonly displayTitle: string;
        readonly order: number;
        readonly pinned: boolean;
        readonly pinnedOrder: number | null;
        readonly archived: boolean;
        readonly archivedAt: string | null;
        readonly unread: boolean;
        readonly leftPaneCollapsed: boolean;
      },
    ) => ({
      stableId,
      projectBound: session.projectId !== null,
      title: session.noThreadFallbackTitle,
      displayTitle: session.displayTitle,
      order: session.order,
      pinned: session.pinned,
      pinnedOrder: session.pinnedOrder,
      archived: session.archived,
      archivedAtPresent: session.archivedAt !== null,
      unread: session.unread,
      leftPaneCollapsed: session.leftPaneCollapsed,
    });
    const normalizeCandidateLifecycleSession = (
      stableId: string,
      session: {
        readonly project_id?: string | null;
        readonly no_thread_fallback_title: string;
        readonly display_title: string;
        readonly order: number;
        readonly pinned: boolean;
        readonly pinned_order?: number | null;
        readonly archived: boolean;
        readonly archived_at?: string | null;
        readonly unread: boolean;
        readonly left_pane_collapsed: boolean;
      },
    ) => ({
      stableId,
      projectBound: session.project_id !== null,
      title: session.no_thread_fallback_title,
      displayTitle: session.display_title,
      order: session.order,
      pinned: session.pinned,
      pinnedOrder: session.pinned_order ?? null,
      archived: session.archived,
      archivedAtPresent: session.archived_at != null,
      unread: session.unread,
      leftPaneCollapsed: session.left_pane_collapsed,
    });
    const oracleLifecycleIds = new Map(
      lifecyclePairs.map((pair) => [pair.oracleId, pair.stableId]),
    );
    const candidateLifecycleIds = new Map(
      lifecyclePairs.map((pair) => [pair.candidateId, pair.stableId]),
    );
    const oracleLifecycleState = listProjectSessionSummaries(
      oracleCreatedProject.id,
      { includeArchived: true },
    ).map((session) => normalizeOracleLifecycleSession(
      oracleLifecycleIds.get(session.id) ?? session.id,
      session,
    )).sort((left, right) => left.stableId.localeCompare(right.stableId));
    const candidateLifecycleState = await stage(
      "Project Workspace ordered Session summaries",
      candidate.workspaceRead({
        kind: "sessions",
        project_id: candidateProjectId,
        include_archived: true,
      }),
    );
    if (candidateLifecycleState.value.kind !== "sessions") {
      throw new Error("Expected ordered Rust Session summaries");
    }
    expect(candidateLifecycleState.value.sessions.map((session) =>
      normalizeCandidateLifecycleSession(
        candidateLifecycleIds.get(session.id) ?? session.id,
        session,
      )
    ).sort((left, right) => left.stableId.localeCompare(right.stableId))).toEqual(
      oracleLifecycleState,
    );

    expect(deleteProjectSession(oracleLifecycleSessionA.id)).toBe(true);
    await stage(
      "Project Workspace delete explicit Session",
      candidate.workspaceApply({
        operationId: "gate-c-workspace-delete-session-a",
        intent: {
          kind: "delete_session",
          session_id: candidateLifecycleSessionAId,
        },
      }),
    );

    const oracleProjectlessSession = createProjectSession({
      projectId: null,
      noThreadFallbackTitle: "Gate C movable browser",
    });
    const candidateProjectlessSessionId = "gate-c-projectless-session";
    await stage(
      "Project Workspace create projectless Session",
      candidate.workspaceApply({
        operationId: "gate-c-workspace-create-projectless-session",
        intent: {
          kind: "create_session",
          session_id: candidateProjectlessSessionId,
          project_id: null,
          title: "Gate C movable browser",
        },
      }),
    );
    createProjectSessionTab({
      sessionId: oracleProjectlessSession.id,
      projectId: null,
      panelId: "right",
      clientTabId: "gate-c-movable-browser-tab",
      browserTabId: "gate-c-movable-browser-identity",
      kind: "browser",
      title: "Gate C movable browser",
      config: {
        projectId: null,
        url: "https://example.test/movable",
      },
    });
    await stage(
      "Project Workspace create projectless browser tab",
      candidate.workspaceApply({
        operationId: "gate-c-workspace-create-projectless-browser",
        intent: {
          kind: "mutate_session",
          session_id: candidateProjectlessSessionId,
          intent: {
            kind: "create_tab",
            tab_id: "gate-c-movable-browser-tab",
            panel_id: "right",
            target_leaf_id: null,
            browser_tab_id: "gate-c-movable-browser-identity",
            tab_kind: "browser",
            title: "Gate C movable browser",
            config: {
              projectId: null,
              url: "https://example.test/movable",
            },
          },
        },
      }),
    );
    const oracleMovedSession = moveProjectSessionToProject(
      oracleProjectlessSession.id,
      oracleCreatedProject.id,
    );
    if (!oracleMovedSession) throw new Error("TypeScript Session move disappeared");
    await stage(
      "Project Workspace move browser-only Session",
      candidate.workspaceApply({
        operationId: "gate-c-workspace-move-projectless-session",
        intent: {
          kind: "move_session",
          session_id: candidateProjectlessSessionId,
          project_id: candidateProjectId,
        },
      }),
    );
    const candidateMovedSession = await stage(
      "Project Workspace moved Session snapshot",
      candidate.workspaceRead({
        kind: "session",
        session_id: candidateProjectlessSessionId,
      }),
    );
    if (candidateMovedSession.value.kind !== "session") {
      throw new Error("Expected moved Rust Session snapshot");
    }
    expect(normalizeCandidateLifecycleSession(
      "moved",
      candidateMovedSession.value.session,
    )).toEqual(normalizeOracleLifecycleSession("moved", oracleMovedSession));
    expect(candidateMovedSession.value.tabs).toHaveLength(1);
    expect(candidateMovedSession.value.tabs[0]).toMatchObject({
      id: "gate-c-movable-browser-tab",
      browser_tab_id: "gate-c-movable-browser-identity",
      kind: "browser",
      config: {
        projectId: candidateProjectId,
        url: "https://example.test/movable",
      },
    });
    expect(oracleMovedSession.tabs[0]).toMatchObject({
      id: "gate-c-movable-browser-tab",
      browserTabId: "gate-c-movable-browser-identity",
      kind: "browser",
      config: {
        projectId: oracleCreatedProject.id,
        url: "https://example.test/movable",
      },
    });
    expect(deleteProjectSession(oracleMovedSession.id)).toBe(true);
    await stage(
      "Project Workspace delete moved Session",
      candidate.workspaceApply({
        operationId: "gate-c-workspace-delete-moved-session",
        intent: {
          kind: "delete_session",
          session_id: candidateProjectlessSessionId,
        },
      }),
    );

    const oracleInitialDatabase = readDatabaseModuleV2(getDb(), {
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      projectId: oracleCreatedProject.id,
      read: { target: { kind: "project_default" }, mode: "database" },
    });
    if (!oracleInitialDatabase.ok || oracleInitialDatabase.value.value.kind !== "database") {
      throw new Error(
        oracleInitialDatabase.ok
          ? "Expected initial TypeScript Database"
          : oracleInitialDatabase.error.message,
      );
    }
    const candidateProjectClient = await stage(
      "Core connect to created Project",
      CoreClient.connect({
        nodexHome: rustHome,
        clientKind: "test",
        buildId: "workspace-gate-c",
        projectId: candidateProjectId,
      }),
    );
    const candidateInitialDatabase = await stage(
      "Project Workspace initial Database",
      candidateProjectClient.databaseRead({
        target: { kind: "project_default" },
        mode: "database",
        filter: null,
        sort: null,
      }),
    );
    if (candidateInitialDatabase.value.kind !== "database") {
      throw new Error("Expected initial Rust Database");
    }
    const candidateInitialDatabaseValue = candidateInitialDatabase.value.value as {
      readonly dataSources: readonly {
        readonly dataSourceId: string;
      }[];
    };
    const stripDatabaseIdentities = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(stripDatabaseIdentities);
      if (value === null || typeof value !== "object") return value;
      const identityKeys = new Set([
        "database_id",
        "data_source_id",
        "view_id",
        "default_view_id",
        "home_database_id",
      ]);
      return Object.fromEntries(
        Object.entries(value)
          .filter(([key]) => !identityKeys.has(key))
          .map(([key, entry]) => [key, stripDatabaseIdentities(entry)]),
      );
    };
    expect(stripDatabaseIdentities(withoutVolatileFields(
      withSnakeCaseKeys(candidateInitialDatabaseValue),
    ))).toEqual(stripDatabaseIdentities(withoutVolatileFields(
      withSnakeCaseKeys(oracleInitialDatabase.value.value.value),
    )));

    const oracleInitialSourceId =
      oracleInitialDatabase.value.value.value.dataSources[0]?.dataSourceId;
    const candidateInitialSourceId =
      candidateInitialDatabaseValue.dataSources[0]?.dataSourceId;
    if (!oracleInitialSourceId || !candidateInitialSourceId) {
      throw new Error("Initial Project Database omitted its Data Source");
    }
    const oracleInitialSource = readDatabaseModuleV2(getDb(), {
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      projectId: oracleCreatedProject.id,
      read: {
        target: { kind: "data_source", dataSourceId: oracleInitialSourceId },
        mode: "data_source",
      },
    });
    if (!oracleInitialSource.ok || oracleInitialSource.value.value.kind !== "data_source") {
      throw new Error(
        oracleInitialSource.ok
          ? "Expected initial TypeScript Data Source"
          : oracleInitialSource.error.message,
      );
    }
    const candidateInitialSource = await stage(
      "Project Workspace initial Data Source",
      candidateProjectClient.databaseRead({
        target: {
          kind: "data_source",
          data_source_id: candidateInitialSourceId,
        },
        mode: "data_source",
        filter: null,
        sort: null,
      }),
    );
    if (candidateInitialSource.value.kind !== "data_source") {
      throw new Error("Expected initial Rust Data Source");
    }
    expect(stripDatabaseIdentities(withoutVolatileFields(
      withSnakeCaseKeys(candidateInitialSource.value.value),
    ))).toEqual(stripDatabaseIdentities(withoutVolatileFields(
      withSnakeCaseKeys(oracleInitialSource.value.value.value),
    )));

    const oracleCanvas = getOwnedDocumentDescriptor(
      getDb(),
      oracleCreatedProject.id,
      primaryCanvasBlockId(oracleCreatedProject.id),
    );
    const candidateCanvas = await stage(
      "Project Workspace primary Canvas",
      candidateProjectClient.documentRead("gate-c-workspace-canvas", {
        kind: "descriptor",
        owner_block_id: primaryCanvasBlockId(candidateProjectId),
      }),
    );
    if (candidateCanvas.value.kind !== "descriptor") {
      throw new Error("Expected initial Rust Canvas descriptor");
    }
    expect(candidateCanvas.value.descriptor).toMatchObject({
      ownerType: oracleCanvas.ownerType,
      ownerLifecycle: oracleCanvas.ownerLifecycle,
      generation: oracleCanvas.generation,
      headSeq: oracleCanvas.headSeq,
      schemaKey: oracleCanvas.schemaKey,
      schemaVersion: oracleCanvas.schemaVersion,
      readiness: oracleCanvas.readiness,
      sync: oracleCanvas.sync,
    });

    const updatedWorkspaceRoot = path.join(tmpdir(), "nodex-gate-c-workspace-updated");
    const oracleUpdatedProject = updateProject(oracleCreatedProject.id, {
      name: "Gate C renamed workspace",
      description: "Updated Project metadata",
      icon: "Plan 🧩 work",
      sources: [updatedWorkspaceRoot, updatedWorkspaceRoot],
    });
    if (!oracleUpdatedProject) throw new Error("TypeScript Project update disappeared");
    const candidateUpdatedProject = await stage(
      "Project Workspace update Project",
      candidate.workspaceApply({
        operationId: "gate-c-workspace-update-project",
        intent: {
          kind: "update_project",
          project_id: candidateProjectId,
          expected_binding_revision: 1,
          name: "Gate C renamed workspace",
          description: "Updated Project metadata",
          icon: "Plan 🧩 work",
          source_roots: [updatedWorkspaceRoot, updatedWorkspaceRoot],
        },
      }),
    );
    expect(candidateUpdatedProject.value).toMatchObject({
      affected_project_ids: [candidateProjectId],
      affected_session_ids: [],
      affected_thread_ids: [],
    });

    setProjectPinned(oracleCreatedProject.id, { pinned: true });
    await stage(
      "Project Workspace pin Project",
      candidate.workspaceApply({
        operationId: "gate-c-workspace-pin-project",
        intent: {
          kind: "set_project_pinned",
          project_id: candidateProjectId,
          pinned: true,
        },
      }),
    );
    const oracleSecondProject = createProject({ name: "Gate C secondary workspace" });
    const candidateSecondProjectId = createUuidV7();
    await stage(
      "Project Workspace create secondary Project",
      candidate.workspaceApply({
        operationId: "gate-c-workspace-create-secondary",
        intent: {
          kind: "create_project",
          project_id: candidateSecondProjectId,
          name: "Gate C secondary workspace",
          description: "",
          icon: null,
          source_roots: [],
        },
      }),
    );

    const sidebarMoveThreadId = "gate-c-sidebar-move";
    const sidebarAnchorThreadId = "gate-c-sidebar-anchor";
    const sidebarChatAThreadId = "gate-c-sidebar-chat-a";
    const sidebarChatBThreadId = "gate-c-sidebar-chat-b";
    const sidebarSearchUpdatedAt = 610;
    const oracleMoveSession = createProjectSession({
      projectId: oracleCreatedProject.id,
      noThreadFallbackTitle: "Gate C sidebar move",
    });
    upsertProjectSessionThreadLink({
      sessionId: oracleMoveSession.id,
      projectId: oracleCreatedProject.id,
      threadId: sidebarMoveThreadId,
      threadName: "Gate C sidebar move",
      threadPreview: "Atomic sidebar move and search",
      modelProvider: "openai",
      cwd: workspaceRoot,
      statusType: "idle",
      statusActiveFlags: [],
      archived: false,
      createdAt: sidebarSearchUpdatedAt,
      updatedAt: sidebarSearchUpdatedAt,
    });
    const oracleAnchorSession = createProjectSession({
      projectId: oracleSecondProject.id,
      noThreadFallbackTitle: "Gate C sidebar anchor",
    });
    upsertProjectSessionThreadLink({
      sessionId: oracleAnchorSession.id,
      projectId: oracleSecondProject.id,
      threadId: sidebarAnchorThreadId,
      threadName: "Gate C sidebar anchor",
      threadPreview: "",
      modelProvider: "openai",
      statusType: "idle",
      statusActiveFlags: [],
      archived: false,
      createdAt: 600,
      updatedAt: 600,
    });
    for (const [threadId, updatedAt] of [
      [sidebarChatAThreadId, 590],
      [sidebarChatBThreadId, 580],
    ] as const) {
      upsertCodexThread({
        threadId,
        threadName: threadId,
        threadPreview: "",
        modelProvider: "openai",
        statusType: "idle",
        statusActiveFlags: [],
        createdAt: updatedAt,
        updatedAt,
      });
    }

    const candidateMoveSessionId = "gate-c-sidebar-move-session";
    const candidateAnchorSessionId = "gate-c-sidebar-anchor-session";
    for (const [operationPrefix, sessionId, threadId, projectId, updatedAt, preview] of [
      [
        "move",
        candidateMoveSessionId,
        sidebarMoveThreadId,
        candidateProjectId,
        sidebarSearchUpdatedAt,
        "Atomic sidebar move and search",
      ],
      [
        "anchor",
        candidateAnchorSessionId,
        sidebarAnchorThreadId,
        candidateSecondProjectId,
        600,
        "",
      ],
    ] as const) {
      await stage(
        "Project Workspace create sidebar " + operationPrefix + " Session",
        candidate.workspaceApply({
          operationId: "gate-c-workspace-sidebar-" + operationPrefix + "-session",
          intent: {
            kind: "create_session",
            session_id: sessionId,
            project_id: projectId,
            title: threadId,
          },
        }),
      );
      await stage(
        "Project Workspace create sidebar " + operationPrefix + " Thread",
        candidate.workspaceApply({
          operationId: "gate-c-workspace-sidebar-" + operationPrefix + "-thread",
          intent: {
            kind: "upsert_thread",
            thread_id: threadId,
            patch: {
              project_id: projectId,
              thread_name: threadId,
              thread_preview: preview,
              model_provider: "openai",
              status: {
                status_type: "idle",
                active_flags: [],
              },
              created_at: updatedAt,
              updated_at: updatedAt,
              linked_at: threadLinkedAt,
            },
          },
        }),
      );
      await stage(
        "Project Workspace link sidebar " + operationPrefix + " Thread",
        candidate.workspaceApply({
          operationId: "gate-c-workspace-sidebar-" + operationPrefix + "-link",
          intent: {
            kind: "mutate_session",
            session_id: sessionId,
            intent: {
              kind: "link_thread",
              thread_id: threadId,
              expected_project_id: projectId,
            },
          },
        }),
      );
    }
    for (const [threadId, updatedAt] of [
      [sidebarChatAThreadId, 590],
      [sidebarChatBThreadId, 580],
    ] as const) {
      await stage(
        "Project Workspace create " + threadId,
        candidate.workspaceApply({
          operationId: "gate-c-workspace-" + threadId,
          intent: {
            kind: "upsert_thread",
            thread_id: threadId,
            patch: {
              project_id: null,
              thread_name: threadId,
              thread_preview: "",
              model_provider: "openai",
              status: {
                status_type: "idle",
                active_flags: [],
              },
              created_at: updatedAt,
              updated_at: updatedAt,
              linked_at: threadLinkedAt,
            },
          },
        }),
      );
    }

    setCodexProjectThreadOrder(oracleCreatedProject.id, [sidebarMoveThreadId]);
    setCodexProjectThreadOrder(oracleSecondProject.id, [sidebarAnchorThreadId]);
    await stage(
      "Project Workspace set source sidebar order",
      candidate.workspaceApply({
        operationId: "gate-c-workspace-sidebar-source-order",
        intent: {
          kind: "set_project_thread_order",
          project_id: candidateProjectId,
          ordered_thread_ids: [sidebarMoveThreadId],
        },
      }),
    );
    await stage(
      "Project Workspace set target sidebar order",
      candidate.workspaceApply({
        operationId: "gate-c-workspace-sidebar-target-order",
        intent: {
          kind: "set_project_thread_order",
          project_id: candidateSecondProjectId,
          ordered_thread_ids: [sidebarAnchorThreadId],
        },
      }),
    );
    const chatOrderInput = {
      threadIdsInDisplayOrder: [sidebarChatAThreadId, sidebarChatBThreadId],
      visibleThreadIds: [sidebarChatAThreadId, sidebarChatBThreadId],
      nextVisibleThreadIds: [sidebarChatBThreadId, sidebarChatAThreadId],
    };
    setCodexSidebarChatOrder(chatOrderInput);
    await stage(
      "Project Workspace set projectless sidebar order",
      candidate.workspaceApply({
        operationId: "gate-c-workspace-sidebar-projectless-order",
        intent: {
          kind: "set_projectless_thread_order",
          thread_ids_in_display_order: chatOrderInput.threadIdsInDisplayOrder,
          visible_thread_ids: chatOrderInput.visibleThreadIds,
          next_visible_thread_ids: chatOrderInput.nextVisibleThreadIds,
        },
      }),
    );

    const oracleSidebarSearchService = new CommandPaletteThreadSearchService();
    const oracleSearchThread = getCodexThread(sidebarMoveThreadId);
    if (!oracleSearchThread) throw new Error("Gate C sidebar search Thread is missing");
    const oracleSearchSummary = {
      threadId: sidebarMoveThreadId,
      sessionId: oracleMoveSession.id,
      projectId: oracleCreatedProject.id,
      projectName: oracleCreatedProject.name,
      title: "Gate C sidebar move",
      preview: "Atomic sidebar move and search",
      cwd: workspaceRoot,
      projectless: false,
      pinned: false,
      pinnedOrder: null,
      statusType: "idle" as const,
      statusActiveFlags: [],
      createdAt: sidebarSearchUpdatedAt,
      updatedAt: sidebarSearchUpdatedAt,
      linkedAt: oracleSearchThread.linkedAt,
    };
    oracleSidebarSearchService.indexThreadDetail(oracleSearchSummary, {
      ...oracleSearchThread,
      turns: [],
      transcript: [{
        threadId: sidebarMoveThreadId,
        turnId: "turn-sidebar-search",
        itemId: "item-sidebar-search",
        type: "userMessage",
        kind: "userMessage",
        role: "user",
        markdownText: "sidebarneedle visible transcript",
        createdAt: sidebarSearchUpdatedAt,
        updatedAt: sidebarSearchUpdatedAt,
      }],
    });
    await stage(
      "Project Workspace replace sidebar Thread search projection",
      candidate.workspaceApply({
        operationId: "gate-c-workspace-sidebar-search-projection",
        intent: {
          kind: "replace_thread_search_projection",
          thread_id: sidebarMoveThreadId,
          expected_thread_updated_at: sidebarSearchUpdatedAt,
          units: [{
            turn_id: "turn-sidebar-search",
            item_id: "item-sidebar-search",
            role: "user",
            text: "sidebarneedle visible transcript",
          }],
        },
      }),
    );

    moveCodexProjectThread({
      threadId: sidebarMoveThreadId,
      sourceProjectId: oracleCreatedProject.id,
      targetProjectId: oracleSecondProject.id,
      beforeThreadId: sidebarAnchorThreadId,
      threadMetadataPatch: {
        cwd: updatedWorkspaceRoot,
        managedWorktreePath: null,
      },
    });
    const candidateSidebarMove = {
      operationId: "gate-c-workspace-sidebar-move",
      intent: {
        kind: "move_thread" as const,
        thread_id: sidebarMoveThreadId,
        source: {
          kind: "project" as const,
          project_id: candidateProjectId,
        },
        target: {
          kind: "project" as const,
          project_id: candidateSecondProjectId,
        },
        placement: {
          kind: "before" as const,
          thread_id: sidebarAnchorThreadId,
        },
        metadata: {
          cwd: updatedWorkspaceRoot,
          managed_worktree_path: null,
        },
      },
    };
    const candidateSidebarMoveCommit = await stage(
      "Project Workspace move sidebar Thread",
      candidate.workspaceApply(candidateSidebarMove),
    );
    const candidateSidebarMoveReplay = await stage(
      "Project Workspace replay sidebar Thread move",
      candidate.workspaceApply(candidateSidebarMove),
    );
    expect(candidateSidebarMoveReplay.event_sequence).toBe(
      candidateSidebarMoveCommit.event_sequence,
    );
    expect(candidateSidebarMoveReplay.receipt.duplicate).toBe(true);

    const candidateSidebar = await stage(
      "Project Workspace sidebar snapshot",
      candidate.workspaceRead({ kind: "sidebar", include_archived: false }),
    );
    if (candidateSidebar.value.kind !== "sidebar") {
      throw new Error("Expected Rust sidebar snapshot");
    }
    const candidateSidebarValue = candidateSidebar.value.sidebar;
    expect(
      candidateSidebarValue.project_thread_orders[candidateSecondProjectId]
        ?.filter((id) => id === sidebarMoveThreadId || id === sidebarAnchorThreadId),
    ).toEqual(
      getCodexProjectThreadOrder(oracleSecondProject.id)
        ?.filter((id) => id === sidebarMoveThreadId || id === sidebarAnchorThreadId),
    );
    expect(
      candidateSidebarValue.project_thread_orders[candidateProjectId]
        ?.filter((id) => id === sidebarMoveThreadId),
    ).toEqual(
      getCodexProjectThreadOrder(oracleCreatedProject.id)
        ?.filter((id) => id === sidebarMoveThreadId),
    );
    expect(candidateSidebarValue.projectless_thread_order).toEqual(
      getCodexSidebarChatOrder(),
    );
    const candidateMovedSidebarThread = candidateSidebarValue.threads.find(
      (thread) => thread.thread_id === sidebarMoveThreadId,
    );
    const oracleMovedSidebarThread = getCodexThread(sidebarMoveThreadId);
    expect(candidateMovedSidebarThread).toMatchObject({
      project_id: candidateSecondProjectId,
      session_id: candidateMoveSessionId,
      cwd: updatedWorkspaceRoot,
      managed_worktree_path: null,
    });
    expect(oracleMovedSidebarThread).toMatchObject({
      projectId: oracleSecondProject.id,
      cwd: updatedWorkspaceRoot,
      managedWorktreePath: null,
    });

    const oracleSidebarSearch = oracleSidebarSearchService.search(
      { query: "sidebarneedle", limit: 10 },
      [oracleSearchSummary],
    );
    const candidateSidebarSearch = await stage(
      "Project Workspace sidebar Thread search",
      candidate.workspaceRead({
        kind: "thread_search",
        query: "sidebarneedle",
        limit: 10,
      }),
    );
    if (candidateSidebarSearch.value.kind !== "thread_search") {
      throw new Error("Expected Rust sidebar Thread search");
    }
    expect(candidateSidebarSearch.value.results).toEqual(
      withSnakeCaseKeys(oracleSidebarSearch),
    );
    oracleSidebarSearchService.shutdown();

    reorderProjects({
      orderedProjectIds: [
        oracleCreatedProject.id,
        coordinates.projectId,
        oracleSecondProject.id,
      ],
    });
    await stage(
      "Project Workspace reorder Projects",
      candidate.workspaceApply({
        operationId: "gate-c-workspace-reorder-projects",
        intent: {
          kind: "reorder_projects",
          project_ids: [
            candidateProjectId,
            coordinates.projectId,
            candidateSecondProjectId,
          ],
        },
      }),
    );
    setProjectLifecycle(oracleSecondProject.id, { lifecycle: "inactive" });
    await stage(
      "Project Workspace inactivate Project",
      candidate.workspaceApply({
        operationId: "gate-c-workspace-inactivate-project",
        intent: {
          kind: "set_project_lifecycle",
          project_id: candidateSecondProjectId,
          lifecycle: "inactive",
        },
      }),
    );
    setProjectLifecycle(oracleCreatedProject.id, { lifecycle: "archived" });
    await stage(
      "Project Workspace archive Project",
      candidate.workspaceApply({
        operationId: "gate-c-workspace-archive-project",
        intent: {
          kind: "set_project_lifecycle",
          project_id: candidateProjectId,
          lifecycle: "archived",
        },
      }),
    );
    setProjectLifecycle(oracleCreatedProject.id, { lifecycle: "active" });
    await stage(
      "Project Workspace restore Project",
      candidate.workspaceApply({
        operationId: "gate-c-workspace-restore-project",
        intent: {
          kind: "set_project_lifecycle",
          project_id: candidateProjectId,
          lifecycle: "active",
        },
      }),
    );
    const candidateMutatedWorkspace = await stage(
      "Project Workspace mutated startup snapshot",
      candidate.workspaceRead({ kind: "startup" }),
    );
    if (candidateMutatedWorkspace.value.kind !== "startup") {
      throw new Error("Expected mutated Project Workspace startup snapshot");
    }
    const comparableProjectState = (
      project: {
        readonly lifecycle: string;
        readonly binding_revision?: number;
        readonly bindingRevision?: number;
        readonly name: string;
        readonly description: string;
        readonly icon?: string | null;
        readonly sources: readonly { readonly root: string; readonly order: number }[];
        readonly primary_workspace_root?: string | null;
        readonly primaryWorkspaceRoot?: string | null;
        readonly pinned: boolean;
        readonly pinned_order?: number | null;
        readonly pinnedOrder?: number | null;
      },
    ) => ({
      lifecycle: project.lifecycle,
      bindingRevision: project.binding_revision ?? project.bindingRevision,
      name: project.name,
      description: project.description,
      icon: project.icon || null,
      sources: project.sources,
      primaryWorkspaceRoot:
        project.primary_workspace_root ?? project.primaryWorkspaceRoot ?? null,
      pinned: project.pinned,
      pinnedOrder: project.pinned_order ?? project.pinnedOrder ?? null,
    });
    expect(candidateMutatedWorkspace.value.projects.map(comparableProjectState)).toEqual(
      listProjects().map(comparableProjectState),
    );

    await expect(candidate.shutdown()).resolves.toEqual({ status: "draining" });
    await expect(waitForExit(child)).resolves.toBe(0);
  });
});
