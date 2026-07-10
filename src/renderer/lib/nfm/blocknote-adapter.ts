export {
  blockNoteToNfm,
  nfmToBlockNote,
  nfmToBlockNoteWithIds,
} from "../../../shared/block-documents/nfm-blocknote-adapter";

import type { NfmBlock } from "../../../shared/nfm/types";

interface ToggleStateBlock {
  readonly id?: string;
  readonly type?: string;
  readonly props?: Readonly<Record<string, unknown>>;
  readonly children?: readonly unknown[];
}

/**
 * Applies window-local toggle expansion state to an NFM export. Durable Card
 * Documents intentionally exclude this DOM state.
 */
export function applyToggleStatesFromDom(
  blockNoteBlocks: readonly unknown[],
  nfmBlocks: NfmBlock[],
  editorElement: HTMLElement,
): void {
  const toggleStates: boolean[] = [];
  collectToggleStatesFromDom(blockNoteBlocks, editorElement, toggleStates);
  applyToggleStatesToNfm(nfmBlocks, toggleStates, { index: 0 });
}

function collectToggleStatesFromDom(
  blocks: readonly unknown[],
  editorElement: HTMLElement,
  states: boolean[],
): void {
  for (const candidate of blocks) {
    if (typeof candidate !== "object" || candidate === null) continue;
    const block = candidate as ToggleStateBlock;
    const isToggle =
      block.type === "toggleListItem" ||
      (block.type === "heading" && block.props?.isToggleable === true);

    if (isToggle && block.id) {
      const escaped = CSS.escape(block.id);
      const wrapper = editorElement.querySelector(
        `.bn-block[data-id="${escaped}"] > .bn-block-content .bn-toggle-wrapper`,
      );
      states.push(wrapper?.getAttribute("data-show-children") === "true");
    }

    if (block.children && block.children.length > 0) {
      collectToggleStatesFromDom(block.children, editorElement, states);
    }
  }
}

function applyToggleStatesToNfm(
  blocks: NfmBlock[],
  states: readonly boolean[],
  counter: { index: number },
): void {
  for (const block of blocks) {
    const isToggle =
      block.type === "toggle" ||
      (block.type === "heading" && block.isToggleable === true);

    if (isToggle && counter.index < states.length) {
      if (states[counter.index]) {
        block.isOpen = true;
      } else {
        delete block.isOpen;
      }
      counter.index += 1;
    }

    if (block.children.length > 0) {
      applyToggleStatesToNfm(block.children, states, counter);
    }
  }
}
