import type { Selection } from "@tiptap/pm/state";

interface SelectionNodeLike {
  attrs?: {
    id?: unknown;
  };
}

interface BlockSelectionLike {
  node?: SelectionNodeLike;
  nodes?: SelectionNodeLike[];
}

function getSelectionNodeBlockId(node: SelectionNodeLike | undefined): string | null {
  const id = node?.attrs?.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/** Reads the authoritative Block IDs carried by ProseMirror node selections. */
export function getNfmBlockSelectionIds(selection: Selection): string[] {
  const blockSelection = selection as Selection & BlockSelectionLike;
  if (Array.isArray(blockSelection.nodes)) {
    return Array.from(
      new Set(
        blockSelection.nodes.map(getSelectionNodeBlockId).filter((id): id is string => id !== null),
      ),
    );
  }

  const nodeId = getSelectionNodeBlockId(blockSelection.node);
  return nodeId ? [nodeId] : [];
}
