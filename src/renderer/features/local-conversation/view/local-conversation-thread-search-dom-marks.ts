import { THREAD_VISUAL_TOKENS } from "./blocks/local-conversation-visual-tokens";

const TURN_SEARCH_MATCHED_ROW_CLASS_NAME = "rounded-2xl bg-token-foreground/3";
const SEARCH_UNIT_MATCHED_CLASSES = THREAD_VISUAL_TOKENS.searchUnitMatched.split(" ");
const SEARCH_UNIT_ACTIVE_CLASSES = THREAD_VISUAL_TOKENS.searchUnitActive.split(" ");
const TURN_SEARCH_MATCHED_ROW_CLASSES = TURN_SEARCH_MATCHED_ROW_CLASS_NAME.split(" ");

export function applyThreadSearchDomMarks(input: {
  root: HTMLElement;
  matchedSearchUnitKeys: ReadonlySet<string>;
  matchedTurnKeys: ReadonlySet<string>;
  activeSearchUnitKey: string | null;
}): void {
  const { activeSearchUnitKey, matchedSearchUnitKeys, matchedTurnKeys, root } = input;

  for (const element of root.querySelectorAll<HTMLElement>("[data-content-search-unit-key]")) {
    const searchUnitKey = element.dataset.contentSearchUnitKey ?? "";
    const isMatched = matchedSearchUnitKeys.has(searchUnitKey);
    const isActive = activeSearchUnitKey !== null && activeSearchUnitKey === searchUnitKey;

    for (const className of SEARCH_UNIT_MATCHED_CLASSES) {
      element.classList.toggle(className, isMatched);
    }
    for (const className of SEARCH_UNIT_ACTIVE_CLASSES) {
      element.classList.toggle(className, isActive);
    }
  }

  for (const element of root.querySelectorAll<HTMLElement>("[data-content-search-turn-key]")) {
    const turnKey = element.dataset.contentSearchTurnKey ?? "";
    const isMatched = matchedTurnKeys.has(turnKey);
    for (const className of TURN_SEARCH_MATCHED_ROW_CLASSES) {
      element.classList.toggle(className, isMatched);
    }
  }
}
