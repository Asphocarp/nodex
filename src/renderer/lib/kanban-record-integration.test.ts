import { describe, expect, test } from "vitest";
import type { components } from "@nodex/core-protocol";
import type {
  BlockRecordWindow,
} from "../../shared/block-records";
import {
  applyLocalCommitToBlockRecordWindow,
  blockRecordCommitToLocalCommit,
} from "../../shared/block-records";
import { createKanbanStoreRegistry } from "./kanban-store";
import type { BlockRecordApplyInput, BlockRecordRead } from "../../shared/core-modules/block-record-module";
import type { BlockRecordWindowStore } from "./block-record-window-store";
import type { DatabaseViewWindowSnapshot } from "../../shared/database-views";

type Committed = components["schemas"]["BlockRecordCommittedValue"];

const viewSnapshot = (): DatabaseViewWindowSnapshot => ({
  projectId: "project-1",
  libraryId: "library-1",
  databaseId: "database-1",
  dataSourceId: "source-1",
  viewId: "view-primary",
  storeEpoch: "epoch-1",
  changeLogSeq: 1,
  projectionRevision: 1,
  nextCursor: null,
  rows: [],
  board: { columns: [] },
  view: {
    id: "view-primary",
    databaseBlockId: "database-1",
    projectId: "project-1",
    name: "Primary",
    kind: "kanban",
    config: {},
    isPrimary: true,
    createdAt: "2026-08-06T00:00:00.000Z",
    updatedAt: "2026-08-06T00:00:00.000Z",
  },
  query: {
    database: {
      databaseId: "database-1",
      libraryId: "library-1",
      name: "Tasks",
      defaultViewId: "view-primary",
    },
    dataSource: {
      dataSourceId: "source-1",
      libraryId: "library-1",
      name: "Pages",
    },
    properties: [],
    view: {
      viewId: "view-primary",
      databaseId: "database-1",
      dataSourceId: "source-1",
      name: "Primary",
      kind: "kanban",
      isDefault: true,
      config: {
        filter: { kind: "group", operator: "and", children: [] },
        sort: [],
      },
    },
    rows: [],
  },
} as unknown as DatabaseViewWindowSnapshot);

const boardWindow = (): BlockRecordWindow => ({
  libraryId: "library-1",
  rootParent: { kind: "dataSource", dataSourceId: "source-1" },
  viewId: "view-primary",
  records: [{
    id: "page-existing",
    libraryId: "library-1",
    kind: "page",
    lifecycle: "active",
    properties: { title: "Existing", status: "triage" },
    contentShardId: "shard:1",
    revision: 0,
  }],
  placements: [{
    blockId: "page-existing",
    parent: { kind: "dataSource", dataSourceId: "source-1" },
    rankKey: "80000000000000000000000000000000",
    revision: 0,
  }],
  viewPositions: [{
    viewId: "view-primary",
    dataSourceId: "source-1",
    blockId: "page-existing",
    groupKey: "triage",
    rankKey: "80000000000000000000000000000000",
    revision: 0,
  }],
  content: [],
  observedLocalCommit: { storeEpoch: "epoch-1", commitSeq: 1 },
  continuation: null,
});

const sourceWindow = (): BlockRecordWindow => ({
  ...boardWindow(),
  rootParent: { kind: "library", libraryId: "library-1" },
  records: [{
    id: "block-a",
    libraryId: "library-1",
    kind: "paragraph",
    lifecycle: "active",
    properties: { title: "Promoted", status: "build" },
    contentShardId: "shard:1",
    revision: 0,
  }],
  placements: [{
    blockId: "block-a",
    parent: { kind: "block", blockId: "page-source" },
    rankKey: "40000000000000000000000000000000",
    revision: 0,
  }],
  viewPositions: [],
});

const committedPromotion = (): Committed => ({
  cursor: { store_epoch: "epoch-1", commit_seq: 2 },
  commit_id: "commit:promote",
  operation_id: "operation:promote",
  intent_hash: "hash:intent",
  canonical_hash: "hash:canonical",
  actor_id: "renderer:project-1",
  session_id: "session:test",
  committed_at: "2026-08-06T00:00:00.000Z",
  effects: [
    {
      kind: "promotion",
      value: {
        blockId: "block-a",
        fromKind: "paragraph",
        toKind: "page",
        from: { kind: "block", id: "page-source" },
        to: { kind: "data_source", id: "source-1" },
        rankKey: "40000000000000000000000000000000",
        blockRevision: 1,
        placementRevision: 1,
        libraryId: "library-1",
        properties: { title: "Promoted", status: "build" },
        contentShardId: "shard:1",
      },
    },
    {
      kind: "view_position",
      value: {
        viewId: "view-primary",
        dataSourceId: "source-1",
        blockId: "block-a",
        groupKey: "build",
        rankKey: "40000000000000000000000000000000",
        revision: 0,
      },
    },
  ],
  audience: { kind: "library", projectIds: [] },
  payload_completeness: "rich",
  duplicate: false,
});

describe("Kanban BlockRecord integration", () => {
  test("publishes the canonical Board before compatibility metadata finishes", async () => {
    let resolveViewRead!: (snapshot: DatabaseViewWindowSnapshot) => void;
    const viewRead = new Promise<DatabaseViewWindowSnapshot>((resolve) => {
      resolveViewRead = resolve;
    });
    const current = boardWindow();
    const windowStore: BlockRecordWindowStore = {
      getSnapshot: () => current,
      read: async () => current,
      load: async () => current,
      apply: async () => {
        throw new Error("The early-visibility fixture is read-only");
      },
      applyCommit: () => null,
      subscribe: () => () => {},
      startCommitSubscription: () => () => {},
    };
    const registry = createKanbanStoreRegistry({
      readViewGroups: async () => ({
        projectId: "project-1",
        libraryId: "library-1",
        databaseId: "database-1",
        dataSourceId: "source-1",
        viewId: "view-primary",
        storeEpoch: "epoch-1",
        changeLogSeq: 1,
        grouped: false,
        totalRows: 1,
        truncated: false,
        groups: [],
      }),
      readViewWindow: async () => await viewRead,
      subscribeBoardChanges: () => () => {},
      createBlockRecordWindowStore: () => windowStore,
    });
    const store = registry.getStore("project-1", "view-primary");
    const fetch = store.fetchBoard();

    await Promise.resolve();
    await Promise.resolve();
    expect(store.getSnapshot().board?.columns[0]?.cards[0]?.id).toBe("page-existing");
    expect(store.getSnapshot().loading).toBe(false);

    resolveViewRead(viewSnapshot());
    await fetch;
  });

  test("does not present a legacy summary when the canonical Board read fails", async () => {
    const windowStore: BlockRecordWindowStore = {
      getSnapshot: () => null,
      read: async () => {
        throw new Error("unused");
      },
      load: async () => {
        throw new Error("canonical Board unavailable");
      },
      apply: async () => {
        throw new Error("unreachable");
      },
      applyCommit: () => null,
      subscribe: () => () => {},
      startCommitSubscription: () => () => {},
    };
    const registry = createKanbanStoreRegistry({
      readViewGroups: async () => ({
        projectId: "project-1",
        libraryId: "library-1",
        databaseId: "database-1",
        dataSourceId: "source-1",
        viewId: "view-primary",
        storeEpoch: "epoch-1",
        changeLogSeq: 1,
        grouped: false,
        totalRows: 1,
        truncated: false,
        groups: [],
      }),
      readViewWindow: async () => viewSnapshot(),
      subscribeBoardChanges: () => () => {},
      createBlockRecordWindowStore: () => windowStore,
    });
    const store = registry.getStore("project-1", "view-primary");

    await store.fetchBoard();

    expect(store.getSnapshot().board).toBe(null);
    expect(store.getSnapshot().error).toContain("canonical Board unavailable");
  });

  test("uses the apply response as the visible Board authority without a refresh", async () => {
    let current = boardWindow();
    let applyInput: unknown;
    let viewReadCalls = 0;
    const listeners = new Set<(window: BlockRecordWindow) => void>();
    const windowStore: BlockRecordWindowStore = {
      getSnapshot: () => current,
      read: async (read: BlockRecordRead) => read.block_ids?.includes("block-a") ? sourceWindow() : current,
      load: async () => {
        for (const listener of listeners) listener(current);
        return current;
      },
      apply: async (input: BlockRecordApplyInput) => {
        applyInput = input;
        const envelope = blockRecordCommitToLocalCommit(committedPromotion());
        const result = applyLocalCommitToBlockRecordWindow(current, envelope);
        if (result.kind !== "applied") throw new Error(`Unexpected ${result.kind} result`);
        current = result.window;
        for (const listener of listeners) listener(current);
        return committedPromotion();
      },
      applyCommit: () => null,
      subscribe: (listener: (window: BlockRecordWindow) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      startCommitSubscription: () => () => {},
    };

    const registry = createKanbanStoreRegistry({
      readViewGroups: async () => ({
        projectId: "project-1",
        libraryId: "library-1",
        databaseId: "database-1",
        dataSourceId: "source-1",
        viewId: "view-primary",
        storeEpoch: "epoch-1",
        changeLogSeq: 1,
        grouped: false,
        totalRows: 1,
        truncated: false,
        groups: [],
      }),
      readViewWindow: async () => {
        viewReadCalls += 1;
        return viewSnapshot();
      },
      subscribeBoardChanges: () => () => {},
      createBlockRecordWindowStore: () => windowStore,
    });
    const store = registry.getStore("project-1", "view-primary");
    await store.fetchBoard();

    await store.promoteBlockToPage({
      blockId: "block-a",
      groupKey: "build",
      actorId: "renderer:project-1",
      sessionId: "session:test",
    });

    expect((applyInput as { operation: { kind: string } }).operation.kind).toBe("promote_many_to_page");
    expect(store.getSnapshot().board?.columns.find((column) => column.id === "build")?.cards[0]).toMatchObject({
      id: "block-a",
      title: "Promoted",
      status: "build",
    });
    expect(viewReadCalls).toBe(1);
  });
});
