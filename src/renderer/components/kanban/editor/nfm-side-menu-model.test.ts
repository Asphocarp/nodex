import { describe, expect, test } from "bun:test";
import {
  buildNfmSideMenuSections,
  filterNfmSideMenuSections,
  flattenNfmSideMenuRows,
  getInitialNfmSideMenuFocusIndex,
  getNfmSideMenuSeparatorBeforeKeys,
  moveNfmSideMenuFocus,
  resolveNfmSideMenuScopeTitle,
} from "./nfm-side-menu-model";

function buildDefaultSections(showMockActions = false) {
  return buildNfmSideMenuSections({
    currentBlockId: "block-1",
    currentBlockType: "paragraph",
    selectionTitle: "Text",
    selectedTopLevelBlockCount: 1,
    isEditable: true,
    canUseColor: true,
    canSendBlocks: true,
    hasConvertDividerToThreadSection: false,
    isTableBlock: false,
    canUseTableHeaders: false,
    showMockActions,
  });
}

describe("nfm side menu model", () => {
  test("hides reference mock actions from the production action order", () => {
    const sections = buildDefaultSections();
    const rows = flattenNfmSideMenuRows(sections);

    expect(rows.map(({ row }) => row.label).join(",")).toBe("Turn into,Color,Duplicate,Move to,Delete");
    expect(rows.some(({ row }) => row.mockReason !== undefined)).toBeFalse();
    expect(rows[3]?.sectionKey).toBe("selection");
    expect(rows[3]?.row.kind).toBe("submenu");
    expect(rows[3]?.row.submenu).toBe("move-to");
  });

  test("copies the production action grouping boundaries without copy links", () => {
    const rows = flattenNfmSideMenuRows(buildDefaultSections());
    const separatorKeys = getNfmSideMenuSeparatorBeforeKeys(rows);

    expect(separatorKeys.join(",")).toBe("duplicate");
  });

  test("renames disabled copy-link reference mocks for multi-block selections", () => {
    const sections = buildNfmSideMenuSections({
      currentBlockId: "block-1",
      currentBlockType: "paragraph",
      selectionTitle: "3 blocks",
      selectedTopLevelBlockCount: 3,
      isEditable: true,
      canUseColor: true,
      canSendBlocks: true,
      hasConvertDividerToThreadSection: false,
      isTableBlock: false,
      canUseTableHeaders: false,
      showMockActions: true,
    });
    const copyLink = flattenNfmSideMenuRows(sections).find(({ row }) => row.key === "copy-link-to-block")?.row;

    expect(copyLink?.label).toBe("Copy links to all");
    expect(copyLink?.enabled).toBeFalse();
    expect(Boolean(copyLink?.mockReason)).toBeTrue();
  });

  test("keeps reference mock actions disabled and marked in dev contexts", () => {
    const rows = flattenNfmSideMenuRows(buildDefaultSections(true));
    const copyLink = rows.find(({ row }) => row.key === "copy-link-to-block")?.row;
    const present = rows.find(({ row }) => row.key === "present-from-here")?.row;
    const duplicate = rows.find(({ row }) => row.key === "duplicate")?.row;
    const moveTo = rows.find(({ row }) => row.key === "move-to")?.row;

    expect(copyLink?.enabled).toBeFalse();
    expect(Boolean(copyLink?.mockReason)).toBeTrue();
    expect(present?.badge).toBe("Beta");
    expect(Boolean(present?.mockReason)).toBeTrue();
    expect(duplicate?.enabled).toBeTrue();
    expect(duplicate?.mockReason === undefined).toBeTrue();
    expect(moveTo?.enabled).toBeTrue();
    expect(moveTo?.mockReason === undefined).toBeTrue();
  });

  test("keeps Move to visible as a real disabled row when block moves are unavailable", () => {
    const sections = buildNfmSideMenuSections({
      currentBlockId: "block-1",
      currentBlockType: "paragraph",
      selectionTitle: "Text",
      selectedTopLevelBlockCount: 1,
      isEditable: true,
      canUseColor: true,
      canSendBlocks: false,
      hasConvertDividerToThreadSection: false,
      isTableBlock: false,
      canUseTableHeaders: false,
      showMockActions: false,
    });
    const rows = flattenNfmSideMenuRows(sections);
    const moveTo = rows.find(({ row }) => row.key === "move-to")?.row;

    expect(moveTo?.key).toBe("move-to");
    expect(moveTo?.enabled).toBeFalse();
    expect(moveTo?.mockReason === undefined).toBeTrue();
  });

  test("adds divider and table specific Nodex sections only when relevant", () => {
    const sections = buildNfmSideMenuSections({
      currentBlockId: "divider-1",
      currentBlockType: "divider",
      selectionTitle: "Divider",
      selectedTopLevelBlockCount: 1,
      isEditable: true,
      canUseColor: false,
      canSendBlocks: false,
      hasConvertDividerToThreadSection: true,
      isTableBlock: true,
      canUseTableHeaders: true,
      showMockActions: false,
    });
    const rows = flattenNfmSideMenuRows(sections);

    expect(rows.length).toBe(8);
    expect(rows[5]?.row.key).toBe("convert-divider-to-thread-section");
    expect(rows[6]?.row.key).toBe("table-header-row");
    expect(rows[7]?.row.key).toBe("table-header-column");
  });

  test("hides Nodex and table special rows for multi-block selections", () => {
    const sections = buildNfmSideMenuSections({
      currentBlockId: "divider-1",
      currentBlockType: "divider",
      selectionTitle: "2 blocks",
      selectedTopLevelBlockCount: 2,
      isEditable: true,
      canUseColor: false,
      canSendBlocks: false,
      hasConvertDividerToThreadSection: true,
      isTableBlock: true,
      canUseTableHeaders: true,
      showMockActions: false,
    });
    const rows = flattenNfmSideMenuRows(sections);

    expect(rows.some(({ row }) => row.key === "convert-divider-to-thread-section")).toBeFalse();
    expect(rows.some(({ row }) => row.key === "table-header-row")).toBeFalse();
    expect(rows.some(({ row }) => row.key === "table-header-column")).toBeFalse();
  });

  test("resolves section titles from top-level selected block descriptors", () => {
    expect(resolveNfmSideMenuScopeTitle([])).toBe("Block");
    expect(resolveNfmSideMenuScopeTitle([{ id: "a", type: "paragraph" }])).toBe("Text");
    expect(resolveNfmSideMenuScopeTitle([{ id: "a", type: "codeBlock" }])).toBe("Code");
    expect(resolveNfmSideMenuScopeTitle([{ id: "a", type: "heading", props: { level: 2 } }])).toBe("Heading 2");
    expect(resolveNfmSideMenuScopeTitle([{ id: "a", type: "heading", props: { level: 3, isToggleable: true } }])).toBe("Toggle heading 3");
    expect(resolveNfmSideMenuScopeTitle([{ id: "a", type: "callout" }])).toBe("Callout");
    expect(resolveNfmSideMenuScopeTitle([{ id: "a", type: "cardRef" }])).toBe("Card reference");
    expect(resolveNfmSideMenuScopeTitle([{ id: "a", type: "unknownType" }])).toBe("Block");
    expect(resolveNfmSideMenuScopeTitle([
      { id: "a", type: "paragraph" },
      { id: "b", type: "paragraph" },
      { id: "c", type: "codeBlock" },
    ])).toBe("3 blocks");
  });

  test("filters by label, shortcut, and keywords", () => {
    const sections = buildDefaultSections();
    const devSections = buildDefaultSections(true);
    const duplicateRows = flattenNfmSideMenuRows(filterNfmSideMenuSections(sections, "⌘D"));
    const productionAiRows = flattenNfmSideMenuRows(filterNfmSideMenuSections(sections, "assistant"));
    const devAiRows = flattenNfmSideMenuRows(filterNfmSideMenuSections(devSections, "assistant"));
    const noneRows = flattenNfmSideMenuRows(filterNfmSideMenuSections(sections, "zzzz"));

    expect(duplicateRows.length).toBe(1);
    expect(duplicateRows[0]?.row.key).toBe("duplicate");
    expect(productionAiRows.length).toBe(0);
    expect(devAiRows.length).toBe(1);
    expect(devAiRows[0]?.row.key).toBe("ask-ai");
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
