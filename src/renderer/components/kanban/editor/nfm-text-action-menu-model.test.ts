import { describe, expect, test } from "bun:test";
import {
  isBlockLevelSelection,
  resolveNodexTextActionRows,
  shouldUseTextActionMenu,
} from "./nfm-text-action-menu-model";

describe("nfm text action menu model", () => {
  test("uses the Notion-style menu only for editable expanded rich-text selections", () => {
    expect(shouldUseTextActionMenu({
      isEditable: true,
      isTableCellSelection: false,
      hasInlineContent: true,
      selectionFrom: 3,
      selectionTo: 8,
    })).toBeTrue();

    expect(shouldUseTextActionMenu({
      isEditable: true,
      isTableCellSelection: false,
      hasInlineContent: true,
      selectionFrom: 3,
      selectionTo: 3,
    })).toBeFalse();

    expect(shouldUseTextActionMenu({
      isEditable: true,
      isTableCellSelection: true,
      hasInlineContent: true,
      selectionFrom: 3,
      selectionTo: 8,
    })).toBeFalse();

    expect(shouldUseTextActionMenu({
      isEditable: true,
      isTableCellSelection: false,
      isBlockSelection: true,
      hasInlineContent: true,
      selectionFrom: 3,
      selectionTo: 8,
    })).toBeFalse();
  });

  test("recognizes ProseMirror block-level selections", () => {
    expect(isBlockLevelSelection({ node: { attrs: { id: "single" } } })).toBeTrue();
    expect(isBlockLevelSelection({ nodes: [{ attrs: { id: "a" } }] })).toBeTrue();
    expect(isBlockLevelSelection({ from: 1, to: 2 })).toBeFalse();
  });

  test("omits Nodex rows when no current block can anchor the action", () => {
    const rows = resolveNodexTextActionRows({
      currentBlockId: null,
      currentBlockType: "paragraph",
      canSendBlocks: true,
      hasSendThreadSection: true,
      hasConvertDividerToThreadSection: true,
    });

    expect(rows.length).toBe(0);
  });

  test("projects active Nodex rows in the AI skills section order", () => {
    const rows = resolveNodexTextActionRows({
      currentBlockId: "block-1",
      currentBlockType: "divider",
      canSendBlocks: true,
      hasSendThreadSection: true,
      hasConvertDividerToThreadSection: true,
    });

    expect(rows.length).toBe(3);
    expect(rows[0]?.label).toBe("Send to chat");
    expect(rows[1]?.label).toBe("Move to");
    expect(rows[2]?.label).toBe("Make thread section");
  });
});
