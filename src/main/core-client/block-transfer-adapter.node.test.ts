import { describe, expect, test } from "vitest";

import {
  BLOCK_TRANSFER_INTENT_CONTRACT_VERSION,
  type BlockTransferIntent,
} from "../../shared/block-transfer";
import { createCoreBlockTransferAdapter } from "./block-transfer-adapter";
import { FakeCoreClient } from "./testing/fake-core-client";
import type {
  LibraryCommittedValue,
  LibraryReadSnapshot,
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
});

const preparedSnapshot = (): LibraryReadSnapshot => ({
  version: 1,
  store_epoch: identity.storeEpoch,
  event_head: 10,
  value: {
    kind: "block_transfer_plan",
    value: {
      kind: "prepared",
      preparation: {
        source_document_id: "document:source",
        target_document_id: "document:target",
        lease_documents: [{
          document_id: "document:source",
          generation: 1,
          expected_head_seq: 3,
        }, {
          document_id: "document:target",
          generation: 2,
          expected_head_seq: 7,
        }],
        expected_location_revisions: { "block:root": 1 },
      },
    },
  },
});

const committedSnapshot = (): LibraryReadSnapshot => ({
  version: 1,
  store_epoch: identity.storeEpoch,
  event_head: 11,
  value: {
    kind: "block_transfer_plan",
    value: {
      kind: "committed",
      result: coreResult(),
      change_log_seq: 11,
      committed_at: "2026-07-19T19:00:00.000Z",
    },
  },
});

const committedApply = (): LibraryCommittedValue => ({
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
  },
  event_sequence: 11,
  store_epoch: identity.storeEpoch,
});

describe("Core Block Transfer Adapter", () => {
  test("plans exact Page-owned Document heads and commits the refreshed write fence", async () => {
    const client = new FakeCoreClient();
    const adapter = createCoreBlockTransferAdapter({ client, ...identity });
    client.enqueueRead(preparedSnapshot());

    const prepared = await adapter.prepare(intent);
    expect(prepared).toMatchObject({
      ok: true,
      value: {
        leaseDocuments: [{
          documentId: "document:source",
          generation: 1,
          expectedHeadSeq: 3,
        }, {
          documentId: "document:target",
          generation: 2,
          expectedHeadSeq: 7,
        }],
        request: {
          source: {
            kind: "document",
            documentId: "document:source",
            pageId: "page:source",
          },
          target: {
            kind: "document",
            documentId: "document:target",
            pageId: "page:target",
            parentBlockId: "block:parent",
            beforeBlockId: "block:before",
          },
          expectedLocationRevisions: { "block:root": 1 },
        },
      },
    });
    if (!prepared.ok) throw new Error("Expected a prepared Block transfer");

    client.enqueueApply(committedApply());
    const committed = await adapter.apply(prepared.value.request);
    expect(committed).toMatchObject({
      ok: true,
      value: {
        operationId: intent.operationId,
        duplicate: false,
        finalLocations: {
          "block:root": {
            kind: "document",
            documentId: "document:target",
          },
        },
        documentCommits: [{
          documentId: "document:source",
          headSeq: 4,
          updateId: "update:source",
        }, {
          documentId: "document:target",
          headSeq: 8,
          updateId: "update:target",
        }],
      },
    });
    if (!committed.ok) throw new Error("Expected a committed Block transfer");
    expect([...committed.value.documentCommits[0]!.update!]).toEqual([1, 2, 3]);
    expect([...committed.value.documentCommits[0]!.stateVector]).toEqual([4, 5]);
    expect(client.applies).toEqual([{
      operationId: intent.operationId,
      intent: {
        kind: "transfer_blocks",
        intent: {
          actor: intent.actor,
          mode: "move",
          root_block_ids: ["block:root"],
          source: { kind: "page", page_id: "page:source" },
          target: {
            kind: "page",
            page_id: "page:target",
            parent_block_id: "block:parent",
            before_block_id: "block:before",
          },
        },
        write_fence: [{
          document_id: "document:source",
          generation: 1,
          expected_head_seq: 3,
        }, {
          document_id: "document:target",
          generation: 2,
          expected_head_seq: 7,
        }],
      },
    }]);
  });

  test("recovers a committed receipt before leasing and rejects stale scope locally", async () => {
    const client = new FakeCoreClient();
    const adapter = createCoreBlockTransferAdapter({ client, ...identity });
    client.enqueueRead(committedSnapshot());

    await expect(adapter.lookupCommitted(intent)).resolves.toMatchObject({
      ok: true,
      value: {
        operationId: intent.operationId,
        duplicate: true,
        changeLogSeq: 11,
      },
    });
    await expect(adapter.lookupCommitted({
      ...intent,
      projectId: "project:other",
    })).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_transfer_request" },
    });
    await expect(adapter.prepare({
      ...intent,
      storeEpoch: "epoch:stale",
    })).resolves.toMatchObject({
      ok: false,
      error: { code: "store_epoch_mismatch", reloadRequired: true },
    });
    expect(client.reads).toHaveLength(1);
  });
});
