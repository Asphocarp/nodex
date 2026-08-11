import type {
  TextActionBasicStyle,
  TextActionColorValue,
  TextActionStringStyle,
} from "./nfm-text-action-menu-model";

export type TextActionStyleSchemaEntry = {
  propSchema?: "boolean" | "string";
  type?: string;
};

export interface TextActionEditorAdapter {
  schema: {
    styleSchema: Record<string, TextActionStyleSchemaEntry>;
  };
  focus: () => void;
  transact: (callback: () => void) => void;
  updateBlock: (
    block: unknown,
    update: {
      type: string;
      props?: Record<string, boolean | number | string>;
    },
  ) => void;
  toggleStyles: (styles: Record<string, unknown>) => void;
  addStyles: (styles: Record<string, unknown>) => void;
  removeStyles: (styles: Record<string, unknown>) => void;
}

export interface TextActionBlockTypeUpdate {
  type: string;
  props?: Record<string, boolean | number | string>;
}

export function textActionStyleSchemaEntry(
  editor: Pick<TextActionEditorAdapter, "schema">,
  style: string,
) {
  return editor.schema.styleSchema[style];
}

export function textActionHasBooleanStyle(
  editor: Pick<TextActionEditorAdapter, "schema">,
  style: string,
) {
  const entry = textActionStyleSchemaEntry(editor, style);
  return entry?.propSchema === "boolean";
}

export function textActionHasStringStyle(
  editor: Pick<TextActionEditorAdapter, "schema">,
  style: string,
) {
  const entry = textActionStyleSchemaEntry(editor, style);
  return entry?.propSchema === "string";
}

export function applyTextActionBlockType(
  editor: TextActionEditorAdapter,
  blocks: unknown[],
  update: TextActionBlockTypeUpdate,
) {
  if (blocks.length === 0) return false;

  editor.focus();
  editor.transact(() => {
    for (const block of blocks) {
      editor.updateBlock(block, update);
    }
  });

  return true;
}

export function applyTextActionToggleStyle(
  editor: TextActionEditorAdapter,
  style: TextActionBasicStyle,
) {
  if (!textActionHasBooleanStyle(editor, style)) return false;

  editor.focus();
  editor.toggleStyles({ [style]: true });
  return true;
}

export function applyTextActionStringStyle(
  editor: TextActionEditorAdapter,
  style: TextActionStringStyle,
  value: TextActionColorValue,
  canUseStyle: boolean,
  refocus: () => void,
) {
  if (!canUseStyle) return false;

  if (value === "default") {
    editor.removeStyles({ [style]: true });
  } else {
    editor.addStyles({ [style]: value });
  }

  refocus();
  return true;
}

export function buildTextActionClearFormatStyles(
  editor: Pick<TextActionEditorAdapter, "schema">,
  basicStyles: readonly TextActionBasicStyle[],
  options: {
    canUseTextColor: boolean;
    canUseBackgroundColor: boolean;
  },
) {
  const stylesToRemove: Record<string, true> = {};

  for (const style of basicStyles) {
    if (textActionHasBooleanStyle(editor, style)) {
      stylesToRemove[style] = true;
    }
  }

  if (options.canUseTextColor) stylesToRemove.textColor = true;
  if (options.canUseBackgroundColor) stylesToRemove.backgroundColor = true;

  return stylesToRemove;
}

export function applyTextActionClearFormat(
  editor: TextActionEditorAdapter,
  basicStyles: readonly TextActionBasicStyle[],
  options: {
    canUseTextColor: boolean;
    canUseBackgroundColor: boolean;
  },
) {
  const stylesToRemove = buildTextActionClearFormatStyles(
    editor,
    basicStyles,
    options,
  );

  if (Object.keys(stylesToRemove).length === 0) return false;

  editor.focus();
  editor.removeStyles(stylesToRemove);
  return true;
}
