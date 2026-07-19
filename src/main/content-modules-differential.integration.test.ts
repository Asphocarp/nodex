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
  parseDataSourcePropertyId,
} from "../shared/database-identities";
import { DATABASE_MODULE_V2_CONTRACT_VERSION } from "../shared/database-module-v2";
import { LIBRARY_MODULE_CONTRACT_VERSION } from "../shared/library-module";
import { createUuidV7 } from "../shared/uuid-v7";
import { closeDatabase, getDb, initializeDatabase } from "./local-store/database";
import { createPage } from "./local-store/database-pages";
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
import { CoreClient, CoreModuleResponseError } from "./core-client/core-client";

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
      .filter(([key]) => key !== "createdAt" && key !== "updatedAt")
      .map(([key, entry]) => [key, withoutVolatileFields(entry)]),
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
    access_context: { kind: "library" },
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

    await expect(candidate.shutdown()).resolves.toEqual({ status: "draining" });
    await expect(waitForExit(child)).resolves.toBe(0);
  });
});
