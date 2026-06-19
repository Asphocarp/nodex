import { describe, expect, test } from "bun:test";
import {
  applySideMenuSelectionIntent,
  createSideMenuSelectionIntent,
  expandSideMenuSelectionBlocksWithChildren,
  type SideMenuSelectionBlock,
} from "./nfm-side-menu-selection";

function block(id: string, children?: SideMenuSelectionBlock[]): SideMenuSelectionBlock {
  return { id, ...(children ? { children } : {}) };
}

describe("nfm side menu selection helpers", () => {
  test("keeps the active selection when it contains the clicked block", () => {
    const clickedBlock = block("b");
    const intent = createSideMenuSelectionIntent({
      getSelection: () => ({
        blocks: [block("a"), clickedBlock, block("c")],
      }),
    }, clickedBlock);

    expect(intent.source).toBe("active-selection");
    expect(intent.blocks.map((entry) => entry.id).join(",")).toBe("a,b,c");
  });

  test("expands selected blocks to include descendants in document order", () => {
    const clickedBlock = block("b", [
      block("b1"),
      block("b2", [block("b2a")]),
    ]);
    const intent = createSideMenuSelectionIntent({
      getSelection: () => ({
        blocks: [block("a"), clickedBlock],
      }),
    }, clickedBlock);

    expect(intent.source).toBe("active-selection");
    expect(intent.blocks.map((entry) => entry.id).join(",")).toBe("a,b,b1,b2,b2a");
  });

  test("uses only the clicked block when the active selection is elsewhere", () => {
    const clickedBlock = block("b", [block("b1")]);
    const intent = createSideMenuSelectionIntent({
      getSelection: () => ({
        blocks: [block("x"), block("y")],
      }),
    }, clickedBlock);

    expect(intent.source).toBe("clicked-block");
    expect(intent.blocks.map((entry) => entry.id).join(",")).toBe("b,b1");
  });

  test("uses only the clicked block when there is no active block selection", () => {
    const clickedBlock = block("b");
    const intent = createSideMenuSelectionIntent({
      getSelection: () => undefined,
    }, clickedBlock);

    expect(intent.source).toBe("clicked-block");
    expect(intent.blocks.map((entry) => entry.id).join(",")).toBe("b");
  });

  test("deduplicates repeated descendants while expanding block children", () => {
    const sharedChild = block("shared");

    expect(expandSideMenuSelectionBlocksWithChildren([
      block("parent", [sharedChild]),
      sharedChild,
    ]).map((entry) => entry.id).join(",")).toBe("parent,shared");
  });

  test("applies block-level selection with the complete intent scope", () => {
    const calls: string[] = [];
    const applied = applySideMenuSelectionIntent({
      getSelection: () => undefined,
    }, {
      clickedBlock: block("b"),
      blocks: [block("a"), block("b"), block("c")],
      source: "active-selection",
    }, {
      selectBlocks: (_editor, blocks, fallbackBlock) => {
        calls.push(`${blocks.map((entry) => entry.id).join(":")}|${fallbackBlock.id}`);
        return true;
      },
    });

    expect(applied).toBeTrue();
    expect(calls.join(",")).toBe("a:b:c|b");
  });

  test("reports adapter failure without throwing", () => {
    const calls: string[] = [];
    const applied = applySideMenuSelectionIntent({
      getSelection: () => undefined,
    }, {
      clickedBlock: block("b"),
      blocks: [block("a"), block("b")],
      source: "active-selection",
    }, {
      selectBlocks: () => {
        calls.push("failed");
        return false;
      },
    });

    expect(applied).toBeFalse();
    expect(calls.join(",")).toBe("failed");
  });
});
