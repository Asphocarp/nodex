import type { InputRuleMatch } from "@tiptap/core";
import Code from "@tiptap/extension-code";

const INLINE_CODE_DELIMITER = "`";

function isWhitespace(character: string) {
  return /\s/u.test(character);
}

function isOpeningBoundary(character: string | undefined) {
  return (
    character === undefined || character === "(" || isWhitespace(character)
  );
}

export function findInlineCodeInputRuleMatch(
  textBeforeCursor: string,
  delimiter = INLINE_CODE_DELIMITER,
): InputRuleMatch | null {
  if (!textBeforeCursor.endsWith(delimiter)) return null;

  const closingIndex = textBeforeCursor.length - delimiter.length;
  const openingIndex = textBeforeCursor.lastIndexOf(
    delimiter,
    closingIndex - delimiter.length,
  );
  if (openingIndex < 0) return null;

  const content = textBeforeCursor.slice(
    openingIndex + delimiter.length,
    closingIndex,
  );
  if (
    content.length === 0 ||
    isWhitespace(content[0]) ||
    isWhitespace(content[content.length - 1])
  ) {
    return null;
  }

  if (!isOpeningBoundary(textBeforeCursor[openingIndex - 1])) return null;

  return {
    index: openingIndex,
    text: textBeforeCursor.slice(openingIndex),
    replaceWith: content,
  };
}

// Schema, rendering, commands, and paste rules still come from Tiptap. Typing
// rules are deliberately owned by BlockNote's raw-first transform engine.
export const InlineCode = Code.extend({});
