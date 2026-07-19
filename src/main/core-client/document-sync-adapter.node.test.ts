import { describe, expect, test } from "vitest";

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
});
