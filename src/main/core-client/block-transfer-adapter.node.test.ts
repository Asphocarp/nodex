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
        source_database_id: null,
        target_document_id: "document:target",
        target_database_id: null,
        write_fence: {
          documents: [{
            document_id: "document:source",
            generation: 1,
            expected_head_seq: 3,
          }, {
            document_id: "document:target",
            generation: 2,
            expected_head_seq: 7,
          }],
          location_revisions: { "block:root": 1 },
          source_memberships: {},
        },
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
        write_fence: {
          documents: [{
            document_id: "document:source",
            generation: 1,
            expected_head_seq: 3,
          }, {
            document_id: "document:target",
            generation: 2,
            expected_head_seq: 7,
          }],
          location_revisions: { "block:root": 1 },
          source_memberships: {},
        },
      },
    }]);
  });

  test("maps a source-only lease into Library Page promotion and wrapper evidence", async () => {
    const client = new FakeCoreClient();
    const adapter = createCoreBlockTransferAdapter({ client, ...identity });
    const libraryIntent: BlockTransferIntent = {
      ...intent,
      operationId: "transfer:library",
      mode: "copy",
      target: {
        kind: "library",
        libraryId: identity.libraryId,
        beforeBlockId: "page:anchor",
      },
    };
    client.enqueueRead({
      ...preparedSnapshot(),
      value: {
        kind: "block_transfer_plan",
        value: {
          kind: "prepared",
          preparation: {
            source_document_id: "document:source",
            source_database_id: null,
            target_document_id: null,
            target_database_id: null,
            write_fence: {
              documents: [{
                document_id: "document:source",
                generation: 1,
                expected_head_seq: 3,
              }],
              location_revisions: { "block:root": 1 },
              source_memberships: {},
            },
          },
        },
      },
    });

    const prepared = await adapter.prepare(libraryIntent);
    expect(prepared).toMatchObject({
      ok: true,
      value: {
        request: {
          source: { kind: "document", documentId: "document:source" },
          target: {
            kind: "space",
            libraryId: identity.libraryId,
            beforeBlockId: "page:anchor",
          },
        },
        leaseDocuments: [{ documentId: "document:source" }],
      },
    });
    if (!prepared.ok) throw new Error("Expected a prepared Library transfer");

    const libraryResult = {
      ...coreResult(),
      mode: "copy" as const,
      result_root_block_ids: ["page:wrapper"],
      copied_block_ids: { "block:root": "block:copy" },
      transformation_evidence: [{
        sourceBlockId: "block:root",
        resultPageId: "page:wrapper",
        kind: "wrap",
        sourceBlockType: "checkListItem",
        semanticTitleHash: "a".repeat(64),
        consumedPropertyKeys: [],
        wrapperReason: "type_requires_wrapper",
        bodyRootBlockIds: ["block:copy"],
        sourceToResultBlockIds: { "block:root": "block:copy" },
      }],
      final_locations: {
        "page:wrapper": {
          kind: "library" as const,
          library_id: identity.libraryId,
          project_id: identity.projectId,
          rank_key: "0001",
        },
      },
      final_location_revisions: { "page:wrapper": 1 },
      document_commits: [coreResult().document_commits[0]!],
    };
    client.enqueueApply({
      ...committedApply(),
      value: {
        affected_resource_ids: ["page:wrapper"],
        page_copy: null,
        block_transfer: libraryResult,
      },
      receipt: {
        ...committedApply().receipt,
        operation_id: libraryIntent.operationId,
      },
    });
    const committed = await adapter.apply(prepared.value.request);
    expect(committed).toMatchObject({
      ok: true,
      value: {
        finalLocations: {
          "page:wrapper": {
            kind: "space",
            projectId: identity.projectId,
            rankKey: "0001",
          },
        },
        transformationEvidence: [{
          sourceBlockId: "block:root",
          resultPageId: "page:wrapper",
          kind: "wrap",
          wrapperReason: "type_requires_wrapper",
          bodyRootBlockIds: ["block:copy"],
        }],
      },
    });
    expect(client.applies[0]).toMatchObject({
      intent: {
        intent: {
          target: {
            kind: "library",
            library_id: identity.libraryId,
            before_block_id: "page:anchor",
          },
        },
        write_fence: {
          documents: [{ document_id: "document:source" }],
          location_revisions: { "block:root": 1 },
          source_memberships: {},
        },
      },
    });
  });

  test("maps native Data Source authority, placement, and affected Database evidence", async () => {
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
        beforePageId: "page:anchor",
      },
    };
    client.enqueueRead({
      ...preparedSnapshot(),
      value: {
        kind: "block_transfer_plan",
        value: {
          kind: "prepared",
          preparation: {
            source_document_id: "document:source",
            source_database_id: null,
            target_document_id: null,
            target_database_id: "database:target",
            write_fence: {
              documents: [{
                document_id: "document:source",
                generation: 1,
                expected_head_seq: 3,
              }],
              location_revisions: { "block:root": 1 },
              source_memberships: {},
            },
          },
        },
      },
    });

    const prepared = await adapter.prepare(dataSourceIntent);
    expect(prepared).toMatchObject({
      ok: true,
      value: {
        request: {
          target: {
            kind: "database",
            databaseBlockId: "database:target",
            dataSourceId: "source:target",
            viewId: "view:target",
            groupKey: "ship",
            beforePageId: "page:anchor",
          },
        },
        leaseDocuments: [{ documentId: "document:source" }],
      },
    });
    if (!prepared.ok) throw new Error("Expected a prepared Data Source transfer");

    const dataSourceResult = {
      ...coreResult(),
      mode: "copy" as const,
      result_root_block_ids: ["page:wrapper"],
      copied_block_ids: { "block:root": "block:copy" },
      transformation_evidence: [{
        sourceBlockId: "block:root",
        resultPageId: "page:wrapper",
        kind: "wrap",
        sourceBlockType: "checkListItem",
        semanticTitleHash: "b".repeat(64),
        consumedPropertyKeys: [],
        wrapperReason: "type_requires_wrapper",
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
      document_commits: [coreResult().document_commits[0]!],
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
    const committed = await adapter.apply(prepared.value.request);
    expect(committed).toMatchObject({
      ok: true,
      value: {
        finalLocations: {
          "page:wrapper": {
            kind: "database",
            databaseBlockId: "database:target",
          },
        },
        affectedDatabaseBlockIds: ["database:target"],
        transformationEvidence: [{ resultPageId: "page:wrapper", kind: "wrap" }],
      },
    });
    expect(client.applies[0]).toMatchObject({
      intent: {
        intent: {
          target: {
            kind: "data_source",
            data_source_id: "source:target",
            view_id: "view:target",
            group_key: "ship",
            before_page_id: "page:anchor",
          },
        },
        write_fence: {
          documents: [{ document_id: "document:source" }],
          location_revisions: { "block:root": 1 },
          source_memberships: {},
        },
      },
    });
  });

  test("round-trips Data Source membership coordinates in the exact write fence", async () => {
    const client = new FakeCoreClient();
    const adapter = createCoreBlockTransferAdapter({ client, ...identity });
    const dataSourceIntent: BlockTransferIntent = {
      ...intent,
      operationId: "transfer:from-data-source",
      source: { kind: "data_source", dataSourceId: "source:origin" },
      target: { kind: "library", libraryId: identity.libraryId },
    };
    client.enqueueRead({
      ...preparedSnapshot(),
      value: {
        kind: "block_transfer_plan",
        value: {
          kind: "prepared",
          preparation: {
            source_document_id: null,
            source_database_id: "database:origin",
            target_document_id: null,
            target_database_id: null,
            write_fence: {
              documents: [],
              location_revisions: { "block:root": 4 },
              source_memberships: {
                "block:root": {
                  membership_id: "membership:root",
                  revision: 6,
                },
              },
            },
          },
        },
      },
    });

    const prepared = await adapter.prepare(dataSourceIntent);
    expect(prepared).toMatchObject({
      ok: true,
      value: {
        leaseDocuments: [],
        request: {
          source: {
            kind: "database",
            databaseBlockId: "database:origin",
            dataSourceId: "source:origin",
            memberships: {
              "block:root": { membershipId: "membership:root", revision: 6 },
            },
          },
          expectedLocationRevisions: { "block:root": 4 },
        },
      },
    });
    if (!prepared.ok) throw new Error("Expected a prepared Data Source source");

    client.enqueueApply({
      ...committedApply(),
      receipt: {
        ...committedApply().receipt,
        operation_id: dataSourceIntent.operationId,
      },
    });
    await adapter.apply(prepared.value.request);
    expect(client.applies[0]).toMatchObject({
      intent: {
        write_fence: {
          documents: [],
          location_revisions: { "block:root": 4 },
          source_memberships: {
            "block:root": { membership_id: "membership:root", revision: 6 },
          },
        },
      },
    });
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
