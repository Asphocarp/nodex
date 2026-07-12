import { describe, expect, test } from "vitest";
import * as Y from "yjs";
import type {
  DocumentAwarenessPublishRequest,
  DocumentRelocationLeaseResponseAck,
  DocumentRelocationLeaseResponseRequest,
  DocumentSyncApplyAck,
  DocumentSyncApplyRequest,
  DocumentSyncCommandResult,
  DocumentSyncRealtimeEvent,
  DocumentSyncRequest,
  DocumentSyncResponse,
  DocumentSyncSubscribeRequest,
} from "../../shared/block-documents/document-sync";
import {
  BLOCK_CONTAINER_NODE_NAME,
  BLOCK_GROUP_NODE_NAME,
  BLOCK_ID_ATTRIBUTE,
  CANVAS_BLOCK_TYPE,
  CANVAS_DOCUMENT_SCHEMA_KEY,
  CANVAS_DOCUMENT_SCHEMA_VERSION,
  LARGE_DOCUMENT_BLOCK_TYPE,
  LARGE_DOCUMENT_SCHEMA_KEY,
  LARGE_DOCUMENT_SCHEMA_VERSION,
  captureXmlSubtreeAt,
  createCardDocument,
  deleteXmlSubtreeAt,
  getRegisteredBlockDocumentSchemaAdapter,
  insertPortableXmlSubtree,
  openCardDocument,
  type RegisteredBlockDocumentSchemaAdapter,
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
  isDocumentApplyAckHeadValid,
  NodexYProvider,
  type DocumentSyncAdapter,
  type NodexYProviderOptions,
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
  readonly clearedDocuments: string[] = [];
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
    this.clearedDocuments.push(documentId);
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

type ProviderDocumentSchema = NonNullable<
  NodexYProviderOptions["documentSchema"]
>;

const seedRegisteredDocument = (
  adapter: MemoryDocumentSyncAdapter,
  schema: ProviderDocumentSchema,
): RegisteredBlockDocumentSchemaAdapter => {
  const schemaAdapter = getRegisteredBlockDocumentSchemaAdapter(schema);
  const genesis = schemaAdapter.create("document-1");
  try {
    Y.applyUpdate(
      adapter.serverDocument,
      Y.encodeStateAsUpdate(genesis.document),
    );
    adapter.headSeq = 1;
  } finally {
    genesis.document.destroy();
  }
  return schemaAdapter;
};

const createParagraphBlock = (id: string, value: string): Y.XmlElement => {
  const container = new Y.XmlElement(BLOCK_CONTAINER_NODE_NAME);
  container.setAttribute(BLOCK_ID_ATTRIBUTE, id);
  const paragraph = new Y.XmlElement("paragraph");
  const text = new Y.XmlText();
  text.insert(0, value);
  paragraph.insert(0, [text]);
  container.insert(0, [paragraph]);
  return container;
};

const recoverDisconnectedRegisteredDocumentEdit = async (input: {
  readonly schema: ProviderDocumentSchema;
  readonly mutate: (
    document: Y.Doc,
    adapter: RegisteredBlockDocumentSchemaAdapter,
  ) => void;
  readonly assertRecovered: (
    document: Y.Doc,
    adapter: RegisteredBlockDocumentSchemaAdapter,
  ) => void;
}): Promise<void> => {
  const adapter = new MemoryDocumentSyncAdapter();
  const checkpoints = new MemoryDocumentLocalCheckpointStore();
  const schemaAdapter = seedRegisteredDocument(adapter, input.schema);
  const firstDocument = new Y.Doc({ guid: "document-1" });
  const first = new NodexYProvider({
    documentId: "document-1",
    document: firstDocument,
    adapter,
    documentSchema: input.schema,
    clientSessionId: "window-before-generic-restart",
    localCheckpointStore: checkpoints,
    autoConnect: false,
  });
  try {
    await first.connect();
    first.disconnect();
    input.mutate(firstDocument, schemaAdapter);
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
    documentSchema: input.schema,
    clientSessionId: "window-after-generic-restart",
    localCheckpointStore: checkpoints,
    autoConnect: false,
  });
  try {
    await restarted.connect();
    input.assertRecovered(restartedDocument, schemaAdapter);
    await restarted.flush();
    input.assertRecovered(adapter.serverDocument, schemaAdapter);
    expect(adapter.headSeq).toBe(2);
  } finally {
    restarted.destroy();
    restartedDocument.destroy();
    adapter.destroy();
  }
};

class MemoryDocumentSyncAdapter implements DocumentSyncAdapter {
  readonly serverDocument = new Y.Doc({ guid: "document-1" });
  readonly syncCalls: DocumentSyncRequest[] = [];
  readonly applyCalls: DocumentSyncApplyRequest[] = [];
  readonly awarenessCalls: DocumentAwarenessPublishRequest[] = [];
  readonly relocationLeaseCalls: DocumentRelocationLeaseResponseRequest[] = [];
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
  syncHandler:
    | ((
        request: DocumentSyncRequest,
      ) => Promise<DocumentSyncCommandResult<DocumentSyncResponse>>)
    | null = null;
  relocationLeaseHandler:
    | ((
        request: DocumentRelocationLeaseResponseRequest,
      ) => Promise<
        DocumentSyncCommandResult<DocumentRelocationLeaseResponseAck>
      >)
    | null = null;

  sync = async (
    request: DocumentSyncRequest,
  ): Promise<DocumentSyncCommandResult<DocumentSyncResponse>> => {
    this.syncCalls.push(request);
    if (this.syncHandler) return this.syncHandler(request);
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

  respondToRelocationLease = async (
    request: DocumentRelocationLeaseResponseRequest,
  ): Promise<
    DocumentSyncCommandResult<DocumentRelocationLeaseResponseAck>
  > => {
    this.relocationLeaseCalls.push(request);
    if (this.relocationLeaseHandler) {
      return this.relocationLeaseHandler(request);
    }
    return success({
      accepted: true,
      leaseId: request.leaseId,
      documentId: request.documentId,
      status: request.response === "ack" ? "frozen" : "cancelled",
    });
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
  test("accepts a redundant CRDT replay at the unchanged durable head", () => {
    expect(
      isDocumentApplyAckHeadValid(
        { committedSeq: 4, headSeq: 4, duplicate: true },
        { baseHeadSeq: 4 },
      ),
    ).toBe(true);
    expect(
      isDocumentApplyAckHeadValid(
        { committedSeq: 4, headSeq: 4, duplicate: false },
        { baseHeadSeq: 4 },
      ),
    ).toBe(false);
  });

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
      expect(firstDocument.clientID !== secondDocument.clientID).toBe(true);
      expect(first.clientSessionId !== second.clientSessionId).toBe(true);

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
      expect(firstDocument.clientID !== secondDocument.clientID).toBe(true);

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
      expect(concurrentMaterialization.title.includes(" / Alpha")).toBe(true);
      expect(concurrentMaterialization.title.includes(" / Beta")).toBe(true);
      expect(
        concurrentMaterialization.plainText.includes("Root edited by Alpha"),
      ).toBe(true);
      expect(
        concurrentMaterialization.nfm.includes("*Root* edited by Alpha"),
      ).toBe(true);
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
      expect(restartedFirstDocument.clientID !== firstClientId).toBe(true);
      expect(restartedSecondDocument.clientID !== secondClientId).toBe(true);
      expect(
        restartedFirstDocument.clientID !== restartedSecondDocument.clientID,
      ).toBe(true);

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
      expect(firstRequest === secondRequest).toBe(true);
      expect(firstRequest?.updateId).toBe(secondRequest?.updateId);
      expect(firstRequest?.update === secondRequest?.update).toBe(true);
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
      ).toBe(false);
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

  test("drops old-epoch outbox and checkpoint state on an explicit store reset", async () => {
    const adapter = new MemoryDocumentSyncAdapter();
    const checkpoints = new MemoryDocumentLocalCheckpointStore();
    const document = new Y.Doc({ guid: "document-1" });
    const provider = new NodexYProvider({
      documentId: "document-1",
      document,
      adapter,
      clientSessionId: "window-before-restore",
      localCheckpointStore: checkpoints,
      autoConnect: false,
    });
    try {
      await provider.connect();
      document.getText("title").insert(0, "must not cross restore");
      adapter.emit({
        kind: "store-reset",
        documentId: "document-1",
        storeEpoch: "store-restored",
      });

      await waitUntil(() => checkpoints.clearedDocuments.length === 1);
      expect(provider.getStatus().phase).toBe("reset-required");
      expect(provider.getStatus().pendingUpdateCount).toBe(0);
      expect(provider.getStatus().error?.code).toBe("store_epoch_mismatch");
      expect(adapter.applyCalls.length).toBe(0);
      expect(checkpoints.clearedDocuments[0]).toBe("document-1");
    } finally {
      provider.destroy();
      document.destroy();
      adapter.destroy();
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
      expect(status.error?.retryable).toBe(false);
      expect(status.error?.resetRequired).toBe(true);
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

  test("recovers a body-only Document from its registered schema after restart", async () => {
    await recoverDisconnectedRegisteredDocumentEdit({
      schema: {
        ownerType: LARGE_DOCUMENT_BLOCK_TYPE,
        schemaKey: LARGE_DOCUMENT_SCHEMA_KEY,
        schemaVersion: LARGE_DOCUMENT_SCHEMA_VERSION,
      },
      mutate: (document, adapter) => {
        if (adapter.contentModel !== "block_tree") {
          throw new TypeError("Expected the Large Document block-tree Adapter");
        }
        const root = adapter.inspect(document).envelope.body.toArray()[0];
        if (!(root instanceof Y.XmlElement)) {
          throw new TypeError("Expected the Large Document body root");
        }
        root.insert(0, [
          createParagraphBlock("offline-block", "Recovered offline body"),
        ]);
      },
      assertRecovered: (document, adapter) => {
        if (adapter.contentModel !== "block_tree") {
          throw new TypeError("Expected the Large Document block-tree Adapter");
        }
        expect(adapter.inspect(document).materialization.plainText).toBe(
          "Recovered offline body",
        );
      },
    });
  });

  test("recovers a Canvas scene_graph from its registered schema after restart", async () => {
    await recoverDisconnectedRegisteredDocumentEdit({
      schema: {
        ownerType: CANVAS_BLOCK_TYPE,
        schemaKey: CANVAS_DOCUMENT_SCHEMA_KEY,
        schemaVersion: CANVAS_DOCUMENT_SCHEMA_VERSION,
      },
      mutate: (document, adapter) => {
        if (adapter.contentModel !== "scene_graph") {
          throw new TypeError("Expected the Canvas scene-graph Adapter");
        }
        adapter.inspect(document).envelope.appState.set(
          "gridModeEnabled",
          true,
        );
      },
      assertRecovered: (document, adapter) => {
        if (adapter.contentModel !== "scene_graph") {
          throw new TypeError("Expected the Canvas scene-graph Adapter");
        }
        expect(
          adapter.inspect(document).materialization.appState.gridModeEnabled,
        ).toBe(true);
      },
    });
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
      expect(flushRejected).toBe(true);
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

  test("freezes the surface and durably flushes pending edits before lease ACK", async () => {
    const adapter = new MemoryDocumentSyncAdapter();
    const document = new Y.Doc({ guid: "document-1" });
    const applyReply = deferred<DocumentSyncCommandResult<DocumentSyncApplyAck>>();
    adapter.applyHandler = () => applyReply.promise;
    let surfacePrepared = false;
    const provider = new NodexYProvider({
      documentId: "document-1",
      document,
      adapter,
      clientSessionId: "lease-window",
      autoConnect: false,
      localCheckpointStore: null,
      prepareSurfaceForRelocation: async () => {
        surfacePrepared = true;
      },
    });
    try {
      await provider.connect();
      document.getText("title").insert(0, "pending edit");
      await waitUntil(() => adapter.applyCalls.length === 1);
      adapter.emit({
        kind: "relocation-lease-prepare",
        leaseId: "lease-flush",
        documentId: "document-1",
        clientSessionId: "lease-window",
        storeEpoch: adapter.storeEpoch,
        generation: adapter.generation,
        expectedHeadSeq: adapter.headSeq,
        deadlineAt: Date.now() + 10_000,
      });
      await waitUntil(() => provider.getStatus().phase === "relocating");
      expect(surfacePrepared).toBe(true);
      expect(adapter.relocationLeaseCalls.length).toBe(0);

      const pendingRequest = adapter.applyCalls[0];
      if (!pendingRequest) throw new Error("Missing pending durable update");
      applyReply.resolve(adapter.commit(pendingRequest));
      await waitUntil(() => provider.getStatus().phase === "frozen");
      expect(adapter.relocationLeaseCalls.length).toBe(1);
      expect(adapter.relocationLeaseCalls[0]?.response).toBe("ack");
      expect(adapter.relocationLeaseCalls[0]?.headSeq).toBe(adapter.headSeq);
      expect(openCardDocument(adapter.serverDocument).title.toString()).toBe(
        "pending edit",
      );
      expect(provider.getStatus().pendingUpdateCount).toBe(0);
    } finally {
      provider.destroy();
      document.destroy();
      adapter.destroy();
    }
  });

  test("NACKs and requires reset when local state changes after a lease ACK", async () => {
    const adapter = new MemoryDocumentSyncAdapter();
    const document = new Y.Doc({ guid: "document-1" });
    const provider = new NodexYProvider({
      documentId: "document-1",
      document,
      adapter,
      clientSessionId: "frozen-window",
      autoConnect: false,
      localCheckpointStore: null,
    });
    try {
      await provider.connect();
      adapter.emit({
        kind: "relocation-lease-prepare",
        leaseId: "lease-frozen",
        documentId: "document-1",
        clientSessionId: "frozen-window",
        storeEpoch: adapter.storeEpoch,
        generation: adapter.generation,
        expectedHeadSeq: adapter.headSeq,
        deadlineAt: Date.now() + 10_000,
      });
      await waitUntil(() => provider.getStatus().phase === "frozen");
      document.getText("title").insert(0, "ghost edit");
      await waitUntil(() => provider.getStatus().phase === "reset-required");
      expect(adapter.relocationLeaseCalls.length).toBe(2);
      const nack = adapter.relocationLeaseCalls[1];
      expect(nack?.response).toBe("nack");
      if (nack?.response === "nack") {
        expect(nack.reason).toBe("local_update_after_freeze");
      }
      expect(adapter.applyCalls.length).toBe(0);
      expect(adapter.serverDocument.getText("title").toString()).toBe("");
      expect(provider.getStatus().error?.resetRequired).toBe(true);
    } finally {
      provider.destroy();
      document.destroy();
      adapter.destroy();
    }
  });

  test("release and cancel terminal events unfreeze and resync the exact lease", async () => {
    const adapter = new MemoryDocumentSyncAdapter();
    const document = new Y.Doc({ guid: "document-1" });
    const provider = new NodexYProvider({
      documentId: "document-1",
      document,
      adapter,
      clientSessionId: "terminal-window",
      autoConnect: false,
      localCheckpointStore: null,
    });
    const prepareLease = async (leaseId: string): Promise<void> => {
      adapter.emit({
        kind: "relocation-lease-prepare",
        leaseId,
        documentId: "document-1",
        clientSessionId: "terminal-window",
        storeEpoch: adapter.storeEpoch,
        generation: adapter.generation,
        expectedHeadSeq: adapter.headSeq,
        deadlineAt: Date.now() + 10_000,
      });
      await waitUntil(() => provider.getStatus().phase === "frozen");
    };
    try {
      await provider.connect();
      await prepareLease("lease-cancel");
      const syncCallsBeforeCancel = adapter.syncCalls.length;
      adapter.emit({
        kind: "relocation-lease-cancel",
        leaseId: "lease-cancel",
        documentId: "document-1",
        clientSessionId: "terminal-window",
        storeEpoch: adapter.storeEpoch,
        generation: adapter.generation,
        headSeq: adapter.headSeq,
        reason: "caller cancelled",
      });
      await waitUntil(() => adapter.syncCalls.length > syncCallsBeforeCancel);
      await waitUntil(() => provider.getStatus().phase === "synced");
      expect(provider.getStatus().relocationLease).toBe(undefined);

      await prepareLease("lease-release");
      const syncCallsBeforeRelease = adapter.syncCalls.length;
      adapter.emit({
        kind: "relocation-lease-release",
        leaseId: "lease-release",
        documentId: "document-1",
        clientSessionId: "terminal-window",
        storeEpoch: adapter.storeEpoch,
        generation: adapter.generation,
        headSeq: adapter.headSeq,
      });
      await waitUntil(() => adapter.syncCalls.length > syncCallsBeforeRelease);
      await waitUntil(() => provider.getStatus().phase === "synced");
      expect(provider.getStatus().relocationLease).toBe(undefined);
      adapter.emit({
        kind: "relocation-lease-release",
        leaseId: "lease-release",
        documentId: "document-1",
        clientSessionId: "terminal-window",
        storeEpoch: adapter.storeEpoch,
        generation: adapter.generation,
        headSeq: adapter.headSeq,
      });
      await waitUntil(() => provider.getStatus().phase === "reset-required");
    } finally {
      provider.destroy();
      document.destroy();
      adapter.destroy();
    }
  });

  test("stays frozen until a post-terminal state-vector sync reaches the committed head", async () => {
    const adapter = new MemoryDocumentSyncAdapter();
    const document = new Y.Doc({ guid: "document-1" });
    const terminalSync = deferred<
      DocumentSyncCommandResult<DocumentSyncResponse>
    >();
    let terminalRequest: DocumentSyncRequest | null = null;
    const provider = new NodexYProvider({
      documentId: "document-1",
      document,
      adapter,
      clientSessionId: "terminal-sync-window",
      autoConnect: false,
      localCheckpointStore: null,
    });
    try {
      await provider.connect();
      adapter.emit({
        kind: "relocation-lease-prepare",
        leaseId: "lease-terminal-sync",
        documentId: "document-1",
        clientSessionId: "terminal-sync-window",
        storeEpoch: adapter.storeEpoch,
        generation: adapter.generation,
        expectedHeadSeq: 0,
        deadlineAt: Date.now() + 10_000,
      });
      await waitUntil(() => provider.getStatus().phase === "frozen");
      const committedUpdate = adapter.commitExternal((title) =>
        title.insert(0, "committed while frozen"),
      );
      adapter.syncHandler = (request) => {
        terminalRequest = request;
        return terminalSync.promise;
      };
      adapter.emit({
        kind: "relocation-lease-release",
        leaseId: "lease-terminal-sync",
        documentId: "document-1",
        clientSessionId: "terminal-sync-window",
        storeEpoch: adapter.storeEpoch,
        generation: adapter.generation,
        headSeq: 1,
      });
      await waitUntil(() => terminalRequest !== null);
      expect(provider.getStatus().phase).toBe("frozen");
      expect(provider.getStatus().relocationLease?.leaseId).toBe(
        "lease-terminal-sync",
      );

      const request = terminalRequest as unknown as DocumentSyncRequest;
      terminalSync.resolve(
        success({
          documentId: "document-1",
          storeEpoch: adapter.storeEpoch,
          generation: adapter.generation,
          headSeq: 1,
          stateVector: Y.encodeStateVector(adapter.serverDocument),
          update: Y.encodeStateAsUpdate(
            adapter.serverDocument,
            request.stateVector,
          ),
        }),
      );
      await waitUntil(() => provider.getStatus().phase === "synced");
      expect(provider.getStatus().relocationLease).toBe(undefined);
      expect(document.getText("title").toString()).toBe(
        "committed while frozen",
      );
      expect(committedUpdate.length > 0).toBe(true);
    } finally {
      provider.destroy();
      document.destroy();
      adapter.destroy();
    }
  });

  test("accepts a terminal event before the lease ACK response settles", async () => {
    const adapter = new MemoryDocumentSyncAdapter();
    const document = new Y.Doc({ guid: "document-1" });
    const ackResponse = deferred<
      DocumentSyncCommandResult<DocumentRelocationLeaseResponseAck>
    >();
    adapter.relocationLeaseHandler = () => ackResponse.promise;
    const provider = new NodexYProvider({
      documentId: "document-1",
      document,
      adapter,
      clientSessionId: "terminal-before-ack-window",
      autoConnect: false,
      localCheckpointStore: null,
    });
    try {
      await provider.connect();
      adapter.emit({
        kind: "relocation-lease-prepare",
        leaseId: "lease-terminal-before-ack",
        documentId: "document-1",
        clientSessionId: "terminal-before-ack-window",
        storeEpoch: adapter.storeEpoch,
        generation: adapter.generation,
        expectedHeadSeq: 0,
        deadlineAt: Date.now() + 10_000,
      });
      await waitUntil(() => adapter.relocationLeaseCalls.length === 1);
      adapter.commitExternal((title) => title.insert(0, "committed"));
      adapter.emit({
        kind: "relocation-lease-release",
        leaseId: "lease-terminal-before-ack",
        documentId: "document-1",
        clientSessionId: "terminal-before-ack-window",
        storeEpoch: adapter.storeEpoch,
        generation: adapter.generation,
        headSeq: 1,
      });
      await waitUntil(() => provider.getStatus().phase === "frozen");
      expect(provider.getStatus().relocationLease?.leaseId).toBe(
        "lease-terminal-before-ack",
      );
      ackResponse.resolve(
        success({
          accepted: true,
          leaseId: "lease-terminal-before-ack",
          documentId: "document-1",
          status: "frozen",
        }),
      );
      await waitUntil(() => provider.getStatus().phase === "synced");
      expect(provider.getStatus().relocationLease).toBe(undefined);
      expect(document.getText("title").toString()).toBe("committed");
    } finally {
      provider.destroy();
      document.destroy();
      adapter.destroy();
    }
  });

  test("requires reset when an acknowledged lease never receives a terminal event", async () => {
    const adapter = new MemoryDocumentSyncAdapter();
    const document = new Y.Doc({ guid: "document-1" });
    let currentDeadline: (() => void) | null = null;
    const provider = new NodexYProvider({
      documentId: "document-1",
      document,
      adapter,
      clientSessionId: "terminal-watchdog-window",
      autoConnect: false,
      localCheckpointStore: null,
      scheduleRelocationDeadline: (callback) => {
        currentDeadline = callback;
        return () => {
          if (currentDeadline === callback) currentDeadline = null;
        };
      },
    });
    try {
      await provider.connect();
      adapter.emit({
        kind: "relocation-lease-prepare",
        leaseId: "lease-terminal-watchdog",
        documentId: "document-1",
        clientSessionId: "terminal-watchdog-window",
        storeEpoch: adapter.storeEpoch,
        generation: adapter.generation,
        expectedHeadSeq: 0,
        deadlineAt: Date.now() + 10_000,
      });
      await waitUntil(() => provider.getStatus().phase === "frozen");
      const watchdog = currentDeadline as (() => void) | null;
      if (!watchdog) throw new Error("Missing terminal watchdog");
      watchdog();
      await waitUntil(() => provider.getStatus().phase === "reset-required");
      expect(provider.getStatus().error?.resetRequired).toBe(true);
    } finally {
      provider.destroy();
      document.destroy();
      adapter.destroy();
    }
  });

  test("deadline and surface errors NACK without ever entering frozen state", async () => {
    const timeoutAdapter = new MemoryDocumentSyncAdapter();
    const timeoutDocument = new Y.Doc({ guid: "document-1" });
    let fireDeadline: (() => void) | null = null;
    const surfaceGate = deferred<void>();
    const timeoutProvider = new NodexYProvider({
      documentId: "document-1",
      document: timeoutDocument,
      adapter: timeoutAdapter,
      clientSessionId: "timeout-window",
      autoConnect: false,
      localCheckpointStore: null,
      now: () => 1_000,
      scheduleRelocationDeadline: (callback) => {
        fireDeadline = callback;
        return () => {
          fireDeadline = null;
        };
      },
      prepareSurfaceForRelocation: () => surfaceGate.promise,
    });
    try {
      await timeoutProvider.connect();
      timeoutAdapter.emit({
        kind: "relocation-lease-prepare",
        leaseId: "lease-timeout",
        documentId: "document-1",
        clientSessionId: "timeout-window",
        storeEpoch: timeoutAdapter.storeEpoch,
        generation: timeoutAdapter.generation,
        expectedHeadSeq: timeoutAdapter.headSeq,
        deadlineAt: 2_000,
      });
      await waitUntil(() => timeoutProvider.getStatus().phase === "relocating");
      const deadlineCallback = fireDeadline as (() => void) | null;
      if (!deadlineCallback) throw new Error("Missing relocation deadline");
      deadlineCallback();
      await waitUntil(
        () => timeoutProvider.getStatus().phase === "reset-required",
      );
      const timeoutNack = timeoutAdapter.relocationLeaseCalls[0];
      expect(timeoutNack?.response).toBe("nack");
      if (timeoutNack?.response === "nack") {
        expect(timeoutNack.reason).toBe("deadline_elapsed");
      }
    } finally {
      surfaceGate.resolve(undefined);
      timeoutProvider.destroy();
      timeoutDocument.destroy();
      timeoutAdapter.destroy();
    }

    const errorAdapter = new MemoryDocumentSyncAdapter();
    const errorDocument = new Y.Doc({ guid: "document-1" });
    const errorProvider = new NodexYProvider({
      documentId: "document-1",
      document: errorDocument,
      adapter: errorAdapter,
      clientSessionId: "error-window",
      autoConnect: false,
      localCheckpointStore: null,
      prepareSurfaceForRelocation: () =>
        Promise.reject(new Error("IME composition is still active")),
    });
    try {
      await errorProvider.connect();
      errorAdapter.emit({
        kind: "relocation-lease-prepare",
        leaseId: "lease-error",
        documentId: "document-1",
        clientSessionId: "error-window",
        storeEpoch: errorAdapter.storeEpoch,
        generation: errorAdapter.generation,
        expectedHeadSeq: errorAdapter.headSeq,
        deadlineAt: Date.now() + 10_000,
      });
      await waitUntil(() => errorProvider.getStatus().phase === "reset-required");
      const errorNack = errorAdapter.relocationLeaseCalls[0];
      expect(errorNack?.response).toBe("nack");
      if (errorNack?.response === "nack") {
        expect(errorNack.reason).toBe("surface_prepare_failed");
      }
    } finally {
      errorProvider.destroy();
      errorDocument.destroy();
      errorAdapter.destroy();
    }
  });

  test("destroy NACKs a pending relocation lease best effort", async () => {
    const adapter = new MemoryDocumentSyncAdapter();
    const document = new Y.Doc({ guid: "document-1" });
    const surfaceGate = deferred<void>();
    const provider = new NodexYProvider({
      documentId: "document-1",
      document,
      adapter,
      clientSessionId: "destroy-window",
      autoConnect: false,
      localCheckpointStore: null,
      prepareSurfaceForRelocation: () => surfaceGate.promise,
    });
    try {
      await provider.connect();
      adapter.emit({
        kind: "relocation-lease-prepare",
        leaseId: "lease-destroy",
        documentId: "document-1",
        clientSessionId: "destroy-window",
        storeEpoch: adapter.storeEpoch,
        generation: adapter.generation,
        expectedHeadSeq: adapter.headSeq,
        deadlineAt: Date.now() + 10_000,
      });
      await waitUntil(() => provider.getStatus().phase === "relocating");
      provider.destroy();
      expect(provider.getStatus().phase).toBe("destroyed");
      const nack = adapter.relocationLeaseCalls[0];
      expect(nack?.response).toBe("nack");
      if (nack?.response === "nack") {
        expect(nack.reason).toBe("provider_destroyed");
      }
    } finally {
      surfaceGate.resolve(undefined);
      provider.destroy();
      document.destroy();
      adapter.destroy();
    }
  });

  test("disconnect NACKs an active lease and requires a fresh provider", async () => {
    const adapter = new MemoryDocumentSyncAdapter();
    const document = new Y.Doc({ guid: "document-1" });
    const surfaceGate = deferred<void>();
    const provider = new NodexYProvider({
      documentId: "document-1",
      document,
      adapter,
      clientSessionId: "disconnect-window",
      autoConnect: false,
      localCheckpointStore: null,
      prepareSurfaceForRelocation: () => surfaceGate.promise,
    });
    try {
      await provider.connect();
      adapter.emit({
        kind: "relocation-lease-prepare",
        leaseId: "lease-disconnect",
        documentId: "document-1",
        clientSessionId: "disconnect-window",
        storeEpoch: adapter.storeEpoch,
        generation: adapter.generation,
        expectedHeadSeq: adapter.headSeq,
        deadlineAt: Date.now() + 10_000,
      });
      await waitUntil(() => provider.getStatus().phase === "relocating");
      provider.disconnect();
      expect(provider.getStatus().phase).toBe("reset-required");
      const nack = adapter.relocationLeaseCalls[0];
      expect(nack?.response).toBe("nack");
      if (nack?.response === "nack") {
        expect(nack.reason).toBe("provider_disconnected");
      }
    } finally {
      surfaceGate.resolve(undefined);
      provider.destroy();
      document.destroy();
      adapter.destroy();
    }
  });
});
