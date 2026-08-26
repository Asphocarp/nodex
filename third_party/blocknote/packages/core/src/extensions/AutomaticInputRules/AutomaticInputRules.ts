import type { InputRuleMatch } from "@tiptap/core";
import type { Command, EditorState, SelectionBookmark, Transaction } from "prosemirror-state";
import { Plugin, PluginKey, TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { dispatchHistoryBoundary } from "./historyBoundary.js";

const MAX_MATCH_LENGTH = 500;

export type AutomaticInputRuleFinder =
  | RegExp
  | ((textBeforeCursor: string) => InputRuleMatch | null);

export type AutomaticInputRule = {
  readonly find: AutomaticInputRuleFinder;
  readonly transform: (context: {
    readonly state: EditorState;
    readonly match: RegExpMatchArray;
    readonly range: { readonly from: number; readonly to: number };
  }) => Transaction | null;
  readonly inCode?: boolean | "only";
  readonly inCodeMark?: boolean;
  readonly undoable?: boolean;
};

type UndoableAutomaticInputRule = {
  readonly transform: Transaction;
  readonly rawSelection: SelectionBookmark;
};

export const automaticInputRulesPluginKey =
  new PluginKey<UndoableAutomaticInputRule | null>("automaticInputRules");

function findRuleMatch(
  textBeforeCursor: string,
  finder: AutomaticInputRuleFinder,
): RegExpMatchArray | null {
  if (finder instanceof RegExp) {
    finder.lastIndex = 0;
    return finder.exec(textBeforeCursor);
  }

  const match = finder(textBeforeCursor);
  if (!match) return null;

  const result = [match.text] as RegExpMatchArray & {
    data?: Record<string, unknown>;
  };
  result.index = match.index;
  result.input = textBeforeCursor;
  result.data = match.data;
  if (match.replaceWith !== undefined) {
    result.push(match.replaceWith);
  }
  return result;
}

function inputRuleCanRun(
  rule: AutomaticInputRule,
  state: EditorState,
  cursorPosition: number,
  rangeStart: number,
): boolean {
  const $cursor = state.doc.resolve(cursorPosition);
  const inCodeNode = $cursor.parent.type.spec.code === true;
  if (inCodeNode && !rule.inCode) return false;
  if (!inCodeNode && rule.inCode === "only") return false;

  if (rule.inCodeMark !== false) return true;

  let hasCodeMark = $cursor.marks().some((mark) => mark.type.spec.code);
  state.doc.nodesBetween(rangeStart, cursorPosition, (node) => {
    if (!node.isInline) return !hasCodeMark;
    if (node.marks.some((mark) => mark.type.spec.code)) {
      hasCodeMark = true;
    }
    return !hasCodeMark;
  });
  return !hasCodeMark;
}

type PendingInput = {
  readonly from: number;
  readonly to: number;
  readonly text: string;
  readonly commitText: boolean;
};

function runAutomaticInputRules(
  view: EditorView,
  input: PendingInput,
  rules: readonly AutomaticInputRule[],
  pluginKey: PluginKey<UndoableAutomaticInputRule | null>,
): boolean {
  if (view.composing) return false;

  const stateBeforeInput = view.state;
  const rawTransaction = input.commitText
    ? stateBeforeInput.tr.insertText(input.text, input.from, input.to)
    : null;
  const stateWithRawInput = rawTransaction
    ? stateBeforeInput.apply(rawTransaction)
    : stateBeforeInput;
  const cursorPosition = rawTransaction
    ? rawTransaction.mapping.map(input.from)
    : input.from;
  const transformEnd = rawTransaction
    ? rawTransaction.mapping.map(input.to)
    : input.to;
  const $cursor = stateWithRawInput.doc.resolve(cursorPosition);
  const existingText = $cursor.parent.textBetween(
    Math.max(0, $cursor.parentOffset - MAX_MATCH_LENGTH),
    $cursor.parentOffset,
    null,
    "\uFFFC",
  );
  const textBeforeCursor = input.commitText ? existingText : existingText + input.text;

  for (const rule of rules) {
    const match = findRuleMatch(textBeforeCursor, rule.find);
    if (!match || match[0].length < input.text.length) continue;

    const rangeStart = cursorPosition - (match[0].length - (input.commitText ? 0 : input.text.length));
    if (!inputRuleCanRun(rule, stateWithRawInput, cursorPosition, rangeStart)) continue;

    const transform = rule.transform({
      state: stateWithRawInput,
      match,
      range: { from: rangeStart, to: transformEnd },
    });
    if (!transform?.steps.length) continue;

    if (rawTransaction) {
      view.dispatch(rawTransaction);
    }
    dispatchHistoryBoundary(view);

    if (rule.undoable !== false) {
      transform.setMeta(pluginKey, {
        transform,
        rawSelection: stateWithRawInput.selection.getBookmark(),
      } satisfies UndoableAutomaticInputRule);
    }
    view.dispatch(transform);
    dispatchHistoryBoundary(view);
    return true;
  }

  return false;
}

export function createAutomaticInputRulesPlugin(options: {
  readonly rules: readonly AutomaticInputRule[];
  readonly pluginKey?: PluginKey<UndoableAutomaticInputRule | null>;
  readonly handleEnter?: boolean;
}): Plugin<UndoableAutomaticInputRule | null> {
  const { rules } = options;
  const pluginKey = options.pluginKey ?? automaticInputRulesPluginKey;

  return new Plugin<UndoableAutomaticInputRule | null>({
    key: pluginKey,
    state: {
      init: () => null,
      apply: (transaction, previous) => {
        const stored = transaction.getMeta(pluginKey) as
          | UndoableAutomaticInputRule
          | null
          | undefined;
        if (stored !== undefined) return stored;
        if (transaction.docChanged || transaction.selectionSet) return null;
        return previous;
      },
    },
    props: {
      handleTextInput: (view, from, to, text) =>
        runAutomaticInputRules(
          view,
          { from, to, text, commitText: true },
          rules,
          pluginKey,
        ),
      handleKeyDown: (view, event) => {
        if (options.handleEnter === false) return false;
        if (
          event.key !== "Enter" ||
          event.shiftKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.altKey
        ) {
          return false;
        }
        const { $cursor } = view.state.selection as TextSelection;
        if (!$cursor) return false;
        return runAutomaticInputRules(
          view,
          {
            from: $cursor.pos,
            to: $cursor.pos,
            text: "\n",
            commitText: false,
          },
          rules,
          pluginKey,
        );
      },
      handleDOMEvents: {
        compositionend: (view) => {
          setTimeout(() => {
            const { $cursor } = view.state.selection as TextSelection;
            if (!$cursor) return;
            runAutomaticInputRules(
              view,
              {
                from: $cursor.pos,
                to: $cursor.pos,
                text: "",
                commitText: false,
              },
              rules,
              pluginKey,
            );
          });
          return false;
        },
      },
    },
  });
}

/** Restores the literal input for the most recently applied automatic rule. */
export const undoAutomaticInputRule: Command = (state, dispatch, view) => {
  const undoable = automaticInputRulesPluginKey.getState(state);
  if (!undoable) return false;
  if (!dispatch) return true;

  const transaction = state.tr;
  for (let index = undoable.transform.steps.length - 1; index >= 0; index -= 1) {
    transaction.step(
      undoable.transform.steps[index].invert(undoable.transform.docs[index]),
    );
  }
  transaction.setSelection(undoable.rawSelection.resolve(transaction.doc));
  transaction.setMeta(automaticInputRulesPluginKey, null);
  dispatch(transaction);
  if (view) dispatchHistoryBoundary(view);
  return true;
};
