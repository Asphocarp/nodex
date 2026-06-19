import { describe, expect, test } from "bun:test";
import {
  resolveNfmFormattingToolbarEffectiveFloatingMode,
  resolveNfmFormattingToolbarFloatingMode,
} from "./nfm-formatting-toolbar-controller";
import { shouldRenderNfmLegacyFormattingToolbarItem } from "./nfm-formatting-toolbar";

describe("nfm formatting toolbar", () => {
  test("uses text-action floating only for expanded rich-text selections", () => {
    expect(resolveNfmFormattingToolbarFloatingMode({
      isEditable: true,
      isTableCellSelection: false,
      hasInlineContent: true,
      selectionFrom: 1,
      selectionTo: 4,
    })).toBe("text-action");

    expect(resolveNfmFormattingToolbarFloatingMode({
      isEditable: true,
      isTableCellSelection: false,
      hasInlineContent: false,
      selectionFrom: 1,
      selectionTo: 4,
    })).toBe("legacy");

    expect(resolveNfmFormattingToolbarFloatingMode({
      isEditable: true,
      isTableCellSelection: false,
      hasInlineContent: true,
      selectionFrom: 4,
      selectionTo: 4,
    })).toBe("legacy");
  });

  test("keeps the text-action floating mode while a collapsed selection closes", () => {
    expect(resolveNfmFormattingToolbarEffectiveFloatingMode({
      show: false,
      currentMode: "legacy",
      lastVisibleMode: "text-action",
    })).toBe("text-action");

    expect(resolveNfmFormattingToolbarEffectiveFloatingMode({
      show: true,
      currentMode: "legacy",
      lastVisibleMode: "text-action",
    })).toBe("legacy");
  });

  test("omits non-persisted text alignment buttons from the legacy image/file toolbar", () => {
    expect(shouldRenderNfmLegacyFormattingToolbarItem("textAlignLeftButton")).toBeFalse();
    expect(shouldRenderNfmLegacyFormattingToolbarItem("textAlignCenterButton")).toBeFalse();
    expect(shouldRenderNfmLegacyFormattingToolbarItem("textAlignRightButton")).toBeFalse();
    expect(shouldRenderNfmLegacyFormattingToolbarItem("fileDownloadButton")).toBeTrue();
    expect(shouldRenderNfmLegacyFormattingToolbarItem("replaceFileButton")).toBeTrue();
  });
});
