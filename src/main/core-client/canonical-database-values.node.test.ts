import { describe, expect, test } from "vitest";

import type { BlockRecordReadSnapshot } from "./types";
import {
  applyCanonicalDatabaseValues,
} from "./canonical-database-values";
import { createCoreDatabaseModuleAdapter } from "./database-module-adapter";
import { DATABASE_MODULE_V2_CONTRACT_VERSION } from "../../shared/database-module-v2";
import {
  parseDataSourceId,
  parseDataSourceOptionId,
  parseDataSourcePropertyId,
} from "../../shared/database-identities";
import type { CoreDatabaseRowSummary } from "./types";
import type { BlockRecordWindow } from "../../shared/block-records";
import { overlayCanonicalDatabaseRows } from "./database-page-projection";
import { FakeCoreClient } from "./testing/fake-core-client";

const identity = {
  libraryId: "library:values",
  storeEpoch: "epoch:values",
} as const;

const SOURCE_ID = parseDataSourceId("source:values");
const STATUS_ID = parseDataSourcePropertyId("p_Abcd1234");
const TAGS_ID = parseDataSourcePropertyId("p_Efgh5678");
const ADD_TAG_ID = parseDataSourceOptionId({ propertyId: TAGS_ID, value: "o_Abcd1234" });
const REMOVE_TAG_ID = parseDataSourceOptionId({ propertyId: TAGS_ID, value: "o_Efgh5678" });

const rowWindow = (): BlockRecordReadSnapshot => ({
  library_id: identity.libraryId,
  observed_cursor: { store_epoch: identity.storeEpoch, commit_seq: 11 },
  graph: {
    library_id: identity.libraryId,
    blocks: [{
      id: "page:values",
      library_id: identity.libraryId,
      kind: "page",
      lifecycle: "active",
      properties: {
        title: "Values",
        dataSourceValues: [
          { propertyId: STATUS_ID, value: "todo", revision: 2 },
          { propertyId: TAGS_ID, value: [REMOVE_TAG_ID, "b"], revision: 1 },
        ],
      },
      content_shard_id: "shard:values",
      revision: 7,
    }],
    placements: [{
      block_id: "page:values",
      parent: { kind: "data_source", id: "source:values" },
      rank_key: "a",
      revision: 4,
    }],
  },
  view_positions: [],
  content: [],
});

const committed = {
  actor_id: "database:library:values:renderer",
  audience: { kind: "library" },
  canonical_hash: "a".repeat(64),
  commit_id: "commit:values",
  committed_at: "2026-08-06T00:00:00.000Z",
  cursor: { store_epoch: identity.storeEpoch, commit_seq: 12 },
  duplicate: false,
  effects: [{
    kind: "property_values",
    value: { blockId: "page:values", revision: 9 },
  }],
  intent_hash: "b".repeat(64),
  operation_id: "operation:values",
  payload_completeness: "rich" as const,
  session_id: "session:values",
};

const dataSourceMetadata = () => ({
  contract_version: 4 as const,
  store_epoch: identity.storeEpoch,
  event_head: 11,
  value: {
    kind: "data_source" as const,
    value: {
      dataSource: {
        dataSourceId: "source:values",
        libraryId: identity.libraryId,
        homeDatabaseId: "database:values",
        name: "Values",
        schemaKey: "nodex.data-source",
        schemaRevision: 1,
        lifecycle: "active",
        rankKey: "a",
        createdAt: "2026-08-06T00:00:00.000Z",
        updatedAt: "2026-08-06T00:00:00.000Z",
      },
    },
  },
});

describe("canonical Data Source value mutations", () => {
  test("coalesces typed edits for one Page into one BlockRecord batch", async () => {
    const client = new FakeCoreClient();
    client.enqueueBlockRecordRead(rowWindow());
    client.enqueueBlockRecordApply(committed);

    const result = await applyCanonicalDatabaseValues({
      client,
      libraryId: identity.libraryId,
      storeEpoch: identity.storeEpoch,
      operationId: "operation:values",
      actorId: "database:library:values:renderer",
      sessionId: "session:values",
      operations: [{
        kind: "edit_property_values",
        edits: [
          {
            pageId: "page:values",
            dataSourceId: SOURCE_ID,
            propertyId: STATUS_ID,
            edit: {
              kind: "replace",
              expectedValueRevision: 2,
              value: { kind: "text", value: "done" },
            },
          },
          {
            pageId: "page:values",
            dataSourceId: SOURCE_ID,
            propertyId: TAGS_ID,
            edit: {
              kind: "patch_set",
              delta: {
                kind: "multi_select",
                addOptionIds: [ADD_TAG_ID],
                removeOptionIds: [REMOVE_TAG_ID],
              },
            },
          },
        ],
      }],
    });

    expect(result).toMatchObject({
      dataSourceIds: ["source:values"],
      pageIds: ["page:values"],
      committed: { operation_id: "operation:values" },
    });
    expect(client.blockRecordReads).toEqual([{
      kind: "window",
      parent: { kind: "data_source", id: "source:values" },
      include_content: false,
      include_descendants: false,
      include_archived: false,
    }]);
    expect(client.blockRecordApplies[0]).toMatchObject({
      operation_id: "operation:values",
      operation: {
        kind: "batch",
        operations: [{
          kind: "set_data_source_values",
          block_id: "page:values",
          data_source_id: "source:values",
          expected_block_revision: 7,
          values: [
            { property_id: STATUS_ID, value: "done", revision: 3 },
            { property_id: TAGS_ID, value: ["b", ADD_TAG_ID], revision: 2 },
          ],
        }],
      },
    });
  });

  test("rejects a stale replace before sending a Core mutation", async () => {
    const client = new FakeCoreClient();
    client.enqueueBlockRecordRead(rowWindow());

    await expect(applyCanonicalDatabaseValues({
      client,
      libraryId: identity.libraryId,
      storeEpoch: identity.storeEpoch,
      operationId: "operation:stale",
      actorId: "database:library:values:renderer",
      sessionId: "session:values",
      operations: [{
        kind: "edit_property_values",
        edits: [{
          pageId: "page:values",
          dataSourceId: SOURCE_ID,
          propertyId: STATUS_ID,
          edit: {
            kind: "replace",
            expectedValueRevision: 1,
            value: { kind: "text", value: "done" },
          },
        }],
      }],
    })).rejects.toMatchObject({
      code: "revision_conflict",
      retryable: true,
    });
    expect(client.blockRecordApplies).toHaveLength(0);
  });

  test("routes a pure Database value apply through BlockRecord authority", async () => {
    const client = new FakeCoreClient();
    client.enqueueDatabaseRead(dataSourceMetadata());
    client.enqueueBlockRecordRead(rowWindow());
    client.enqueueBlockRecordApply({
      ...committed,
      operation_id: "operation:adapter-values",
      commit_id: "commit:adapter-values",
    });
    const adapter = createCoreDatabaseModuleAdapter({
      client,
      projectId: "project:values",
      libraryId: identity.libraryId,
      storeEpoch: identity.storeEpoch,
    });

    await expect(adapter.apply({
      version: DATABASE_MODULE_V2_CONTRACT_VERSION,
      operationId: "operation:adapter-values",
      projectId: "project:values",
      storeEpoch: identity.storeEpoch,
      actor: { kind: "electron_renderer", clientId: "renderer:values" },
      operations: [{
        kind: "edit_property_values",
        edits: [{
          pageId: "page:values",
          dataSourceId: SOURCE_ID,
          propertyId: STATUS_ID,
          edit: {
            kind: "replace",
            expectedValueRevision: 2,
            value: { kind: "text", value: "done" },
          },
        }],
      }],
    })).resolves.toMatchObject({
      ok: true,
      value: {
        operationId: "operation:adapter-values",
        affectedDatabaseIds: ["database:values"],
        affectedDataSourceIds: ["source:values"],
        affectedPageIds: ["page:values"],
        affectedViewIds: [],
        committedRevisions: { "page:page:values:record": 9 },
        changeLogSeq: 12,
      },
    });
    expect(client.databaseApplies).toHaveLength(0);
  });

  test("overlays canonical values when projecting an existing View row", () => {
    const row: CoreDatabaseRowSummary = {
      created_at: "2026-08-06T00:00:00.000Z",
      database_value_revisions: { status: 2 },
      database_values: { status: "todo" },
      description_length: 0,
      description_preview: "",
      document_generation: 1,
      document_head_seq: 1,
      document_id: "document:values",
      has_description: false,
      intrinsic_properties: {},
      lifecycle: "active",
      membership_created_at: "2026-08-06T00:00:00.000Z",
      membership_id: "membership:values",
      membership_revision: 1,
      metadata_revision: 7,
      page_id: "page:values",
      parent_revision: 4,
      rich_title: [],
      title: "Values",
      updated_at: "2026-08-06T00:00:00.000Z",
    };
    const canonicalWindow: BlockRecordWindow = {
      libraryId: identity.libraryId,
      rootParent: { kind: "dataSource", dataSourceId: "source:values" },
      viewId: null,
      records: [{
        id: "page:values",
        libraryId: identity.libraryId,
        kind: "page",
        lifecycle: "active",
        properties: {
          title: "Values (canonical)",
          dataSourceValues: [{ propertyId: "status", value: "done", revision: 3 }],
        },
        contentShardId: "shard:values",
        revision: 9,
      }],
      placements: [],
      viewPositions: [],
      content: [],
      observedLocalCommit: { storeEpoch: identity.storeEpoch, commitSeq: 12 },
      continuation: null,
    };

    expect(overlayCanonicalDatabaseRows([row], canonicalWindow)[0]).toMatchObject({
      title: "Values (canonical)",
      database_values: { status: "done" },
      database_value_revisions: { status: 3 },
      metadata_revision: 9,
    });
  });
});
