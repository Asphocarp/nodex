import { describe, expect, test } from "vitest";
import * as Y from "yjs";
import {
  createCardDocument,
  openCardDocument,
} from "../../shared/block-documents";
import {
  DocumentLocalCheckpointError,
  captureDocumentLocalCheckpoint,
  hasDocumentUpdateContent,
  restoreDocumentLocalCheckpoint,
} from "./document-local-checkpoint";

const boundary = {
  documentId: "document:card-1",
  storeEpoch: "store-1",
  generation: 1,
  headSeq: 4,
} as const;

describe("document local checkpoints", () => {
  test("recovers only local causal state missing from the durable server", () => {
    const server = createCardDocument({
      documentId: boundary.documentId,
      initialTitle: "Base",
    }).document;
    const local = new Y.Doc({ guid: boundary.documentId });
    Y.applyUpdate(local, Y.encodeStateAsUpdate(server));
    openCardDocument(local).title.insert(4, " local");
    const checkpoint = captureDocumentLocalCheckpoint(local, boundary);

    const restarted = new Y.Doc({ guid: boundary.documentId });
    Y.applyUpdate(restarted, Y.encodeStateAsUpdate(server));
    const missing = restoreDocumentLocalCheckpoint(
      restarted,
      Y.encodeStateVector(server),
      checkpoint,
      "local-checkpoint",
    );

    expect(hasDocumentUpdateContent(missing)).toBe(true);
    Y.applyUpdate(server, missing);
    expect(openCardDocument(server).title.toString()).toBe("Base local");
    expect(openCardDocument(restarted).title.toString()).toBe("Base local");
    server.destroy();
    local.destroy();
    restarted.destroy();
  });

  test("returns an empty causal diff when the server already committed the cache", () => {
    const server = createCardDocument({
      documentId: boundary.documentId,
      initialTitle: "Committed",
    }).document;
    const checkpoint = captureDocumentLocalCheckpoint(server, boundary);
    const restarted = new Y.Doc({ guid: boundary.documentId });
    Y.applyUpdate(restarted, Y.encodeStateAsUpdate(server));

    const missing = restoreDocumentLocalCheckpoint(
      restarted,
      Y.encodeStateVector(server),
      checkpoint,
      "local-checkpoint",
    );

    expect(hasDocumentUpdateContent(missing)).toBe(false);
    server.destroy();
    restarted.destroy();
  });

  test("validates a corrupt checkpoint before mutating the mounted document", () => {
    const mounted = createCardDocument({
      documentId: boundary.documentId,
      initialTitle: "Safe",
    }).document;
    const before = Y.encodeStateAsUpdate(mounted);
    const corrupt = new Y.Doc({ guid: boundary.documentId });
    corrupt.getMap("hidden").set("payload", true);
    let rejected = false;
    try {
      restoreDocumentLocalCheckpoint(
        mounted,
        Y.encodeStateVector(mounted),
        {
          ...boundary,
          state: Y.encodeStateAsUpdate(corrupt),
          updatedAt: "2026-07-11T00:00:00.000Z",
        },
        "local-checkpoint",
      );
    } catch (error) {
      rejected = error instanceof DocumentLocalCheckpointError;
    }

    expect(rejected).toBe(true);
    const after = Y.encodeStateAsUpdate(mounted);
    expect(Buffer.from(after).equals(Buffer.from(before))).toBe(true);
    mounted.destroy();
    corrupt.destroy();
  });
});
