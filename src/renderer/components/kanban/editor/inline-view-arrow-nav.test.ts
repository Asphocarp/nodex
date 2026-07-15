import { describe, expect, test } from "vitest";
import {
  deferCollapsedToggleVerticalArrowToBrowser,
  shouldDeferArrowToBrowserFromCollapsedToggle,
} from "./inline-view-arrow-nav";

function makeCollapsedToggleArrowDom({
  collapsed,
  selectionInHeader,
  withSelection = true,
  firstChildNonCommon = false,
  lastChildNonCommon = false,
}: {
  collapsed: boolean;
  selectionInHeader: boolean;
  withSelection?: boolean;
  firstChildNonCommon?: boolean;
  lastChildNonCommon?: boolean;
}) {
  const selectionAnchor = { id: "selection-anchor" };
  const insideHeaderTarget = { id: "inside-header" };
  const outsideTarget = { id: "outside-target" };
  const commonBlockContent = {
    querySelector: (selector: string) => (selector === ".bn-inline-content" ? { id: "inline" } : null),
  } as unknown as HTMLElement;
  const nonCommonBlockContent = {
    querySelector: () => null,
  } as unknown as HTMLElement;

  const childGroup = {
    contains: (candidate: unknown) => !selectionInHeader && candidate === selectionAnchor,
    querySelector: (selector: string) => {
      if (selector === ":scope > .bn-block-outer:first-child > .bn-block .bn-block-content") {
        return firstChildNonCommon ? nonCommonBlockContent : commonBlockContent;
      }
      if (selector === ":scope > .bn-block-outer:last-child > .bn-block .bn-block-content") {
        return lastChildNonCommon ? nonCommonBlockContent : commonBlockContent;
      }
      return null;
    },
  };

  const toggleWrapper = {
    getAttribute: (name: string) =>
      name === "data-show-children"
        ? (collapsed ? "false" : "true")
        : null,
  };

  const currentBlock = {
    contains: (candidate: unknown) =>
      candidate === selectionAnchor || candidate === insideHeaderTarget,
    querySelector: (selector: string) => {
      if (selector === ".bn-toggle-wrapper") return toggleWrapper;
      if (selector === ":scope > .bn-block-group" || selector === ".bn-block-group") return childGroup;
      return null;
    },
  };

  const paragraphBlock = {
    contains: () => false,
    querySelector: () => null,
  };

  const editorDom = {
    ownerDocument: {
      getSelection: () => (withSelection ? { anchorNode: selectionAnchor } : null),
    },
    querySelector: (selector: string) => {
      if (selector === '.bn-block[data-id="toggle-1"]') return currentBlock;
      if (selector === '.bn-block[data-id="para-1"]') return paragraphBlock;
      if (selector === '.bn-block[data-id="para-2"]') return paragraphBlock;
      return null;
    },
  } as unknown as ParentNode;

  return { editorDom, insideHeaderTarget, outsideTarget };
}

function makeArrowEditor({
  blockId,
  prevBlock,
  nextBlock,
  parentOffset,
  parentSize,
}: {
  blockId: string;
  prevBlock?: { id: string; type: string };
  nextBlock?: { id: string; type: string };
  parentOffset: number;
  parentSize: number;
}) {
  return {
    getTextCursorPosition: () => ({
      block: { id: blockId, type: "paragraph" },
      prevBlock,
      nextBlock,
    }),
    transact: <T,>(fn: (tr: {
      selection: {
        anchor: number;
        head: number;
        $anchor: {
          parentOffset: number;
          parent: {
            content: {
              size: number;
            };
          };
        };
      };
    }) => T) =>
      fn({
        selection: {
          anchor: 1,
          head: 1,
          $anchor: { parentOffset, parent: { content: { size: parentSize } } },
        },
      }),
  };
}

describe("inline view arrow navigation", () => {
  test("collapsed-toggle ArrowDown defers for collapsed header selection", () => {
    const { editorDom, outsideTarget } = makeCollapsedToggleArrowDom({
      collapsed: true,
      selectionInHeader: true,
    });

    const shouldDefer = shouldDeferArrowToBrowserFromCollapsedToggle(
      makeArrowEditor({
        blockId: "toggle-1",
        parentOffset: 1,
        parentSize: 4,
      }),
      editorDom,
      "next",
      outsideTarget as unknown as EventTarget,
    );

    expect(shouldDefer).toBe(true);
  });

  test("collapsed-toggle ArrowUp defers for collapsed header selection", () => {
    const { editorDom, outsideTarget } = makeCollapsedToggleArrowDom({
      collapsed: true,
      selectionInHeader: true,
    });

    const shouldDefer = shouldDeferArrowToBrowserFromCollapsedToggle(
      makeArrowEditor({
        blockId: "toggle-1",
        parentOffset: 1,
        parentSize: 4,
      }),
      editorDom,
      "prev",
      outsideTarget as unknown as EventTarget,
    );

    expect(shouldDefer).toBe(true);
  });

  test("collapsed-toggle ArrowDown does not defer when expanded", () => {
    const { editorDom, insideHeaderTarget } = makeCollapsedToggleArrowDom({
      collapsed: false,
      selectionInHeader: true,
    });

    const shouldDefer = shouldDeferArrowToBrowserFromCollapsedToggle(
      makeArrowEditor({
        blockId: "toggle-1",
        parentOffset: 1,
        parentSize: 4,
      }),
      editorDom,
      "next",
      insideHeaderTarget as unknown as EventTarget,
    );

    expect(shouldDefer).toBe(false);
  });

  test("collapsed-toggle ArrowDown does not defer when selection is inside child group", () => {
    const { editorDom, insideHeaderTarget } = makeCollapsedToggleArrowDom({
      collapsed: true,
      selectionInHeader: false,
    });

    const shouldDefer = shouldDeferArrowToBrowserFromCollapsedToggle(
      makeArrowEditor({
        blockId: "toggle-1",
        parentOffset: 1,
        parentSize: 4,
      }),
      editorDom,
      "next",
      insideHeaderTarget as unknown as EventTarget,
    );

    expect(shouldDefer).toBe(false);
  });

  test("collapsed-toggle ArrowDown falls back to key target when selection is unavailable", () => {
    const { editorDom, insideHeaderTarget } = makeCollapsedToggleArrowDom({
      collapsed: true,
      selectionInHeader: true,
      withSelection: false,
    });

    const shouldDefer = shouldDeferArrowToBrowserFromCollapsedToggle(
      makeArrowEditor({
        blockId: "toggle-1",
        parentOffset: 1,
        parentSize: 4,
      }),
      editorDom,
      "next",
      insideHeaderTarget as unknown as EventTarget,
    );

    expect(shouldDefer).toBe(true);
  });

  test("collapsed-toggle ArrowDown does not defer for key target outside header when no selection", () => {
    const { editorDom, outsideTarget } = makeCollapsedToggleArrowDom({
      collapsed: true,
      selectionInHeader: true,
      withSelection: false,
    });

    const shouldDefer = shouldDeferArrowToBrowserFromCollapsedToggle(
      makeArrowEditor({
        blockId: "toggle-1",
        parentOffset: 1,
        parentSize: 4,
      }),
      editorDom,
      "next",
      outsideTarget as unknown as EventTarget,
    );

    expect(shouldDefer).toBe(false);
  });

  test("collapsed-toggle ArrowDown defers when next collapsed toggle hides a first non-common child", () => {
    const { editorDom, outsideTarget } = makeCollapsedToggleArrowDom({
      collapsed: true,
      selectionInHeader: true,
      firstChildNonCommon: true,
    });

    const shouldDefer = shouldDeferArrowToBrowserFromCollapsedToggle(
      makeArrowEditor({
        blockId: "para-1",
        nextBlock: { id: "toggle-1", type: "toggleListItem" },
        parentOffset: 4,
        parentSize: 4,
      }),
      editorDom,
      "next",
      outsideTarget as unknown as EventTarget,
    );

    expect(shouldDefer).toBe(true);
  });

  test("collapsed-toggle ArrowUp defers when previous collapsed toggle hides a last non-common child", () => {
    const { editorDom, outsideTarget } = makeCollapsedToggleArrowDom({
      collapsed: true,
      selectionInHeader: true,
      lastChildNonCommon: true,
    });

    const shouldDefer = shouldDeferArrowToBrowserFromCollapsedToggle(
      makeArrowEditor({
        blockId: "para-2",
        prevBlock: { id: "toggle-1", type: "toggleListItem" },
        parentOffset: 0,
        parentSize: 4,
      }),
      editorDom,
      "prev",
      outsideTarget as unknown as EventTarget,
    );

    expect(shouldDefer).toBe(true);
  });

  test("collapsed-toggle boundary arrows do not defer for common inline edge children", () => {
    const { editorDom, outsideTarget } = makeCollapsedToggleArrowDom({
      collapsed: true,
      selectionInHeader: true,
    });

    const shouldDefer = shouldDeferArrowToBrowserFromCollapsedToggle(
      makeArrowEditor({
        blockId: "para-2",
        prevBlock: { id: "toggle-1", type: "toggleListItem" },
        parentOffset: 0,
        parentSize: 4,
      }),
      editorDom,
      "prev",
      outsideTarget as unknown as EventTarget,
    );

    expect(shouldDefer).toBe(false);
  });

  test("deferCollapsedToggleVerticalArrowToBrowser stops immediate propagation for hidden edge non-common arrows", () => {
    const { editorDom, outsideTarget } = makeCollapsedToggleArrowDom({
      collapsed: true,
      selectionInHeader: true,
      lastChildNonCommon: true,
    });
    let stopped = false;

    const deferred = deferCollapsedToggleVerticalArrowToBrowser(
      makeArrowEditor({
        blockId: "para-2",
        prevBlock: { id: "toggle-1", type: "toggleListItem" },
        parentOffset: 0,
        parentSize: 4,
      }),
      editorDom,
      "prev",
      {
        target: outsideTarget as unknown as EventTarget,
        stopImmediatePropagation: () => {
          stopped = true;
        },
      },
    );

    expect(deferred).toBe(true);
    expect(stopped).toBe(true);
  });
});
