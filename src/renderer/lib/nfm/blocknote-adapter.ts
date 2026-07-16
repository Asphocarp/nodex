import {
  blockNoteToNfm as convertBlockNoteToNfm,
  nfmToBlockNote as convertNfmToBlockNote,
  nfmToBlockNoteWithIds as convertNfmToBlockNoteWithIds,
} from "../../../shared/block-documents/nfm-blocknote-adapter";
import type { NfmBlock } from "../../../shared/nfm/types";

// The legacy renderer surface has several schema-specific BlockNote generics.
// Keep its compatibility facade permissive until BF-04 removes snapshot
// rehydration; authority-side codecs import the strict shared adapter directly.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LegacyBlockNoteBlock = any;

export function nfmToBlockNote(
  blocks: NfmBlock[],
  toggleStates?: Map<string, boolean>,
): LegacyBlockNoteBlock[] {
  return convertNfmToBlockNote(blocks, toggleStates);
}

export function nfmToBlockNoteWithIds(
  blocks: NfmBlock[],
  allocateBlockId: () => string,
): LegacyBlockNoteBlock[] {
  return convertNfmToBlockNoteWithIds(blocks, allocateBlockId);
}

export function blockNoteToNfm(
  blocks: readonly LegacyBlockNoteBlock[],
): NfmBlock[] {
  return convertBlockNoteToNfm(blocks);
}

interface ToggleStateBlock {
  readonly id?: string;
  readonly type?: string;
  readonly props?: Readonly<Record<string, unknown>>;
  readonly children?: readonly unknown[];
}

/**
 * Applies window-local toggle expansion state to an NFM export. Durable Page
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
