import {
  InputRule,
  markInputRule,
  type InputRuleMatch,
} from "@tiptap/core";
import Code from "@tiptap/extension-code";
import type { MarkType } from "@tiptap/pm/model";

const INLINE_CODE_DELIMITER = "`";

function isWhitespace(character: string) {
  return /\s/u.test(character);
}

function isOpeningBoundary(character: string | undefined) {
  return (
    character === undefined || character === "(" || isWhitespace(character)
  );
}

function isClosingBoundary(character: string | undefined) {
  return (
    character === undefined || character === ")" || isWhitespace(character)
  );
}

export function findInlineCodeInputRuleMatch(
  textBeforeCursor: string,
): InputRuleMatch | null {
  if (!textBeforeCursor.endsWith(INLINE_CODE_DELIMITER)) {
    return null;
  }

  const closingIndex = textBeforeCursor.length - INLINE_CODE_DELIMITER.length;
  const openingIndex = textBeforeCursor.lastIndexOf(
    INLINE_CODE_DELIMITER,
    closingIndex - INLINE_CODE_DELIMITER.length,
  );

  if (openingIndex < 0) {
    return null;
  }

  const content = textBeforeCursor.slice(
    openingIndex + INLINE_CODE_DELIMITER.length,
    closingIndex,
  );

  if (
    content.length === 0 ||
    isWhitespace(content[0]) ||
    isWhitespace(content[content.length - 1])
  ) {
    return null;
  }

  const characterBeforeOpening = textBeforeCursor[openingIndex - 1];
  if (!isOpeningBoundary(characterBeforeOpening)) {
    return null;
  }

  return {
    index: openingIndex,
    text: textBeforeCursor.slice(openingIndex),
    replaceWith: content,
  };
}

function characterAfterInputRuleRange(
  state: Parameters<InputRule["handler"]>[0]["state"],
  range: Parameters<InputRule["handler"]>[0]["range"],
) {
  if (range.to >= state.doc.content.size) {
    return undefined;
  }

  // The closing delimiter is the pending text input, so the character at the
  // pre-input range end is the first character after that delimiter.
  const text = state.doc.textBetween(
    range.to,
    Math.min(range.to + 1, state.doc.content.size),
    "",
    "\uFFFC",
  );
  return text[0];
}

function createInlineCodeInputRule(type: MarkType) {
  const markRule = markInputRule({
    find: findInlineCodeInputRuleMatch,
    type,
  });

  return new InputRule({
    find: markRule.find,
    undoable: markRule.undoable,
    handler: (props) => {
      const characterAfterClosing = characterAfterInputRuleRange(
        props.state,
        props.range,
      );
      if (!isClosingBoundary(characterAfterClosing)) {
        return null;
      }

      return markRule.handler(props);
    },
  });
}

export const InlineCode = Code.extend({
  addInputRules() {
    return [createInlineCodeInputRule(this.type)];
  },
});
