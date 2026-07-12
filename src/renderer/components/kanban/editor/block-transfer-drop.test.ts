import { describe, expect, test, vi } from "vitest";
import type { dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import {
  resolveBlockTransferDocumentTarget,
  setupKanbanCardTransferDrop,
  type BlockTransferDropEditor,
} from "./block-transfer-drop";
import type { KanbanCardDragData } from "../pragmatic-drag-data";
import type { PublicBlockTransferIntent } from "../../../../shared/block-transfer-transport";

type ElementDropTargetArgs = Parameters<typeof dropTargetForElements>[0];

const dropTargetHarness = vi.hoisted(() => ({ registration: null as unknown }));

vi.mock("@atlaskit/pragmatic-drag-and-drop/element/adapter", () => ({
  dropTargetForElements: (args: unknown) => {
    dropTargetHarness.registration = args;
    return () => undefined;
  },
}));

const dragData = {
  type: "kanban-card",
  instanceId: Symbol("kanban"),
  projectId: "project-a",
  databaseBlockId: "database-a",
  storeEpoch: "epoch-a",
  sourceCardId: "card-target",
  sourceColumnId: "draft",
  sourceCard: { id: "card-target", title: "Target" },
  dragItems: [
    {
      card: { id: "card-target", title: "Target" },
      columnId: "draft",
      columnName: "Draft",
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
      const transfer = vi.fn(async (_intent: PublicBlockTransferIntent) => ({
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
          finalLocations: {
            "card-target": { kind: "document" as const, documentId: "document-host" },
          },
          finalLocationRevisions: { "card-target": 2 },
          documentCommits: [],
          affectedDatabaseBlockIds: ["database-a"],
          changeLogSeq: 1,
          committedAt: "2026-07-13T00:00:00.000Z",
        },
      }));
      const cleanup = setupKanbanCardTransferDrop(
        container,
        { document: [] },
        {
          projectId: "project-a",
          documentId: "document-host",
          storeEpoch: "epoch-a",
          hostCardId: "card-host",
          ancestorCardIds: [],
          createOperationId: () => "operation-a",
          transfer,
          reportError: vi.fn(),
        },
      );
      const registration = dropTargetHarness.registration as ElementDropTargetArgs;
      const event = {
        source: { data: dragData },
        location: { current: { input: input(altKey), dropTargets: [] } },
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
        source: { kind: "database", databaseBlockId: "database-a" },
        target: { kind: "document", documentId: "document-host" },
      });
      cleanup();
    },
  );
});
