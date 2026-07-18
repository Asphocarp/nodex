import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as Y from "yjs";
import { BlockMutationWriter } from "../src/main/block-mutation-writer";
import {
  DocumentSyncHub,
  type DocumentSyncClientTarget,
} from "../src/main/document-sync-hub";
import { createPage } from "../src/main/local-store/database-pages";
import { getDatabasePath } from "../src/main/local-store/config";
import {
  closeDatabase,
  initializeDatabase,
} from "../src/main/local-store/database";
import { createProject } from "../src/main/local-store/projects";
import { materializePageDocument } from "../src/shared/block-documents/block-document-codec";
import type {
  DocumentBlockOperation,
  DocumentMutationRequest,
} from "../src/shared/block-documents/document-operations";
import type { DocumentSyncRealtimeEvent } from "../src/shared/block-documents/document-sync";
import type { BoardChangeEvent } from "../src/shared/ipc-api";
import { createUuidV7FromTimestamp } from "../src/shared/uuid-v7";

const invariant: (condition: unknown, message: string) => asserts condition = (
  condition,
  message,
) => {
  if (condition) return;
  throw new Error(message);
};

class ProbeTarget extends EventEmitter implements DocumentSyncClientTarget {
  readonly events: DocumentSyncRealtimeEvent[] = [];
  private destroyed = false;

  constructor(readonly id: number) {
    super();
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  send(channel: string, ...args: unknown[]): void {
    if (this.destroyed || channel !== "document-sync:event") return;
    this.events.push(args[0] as DocumentSyncRealtimeEvent);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit("destroyed");
  }
}

const waitUntil = async (predicate: () => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
  }
  throw new Error("Runtime probe condition did not settle");
};

const lastPrepare = (
  target: ProbeTarget,
): Extract<
  DocumentSyncRealtimeEvent,
  { readonly kind: "relocation-lease-prepare" }
> | null => {
  for (let index = target.events.length - 1; index >= 0; index -= 1) {
    const event = target.events[index];
    if (event?.kind === "relocation-lease-prepare") return event;
  }
  return null;
};

const mutation = (input: {
  readonly mutationId: string;
  readonly projectId: string;
  readonly storeEpoch: string;
  readonly documentId: string;
  readonly generation: number;
  readonly expectedHeadSeq: number;
  readonly operations: readonly DocumentBlockOperation[];
}): DocumentMutationRequest => ({
  version: 1,
  mutationId: input.mutationId,
  projectId: input.projectId,
  storeEpoch: input.storeEpoch,
  clientSessionId: "runtime-probe-command",
  actor: { kind: "runtime_probe" },
  documentId: input.documentId,
  generation: input.generation,
  expectedHeadSeq: input.expectedHeadSeq,
  operations: input.operations,
});

const countEvents = (
  target: ProbeTarget,
  kind: DocumentSyncRealtimeEvent["kind"],
): number => target.events.filter((event) => event.kind === kind).length;

const run = async (): Promise<void> => {
  const previousNodexHome = process.env.NODEX_HOME;
  const tempDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "nodex-document-operation-transport-runtime-"),
  );
  process.env.NODEX_HOME = tempDir;
  let writer: BlockMutationWriter | undefined;
  let restartedWriter: BlockMutationWriter | undefined;
  try {
    await initializeDatabase();
    const project = createProject({ name: "Document operation transport" });
    const card = await createPage(project.id, "triage", {
      title: "Original title",
      description: "First paragraph\n\nSecond paragraph",
    });
    closeDatabase();

    const boardEvents: BoardChangeEvent[] = [];
    const boardEventCount = (): number => boardEvents.length;
    writer = new BlockMutationWriter({
      publishBoardEvent: (event) => boardEvents.push(event),
    });
    const prepared = await writer.prepareOwnedBlockDocument(
      project.id,
      card.id,
    );
    invariant(
      prepared.ok && prepared.value.sync.kind === "yjs",
      "Card is not backed by Y.Doc authority",
    );
    const descriptor = prepared.value;

    const hub = new DocumentSyncHub({
      sync: (request) => writer!.syncBlockDocument(request),
      applyUpdate: (request) => writer!.applyBlockDocumentUpdate(request),
      applyDocumentMutation: (request, writeFence) =>
        writer!.applyDocumentMutation(request, writeFence),
      lookupCommittedRelocation: (intent) =>
        writer!.readCommittedRelocation(intent),
      prepareRelocationCommand: (intent) =>
        writer!.prepareRelocationCommand(intent),
      relocateBlocks: (request) => writer!.relocateBlocks(request),
    });
    const left = new ProbeTarget(701);
    const right = new ProbeTarget(702);
    for (const [target, session] of [
      [left, "surface-left"],
      [right, "surface-right"],
    ] as const) {
      const subscribed = hub.subscribe(target, {
        documentId: descriptor.documentId,
        clientSessionId: session,
      });
      invariant(subscribed.ok, `Could not subscribe ${session}`);
      const synced = await hub.sync(target, {
        documentId: descriptor.documentId,
        clientSessionId: session,
        stateVector: new Uint8Array([0]),
      });
      invariant(synced.ok, `Could not establish ${session} boundary`);
    }
    left.events.splice(0);
    right.events.splice(0);

    const insertedBlockId = createUuidV7FromTimestamp(1_784_000_000_000, 1);
    const insertRequest = mutation({
      mutationId: "document-operation-transport:insert",
      projectId: project.id,
      storeEpoch: descriptor.storeEpoch,
      documentId: descriptor.documentId,
      generation: descriptor.generation,
      expectedHeadSeq: descriptor.headSeq,
      operations: [
        {
          kind: "insert_block",
          block: {
            id: insertedBlockId,
            type: "paragraph",
            props: { textAlignment: "left" },
            content: [
              {
                type: "text",
                text: "Inserted by stable operation",
                styles: {},
              },
            ],
            children: [],
          },
        },
      ],
    });
    const inserted = await hub.applyDocumentMutation(insertRequest);
    invariant(
      inserted.ok &&
        !inserted.value.duplicate &&
        inserted.value.coordination === "merge_friendly" &&
        inserted.value.createdBlockIds.includes(insertedBlockId),
      "Merge-friendly Block insertion did not commit",
    );
    invariant(
      countEvents(left, "relocation-lease-prepare") === 0 &&
        countEvents(right, "relocation-lease-prepare") === 0,
      "Merge-friendly mutation unexpectedly acquired a write lease",
    );
    invariant(
      countEvents(left, "resync-required") === 1 &&
        countEvents(right, "resync-required") === 1,
      "Durable Block insertion did not fan out a resync fence",
    );
    invariant(
      boardEventCount() === 1 &&
        boardEvents[0]?.pageId === card.id &&
        boardEvents[0]?.summary?.title === "Original title",
      "Worker ACK preceded the authoritative Board summary event",
    );

    const insertRetry = await hub.applyDocumentMutation(insertRequest);
    invariant(
      insertRetry.ok && insertRetry.value.duplicate && boardEventCount() === 1,
      "Exact retry did not reuse its durable receipt",
    );

    const inspection = new (await import("better-sqlite3")).default(
      getDatabasePath(),
      { readonly: true },
    );
    const bodyBlockIds = (
      inspection
        .prepare(
          `
          SELECT block_id
          FROM document_block_index
          WHERE document_id = ?
          ORDER BY parent_block_id IS NOT NULL, ordinal ASC, block_id ASC
        `,
        )
        .all(descriptor.documentId) as { readonly block_id: string }[]
    ).map((row) => row.block_id);
    inspection.close();
    const originalBlockIds = bodyBlockIds.filter(
      (blockId) => blockId !== insertedBlockId,
    );
    invariant(
      bodyBlockIds.includes(insertedBlockId) && originalBlockIds.length >= 2,
      "Probe Card did not contain its inserted and original Blocks",
    );

    left.events.splice(0);
    right.events.splice(0);
    const deleteRequest = mutation({
      mutationId: "document-operation-transport:delete",
      projectId: project.id,
      storeEpoch: descriptor.storeEpoch,
      documentId: descriptor.documentId,
      generation: descriptor.generation,
      expectedHeadSeq: inserted.value.headSeq,
      operations: [{ kind: "delete_block", blockId: originalBlockIds[0]! }],
    });
    const pendingDelete = hub.applyDocumentMutation(deleteRequest);
    await waitUntil(() => lastPrepare(left) !== null && lastPrepare(right) !== null);
    for (const target of [left, right]) {
      const prepare = lastPrepare(target);
      invariant(prepare, "Mounted surface did not receive write-lease prepare");
      const acknowledged = hub.respondToRelocationLease(target, {
        response: "ack",
        leaseId: prepare.leaseId,
        documentId: prepare.documentId,
        clientSessionId: prepare.clientSessionId,
        storeEpoch: prepare.storeEpoch,
        generation: prepare.generation,
        headSeq: prepare.expectedHeadSeq,
      });
      invariant(acknowledged.ok, "Mounted surface could not freeze for mutation");
    }
    const deleted = await pendingDelete;
    invariant(
        deleted.ok &&
        deleted.value.coordination === "write_fence" &&
        deleted.value.deletedBlockIds.includes(originalBlockIds[0]!),
      "Fenced structural mutation did not commit",
    );
    for (const target of [left, right]) {
      invariant(
        countEvents(target, "relocation-lease-prepare") === 1 &&
          countEvents(target, "relocation-lease-release") === 1 &&
          countEvents(target, "resync-required") === 1,
        "A mounted surface did not observe prepare, resync, and release",
      );
    }
    invariant(
      boardEventCount() === 2,
      "Structural commit did not publish exactly one Board event",
    );

    const deleteRetry = await hub.applyDocumentMutation(deleteRequest);
    invariant(
      deleteRetry.ok &&
        deleteRetry.value.duplicate &&
        boardEventCount() === 2,
      "Structural exact retry reacquired a lease or duplicated Board fanout",
    );

    left.events.splice(0);
    right.events.splice(0);
    const staleRequest = mutation({
      mutationId: "document-operation-transport:stale-delete",
      projectId: project.id,
      storeEpoch: descriptor.storeEpoch,
      documentId: descriptor.documentId,
      generation: descriptor.generation,
      expectedHeadSeq: deleted.value.headSeq,
      operations: [{ kind: "delete_block", blockId: originalBlockIds[1]! }],
    });
    const pendingStale = hub.applyDocumentMutation(staleRequest);
    await waitUntil(() => lastPrepare(left) !== null && lastPrepare(right) !== null);
    const leftPrepare = lastPrepare(left);
    const rightPrepare = lastPrepare(right);
    invariant(leftPrepare && rightPrepare, "Stale-head lease was not published");
    invariant(
      hub.respondToRelocationLease(left, {
        response: "ack",
        leaseId: leftPrepare.leaseId,
        documentId: leftPrepare.documentId,
        clientSessionId: leftPrepare.clientSessionId,
        storeEpoch: leftPrepare.storeEpoch,
        generation: leftPrepare.generation,
        headSeq: leftPrepare.expectedHeadSeq + 1,
      }).ok,
      "Advanced surface ACK was rejected",
    );
    invariant(
      hub.respondToRelocationLease(right, {
        response: "ack",
        leaseId: rightPrepare.leaseId,
        documentId: rightPrepare.documentId,
        clientSessionId: rightPrepare.clientSessionId,
        storeEpoch: rightPrepare.storeEpoch,
        generation: rightPrepare.generation,
        headSeq: rightPrepare.expectedHeadSeq,
      }).ok,
      "Current surface ACK was rejected",
    );
    const stale = await pendingStale;
    invariant(
      !stale.ok &&
        stale.error.code === "document_head_conflict" &&
        stale.error.actualHeadSeq === deleted.value.headSeq + 1 &&
        boardEventCount() === 2,
      "Lease head advance did not abort the stale structural CAS",
    );
    invariant(
      countEvents(left, "relocation-lease-cancel") === 1 &&
        countEvents(right, "relocation-lease-cancel") === 1,
      "Stale structural CAS did not release frozen surfaces by cancellation",
    );

    left.destroy();
    right.destroy();
    await writer.shutdown();
    writer = undefined;

    restartedWriter = new BlockMutationWriter();
    const restartSync = await restartedWriter.syncBlockDocument({
      documentId: descriptor.documentId,
      clientSessionId: "restart-inspection",
      stateVector: new Uint8Array([0]),
    });
    invariant(
      restartSync.ok && restartSync.value.headSeq === deleted.value.headSeq,
      "Restart did not recover the exact durable Document head",
    );
    const restartedDocument = new Y.Doc({ guid: descriptor.documentId });
    try {
      Y.applyUpdate(restartedDocument, restartSync.value.update);
      const materialized = materializePageDocument(restartedDocument);
      const restartedIds = materialized.blockTree.map((block) => block.id);
      invariant(
        materialized.title === "Original title" &&
          restartedIds.includes(insertedBlockId) &&
          !restartedIds.includes(originalBlockIds[0]!) &&
          restartedIds.includes(originalBlockIds[1]!),
        "Restart sync did not preserve the committed delete and stale abort",
      );
    } finally {
      restartedDocument.destroy();
    }

    process.stdout.write(
      `${JSON.stringify({
        fifoWorker: true,
        exactRetry: true,
        boardEventOnce: true,
        mergeFriendlyNoLease: true,
        twoSurfaceWriteLease: true,
        staleHeadAbort: true,
        durableRestartResync: true,
      })}\n`,
    );
  } finally {
    if (writer) await writer.shutdown().catch(() => undefined);
    if (restartedWriter) await restartedWriter.shutdown().catch(() => undefined);
    closeDatabase();
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (previousNodexHome === undefined) delete process.env.NODEX_HOME;
    else process.env.NODEX_HOME = previousNodexHome;
  }
};

void run().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
});
