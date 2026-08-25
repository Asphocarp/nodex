import { acceptsBlockChildren } from "../block-documents/block-children-policy";
import type { NfmBlock } from "./types";

const canonicalBlockType = (block: NfmBlock): string => {
  if (block.type === "toggle") return "toggleListItem";
  if (block.type === "blockquote") return "quote";
  if (block.type === "emptyBlock") return "paragraph";
  return block.type;
};

/** NFM uses a few presentation names; the structural contract stays BlockNote-native. */
export const nfmBlockAcceptsChildren = (block: NfmBlock): boolean =>
  acceptsBlockChildren({
    type: canonicalBlockType(block),
    props: block.type === "heading" ? { isToggleable: block.isToggleable === true } : {},
  });
