import {
  createExtension,
  SourceInlineContentWithPreviewExtension,
  type BlockNoteEditor,
} from "@blocknote/core";
import { Fragment } from "prosemirror-model";
import { TextSelection } from "prosemirror-state";

import { mathInlineContentConfig } from "../../createReactMathInlineContentSpec.js";

const INLINE_MATH_SUFFIX = /(?:^|[\s(])(\$\$((?:\\[\s\S]|(?!\$\$)[\s\S])+?)\$\$)$/u;

export interface InlineMathInputRuleMatch {
  readonly text: string;
  readonly index: number;
  readonly data: {
    readonly delimitedSource: string;
    readonly source: string;
  };
}

/**
 * Finds a complete inline Equation typed at the cursor.
 *
 * The opening delimiter is valid only at the start of a line, after
 * whitespace, or after an opening parenthesis. The source must be non-empty
 * and may not start or end with whitespace. Escaped source characters remain
 * part of the exact LaTeX value.
 */
export function findInlineMathInputRuleMatch(
  textBeforeCursor: string,
): InlineMathInputRuleMatch | null {
  const match = INLINE_MATH_SUFFIX.exec(textBeforeCursor);
  const delimitedSource = match?.[1];
  const source = match?.[2];
  if (!match || !delimitedSource || !source || source.trim() !== source) return null;

  return {
    text: match[0],
    index: match.index,
    data: { delimitedSource, source },
  };
}

interface InlineMathSelection {
  readonly from: number;
  readonly to: number;
  readonly source: string;
}

function resolveInlineMathSelection(
  editor: BlockNoteEditor<any, any, any>,
): InlineMathSelection | null {
  if (!editor.isEditable) return null;

  const { doc, selection } = editor.prosemirrorState;
  if (!(selection instanceof TextSelection)) return null;
  if (!selection.$from.sameParent(selection.$to)) return null;
  if (selection.$from.parent.type.name === mathInlineContentConfig.type) return null;
  if (selection.$from.parent.type.spec.code) return null;

  let containsNonTextInlineContent = false;
  if (!selection.empty) {
    doc.nodesBetween(selection.from, selection.to, (node) => {
      if (node.isInline && !node.isText) containsNonTextInlineContent = true;
      return !containsNonTextInlineContent;
    });
  }
  if (containsNonTextInlineContent) return null;

  return {
    from: selection.from,
    to: selection.to,
    source: doc.textBetween(selection.from, selection.to, "", "\uFFFC"),
  };
}

export function canInsertInlineMath(editor: BlockNoteEditor<any, any, any>): boolean {
  return resolveInlineMathSelection(editor) !== null;
}

/**
 * Inserts an empty inline Equation at the caret or converts the selected plain
 * text into one. The new source is selected inside the Equation so its popup
 * opens ready to replace or confirm the complete LaTeX value.
 */
export function insertInlineMath(editor: BlockNoteEditor<any, any, any>): boolean {
  const selection = resolveInlineMathSelection(editor);
  const view = editor.prosemirrorView;
  const nodeType = view?.state.schema.nodes[mathInlineContentConfig.type];
  if (!selection || !view || !nodeType) return false;

  const sourceContent = selection.source ? view.state.schema.text(selection.source) : undefined;
  const node = nodeType.create(null, sourceContent);
  const sourceFrom = selection.from + 1;
  const sourceTo = sourceFrom + selection.source.length;
  const replacement = selection.source
    ? node
    : Fragment.fromArray([node, view.state.schema.text(" ")]);
  const transaction = view.state.tr.replaceWith(selection.from, selection.to, replacement);
  transaction.setSelection(TextSelection.create(transaction.doc, sourceFrom, sourceTo));
  transaction.scrollIntoView();

  view.dispatch(transaction);
  editor
    .getExtension(SourceInlineContentWithPreviewExtension)
    ?.store.setState({ selected: selection.from });
  editor.focus();
  return true;
}

function deleteInlineMathBeforeCursor(editor: BlockNoteEditor<any, any, any>): boolean {
  if (!editor.isEditable) return false;

  const view = editor.prosemirrorView;
  const selection = view?.state.selection;
  if (!view || !(selection instanceof TextSelection) || !selection.empty) return false;
  if (selection.$from.parent.type.name === mathInlineContentConfig.type) return false;

  const node = selection.$from.nodeBefore;
  if (node?.type.name !== mathInlineContentConfig.type) return false;

  const from = selection.from - node.nodeSize;
  const transaction = view.state.tr.delete(from, selection.from);
  transaction.setSelection(TextSelection.create(transaction.doc, from));
  view.dispatch(transaction.scrollIntoView());
  return true;
}

export const MathInlineEditingExtension = createExtension({
  key: "math-inline-editing",
  automaticInputRules: [
    {
      find: findInlineMathInputRuleMatch,
      inCodeMark: false,
      // Backspace after conversion deletes the Equation atom. Undo remains a
      // single history step that restores the literal `$$source$$` input.
      undoable: false,
      transform: ({ state, match, range }) => {
        const data = (
          match as RegExpMatchArray & {
            data?: InlineMathInputRuleMatch["data"];
          }
        ).data;
        const delimitedSource = data?.delimitedSource;
        const source = data?.source;
        const nodeType = state.schema.nodes[mathInlineContentConfig.type];
        if (!delimitedSource || !source || !nodeType) return null;

        const delimiterOffset = match[0].lastIndexOf(delimitedSource);
        const replaceFrom = range.from + delimiterOffset;
        const node = nodeType.create(null, state.schema.text(source));
        const transaction = state.tr.replaceRangeWith(replaceFrom, range.to, node);
        return transaction.setSelection(
          TextSelection.create(transaction.doc, replaceFrom + node.nodeSize),
        );
      },
    },
  ],
  keyboardShortcuts: {
    Backspace: ({ editor }) => deleteInlineMathBeforeCursor(editor),
    // ProseMirror key names treat an uppercase character as Shift-modified.
    "Mod-E": ({ editor }) => insertInlineMath(editor),
  },
});

export const INLINE_MATH_INPUT_DELIMITER = "$$";
