import { describe, expect, test } from "bun:test";
import {
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

    expect(rows.length).toBe(4);
    expect(rows[0]?.label).toBe("Send to chat");
    expect(rows[1]?.mode).toBe("card");
    expect(rows[1]?.label).toBe("Move to card");
    expect(rows[2]?.mode).toBe("project");
    expect(rows[2]?.label).toBe("Turn into cards");
    expect(rows[3]?.label).toBe("Make thread section");
  });
});
