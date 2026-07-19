import { describe, expect, test, vi } from "vitest";

import { CoreModuleResponseError } from "./core-client";
import { createCoreDocumentSyncAdapter } from "./document-sync-adapter";
import { FakeCoreClient } from "./testing/fake-core-client";

const descriptorSnapshot = () => ({
  version: 1 as const,
  store_epoch: "epoch:test",
  event_head: 4,
  value: {
    kind: "descriptor" as const,
    descriptor: {
      version: 2,
      projectId: "project:one",
      ownerBlockId: "page:one",
      ownerType: "page",
      ownerLifecycle: "active",
      documentId: "document:one",
      storeEpoch: "epoch:test",
      generation: 1,
      headSeq: 2,
      schemaKey: "nodex.page",
      schemaVersion: 1,
      readiness: "ready",
      sync: { kind: "yjs", stateVector: [] },
    },
  },
});

const documentVersionSummary = () => ({
  versionId: `document-version:${"a".repeat(64)}`,
  documentId: "document:one",
  projectId: "project:one",
  generation: 1,
  baseHeadSeq: 2,
  schemaKey: "nodex.page",
  schemaVersion: 1,
  cause: "manual",
  label: "Before refactor",
  actor: { kind: "electron_renderer", clientId: "renderer:history" },
  revisionKind: "manual",
  sourceMutationId: null,
  sourceChangeSeq: null,
  pinned: true,
  checkpointHash: "b".repeat(64),
  materializationHash: "c".repeat(64),
  byteLength: 128,
  materializationKind: "page",
  title: "History",
  preview: "Checkpoint preview",
  blockCount: 1,
  createdAt: "2026-07-19T21:10:00.000Z",
  checkpointMetadata: { format: "block_tree_snapshot_v2" },
});

const documentVersionDetail = () => ({
  summary: documentVersionSummary(),
  materialization: {
    kind: "page",
    schemaVersion: 1,
    title: "History",
    richTitle: [{ type: "text", text: "History", styles: {} }],
    blockTree: [{
      id: "block:history",
      type: "paragraph",
      props: {},
      content: [],
      children: [],
    }],
    nfm: "Checkpoint preview",
    plainText: "Checkpoint preview",
    preview: "Checkpoint preview",
    references: [],
    assetRefs: [],
  },
});

describe("Core Document sync adapter", () => {
  test("reads and prepares an exact Owned Document descriptor", async () => {
    const client = new FakeCoreClient();
    const adapter = createCoreDocumentSyncAdapter(client);
    client.enqueueDocumentRead(descriptorSnapshot());

    await expect(adapter.readDescriptor({
      ownerBlockId: "page:one",
      clientSessionId: "renderer:descriptor",
    })).resolves.toMatchObject({
      projectId: "project:one",
      ownerBlockId: "page:one",
      documentId: "document:one",
      headSeq: 2,
    });

    client.enqueueDocumentApply({
      store_epoch: "epoch:test",
      event_sequence: 4,
      value: {
        document_id: "document:one",
        generation: 1,
        head_seq: 2,
        outcome: "no_change",
      },
      receipt: {
        operation_id: "prepare:one",
        duplicate: false,
        document_id: "document:one",
        generation: 1,
        head_seq: 2,
      },
    });
    client.enqueueDocumentRead(descriptorSnapshot());
    await expect(adapter.prepareOwner({
      ownerBlockId: "page:one",
      operationId: "prepare:one",
      clientSessionId: "renderer:prepare",
    })).resolves.toMatchObject({
      ok: true,
      value: {
        projectId: "project:one",
        ownerBlockId: "page:one",
        documentId: "document:one",
      },
    });
    expect(client.documentApplies).toEqual([{
      operationId: "prepare:one",
      clientSessionId: "renderer:prepare",
      intent: { kind: "prepare_owner", owner_block_id: "page:one" },
    }]);
  });

  test("tracks subscriptions by exact Document and client session", async () => {
    const client = new FakeCoreClient();
    const adapter = createCoreDocumentSyncAdapter(client);
    const first = {
      documentId: "document:first",
      clientSessionId: "renderer:shared",
    } as const;
    const second = {
      documentId: "document:second",
      clientSessionId: "renderer:shared",
    } as const;
    const closeFirst = adapter.subscribe(first, () => undefined);
    adapter.subscribe(second, () => undefined);
    client.enqueueDocumentSync({
      documentId: second.documentId,
      storeEpoch: "epoch:test",
      generation: 1,
      headSeq: 1,
      update: new Uint8Array(),
      stateVector: new Uint8Array(),
    });

    closeFirst();

    await expect(adapter.sync({
      ...first,
      stateVector: new Uint8Array(),
    })).resolves.toMatchObject({
      ok: false,
      error: { code: "transport_unavailable" },
    });
    await expect(adapter.sync({
      ...second,
      stateVector: new Uint8Array(),
    })).resolves.toMatchObject({
      ok: true,
      value: { documentId: second.documentId },
    });
  });

  test("maps Additional Document owner commands and durable receipts", async () => {
    const client = new FakeCoreClient();
    const adapter = createCoreDocumentSyncAdapter(client);
    client.enqueueDocumentApply({
      store_epoch: "epoch:test",
      event_sequence: 12,
      value: {
        document_id: "document:source",
        generation: 1,
        head_seq: 1,
        outcome: "committed",
        committed_at: "2026-07-19T21:00:00.000Z",
        owner_effect: {
          created_block_ids: ["block:source", "block:content"],
          preserved_block_ids: [],
          deleted_block_ids: [],
          document_heads: [{
            document_id: "document:source",
            generation: 1,
            head_seq: 1,
          }],
        },
      },
      receipt: {
        operation_id: "owner:create",
        duplicate: false,
        document_id: "document:source",
        generation: 1,
        head_seq: 1,
      },
    });

    const result = await adapter.applyAdditionalDocumentCommand({
      version: 1,
      operationId: "owner:create",
      projectId: "project:one",
      storeEpoch: "epoch:test",
      clientSessionId: "renderer:one",
      actor: { kind: "electron_renderer" },
      coordination: { kind: "fifo_only" },
      operation: {
        kind: "create_synced_source",
        sourceBlockId: "block:source",
        documentId: "document:source",
        initialBlocks: [{
          id: "block:content",
          type: "paragraph",
          props: {},
          children: [],
        }],
        placement: { kind: "space" },
      },
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        operationId: "owner:create",
        projectId: "project:one",
        duplicate: false,
        changeLogSeq: 12,
        committedAt: "2026-07-19T21:00:00.000Z",
        semanticHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        effect: {
          createdBlockIds: ["block:source", "block:content"],
          documentHeads: [{
            documentId: "document:source",
            generation: 1,
            headSeq: 1,
          }],
        },
      },
    });
    expect(client.documentApplies).toEqual([{
      operationId: "owner:create",
      clientSessionId: "renderer:one",
      intent: {
        kind: "apply_owner_command",
        command: {
          kind: "create_synced_source",
          source_block_id: "block:source",
          document_id: "document:source",
          initial_blocks: [{
            id: "block:content",
            type: "paragraph",
            props: {},
            children: [],
          }],
          before: undefined,
        },
      },
    }]);
  });

  test("maps checkpoint creation and exact history pagination through Core", async () => {
    const client = new FakeCoreClient();
    const adapter = createCoreDocumentSyncAdapter(client);
    const checkpointRequest = {
      version: 1 as const,
      projectId: "project:one",
      storeEpoch: "epoch:test",
      documentId: "document:one",
      expectedGeneration: 1,
      expectedHeadSeq: 2,
      cause: "manual",
      label: "Before refactor",
      actor: {
        kind: "electron_renderer",
        clientId: "renderer:history",
      },
      revisionKind: "manual" as const,
    };
    const apply = vi.spyOn(client, "documentApply").mockImplementationOnce(
      async (input) => ({
        store_epoch: "epoch:test",
        event_sequence: 8,
        value: {
          document_id: checkpointRequest.documentId,
          generation: checkpointRequest.expectedGeneration,
          head_seq: checkpointRequest.expectedHeadSeq,
          outcome: "no_change",
          checkpoint_effect: {
            checkpoint: documentVersionSummary(),
            duplicate: false,
          },
        },
        receipt: {
          operation_id: input.operationId,
          duplicate: false,
          document_id: checkpointRequest.documentId,
          generation: checkpointRequest.expectedGeneration,
          head_seq: checkpointRequest.expectedHeadSeq,
        },
      }),
    );

    await expect(adapter.createCheckpoint(checkpointRequest)).resolves.toEqual({
      ok: true,
      value: {
        checkpoint: documentVersionSummary(),
        duplicate: false,
      },
    });
    expect(apply).toHaveBeenCalledWith({
      operationId: expect.stringMatching(
        /^electron:document-checkpoint:[a-f0-9]{64}$/u,
      ),
      clientSessionId: "electron:document-history",
      intent: {
        kind: "create_checkpoint",
        document_id: checkpointRequest.documentId,
        generation: 1,
        expected_head_seq: 2,
        cause: "manual",
        label: "Before refactor",
        actor: checkpointRequest.actor,
        revision_kind: "manual",
        source_mutation_id: undefined,
        source_change_seq: undefined,
      },
    });
    const before = {
      baseHeadSeq: 2,
      createdAt: "2026-07-19T21:10:00.000Z",
      versionId: documentVersionSummary().versionId,
    };
    client.enqueueDocumentRead({
      version: 1,
      store_epoch: "epoch:test",
      event_head: 8,
      value: {
        kind: "versions",
        items: [documentVersionSummary()],
        next: {
          base_head_seq: before.baseHeadSeq,
          created_at: before.createdAt,
          version_id: before.versionId,
        },
      },
    });
    await expect(adapter.listVersions({
      projectId: "project:one",
      documentId: "document:one",
      before,
      limit: 25,
    })).resolves.toEqual({ ok: true, value: [documentVersionSummary()] });
    expect(client.documentReads[0]).toEqual({
      clientSessionId: "electron:document-history",
      read: {
        kind: "list_versions",
        document_id: "document:one",
        before: {
          base_head_seq: before.baseHeadSeq,
          created_at: before.createdAt,
          version_id: before.versionId,
        },
        limit: 25,
      },
    });

    client.enqueueDocumentRead({
      version: 1,
      store_epoch: "epoch:test",
      event_head: 8,
      value: { kind: "version", value: documentVersionDetail() },
    });
    await expect(adapter.getVersion({
      projectId: "project:one",
      documentId: "document:one",
      versionId: documentVersionSummary().versionId,
    })).resolves.toEqual({ ok: true, value: documentVersionDetail() });
  });

  test("uses a placeholder execution head only for durable owner receipt replay", async () => {
    const client = new FakeCoreClient();
    const adapter = createCoreDocumentSyncAdapter(client);
    client.enqueueDocumentApply({
      store_epoch: "epoch:test",
      event_sequence: 15,
      value: {
        document_id: "document:source",
        generation: 1,
        head_seq: 7,
        outcome: "committed",
        committed_at: "2026-07-19T21:02:00.000Z",
        owner_effect: {
          created_block_ids: [],
          preserved_block_ids: ["block:content"],
          deleted_block_ids: ["block:source"],
          document_heads: [{
            document_id: "document:source",
            generation: 1,
            head_seq: 7,
          }],
        },
      },
      receipt: {
        operation_id: "owner:delete",
        duplicate: true,
        document_id: "document:source",
        generation: 1,
        head_seq: 7,
      },
    });

    await expect(adapter.applyAdditionalDocumentCommand({
      version: 1,
      operationId: "owner:delete",
      projectId: "project:one",
      storeEpoch: "epoch:test",
      clientSessionId: "renderer:reconnected",
      actor: { kind: "electron_renderer" },
      coordination: { kind: "receipt_replay" },
      operation: {
        kind: "delete_owned_source",
        ownerKind: "synced_block",
        owner: {
          ownerBlockId: "block:source",
          documentId: "document:source",
          generation: 1,
          metadataRevision: 2,
          locationRevision: 3,
        },
        referencePolicy: "require_unreferenced",
      },
    })).resolves.toMatchObject({
      ok: true,
      value: { operationId: "owner:delete", duplicate: true },
    });
    expect(client.documentApplies[0]?.intent).toMatchObject({
      kind: "apply_owner_command",
      command: {
        kind: "delete_owned_source",
        owner: { head_seq: 0 },
      },
    });
  });

  test("preserves domain-specific owner command conflicts", async () => {
    const client = new FakeCoreClient();
    const adapter = createCoreDocumentSyncAdapter(client);
    vi.spyOn(client, "documentApply").mockRejectedValueOnce(
      new CoreModuleResponseError({
        code: "core_unavailable",
        message: "Identity already exists in blocks: block:source",
        retryable: false,
        recovery: { kind: "none" },
      }),
    );
    const request = {
      version: 1 as const,
      operationId: "owner:create-conflict",
      projectId: "project:one",
      storeEpoch: "epoch:test",
      clientSessionId: "renderer:one",
      actor: { kind: "electron_renderer" },
      coordination: { kind: "fifo_only" as const },
      operation: {
        kind: "create_synced_source" as const,
        sourceBlockId: "block:source",
        documentId: "document:source",
        initialBlocks: [{
          id: "block:content",
          type: "paragraph",
          props: {},
          children: [],
        }],
        placement: { kind: "space" as const },
      },
    };

    await expect(adapter.applyAdditionalDocumentCommand(request)).resolves
      .toMatchObject({
        ok: false,
        error: {
          code: "identity_conflict",
          operationId: request.operationId,
          operationKind: request.operation.kind,
          retryable: false,
        },
      });
  });
});
