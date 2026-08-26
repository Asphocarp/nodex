import type { MarkType } from "@tiptap/pm/model";
import { PluginKey } from "@tiptap/pm/state";
import {
  createAutomaticInputRulesPlugin,
  type AutomaticInputRule,
} from "../../../AutomaticInputRules/AutomaticInputRules.js";
import type { LinkMatch } from "./linkDetector.js";
import { tokenizeLink } from "./linkDetector.js";
import { UNICODE_WHITESPACE_REGEX } from "./whitespace.js";

export type AutolinkToken = Pick<
  LinkMatch,
  "value" | "isLink" | "href" | "start" | "end"
>;

export type AutolinkOptions = {
  type: MarkType;
  defaultProtocol: string;
  validate: (url: string) => boolean;
  shouldAutoLink: (url: string) => boolean;
  tokenize?: (text: string, defaultProtocol: string) => AutolinkToken[];
};

function isValidLinkStructure(tokens: readonly AutolinkToken[]): boolean {
  if (tokens.length === 1) return tokens[0].isLink;
  if (tokens.length !== 3 || !tokens[1].isLink) return false;
  return ["()", "[]"].includes(tokens[0].value + tokens[2].value);
}

function createAutolinkInputRule(options: AutolinkOptions): AutomaticInputRule {
  return {
    find: /\s$/u,
    undoable: false,
    inCodeMark: false,
    transform: ({ state, range }) => {
      const $cursor = state.doc.resolve(range.to);
      if (!$cursor.parent.isTextblock) return null;

      const textBeforeWhitespace = $cursor.parent.textBetween(
        0,
        $cursor.parentOffset,
        undefined,
        " ",
      );
      const words = textBeforeWhitespace
        .split(UNICODE_WHITESPACE_REGEX)
        .filter(Boolean);
      const lastWord = words.at(-1);
      if (!lastWord) return null;

      const tokens = (options.tokenize ?? tokenizeLink)(
        lastWord,
        options.defaultProtocol,
      );
      if (!isValidLinkStructure(tokens)) return null;

      const wordOffset = textBeforeWhitespace.lastIndexOf(lastWord);
      const textBlockStart = $cursor.start();
      const transaction = state.tr;

      for (const token of tokens) {
        if (!token.isLink) continue;
        if (!options.validate(token.value) || !options.shouldAutoLink(token.value)) {
          continue;
        }

        const from = textBlockStart + wordOffset + token.start;
        const to = textBlockStart + wordOffset + token.end;
        if (
          state.schema.marks.code &&
          state.doc.rangeHasMark(from, to, state.schema.marks.code)
        ) {
          continue;
        }
        if (state.doc.rangeHasMark(from, to, options.type)) continue;

        transaction.addMark(
          from,
          to,
          options.type.create({ href: token.href }),
        );
      }

      return transaction.steps.length ? transaction : null;
    },
  };
}

/**
 * Adds links only to committed typing input. The shared automatic-transform
 * engine keeps raw URL text and linkification as separate history events.
 */
export function autolink(options: AutolinkOptions) {
  return createAutomaticInputRulesPlugin({
    rules: [createAutolinkInputRule(options)],
    pluginKey: new PluginKey("automaticAutolink"),
    handleEnter: false,
  });
}
