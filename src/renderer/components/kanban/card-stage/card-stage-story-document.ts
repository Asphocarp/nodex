import * as Y from "yjs";

import {
  createCardDocument,
  type DocumentSyncRealtimeEvent,
} from "../../../../shared/block-documents";
import { populateBlockDocumentBodyFromNfm } from "../../../../shared/block-documents/block-document-codec";
import { BlockDocumentSurfaceRuntime } from "@/lib/block-document-surface-runtime";
import type { DocumentSyncAdapter } from "@/lib/nodex-y-provider";
import type { CardStageProps } from "./types";

class StoryDocumentSyncAdapter implements DocumentSyncAdapter {
  private headSeq = 0;

  private readonly listeners = new Set<
    (event: DocumentSyncRealtimeEvent) => void
  >();

  constructor(private readonly document: Y.Doc) {}

  sync: DocumentSyncAdapter["sync"] = async (request) => ({
    ok: true,
    value: {
      documentId: this.document.guid,
      storeEpoch: "storybook-store",
      generation: 1,
      headSeq: this.headSeq,
      stateVector: Y.encodeStateVector(this.document),
      update: Y.encodeStateAsUpdate(this.document, request.stateVector),
    },
  });

  applyUpdate: DocumentSyncAdapter["applyUpdate"] = async (request) => {
    Y.applyUpdate(this.document, request.update, "storybook-surface");
    this.headSeq += 1;
    return {
      ok: true,
      value: {
        documentId: request.documentId,
        storeEpoch: "storybook-store",
        generation: 1,
        updateId: request.updateId,
        committedSeq: this.headSeq,
        headSeq: this.headSeq,
        stateVector: Y.encodeStateVector(this.document),
        duplicate: false,
      },
    };
  };

  subscribe: DocumentSyncAdapter["subscribe"] = (_request, listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  publishAwareness: DocumentSyncAdapter["publishAwareness"] = async () => ({
    ok: true,
    value: { accepted: true },
  });

  respondToRelocationLease: DocumentSyncAdapter["respondToRelocationLease"] =
    async (request) => ({
      ok: true,
      value: {
        accepted: true,
        leaseId: request.leaseId,
        documentId: request.documentId,
        status: request.response === "ack" ? "frozen" : "cancelled",
      },
    });
}

export interface CardStageStoryDocument {
  readonly authority: CardStageProps["documentAuthority"];
  readonly destroy: () => void;
}

export function createCardStageStoryDocument(input: {
  readonly projectId: string;
  readonly cardId: string;
  readonly title: string;
  readonly description: string;
}): CardStageStoryDocument {
  const documentId = `storybook:${input.projectId}:${input.cardId}`;
  const envelope = createCardDocument({
    documentId,
    initialTitle: input.title,
  });
  populateBlockDocumentBodyFromNfm(envelope.body, input.description);
  const adapter = new StoryDocumentSyncAdapter(envelope.document);

  return {
    authority: {
      kind: "yjs",
      descriptor: {
        projectId: input.projectId,
        ownerBlockId: input.cardId,
        ownerType: "card",
        ownerLifecycle: "active",
        documentId,
        storeEpoch: "storybook-store",
        generation: 1,
        headSeq: 0,
        schemaKey: "nodex.card",
        schemaVersion: 1,
        readiness: "ready",
        sync: { kind: "yjs", stateVector: Y.encodeStateVector(envelope.document) },
      },
      reload: async () => undefined,
      surfaceDependencies: {
        createAdapter: () => adapter,
        createRuntime: (options) =>
          new BlockDocumentSurfaceRuntime({
            ...options,
            localCheckpointStore: null,
          }),
      },
    },
    destroy: () => envelope.document.destroy(),
  };
}
