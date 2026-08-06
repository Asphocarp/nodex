import { describe, expect, test } from "vitest";

import {
  BLOCK_TRANSFER_INTENT_CONTRACT_VERSION,
  type BlockTransferIntent,
} from "../../shared/block-transfer";
import { createCoreBlockTransferAdapter } from "./block-transfer-adapter";
import { FakeCoreClient } from "./testing/fake-core-client";
import type {
  BlockRecordCommittedValue,
  BlockRecordReadSnapshot,
  LibraryCommittedValue,
} from "./types";

const identity = {
  libraryId: "library:test",
  projectId: "project:test",
  storeEpoch: "epoch:test",
} as const;

const intent: BlockTransferIntent = {
  version: BLOCK_TRANSFER_INTENT_CONTRACT_VERSION,
  operationId: "transfer:test",
  projectId: identity.projectId,
  storeEpoch: identity.storeEpoch,
  clientSessionId: "renderer:test",
  actor: { kind: "electron_renderer", clientId: "renderer:test" },
  mode: "move",
  rootBlockIds: ["block:root"],
  source: { kind: "page", pageId: "page:source" },
  target: {
    kind: "page",
    pageId: "page:target",
    parentBlockId: "block:parent",
    beforeBlockId: "block:before",
  },
};

const coreResult = () => ({
  mode: "move" as const,
  source_root_block_ids: ["block:root"],
  result_root_block_ids: ["block:root"],
  copied_block_ids: {},
  transformation_evidence: [],
  final_locations: {
    "block:root": { kind: "document" as const, document_id: "document:target" },
  },
  final_location_revisions: { "block:root": 2 },
  document_commits: [{
    document_id: "document:source",
    generation: 1,
    base_head_seq: 3,
    head_seq: 4,
    update_id: "update:source",
    update: [1, 2, 3],
    state_vector: [4, 5],
  }, {
    document_id: "document:target",
    generation: 2,
    base_head_seq: 7,
    head_seq: 8,
    update_id: "update:target",
    update: [6, 7],
    state_vector: [8, 9],
  }],
  affected_database_ids: [],
  page_etags: {},
  move_etags: {},
  page_view_placements: {},
});

const committedApply = (
  overrides: Partial<LibraryCommittedValue["receipt"]> = {},
): LibraryCommittedValue => ({
  value: {
    affected_resource_ids: ["block:root"],
    page_copy: null,
    block_transfer: coreResult(),
  },
  receipt: {
    operation_id: intent.operationId,
    duplicate: false,
    operation_kind: "transfer_blocks",
    did_mutate: true,
    created_target: null,
    affected_parent_keys: [],
    affected_page_ids: [],
    affected_database_ids: [],
    affected_view_ids: [],
    committed_revisions: { "block:root": 2 },
    change_log_seq: 11,
    committed_at: "2026-07-19T19:00:00.000Z",
    ...overrides,
  },
  event_sequence: 11,
  store_epoch: identity.storeEpoch,
});

const blockRecordSnapshot = (
  read: "source" | "target",
): BlockRecordReadSnapshot => {
  const isSource = read === "source";
  const blockId = isSource ? "block:root" : "block:existing";
  const parent = isSource
    ? { kind: "library" as const }
    : { kind: "data_source" as const, id: "source:target" };
  return {
    library_id: identity.libraryId,
    observed_cursor: { store_epoch: identity.storeEpoch, commit_seq: 20 },
    graph: {
      library_id: identity.libraryId,
      blocks: [{
        id: blockId,
        library_id: identity.libraryId,
        kind: isSource ? "paragraph" : "page",
        lifecycle: "active",
        properties: { title: isSource ? "Dragged source" : "Existing page" },
        content_shard_id: `shard:${blockId}`,
        revision: 3,
      }],
      placements: [{
        block_id: blockId,
        parent,
        rank_key: isSource ? "8".padStart(32, "0") : "f".padStart(32, "0"),
        revision: 4,
      }],
    },
    view_positions: isSource
      ? []
      : [{
          view_id: "view:target",
          data_source_id: "source:target",
          block_id: blockId,
          group_key: "triage",
          rank_key: "f".padStart(32, "0"),
          revision: 5,
        }],
    content: isSource
      ? [{
          block_id: blockId,
          library_id: identity.libraryId,
          slot: "title",
          shard_id: `shard:${blockId}`,
          revision: 2,
          materialized_json: [{ type: "text", text: "Dragged source" }],
          full_state_v1: [],
          state_vector_v1: [],
          state_hash: "a".repeat(64),
        }]
      : [],
  };
};

const committedBlockRecordApply = (
  operationId: string,
): BlockRecordCommittedValue => ({
  actor_id: "renderer:test",
  audience: { kind: "projects", project_ids: [identity.projectId] },
  canonical_hash: "b".repeat(64),
  commit_id: `commit:${operationId}`,
  committed_at: "2026-07-19T19:00:00.000Z",
  cursor: { store_epoch: identity.storeEpoch, commit_seq: 21 },
  duplicate: false,
  effects: [],
  intent_hash: "c".repeat(64),
  operation_id: operationId,
  payload_completeness: "rich",
  session_id: "renderer:test",
});

describe("Core Block Transfer Adapter", () => {
  test("commits a logical intent in one Core apply without a renderer fence", async () => {
    const client = new FakeCoreClient();
    const adapter = createCoreBlockTransferAdapter({ client, ...identity });
    client.enqueueApply(committedApply());

    const committed = await adapter.commit(intent);

    expect(committed).toMatchObject({
      ok: true,
      value: {
        operationId: intent.operationId,
        changeLogSeq: 11,
        documentCommits: [
          { documentId: "document:source", headSeq: 4 },
          { documentId: "document:target", headSeq: 8 },
        ],
      },
    });
    expect(client.reads).toHaveLength(0);
    expect(client.applies).toHaveLength(1);
    expect(client.applies[0]?.intent).toMatchObject({
      kind: "transfer_blocks",
      write_fence: null,
    });
  });

  test("maps Core transformation and Data Source placement evidence", async () => {
    const client = new FakeCoreClient();
    const adapter = createCoreBlockTransferAdapter({ client, ...identity });
    const dataSourceIntent: BlockTransferIntent = {
      ...intent,
      operationId: "transfer:data-source",
      mode: "copy",
      target: {
        kind: "data_source",
        dataSourceId: "source:target",
        viewId: "view:target",
        groupKey: "ship",
      },
    };
    const dataSourceResult = {
      ...coreResult(),
      mode: "copy" as const,
      result_root_block_ids: ["page:wrapper"],
      copied_block_ids: { "block:root": "block:copy" },
      transformation_evidence: [{
        sourceBlockId: "block:root",
        resultPageId: "page:wrapper",
        kind: "wrap" as const,
        sourceBlockType: "checkListItem",
        semanticTitleHash: "b".repeat(64),
        consumedPropertyKeys: [],
        wrapperReason: "type_requires_wrapper" as const,
        bodyRootBlockIds: ["block:copy"],
        sourceToResultBlockIds: { "block:root": "block:copy" },
      }],
      final_locations: {
        "page:wrapper": {
          kind: "data_source" as const,
          database_id: "database:target",
          data_source_id: "source:target",
        },
      },
      final_location_revisions: { "page:wrapper": 2 },
      affected_database_ids: ["database:target"],
    };
    client.enqueueApply({
      ...committedApply(),
      value: {
        affected_resource_ids: ["page:wrapper", "database:target"],
        page_copy: null,
        block_transfer: dataSourceResult,
      },
      receipt: {
        ...committedApply().receipt,
        operation_id: dataSourceIntent.operationId,
        affected_database_ids: ["database:target"],
      },
    });

    const committed = await adapter.commit(dataSourceIntent);

    expect(committed).toMatchObject({
      ok: true,
      value: {
        operationId: dataSourceIntent.operationId,
        finalLocations: {
          "page:wrapper": {
            kind: "database",
            databaseBlockId: "database:target",
          },
        },
        affectedDatabaseBlockIds: ["database:target"],
        transformationEvidence: [{
          resultPageId: "page:wrapper",
          kind: "wrap",
          wrapperReason: "type_requires_wrapper",
        }],
      },
    });
    expect(client.applies[0]?.intent).toMatchObject({
      intent: {
        target: {
          kind: "data_source",
          data_source_id: "source:target",
          view_id: "view:target",
          group_key: "ship",
        },
      },
      write_fence: null,
    });
  });

  test("returns Core duplicate receipts through the same commit path", async () => {
    const client = new FakeCoreClient();
    const adapter = createCoreBlockTransferAdapter({ client, ...identity });
    client.enqueueApply(committedApply({ duplicate: true, did_mutate: false }));

    await expect(adapter.commit(intent)).resolves.toMatchObject({
      ok: true,
      value: {
        operationId: intent.operationId,
        duplicate: true,
        changeLogSeq: 11,
      },
    });
  });

  test("routes move-to-Board through one PromoteManyToPage BlockRecord commit", async () => {
    const client = new FakeCoreClient();
    const adapter = createCoreBlockTransferAdapter({ client, ...identity });
    const dataSourceIntent: BlockTransferIntent = {
      ...intent,
      operationId: "transfer:move-to-board",
      target: {
        kind: "data_source",
        dataSourceId: "source:target",
        viewId: "view:target",
        groupKey: "triage",
        beforePageId: "block:existing",
      },
    };
    client.enqueueBlockRecordRead(blockRecordSnapshot("source"));
    client.enqueueBlockRecordRead(blockRecordSnapshot("target"));
    client.enqueueBlockRecordApply(
      committedBlockRecordApply(dataSourceIntent.operationId),
    );

    const committed = await adapter.commit(dataSourceIntent);

    expect(committed).toMatchObject({
      ok: true,
      value: {
        operationId: dataSourceIntent.operationId,
        mode: "move",
        resultRootBlockIds: ["block:root"],
        finalLocations: {
          "block:root": {
            kind: "database",
            databaseBlockId: "source:target",
          },
        },
        documentCommits: [],
      },
    });
    expect(client.reads).toHaveLength(0);
    expect(client.blockRecordReads).toEqual([
      {
        kind: "window",
        block_ids: ["block:root"],
        include_content: true,
        include_descendants: true,
      },
      {
        kind: "window",
        parent: { kind: "data_source", id: "source:target" },
        view_id: "view:target",
        include_content: true,
      },
    ]);
    expect(client.blockRecordApplies).toHaveLength(1);
    expect(client.blockRecordApplies[0]?.operation).toMatchObject({
      kind: "promote_many_to_page",
      data_source_id: "source:target",
      view_id: "view:target",
      entries: [{
        block_id: "block:root",
        view_group_key: "triage",
        expected_block_revision: 3,
        expected_placement_revision: 4,
      }],
    });
    expect(client.blockRecordApplies[0]?.operation).not.toHaveProperty(
      "write_fence",
    );
  });

  test("rejects a cross-project intent before contacting Core", async () => {
    const client = new FakeCoreClient();
    const adapter = createCoreBlockTransferAdapter({ client, ...identity });

    await expect(adapter.commit({
      ...intent,
      projectId: "project:other",
    })).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_transfer_request" },
    });
    expect(client.applies).toHaveLength(0);
  });
});
