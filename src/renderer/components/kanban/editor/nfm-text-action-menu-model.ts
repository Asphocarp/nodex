import type { SendBlocksMode } from "./nfm-drag-handle-menu";
export {
  TEXT_ACTION_COLOR_VALUES,
  TEXT_ACTION_NOTION_COLOR_ORDER,
  type TextActionColorValue,
} from "@/lib/text-action-color-recents";

export type TextActionBasicStyle = "bold" | "italic" | "underline" | "strike" | "code";
export type TextActionStringStyle = "textColor" | "backgroundColor";

export const TEXT_ACTION_BASIC_STYLES = [
  "bold",
  "italic",
  "underline",
  "strike",
  "code",
] as const satisfies readonly TextActionBasicStyle[];

export const TEXT_ACTION_REFERENCE_SKILLS = [
  { key: "improve-writing", label: "Improve writing" },
  { key: "proofread", label: "Proofread" },
  { key: "explain", label: "Explain" },
  { key: "reformat", label: "Reformat" },
] as const;

export interface TextActionMenuEligibilityInput {
  isEditable: boolean;
  isTableCellSelection: boolean;
  hasInlineContent: boolean;
  selectionFrom: number;
  selectionTo: number;
}

export interface TextActionMenuRuntimeInput {
  currentBlockId: string | null;
  currentBlockType: string | null;
  canSendBlocks: boolean;
  hasSendThreadSection: boolean;
  hasConvertDividerToThreadSection: boolean;
}

export interface TextActionNodexRow {
  key: string;
  label: string;
  enabled: boolean;
  mode?: SendBlocksMode;
}

export function shouldUseTextActionMenu(input: TextActionMenuEligibilityInput): boolean {
  if (!input.isEditable) return false;
  if (input.isTableCellSelection) return false;
  if (!input.hasInlineContent) return false;
  return input.selectionFrom !== input.selectionTo;
}

export function resolveNodexTextActionRows(input: TextActionMenuRuntimeInput): TextActionNodexRow[] {
  if (!input.currentBlockId) return [];

  const rows: TextActionNodexRow[] = [];

  if (input.hasSendThreadSection) {
    rows.push({
      key: "send-section-to-codex",
      label: "Send to chat",
      enabled: true,
    });
  }

  if (input.canSendBlocks) {
    rows.push({
      key: "append-blocks-to-card",
      label: "Move to card",
      enabled: true,
      mode: "card",
    });
    rows.push({
      key: "turn-blocks-into-cards",
      label: "Turn into cards",
      enabled: true,
      mode: "project",
    });
  }

  if (
    input.currentBlockType === "divider"
    && input.hasConvertDividerToThreadSection
  ) {
    rows.push({
      key: "convert-divider-to-thread-section",
      label: "Make thread section",
      enabled: true,
    });
  }

  return rows;
}
