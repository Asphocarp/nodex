import { act, waitFor } from "@testing-library/react";
import { describe, expect, test } from "bun:test";
import * as Y from "yjs";
import {
  CARD_DOCUMENT_SCHEMA_KEY,
  CARD_DOCUMENT_SCHEMA_VERSION,
  createCardDocument,
  type DocumentSyncApplyRequest,
  type DocumentSyncCommandResult,
  type DocumentSyncRealtimeEvent,
  type DocumentSyncResponse,
} from "../../../shared/block-documents";
import { render } from "@/test/dom";
import { BlockDocumentSurfaceRuntime } from "@/lib/block-document-surface-runtime";
import type { DocumentSyncAdapter } from "@/lib/nodex-y-provider";
import {
  BlockDocumentSurface,
  type BlockDocumentSurfaceDependencies,
  type PrimaryCardBlockDocumentDescriptor,
} from "./block-document-surface";

const descriptor = (): PrimaryCardBlockDocumentDescriptor => ({
  projectId: "project-1",
  ownerBlockId: "card-1",
  ownerType: "card",
  ownerLifecycle: "active",
  documentId: "document:card-1",
  storeEpoch: "store-1",
  generation: 1,
  headSeq: 0,
  schemaKey: CARD_DOCUMENT_SCHEMA_KEY,
  schemaVersion: CARD_DOCUMENT_SCHEMA_VERSION,
  readiness: "ready",
  authority: "ydoc_primary",
  stateVector: new Uint8Array([0]),
});

class SurfaceTestAdapter implements DocumentSyncAdapter {
  readonly server = createCardDocument({
    documentId: "document:card-1",
    initialTitle: "Synced title",
  });
  subscriptions = 0;
  unsubscriptions = 0;
  awarenessPublishes = 0;
  headSeq = 0;

  private readonly listeners = new Set<
    (event: DocumentSyncRealtimeEvent) => void
  >();

  sync = async (request: {
    readonly stateVector: Uint8Array;
  }): Promise<DocumentSyncCommandResult<DocumentSyncResponse>> => ({
    ok: true,
    value: {
      documentId: this.server.documentId,
      storeEpoch: "store-1",
      generation: 1,
      headSeq: this.headSeq,
      stateVector: Y.encodeStateVector(this.server.document),
      update: Y.encodeStateAsUpdate(
        this.server.document,
        request.stateVector,
      ),
    },
  });

  applyUpdate = async (request: DocumentSyncApplyRequest) => {
    Y.applyUpdate(this.server.document, request.update, "surface-test-client");
    this.headSeq += 1;
    return {
      ok: true as const,
      value: {
        documentId: request.documentId,
        storeEpoch: "store-1",
        generation: 1,
        updateId: request.updateId,
        committedSeq: this.headSeq,
        headSeq: this.headSeq,
        stateVector: Y.encodeStateVector(this.server.document),
        duplicate: false,
      },
    };
  };

  subscribe = (
    _request: unknown,
    listener: (event: DocumentSyncRealtimeEvent) => void,
  ) => {
    this.subscriptions += 1;
    this.listeners.add(listener);
    return () => {
      this.unsubscriptions += 1;
      this.listeners.delete(listener);
    };
  };

  publishAwareness = async () => {
    this.awarenessPublishes += 1;
    return { ok: true as const, value: { accepted: true as const } };
  };

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

  destroy = (): void => this.server.document.destroy();
}

describe("BlockDocumentSurface", () => {
  test("opens after sync, retains content sync without inactive presence, and clears its runtime ref on close", async () => {
    const adapter = new SurfaceTestAdapter();
    const runtimeRef: { current: BlockDocumentSurfaceRuntime | null } = {
      current: null,
    };
    const dependencies: BlockDocumentSurfaceDependencies = {
      createAdapter: () => adapter,
      createRuntime: (options) =>
        new BlockDocumentSurfaceRuntime({
          ...options,
          localCheckpointStore: null,
          closeTimeoutMs: 100,
        }),
    };
    const ownedDescriptor = descriptor();
    const renderSurface = (isActive: boolean) => (
      <BlockDocumentSurface
        projectId="project-1"
        descriptor={ownedDescriptor}
        isActive={isActive}
        localAwarenessState={{ user: { name: "Ada" } }}
        dependencies={dependencies}
        runtimeRef={runtimeRef}
      >
        {(surface) => <div>{surface.title.toString()}</div>}
      </BlockDocumentSurface>
    );
    const view = render(renderSurface(true));

    await waitFor(() => {
      expect(view.getByText("Synced title").textContent).toBe("Synced title");
    });
    const runtime = runtimeRef.current;
    expect(runtime).not.toBeNull();
    expect(adapter.subscriptions).toBe(1);
    expect(
      (runtime?.awareness.getLocalState()?.nodex as { clientSessionId?: string })
        .clientSessionId,
    ).toBe(runtime?.clientSessionId);

    view.rerender(renderSurface(false));
    await waitFor(() => {
      expect(runtime?.awareness.getLocalState()).toBe(null);
    });
    expect(adapter.unsubscriptions).toBe(0);
    expect(runtime?.getStatus().ready).toBeTrue();

    view.rerender(renderSurface(true));
    await waitFor(() => {
      expect(runtime?.awareness.getLocalState() === null).toBeFalse();
    });
    expect(
      (runtime?.awareness.getLocalState()?.user as { name?: string }).name,
    ).toBe("Ada");

    await act(async () => {
      await runtime?.persist();
      view.unmount();
      await Promise.resolve();
    });
    expect(runtimeRef.current).toBe(null);
    await waitFor(() => expect(adapter.unsubscriptions).toBe(1));
    adapter.destroy();
  });

  test("rejects a descriptor from another Project before connecting", async () => {
    const adapter = new SurfaceTestAdapter();
    const mismatched: PrimaryCardBlockDocumentDescriptor = {
      ...descriptor(),
      projectId: "other-project",
    };
    const dependencies: BlockDocumentSurfaceDependencies = {
      createAdapter: () => adapter,
    };
    const view = render(
      <BlockDocumentSurface
        projectId="project-1"
        descriptor={mismatched}
        isActive
        dependencies={dependencies}
      >
        {() => <div>Should not render</div>}
      </BlockDocumentSurface>,
    );

    await waitFor(() => {
      expect(view.getByRole("alert").textContent?.includes("Reload")).toBeTrue();
    });
    expect(adapter.subscriptions).toBe(0);
    adapter.destroy();
  });
});
