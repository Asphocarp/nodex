interface ParentBlock {
  readonly id?: string;
}

/**
 * Walks stable Block IDs rather than DOM ancestry so drag/drop guards also
 * work for nested BlockNote groups that are not currently mounted.
 */
export const isBlockWithinOwnerTree = (
  getParentBlock: (id: string) => ParentBlock | undefined,
  ownerBlockId: string,
  startBlockId: string,
): boolean => {
  if (!ownerBlockId || !startBlockId) return false;

  const visited = new Set<string>();
  let currentId: string | undefined = startBlockId;
  while (currentId) {
    if (currentId === ownerBlockId) return true;
    if (visited.has(currentId)) return false;
    visited.add(currentId);
    currentId = getParentBlock(currentId)?.id;
  }
  return false;
};
