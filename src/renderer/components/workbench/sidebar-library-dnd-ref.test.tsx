import { renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  setDraggableNodeRef: vi.fn<(node: HTMLElement | null) => void>(),
  setDroppableNodeRef: vi.fn<(node: HTMLElement | null) => void>(),
}));

vi.mock("@dnd-kit/core", () => ({
  useDraggable: () => ({
    attributes: {},
    listeners: undefined,
    isDragging: false,
    setNodeRef: mocks.setDraggableNodeRef,
  }),
  useDroppable: () => ({
    isOver: false,
    setNodeRef: mocks.setDroppableNodeRef,
  }),
}));

import { useSidebarLibraryResourceDnd } from "./sidebar-library-dnd";

describe("useSidebarLibraryResourceDnd", () => {
  test("keeps its composed node ref stable and forwards nodes to both DnD owners", () => {
    const input = {
      resource: {
        target: { kind: "page", pageId: "page-1" },
        title: "Research",
        expectedLocationRevision: 3,
        dragOverlay: null,
      },
      disabledKey: "page-1",
      ownerParent: { kind: "library" },
    } as const;
    const hook = renderHook(() => useSidebarLibraryResourceDnd(input));
    const setNodeRef = hook.result.current.setNodeRef;
    const node = document.createElement("button");

    setNodeRef(node);
    hook.rerender();

    expect(mocks.setDraggableNodeRef).toHaveBeenCalledWith(node);
    expect(mocks.setDroppableNodeRef).toHaveBeenCalledWith(node);
    expect(hook.result.current.setNodeRef).toBe(setNodeRef);
  });
});
