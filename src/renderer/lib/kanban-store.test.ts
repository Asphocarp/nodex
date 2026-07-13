import { describe, expect, test } from "vitest";
import { plainTextToPortableRichText } from "../../shared/block-documents";
import {
  buildCreateCardTransform,
  buildDeleteCardTransform,
  buildMoveCardTransform,
  buildPatchCardTransform,
  conflictKeysForCreate,
  conflictKeysForDelete,
  conflictKeysForMove,
  conflictKeysForPatch,
  createOptimisticCard,
} from "./kanban-optimistic-ops";
import type {
  BoardSummary,
  CardCreateInput,
  CardSummary,
} from "./types";
import { createKanbanStoreRegistry } from "./kanban-store";
import { toCardSummary } from "../../shared/card-summary";
import type { BoardChangeEvent } from "../../shared/ipc-api";
import type { DatabaseChangeEvent } from "../../shared/database-events";
import type {
  DatabaseViewSnapshotCommandResult,
  GeneralDatabaseViewDefinition,
} from "../../shared/database-query";

function createDatabaseViewSnapshot(
  viewId: string,
  title: string,
  isPrimary: boolean,
): DatabaseViewSnapshotCommandResult {
  const projectId = "project-1";
  const databaseBlockId = "database-1";
  const statusPropertyId = "property-status";
  const view: GeneralDatabaseViewDefinition = {
    id: viewId,
    databaseBlockId,
    projectId,
    name: isPrimary ? "Primary" : "Focused",
    kind: "kanban",
    config: {
      schemaKey: "nodex.database-view",
      schemaVersion: 1,
      filter: { kind: "group", operator: "and", children: [] },
      sort: [{
        field: { kind: "manual" },
        direction: "asc",
        nulls: "last",
      }],
      group: { propertyId: statusPropertyId },
      display: { propertyIds: [statusPropertyId], showTitle: true },
    },
    isPrimary,
    revision: 1,
    rankKey: "a",
    lifecycle: "active",
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z",
  };
  const database = {
    blockId: databaseBlockId,
    projectId,
    name: "Tasks",
    isPrimary: true,
    schemaKey: "nodex.database",
    schemaRevision: 1,
    metadataRevision: 1,
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z",
  };
  const statusProperty = {
    id: statusPropertyId,
    databaseBlockId,
    key: "status",
    name: "Status",
    valueType: "select" as const,
    config: {},
    rankKey: "a",
    lifecycle: "active" as const,
    revision: 1,
    createdAt: "2026-07-12T00:00:00.000Z",
    updatedAt: "2026-07-12T00:00:00.000Z",
  };
  const descriptor = {
    database,
    properties: [statusProperty],
    views: [view],
  };
  const query = {
    database,
    properties: [statusProperty],
    view,
    rows: [{
      membership: {
        id: "membership-1",
        databaseBlockId,
        cardBlockId: "card-1",
        revision: 1,
        createdAt: "2026-07-12T00:00:00.000Z",
      },
      card: {
        blockId: "card-1",
        projectId,
        lifecycle: "active" as const,
        location: { kind: "space" as const, rankKey: "a" },
        locationRevision: 1,
        metadataRevision: 1,
        documentId: "document-1",
        documentGeneration: 1,
        documentHeadSeq: 1,
        documentAuthority: "ydoc_primary" as const,
        content: {
          projectedSeq: 1,
          title,
          richTitle: plainTextToPortableRichText(title),
          preview: "",
          plainText: "",
        },
        createdAt: "2026-07-12T00:00:00.000Z",
        updatedAt: "2026-07-12T00:00:00.000Z",
      },
      values: {
        [statusPropertyId]: {
          propertyId: statusPropertyId,
          valueType: "select" as const,
          value: "draft",
          revision: 1,
        },
      },
      position: { groupKey: "draft", rankKey: "a", revision: 1 },
      effectiveGroupKey: "draft",
    }],
  };
  const wrap = <T>(value: T) => ({
    version: 1 as const,
    projectId,
    storeEpoch: "epoch-1",
    changeLogSeq: 1,
    value,
  });
  return { ok: true, value: { descriptor: wrap(descriptor), query: wrap(query) } };
}

function createCardSummary(title = "Initial title"): CardSummary {
  return {
    id: "card-1",
    status: "draft",
    archived: false,
    title,
    richTitle: plainTextToPortableRichText(title),
    descriptionPreview: "Initial description",
    descriptionLength: "Initial description".length,
    hasDescription: true,
    priority: "p2-medium",
    estimate: "m",
    tags: [],
    agentBlocked: false,
    revision: 1,
    created: new Date("2026-02-16T00:00:00.000Z"),
    order: 0,
  };
}

function createBoard(title = "Initial title"): BoardSummary {
  return {
    columns: [
      {
        id: "draft",
        name: "Ideas",
        cards: [createCardSummary(title)],
      },
      {
        id: "done",
        name: "Done",
        cards: [],
      },
    ],
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
      invoke: async (channel, projectId, viewId) => {
        calls.push(`${channel}:${String(projectId)}:${String(viewId ?? "")}`);
        if (channel === "database-views:snapshot") {
          return createDatabaseViewSnapshot(
            String(viewId),
            viewId === "view-focused" ? "Focused query row" : "Primary query row",
            viewId === "view-primary",
          );
        }
        if (channel === "board:summary:get") {
          return createBoard("Full primary Card summary");
        }
        throw new Error(`Unexpected channel ${channel}`);
      },
      subscribeBoardChanges: () => () => {},
      subscribeDatabaseChanges: () => () => {},
    });
    const primary = registry.getStore("project-1", "view-primary");
    const focused = registry.getStore("project-1", "view-focused");

    await Promise.all([primary.fetchBoard(), focused.fetchBoard()]);

    expect(primary === focused).toBe(false);
    expect(primary.getSnapshot().databaseView?.databaseViewId).toBe(
      "view-primary",
    );
    expect(primary.getSnapshot().cardIndex.get("card-1")?.title).toBe(
      "Full primary Card summary",
    );
    expect(focused.getSnapshot().databaseView?.databaseViewId).toBe(
      "view-focused",
    );
    expect(focused.getSnapshot().databaseView?.columns[0]?.rows[0]?.title).toBe(
      "Focused query row",
    );
    expect(focused.getSnapshot().board).toBe(null);
    expect(calls.filter((call) => call.startsWith("board:summary:get")).length).toBe(1);
    const callsBeforeFreshEnsure = calls.length;
    await focused.ensureFreshBoard();
    expect(calls.length).toBe(callsBeforeFreshEnsure);
    expect(focused.getSnapshot().loading).toBe(false);
  });

  test("invalidates two window stores from one project-scoped Database receipt", async () => {
    const callbacks: Array<(event: DatabaseChangeEvent) => void> = [];
    let fetchCount = 0;
    const makeRegistry = () =>
      createKanbanStoreRegistry({
        invoke: async () => {
          fetchCount += 1;
          return createBoard();
        },
        subscribeBoardChanges: () => () => {},
        subscribeDatabaseChanges: (_projectId, callback) => {
          callbacks.push(callback);
          return () => {};
        },
      });
    const firstStore = makeRegistry().getStore("project-1");
    const secondStore = makeRegistry().getStore("project-1");
    const unsubscribeFirst = firstStore.subscribe(() => {});
    const unsubscribeSecond = secondStore.subscribe(() => {});
    await waitForMicrotasks();
    expect(fetchCount).toBe(2);

    const event: DatabaseChangeEvent = {
      version: 1,
      projectId: "project-1",
      storeEpoch: "epoch-1",
      operationId: "database-operation-1",
      sourceKind: "database_mutation",
      affectedDatabaseBlockIds: ["database-1"],
      changeLogSeq: 8,
    };
    for (const callback of callbacks) callback(event);
    await waitForMicrotasks();
    await waitForMicrotasks();

    expect(fetchCount).toBe(4);
    unsubscribeFirst();
    unsubscribeSecond();
  });

  test("registers a single board-change subscription for multiple listeners", async () => {
    const board = createBoard();
    let subscribeCalls = 0;
    let unsubscribeCalls = 0;
    let databaseSubscribeCalls = 0;
    let databaseUnsubscribeCalls = 0;

    const registry = createKanbanStoreRegistry({
      invoke: async () => board,
      subscribeBoardChanges: () => {
        subscribeCalls += 1;
        return () => {
          unsubscribeCalls += 1;
        };
      },
      subscribeDatabaseChanges: () => {
        databaseSubscribeCalls += 1;
        return () => {
          databaseUnsubscribeCalls += 1;
        };
      },
    });

    const store = registry.getStore("default");
    const unsubscribeFirst = store.subscribe(() => {});
    const unsubscribeSecond = store.subscribe(() => {});
    await waitForMicrotasks();

    expect(subscribeCalls).toBe(1);
    expect(databaseSubscribeCalls).toBe(1);

    unsubscribeFirst();
    expect(unsubscribeCalls).toBe(0);
    expect(databaseUnsubscribeCalls).toBe(0);

    unsubscribeSecond();
    expect(unsubscribeCalls).toBe(1);
    expect(databaseUnsubscribeCalls).toBe(1);
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
        return board;
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
          return initialBoard;
        }
        return refreshedBoard;
      },
      subscribeBoardChanges: () => () => {},
    });

    const store = registry.getStore("default");
    const firstFetch = store.fetchBoard();
    const refreshPromise = store.refreshBoard();

    gate.release?.();
    await Promise.all([firstFetch, refreshPromise]);

    expect(invokeCalls).toBe(2);
    expect(store.getSnapshot().cardIndex.get("card-1")?.title).toBe("Refreshed");
  });

  test("fetchBoard uses the summary channel and keeps full descriptions out of snapshots", async () => {
    const board = createBoard();
    let channelName = "";

    const registry = createKanbanStoreRegistry({
      invoke: async (channel) => {
        channelName = channel;
        return board;
      },
      subscribeBoardChanges: () => () => {},
    });

    const store = registry.getStore("default");
    await store.fetchBoard();

    const indexedCard = store.getSnapshot().cardIndex.get("card-1");
    expect(channelName).toBe("board:summary:get");
    expect(Object.hasOwn(indexedCard ?? {}, "description")).toBe(false);
    expect(indexedCard?.descriptionPreview).toBe("Initial description");
  });

  test("first subscribe with a fresh base board does not refetch", async () => {
    const board = createBoard();
    let invokeCalls = 0;
    let currentTime = 1_000;

    const registry = createKanbanStoreRegistry({
      invoke: async () => {
        invokeCalls += 1;
        return board;
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
        return board;
      },
      subscribeBoardChanges: () => () => {},
      now: () => currentTime,
    });

    const store = registry.getStore("default");
    await store.fetchBoard();
    expect(store.getSnapshot().cardIndex.get("card-1")?.title).toBe("Initial");

    currentTime = 32_000;
    const unsubscribe = store.subscribe(() => {});
    expect(store.getSnapshot().cardIndex.get("card-1")?.title).toBe("Initial");

    await waitForMicrotasks();
    expect(invokeCalls).toBe(2);
    expect(store.getSnapshot().cardIndex.get("card-1")?.title).toBe("Refreshed");
    unsubscribe();
  });

  test("force ensureFreshBoard refreshes even when the board is fresh", async () => {
    const boards = [createBoard("Initial"), createBoard("Forced")];
    let invokeCalls = 0;

    const registry = createKanbanStoreRegistry({
      invoke: async () => {
        const board = boards[invokeCalls] ?? boards[boards.length - 1]!;
        invokeCalls += 1;
        return board;
      },
      subscribeBoardChanges: () => () => {},
      now: () => 1_000,
    });

    const store = registry.getStore("default");
    await store.fetchBoard();
    await store.ensureFreshBoard({ force: true });

    expect(invokeCalls).toBe(2);
    expect(store.getSnapshot().cardIndex.get("card-1")?.title).toBe("Forced");
  });

  test("summary patch events update the board without a broad refetch", async () => {
    const callbacks: { onBoardChange?: (event: BoardChangeEvent) => void } = {};
    let boardFetchCount = 0;

    const registry = createKanbanStoreRegistry({
      invoke: async () => {
        boardFetchCount += 1;
        return createBoard();
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
      columnId: "draft",
      status: "draft",
      cardId: "card-1",
      summary: createCardSummary("Patched from event"),
    });
    await waitForMicrotasks();

    expect(boardFetchCount).toBe(1);
    expect(store.getSnapshot().cardIndex.get("card-1")?.title).toBe("Patched from event");
    unsubscribe();
  });

  test("applies local optimistic overlays to board and card index", async () => {
    const board = createBoard();
    const registry = createKanbanStoreRegistry({
      invoke: async () => board,
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

    store.applyLocalPatch("draft", "card-1", {
      title: "Updated title",
    });

    const snapshot = store.getSnapshot();
    expect(snapshot.board?.columns[0]?.cards[0]?.title).toBe("Updated title");
    expect(snapshot.cardIndex.get("card-1")?.title).toBe("Updated title");
    expect(notifications).toBe(1);

    unsubscribe();
  });

  test("merges full remote card updates as summaries without storing the body", async () => {
    const registry = createKanbanStoreRegistry({
      invoke: async () => createBoard(),
      subscribeBoardChanges: () => () => {},
    });

    const store = registry.getStore("default");
    await store.fetchBoard();

    store.applyRemoteCard({
      id: "card-1",
      status: "draft",
      archived: false,
      title: "Remote title",
      richTitle: plainTextToPortableRichText("Remote title"),
      description: "Remote full body that should only become preview metadata",
      tags: [],
      agentBlocked: false,
      revision: 2,
      created: new Date("2026-02-16T00:00:00.000Z"),
      order: 0,
    });

    const indexedCard = store.getSnapshot().cardIndex.get("card-1");
    const summary = toCardSummary({
      id: "card-1",
      status: "draft",
      archived: false,
      title: "Remote title",
      richTitle: plainTextToPortableRichText("Remote title"),
      description: "Remote full body that should only become preview metadata",
      tags: [],
      agentBlocked: false,
      revision: 2,
      created: new Date("2026-02-16T00:00:00.000Z"),
      order: 0,
    });

    expect(indexedCard?.title).toBe("Remote title");
    expect(indexedCard?.descriptionPreview).toBe(summary.descriptionPreview);
    expect(indexedCard?.descriptionLength).toBe(summary.descriptionLength);
    expect(Object.hasOwn(indexedCard ?? {}, "description")).toBe(false);
  });

  test("merges remote card summary acknowledgements without a full body", async () => {
    const registry = createKanbanStoreRegistry({
      invoke: async () => createBoard(),
      subscribeBoardChanges: () => () => {},
    });

    const store = registry.getStore("default");
    await store.fetchBoard();

    store.applyRemoteCardSummary({
      id: "card-1",
      status: "draft",
      archived: false,
      title: "Ack title",
      richTitle: plainTextToPortableRichText("Ack title"),
      tags: [],
      agentBlocked: false,
      revision: 2,
      created: new Date("2026-02-16T00:00:00.000Z"),
      order: 0,
      descriptionPreview: "Ack preview",
      descriptionLength: 128,
      hasDescription: true,
    });

    const indexedCard = store.getSnapshot().cardIndex.get("card-1");
    expect(indexedCard?.title).toBe("Ack title");
    expect(indexedCard?.descriptionPreview).toBe("Ack preview");
    expect(indexedCard?.descriptionLength).toBe(128);
    expect(Object.hasOwn(indexedCard ?? {}, "description")).toBe(false);
  });

  test("local draft overlays do not bump card revision", async () => {
    const board = createBoard();
    const registry = createKanbanStoreRegistry({
      invoke: async () => board,
      subscribeBoardChanges: () => () => {},
    });

    const store = registry.getStore("default");
    await store.fetchBoard();

    store.applyLocalPatch("draft", "card-1", {
      title: "Updated title",
    });

    expect(store.getSnapshot().cardIndex.get("card-1")?.revision).toBe(1);
  });

  test("remote optimistic updates bump card revision", async () => {
    const board = createBoard();
    const deferred = createDeferred<{ ok: true }>();
    const registry = createKanbanStoreRegistry({
      invoke: async () => cloneBoard(board),
      subscribeBoardChanges: () => () => {},
    });

    const store = registry.getStore("default");
    await store.fetchBoard();

    const pendingMutation = store.runOptimisticMutation({
      kind: "card:update",
      conflictKeys: conflictKeysForPatch("card-1", { title: "Updated title" }),
      apply: buildPatchCardTransform("draft", "card-1", { title: "Updated title" }, { bumpRevision: true }),
      runRemote: async () => deferred.promise,
    });

    expect(store.getSnapshot().cardIndex.get("card-1")?.revision).toBe(2);

    deferred.resolve({ ok: true });
    await pendingMutation;
  });

  test("ignores no-op local overlays", async () => {
    const board = createBoard();
    const registry = createKanbanStoreRegistry({
      invoke: async () => board,
      subscribeBoardChanges: () => () => {},
    });

    const store = registry.getStore("default");
    await store.fetchBoard();
    const before = store.getSnapshot();

    const changed = store.applyLocalPatch("draft", "card-1", {
      title: "Initial title",
    });
    const after = store.getSnapshot();

    expect(changed).toBe(false);
    expect(after.board).toBe(before.board);
    expect(after.cardIndex).toBe(before.cardIndex);
  });

  test("LWW: out-of-order update acknowledgements keep latest local value", async () => {
    let serverBoard = createBoard();
    const deferredA = createDeferred<{ ok: true }>();
    const deferredB = createDeferred<{ ok: true }>();
    const deferredC = createDeferred<{ ok: true }>();

    const registry = createKanbanStoreRegistry({
      invoke: async () => cloneBoard(serverBoard),
      subscribeBoardChanges: () => () => {},
    });
    const store = registry.getStore("default");
    await store.fetchBoard();

    const mutationA = store.runOptimisticMutation({
      kind: "card:update",
      conflictKeys: conflictKeysForPatch("card-1", { title: "A" }),
      apply: buildPatchCardTransform("draft", "card-1", { title: "A" }),
      runRemote: async () => {
        const result = await deferredA.promise;
        serverBoard = buildPatchCardTransform("draft", "card-1", { title: "A" })(serverBoard);
        return result;
      },
    });
    const mutationB = store.runOptimisticMutation({
      kind: "card:update",
      conflictKeys: conflictKeysForPatch("card-1", { title: "B" }),
      apply: buildPatchCardTransform("draft", "card-1", { title: "B" }),
      runRemote: async () => {
        const result = await deferredB.promise;
        serverBoard = buildPatchCardTransform("draft", "card-1", { title: "B" })(serverBoard);
        return result;
      },
    });
    const mutationC = store.runOptimisticMutation({
      kind: "card:update",
      conflictKeys: conflictKeysForPatch("card-1", { title: "C" }),
      apply: buildPatchCardTransform("draft", "card-1", { title: "C" }),
      runRemote: async () => {
        const result = await deferredC.promise;
        serverBoard = buildPatchCardTransform("draft", "card-1", { title: "C" })(serverBoard);
        return result;
      },
    });

    expect(store.getSnapshot().cardIndex.get("card-1")?.title).toBe("C");

    deferredA.resolve({ ok: true });
    await mutationA;
    expect(store.getSnapshot().cardIndex.get("card-1")?.title).toBe("C");

    deferredB.resolve({ ok: true });
    await mutationB;
    expect(store.getSnapshot().cardIndex.get("card-1")?.title).toBe("C");

    deferredC.resolve({ ok: true });
    await mutationC;
    expect(store.getSnapshot().cardIndex.get("card-1")?.title).toBe("C");
  });

  test("create -> edit -> move remains stable across acknowledgements", async () => {
    const createInput: CardCreateInput = {
      title: "Created",
      id: "018f0f85-6d56-7625-bdea-000000000000",
    };
    let serverBoard = createBoard();

    const createRemoteDeferred = createDeferred<{ id: string }>();
    const updateRemoteDeferred = createDeferred<{ ok: true }>();
    const moveRemoteDeferred = createDeferred<{ ok: true }>();

    const registry = createKanbanStoreRegistry({
      invoke: async () => cloneBoard(serverBoard),
      subscribeBoardChanges: () => () => {},
    });
    const store = registry.getStore("default");
    await store.fetchBoard();

    const optimisticCard = createOptimisticCard(createInput);

    const createMutation = store.runOptimisticMutation({
      kind: "card:create",
      conflictKeys: conflictKeysForCreate("draft", optimisticCard.id),
      apply: buildCreateCardTransform("draft", optimisticCard, "bottom"),
      runRemote: async () => {
        const result = await createRemoteDeferred.promise;
        serverBoard = buildCreateCardTransform("draft", optimisticCard, "bottom")(serverBoard);
        return result;
      },
    });
    expect(store.getSnapshot().cardIndex.get("018f0f85-6d56-7625-bdea-000000000000")?.title).toBe("Created");

    const updateMutation = store.runOptimisticMutation({
      kind: "card:update",
      conflictKeys: conflictKeysForPatch("018f0f85-6d56-7625-bdea-000000000000", { title: "Created edited" }),
      apply: buildPatchCardTransform("draft", "018f0f85-6d56-7625-bdea-000000000000", { title: "Created edited" }),
      runRemote: async () => {
        const result = await updateRemoteDeferred.promise;
        serverBoard = buildPatchCardTransform("draft", "018f0f85-6d56-7625-bdea-000000000000", { title: "Created edited" })(serverBoard);
        return result;
      },
    });
    expect(store.getSnapshot().cardIndex.get("018f0f85-6d56-7625-bdea-000000000000")?.title).toBe("Created edited");

    const moveMutation = store.runOptimisticMutation({
      kind: "card:move",
      conflictKeys: conflictKeysForMove({
        cardId: "018f0f85-6d56-7625-bdea-000000000000",
        fromStatus: "draft",
        toStatus: "done",
      }),
      apply: buildMoveCardTransform({
        cardId: "018f0f85-6d56-7625-bdea-000000000000",
        fromStatus: "draft",
        toStatus: "done",
      }),
      runRemote: async () => {
        const result = await moveRemoteDeferred.promise;
        serverBoard = buildMoveCardTransform({
          cardId: "018f0f85-6d56-7625-bdea-000000000000",
          fromStatus: "draft",
          toStatus: "done",
        })(serverBoard);
        return result;
      },
    });

    expect(store.getSnapshot().cardIndex.get("018f0f85-6d56-7625-bdea-000000000000")?.columnId).toBe("done");

    createRemoteDeferred.resolve({ id: "018f0f85-6d56-7625-bdea-000000000000" });
    await createMutation;
    expect(store.getSnapshot().cardIndex.get("018f0f85-6d56-7625-bdea-000000000000")?.columnId).toBe("done");
    expect(store.getSnapshot().cardIndex.get("018f0f85-6d56-7625-bdea-000000000000")?.title).toBe("Created edited");

    updateRemoteDeferred.resolve({ ok: true });
    await updateMutation;
    expect(store.getSnapshot().cardIndex.get("018f0f85-6d56-7625-bdea-000000000000")?.columnId).toBe("done");
    expect(store.getSnapshot().cardIndex.get("018f0f85-6d56-7625-bdea-000000000000")?.title).toBe("Created edited");

    moveRemoteDeferred.resolve({ ok: true });
    await moveMutation;
    expect(store.getSnapshot().cardIndex.get("018f0f85-6d56-7625-bdea-000000000000")?.columnId).toBe("done");
    expect(store.getSnapshot().cardIndex.get("018f0f85-6d56-7625-bdea-000000000000")?.title).toBe("Created edited");
  });

  test("failed delete rolls back automatically", async () => {
    const board = createBoard();
    const registry = createKanbanStoreRegistry({
      invoke: async () => cloneBoard(board),
      subscribeBoardChanges: () => () => {},
    });
    const store = registry.getStore("default");
    await store.fetchBoard();

    const mutation = store.runOptimisticMutation({
      kind: "card:delete",
      conflictKeys: conflictKeysForDelete("card-1"),
      apply: buildDeleteCardTransform("draft", "card-1"),
      runRemote: async () => {
        throw new Error("delete failed");
      },
    });

    expect(store.getSnapshot().cardIndex.has("card-1")).toBe(false);
    const result = await mutation;
    expect(result.ok).toBe(false);
    expect(store.getSnapshot().cardIndex.has("card-1")).toBe(true);
  });

  test("patches local board events and cooldowns ambiguous refreshes", async () => {
    const board = createBoard();
    let currentTime = 1_000;
    const callbacks: { onBoardChange?: (event: BoardChangeEvent) => void } = {};
    let boardFetchCount = 0;

    const registry = createKanbanStoreRegistry({
      invoke: async () => {
        boardFetchCount += 1;
        return board;
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
      columnId: "draft",
      status: "draft",
      cardId: "card-1",
    };

    callbacks.onBoardChange?.(deleteEvent);
    await waitForMicrotasks();
    expect(boardFetchCount).toBe(1);
    expect(store.getSnapshot().cardIndex.has("card-1")).toBe(false);

    const ambiguousEvent: BoardChangeEvent = {
      projectId: "default",
      changeType: "move",
      columnId: "draft",
      status: "draft",
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

  test("keeps per-project store instance across unsubscribe/resubscribe", async () => {
    const registry = createKanbanStoreRegistry({
      invoke: async () => createBoard(),
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
    const deferredBoard = createDeferred<BoardSummary>();
    const registry = createKanbanStoreRegistry({
      invoke: async () => deferredBoard.promise,
      subscribeBoardChanges: () => () => {},
    });

    const store = registry.getStore("default");
    const unsubscribe = store.subscribe(() => {});
    await waitForMicrotasks();

    const queued = store.applyLocalPatch("draft", "card-1", { title: "Queued title" });
    expect(queued).toBe(true);
    expect(store.getSnapshot().board).toBe(null);

    deferredBoard.resolve(createBoard());
    await waitForMicrotasks();
    await waitForMicrotasks();

    expect(store.getSnapshot().cardIndex.get("card-1")?.title).toBe("Queued title");
    unsubscribe();
  });

  test("auto-collects local overlay after server converges", async () => {
    let serverBoard = createBoard();
    const registry = createKanbanStoreRegistry({
      invoke: async () => cloneBoard(serverBoard),
      subscribeBoardChanges: () => () => {},
    });
    const store = registry.getStore("default");
    await store.fetchBoard();

    store.applyLocalPatch("draft", "card-1", { title: "Local title" });
    expect(store.getSnapshot().cardIndex.get("card-1")?.title).toBe("Local title");

    serverBoard = buildPatchCardTransform("draft", "card-1", { title: "Local title" })(serverBoard);
    await store.refreshBoard();
    expect(store.getSnapshot().cardIndex.get("card-1")?.title).toBe("Local title");

    // If local overlay was not collected, this server update would be masked.
    serverBoard = buildPatchCardTransform("draft", "card-1", { title: "Server next" })(serverBoard);
    await store.refreshBoard();
    expect(store.getSnapshot().cardIndex.get("card-1")?.title).toBe("Server next");
  });

  test("does not auto-collect local overlay that depends on pending create", async () => {
    let serverBoard = createBoard();
    const createRemoteDeferred = createDeferred<{ id: string }>();
    const createInput: CardCreateInput = {
      title: "Created",
      id: "018f0f85-6d56-7625-bdea-000000000001",
    };
    const optimisticCard = createOptimisticCard(createInput);

    const registry = createKanbanStoreRegistry({
      invoke: async () => cloneBoard(serverBoard),
      subscribeBoardChanges: () => () => {},
    });
    const store = registry.getStore("default");
    await store.fetchBoard();

    const createMutation = store.runOptimisticMutation({
      kind: "card:create",
      conflictKeys: conflictKeysForCreate("draft", optimisticCard.id),
      apply: buildCreateCardTransform("draft", optimisticCard, "bottom"),
      runRemote: async () => {
        const result = await createRemoteDeferred.promise;
        serverBoard = buildCreateCardTransform("draft", optimisticCard, "bottom")(serverBoard);
        return result;
      },
    });

    store.applyLocalPatch("draft", "018f0f85-6d56-7625-bdea-000000000001", { title: "Edited while pending" });
    expect(store.getSnapshot().cardIndex.get("018f0f85-6d56-7625-bdea-000000000001")?.title).toBe("Edited while pending");

    // Re-fetch while create is still pending: patch must not be dropped.
    await store.refreshBoard();
    expect(store.getSnapshot().cardIndex.get("018f0f85-6d56-7625-bdea-000000000001")?.title).toBe("Edited while pending");

    createRemoteDeferred.resolve({ id: "018f0f85-6d56-7625-bdea-000000000001" });
    await createMutation;
    expect(store.getSnapshot().cardIndex.get("018f0f85-6d56-7625-bdea-000000000001")?.title).toBe("Edited while pending");
  });
});
