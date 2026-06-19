import { describe, expect, test } from "bun:test";
import {
  buildNfmSideMenuSections,
  filterNfmSideMenuSections,
  flattenNfmSideMenuRows,
  getInitialNfmSideMenuFocusIndex,
  getNfmSideMenuSeparatorBeforeKeys,
  moveNfmSideMenuFocus,
} from "./nfm-side-menu-model";

function buildDefaultSections() {
  return buildNfmSideMenuSections({
    currentBlockId: "block-1",
    currentBlockType: "paragraph",
    isEditable: true,
    canUseColor: true,
    canSendBlocks: true,
    hasConvertDividerToThreadSection: false,
    isTableBlock: false,
    canUseTableHeaders: false,
  });
}

describe("nfm side menu model", () => {
  test("keeps the reference action order and puts move semantics on the reference Move to row", () => {
    const sections = buildDefaultSections();
    const rows = flattenNfmSideMenuRows(sections);

    expect(rows.length).toBe(10);
    expect(rows[0]?.row.label).toBe("Turn into");
    expect(rows[1]?.row.label).toBe("Color");
    expect(rows[2]?.row.label).toBe("Copy link to block");
    expect(rows[3]?.row.label).toBe("Duplicate");
    expect(rows[4]?.row.label).toBe("Move to");
    expect(rows[5]?.row.label).toBe("Delete");
    expect(rows[6]?.row.label).toBe("Comment");
    expect(rows[7]?.row.label).toBe("Suggest edits");
    expect(rows[8]?.row.label).toBe("Present from here");
    expect(rows[9]?.row.label).toBe("Ask AI");
    expect(rows[4]?.sectionKey).toBe("text");
    expect(rows[4]?.row.kind).toBe("submenu");
    expect(rows[4]?.row.submenu).toBe("move-to");
  });

  test("copies the reference action grouping boundaries", () => {
    const rows = flattenNfmSideMenuRows(buildDefaultSections());
    const separatorKeys = getNfmSideMenuSeparatorBeforeKeys(rows);

    expect(separatorKeys.join(",")).toBe("copy-link-to-block,comment,present-from-here,ask-ai");
  });

  test("marks unsupported reference rows as inactive mocks while enabling Move to when moves are available", () => {
    const rows = flattenNfmSideMenuRows(buildDefaultSections());
    const copyLink = rows[2]?.row;
    const duplicate = rows[3]?.row;
    const moveTo = rows[4]?.row;

    expect(copyLink?.enabled).toBeFalse();
    expect(copyLink?.inactiveMock).toBeTrue();
    expect(duplicate?.enabled).toBeTrue();
    expect(moveTo?.enabled).toBeTrue();
    expect(moveTo?.inactiveMock).toBeFalse();
  });

  test("keeps Move to visible as an inactive mock when block moves are unavailable", () => {
    const sections = buildNfmSideMenuSections({
      currentBlockId: "block-1",
      currentBlockType: "paragraph",
      isEditable: true,
      canUseColor: true,
      canSendBlocks: false,
      hasConvertDividerToThreadSection: false,
      isTableBlock: false,
      canUseTableHeaders: false,
    });
    const rows = flattenNfmSideMenuRows(sections);
    const moveTo = rows[4]?.row;

    expect(moveTo?.key).toBe("move-to");
    expect(moveTo?.enabled).toBeFalse();
    expect(moveTo?.inactiveMock).toBeTrue();
  });

  test("adds divider and table specific Nodex sections only when relevant", () => {
    const sections = buildNfmSideMenuSections({
      currentBlockId: "divider-1",
      currentBlockType: "divider",
      isEditable: true,
      canUseColor: false,
      canSendBlocks: false,
      hasConvertDividerToThreadSection: true,
      isTableBlock: true,
      canUseTableHeaders: true,
    });
    const rows = flattenNfmSideMenuRows(sections);

    expect(rows.length).toBe(13);
    expect(rows[10]?.row.key).toBe("convert-divider-to-thread-section");
    expect(rows[11]?.row.key).toBe("table-header-row");
    expect(rows[12]?.row.key).toBe("table-header-column");
  });

  test("filters by label, shortcut, and keywords", () => {
    const sections = buildDefaultSections();
    const duplicateRows = flattenNfmSideMenuRows(filterNfmSideMenuSections(sections, "⌘D"));
    const aiRows = flattenNfmSideMenuRows(filterNfmSideMenuSections(sections, "assistant"));
    const noneRows = flattenNfmSideMenuRows(filterNfmSideMenuSections(sections, "zzzz"));

    expect(duplicateRows.length).toBe(1);
    expect(duplicateRows[0]?.row.key).toBe("duplicate");
    expect(aiRows.length).toBe(1);
    expect(aiRows[0]?.row.key).toBe("ask-ai");
    expect(noneRows.length).toBe(0);
  });

  test("uses reference focus behavior for search and arrow navigation", () => {
    const rows = flattenNfmSideMenuRows(buildDefaultSections());

    expect(getInitialNfmSideMenuFocusIndex("", rows)).toBe(-1);
    expect(getInitialNfmSideMenuFocusIndex("turn", rows)).toBe(0);
    expect(moveNfmSideMenuFocus(-1, 1, rows)).toBe(0);
    expect(moveNfmSideMenuFocus(0, -1, rows)).toBe(rows.length - 1);
    expect(moveNfmSideMenuFocus(rows.length - 1, 1, rows)).toBe(0);
  });
});
