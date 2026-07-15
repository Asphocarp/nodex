import * as Y from "yjs";
import { BLOCK_ID_ATTRIBUTE } from "./block-structure";

const CARD_SHELL_NODE_NAMES = new Set(["card", "cardRef"]);

export interface RemovedCardReferenceHints {
  readonly count: number;
  readonly blockIds: readonly string[];
}

/** Remove deprecated Card title snapshots from one current Block tree. */
export const removeCardReferenceDisplayHints = (
  body: Y.XmlFragment,
): RemovedCardReferenceHints => {
  const blockIds = new Set<string>();
  let count = 0;

  const visit = (
    parent: Y.XmlFragment | Y.XmlElement,
    containingBlockId: string | null,
  ): void => {
    for (const child of parent.toArray()) {
      if (!(child instanceof Y.XmlElement)) continue;

      const rawBlockId = child.getAttribute(BLOCK_ID_ATTRIBUTE);
      const nextBlockId = child.nodeName === "blockContainer"
        && typeof rawBlockId === "string"
        ? rawBlockId
        : containingBlockId;

      if (
        CARD_SHELL_NODE_NAMES.has(child.nodeName)
        && Object.prototype.hasOwnProperty.call(
          child.getAttributes(),
          "displayHint",
        )
      ) {
        child.removeAttribute("displayHint");
        count += 1;
        if (nextBlockId) blockIds.add(nextBlockId);
      }

      visit(child, nextBlockId);
    }
  };

  visit(body, null);
  return { count, blockIds: [...blockIds].sort() };
};
