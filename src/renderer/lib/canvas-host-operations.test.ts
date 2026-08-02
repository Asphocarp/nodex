import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  LIBRARY_MODULE_CONTRACT_VERSION,
  type LibraryCanvasSummary,
  type LibraryModuleApplyRequest,
  type LibraryModuleApplyResult,
} from "../../shared/library-module";
import { bindLibraryModuleApply } from "../../shared/library-module-transport";
import { createUuidV7FromTimestamp } from "../../shared/uuid-v7";
import {
  applyLibraryModule,
  readLibraryModule,
} from "./api";
import {
  applyLibraryRequestWithExactRetry,
  createCanvasInHostPage,
  createCanvasPageDestination,
  deleteCanvasOwner,
  duplicateCanvasInHostPage,
  moveCanvasOwnerBetweenHostPages,
  prepareCanvasHost,
  registerCanvasHostDocumentRuntime,
  resolveCanvasDropInsertion,
  resolveCanvasHostDocumentRuntime,
  resolveCanvasInsertionAfterBlock,
  type CanvasHostDocumentRuntime,
} from "./canvas-host-operations";

vi.mock("./api", () => ({
  applyLibraryModule: vi.fn(),
  readLibraryModule: vi.fn(),
}));

const uuidV7 = (sequence: number): string =>
  createUuidV7FromTimestamp(1_785_491_085_000, sequence);

function makeRuntime(input: {
  readonly storeEpoch?: string;
  readonly generation?: number;
  readonly headSeq?: number;
} = {}): CanvasHostDocumentRuntime {
  const storeEpoch = input.storeEpoch ?? "epoch-1";
  const generation = input.generation ?? 2;
  const headSeq = input.headSeq ?? 7;
  let flushed = false;
  const getStatus = () => ({
      phase: "ready",
      ready: true,
      reloadRequired: false,
      writeFrozen: false,
      descriptor: {
        projectId: "project-1",
        documentId: "document-1",
        ownerBlockId: "page-1",
        ownerType: "page",
        ownerLifecycle: "active",
        schemaKey: "nodex.page",
        schemaVersion: 1,
        storeEpoch,
        generation,
        headSeq: flushed ? headSeq + 1 : headSeq,
        readiness: "ready",
        sync: { kind: "yjs", stateVector: new Uint8Array() },
      },
      provider: {
        phase: "synced",
        documentId: "document-1",
        clientSessionId: "client-1",
        connected: true,
        storeEpoch,
        generation,
        headSeq: flushed ? headSeq + 1 : headSeq,
        pendingUpdateCount: 0,
      },
    }) as ReturnType<CanvasHostDocumentRuntime["getStatus"]>;
  return {
    getStatus,
    prepareDurableMutation: async () => {
      flushed = true;
      return getStatus();
    },
  };
}

const canvasSummary = (canvasId: string): LibraryCanvasSummary => ({
  canvasId,
  projectId: "project-1",
  title: "Canvas",
  lifecycle: "active",
  isPrimary: false,
  location: { kind: "library" },
  locationRevision: 3,
  metadataRevision: 5,
  documentGeneration: 9,
  documentHeadSeq: 99,
  updatedAt: "2026-07-30T00:00:00.000Z",
});

const receiptFor = (
  request: LibraryModuleApplyRequest,
): Extract<LibraryModuleApplyResult, { readonly ok: true }> => ({
  ok: true,
  value: {
    version: LIBRARY_MODULE_CONTRACT_VERSION,
    operationId: request.operationId,
    storeEpoch: request.storeEpoch,
    libraryId: "library-1",
    operationKind: request.operation.kind,
    duplicate: false,
    didMutate: true,
    createdTarget: null,
    canvasMutation: null,
    affectedParentKeys: [],
    affectedPageIds: [],
    affectedDatabaseIds: [],
    affectedViewIds: [],
    committedRevisions: {},
    changeLogSeq: 10,
    committedAt: "2026-07-30T00:00:00.000Z",
  },
});

describe("Canvas host operations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readLibraryModule).mockImplementation(async (request) => ({
      ok: true,
      value: {
        version: LIBRARY_MODULE_CONTRACT_VERSION,
        profileId: "profile-1",
        libraryId: "library-1",
        storeEpoch: "epoch-1",
        changeLogSeq: 9,
        value: {
          kind: "canvas_target",
          value: {
            status: "available",
            summary: canvasSummary(
              request.read.mode === "canvas_target"
                ? request.read.canvasId
                : uuidV7(90),
            ),
          },
        },
      },
    }));
    vi.mocked(applyLibraryModule).mockImplementation(async (request) => {
      bindLibraryModuleApply(request);
      return receiptFor(request);
    });
  });

  test("captures the persisted host head, not the pre-flush head", async () => {
    await expect(prepareCanvasHost(makeRuntime())).resolves.toEqual({
      storeEpoch: "epoch-1",
      documentRevision: {
        expectedDocumentGeneration: 2,
        expectedDocumentHeadSeq: 8,
      },
    });
  });

  test("builds a Page destination from only the Document revision", () => {
    expect(createCanvasPageDestination({
      pageId: uuidV7(1),
      documentRevision: {
        expectedDocumentGeneration: 2,
        expectedDocumentHeadSeq: 8,
      },
      insertion: {
        kind: "before",
        anchorBlockId: uuidV7(2),
      },
    })).toEqual({
      kind: "page",
      pageId: uuidV7(1),
      expectedDocumentGeneration: 2,
      expectedDocumentHeadSeq: 8,
      insertion: {
        kind: "before",
        anchorBlockId: uuidV7(2),
      },
    });
  });

  test("creates, duplicates, and moves with exact transport destinations", async () => {
    const pageId = uuidV7(1);
    const replacementBlockId = uuidV7(2);
    const canvasId = uuidV7(3);
    const canvasDocumentId = uuidV7(4);
    const duplicateCanvasId = uuidV7(5);
    const duplicateDocumentId = uuidV7(6);
    const runtime = makeRuntime();

    await createCanvasInHostPage({
      hostPageId: pageId,
      replacementBlockId,
      runtime,
      identities: {
        operationId: uuidV7(7),
        canvasId,
        documentId: canvasDocumentId,
      },
    });
    await duplicateCanvasInHostPage({
      sourceCanvasBlockId: canvasId,
      hostPageId: pageId,
      insertion: { kind: "append" },
      runtime,
      identities: {
        operationId: uuidV7(8),
        canvasId: duplicateCanvasId,
        documentId: duplicateDocumentId,
      },
    });
    await moveCanvasOwnerBetweenHostPages({
      canvasBlockId: canvasId,
      targetPageId: pageId,
      insertion: {
        kind: "before",
        anchorBlockId: replacementBlockId,
      },
      sourceRuntime: runtime,
      targetRuntime: runtime,
      operationId: uuidV7(9),
    });

    expect(applyLibraryModule).toHaveBeenCalledTimes(3);
    for (const [request] of vi.mocked(applyLibraryModule).mock.calls) {
      const operation = request.operation;
      if (
        operation.kind !== "create_canvas"
        && operation.kind !== "duplicate_canvas"
        && operation.kind !== "move_canvas"
      ) {
        throw new Error(`Unexpected operation ${operation.kind}`);
      }
      expect(operation.destination.kind).toBe("page");
      expect(Object.keys(operation.destination).sort()).toEqual([
        "expectedDocumentGeneration",
        "expectedDocumentHeadSeq",
        "insertion",
        "kind",
        "pageId",
      ]);
    }
  });

  test("uses the target Page Document revision for a cross-Page move", async () => {
    const canvasId = uuidV7(1);
    const targetPageId = uuidV7(2);

    await moveCanvasOwnerBetweenHostPages({
      canvasBlockId: canvasId,
      targetPageId,
      insertion: { kind: "append" },
      sourceRuntime: makeRuntime({
        generation: 2,
        headSeq: 7,
      }),
      targetRuntime: makeRuntime({
        generation: 4,
        headSeq: 20,
      }),
      operationId: uuidV7(3),
    });

    const request = vi.mocked(applyLibraryModule).mock.calls[0]?.[0];
    expect(request?.operation).toMatchObject({
      kind: "move_canvas",
      canvasId,
      destination: {
        kind: "page",
        pageId: targetPageId,
        expectedDocumentGeneration: 4,
        expectedDocumentHeadSeq: 21,
        insertion: { kind: "append" },
      },
    });
  });

  test("rejects mixed Store coordinates before applying a move", async () => {
    const canvasId = uuidV7(1);
    vi.mocked(readLibraryModule).mockResolvedValueOnce({
      ok: true,
      value: {
        version: LIBRARY_MODULE_CONTRACT_VERSION,
        profileId: "profile-1",
        libraryId: "library-1",
        storeEpoch: "epoch-2",
        changeLogSeq: 9,
        value: {
          kind: "canvas_target",
          value: {
            status: "available",
            summary: canvasSummary(canvasId),
          },
        },
      },
    });

    await expect(moveCanvasOwnerBetweenHostPages({
      canvasBlockId: canvasId,
      targetPageId: uuidV7(2),
      insertion: { kind: "append" },
      sourceRuntime: makeRuntime(),
      targetRuntime: makeRuntime(),
      operationId: uuidV7(3),
    })).rejects.toThrow("Store changed while preparing Canvas");
    expect(applyLibraryModule).not.toHaveBeenCalled();
  });

  test("retries transport ambiguity with the exact same operation request", async () => {
    const request = {
      version: LIBRARY_MODULE_CONTRACT_VERSION,
      operationId: "operation-1",
      storeEpoch: "epoch-1",
      operation: {
        kind: "create_canvas",
        canvasId: "canvas-1",
        documentId: "document-2",
        displayName: "Canvas",
        destination: {
          kind: "page",
          pageId: "page-1",
          expectedDocumentGeneration: 2,
          expectedDocumentHeadSeq: 8,
          insertion: {
            kind: "replace_empty_paragraph",
            blockId: "paragraph-1",
          },
        },
      },
    } satisfies LibraryModuleApplyRequest;
    const apply = vi.fn()
      .mockRejectedValueOnce(new Error("connection lost"))
      .mockResolvedValueOnce({
        ok: true,
        value: {
          version: LIBRARY_MODULE_CONTRACT_VERSION,
          operationId: "operation-1",
          storeEpoch: "epoch-1",
          libraryId: "library-1",
          operationKind: "create_canvas",
          duplicate: true,
          didMutate: true,
          createdTarget: { kind: "canvas", canvasId: "canvas-1" },
          canvasMutation: null,
          affectedParentKeys: ["page:page-1"],
          affectedPageIds: ["page-1"],
          affectedDatabaseIds: [],
          affectedViewIds: [],
          committedRevisions: {},
          changeLogSeq: 9,
          committedAt: "2026-07-30T00:00:00.000Z",
        },
      });

    await applyLibraryRequestWithExactRetry(request, apply);

    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply.mock.calls[0]?.[0]).toBe(request);
    expect(apply.mock.calls[1]?.[0]).toBe(request);
  });

  test("deletes from owner coordinates without any scene runtime barrier", async () => {
    const apply = vi.fn(async (
      request: LibraryModuleApplyRequest,
    ): Promise<LibraryModuleApplyResult> => ({
      ok: true,
      value: {
        version: LIBRARY_MODULE_CONTRACT_VERSION,
        operationId: request.operationId,
        storeEpoch: request.storeEpoch,
        libraryId: "library-1",
        operationKind: "delete_canvas",
        duplicate: false,
        didMutate: true,
        createdTarget: null,
        canvasMutation: null,
        affectedParentKeys: ["page:page-1"],
        affectedPageIds: ["page-1"],
        affectedDatabaseIds: [],
        affectedViewIds: [],
        committedRevisions: {},
        changeLogSeq: 10,
        committedAt: "2026-07-30T00:00:00.000Z",
      },
    }));
    const retireOwner = vi.fn(async () => {
      throw new Error("Canvas scene provider is already closed");
    });

    await deleteCanvasOwner({
      canvasBlockId: "canvas-1",
      operationId: "delete-1",
    }, {
      readTarget: async () => ({
        storeEpoch: "epoch-1",
        summary: {
          canvasId: "canvas-1",
          projectId: "project-1",
          title: "Canvas",
          lifecycle: "active",
          isPrimary: false,
          location: {
            kind: "page",
            pageId: "page-1",
            documentId: "page-document-1",
          },
          locationRevision: 3,
          metadataRevision: 5,
          documentGeneration: 9,
          documentHeadSeq: 99,
          updatedAt: "2026-07-30T00:00:00.000Z",
        },
      } as const),
      apply,
      retireOwner,
    });

    expect(apply).toHaveBeenCalledWith({
      version: LIBRARY_MODULE_CONTRACT_VERSION,
      operationId: "delete-1",
      storeEpoch: "epoch-1",
      operation: {
        kind: "delete_canvas",
        canvasId: "canvas-1",
        expectedLocationRevision: 3,
        expectedMetadataRevision: 5,
      },
    });
    expect(retireOwner).toHaveBeenCalledWith("project-1", "canvas-1");
  });

  test("resolves after-position as before-next or append at the same nesting level", () => {
    expect(resolveCanvasInsertionAfterBlock({
      blockId: "canvas-1",
      siblingBlockIds: ["canvas-1", "paragraph-2"],
    })).toEqual({
      kind: "before",
      anchorBlockId: "paragraph-2",
    });
    expect(resolveCanvasInsertionAfterBlock({
      blockId: "canvas-1",
      parentBlockId: "toggle-1",
      siblingBlockIds: ["paragraph-1", "canvas-1"],
    })).toEqual({
      kind: "append",
      parentBlockId: "toggle-1",
    });
  });

  test("resolves drop coordinates to a typed Page insertion", () => {
    expect(resolveCanvasDropInsertion({
      parentBlockId: "toggle-1",
      beforeBlockId: "paragraph-2",
    })).toEqual({
      kind: "before",
      parentBlockId: "toggle-1",
      anchorBlockId: "paragraph-2",
    });
    expect(resolveCanvasDropInsertion({
      parentBlockId: "toggle-1",
    })).toEqual({
      kind: "append",
      parentBlockId: "toggle-1",
    });
  });

  test("keeps drag source runtimes scoped to their mounted surface", () => {
    const runtime = makeRuntime();
    const unregister = registerCanvasHostDocumentRuntime("surface-1", runtime);
    expect(resolveCanvasHostDocumentRuntime("surface-1")).toBe(runtime);
    unregister();
    expect(resolveCanvasHostDocumentRuntime("surface-1")).toBeNull();
  });
});
