import { describe, expect, test } from "vitest";

import {
  bindLibraryModuleApply,
  bindLibraryModuleRead,
  parseLibraryModuleApplyResult,
  parseLibraryModuleReadResult,
} from "./library-module-transport";
import { LIBRARY_MODULE_CONTRACT_VERSION } from "./library-module";
import {
  primaryCanvasBlockId,
  primaryCanvasDocumentId,
} from "./block-documents/canvas-document-identity";
import { createUuidV7FromTimestamp } from "./uuid-v7";

const uuidV7 = (sequence: number): string =>
  createUuidV7FromTimestamp(1_785_491_085_000, sequence);

const primaryCanvasId = primaryCanvasBlockId("project:default");
const primaryDocumentId = primaryCanvasDocumentId("project:default");
const readResult = (value: unknown) => ({
  ok: true,
  value: {
    version: LIBRARY_MODULE_CONTRACT_VERSION,
    profileId: "profile-1",
    libraryId: "library-1",
    storeEpoch: "epoch-1",
    changeLogSeq: 3,
    value,
  },
});

describe("Library Module transport", () => {
  test("binds bounded navigation requests without caller Library identity", () => {
    expect(
      bindLibraryModuleRead({
        version: LIBRARY_MODULE_CONTRACT_VERSION,
        read: {
          mode: "children",
          parent: { kind: "page", pageId: "page-1" },
          limit: 50,
        },
      }),
    ).toEqual({
      version: LIBRARY_MODULE_CONTRACT_VERSION,
      read: {
        mode: "children",
        parent: { kind: "page", pageId: "page-1" },
        limit: 50,
      },
    });
    expect(() =>
      bindLibraryModuleRead({
        version: LIBRARY_MODULE_CONTRACT_VERSION,
        libraryId: "forged-library",
        read: { mode: "metadata" },
      }),
    ).toThrow("libraryId is not supported");
  });

  test("rejects unbounded and structurally ambiguous requests", () => {
    expect(() =>
      bindLibraryModuleRead({
        version: LIBRARY_MODULE_CONTRACT_VERSION,
        read: {
          mode: "children",
          parent: { kind: "library" },
          limit: 101,
        },
      }),
    ).toThrow("between 1 and 100");
    expect(() =>
      bindLibraryModuleRead({
        version: LIBRARY_MODULE_CONTRACT_VERSION,
        read: {
          mode: "catalog",
          kinds: ["page", "page"],
        },
      }),
    ).toThrow("unique kinds");
  });

  test("parses an authoritative children snapshot", () => {
    expect(
      parseLibraryModuleReadResult({
        ok: true,
        value: {
          version: LIBRARY_MODULE_CONTRACT_VERSION,
          profileId: "profile-1",
          libraryId: "library-1",
          storeEpoch: "epoch-1",
          changeLogSeq: 3,
          value: {
            kind: "children",
            parent: { kind: "library" },
            items: [
              {
                kind: "database",
                databaseId: "database-1",
                title: "Tasks",
                defaultViewId: "view-1",
                hasMultipleViews: false,
                metadataRevision: 1,
                locationRevision: 1,
                updatedAt: "2026-07-18T00:00:00.000Z",
              },
            ],
            nextCursor: null,
            hasMore: false,
            total: 1,
          },
        },
      }),
    ).toMatchObject({
      ok: true,
      value: {
        profileId: "profile-1",
        value: { kind: "children", total: 1 },
      },
    });
  });

  test("binds and parses the deterministic primary Canvas identity", () => {
    expect(bindLibraryModuleRead({
      version: LIBRARY_MODULE_CONTRACT_VERSION,
      read: {
        mode: "canvas_target",
        canvasId: primaryCanvasId,
      },
    })).toEqual({
      version: LIBRARY_MODULE_CONTRACT_VERSION,
      read: {
        mode: "canvas_target",
        canvasId: primaryCanvasId,
      },
    });

    expect(parseLibraryModuleReadResult({
      ok: true,
      value: {
        version: LIBRARY_MODULE_CONTRACT_VERSION,
        profileId: "profile-1",
        libraryId: "library-1",
        storeEpoch: "epoch-1",
        changeLogSeq: 3,
        value: {
          kind: "canvas_target",
          value: {
            status: "available",
            summary: {
              canvasId: primaryCanvasId,
              projectId: "project:default",
              title: "Canvas",
              lifecycle: "active",
              isPrimary: true,
              location: { kind: "library" },
              metadataRevision: 1,
              locationRevision: 1,
              documentGeneration: 1,
              documentHeadSeq: 0,
              updatedAt: "2026-07-31T00:00:00.000Z",
            },
          },
        },
      },
    })).toMatchObject({
      ok: true,
      value: {
        value: {
          kind: "canvas_target",
          value: {
            status: "available",
            summary: {
              canvasId: primaryCanvasId,
              isPrimary: true,
            },
          },
        },
      },
    });

    expect(parseLibraryModuleReadResult({
      ok: true,
      value: {
        version: LIBRARY_MODULE_CONTRACT_VERSION,
        profileId: "profile-1",
        libraryId: "library-1",
        storeEpoch: "epoch-1",
        changeLogSeq: 3,
        value: {
          kind: "children",
          parent: { kind: "library" },
          items: [{
            kind: "canvas",
            canvasId: primaryCanvasId,
            title: "Canvas",
            isPrimary: true,
            metadataRevision: 1,
            locationRevision: 1,
            documentGeneration: 1,
            documentHeadSeq: 0,
            updatedAt: "2026-07-31T00:00:00.000Z",
          }],
          nextCursor: null,
          hasMore: false,
          total: 1,
        },
      },
    })).toMatchObject({
      ok: true,
      value: {
        value: {
          items: [{ canvasId: primaryCanvasId, isPrimary: true }],
        },
      },
    });
  });

  test("accepts primary identities only for existing Canvas coordinates", () => {
    const destination = { kind: "library" } as const;
    const base = {
      version: LIBRARY_MODULE_CONTRACT_VERSION,
      operationId: uuidV7(1),
      storeEpoch: "epoch-1",
    } as const;

    expect(bindLibraryModuleApply({
      ...base,
      operation: {
        kind: "rename_canvas",
        canvasId: primaryCanvasId,
        displayName: "Architecture",
        expectedMetadataRevision: 1,
      },
    }).operation).toMatchObject({ canvasId: primaryCanvasId });
    expect(bindLibraryModuleApply({
      ...base,
      operationId: uuidV7(2),
      operation: {
        kind: "move_canvas",
        canvasId: primaryCanvasId,
        expectedLocationRevision: 1,
        destination,
      },
    }).operation).toMatchObject({ canvasId: primaryCanvasId });
    expect(bindLibraryModuleApply({
      ...base,
      operationId: uuidV7(3),
      operation: {
        kind: "delete_canvas",
        canvasId: primaryCanvasId,
        expectedLocationRevision: 1,
        expectedMetadataRevision: 1,
      },
    }).operation).toMatchObject({ canvasId: primaryCanvasId });
    expect(bindLibraryModuleApply({
      ...base,
      operationId: uuidV7(4),
      operation: {
        kind: "duplicate_canvas",
        sourceCanvasId: primaryCanvasId,
        canvasId: uuidV7(5),
        documentId: uuidV7(6),
        expectedDocumentGeneration: 1,
        expectedDocumentHeadSeq: 0,
        destination,
      },
    }).operation).toMatchObject({ sourceCanvasId: primaryCanvasId });

    expect(() => bindLibraryModuleApply({
      ...base,
      operationId: uuidV7(7),
      operation: {
        kind: "create_canvas",
        canvasId: primaryCanvasId,
        documentId: uuidV7(8),
        displayName: "Canvas",
        destination,
      },
    })).toThrow("expected canonical lowercase UUID-v7");
    expect(() => bindLibraryModuleRead({
      version: LIBRARY_MODULE_CONTRACT_VERSION,
      read: {
        mode: "canvas_target",
        canvasId: "canvas:primary:",
      },
    })).toThrow("primary Canvas Block ID");
  });

  test("parses primary Canvas unavailable, path, and catalog targets", () => {
    for (const value of [
      {
        kind: "canvas_target",
        value: { status: "missing", canvasId: primaryCanvasId },
      },
      {
        kind: "canvas_target",
        value: {
          status: "deleted",
          canvasId: primaryCanvasId,
          libraryId: "library-1",
        },
      },
    ]) {
      expect(parseLibraryModuleReadResult(readResult(value))).toMatchObject({
        ok: true,
        value: {
          value: {
            kind: "canvas_target",
            value: { canvasId: primaryCanvasId },
          },
        },
      });
    }

    expect(parseLibraryModuleReadResult(readResult({
      kind: "path",
      target: { kind: "canvas", canvasId: primaryCanvasId },
      nodes: [],
    }))).toMatchObject({
      ok: true,
      value: {
        value: {
          target: { kind: "canvas", canvasId: primaryCanvasId },
        },
      },
    });
    expect(parseLibraryModuleReadResult(readResult({
      kind: "catalog",
      items: [{
        target: { kind: "canvas", canvasId: primaryCanvasId },
        title: "Canvas",
        kind: "canvas",
        lifecycle: "active",
        locationLabel: "Library",
        updatedAt: "2026-07-31T00:00:00.000Z",
        locationRevision: 1,
        metadataRevision: 1,
      }],
      nextCursor: null,
      hasMore: false,
      total: 1,
    }))).toMatchObject({
      ok: true,
      value: {
        value: {
          items: [{
            target: { kind: "canvas", canvasId: primaryCanvasId },
          }],
        },
      },
    });
  });

  test("parses primary Canvas mutation receipts without weakening new IDs", () => {
    expect(parseLibraryModuleApplyResult({
      ok: true,
      value: {
        version: LIBRARY_MODULE_CONTRACT_VERSION,
        operationId: uuidV7(1),
        storeEpoch: "epoch-1",
        libraryId: "library-1",
        operationKind: "rename_canvas",
        duplicate: false,
        didMutate: true,
        createdTarget: null,
        canvasMutation: {
          operationKind: "rename_canvas",
          canvasId: primaryCanvasId,
          documentId: primaryDocumentId,
          sourceCanvasId: null,
          locationRevision: 1,
          metadataRevision: 2,
          documentCommits: [],
        },
        affectedParentKeys: ["library"],
        affectedPageIds: [],
        affectedDatabaseIds: [],
        affectedViewIds: [],
        committedRevisions: {},
        changeLogSeq: 4,
        committedAt: "2026-07-31T00:00:00.000Z",
      },
    })).toMatchObject({
      ok: true,
      value: {
        canvasMutation: {
          canvasId: primaryCanvasId,
          documentId: primaryDocumentId,
        },
      },
    });
  });
});
