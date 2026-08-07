import { describe, expect, test, vi } from "vitest";
import type { dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import {
  resolveBlockTransferDocumentTarget,
  setupBlockTransferDocumentDrop,
  type BlockTransferDropEditor,
} from "./block-transfer-drop";
import type { PublicBlockTransferIntent } from "../../../../shared/block-transfer-transport";
import type { KanbanCardDragData } from "../pragmatic-drag-data";
import {
  beginLocalBlockDragSession,
  endLocalBlockDragSession,
} from "../cross-surface-drag";

type ElementDropTargetArgs = Parameters<typeof dropTargetForElements>[0];

const dropTargetHarness = vi.hoisted(() => ({
  registration: null as unknown,
  registrations: [] as unknown[],
}));

vi.mock("@atlaskit/pragmatic-drag-and-drop/element/adapter", () => ({
  dropTargetForElements: (args: unknown) => {
    dropTargetHarness.registration = args;
    dropTargetHarness.registrations.push(args);
    return () => undefined;
  },
}));

const dragData = {
  type: "kanban-card",
  instanceId: Symbol("kanban"),
  projectId: "project-a",
  databaseBlockId: "database-a",
  dataSourceId: "source-a",
  storeEpoch: "epoch-a",
  sourcePageId: "card-target",
  sourceColumnId: "triage",
  sourcePage: { id: "card-target", title: "Target" },
  dragItems: [
    {
      card: { id: "card-target", title: "Target" },
      columnId: "triage",
      columnName: "Triage",
    },
  ],
} as unknown as KanbanCardDragData;

const input = (altKey: boolean) => ({
  clientX: 0,
  clientY: 0,
  altKey,
  button: 0,
  buttons: 1,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
});

describe("Kanban Card Block transfer drop", () => {
  test("resolves before/after against the target Block hierarchy", () => {
    const editor: BlockTransferDropEditor = {
      document: [
        {
          id: "parent",
          children: [{ id: "first" }, { id: "second" }],
        },
        { id: "tail" },
      ],
    };
    expect(
      resolveBlockTransferDocumentTarget(editor, {
        blockId: "first",
        placement: "after",
      }),
    ).toEqual({ parentBlockId: "parent", beforeBlockId: "second" });
    expect(
      resolveBlockTransferDocumentTarget(editor, {
        blockId: "second",
        placement: "after",
      }),
    ).toEqual({ parentBlockId: "parent" });
  });

  test.each([
    [false, "move"],
    [true, "copy"],
  ] as const)(
    "submits one authority intent at drop time (alt=%s)",
    async (altKey, mode) => {
      const container = document.createElement("div");
      const transfer = vi.fn(async (...args: [PublicBlockTransferIntent]) => {
        void args;
        return {
          ok: true as const,
          value: {
            version: 1 as const,
            operationId: "operation-a",
            projectId: "project-a",
            storeEpoch: "epoch-a",
            mode,
            duplicate: false,
            sourceRootBlockIds: ["card-target"],
            resultRootBlockIds: ["card-target"],
            copiedBlockIds: {},
            transformationEvidence: [],
            finalLocations: {
              "card-target": {
                kind: "document" as const,
                documentId: "document-host",
              },
            },
            finalLocationRevisions: { "card-target": 2 },
            documentCommits: [],
            affectedDatabaseBlockIds: ["database-a"],
            commitSeq: 1,
            committedAt: "2026-07-13T00:00:00.000Z",
          },
        };
      });
      const cleanup = setupBlockTransferDocumentDrop(
        container,
        { document: [] },
        {
          surfaceId: "surface-target",
          projectId: "project-a",
          documentId: "document-host",
          storeEpoch: "epoch-a",
          hostPageId: "card-host",
          ancestorPageIds: [],
          createOperationId: () => "operation-a",
          transfer,
          reportError: vi.fn(),
        },
      );
      const registration = dropTargetHarness.registration as ElementDropTargetArgs;
      const self = { element: container, data: {}, dropEffect: mode };
      const event = {
        source: { data: dragData },
        location: {
          current: { input: input(altKey), dropTargets: [self] },
        },
        self,
      } as unknown as Parameters<NonNullable<ElementDropTargetArgs["onDrop"]>>[0];

      expect(
        registration.canDrop?.({
          source: { data: dragData },
          input: event.location.current.input,
          element: container,
        } as never),
      ).toBe(true);
      registration.onDrop?.(event);
      await vi.waitFor(() => expect(transfer).toHaveBeenCalledOnce());
      expect(transfer.mock.calls[0]?.[0]).toMatchObject({
        mode,
        rootBlockIds: ["card-target"],
        source: { kind: "data_source", dataSourceId: "source-a" },
        target: { kind: "page", pageId: "card-host" },
      });
      cleanup();
    },
  );

  test("claims a managed editor drag before ProseMirror and submits one atomic transfer", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const transfer = vi.fn(async (...args: [PublicBlockTransferIntent]) => {
      void args;
      return {
        ok: true as const,
        value: {
          version: 1 as const,
          operationId: "operation-editor",
          projectId: "project-a",
          storeEpoch: "epoch-a",
          mode: "copy" as const,
          duplicate: false,
          sourceRootBlockIds: ["block-source"],
          resultRootBlockIds: ["block-copy"],
          copiedBlockIds: { "block-source": "block-copy" },
          transformationEvidence: [],
          finalLocations: {
            "block-copy": {
              kind: "document" as const,
              documentId: "document-target",
            },
          },
          finalLocationRevisions: { "block-copy": 1 },
          documentCommits: [],
          affectedDatabaseBlockIds: [],
          commitSeq: 2,
          committedAt: "2026-07-13T00:00:00.000Z",
        },
      };
    });
    const flushAndFence = vi.fn(async () => ({
      documentId: "document-target",
      storeEpoch: "epoch-a",
      generation: 1,
      expectedHeadSeq: 0,
    }));
    const flushSourceAndFence = vi.fn(async () => ({
      documentId: "document-source",
      storeEpoch: "epoch-a",
      generation: 1,
      expectedHeadSeq: 0,
    }));
    const cleanup = setupBlockTransferDocumentDrop(
      container,
      { document: [] },
      {
        surfaceId: "surface-target",
        projectId: "project-a",
        documentId: "document-target",
        storeEpoch: "epoch-a",
        ancestorPageIds: [],
        flushAndFence,
        flushSourceAndFence,
        createOperationId: () => "operation-editor",
        transfer,
        reportError: vi.fn(),
      },
    );
    const values = new Map<string, string>();
    const types: string[] = [];
    const dataTransfer = {
      types,
      effectAllowed: "uninitialized",
      dropEffect: "none",
      setData: (type: string, value: string) => {
        if (!types.includes(type)) types.push(type);
        values.set(type, value);
      },
      getData: (type: string) => values.get(type) ?? "",
    } as unknown as DataTransfer;
    beginLocalBlockDragSession(
      {
        sourceSurfaceId: "surface-source",
        projectId: "project-a",
        storeEpoch: "epoch-a",
        source: { kind: "document", documentId: "document-source" },
        rootBlockIds: ["block-source"],
        displayHints: ["paragraph"],
      },
      dataTransfer,
    );
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperties(drop, {
      dataTransfer: { value: dataTransfer },
      clientX: { value: 0 },
      clientY: { value: 0 },
      altKey: { value: true },
    });

    try {
      container.dispatchEvent(drop);
      await vi.waitFor(() => expect(transfer).toHaveBeenCalledOnce());
      expect(drop.defaultPrevented).toBe(true);
      expect(transfer.mock.calls[0]?.[0]).toMatchObject({
        mode: "copy",
        rootBlockIds: ["block-source"],
        source: { kind: "document", documentId: "document-source" },
        target: { kind: "document", documentId: "document-target" },
      });
      expect(flushAndFence).toHaveBeenCalledOnce();
      expect(flushSourceAndFence).toHaveBeenCalledWith("surface-source");
    } finally {
      cleanup();
      endLocalBlockDragSession();
      container.remove();
    }
  });

  test("routes a same-Page Canvas drag through the typed Canvas operation", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const transfer = vi.fn();
    const transferCanvas = vi.fn(async () => undefined);
    const cleanup = setupBlockTransferDocumentDrop(
      container,
      { document: [{ id: "canvas-1" }, { id: "paragraph-1" }] },
      {
        surfaceId: "surface-page",
        projectId: "project-a",
        documentId: "document-page",
        storeEpoch: "epoch-a",
        hostPageId: "page-1",
        ancestorPageIds: [],
        createOperationId: () => "operation-canvas",
        transfer,
        transferCanvas,
        reportError: vi.fn(),
      },
    );
    const values = new Map<string, string>();
    const types: string[] = [];
    const dataTransfer = {
      types,
      effectAllowed: "uninitialized",
      dropEffect: "none",
      setData: (type: string, value: string) => {
        if (!types.includes(type)) types.push(type);
        values.set(type, value);
      },
      getData: (type: string) => values.get(type) ?? "",
    } as unknown as DataTransfer;
    beginLocalBlockDragSession(
      {
        sourceSurfaceId: "surface-page",
        projectId: "project-a",
        storeEpoch: "epoch-a",
        source: { kind: "page", pageId: "page-1" },
        rootBlockIds: ["canvas-1"],
        displayHints: ["canvas"],
      },
      dataTransfer,
    );
    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperties(drop, {
      dataTransfer: { value: dataTransfer },
      clientX: { value: 0 },
      clientY: { value: 0 },
      altKey: { value: false },
    });

    try {
      container.dispatchEvent(drop);
      await vi.waitFor(() => expect(transferCanvas).toHaveBeenCalledOnce());
      expect(drop.defaultPrevented).toBe(true);
      expect(transfer).not.toHaveBeenCalled();
      expect(transferCanvas).toHaveBeenCalledWith({
        canvasBlockId: "canvas-1",
        sourceSurfaceId: "surface-page",
        sourcePageId: "page-1",
        targetPageId: "page-1",
        mode: "move",
        insertion: { kind: "append" },
      });
    } finally {
      cleanup();
      endLocalBlockDragSession();
      container.remove();
    }
  });

  test("routes a nested editor drop to the deepest semantic surface", async () => {
    const outer = document.createElement("div");
    const inner = document.createElement("div");
    const outerTarget = document.createElement("span");
    const target = document.createElement("span");
    outer.className = "nfm-editor";
    inner.className = "nfm-editor";
    inner.append(target);
    outer.append(outerTarget, inner);
    document.body.append(outer);
    const outerTransfer = vi.fn();
    const clearOuterDropCursor = vi.fn();
    const innerTransfer = vi.fn(async (...args: [PublicBlockTransferIntent]) => {
      void args;
      return {
        ok: false as const,
        error: {
          code: "unknown" as const,
          message: "expected test terminal result",
          retryable: false,
          reloadRequired: false,
        },
      };
    });
    const outerCleanup = setupBlockTransferDocumentDrop(
      outer,
      {
        document: [],
        getExtension: () => ({ clearDropCursor: clearOuterDropCursor }),
      },
      {
        surfaceId: "surface-outer",
        projectId: "project-a",
        documentId: "document-outer",
        storeEpoch: "epoch-a",
        ancestorPageIds: [],
        createOperationId: () => "operation-outer",
        transfer: outerTransfer,
        reportError: vi.fn(),
      },
    );
    const innerCleanup = setupBlockTransferDocumentDrop(
      inner,
      { document: [] },
      {
        surfaceId: "surface-inner",
        projectId: "project-a",
        documentId: "document-inner",
        storeEpoch: "epoch-a",
        ancestorPageIds: [],
        createOperationId: () => "operation-inner",
        transfer: innerTransfer,
        reportError: vi.fn(),
      },
    );
    const values = new Map<string, string>();
    const types: string[] = [];
    const dataTransfer = {
      types,
      effectAllowed: "uninitialized",
      dropEffect: "none",
      setData: (type: string, value: string) => {
        if (!types.includes(type)) types.push(type);
        values.set(type, value);
      },
      getData: (type: string) => values.get(type) ?? "",
    } as unknown as DataTransfer;
    beginLocalBlockDragSession(
      {
        sourceSurfaceId: "surface-source",
        projectId: "project-a",
        storeEpoch: "epoch-a",
        source: { kind: "document", documentId: "document-source" },
        rootBlockIds: ["block-source"],
        displayHints: ["paragraph"],
      },
      dataTransfer,
    );
    const dispatchDrag = (type: "dragover" | "drop", element: Element) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, {
        dataTransfer: { value: dataTransfer },
        clientX: { value: 0 },
        clientY: { value: 0 },
        altKey: { value: false },
      });
      element.dispatchEvent(event);
      return event;
    };

    try {
      dispatchDrag("dragover", outerTarget);
      expect(outer.hasAttribute("data-block-transfer-drop-hover")).toBe(true);
      expect(
        document.querySelectorAll("[data-block-transfer-drop-indicator]"),
      ).toHaveLength(1);

      dispatchDrag("dragover", target);
      expect(outer.hasAttribute("data-block-transfer-drop-hover")).toBe(false);
      expect(inner.hasAttribute("data-block-transfer-drop-hover")).toBe(true);
      expect(clearOuterDropCursor).toHaveBeenCalled();
      expect(
        document.querySelectorAll("[data-block-transfer-drop-indicator]"),
      ).toHaveLength(1);

      const drop = dispatchDrag("drop", target);
      await vi.waitFor(() => expect(innerTransfer).toHaveBeenCalledOnce());
      expect(drop.defaultPrevented).toBe(true);
      expect(outerTransfer).not.toHaveBeenCalled();
      expect(innerTransfer.mock.calls[0]?.[0]).toMatchObject({
        target: { kind: "document", documentId: "document-inner" },
      });
    } finally {
      innerCleanup();
      outerCleanup();
      endLocalBlockDragSession();
      outer.remove();
    }
  });

  test("lets only the innermost Pragmatic drop target render and commit", async () => {
    const outer = document.createElement("div");
    const inner = document.createElement("div");
    outer.append(inner);
    document.body.append(outer);
    const outerTransfer = vi.fn(async () => ({
      ok: false as const,
      error: {
        code: "unknown" as const,
        message: "outer must not commit",
        retryable: false,
        reloadRequired: false,
      },
    }));
    const innerTransfer = vi.fn(async () => ({
      ok: false as const,
      error: {
        code: "unknown" as const,
        message: "expected test terminal result",
        retryable: false,
        reloadRequired: false,
      },
    }));
    const registrationStart = dropTargetHarness.registrations.length;
    const outerCleanup = setupBlockTransferDocumentDrop(
      outer,
      { document: [] },
      {
        surfaceId: "surface-outer-pragmatic",
        projectId: "project-a",
        documentId: "document-outer",
        storeEpoch: "epoch-a",
        ancestorPageIds: [],
        createOperationId: () => "operation-outer-pragmatic",
        transfer: outerTransfer,
        reportError: vi.fn(),
      },
    );
    const innerCleanup = setupBlockTransferDocumentDrop(
      inner,
      { document: [] },
      {
        surfaceId: "surface-inner-pragmatic",
        projectId: "project-a",
        documentId: "document-inner",
        storeEpoch: "epoch-a",
        ancestorPageIds: [],
        createOperationId: () => "operation-inner-pragmatic",
        transfer: innerTransfer,
        reportError: vi.fn(),
      },
    );
    const [outerRegistration, innerRegistration] =
      dropTargetHarness.registrations.slice(registrationStart) as [
        ElementDropTargetArgs,
        ElementDropTargetArgs,
      ];
    const outerRecord = { element: outer, data: {}, dropEffect: "move" };
    const innerRecord = { element: inner, data: {}, dropEffect: "move" };
    const location = {
      initial: { input: input(false), dropTargets: [] },
      previous: { dropTargets: [] },
      current: {
        input: input(false),
        dropTargets: [innerRecord, outerRecord],
      },
    };
    const eventFor = (self: typeof innerRecord) =>
      ({ source: { data: dragData }, location, self }) as never;

    try {
      innerRegistration.onDrag?.(eventFor(innerRecord));
      outerRegistration.onDrag?.(eventFor(outerRecord));
      expect(outer.hasAttribute("data-block-transfer-drop-hover")).toBe(false);
      expect(inner.hasAttribute("data-block-transfer-drop-hover")).toBe(true);
      expect(
        document.querySelectorAll("[data-block-transfer-drop-indicator]"),
      ).toHaveLength(1);

      innerRegistration.onDrop?.(eventFor(innerRecord));
      outerRegistration.onDrop?.(eventFor(outerRecord));
      await vi.waitFor(() => expect(innerTransfer).toHaveBeenCalledOnce());
      expect(outerTransfer).not.toHaveBeenCalled();
    } finally {
      innerCleanup();
      outerCleanup();
      outer.remove();
    }
  });
});
