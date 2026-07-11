import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import * as Y from "yjs";
import {
  CARD_DOCUMENT_SCHEMA_KEY,
  CARD_DOCUMENT_SCHEMA_VERSION,
  createCardDocument,
  openCardDocument,
  type DocumentHead,
  type DocumentSyncApplyAck,
  type DocumentSyncApplyRequest,
  type DocumentSyncResponse,
} from "../shared/block-documents";
import {
  BlockDocumentRuntime,
  type BlockDocumentRuntimeAuthority,
} from "./block-document-runtime";
import {
  BlockDocumentStoreError,
  type BlockDocumentRuntimeIdentity,
  type BlockDocumentStoreErrorCode,
  type LoadedBlockDocument,
} from "./local-store/block-document-store";

interface AuthorityDocument {
  readonly documentId: string;
  readonly projectId: string;
  readonly ownerBlockId: string;
  readonly document: Y.Doc;
  generation: number;
  headSeq: number;
}

interface CommittedUpdate {
  readonly committedSeq: number;
}

const hashBytes = (value: Uint8Array): string =>
  createHash("sha256").update(value).digest("hex");

const bytesEqual = (left: Uint8Array, right: Uint8Array): boolean => {
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
};

const emptyStateVector = (): Uint8Array => {
  const document = new Y.Doc();
  try {
    return Y.encodeStateVector(document);
  } finally {
    document.destroy();
  }
};

const cloneHead = (head: DocumentHead): DocumentHead => ({
  ...head,
  stateVector: head.stateVector.slice(),
});

class InMemoryBlockDocumentAuthority implements BlockDocumentRuntimeAuthority {
  private readonly documents = new Map<string, AuthorityDocument>();
  private readonly committedUpdates = new Map<string, CommittedUpdate>();
  private readonly identityReads = new Map<string, number>();
  private readonly loads = new Map<string, number>();
  private readonly nextApplyFailures = new Map<
    string,
    BlockDocumentStoreErrorCode
  >();
  private storeEpoch = "store-1";

  constructor(
    seeds: readonly {
      readonly documentId: string;
      readonly title: string;
      readonly projectId?: string;
    }[],
  ) {
    for (const seed of seeds) {
      const envelope = createCardDocument({
        documentId: seed.documentId,
        initialTitle: seed.title,
      });
      this.documents.set(seed.documentId, {
        documentId: seed.documentId,
        projectId: seed.projectId ?? "project-1",
        ownerBlockId: `block:${seed.documentId}`,
        document: envelope.document,
        generation: 1,
        headSeq: 1,
      });
    }
  }

  readIdentity = (documentId: string): BlockDocumentRuntimeIdentity => {
    this.identityReads.set(documentId, this.readCount(documentId) + 1);
    return this.identityFor(this.requireDocument(documentId));
  };

  load = (documentId: string): LoadedBlockDocument => {
    const source = this.requireDocument(documentId);
    this.loads.set(documentId, this.loadCount(documentId) + 1);
    const document = new Y.Doc({ guid: documentId });
    Y.applyUpdate(document, Y.encodeStateAsUpdate(source.document));
    const identity = this.identityFor(source);
    return {
      storeEpoch: identity.storeEpoch,
      authority: identity.authority,
      ownerType: "card",
      head: cloneHead(identity.head),
      document,
    };
  };

  applyUpdate = (
    input: DocumentSyncApplyRequest,
  ): DocumentSyncApplyAck => {
    const source = this.requireDocument(input.documentId);
    const failure = this.nextApplyFailures.get(input.documentId);
    if (failure) {
      this.nextApplyFailures.delete(input.documentId);
      throw new BlockDocumentStoreError(failure, `Injected ${failure}`);
    }

    const committedKey = `${input.documentId}:${input.updateId}`;
    const committed = this.committedUpdates.get(committedKey);
    if (committed) {
      return this.makeAck(source, input.updateId, committed.committedSeq, true);
    }

    Y.applyUpdate(source.document, input.update);
    if (
      source.document.store.pendingStructs !== null
      || source.document.store.pendingDs !== null
    ) {
      throw new BlockDocumentStoreError(
        "document_update_missing_dependencies",
        "The injected update has unresolved dependencies",
      );
    }

    source.headSeq += 1;
    this.committedUpdates.set(committedKey, {
      committedSeq: source.headSeq,
    });
    return this.makeAck(source, input.updateId, source.headSeq, false);
  };

  getProjectId = (documentId: string): string =>
    this.requireDocument(documentId).projectId;

  readCount = (documentId: string): number =>
    this.identityReads.get(documentId) ?? 0;

  loadCount = (documentId: string): number =>
    this.loads.get(documentId) ?? 0;

  stateSize = (documentId: string): number =>
    Y.encodeStateAsUpdate(this.requireDocument(documentId).document).byteLength;

  rotateStoreEpoch = (): void => {
    this.storeEpoch = `${this.storeEpoch}:next`;
  };

  regenerate = (documentId: string): void => {
    this.requireDocument(documentId).generation += 1;
  };

  appendTitleExternally = (documentId: string, suffix: string): void => {
    const source = this.requireDocument(documentId);
    const title = openCardDocument(source.document).title;
    title.insert(title.length, suffix);
    source.headSeq += 1;
  };

  failNextApply = (
    documentId: string,
    code: BlockDocumentStoreErrorCode,
  ): void => {
    this.nextApplyFailures.set(documentId, code);
  };

  destroy = (): void => {
    for (const source of this.documents.values()) {
      source.document.destroy();
    }
    this.documents.clear();
  };

  private identityFor(
    source: AuthorityDocument,
  ): BlockDocumentRuntimeIdentity {
    const state = Y.encodeStateAsUpdate(source.document);
    return {
      storeEpoch: this.storeEpoch,
      authority: "ydoc_primary",
      head: {
        documentId: source.documentId,
        ownerBlockId: source.ownerBlockId,
        generation: source.generation,
        headSeq: source.headSeq,
        schemaKey: CARD_DOCUMENT_SCHEMA_KEY,
        schemaVersion: CARD_DOCUMENT_SCHEMA_VERSION,
        stateVector: Y.encodeStateVector(source.document),
      },
      stateHash: hashBytes(state),
    };
  }

  private makeAck(
    source: AuthorityDocument,
    updateId: string,
    committedSeq: number,
    duplicate: boolean,
  ): DocumentSyncApplyAck {
    return {
      documentId: source.documentId,
      storeEpoch: this.storeEpoch,
      generation: source.generation,
      updateId,
      committedSeq,
      headSeq: source.headSeq,
      stateVector: Y.encodeStateVector(source.document),
      duplicate,
    };
  }

  private requireDocument(documentId: string): AuthorityDocument {
    const source = this.documents.get(documentId);
    if (source) {
      return source;
    }
    throw new BlockDocumentStoreError(
      "document_not_found",
      `Document ${documentId} does not exist`,
    );
  }
}

const syncFromEmpty = (
  runtime: BlockDocumentRuntime,
  documentId: string,
): DocumentSyncResponse =>
  runtime.sync({
    documentId,
    clientSessionId: "window-1",
    stateVector: emptyStateVector(),
  });

const createTitleUpdate = (
  sync: DocumentSyncResponse,
  suffix: string,
): Uint8Array => {
  const replica = new Y.Doc({ guid: sync.documentId });
  Y.applyUpdate(replica, sync.update);
  let captured: Uint8Array | undefined;
  const listener = (update: Uint8Array): void => {
    captured = update.slice();
  };
  replica.on("update", listener);
  try {
    const title = openCardDocument(replica).title;
    title.insert(title.length, suffix);
  } finally {
    replica.off("update", listener);
    replica.destroy();
  }
  if (captured) {
    return captured;
  }
  throw new Error("Expected a title mutation update");
};

const makeApplyRequest = (
  sync: DocumentSyncResponse,
  update: Uint8Array,
  updateId: string,
): DocumentSyncApplyRequest => ({
  documentId: sync.documentId,
  storeEpoch: sync.storeEpoch,
  generation: sync.generation,
  updateId,
  clientSessionId: "window-1",
  baseHeadSeq: sync.headSeq,
  touchedBlockIds: [],
  update,
});

const readTitle = (sync: DocumentSyncResponse): string => {
  const replica = new Y.Doc({ guid: sync.documentId });
  try {
    Y.applyUpdate(replica, sync.update);
    return openCardDocument(replica).title.toString();
  } finally {
    replica.destroy();
  }
};

describe("BlockDocumentRuntime", () => {
  test("checks durable identity on every sync while loading a matching document once", () => {
    const authority = new InMemoryBlockDocumentAuthority([
      { documentId: "document:one", title: "One" },
    ]);
    const runtime = new BlockDocumentRuntime(authority);
    try {
      syncFromEmpty(runtime, "document:one");
      syncFromEmpty(runtime, "document:one");

      expect(authority.readCount("document:one")).toBe(2);
      expect(authority.loadCount("document:one")).toBe(1);
      expect(runtime.getCacheStats().entryCount).toBe(1);
    } finally {
      runtime.destroy();
      authority.destroy();
    }
  });

  test("reloads whenever the durable store epoch, generation, or head changes", () => {
    const authority = new InMemoryBlockDocumentAuthority([
      { documentId: "document:one", title: "One" },
    ]);
    const runtime = new BlockDocumentRuntime(authority);
    try {
      syncFromEmpty(runtime, "document:one");
      expect(authority.loadCount("document:one")).toBe(1);

      authority.rotateStoreEpoch();
      syncFromEmpty(runtime, "document:one");
      expect(authority.loadCount("document:one")).toBe(2);

      authority.regenerate("document:one");
      syncFromEmpty(runtime, "document:one");
      expect(authority.loadCount("document:one")).toBe(3);

      authority.appendTitleExternally("document:one", " external");
      const externallyAdvanced = syncFromEmpty(runtime, "document:one");
      expect(authority.loadCount("document:one")).toBe(4);
      expect(readTitle(externallyAdvanced)).toBe("One external");
    } finally {
      runtime.destroy();
      authority.destroy();
    }
  });

  test("explicit invalidation reloads state committed by another authority path", () => {
    const authority = new InMemoryBlockDocumentAuthority([
      { documentId: "document:one", title: "One" },
    ]);
    const runtime = new BlockDocumentRuntime(authority);
    try {
      syncFromEmpty(runtime, "document:one");
      expect(authority.loadCount("document:one")).toBe(1);

      authority.appendTitleExternally("document:one", " shadow");
      runtime.invalidate("document:one");

      const reloaded = syncFromEmpty(runtime, "document:one");
      expect(authority.loadCount("document:one")).toBe(2);
      expect(readTitle(reloaded)).toBe("One shadow");
    } finally {
      runtime.destroy();
      authority.destroy();
    }
  });

  test("advances the cached document after a durable commit without reloading", () => {
    const authority = new InMemoryBlockDocumentAuthority([
      { documentId: "document:one", title: "One" },
    ]);
    const runtime = new BlockDocumentRuntime(authority);
    try {
      const initial = syncFromEmpty(runtime, "document:one");
      const request = makeApplyRequest(
        initial,
        createTitleUpdate(initial, " updated"),
        "update-1",
      );
      const ack = runtime.applyUpdate(request);

      expect(ack.duplicate).toBeFalse();
      expect(ack.committedSeq).toBe(2);
      expect(authority.loadCount("document:one")).toBe(1);
      expect(readTitle(syncFromEmpty(runtime, "document:one"))).toBe(
        "One updated",
      );
      expect(authority.loadCount("document:one")).toBe(1);
      expect(authority.readCount("document:one")).toBe(3);
    } finally {
      runtime.destroy();
      authority.destroy();
    }
  });

  test("drops a cached document that grows beyond the byte budget after commit", () => {
    const authority = new InMemoryBlockDocumentAuthority([
      { documentId: "document:one", title: "One" },
    ]);
    const runtime = new BlockDocumentRuntime(authority, {
      maxDocuments: 4,
      maxStateBytes: authority.stateSize("document:one"),
    });
    try {
      const initial = syncFromEmpty(runtime, "document:one");
      expect(runtime.getCacheStats().entryCount).toBe(1);
      const suffix = "x".repeat(512);
      const request = makeApplyRequest(
        initial,
        createTitleUpdate(initial, suffix),
        "update-grow",
      );

      const ack = runtime.applyUpdate(request);

      expect(ack.duplicate).toBeFalse();
      expect(runtime.getCacheStats().entryCount).toBe(0);
      expect(runtime.getCacheStats().stateBytes).toBe(0);
      const reloaded = syncFromEmpty(runtime, "document:one");
      expect(readTitle(reloaded)).toBe(`One${suffix}`);
      expect(authority.loadCount("document:one")).toBe(2);
    } finally {
      runtime.destroy();
      authority.destroy();
    }
  });

  test("keeps the advanced cache on an idempotent duplicate commit", () => {
    const authority = new InMemoryBlockDocumentAuthority([
      { documentId: "document:one", title: "One" },
    ]);
    const runtime = new BlockDocumentRuntime(authority);
    try {
      const initial = syncFromEmpty(runtime, "document:one");
      const request = makeApplyRequest(
        initial,
        createTitleUpdate(initial, " updated"),
        "update-1",
      );
      runtime.applyUpdate(request);
      const duplicate = runtime.applyUpdate(request);

      expect(duplicate.duplicate).toBeTrue();
      expect(duplicate.committedSeq).toBe(2);
      expect(duplicate.headSeq).toBe(2);
      expect(authority.loadCount("document:one")).toBe(1);
      expect(readTitle(syncFromEmpty(runtime, "document:one"))).toBe(
        "One updated",
      );
      expect(authority.loadCount("document:one")).toBe(1);
    } finally {
      runtime.destroy();
      authority.destroy();
    }
  });

  test("evicts after dependency and out-of-order failures so the next sync reloads", () => {
    const cases: readonly {
      readonly documentId: string;
      readonly code: BlockDocumentStoreErrorCode;
    }[] = [
      {
        documentId: "document:missing-dependency",
        code: "document_update_missing_dependencies",
      },
      { documentId: "document:future-base", code: "future_base_head" },
    ];
    const authority = new InMemoryBlockDocumentAuthority(
      cases.map(({ documentId }) => ({ documentId, title: documentId })),
    );
    const runtime = new BlockDocumentRuntime(authority);
    try {
      for (const { documentId, code } of cases) {
        const initial = syncFromEmpty(runtime, documentId);
        const request = makeApplyRequest(
          initial,
          createTitleUpdate(initial, " update"),
          `update:${documentId}`,
        );
        authority.failNextApply(documentId, code);

        let error: unknown;
        try {
          runtime.applyUpdate(request);
        } catch (caught) {
          error = caught;
        }
        expect(error instanceof BlockDocumentStoreError).toBeTrue();
        expect((error as BlockDocumentStoreError).code).toBe(code);
        expect(authority.loadCount(documentId)).toBe(1);

        const afterFailure = syncFromEmpty(runtime, documentId);
        expect(authority.loadCount(documentId)).toBe(2);
        expect(readTitle(afterFailure)).toBe(documentId);
      }
    } finally {
      runtime.destroy();
      authority.destroy();
    }
  });

  test("a new runtime reloads durable state after restart", () => {
    const authority = new InMemoryBlockDocumentAuthority([
      { documentId: "document:one", title: "Persistent" },
    ]);
    const firstRuntime = new BlockDocumentRuntime(authority);
    try {
      syncFromEmpty(firstRuntime, "document:one");
      expect(authority.loadCount("document:one")).toBe(1);
    } finally {
      firstRuntime.destroy();
    }

    const restartedRuntime = new BlockDocumentRuntime(authority);
    try {
      const restarted = syncFromEmpty(restartedRuntime, "document:one");
      expect(readTitle(restarted)).toBe("Persistent");
      expect(authority.loadCount("document:one")).toBe(2);
    } finally {
      restartedRuntime.destroy();
      authority.destroy();
    }
  });

  test("evicts the least-recently-used document when the count budget is full", () => {
    const authority = new InMemoryBlockDocumentAuthority([
      { documentId: "document:one", title: "One" },
      { documentId: "document:two", title: "Two" },
      { documentId: "document:three", title: "Three" },
    ]);
    const runtime = new BlockDocumentRuntime(authority, {
      maxDocuments: 2,
      maxStateBytes: 1024 * 1024,
    });
    try {
      syncFromEmpty(runtime, "document:one");
      syncFromEmpty(runtime, "document:two");
      syncFromEmpty(runtime, "document:one");
      syncFromEmpty(runtime, "document:three");

      expect(runtime.getCacheStats().entryCount).toBe(2);
      expect(authority.loadCount("document:one")).toBe(1);
      expect(authority.loadCount("document:two")).toBe(1);
      expect(authority.loadCount("document:three")).toBe(1);

      syncFromEmpty(runtime, "document:one");
      syncFromEmpty(runtime, "document:two");
      expect(authority.loadCount("document:one")).toBe(1);
      expect(authority.loadCount("document:two")).toBe(2);
    } finally {
      runtime.destroy();
      authority.destroy();
    }
  });

  test("does not retain a document larger than the byte budget", () => {
    const authority = new InMemoryBlockDocumentAuthority([
      { documentId: "document:large", title: "A sufficiently large state" },
    ]);
    expect(authority.stateSize("document:large") > 1).toBeTrue();
    const runtime = new BlockDocumentRuntime(authority, {
      maxDocuments: 4,
      maxStateBytes: 1,
    });
    try {
      syncFromEmpty(runtime, "document:large");
      syncFromEmpty(runtime, "document:large");

      expect(authority.loadCount("document:large")).toBe(2);
      expect(runtime.getCacheStats().entryCount).toBe(0);
      expect(runtime.getCacheStats().stateBytes).toBe(0);
    } finally {
      runtime.destroy();
      authority.destroy();
    }
  });

  test("evicts the least-recently-used document when the byte budget is full", () => {
    const authority = new InMemoryBlockDocumentAuthority([
      { documentId: "document:one", title: "One" },
      { documentId: "document:two", title: "Two" },
    ]);
    const maxStateBytes = Math.max(
      authority.stateSize("document:one"),
      authority.stateSize("document:two"),
    );
    const runtime = new BlockDocumentRuntime(authority, {
      maxDocuments: 4,
      maxStateBytes,
    });
    try {
      syncFromEmpty(runtime, "document:one");
      syncFromEmpty(runtime, "document:two");

      expect(runtime.getCacheStats().entryCount).toBe(1);
      expect(runtime.getCacheStats().stateBytes <= maxStateBytes).toBeTrue();
      expect(authority.loadCount("document:one")).toBe(1);
      expect(authority.loadCount("document:two")).toBe(1);

      syncFromEmpty(runtime, "document:one");
      expect(authority.loadCount("document:one")).toBe(2);
    } finally {
      runtime.destroy();
      authority.destroy();
    }
  });

  test("returns copied bytes that cannot mutate cached document state", () => {
    const authority = new InMemoryBlockDocumentAuthority([
      { documentId: "document:one", title: "Immutable" },
    ]);
    const runtime = new BlockDocumentRuntime(authority);
    try {
      const first = syncFromEmpty(runtime, "document:one");
      const expectedUpdate = first.update.slice();
      const expectedStateVector = first.stateVector.slice();
      first.update.fill(255);
      first.stateVector.fill(255);

      const second = syncFromEmpty(runtime, "document:one");
      expect(bytesEqual(second.update, expectedUpdate)).toBeTrue();
      expect(bytesEqual(second.stateVector, expectedStateVector)).toBeTrue();
      expect(readTitle(second)).toBe("Immutable");

      const request = makeApplyRequest(
        second,
        createTitleUpdate(second, " durable"),
        "update-1",
      );
      const ack = runtime.applyUpdate(request);
      const expectedAckStateVector = ack.stateVector.slice();
      ack.stateVector.fill(255);

      const afterCommit = syncFromEmpty(runtime, "document:one");
      expect(bytesEqual(afterCommit.stateVector, expectedAckStateVector)).toBeTrue();
      expect(readTitle(afterCommit)).toBe("Immutable durable");
      expect(authority.loadCount("document:one")).toBe(1);
    } finally {
      runtime.destroy();
      authority.destroy();
    }
  });
});
