import { describe, expect, test } from "bun:test";
import * as Y from "yjs";
import type {
  DocumentAwarenessPublishRequest,
  DocumentSyncApplyAck,
  DocumentSyncApplyRequest,
  DocumentSyncCommandResult,
  DocumentSyncRealtimeEvent,
  DocumentSyncRequest,
  DocumentSyncResponse,
  DocumentSyncSubscribeRequest,
} from "../../shared/block-documents/document-sync";
import {
  BLOCK_GROUP_NODE_NAME,
  BLOCK_ID_ATTRIBUTE,
  captureXmlSubtreeAt,
  createCardDocument,
  deleteXmlSubtreeAt,
  insertPortableXmlSubtree,
  openCardDocument,
} from "../../shared/block-documents";
import {
  createCardDocumentGenesis,
  materializeCardDocument,
} from "../../shared/block-documents/block-document-codec";
import type {
  DocumentCheckpointBoundary,
  DocumentLocalCheckpoint,
  DocumentLocalCheckpointStore,
} from "./document-local-checkpoint";
import {
  NodexYProvider,
  type DocumentSyncAdapter,
  type NodexYProviderRetryScheduler,
} from "./nodex-y-provider";

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
}

const deferred = <T>(): Deferred<T> => {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  if (!resolvePromise) {
    throw new Error("Could not create deferred promise");
  }
  return { promise, resolve: resolvePromise };
};

const success = <T>(value: T): DocumentSyncCommandResult<T> => ({
  ok: true,
  value,
});

const waitUntil = async (predicate: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) {
      return;
    }
    await Promise.resolve();
  }
  throw new Error("Condition did not settle");
};

const captureUpdate = (document: Y.Doc, mutate: () => void): Uint8Array => {
  let captured: Uint8Array | undefined;
  const listener = (update: Uint8Array) => {
    captured = update.slice();
  };
  document.on("update", listener);
  try {
    mutate();
  } finally {
    document.off("update", listener);
  }
  if (!captured) {
    throw new Error("Mutation did not produce a Yjs update");
  }
  return captured;
};

const getRootBlockGroup = (document: Y.Doc): Y.XmlElement => {
  const root = openCardDocument(document).body.toArray()[0];
  if (
    !(root instanceof Y.XmlElement) ||
    root.nodeName !== BLOCK_GROUP_NODE_NAME
  ) {
    throw new TypeError("Expected the canonical Card body blockGroup");
  }
  return root;
};

const findBlockElement = (document: Y.Doc, blockId: string): Y.XmlElement => {
  for (const node of openCardDocument(document).body.createTreeWalker(
    (candidate) => candidate instanceof Y.XmlElement,
  )) {
    if (
      node instanceof Y.XmlElement &&
      node.getAttribute(BLOCK_ID_ATTRIBUTE) === blockId
    ) {
      return node;
    }
  }
  throw new Error(`Could not find Block ${blockId}`);
};

const getFirstBlockText = (block: Y.XmlElement): Y.XmlText => {
  for (const node of block.createTreeWalker(
    (candidate) => candidate instanceof Y.XmlText,
  )) {
    if (node instanceof Y.XmlText) return node;
  }
  throw new TypeError("Expected the Block to contain text");
};

const getChildBlockGroup = (block: Y.XmlElement): Y.XmlElement | null =>
  block
    .toArray()
    .find(
      (node): node is Y.XmlElement =>
        node instanceof Y.XmlElement && node.nodeName === BLOCK_GROUP_NODE_NAME,
    ) ?? null;

const deleteDirectBlock = (group: Y.XmlElement, blockId: string): void => {
  const index = group
    .toArray()
    .findIndex(
      (node) =>
        node instanceof Y.XmlElement &&
        node.getAttribute(BLOCK_ID_ATTRIBUTE) === blockId,
    );
  if (index < 0) throw new Error(`Could not delete Block ${blockId}`);
  deleteXmlSubtreeAt(group, index);
};

const checkpointKey = (boundary: DocumentCheckpointBoundary): string =>
  JSON.stringify([
    boundary.documentId,
    boundary.storeEpoch,
    boundary.generation,
  ]);

class MemoryDocumentLocalCheckpointStore implements DocumentLocalCheckpointStore {
  private readonly checkpoints = new Map<string, DocumentLocalCheckpoint>();
  writeGate: Promise<void> | null = null;

  read = async (
    boundary: DocumentCheckpointBoundary,
  ): Promise<DocumentLocalCheckpoint | null> => {
    const checkpoint = this.checkpoints.get(checkpointKey(boundary));
    return checkpoint
      ? { ...checkpoint, state: checkpoint.state.slice() }
      : null;
  };

  write = async (checkpoint: DocumentLocalCheckpoint): Promise<void> => {
    await this.writeGate;
    const key = checkpointKey(checkpoint);
    const existing = this.checkpoints.get(key);
    this.checkpoints.set(key, {
      ...checkpoint,
      headSeq: Math.max(existing?.headSeq ?? 0, checkpoint.headSeq),
      state: existing
        ? Y.mergeUpdates([existing.state, checkpoint.state])
        : checkpoint.state.slice(),
    });
  };

  clearDocument = async (documentId: string): Promise<void> => {
    for (const [key, checkpoint] of this.checkpoints) {
      if (checkpoint.documentId === documentId) {
        this.checkpoints.delete(key);
      }
    }
  };
}

const seedCanonicalCardDocument = (
  adapter: MemoryDocumentSyncAdapter,
  title: string,
): void => {
  const genesis = createCardDocument({
    documentId: "document-1",
    initialTitle: title,
  });
  try {
    Y.applyUpdate(
      adapter.serverDocument,
      Y.encodeStateAsUpdate(genesis.document),
    );
    adapter.headSeq = 1;
  } finally {
    genesis.document.destroy();
  }
};

class MemoryDocumentSyncAdapter implements DocumentSyncAdapter {
  readonly serverDocument = new Y.Doc({ guid: "document-1" });
  readonly syncCalls: DocumentSyncRequest[] = [];
  readonly applyCalls: DocumentSyncApplyRequest[] = [];
  readonly awarenessCalls: DocumentAwarenessPublishRequest[] = [];
  readonly listeners = new Set<(event: DocumentSyncRealtimeEvent) => void>();
  readonly committedAcks = new Map<string, DocumentSyncApplyAck>();
  storeEpoch = "store-1";
  generation = 1;
  headSeq = 0;
  activeApplyCalls = 0;
  maxActiveApplyCalls = 0;
  emitApplyEcho = true;
  applyHandler:
    | ((
        request: DocumentSyncApplyRequest,
      ) => Promise<DocumentSyncCommandResult<DocumentSyncApplyAck>>)
    | null = null;

  sync = async (
    request: DocumentSyncRequest,
  ): Promise<DocumentSyncCommandResult<DocumentSyncResponse>> => {
    this.syncCalls.push(request);
    return success({
      documentId: request.documentId,
      storeEpoch: this.storeEpoch,
      generation: this.generation,
      headSeq: this.headSeq,
      stateVector: Y.encodeStateVector(this.serverDocument),
      update: Y.encodeStateAsUpdate(this.serverDocument, request.stateVector),
    });
  };

  applyUpdate = async (
    request: DocumentSyncApplyRequest,
  ): Promise<DocumentSyncCommandResult<DocumentSyncApplyAck>> => {
    this.applyCalls.push(request);
    this.activeApplyCalls += 1;
    this.maxActiveApplyCalls = Math.max(
      this.maxActiveApplyCalls,
      this.activeApplyCalls,
    );
    try {
      if (this.applyHandler) {
        return await this.applyHandler(request);
      }
      return this.commit(request);
    } finally {
      this.activeApplyCalls -= 1;
    }
  };

  subscribe = (
    _request: DocumentSyncSubscribeRequest,
    listener: (event: DocumentSyncRealtimeEvent) => void,
  ): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  publishAwareness = async (
    request: DocumentAwarenessPublishRequest,
  ): Promise<DocumentSyncCommandResult<{ readonly accepted: true }>> => {
    this.awarenessCalls.push(request);
    this.emit({
      kind: "awareness",
      documentId: request.documentId,
      storeEpoch: request.storeEpoch,
      generation: request.generation,
      clientSessionId: request.clientSessionId,
      update: request.update,
    });
    return success({ accepted: true });
  };

  commit = (
    request: DocumentSyncApplyRequest,
  ): DocumentSyncCommandResult<DocumentSyncApplyAck> => {
    const existingAck = this.committedAcks.get(request.updateId);
    if (existingAck) {
      return success({
        ...existingAck,
        headSeq: this.headSeq,
        stateVector: Y.encodeStateVector(this.serverDocument),
        duplicate: true,
      });
    }

    Y.applyUpdate(this.serverDocument, request.update);
    this.headSeq += 1;
    if (this.emitApplyEcho) {
      this.emit({
        kind: "document-update",
        documentId: request.documentId,
        storeEpoch: this.storeEpoch,
        generation: this.generation,
        headSeq: this.headSeq,
        updateId: request.updateId,
        clientSessionId: request.clientSessionId,
        update: request.update,
      });
    }
    const ack: DocumentSyncApplyAck = {
      documentId: request.documentId,
      storeEpoch: this.storeEpoch,
      generation: this.generation,
      updateId: request.updateId,
      committedSeq: this.headSeq,
      headSeq: this.headSeq,
      stateVector: Y.encodeStateVector(this.serverDocument),
      duplicate: false,
    };
    this.committedAcks.set(request.updateId, ack);
    return success(ack);
  };

  commitExternal = (mutate: (text: Y.Text) => void): Uint8Array => {
    const update = captureUpdate(this.serverDocument, () => {
      mutate(this.serverDocument.getText("title"));
    });
    this.headSeq += 1;
    return update;
  };

  emit = (event: DocumentSyncRealtimeEvent): void => {
    this.listeners.forEach((listener) => listener(event));
  };

  destroy = (): void => {
    this.serverDocument.destroy();
  };
}

describe("NodexYProvider", () => {
  test("converges concurrent clients while keeping a fresh client identity per surface", async () => {
    const adapter = new MemoryDocumentSyncAdapter();
    const firstDocument = new Y.Doc({ guid: "document-1" });
    const secondDocument = new Y.Doc({ guid: "document-1" });
    const first = new NodexYProvider({
      documentId: "document-1",
      document: firstDocument,
      adapter,
      clientSessionId: "window-1",
      autoConnect: false,
    });
    const second = new NodexYProvider({
      documentId: "document-1",
      document: secondDocument,
      adapter,
      clientSessionId: "window-2",
      autoConnect: false,
    });
    try {
      await Promise.all([first.connect(), second.connect()]);
      expect(firstDocument.clientID !== secondDocument.clientID).toBeTrue();
      expect(first.clientSessionId !== second.clientSessionId).toBeTrue();

      firstDocument.getText("title").insert(0, "A");
      secondDocument.getText("title").insert(0, "B");
      await Promise.all([first.flush(), second.flush()]);
      await waitUntil(
        () =>
          first.getStatus().headSeq === 2 && second.getStatus().headSeq === 2,
      );

      const serverText = adapter.serverDocument.getText("title").toString();
      expect(firstDocument.getText("title").toString()).toBe(serverText);
      expect(secondDocument.getText("title").toString()).toBe(serverText);
      expect(serverText.length).toBe(2);
    } finally {
      first.destroy();
      second.destroy();
      firstDocument.destroy();
      secondDocument.destroy();
      adapter.destroy();
    }
  });

  test("keeps a Card's title, nested Block tree, formatting, and stable identities convergent across two surfaces and restart", async () => {
    const adapter = new MemoryDocumentSyncAdapter();
    const initialIds = ["block-root", "block-child", "block-sibling"];
    let nextInitialId = 0;
    const genesis = createCardDocumentGenesis({
      documentId: "document-1",
      title: "Shared Card",
      nfm: "Root\n\tChild\nSibling",
      allocateBlockId: () => {
        const blockId = initialIds[nextInitialId];
        if (!blockId) throw new Error("Unexpected genesis Block allocation");
        nextInitialId += 1;
        return blockId;
      },
    });
    const insertedGenesis = createCardDocumentGenesis({
      documentId: "insert-template",
      title: "",
      nfm: "Inserted **live**",
      allocateBlockId: () => "block-inserted",
    });
    const insertedPortable = captureXmlSubtreeAt(
      getRootBlockGroup(insertedGenesis.document),
      0,
    );
    Y.applyUpdate(adapter.serverDocument, genesis.update);
    adapter.headSeq = 1;

    const firstDocument = new Y.Doc({ guid: "document-1" });
    const secondDocument = new Y.Doc({ guid: "document-1" });
    const firstClientId = firstDocument.clientID;
    const secondClientId = secondDocument.clientID;
    const first = new NodexYProvider({
      documentId: "document-1",
      document: firstDocument,
      adapter,
      clientSessionId: "window-alpha",
      autoConnect: false,
    });
    const second = new NodexYProvider({
      documentId: "document-1",
      document: secondDocument,
      adapter,
      clientSessionId: "window-beta",
      autoConnect: false,
    });

    let restartedFirstDocument: Y.Doc | null = null;
    let restartedSecondDocument: Y.Doc | null = null;
    let restartedFirst: NodexYProvider | null = null;
    let restartedSecond: NodexYProvider | null = null;
    try {
      await Promise.all([first.connect(), second.connect()]);
      expect(firstDocument.clientID !== secondDocument.clientID).toBeTrue();

      firstDocument.transact(() => {
        const title = openCardDocument(firstDocument).title;
        title.insert(title.length, " / Alpha");
        const rootText = getFirstBlockText(
          findBlockElement(firstDocument, "block-root"),
        );
        rootText.insert(rootText.length, " edited by Alpha");
        rootText.format(0, "Root".length, { italic: {} });
      }, "window-alpha-edit");
      secondDocument.transact(() => {
        const title = openCardDocument(secondDocument).title;
        title.insert(title.length, " / Beta");
        const rootGroup = getRootBlockGroup(secondDocument);
        insertPortableXmlSubtree(rootGroup, rootGroup.length, insertedPortable);
      }, "window-beta-edit");

      await Promise.all([first.flush(), second.flush()]);
      await waitUntil(
        () =>
          first.getStatus().headSeq === 3 && second.getStatus().headSeq === 3,
      );
      const concurrentMaterialization = materializeCardDocument(firstDocument);
      expect(concurrentMaterialization.title.includes(" / Alpha")).toBeTrue();
      expect(concurrentMaterialization.title.includes(" / Beta")).toBeTrue();
      expect(
        concurrentMaterialization.plainText.includes("Root edited by Alpha"),
      ).toBeTrue();
      expect(
        concurrentMaterialization.nfm.includes("*Root* edited by Alpha"),
      ).toBeTrue();
      expect(JSON.stringify(materializeCardDocument(secondDocument))).toBe(
        JSON.stringify(concurrentMaterialization),
      );

      firstDocument.transact(() => {
        const sourceBlock = findBlockElement(firstDocument, "block-root");
        const sourceGroup = getChildBlockGroup(sourceBlock);
        if (!sourceGroup) throw new Error("Missing nested source blockGroup");
        const movedPortable = captureXmlSubtreeAt(sourceGroup, 0);
        deleteXmlSubtreeAt(sourceGroup, 0);
        const sourceGroupIndex = sourceBlock.toArray().indexOf(sourceGroup);
        if (sourceGroupIndex < 0) {
          throw new Error("Missing source blockGroup attachment");
        }
        sourceBlock.delete(sourceGroupIndex, 1);

        const targetBlock = findBlockElement(firstDocument, "block-inserted");
        const targetGroup = new Y.XmlElement(BLOCK_GROUP_NODE_NAME);
        targetBlock.insert(targetBlock.length, [targetGroup]);
        insertPortableXmlSubtree(targetGroup, 0, movedPortable);
      }, "window-alpha-nested-move");
      secondDocument.transact(() => {
        deleteDirectBlock(getRootBlockGroup(secondDocument), "block-sibling");
      }, "window-beta-delete");

      await Promise.all([first.flush(), second.flush()]);
      await waitUntil(
        () =>
          first.getStatus().headSeq === 5 && second.getStatus().headSeq === 5,
      );
      const beforeRestart = materializeCardDocument(adapter.serverDocument);
      expect(JSON.stringify(materializeCardDocument(firstDocument))).toBe(
        JSON.stringify(beforeRestart),
      );
      expect(JSON.stringify(materializeCardDocument(secondDocument))).toBe(
        JSON.stringify(beforeRestart),
      );

      first.destroy();
      second.destroy();
      firstDocument.destroy();
      secondDocument.destroy();

      restartedFirstDocument = new Y.Doc({ guid: "document-1" });
      restartedSecondDocument = new Y.Doc({ guid: "document-1" });
      restartedFirst = new NodexYProvider({
        documentId: "document-1",
        document: restartedFirstDocument,
        adapter,
        clientSessionId: "window-alpha-restarted",
        autoConnect: false,
      });
      restartedSecond = new NodexYProvider({
        documentId: "document-1",
        document: restartedSecondDocument,
        adapter,
        clientSessionId: "window-beta-restarted",
        autoConnect: false,
      });
      await Promise.all([restartedFirst.connect(), restartedSecond.connect()]);
      expect(restartedFirstDocument.clientID !== firstClientId).toBeTrue();
      expect(restartedSecondDocument.clientID !== secondClientId).toBeTrue();
      expect(
        restartedFirstDocument.clientID !== restartedSecondDocument.clientID,
      ).toBeTrue();

      const restartedMaterialization = materializeCardDocument(
        restartedFirstDocument,
      );
      expect(JSON.stringify(restartedMaterialization)).toBe(
        JSON.stringify(beforeRestart),
      );
      expect(
        JSON.stringify(materializeCardDocument(restartedSecondDocument)),
      ).toBe(JSON.stringify(beforeRestart));
      expect(restartedMaterialization.blockTree.length).toBe(2);
      expect(restartedMaterialization.blockTree[0]?.id).toBe("block-root");
      expect(restartedMaterialization.blockTree[0]?.children.length).toBe(0);
      expect(restartedMaterialization.blockTree[1]?.id).toBe("block-inserted");
      expect(restartedMaterialization.blockTree[1]?.children[0]?.id).toBe(
        "block-child",
      );
      const survivingIds = restartedMaterialization.blockTree.flatMap(
        (block) => [block.id, ...block.children.map((child) => child.id)],
      );
      expect(survivingIds.join(",")).toBe(
        "block-root,block-inserted,block-child",
      );
      expect(new Set(survivingIds).size).toBe(survivingIds.length);
    } finally {
      restartedFirst?.destroy();
      restartedSecond?.destroy();
      restartedFirstDocument?.destroy();
      restartedSecondDocument?.destroy();
      first.destroy();
      second.destroy();
      firstDocument.destroy();
      secondDocument.destroy();
      genesis.document.destroy();
      insertedGenesis.document.destroy();
      adapter.destroy();
    }
  });

  test("merges a local burst into one durable update and suppresses its realtime echo", async () => {
    const adapter = new MemoryDocumentSyncAdapter();
    const document = new Y.Doc({ guid: "document-1" });
    const provider = new NodexYProvider({
      documentId: "document-1",
      document,
      adapter,
      clientSessionId: "window-1",
      autoConnect: false,
    });
    try {
      await provider.connect();
      const title = document.getText("title");
      title.insert(0, "a");
      title.insert(1, "b");
      title.insert(2, "c");
      await provider.flush();
      await Promise.resolve();

      const committedRequest = adapter.applyCalls[0];
      if (!committedRequest) {
        throw new Error("Missing committed request");
      }
      adapter.emit({
        kind: "document-update",
        documentId: "document-1",
        storeEpoch: adapter.storeEpoch,
        generation: adapter.generation,
        headSeq: 1,
        updateId: committedRequest.updateId,
        clientSessionId: committedRequest.clientSessionId,
        update: committedRequest.update,
      });
      await Promise.resolve();

      expect(adapter.applyCalls.length).toBe(1);
      expect(adapter.serverDocument.getText("title").toString()).toBe("abc");
      expect(provider.getStatus().phase).toBe("synced");
      expect(provider.getStatus().headSeq).toBe(1);
    } finally {
      provider.destroy();
      document.destroy();
      adapter.destroy();
    }
  });

  test("allows exactly one durable command in flight and sends later edits sequentially", async () => {
    const adapter = new MemoryDocumentSyncAdapter();
    const document = new Y.Doc({ guid: "document-1" });
    const replies = [
      deferred<DocumentSyncCommandResult<DocumentSyncApplyAck>>(),
      deferred<DocumentSyncCommandResult<DocumentSyncApplyAck>>(),
    ];
    adapter.applyHandler = (request) => {
      const callIndex = adapter.applyCalls.indexOf(request);
      const reply = replies[callIndex];
      if (!reply) {
        throw new Error("Unexpected durable apply call");
      }
      return reply.promise;
    };
    const provider = new NodexYProvider({
      documentId: "document-1",
      document,
      adapter,
      clientSessionId: "window-1",
      autoConnect: false,
    });
    try {
      await provider.connect();
      document.getText("title").insert(0, "a");
      await waitUntil(() => adapter.applyCalls.length === 1);
      document.getText("title").insert(1, "b");
      const flushed = provider.flush();
      await Promise.resolve();
      expect(adapter.applyCalls.length).toBe(1);

      const firstRequest = adapter.applyCalls[0];
      if (!firstRequest) {
        throw new Error("Missing first apply request");
      }
      replies[0]?.resolve(adapter.commit(firstRequest));
      await waitUntil(() => adapter.applyCalls.length === 2);

      const secondRequest = adapter.applyCalls[1];
      if (!secondRequest) {
        throw new Error("Missing second apply request");
      }
      replies[1]?.resolve(adapter.commit(secondRequest));
      await flushed;

      expect(adapter.maxActiveApplyCalls).toBe(1);
      expect(adapter.serverDocument.getText("title").toString()).toBe("ab");
    } finally {
      provider.destroy();
      document.destroy();
      adapter.destroy();
    }
  });

  test("retries the exact same durable request after reconnect state-vector sync", async () => {
    const adapter = new MemoryDocumentSyncAdapter();
    const document = new Y.Doc({ guid: "document-1" });
    const retryCallbacks: Array<() => void> = [];
    const scheduleRetry: NodexYProviderRetryScheduler = (callback) => {
      retryCallbacks.push(callback);
      return () => undefined;
    };
    let applyAttempt = 0;
    adapter.applyHandler = async (request) => {
      applyAttempt += 1;
      if (applyAttempt === 1) {
        adapter.commit(request);
        return {
          ok: false,
          error: {
            code: "transport_unavailable",
            message: "offline",
            retryable: true,
            resetRequired: false,
          },
        };
      }
      return adapter.commit(request);
    };
    const provider = new NodexYProvider({
      documentId: "document-1",
      document,
      adapter,
      clientSessionId: "window-1",
      autoConnect: false,
      scheduleRetry,
    });
    try {
      await provider.connect();
      document.getText("title").insert(0, "retry me");
      await waitUntil(() => retryCallbacks.length === 1);
      expect(provider.getStatus().phase).toBe("offline");

      retryCallbacks[0]?.();
      await waitUntil(() => adapter.applyCalls.length === 2);
      await provider.flush();

      const firstRequest = adapter.applyCalls[0];
      const secondRequest = adapter.applyCalls[1];
      expect(firstRequest === secondRequest).toBeTrue();
      expect(firstRequest?.updateId).toBe(secondRequest?.updateId);
      expect(firstRequest?.update === secondRequest?.update).toBeTrue();
      expect(adapter.syncCalls.length).toBe(2);
      expect(adapter.headSeq).toBe(1);
      expect(adapter.serverDocument.getText("title").toString()).toBe(
        "retry me",
      );
    } finally {
      provider.destroy();
      document.destroy();
      adapter.destroy();
    }
  });

  test("repairs a realtime sequence gap with a state-vector resync", async () => {
    const adapter = new MemoryDocumentSyncAdapter();
    const document = new Y.Doc({ guid: "document-1" });
    const provider = new NodexYProvider({
      documentId: "document-1",
      document,
      adapter,
      clientSessionId: "window-1",
      autoConnect: false,
    });
    try {
      await provider.connect();
      adapter.commitExternal((title) => title.insert(0, "a"));
      const secondUpdate = adapter.commitExternal((title) =>
        title.insert(1, "b"),
      );
      adapter.emit({
        kind: "document-update",
        documentId: "document-1",
        storeEpoch: adapter.storeEpoch,
        generation: adapter.generation,
        headSeq: 2,
        updateId: "remote-2",
        clientSessionId: "window-2",
        update: secondUpdate,
      });

      await waitUntil(
        () =>
          adapter.syncCalls.length === 2 && provider.getStatus().headSeq === 2,
      );
      expect(document.getText("title").toString()).toBe("ab");
      expect(provider.getStatus().phase).toBe("synced");
    } finally {
      provider.destroy();
      document.destroy();
      adapter.destroy();
    }
  });

  test("shares ephemeral Awareness without turning remote presence into document writes", async () => {
    const adapter = new MemoryDocumentSyncAdapter();
    const firstDocument = new Y.Doc({ guid: "document-1" });
    const secondDocument = new Y.Doc({ guid: "document-1" });
    const first = new NodexYProvider({
      documentId: "document-1",
      document: firstDocument,
      adapter,
      clientSessionId: "window-1",
      autoConnect: false,
    });
    const second = new NodexYProvider({
      documentId: "document-1",
      document: secondDocument,
      adapter,
      clientSessionId: "window-2",
      autoConnect: false,
    });
    try {
      await Promise.all([first.connect(), second.connect()]);
      first.awareness.setLocalStateField("user", { name: "Ada" });
      await waitUntil(() =>
        second.awareness.getStates().has(firstDocument.clientID),
      );

      const remoteState = second.awareness
        .getStates()
        .get(firstDocument.clientID) as
        { user?: { name?: string } } | undefined;
      expect(remoteState?.user?.name).toBe("Ada");
      expect(adapter.applyCalls.length).toBe(0);
      first.destroy();
      await waitUntil(
        () => !second.awareness.getStates().has(firstDocument.clientID),
      );
      expect(
        second.awareness.getStates().has(firstDocument.clientID),
      ).toBeFalse();
    } finally {
      first.destroy();
      second.destroy();
      firstDocument.destroy();
      secondDocument.destroy();
      adapter.destroy();
    }
  });

  test("requires a fresh Y.Doc when store epoch or document generation changes", async () => {
    const epochAdapter = new MemoryDocumentSyncAdapter();
    epochAdapter.storeEpoch = "store-restored";
    const epochDocument = new Y.Doc({ guid: "document-1" });
    const epochProvider = new NodexYProvider({
      documentId: "document-1",
      document: epochDocument,
      adapter: epochAdapter,
      clientSessionId: "stale-window",
      expectedStoreEpoch: "store-before-restore",
      autoConnect: false,
    });
    try {
      await epochProvider.connect();
      expect(epochProvider.getStatus().phase).toBe("reset-required");
      expect(epochProvider.getStatus().error?.code).toBe(
        "store_epoch_mismatch",
      );
      epochDocument.getText("title").insert(0, "must not replay");
      await Promise.resolve();
      expect(epochProvider.getStatus().pendingUpdateCount).toBe(0);
      expect(epochAdapter.applyCalls.length).toBe(0);
    } finally {
      epochProvider.destroy();
      epochDocument.destroy();
      epochAdapter.destroy();
    }

    const generationAdapter = new MemoryDocumentSyncAdapter();
    const generationDocument = new Y.Doc({ guid: "document-1" });
    const generationProvider = new NodexYProvider({
      documentId: "document-1",
      document: generationDocument,
      adapter: generationAdapter,
      clientSessionId: "window-1",
      autoConnect: false,
    });
    try {
      await generationProvider.connect();
      generationAdapter.emit({
        kind: "resync-required",
        documentId: "document-1",
        storeEpoch: generationAdapter.storeEpoch,
        generation: 2,
        headSeq: 0,
        reason: "transport-reconnected",
      });
      expect(generationProvider.getStatus().phase).toBe("reset-required");
      expect(generationProvider.getStatus().error?.code).toBe(
        "document_generation_mismatch",
      );
    } finally {
      generationProvider.destroy();
      generationDocument.destroy();
      generationAdapter.destroy();
    }
  });

  test("stops retrying and requires reload when a durable update crosses relocation", async () => {
    const adapter = new MemoryDocumentSyncAdapter();
    const document = new Y.Doc({ guid: "document-1" });
    const retryCallbacks: Array<() => void> = [];
    adapter.applyHandler = async () => ({
      ok: false,
      error: {
        code: "block_relocated",
        message: "Block moved",
        retryable: true,
        resetRequired: false,
        relocationId: "relocation-1",
        recoveryArtifactId: "artifact-1",
      },
    });
    const provider = new NodexYProvider({
      documentId: "document-1",
      document,
      adapter,
      clientSessionId: "stale-window",
      autoConnect: false,
      scheduleRetry: (callback) => {
        retryCallbacks.push(callback);
        return () => undefined;
      },
    });
    try {
      await provider.connect();
      document.getText("title").insert(0, "offline edit");
      await waitUntil(() => provider.getStatus().phase === "reset-required");
      const status = provider.getStatus();
      expect(status.error?.code).toBe("block_relocated");
      expect(status.error?.relocationId).toBe("relocation-1");
      expect(status.error?.recoveryArtifactId).toBe("artifact-1");
      expect(status.error?.retryable).toBeFalse();
      expect(status.error?.resetRequired).toBeTrue();
      expect(retryCallbacks.length).toBe(0);
      expect(adapter.applyCalls.length).toBe(1);
    } finally {
      provider.destroy();
      document.destroy();
      adapter.destroy();
    }
  });

  test("recovers disconnected edits from the exact IndexedDB-style boundary after restart", async () => {
    const adapter = new MemoryDocumentSyncAdapter();
    const checkpoints = new MemoryDocumentLocalCheckpointStore();
    seedCanonicalCardDocument(adapter, "Base");
    const firstDocument = new Y.Doc({ guid: "document-1" });
    const first = new NodexYProvider({
      documentId: "document-1",
      document: firstDocument,
      adapter,
      clientSessionId: "window-before-restart",
      localCheckpointStore: checkpoints,
      autoConnect: false,
    });
    try {
      await first.connect();
      first.disconnect();
      openCardDocument(firstDocument).title.insert(4, " offline");
      await first.checkpoint();
    } finally {
      first.destroy();
      firstDocument.destroy();
    }

    const restartedDocument = new Y.Doc({ guid: "document-1" });
    const restarted = new NodexYProvider({
      documentId: "document-1",
      document: restartedDocument,
      adapter,
      clientSessionId: "window-after-restart",
      localCheckpointStore: checkpoints,
      autoConnect: false,
    });
    try {
      await restarted.connect();
      expect(openCardDocument(restartedDocument).title.toString()).toBe(
        "Base offline",
      );
      await restarted.flush();
      expect(openCardDocument(adapter.serverDocument).title.toString()).toBe(
        "Base offline",
      );
      expect(adapter.headSeq).toBe(2);
    } finally {
      restarted.destroy();
      restartedDocument.destroy();
      adapter.destroy();
    }
  });

  test("checkpoints local state before sending its durable update", async () => {
    const adapter = new MemoryDocumentSyncAdapter();
    const checkpoints = new MemoryDocumentLocalCheckpointStore();
    seedCanonicalCardDocument(adapter, "Base");
    const document = new Y.Doc({ guid: "document-1" });
    const provider = new NodexYProvider({
      documentId: "document-1",
      document,
      adapter,
      clientSessionId: "window-1",
      localCheckpointStore: checkpoints,
      autoConnect: false,
    });
    try {
      await provider.connect();
      await provider.checkpoint();
      const gate = deferred<void>();
      checkpoints.writeGate = gate.promise;
      openCardDocument(document).title.insert(4, " pending");
      const flushing = provider.flush();
      await waitUntil(() => provider.getStatus().pendingUpdateCount === 1);
      expect(adapter.applyCalls.length).toBe(0);

      gate.resolve(undefined);
      await flushing;
      expect(adapter.applyCalls.length).toBe(1);
      expect(openCardDocument(adapter.serverDocument).title.toString()).toBe(
        "Base pending",
      );
    } finally {
      provider.destroy();
      document.destroy();
      adapter.destroy();
    }
  });

  test("rejects a pending flush on destroy without destroying the surface-owned Y.Doc", async () => {
    const adapter = new MemoryDocumentSyncAdapter();
    const document = new Y.Doc({ guid: "document-1" });
    const reply = deferred<DocumentSyncCommandResult<DocumentSyncApplyAck>>();
    adapter.applyHandler = () => reply.promise;
    const provider = new NodexYProvider({
      documentId: "document-1",
      document,
      adapter,
      clientSessionId: "window-1",
      autoConnect: false,
    });
    try {
      await provider.connect();
      document.getText("title").insert(0, "pending");
      await waitUntil(() => adapter.applyCalls.length === 1);

      let flushRejected = false;
      const flushing = provider.flush().catch(() => {
        flushRejected = true;
      });
      provider.destroy();
      await flushing;
      expect(flushRejected).toBeTrue();
      expect(provider.getStatus().phase).toBe("destroyed");

      document.getText("title").insert(7, " surface");
      expect(document.getText("title").toString()).toBe("pending surface");
      expect(adapter.applyCalls.length).toBe(1);

      const request = adapter.applyCalls[0];
      if (!request) {
        throw new Error("Missing pending request");
      }
      reply.resolve(adapter.commit(request));
      await waitUntil(() => adapter.activeApplyCalls === 0);
    } finally {
      provider.destroy();
      document.destroy();
      adapter.destroy();
    }
  });
});
