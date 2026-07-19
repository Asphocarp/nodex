import { describe, expect, test } from "vitest";

import { createCoreDocumentSyncAdapter } from "./document-sync-adapter";
import { FakeCoreClient } from "./testing/fake-core-client";

describe("Core Document sync adapter", () => {
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
