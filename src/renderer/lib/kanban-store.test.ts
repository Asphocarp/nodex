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
import { createKanbanStoreRegistry } from "./kanban-store";
import { toDatabasePageSummary } from "../../shared/page-summary";
import type { BoardChangeEvent } from "../../shared/ipc-api";
import type { ProjectionStreamMessage } from "../../shared/projection-stream";
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
  changeLogSeq = 1,
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
      changeLogSeq,
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
  changeLogSeq = 1,
  viewId = "view-primary",
  primary = true,
): DatabaseViewWindowSnapshot {
  const card = board.columns.flatMap((column) => column.cards)[0]
    ?? createPageSummary();
  const queryResult = createDatabaseViewSnapshot(
    viewId,
    card.title,
    primary,
    changeLogSeq,
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
    changeLogSeq,
    projectionRevision: changeLogSeq,
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

function createProjectionHarness() {
  const listeners = new Set<(message: ProjectionStreamMessage) => void>();
  let latestMessage: ProjectionStreamMessage | null = null;
  const registry = new ProjectionInvalidationRegistry((scope, listener) => {
    listeners.add(listener);
    if (latestMessage) {
      listener({
        version: 1,
        kind: "checkpoint",
        scope,
        cursor: latestMessage.cursor,
      });
    }
    return () => listeners.delete(listener);
  });
  return {
    getRegistry: () => registry,
    publish: (message: ProjectionStreamMessage) => {
      latestMessage = message;
      for (const listener of listeners) listener(message);
    },
  };
}

function pageChanged(
  changeLogSeq: number,
  pageId = "card-1",
): ProjectionStreamMessage {
  return {
    version: 1,
    kind: "changed",
    scope: {
      kind: "project",
      libraryId: "library-1",
      projectId: "project-1",
    },
    cursor: { storeEpoch: "epoch-1", changeLogSeq },
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
        head_seq: changeLogSeq,
      }],
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
    const registry = createKanbanStoreRegistry({
      readDatabaseModule: async (projectId, request) => {
        const target = request.read.target;
        const readViewId = target.kind === "view" ? target.viewId : "";
        calls.push(`database-module:read:${projectId}:${readViewId}`);
        return createDatabaseViewSnapshot(
          readViewId,
          readViewId === "view-focused" ? "Focused query row" : "Primary query row",
          readViewId === "view-primary",
        );
      },
      invoke: async (channel, projectId, rawInput) => {
        const input = rawInput as { databaseViewId?: string };
        const viewId = input.databaseViewId ?? "view-primary";
        calls.push(`${channel}:${String(projectId)}:${viewId}`);
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

  test("invalidates a shared consumer key once from one project-scoped receipt", async () => {
    const projection = createProjectionHarness();
    let fetchCount = 0;
    const makeRegistry = () =>
      createKanbanStoreRegistry({
        invoke: async () => {
          fetchCount += 1;
          return createBoardSnapshot(createBoard(), fetchCount <= 2 ? 1 : 8);
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

    expect(fetchCount).toBe(3);
    unsubscribeFirst();
    unsubscribeSecond();
  });

  test("refreshes a durable Database View from a matching Page Document event", async () => {
    const projection = createProjectionHarness();
    let readCount = 0;
    const registry = createKanbanStoreRegistry({
      invoke: async () => {
        readCount += 1;
        return createBoardSnapshot(
          createBoard(
            readCount === 1 ? "Before Document edit" : "After Document edit",
          ),
          readCount === 1 ? 1 : 9,
          "view-focused",
          false,
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

    projection.publish(pageChanged(9, "card-filtered-out-before-title-change"));
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
    const registry = createKanbanStoreRegistry({
      invoke: async () => {
        readCount += 1;
        if (readCount === 1) return await firstRead.promise;
        return createBoardSnapshot(
          createBoard("Latest head"),
          10,
          "view-focused",
          false,
        );
      },
      subscribeBoardChanges: () => () => {},
      getProjectionInvalidationRegistry: projection.getRegistry,
    });
    const store = registry.getStore("project-1", "view-focused");
    const unsubscribe = store.subscribe(() => {});

    projection.publish(pageChanged(10));
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

    const registry = createKanbanStoreRegistry({
      invoke: async () => createBoardSnapshot(board),
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
    const gate: { release?: () => void } = {};
    let invokeCalls = 0;

    const registry = createKanbanStoreRegistry({
      invoke: async () => {
        invokeCalls += 1;
        await new Promise<void>((resolve) => {
          gate.release = () => resolve();
        });
        return createBoardSnapshot(board);
      },
      subscribeBoardChanges: () => () => {},
    });

    const store = registry.getStore("default");
    const firstFetch = store.fetchBoard();
    const secondFetch = store.fetchBoard();

    expect(invokeCalls).toBe(1);

    gate.release?.();
    await Promise.all([firstFetch, secondFetch]);
    expect(invokeCalls).toBe(1);
  });

  test("refreshBoard fetches again after an in-flight fetch settles", async () => {
    const initialBoard = createBoard("Initial");
    const refreshedBoard = createBoard("Refreshed");
    const gate: { release?: () => void } = {};
    let invokeCalls = 0;

    const registry = createKanbanStoreRegistry({
      invoke: async () => {
        invokeCalls += 1;
        if (invokeCalls === 1) {
          await new Promise<void>((resolve) => {
            gate.release = () => resolve();
          });
          return createBoardSnapshot(initialBoard);
        }
        return createBoardSnapshot(refreshedBoard, 2);
      },
      subscribeBoardChanges: () => () => {},
    });

    const store = registry.getStore("default");
    const firstFetch = store.fetchBoard();
    const refreshPromise = store.refreshBoard();

    gate.release?.();
    await Promise.all([firstFetch, refreshPromise]);

    expect(invokeCalls).toBe(2);
    expect(store.getSnapshot().pageIndex.get("card-1")?.title).toBe("Refreshed");
  });

  test("fetchBoard uses the summary channel and keeps full descriptions out of snapshots", async () => {
    const board = createBoard();
    let channelName = "";

    const registry = createKanbanStoreRegistry({
      invoke: async (channel) => {
        channelName = channel;
        return createBoardSnapshot(board);
      },
      subscribeBoardChanges: () => () => {},
    });

    const store = registry.getStore("default");
    await store.fetchBoard();

    const indexedPage = store.getSnapshot().pageIndex.get("card-1");
    expect(channelName).toBe("database:view-window:get");
    expect(Object.hasOwn(indexedPage ?? {}, "description")).toBe(false);
    expect(indexedPage?.descriptionPreview).toBe("Initial description");
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
    const registry = createKanbanStoreRegistry({
      invoke: async (_channel, _projectId, request) => {
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
      { after: "cursor-1", first: 50 },
    ]);
    expect([...store.getSnapshot().pageIndex.keys()]).toEqual([
      "card-1",
      "card-2",
    ]);
    expect(store.getSnapshot().hasMore).toBe(false);
  });

  test("first subscribe with a fresh base board does not refetch", async () => {
    const board = createBoard();
    let invokeCalls = 0;
    let currentTime = 1_000;

    const registry = createKanbanStoreRegistry({
      invoke: async () => {
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

    const registry = createKanbanStoreRegistry({
      invoke: async () => {
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

    const registry = createKanbanStoreRegistry({
      invoke: async () => {
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

    const registry = createKanbanStoreRegistry({
      invoke: async () => {
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
      changeLogSeq: 2,
    });
    await waitForMicrotasks();

    expect(boardFetchCount).toBe(1);
    expect(store.getSnapshot().pageIndex.get("card-1")?.title).toBe("Patched from event");
    unsubscribe();
  });

  test("applies local optimistic overlays to board and card index", async () => {
    const board = createBoard();
    const registry = createKanbanStoreRegistry({
      invoke: async () => createBoardSnapshot(board),
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
    const registry = createKanbanStoreRegistry({
      invoke: async () => createBoardSnapshot(),
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
    const registry = createKanbanStoreRegistry({
      invoke: async () => createBoardSnapshot(),
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

  test("local draft overlays do not bump card revision", async () => {
    const board = createBoard();
    const registry = createKanbanStoreRegistry({
      invoke: async () => createBoardSnapshot(board),
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
    const registry = createKanbanStoreRegistry({
      invoke: async () => createBoardSnapshot(cloneBoard(board)),
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
    const registry = createKanbanStoreRegistry({
      invoke: async () => createBoardSnapshot(board),
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

    const registry = createKanbanStoreRegistry({
      invoke: async () => createBoardSnapshot(cloneBoard(serverBoard)),
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

    const registry = createKanbanStoreRegistry({
      invoke: async () => createBoardSnapshot(cloneBoard(serverBoard)),
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

  test("failed delete rolls back automatically", async () => {
    const board = createBoard();
    const registry = createKanbanStoreRegistry({
      invoke: async () => createBoardSnapshot(cloneBoard(board)),
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

  test("patches local board events and cooldowns ambiguous refreshes", async () => {
    const board = createBoard();
    let currentTime = 1_000;
    const callbacks: { onBoardChange?: (event: BoardChangeEvent) => void } = {};
    let boardFetchCount = 0;

    const registry = createKanbanStoreRegistry({
      invoke: async () => {
        boardFetchCount += 1;
        return createBoardSnapshot(board, boardFetchCount);
      },
      subscribeBoardChanges: (_projectId, callback) => {
        callbacks.onBoardChange = callback;
        return () => {};
      },
      now: () => currentTime,
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
      changeLogSeq: 2,
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
      changeLogSeq: 3,
    };

    store.markMutation();
    callbacks.onBoardChange?.(ambiguousEvent);
    await waitForMicrotasks();
    expect(boardFetchCount).toBe(1);

    currentTime = 1_700;
    callbacks.onBoardChange?.(ambiguousEvent);
    await waitForMicrotasks();
    expect(boardFetchCount).toBe(2);

    unsubscribe();
  });

  test("does not let a late older Board read overwrite a cursor-fenced patch", async () => {
    const board = createBoard();
    const lateRead = createDeferred<DatabaseViewWindowSnapshot>();
    const callbacks: { onBoardChange?: (event: BoardChangeEvent) => void } = {};
    const projection = createProjectionHarness();
    let readCount = 0;
    const registry = createKanbanStoreRegistry({
      invoke: async () => {
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
    const store = registry.getStore("default");
    const unsubscribe = store.subscribe(() => {});
    await waitForMicrotasks();

    const refresh = store.refreshBoard();
    await waitForMicrotasks();
    callbacks.onBoardChange?.({
      projectId: "default",
      changeType: "delete",
      columnId: "triage",
      status: "triage",
      pageId: "card-1",
      storeEpoch: "epoch-1",
      changeLogSeq: 2,
    });
    projection.publish(pageChanged(2, "card-1"));
    lateRead.resolve(createBoardSnapshot(cloneBoard(board), 1));
    await refresh;
    await waitForMicrotasks();

    expect(store.getSnapshot().pageIndex.has("card-1")).toBe(false);
    unsubscribe();
  });

  test("keeps per-project store instance across unsubscribe/resubscribe", async () => {
    const registry = createKanbanStoreRegistry({
      invoke: async () => createBoardSnapshot(),
      subscribeBoardChanges: () => () => {},
    });

    const first = registry.getStore("default");
    const unsubscribe = first.subscribe(() => {});
    await waitForMicrotasks();
    unsubscribe();

    const second = registry.getStore("default");
    expect(second).toBe(first);
  });

  test("queues local overlay before first fetch and applies after board load", async () => {
    const deferredBoard = createDeferred<DatabaseViewWindowSnapshot>();
    const registry = createKanbanStoreRegistry({
      invoke: async () => deferredBoard.promise,
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
    const registry = createKanbanStoreRegistry({
      invoke: async () => createBoardSnapshot(cloneBoard(serverBoard)),
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

    const registry = createKanbanStoreRegistry({
      invoke: async () => createBoardSnapshot(cloneBoard(serverBoard)),
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
