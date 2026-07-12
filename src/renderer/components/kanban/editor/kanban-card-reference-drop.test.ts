import { describe, expect, test, vi } from "vitest";
import type { dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import {
  setupKanbanCardReferenceDrop,
  type CardReferenceDropEditor,
} from "./card-reference-drop";
import type { KanbanCardDragData } from "../pragmatic-drag-data";

type ElementDropTargetArgs = Parameters<typeof dropTargetForElements>[0];

const dropTargetHarness = vi.hoisted(() => ({
  registration: null as unknown,
}));

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

describe("Kanban Card reference drop", () => {
  test("uses the editor block cursor contract for the reference insertion slot", () => {
    const container = document.createElement("div");
    const block = document.createElement("div");
    block.className = "bn-block";
    block.dataset.id = "block-1";
    container.append(block);
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
      left: 10,
      top: 20,
      right: 410,
      bottom: 320,
      width: 400,
      height: 300,
      x: 10,
      y: 20,
      toJSON: () => ({}),
    });
    vi.spyOn(block, "getBoundingClientRect").mockReturnValue({
      left: 50,
      top: 80,
      right: 290,
      bottom: 120,
      width: 240,
      height: 40,
      x: 50,
      y: 80,
      toJSON: () => ({}),
    });
    const editor: CardReferenceDropEditor = {
      document: [{ id: "block-1" }],
      insertBlocks: () => undefined,
      replaceBlocks: () => undefined,
    };
    const cleanup = setupKanbanCardReferenceDrop(container, editor, {
      projectId: "project-a",
      hostCardId: "card-host",
      ancestorCardIds: [],
      allocateBlockId: () => "reference-1",
    });
    const registration = dropTargetHarness.registration as ElementDropTargetArgs;
    const event = {
      source: { data: dragData },
      location: {
        current: {
          input: { clientX: 60, clientY: 90 },
          dropTargets: [],
        },
      },
    } as unknown as Parameters<
      NonNullable<ElementDropTargetArgs["onDragEnter"]>
    >[0];

    registration.onDragEnter?.(event);

    const indicator = container.querySelector<HTMLElement>(
      "[data-card-reference-drop-indicator]",
    );
    expect(indicator).not.toBeNull();
    expect(indicator?.classList.contains("prosemirror-dropcursor-block")).toBe(
      true,
    );
    expect(indicator?.style.left).toBe("40px");
    expect(indicator?.style.width).toBe("240px");
    cleanup();
  });

  test("inserts a stable reference through the element adapter without moving the Card", () => {
    const container = document.createElement("div");
    const replacements: unknown[][] = [];
    const editor: CardReferenceDropEditor = {
      document: [],
      insertBlocks: () => undefined,
      replaceBlocks: (_removed, next) => replacements.push([...next]),
    };
    const cleanup = setupKanbanCardReferenceDrop(container, editor, {
      projectId: "project-a",
      hostCardId: "card-host",
      ancestorCardIds: [],
      allocateBlockId: () => "reference-1",
    });
    const registration = dropTargetHarness.registration as ElementDropTargetArgs;
    const event = {
      source: { data: dragData },
      location: {
        current: {
          input: { clientX: 0, clientY: 0 },
          dropTargets: [],
        },
      },
    } as unknown as Parameters<NonNullable<ElementDropTargetArgs["onDrop"]>>[0];

    expect(registration.canDrop?.({
      source: { data: dragData },
      input: event.location.current.input,
      element: container,
    } as never)).toBe(true);
    registration.onDrop?.(event);

    expect(replacements).toEqual([
      [
        {
          id: "reference-1",
          type: "cardRef",
          props: { targetBlockId: "card-target", displayHint: "Target" },
        },
      ],
    ]);
    cleanup();
  });
});
