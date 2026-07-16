import * as Y from "yjs";
import { BLOCK_ID_ATTRIBUTE } from "./block-structure";

const PAGE_SHELL_NODE_NAMES = new Set([
  "page",
  "pageRef",
  "cardRef",
]);

export interface NormalizedPageReferences {
  readonly removedHints: number;
  readonly renamedNodes: number;
  readonly blockIds: readonly string[];
}

/** Normalize historical Page references inside one current Block tree. */
export const normalizePageReferences = (
  body: Y.XmlFragment,
): NormalizedPageReferences => {
  const blockIds = new Set<string>();
  let removedHints = 0;
  let renamedNodes = 0;

  const visit = (
    parent: Y.XmlFragment | Y.XmlElement,
    containingBlockId: string | null,
  ): void => {
    for (const [index, child] of parent.toArray().entries()) {
      if (!(child instanceof Y.XmlElement)) continue;

      const rawBlockId = child.getAttribute(BLOCK_ID_ATTRIBUTE);
      const nextBlockId = child.nodeName === "blockContainer"
        && typeof rawBlockId === "string"
        ? rawBlockId
        : containingBlockId;

      if (
        PAGE_SHELL_NODE_NAMES.has(child.nodeName)
        && Object.prototype.hasOwnProperty.call(
          child.getAttributes(),
          "displayHint",
        )
      ) {
        child.removeAttribute("displayHint");
        removedHints += 1;
        if (nextBlockId) blockIds.add(nextBlockId);
      }

      if (child.nodeName === "cardRef") {
        const targetBlockId = child.getAttribute("targetBlockId");
        if (typeof targetBlockId === "string" && targetBlockId.length > 0) {
          const replacement = new Y.XmlElement("pageRef");
          replacement.setAttribute("targetBlockId", targetBlockId);
          parent.delete(index, 1);
          parent.insert(index, [replacement]);
          renamedNodes += 1;
          if (nextBlockId) blockIds.add(nextBlockId);
          continue;
        }
      }

      visit(child, nextBlockId);
    }
  };

  visit(body, null);
  return {
    removedHints,
    renamedNodes,
    blockIds: [...blockIds].sort(),
  };
};
