import { describe, expect, test } from "vitest";
import { plainTextToPortableRichText } from "../../shared/block-documents";
import {
  buildCreateCardTransform,
  buildDeletePageTransform,
  buildMovePageTransform,
  buildPatchPageTransform,
  conflictKeysForCreate,
  conflictKeysForDelete,
  conflictKeysForMove,
  conflictKeysForPatch,
  createOptimisticCard,
} from "./kanban-optimistic-ops";
import type {
  BoardSummary,
  PageCreateInput,
  DatabasePageSummary,
} from "./types";
import { CoreApiError } from "./api";
import { testPropertySemantics } from "../../shared/testing/database-property-record";
import {
  createKanbanStoreRegistry,
  type KanbanStoreDependencies,
} from "./kanban-store";
import type { DatabaseViewGroupsSnapshot } from "../../shared/database-views";
import { toDatabasePageSummary } from "../../shared/page-summary";
import type { BoardChangeEvent } from "../../shared/ipc-api";
import type { ProjectionStreamMessage } from "../../shared/projection-stream";
import type { ResourceRevocationMessage } from "../../shared/resource-revocation-stream";
import { authorizedReadStampFixture } from "../../shared/testing/authorized-read-stamp-fixture";
import type { DatabaseViewWindowSnapshot } from "../../shared/database-views";
import {
  DATABASE_MODULE_V2_CONTRACT_VERSION,
  type DatabaseModuleReadResultV2,
  type DatabaseViewRecordV2,
  type DatabaseViewQueryResultV2,
} from "../../shared/database-module-v2";
import {
  parseDatabaseId,
  parseDatabaseViewId,
  parseDataSourceId,
  parseDataSourcePropertyId,
} from "../../shared/database-identities";
import { ProjectionInvalidationRegistry } from "./projection-invalidation-registry";

function createDatabaseViewSnapshot(
  viewId: string,
  title: string,
  isPrimary: boolean,
  commitSeq = 1,
): DatabaseModuleReadResultV2 {
  const projectId = "project-1";
  const libraryId = "library-1";
  const databaseId = parseDatabaseId("database-1");
  const dataSourceId = parseDataSourceId("source-1");
  const statusPropertyId = parseDataSourcePropertyId("status");
  const view: DatabaseViewRecordV2 = {
    viewId: parseDatabaseViewId(viewId),
    databaseId,
    dataSourceId,
    name: isPrimary ? "Primary" : "Focused",
    kind: "kanban" as const,
    config: {
      schemaKey: "nodex.database-view",
      schemaVersion: 2,
      filter: { kind: "group", operator: "and", children: [] },
      sort: [{
        field: { kind: "manual" },
        direction: "asc",
        nulls: "last",
      }],
      group: { propertyId: statusPropertyId },
      display: { propertyIds: [statusPropertyId], showTitle: true },
    },
    isDefault: isPrimary,
    revision: 1,
    rankKey: "a",
    lifecycle: "active",
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z",
  };
  const database = {
    databaseId,
    libraryId,
    name: "Tasks",
    lifecycle: "active" as const,
    defaultViewId: parseDatabaseViewId("view-primary"),
    accessRevision: 1,
    metadataRevision: 1,
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z",
  };
  const dataSource = {
    dataSourceId,
    libraryId,
    homeDatabaseId: databaseId,
    name: "Pages",
    schemaKey: "nodex.pages",
    schemaRevision: 1,
    lifecycle: "active" as const,
    rankKey: "a",
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z",
  };
  const statusProperty = {
    propertyId: statusPropertyId,
    dataSourceId,
    name: "Status",
    ...testPropertySemantics("select"),
    valueType: "select" as const,
    config: {},
    rankKey: "a",
    lifecycle: "active" as const,
    revision: 1,
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z",
  };
  const query: DatabaseViewQueryResultV2 = {
    database,
    dataSource,
    properties: [statusProperty],
    view,
    rows: [{
      membership: {
        membershipId: "membership-1",
        dataSourceId,
        revision: 1,
        createdAt: "2026-07-12T00:00:00.000Z",
      },
      page: {
        pageId: "card-1",
        libraryId,
        parent: { kind: "data_source" as const, dataSourceId },
        lifecycle: "active" as const,
        parentRevision: 1,
        metadataRevision: 1,
        documentId: "document-1",
        documentGeneration: 1,
        documentHeadSeq: 1,
        title,
        richTitle: plainTextToPortableRichText(title),
        preview: "",
        plainText: "",
        createdAt: "2026-07-12T00:00:00.000Z",
        updatedAt: "2026-07-12T00:00:00.000Z",
      },
      values: {
        [statusPropertyId]: {
          propertyId: statusPropertyId,
          valueType: "select" as const,
          value: "triage",
          revision: 1,
        },
      },
      position: { groupKey: "triage", rankKey: "a", revision: 1 },
      effectiveGroupKey: "triage",
    }],
  };
  return {
    ok: true,
    value: {
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      projectId,
      libraryId,
      storeEpoch: "epoch-1",
      commitSeq,
      authorization: null,
      value: { kind: "query", value: query },
    },
  };
}

function createPageSummary(title = "Initial title"): DatabasePageSummary {
  return {
    id: "card-1",
    status: "triage",
    archived: false,
    title,
    richTitle: plainTextToPortableRichText(title),
    descriptionPreview: "Initial description",
    descriptionLength: "Initial description".length,
    hasDescription: true,
    priority: "p2-medium",
    estimate: "m",
    tags: [],
    revision: 1,
    created: new Date("2026-02-16T00:00:00.000Z"),
    order: 0,
  };
}

function createBoard(title = "Initial title"): BoardSummary {
  return {
    columns: [
      {
        id: "triage",
        name: "Ideas",
        cards: [createPageSummary(title)],
      },
      {
        id: "ship",
        name: "Ship",
        cards: [],
      },
    ],
  };
}

function createBoardSnapshot(
  board: BoardSummary = createBoard(),
  commitSeq = 1,
  viewId = "view-primary",
  primary = true,
  projectionRevision = 1,
): DatabaseViewWindowSnapshot {
  const card = board.columns.flatMap((column) => column.cards)[0]
    ?? createPageSummary();
  const queryResult = createDatabaseViewSnapshot(
    viewId,
    card.title,
    primary,
    commitSeq,
  );
  if (!queryResult.ok || queryResult.value.value.kind !== "query") {
    throw new Error("Database View test fixture is invalid");
  }
  const query = {
    ...queryResult.value.value.value,
    rows: queryResult.value.value.value.rows.map((row) => ({
      ...row,
      page: {
        ...row.page,
        pageId: card.id,
        title: card.title,
        richTitle: card.richTitle,
        preview: card.descriptionPreview,
        plainText: card.descriptionPreview,
      },
    })),
  };
  return {
    projectId: "project-1",
    libraryId: "library-1",
    databaseId: "database-1",
    dataSourceId: "source-1",
    viewId,
    storeEpoch: "epoch-1",
    commitSeq,
    authorization: authorizedReadStampFixture({
      deliveryAddress: {
        kind: "project",
        library_id: "library-1",
        project_id: "project-1",
      },
      subject: { kind: "view", view_id: viewId },
      storeEpoch: "epoch-1",
      commitSeq,
      authorizationDependencies: [
        { kind: "page", page_id: card.id },
        { kind: "view", view_id: viewId },
      ],
    }),
    projection: {
      scopeKey: `scope:${viewId}`,
      schemaVersion: 1,
      revision: projectionRevision,
      coveredCommitSeq: commitSeq,
      effectHash: projectionRevision > 0
        ? String(projectionRevision).padStart(64, "a").slice(-64)
        : null,
    },
    nextCursor: null,
    rows: [{
      page: card,
      groupKey: card.status,
      rankKey: "a",
    }],
    board,
    query,
    view: {
      id: viewId,
      databaseBlockId: "database-1",
      projectId: "project-1",
      name: query.view.name,
      kind: query.view.kind,
      config: query.view.config as never,
      isPrimary: primary,
      createdAt: query.view.createdAt,
      updatedAt: query.view.updatedAt,
    },
  };
}

function createGroupsSnapshot(
  overrides: Partial<DatabaseViewGroupsSnapshot> = {},
): DatabaseViewGroupsSnapshot {
  const snapshot = {
    projectId: "project-1",
    libraryId: "library-1",
    databaseId: "database-1",
    dataSourceId: "source-1",
    viewId: "view-primary",
    storeEpoch: "epoch-1",
    commitSeq: 1,
    projection: {
      scopeKey: "scope:view-primary",
      schemaVersion: 1,
      revision: 1,
      coveredCommitSeq: 1,
      effectHash: "1".padStart(64, "a"),
    },
    grouped: false,
    totalRows: 1,
    truncated: false,
    groups: [],
    ...overrides,
  };
  return {
    ...snapshot,
    authorization: overrides.authorization ?? authorizedReadStampFixture({
      deliveryAddress: {
        kind: "project",
        library_id: snapshot.libraryId,
        project_id: snapshot.projectId,
      },
      subject: { kind: "view", view_id: snapshot.viewId },
      storeEpoch: snapshot.storeEpoch,
      commitSeq: snapshot.commitSeq,
    }),
  };
}

/**
 * Test registry with an ungrouped groups read by default, which keeps the
 * store on the single flat window path most tests exercise.
 */
function createTestRegistry(
  dependencies: Partial<KanbanStoreDependencies> = {},
) {
  return createKanbanStoreRegistry({
    getProjectionInvalidationRegistry: () => null,
    readViewGroups: async (_projectId, input) => {
      const viewId = input.databaseViewId ?? "view-primary";
      const revision = input.minimumCommitSeq ?? 1;
      return createGroupsSnapshot({
        viewId,
        commitSeq: revision,
        projection: {
          scopeKey: `scope:${viewId}`,
          schemaVersion: 1,
          revision,
          coveredCommitSeq: revision,
          effectHash: String(revision).padStart(64, "a").slice(-64),
        },
      });
    },
    ...dependencies,
  });
}

function createProjectionHarness() {
  const projectionListeners = new Set<(message: ProjectionStreamMessage) => void>();
  const revocationListeners = new Set<(message: ResourceRevocationMessage) => void>();
  let latestMessage: ProjectionStreamMessage | ResourceRevocationMessage | null = null;
  const registry = new ProjectionInvalidationRegistry({
    subscribeProjection: (scope, listener) => {
      projectionListeners.add(listener);
      if (latestMessage) {
        listener({
          version: 2,
          kind: "checkpoint",
          scope,
          stream: latestMessage.stream,
        });
      }
      return () => projectionListeners.delete(listener);
    },
    subscribeRevocations: (_scope, listener) => {
      revocationListeners.add(listener);
      return () => revocationListeners.delete(listener);
    },
  });
  return {
    getRegistry: () => registry,
    publish: (message: ProjectionStreamMessage | ResourceRevocationMessage) => {
      latestMessage = message;
      if (message.version === 1) {
        for (const listener of revocationListeners) listener(message);
        return;
      }
      for (const listener of projectionListeners) listener(message);
    },
  };
}

function pageChanged(
  commitSeq: number,
  pageId = "card-1",
  viewId = "view-primary",
): ProjectionStreamMessage {
  return {
    version: 2,
    kind: "effect",
    scope: {
      kind: "project",
      libraryId: "library-1",
      projectId: "project-1",
    },
    stream: { storeEpoch: "epoch-1", commitSeq },
    delivery: {
      storeEpoch: "epoch-1",
      commitSeq,
      manifestHash: String(commitSeq).padStart(64, "b").slice(-64),
      operationId: `operation-${commitSeq}`,
      committedAt: "2026-08-06T00:00:00.000Z",
      impact: {
        kind: "resources",
        page_ids: [pageId],
        database_ids: ["database-1"],
        data_source_ids: ["source-1"],
        view_ids: ["view-focused", "view-primary"],
        document_heads: [{
          page_id: pageId,
          document_id: "document-1",
          generation: 1,
          head_seq: commitSeq,
        }],
      },
      effect: {
        scope: {
          schema_version: 1,
          canonical_key: `scope:${viewId}`,
          scope: {
            kind: "database_view",
            project_id: "project-1",
            database_id: "database-1",
            data_source_id: "source-1",
            view_id: viewId,
          },
        },
        baseRevision: Math.max(0, commitSeq - 1),
        resultRevision: commitSeq,
        coveredCommitSeq: commitSeq,
        patch: null,
        requiresReadAtLeast: true,
        effectHash: String(commitSeq).padStart(64, "a").slice(-64),
      },
    },
  };
}

function pageRemoved(commitSeq: number, pageId: string): ProjectionStreamMessage {
  const message = pageChanged(commitSeq, pageId);
  if (message.kind !== "effect") throw new Error("Projection fixture is invalid");
  return {
    ...message,
    delivery: {
      ...message.delivery,
      effect: {
        ...message.delivery.effect,
        patch: {
          kind: "database_row_remove",
          projectId: "project-1",
          databaseId: "database-1",
          dataSourceId: "source-1",
          viewId: "view-primary",
          pageId,
          totalRows: 0,
          groupKey: "triage",
          groupTotal: 0,
        },
      },
    },
  };
}

function pageRevoked(
  commitSeq: number,
  pageId: string,
): ResourceRevocationMessage {
  return {
    version: 1,
    kind: "revocation",
    scope: {
      kind: "project",
      libraryId: "library-1",
      projectId: "project-1",
    },
    stream: { storeEpoch: "epoch-1", commitSeq },
    delivery: {
      storeEpoch: "epoch-1",
      commitSeq,
      manifestHash: String(commitSeq).padStart(64, "b").slice(-64),
      operationId: `operation-${commitSeq}`,
      committedAt: "2026-08-06T00:00:00.000Z",
      revocation: {
        authorization_scope: {
          kind: "project",
          library_id: "library-1",
          project_id: "project-1",
        },
        resource_kind: "page",
        resource_id: pageId,
        reason: "ownership_moved",
      },
    },
  };
}

function pageUpserted(
  commitSeq: number,
  page: DatabasePageSummary,
): ProjectionStreamMessage {
  const message = pageChanged(commitSeq, page.id);
  if (message.kind !== "effect") throw new Error("Projection fixture is invalid");
  return {
    ...message,
    delivery: {
      ...message.delivery,
      effect: {
        ...message.delivery.effect,
        patch: {
          kind: "database_row_upsert",
          projectId: "project-1",
          databaseId: "database-1",
          dataSourceId: "source-1",
          viewId: "view-primary",
          row: page,
          sourceRow: {
            page_id: page.id,
            lifecycle: "active",
            title: page.title,
            rich_title: page.richTitle,
            description_preview: page.descriptionPreview,
            description_length: page.descriptionPreview.length,
            has_description: page.descriptionPreview.length > 0,
            database_values: { status: page.status },
            intrinsic_properties: {},
            database_value_revisions: { status: 1 },
            metadata_revision: page.revision ?? 1,
            parent_revision: 1,
            document_id: `document:${page.id}`,
            document_generation: 1,
            document_head_seq: 1,
            membership_id: `membership:${page.id}`,
            membership_revision: 1,
            membership_created_at: "2026-08-06T00:00:00.000Z",
            created_at: "2026-08-06T00:00:00.000Z",
            updated_at: "2026-08-06T00:00:00.000Z",
            effective_group_key: page.status,
            rank_key: "b",
            position_revision: 1,
          },
          effectiveGroupKey: page.status,
          rankKey: "b",
          totalRows: 2,
          groupTotal: 2,
        },
      },
    },
  };
}

function cloneBoard(board: BoardSummary): BoardSummary {
  return {
    ...board,
    columns: board.columns.map((column) => ({
      ...column,
      cards: column.cards.map((card) => ({ ...card })),
    })),
  };
}

function waitForMicrotasks(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(() => resolve(), 0);
  });
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolveFn, rejectFn) => {
    resolve = resolveFn;
    reject = rejectFn;
  });
  return {
    promise,
    resolve,
    reject,
  };
}

describe("kanban store", () => {
  test("isolates durable View stores and never reads primary Board data for a secondary View", async () => {
    const calls: string[] = [];
    const registry = createTestRegistry({
      readViewWindow: async (projectId, input) => {
        const viewId = input.databaseViewId ?? "view-primary";
        calls.push(`database:view-window:get:${projectId}:${viewId}`);
        return createBoardSnapshot(
          createBoard(
            viewId === "view-focused"
              ? "Focused query row"
              : "Full primary Card summary",
          ),
          1,
          viewId,
          viewId === "view-primary",
        );
      },
      subscribeBoardChanges: () => () => {},
    });
    const primary = registry.getStore("project-1", "view-primary");
    const focused = registry.getStore("project-1", "view-focused");

    await Promise.all([primary.fetchBoard(), focused.fetchBoard()]);

    expect(primary === focused).toBe(false);
    expect(primary.getSnapshot().databaseView?.databaseViewId).toBe(
      "view-primary",
    );
    expect(primary.getSnapshot().pageIndex.get("card-1")?.title).toBe(
      "Full primary Card summary",
    );
    expect(focused.getSnapshot().databaseView?.databaseViewId).toBe(
      "view-focused",
    );
    expect(focused.getSnapshot().databaseView?.columns[0]?.rows[0]?.title).toBe(
      "Focused query row",
    );
    expect(focused.getSnapshot().board).not.toBe(null);
    expect(
      calls.filter((call) => call.startsWith("database:view-window:get")).length,
    ).toBe(2);
    const callsBeforeFreshEnsure = calls.length;
    await focused.ensureFreshBoard();
    expect(calls.length).toBe(callsBeforeFreshEnsure);
    expect(focused.getSnapshot().loading).toBe(false);
  });

  test("repairs each independent Board scope consumer from one effect", async () => {
    const projection = createProjectionHarness();
    let fetchCount = 0;
    const makeRegistry = () =>
      createTestRegistry({
        readViewWindow: async () => {
          fetchCount += 1;
          const revision = fetchCount <= 2 ? 1 : 8;
          return createBoardSnapshot(createBoard(), revision, "view-primary", true, revision);
        },
        subscribeBoardChanges: () => () => {},
        getProjectionInvalidationRegistry: projection.getRegistry,
      });
    const firstStore = makeRegistry().getStore("project-1");
    const secondStore = makeRegistry().getStore("project-1");
    const unsubscribeFirst = firstStore.subscribe(() => {});
    const unsubscribeSecond = secondStore.subscribe(() => {});
    await waitForMicrotasks();
    expect(fetchCount).toBe(2);

    projection.publish(pageChanged(8));
    await waitForMicrotasks();
    await waitForMicrotasks();

    expect(fetchCount).toBe(4);
    unsubscribeFirst();
    unsubscribeSecond();
  });

  test("refreshes a durable Database View from a matching Page Document event", async () => {
    const projection = createProjectionHarness();
    let readCount = 0;
    const registry = createTestRegistry({
      readViewWindow: async () => {
        readCount += 1;
        return createBoardSnapshot(
          createBoard(
            readCount === 1 ? "Before Document edit" : "After Document edit",
          ),
          readCount === 1 ? 1 : 9,
          "view-focused",
          false,
          readCount === 1 ? 1 : 9,
        );
      },
      subscribeBoardChanges: () => () => {},
      getProjectionInvalidationRegistry: projection.getRegistry,
    });
    const store = registry.getStore("project-1", "view-focused");
    const unsubscribe = store.subscribe(() => {});
    await waitForMicrotasks();
    expect(store.getSnapshot().databaseView?.columns[0]?.rows[0]?.title).toBe(
      "Before Document edit",
    );

    projection.publish(pageChanged(
      9,
      "card-filtered-out-before-title-change",
      "view-focused",
    ));
    await waitForMicrotasks();

    expect(readCount).toBe(2);
    expect(store.getSnapshot().databaseView?.columns[0]?.rows[0]?.title).toBe(
      "After Document edit",
    );
    unsubscribe();
  });

  test("runs one trailing read when a Page invalidation arrives during a fetch", async () => {
    const firstRead = createDeferred<DatabaseViewWindowSnapshot>();
    const projection = createProjectionHarness();
    let readCount = 0;
    const registry = createTestRegistry({
      readViewWindow: async () => {
        readCount += 1;
        if (readCount === 1) return await firstRead.promise;
        return createBoardSnapshot(
          createBoard("Latest head"),
          10,
          "view-focused",
          false,
          10,
        );
      },
      subscribeBoardChanges: () => () => {},
      getProjectionInvalidationRegistry: projection.getRegistry,
    });
    const store = registry.getStore("project-1", "view-focused");
    const unsubscribe = store.subscribe(() => {});

    projection.publish(pageChanged(10, "card-1", "view-focused"));
    firstRead.resolve(createBoardSnapshot(
      createBoard("Stale in-flight head"),
      1,
      "view-focused",
      false,
    ));
    await waitForMicrotasks();
    await waitForMicrotasks();

    expect(readCount).toBe(2);
    expect(store.getSnapshot().databaseView?.columns[0]?.rows[0]?.title).toBe(
      "Latest head",
    );
    unsubscribe();
  });

  test("registers a single board-change subscription for multiple listeners", async () => {
    const board = createBoard();
    let subscribeCalls = 0;
    let unsubscribeCalls = 0;

    const registry = createTestRegistry({
      readViewWindow: async () => createBoardSnapshot(board),
      subscribeBoardChanges: () => {
        subscribeCalls += 1;
        return () => {
          unsubscribeCalls += 1;
        };
      },
    });

    const store = registry.getStore("default");
    const unsubscribeFirst = store.subscribe(() => {});
    const unsubscribeSecond = store.subscribe(() => {});
    await waitForMicrotasks();

    expect(subscribeCalls).toBe(1);

    unsubscribeFirst();
    expect(unsubscribeCalls).toBe(0);

    unsubscribeSecond();
    expect(unsubscribeCalls).toBe(1);
  });

  test("dedupes in-flight board fetches", async () => {
    const board = createBoard();
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let groupsReads = 0;
    let windowReads = 0;

    const registry = createTestRegistry({
      readViewGroups: async () => {
        groupsReads += 1;
        await released;
        return createGroupsSnapshot();
      },
      readViewWindow: async () => {
        windowReads += 1;
        return createBoardSnapshot(board);
      },
      subscribeBoardChanges: () => () => {},
    });

    const store = registry.getStore("default");
    const firstFetch = store.fetchBoard();
    const secondFetch = store.fetchBoard();

    expect(groupsReads).toBe(1);

    release();
    await Promise.all([firstFetch, secondFetch]);
    expect(groupsReads).toBe(1);
    expect(windowReads).toBe(1);
  });

  test("refreshBoard fetches again after an in-flight fetch settles", async () => {
    const initialBoard = createBoard("Initial");
    const refreshedBoard = createBoard("Refreshed");
    let release!: () => void;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    let windowReads = 0;

    const registry = createTestRegistry({
      readViewWindow: async () => {
        windowReads += 1;
        if (windowReads === 1) {
          await released;
          return createBoardSnapshot(initialBoard);
        }
        return createBoardSnapshot(refreshedBoard, 2);
      },
      subscribeBoardChanges: () => () => {},
    });

    const store = registry.getStore("default");
    const firstFetch = store.fetchBoard();
    const refreshPromise = store.refreshBoard();

    release();
    await Promise.all([firstFetch, refreshPromise]);

    expect(windowReads).toBe(2);
    expect(store.getSnapshot().pageIndex.get("card-1")?.title).toBe("Refreshed");
  });

  test("fetchBoard reads the bounded window and keeps full descriptions out of snapshots", async () => {
    const board = createBoard();
    let windowReads = 0;

    const registry = createTestRegistry({
      readViewWindow: async () => {
        windowReads += 1;
        return createBoardSnapshot(board);
      },
      subscribeBoardChanges: () => () => {},
    });

    const store = registry.getStore("default");
    await store.fetchBoard();

    const indexedPage = store.getSnapshot().pageIndex.get("card-1");
    expect(windowReads).toBe(1);
    expect(Object.hasOwn(indexedPage ?? {}, "description")).toBe(false);
    expect(indexedPage?.descriptionPreview).toBe("Initial description");
  });

  test("retries instead of composing groups and windows from different projection revisions", async () => {
    let groupReads = 0;
    let windowReads = 0;
    const authority = (revision: number) => ({
      scopeKey: "scope:view-primary",
      schemaVersion: 1,
      revision,
      coveredCommitSeq: revision,
      effectHash: String(revision).padStart(64, "a").slice(-64),
    });
    const registry = createTestRegistry({
      readViewGroups: async () => {
        groupReads += 1;
        const revision = groupReads === 1 ? 1 : 2;
        return createGroupsSnapshot({
          commitSeq: revision,
          projection: authority(revision),
        });
      },
      readViewWindow: async () => {
        windowReads += 1;
        return createBoardSnapshot(
          createBoard("Consistent head"),
          2,
          "view-primary",
          true,
          2,
        );
      },
      subscribeBoardChanges: () => () => {},
    });

    const store = registry.getStore("project-1");
    await store.fetchBoard();

    expect(groupReads).toBe(2);
    expect(windowReads).toBe(2);
    expect(store.getSnapshot().pageIndex.get("card-1")?.title).toBe(
      "Consistent head",
    );
  });

  test("appends a real continuation window without duplicating loaded rows", async () => {
    const first = {
      ...createBoardSnapshot(createBoard("First")),
      nextCursor: "cursor-1",
    };
    const secondCard = {
      ...createPageSummary("Second"),
      id: "card-2",
      order: 1,
    };
    const second = createBoardSnapshot({
      columns: [
        { id: "triage", name: "Ideas", cards: [secondCard] },
        { id: "ship", name: "Ship", cards: [] },
      ],
    });
    const requests: unknown[] = [];
    const registry = createTestRegistry({
      readViewWindow: async (_projectId, request) => {
        requests.push(request);
        return requests.length === 1 ? first : second;
      },
      subscribeBoardChanges: () => () => {},
    });
    const store = registry.getStore("project-1");

    await store.fetchBoard();
    expect(store.getSnapshot().hasMore).toBe(true);
    await store.loadMore();

    expect(requests).toEqual([
      { first: 50 },
      { after: "cursor-1", first: 50, minimumCommitSeq: 1 },
    ]);
    expect([...store.getSnapshot().pageIndex.keys()]).toEqual([
      "card-1",
      "card-2",
    ]);
    expect(store.getSnapshot().hasMore).toBe(false);
  });

  test("a rejected continuation converges silently from the first window", async () => {
    const first = {
      ...createBoardSnapshot(createBoard("First")),
      nextCursor: "cursor-1",
    };
    const recovered = createBoardSnapshot(createBoard("Recovered"), 2);
    const requests: unknown[] = [];
    const registry = createTestRegistry({
      readViewWindow: async (_projectId, request) => {
        requests.push(request);
        if (requests.length === 2) {
          throw new CoreApiError({
            code: "stale_store_epoch",
            message: "Collection cursor belongs to another Store epoch",
            retryable: false,
          });
        }
        return requests.length === 1 ? first : recovered;
      },
      subscribeBoardChanges: () => () => {},
    });
    const store = registry.getStore("project-1");

    await store.fetchBoard();
    expect(store.getSnapshot().hasMore).toBe(true);
    await store.loadMore();

    expect(requests).toEqual([
      { first: 50 },
      { after: "cursor-1", first: 50, minimumCommitSeq: 1 },
      { first: 50, minimumCommitSeq: 1 },
    ]);
    expect(store.getSnapshot().error).toBe(null);
    expect(store.getSnapshot().loadingMore).toBe(false);
    expect(store.getSnapshot().hasMore).toBe(false);
    expect(store.getSnapshot().pageIndex.get("card-1")?.title).toBe("Recovered");
  });

  test("grouped boards page each column independently with scoped continuations", async () => {
    const triageCards = [0, 1].map((index) => ({
      ...createPageSummary(`Triage ${index}`),
      id: `triage-${index}`,
      order: index,
    }));
    const shipCard = {
      ...createPageSummary("Ship 0"),
      id: "ship-0",
      status: "ship" as const,
      order: 0,
    };
    const windowFor = (
      cards: readonly DatabasePageSummary[],
      columnId: string,
      nextCursor: string | null,
    ): DatabaseViewWindowSnapshot => ({
      ...createBoardSnapshot({
        columns: [
          { id: "triage", name: "Ideas", cards: columnId === "triage" ? [...cards] : [] },
          { id: "ship", name: "Ship", cards: columnId === "ship" ? [...cards] : [] },
        ],
      }),
      nextCursor,
      rows: cards.map((card, index) => ({
        page: card,
        groupKey: columnId,
        rankKey: String(index),
      })),
    });
    const requests: Array<{ groupScope?: unknown; after?: string; first?: number }> = [];
    const registry = createTestRegistry({
      readViewGroups: async () => createGroupsSnapshot({
        grouped: true,
        totalRows: 4,
        groups: [
          { groupKey: "ship", totalRows: 1 },
          { groupKey: "triage", totalRows: 3 },
        ],
      }),
      readViewWindow: async (_projectId, request) => {
        requests.push(request);
        const key = request.groupScope?.kind === "key"
          ? request.groupScope.key
          : "unassigned";
        if (key === "ship") return windowFor([shipCard], "ship", null);
        if (request.after === "triage-cursor") {
          return windowFor(
            [{ ...createPageSummary("Triage 2"), id: "triage-2", order: 2 }],
            "triage",
            null,
          );
        }
        return windowFor(triageCards, "triage", "triage-cursor");
      },
      subscribeBoardChanges: () => () => {},
    });
    const store = registry.getStore("project-1");

    await store.fetchBoard();

    expect(store.getSnapshot().totalRows).toBe(4);
    const triagePagination = store.getSnapshot().groupPagination.get("key:triage");
    expect(triagePagination).toMatchObject({
      loadedRows: 2,
      totalRows: 3,
      hasMore: true,
      loadingMore: false,
    });
    expect(store.getSnapshot().groupPagination.get("key:ship")).toMatchObject({
      loadedRows: 1,
      totalRows: 1,
      hasMore: false,
    });

    await store.loadMoreGroup("key:triage");

    expect(requests.filter((request) => request.after).length).toBe(1);
    expect(requests.find((request) => request.after)).toMatchObject({
      after: "triage-cursor",
      groupScope: { kind: "key", key: "triage" },
    });
    expect([...store.getSnapshot().pageIndex.keys()].sort()).toEqual([
      "ship-0",
      "triage-0",
      "triage-1",
      "triage-2",
    ]);
    expect(
      store.getSnapshot().groupPagination.get("key:triage")?.hasMore,
    ).toBe(false);
  });

  test("a refresh re-reads the loaded span instead of resetting to one window", async () => {
    const cards = (count: number) => Array.from({ length: count }, (_, index) => ({
      ...createPageSummary(`Card ${index}`),
      id: `card-${index}`,
      order: index,
    }));
    const windowOf = (
      loaded: DatabasePageSummary[],
      nextCursor: string | null,
      commitSeq = 1,
    ): DatabaseViewWindowSnapshot => ({
      ...createBoardSnapshot(
        {
          columns: [
            { id: "triage", name: "Ideas", cards: loaded },
            { id: "ship", name: "Ship", cards: [] },
          ],
        },
        commitSeq,
      ),
      nextCursor,
      rows: loaded.map((card, index) => ({
        page: card,
        groupKey: "triage",
        rankKey: String(index).padStart(4, "0"),
      })),
    });
    const requests: Array<{ after?: string; first?: number }> = [];
    const all = cards(80);
    const registry = createTestRegistry({
      readViewWindow: async (_projectId, request) => {
        requests.push(request);
        if (request.after === "cursor-50") {
          return windowOf(all.slice(50, 80), null);
        }
        const first = request.first ?? 50;
        return windowOf(
          all.slice(0, Math.min(first, all.length)),
          first < 80 ? "cursor-50" : null,
          requests.length,
        );
      },
      subscribeBoardChanges: () => () => {},
    });
    const store = registry.getStore("project-1");

    await store.fetchBoard();
    await store.loadMore();
    expect(store.getSnapshot().pageIndex.size).toBe(80);

    await store.refreshBoard();

    expect(requests.at(-1)).toMatchObject({ first: 80 });
    expect(store.getSnapshot().pageIndex.size).toBe(80);
  });

  test("a transport failure keeps the board and reports an inline group error", async () => {
    const first = {
      ...createBoardSnapshot(createBoard("First")),
      nextCursor: "cursor-1",
    };
    let windowReads = 0;
    const registry = createTestRegistry({
      readViewWindow: async () => {
        windowReads += 1;
        if (windowReads === 2) {
          throw new Error("Core is unavailable");
        }
        return first;
      },
      subscribeBoardChanges: () => () => {},
    });
    const store = registry.getStore("project-1");

    await store.fetchBoard();
    await store.loadMore();

    expect(windowReads).toBe(2);
    expect(store.getSnapshot().error).toBe(null);
    expect(store.getSnapshot().board).not.toBe(null);
    const pagination = store.getSnapshot().groupPagination.get("all");
    expect(pagination?.error).toBe("Core is unavailable");
    // The continuation is retained so the user can retry the same group.
    expect(pagination?.hasMore).toBe(true);
  });

  test("first subscribe with a fresh base board does not refetch", async () => {
    const board = createBoard();
    let invokeCalls = 0;
    let currentTime = 1_000;

    const registry = createTestRegistry({
      readViewWindow: async () => {
        invokeCalls += 1;
        return createBoardSnapshot(board);
      },
      subscribeBoardChanges: () => () => {},
      now: () => currentTime,
    });

    const store = registry.getStore("default");
    await store.fetchBoard();
    expect(invokeCalls).toBe(1);

    currentTime = 2_000;
    const unsubscribe = store.subscribe(() => {});
    await waitForMicrotasks();

    expect(invokeCalls).toBe(1);
    unsubscribe();
  });

  test("stale subscribe refreshes in the background without clearing the current board", async () => {
    const boards = [createBoard("Initial"), createBoard("Refreshed")];
    let invokeCalls = 0;
    let currentTime = 1_000;

    const registry = createTestRegistry({
      readViewWindow: async () => {
        const board = boards[invokeCalls] ?? boards[boards.length - 1]!;
        invokeCalls += 1;
        return createBoardSnapshot(board, invokeCalls);
      },
      subscribeBoardChanges: () => () => {},
      now: () => currentTime,
    });

    const store = registry.getStore("default");
    await store.fetchBoard();
    expect(store.getSnapshot().pageIndex.get("card-1")?.title).toBe("Initial");

    currentTime = 32_000;
    const unsubscribe = store.subscribe(() => {});
    expect(store.getSnapshot().pageIndex.get("card-1")?.title).toBe("Initial");

    await waitForMicrotasks();
    expect(invokeCalls).toBe(2);
    expect(store.getSnapshot().pageIndex.get("card-1")?.title).toBe("Refreshed");
    unsubscribe();
  });

  test("force ensureFreshBoard refreshes even when the board is fresh", async () => {
    const boards = [createBoard("Initial"), createBoard("Forced")];
    let invokeCalls = 0;

    const registry = createTestRegistry({
      readViewWindow: async () => {
        const board = boards[invokeCalls] ?? boards[boards.length - 1]!;
        invokeCalls += 1;
        return createBoardSnapshot(board, invokeCalls);
      },
      subscribeBoardChanges: () => () => {},
      now: () => 1_000,
    });

    const store = registry.getStore("default");
    await store.fetchBoard();
    await store.ensureFreshBoard({ force: true });

    expect(invokeCalls).toBe(2);
    expect(store.getSnapshot().pageIndex.get("card-1")?.title).toBe("Forced");
  });

  test("summary patch events update the board without a broad refetch", async () => {
    const callbacks: { onBoardChange?: (event: BoardChangeEvent) => void } = {};
    let boardFetchCount = 0;

    const registry = createTestRegistry({
      readViewWindow: async () => {
        boardFetchCount += 1;
        return createBoardSnapshot();
      },
      subscribeBoardChanges: (_projectId, callback) => {
        callbacks.onBoardChange = callback;
        return () => {};
      },
    });

    const store = registry.getStore("default");
    const unsubscribe = store.subscribe(() => {});
    await waitForMicrotasks();

    callbacks.onBoardChange?.({
      projectId: "default",
      changeType: "update",
      columnId: "triage",
      status: "triage",
      pageId: "card-1",
      summary: createPageSummary("Patched from event"),
      storeEpoch: "epoch-1",
      commitSeq: 2,
    });
    await waitForMicrotasks();

    expect(boardFetchCount).toBe(1);
    expect(store.getSnapshot().pageIndex.get("card-1")?.title).toBe("Patched from event");
    unsubscribe();
  });

  test("applies local optimistic overlays to board and card index", async () => {
    const board = createBoard();
    const registry = createTestRegistry({
      readViewWindow: async () => createBoardSnapshot(board),
      subscribeBoardChanges: () => () => {},
    });

    const store = registry.getStore("default");
    await store.fetchBoard();

    let notifications = 0;
    const unsubscribe = store.subscribe(() => {
      notifications += 1;
    });
    await waitForMicrotasks();
    notifications = 0;

    store.applyLocalPatch("triage", "card-1", {
      title: "Updated title",
    });

    const snapshot = store.getSnapshot();
    expect(snapshot.board?.columns[0]?.cards[0]?.title).toBe("Updated title");
    expect(snapshot.pageIndex.get("card-1")?.title).toBe("Updated title");
    expect(notifications).toBe(1);

    unsubscribe();
  });

  test("merges full remote card updates as summaries without storing the body", async () => {
    const registry = createTestRegistry({
      readViewWindow: async () => createBoardSnapshot(),
      subscribeBoardChanges: () => () => {},
    });

    const store = registry.getStore("default");
    await store.fetchBoard();

    store.applyRemoteCard({
      id: "card-1",
      status: "triage",
      archived: false,
      title: "Remote title",
      richTitle: plainTextToPortableRichText("Remote title"),
      description: "Remote full body that should only become preview metadata",
      tags: [],
      revision: 2,
      created: new Date("2026-02-16T00:00:00.000Z"),
      order: 0,
    });

    const indexedPage = store.getSnapshot().pageIndex.get("card-1");
    const summary = toDatabasePageSummary({
      id: "card-1",
      status: "triage",
      archived: false,
      title: "Remote title",
      richTitle: plainTextToPortableRichText("Remote title"),
      description: "Remote full body that should only become preview metadata",
      tags: [],
      revision: 2,
      created: new Date("2026-02-16T00:00:00.000Z"),
      order: 0,
    });

    expect(indexedPage?.title).toBe("Remote title");
    expect(indexedPage?.descriptionPreview).toBe(summary.descriptionPreview);
    expect(indexedPage?.descriptionLength).toBe(summary.descriptionLength);
    expect(Object.hasOwn(indexedPage ?? {}, "description")).toBe(false);
  });

  test("merges remote card summary acknowledgements without a full body", async () => {
    const registry = createTestRegistry({
      readViewWindow: async () => createBoardSnapshot(),
      subscribeBoardChanges: () => () => {},
    });

    const store = registry.getStore("default");
    await store.fetchBoard();

    store.applyRemoteCardSummary({
      id: "card-1",
      status: "triage",
      archived: false,
      title: "Ack title",
      richTitle: plainTextToPortableRichText("Ack title"),
      tags: [],
      revision: 2,
      created: new Date("2026-02-16T00:00:00.000Z"),
      order: 0,
      descriptionPreview: "Ack preview",
      descriptionLength: 128,
      hasDescription: true,
    });

    const indexedPage = store.getSnapshot().pageIndex.get("card-1");
    expect(indexedPage?.title).toBe("Ack title");
    expect(indexedPage?.descriptionPreview).toBe("Ack preview");
    expect(indexedPage?.descriptionLength).toBe(128);
    expect(Object.hasOwn(indexedPage ?? {}, "description")).toBe(false);
  });

  test("rejects a stale direct projection delta after a newer row read", async () => {
    const registry = createTestRegistry({
      readViewWindow: async () => createBoardSnapshot(),
      subscribeBoardChanges: () => () => {},
    });
    const store = registry.getStore("default");
    await store.fetchBoard();

    store.applyRemoteCardSummary(
      {
        ...createPageSummary("Newer title"),
        revision: 2,
      },
      { storeEpoch: "epoch-1", commitSeq: 8 },
    );
    store.applyRemoteCardSummary(
      {
        ...createPageSummary("Delayed older title"),
        revision: 1,
      },
      { storeEpoch: "epoch-1", commitSeq: 7 },
    );

    expect(store.getSnapshot().pageIndex.get("card-1")?.title).toBe(
      "Newer title",
    );
  });

  test("shows a newly promoted Page in the loaded Board before projection refresh", async () => {
    const registry = createTestRegistry({
      readViewWindow: async () => createBoardSnapshot(),
      subscribeBoardChanges: () => () => {},
    });
    const store = registry.getStore("default");
    await store.fetchBoard();

    store.applyRemoteCardSummary(
      {
        ...createPageSummary("Promoted title"),
        id: "page-promoted",
        order: 1,
      },
      { storeEpoch: "epoch-1", commitSeq: 2 },
    );

    const snapshot = store.getSnapshot();
    expect(snapshot.pageIndex.get("page-promoted")?.title).toBe(
      "Promoted title",
    );
    expect(
      snapshot.board?.columns
        .find((column) => column.id === "triage")
        ?.cards.map((card) => card.id),
    ).toEqual(["card-1", "page-promoted"]);
  });

  test("applies a promoted Page effect before a delayed canonical repair", async () => {
    const projection = createProjectionHarness();
    const delayedRepair = createDeferred<DatabaseViewWindowSnapshot>();
    let readCount = 0;
    const registry = createTestRegistry({
      readViewWindow: async () => {
        readCount += 1;
        if (readCount === 1) return createBoardSnapshot();
        return await delayedRepair.promise;
      },
      subscribeBoardChanges: () => () => {},
      getProjectionInvalidationRegistry: projection.getRegistry,
    });
    const store = registry.getStore("project-1");
    const release = store.subscribe(() => {});
    await waitForMicrotasks();
    const promoted = {
      ...createPageSummary("Promoted immediately"),
      id: "page-promoted",
      order: 1,
    };

    projection.publish(pageUpserted(2, promoted));

    expect(store.getSnapshot().pageIndex.get("page-promoted")?.title).toBe(
      "Promoted immediately",
    );
    expect(
      store.getSnapshot().databaseView?.columns
        .flatMap((column) => column.rows)
        .some((row) => row.pageId === "page-promoted"),
    ).toBe(true);
    await waitForMicrotasks();
    expect(readCount).toBe(2);
    delayedRepair.resolve(createBoardSnapshot({
      columns: createBoard().columns.map((column) => column.id === "triage"
        ? { ...column, cards: [...column.cards, promoted] }
        : column),
    }, 2, "view-primary", true, 2));
    await waitForMicrotasks();
    release();
  });

  test("local draft overlays do not bump card revision", async () => {
    const board = createBoard();
    const registry = createTestRegistry({
      readViewWindow: async () => createBoardSnapshot(board),
      subscribeBoardChanges: () => () => {},
    });

    const store = registry.getStore("default");
    await store.fetchBoard();

    store.applyLocalPatch("triage", "card-1", {
      title: "Updated title",
    });

    expect(store.getSnapshot().pageIndex.get("card-1")?.revision).toBe(1);
  });

  test("remote optimistic updates bump card revision", async () => {
    const board = createBoard();
    const deferred = createDeferred<{ ok: true }>();
    const registry = createTestRegistry({
      readViewWindow: async () => createBoardSnapshot(cloneBoard(board)),
      subscribeBoardChanges: () => () => {},
    });

    const store = registry.getStore("default");
    await store.fetchBoard();

    const pendingMutation = store.runOptimisticMutation({
      kind: "page:update",
      conflictKeys: conflictKeysForPatch("card-1", { title: "Updated title" }),
      apply: buildPatchPageTransform("triage", "card-1", { title: "Updated title" }, { bumpRevision: true }),
      runRemote: async () => deferred.promise,
    });

    expect(store.getSnapshot().pageIndex.get("card-1")?.revision).toBe(2);

    deferred.resolve({ ok: true });
    await pendingMutation;
  });

  test("ignores no-op local overlays", async () => {
    const board = createBoard();
    const registry = createTestRegistry({
      readViewWindow: async () => createBoardSnapshot(board),
      subscribeBoardChanges: () => () => {},
    });

    const store = registry.getStore("default");
    await store.fetchBoard();
    const before = store.getSnapshot();

    const changed = store.applyLocalPatch("triage", "card-1", {
      title: "Initial title",
    });
    const after = store.getSnapshot();

    expect(changed).toBe(false);
    expect(after.board).toBe(before.board);
    expect(after.pageIndex).toBe(before.pageIndex);
  });

  test("LWW: out-of-order update acknowledgements keep latest local value", async () => {
    let serverBoard = createBoard();
    const deferredA = createDeferred<{ ok: true }>();
    const deferredB = createDeferred<{ ok: true }>();
    const deferredC = createDeferred<{ ok: true }>();

    const registry = createTestRegistry({
      readViewWindow: async () => createBoardSnapshot(cloneBoard(serverBoard)),
      subscribeBoardChanges: () => () => {},
    });
    const store = registry.getStore("default");
    await store.fetchBoard();

    const mutationA = store.runOptimisticMutation({
      kind: "page:update",
      conflictKeys: conflictKeysForPatch("card-1", { title: "A" }),
      apply: buildPatchPageTransform("triage", "card-1", { title: "A" }),
      runRemote: async () => {
        const result = await deferredA.promise;
        serverBoard = buildPatchPageTransform("triage", "card-1", { title: "A" })(serverBoard);
        return result;
      },
    });
    const mutationB = store.runOptimisticMutation({
      kind: "page:update",
      conflictKeys: conflictKeysForPatch("card-1", { title: "B" }),
      apply: buildPatchPageTransform("triage", "card-1", { title: "B" }),
      runRemote: async () => {
        const result = await deferredB.promise;
        serverBoard = buildPatchPageTransform("triage", "card-1", { title: "B" })(serverBoard);
        return result;
      },
    });
    const mutationC = store.runOptimisticMutation({
      kind: "page:update",
      conflictKeys: conflictKeysForPatch("card-1", { title: "C" }),
      apply: buildPatchPageTransform("triage", "card-1", { title: "C" }),
      runRemote: async () => {
        const result = await deferredC.promise;
        serverBoard = buildPatchPageTransform("triage", "card-1", { title: "C" })(serverBoard);
        return result;
      },
    });

    expect(store.getSnapshot().pageIndex.get("card-1")?.title).toBe("C");

    deferredA.resolve({ ok: true });
    await mutationA;
    expect(store.getSnapshot().pageIndex.get("card-1")?.title).toBe("C");

    deferredB.resolve({ ok: true });
    await mutationB;
    expect(store.getSnapshot().pageIndex.get("card-1")?.title).toBe("C");

    deferredC.resolve({ ok: true });
    await mutationC;
    expect(store.getSnapshot().pageIndex.get("card-1")?.title).toBe("C");
  });

  test("create -> edit -> move remains stable across acknowledgements", async () => {
    const createInput: PageCreateInput = {
      title: "Created",
      id: "018f0f85-6d56-7625-bdea-000000000000",
    };
    let serverBoard = createBoard();

    const createRemoteDeferred = createDeferred<{ id: string }>();
    const updateRemoteDeferred = createDeferred<{ ok: true }>();
    const moveRemoteDeferred = createDeferred<{ ok: true }>();

    const registry = createTestRegistry({
      readViewWindow: async () => createBoardSnapshot(cloneBoard(serverBoard)),
      subscribeBoardChanges: () => () => {},
    });
    const store = registry.getStore("default");
    await store.fetchBoard();

    const optimisticCard = createOptimisticCard(createInput);

    const createMutation = store.runOptimisticMutation({
      kind: "page:create",
      conflictKeys: conflictKeysForCreate("triage", optimisticCard.id),
      apply: buildCreateCardTransform("triage", optimisticCard, "bottom"),
      runRemote: async () => {
        const result = await createRemoteDeferred.promise;
        serverBoard = buildCreateCardTransform("triage", optimisticCard, "bottom")(serverBoard);
        return result;
      },
    });
    expect(store.getSnapshot().pageIndex.get("018f0f85-6d56-7625-bdea-000000000000")?.title).toBe("Created");

    const updateMutation = store.runOptimisticMutation({
      kind: "page:update",
      conflictKeys: conflictKeysForPatch("018f0f85-6d56-7625-bdea-000000000000", { title: "Created edited" }),
      apply: buildPatchPageTransform("triage", "018f0f85-6d56-7625-bdea-000000000000", { title: "Created edited" }),
      runRemote: async () => {
        const result = await updateRemoteDeferred.promise;
        serverBoard = buildPatchPageTransform("triage", "018f0f85-6d56-7625-bdea-000000000000", { title: "Created edited" })(serverBoard);
        return result;
      },
    });
    expect(store.getSnapshot().pageIndex.get("018f0f85-6d56-7625-bdea-000000000000")?.title).toBe("Created edited");

    const moveMutation = store.runOptimisticMutation({
      kind: "page:move",
      conflictKeys: conflictKeysForMove({
        pageId: "018f0f85-6d56-7625-bdea-000000000000",
        fromStatus: "triage",
        toStatus: "ship",
      }),
      apply: buildMovePageTransform({
        pageId: "018f0f85-6d56-7625-bdea-000000000000",
        fromStatus: "triage",
        toStatus: "ship",
      }),
      runRemote: async () => {
        const result = await moveRemoteDeferred.promise;
        serverBoard = buildMovePageTransform({
          pageId: "018f0f85-6d56-7625-bdea-000000000000",
          fromStatus: "triage",
          toStatus: "ship",
        })(serverBoard);
        return result;
      },
    });

    expect(store.getSnapshot().pageIndex.get("018f0f85-6d56-7625-bdea-000000000000")?.columnId).toBe("ship");

    createRemoteDeferred.resolve({ id: "018f0f85-6d56-7625-bdea-000000000000" });
    await createMutation;
    expect(store.getSnapshot().pageIndex.get("018f0f85-6d56-7625-bdea-000000000000")?.columnId).toBe("ship");
    expect(store.getSnapshot().pageIndex.get("018f0f85-6d56-7625-bdea-000000000000")?.title).toBe("Created edited");

    updateRemoteDeferred.resolve({ ok: true });
    await updateMutation;
    expect(store.getSnapshot().pageIndex.get("018f0f85-6d56-7625-bdea-000000000000")?.columnId).toBe("ship");
    expect(store.getSnapshot().pageIndex.get("018f0f85-6d56-7625-bdea-000000000000")?.title).toBe("Created edited");

    moveRemoteDeferred.resolve({ ok: true });
    await moveMutation;
    expect(store.getSnapshot().pageIndex.get("018f0f85-6d56-7625-bdea-000000000000")?.columnId).toBe("ship");
    expect(store.getSnapshot().pageIndex.get("018f0f85-6d56-7625-bdea-000000000000")?.title).toBe("Created edited");
  });

  test("converges a pending create when its canonical projection arrives first", async () => {
    const projection = createProjectionHarness();
    const remote = createDeferred<{ id: string }>();
    const pageId = "018f0f85-6d56-7625-bdea-000000000002";
    const optimisticCard = createOptimisticCard({
      id: pageId,
      status: "triage",
      title: "Optimistic title",
    });
    const canonicalCard: DatabasePageSummary = {
      ...optimisticCard,
      title: "Canonical title",
      richTitle: plainTextToPortableRichText("Canonical title"),
      revision: 1,
      order: 1,
    };
    const registry = createTestRegistry({
      readViewWindow: async () => createBoardSnapshot(),
      subscribeBoardChanges: () => () => {},
      getProjectionInvalidationRegistry: projection.getRegistry,
    });
    const store = registry.getStore("project-1");
    const unsubscribe = store.subscribe(() => {});
    await waitForMicrotasks();

    const mutation = store.runOptimisticMutation({
      kind: "page:create",
      conflictKeys: conflictKeysForCreate("triage", pageId),
      apply: buildCreateCardTransform("triage", optimisticCard, "bottom"),
      runRemote: async () => remote.promise,
      refreshOnSuccess: false,
    });
    expect(
      store.getSnapshot().board?.columns.flatMap((column) => column.cards)
        .filter((card) => card.id === pageId),
    ).toHaveLength(1);

    projection.publish(pageUpserted(2, canonicalCard));
    await waitForMicrotasks();

    const pendingOccurrences = store.getSnapshot().board?.columns
      .flatMap((column) => column.cards)
      .filter((card) => card.id === pageId) ?? [];
    expect(pendingOccurrences).toEqual([canonicalCard]);
    expect(store.getSnapshot().pendingMutationCount).toBe(1);

    store.applyLocalPatch("triage", pageId, {
      title: "Edited while create is pending",
    });
    const editedOccurrences = store.getSnapshot().board?.columns
      .flatMap((column) => column.cards)
      .filter((card) => card.id === pageId) ?? [];
    expect(editedOccurrences).toHaveLength(1);
    expect(editedOccurrences[0]?.title).toBe("Edited while create is pending");

    remote.resolve({ id: pageId });
    await mutation;

    const settledOccurrences =
      store.getSnapshot().board?.columns.flatMap((column) => column.cards)
        .filter((card) => card.id === pageId) ?? [];
    expect(settledOccurrences).toHaveLength(1);
    expect(settledOccurrences[0]?.title).toBe("Edited while create is pending");
    expect(store.getSnapshot().pendingMutationCount).toBe(0);
    unsubscribe();
  });

  test("failed delete rolls back automatically", async () => {
    const board = createBoard();
    const registry = createTestRegistry({
      readViewWindow: async () => createBoardSnapshot(cloneBoard(board)),
      subscribeBoardChanges: () => () => {},
    });
    const store = registry.getStore("default");
    await store.fetchBoard();

    const mutation = store.runOptimisticMutation({
      kind: "page:delete",
      conflictKeys: conflictKeysForDelete("card-1"),
      apply: buildDeletePageTransform("triage", "card-1"),
      runRemote: async () => {
        throw new Error("delete failed");
      },
    });

    expect(store.getSnapshot().pageIndex.has("card-1")).toBe(false);
    const result = await mutation;
    expect(result.ok).toBe(false);
    expect(store.getSnapshot().pageIndex.has("card-1")).toBe(true);
  });

  test("patches local board events and uses the event cursor for ambiguous refreshes", async () => {
    const board = createBoard();
    const callbacks: { onBoardChange?: (event: BoardChangeEvent) => void } = {};
    let boardFetchCount = 0;

    const registry = createTestRegistry({
      readViewWindow: async (_projectId, input) => {
        boardFetchCount += 1;
        const revision = input.minimumCommitSeq ?? 1;
        return createBoardSnapshot(
          board,
          revision,
          "view-primary",
          true,
          revision,
        );
      },
      subscribeBoardChanges: (_projectId, callback) => {
        callbacks.onBoardChange = callback;
        return () => {};
      },
    });

    const store = registry.getStore("default");
    const unsubscribe = store.subscribe(() => {});
    await waitForMicrotasks();

    expect(boardFetchCount).toBe(1);

    const deleteEvent: BoardChangeEvent = {
      projectId: "default",
      changeType: "delete",
      columnId: "triage",
      status: "triage",
      pageId: "card-1",
      storeEpoch: "epoch-1",
      commitSeq: 2,
    };

    callbacks.onBoardChange?.(deleteEvent);
    await waitForMicrotasks();
    expect(boardFetchCount).toBe(1);
    expect(store.getSnapshot().pageIndex.has("card-1")).toBe(false);

    const ambiguousEvent: BoardChangeEvent = {
      projectId: "default",
      changeType: "move",
      columnId: "triage",
      status: "triage",
      storeEpoch: "epoch-1",
      commitSeq: 3,
    };

    callbacks.onBoardChange?.(ambiguousEvent);
    await waitForMicrotasks();
    expect(boardFetchCount).toBe(2);

    callbacks.onBoardChange?.(ambiguousEvent);
    await waitForMicrotasks();
    expect(boardFetchCount).toBe(3);

    unsubscribe();
  });

  test("does not let a late older Board read overwrite a cursor-fenced patch", async () => {
    const board = createBoard();
    const lateRead = createDeferred<DatabaseViewWindowSnapshot>();
    const callbacks: { onBoardChange?: (event: BoardChangeEvent) => void } = {};
    const projection = createProjectionHarness();
    let readCount = 0;
    const registry = createTestRegistry({
      readViewWindow: async () => {
        readCount += 1;
        if (readCount === 1) return createBoardSnapshot(cloneBoard(board), 1);
        return await lateRead.promise;
      },
      subscribeBoardChanges: (_projectId, callback) => {
        callbacks.onBoardChange = callback;
        return () => {};
      },
      getProjectionInvalidationRegistry: projection.getRegistry,
    });
    const store = registry.getStore("project-1");
    const unsubscribe = store.subscribe(() => {});
    await waitForMicrotasks();

    const refresh = store.refreshBoard();
    await waitForMicrotasks();
    projection.publish(pageRemoved(2, "card-1"));
    lateRead.resolve(createBoardSnapshot(cloneBoard(board), 1));
    await refresh;
    await waitForMicrotasks();

    expect(store.getSnapshot().pageIndex.has("card-1")).toBe(false);
    unsubscribe();
  });

  test("evicts a revoked Page immediately and fences a pre-revocation Board read", async () => {
    const staleRead = createDeferred<DatabaseViewWindowSnapshot>();
    const projection = createProjectionHarness();
    let readCount = 0;
    const registry = createTestRegistry({
      readViewWindow: async () => {
        readCount += 1;
        if (readCount === 1) return createBoardSnapshot(createBoard(), 1);
        if (readCount === 2) return await staleRead.promise;
        return createBoardSnapshot({
          ...createBoard(),
          columns: createBoard().columns.map((column) => ({
            ...column,
            cards: column.cards.filter((card) => card.id !== "card-1"),
          })),
        }, 2, "view-primary", true, 2);
      },
      subscribeBoardChanges: () => () => {},
      getProjectionInvalidationRegistry: projection.getRegistry,
    });
    const store = registry.getStore("project-1");
    const unsubscribe = store.subscribe(() => {});
    await waitForMicrotasks();
    expect(store.getSnapshot().pageIndex.has("card-1")).toBe(true);

    const refresh = store.refreshBoard();
    await waitForMicrotasks();
    projection.publish(pageRevoked(2, "card-1"));
    expect(store.getSnapshot().pageIndex.has("card-1")).toBe(false);

    staleRead.resolve(createBoardSnapshot(createBoard(), 1));
    await refresh;
    await waitForMicrotasks();

    expect(readCount).toBe(3);
    expect(store.getSnapshot().pageIndex.has("card-1")).toBe(false);
    unsubscribe();
  });

  test("keeps per-project store instance across unsubscribe/resubscribe", async () => {
    const registry = createTestRegistry({
      readViewWindow: async () => createBoardSnapshot(),
      subscribeBoardChanges: () => () => {},
    });

    const first = registry.getStore("default");
    const unsubscribe = first.subscribe(() => {});
    await waitForMicrotasks();
    unsubscribe();

    const second = registry.getStore("default");
    expect(second).toBe(first);
    expect(second.getSnapshot().board).toBe(null);
  });

  test("queues local overlay before first fetch and applies after board load", async () => {
    const deferredBoard = createDeferred<DatabaseViewWindowSnapshot>();
    const registry = createTestRegistry({
      readViewWindow: async () => deferredBoard.promise,
      subscribeBoardChanges: () => () => {},
    });

    const store = registry.getStore("default");
    const unsubscribe = store.subscribe(() => {});
    await waitForMicrotasks();

    const queued = store.applyLocalPatch("triage", "card-1", { title: "Queued title" });
    expect(queued).toBe(true);
    expect(store.getSnapshot().board).toBe(null);

    deferredBoard.resolve(createBoardSnapshot());
    await waitForMicrotasks();
    await waitForMicrotasks();

    expect(store.getSnapshot().pageIndex.get("card-1")?.title).toBe("Queued title");
    unsubscribe();
  });

  test("auto-collects local overlay after server converges", async () => {
    let serverBoard = createBoard();
    const registry = createTestRegistry({
      readViewWindow: async () => createBoardSnapshot(cloneBoard(serverBoard)),
      subscribeBoardChanges: () => () => {},
    });
    const store = registry.getStore("default");
    await store.fetchBoard();

    store.applyLocalPatch("triage", "card-1", { title: "Local title" });
    expect(store.getSnapshot().pageIndex.get("card-1")?.title).toBe("Local title");

    serverBoard = buildPatchPageTransform("triage", "card-1", { title: "Local title" })(serverBoard);
    await store.refreshBoard();
    expect(store.getSnapshot().pageIndex.get("card-1")?.title).toBe("Local title");

    // If local overlay was not collected, this server update would be masked.
    serverBoard = buildPatchPageTransform("triage", "card-1", { title: "Server next" })(serverBoard);
    await store.refreshBoard();
    expect(store.getSnapshot().pageIndex.get("card-1")?.title).toBe("Server next");
  });

  test("does not auto-collect local overlay that depends on pending create", async () => {
    let serverBoard = createBoard();
    const createRemoteDeferred = createDeferred<{ id: string }>();
    const createInput: PageCreateInput = {
      title: "Created",
      id: "018f0f85-6d56-7625-bdea-000000000001",
    };
    const optimisticCard = createOptimisticCard(createInput);

    const registry = createTestRegistry({
      readViewWindow: async () => createBoardSnapshot(cloneBoard(serverBoard)),
      subscribeBoardChanges: () => () => {},
    });
    const store = registry.getStore("default");
    await store.fetchBoard();

    const createMutation = store.runOptimisticMutation({
      kind: "page:create",
      conflictKeys: conflictKeysForCreate("triage", optimisticCard.id),
      apply: buildCreateCardTransform("triage", optimisticCard, "bottom"),
      runRemote: async () => {
        const result = await createRemoteDeferred.promise;
        serverBoard = buildCreateCardTransform("triage", optimisticCard, "bottom")(serverBoard);
        return result;
      },
    });

    store.applyLocalPatch("triage", "018f0f85-6d56-7625-bdea-000000000001", { title: "Edited while pending" });
    expect(store.getSnapshot().pageIndex.get("018f0f85-6d56-7625-bdea-000000000001")?.title).toBe("Edited while pending");

    // Re-fetch while create is still pending: patch must not be dropped.
    await store.refreshBoard();
    expect(store.getSnapshot().pageIndex.get("018f0f85-6d56-7625-bdea-000000000001")?.title).toBe("Edited while pending");

    createRemoteDeferred.resolve({ id: "018f0f85-6d56-7625-bdea-000000000001" });
    await createMutation;
    expect(store.getSnapshot().pageIndex.get("018f0f85-6d56-7625-bdea-000000000001")?.title).toBe("Edited while pending");
  });
});
