export type SidebarProjectGroupCollapseAction = "collapse-all" | "reopen-previous";

export function listExpandedVisibleProjectGroupIds(
  visibleGroupIds: readonly string[],
  expandedGroupIds: ReadonlySet<string>,
): string[] {
  return visibleGroupIds.filter((groupId) => expandedGroupIds.has(groupId));
}

export function listReopenableVisibleProjectGroupIds(
  visibleGroupIds: readonly string[],
  previouslyExpandedGroupIds: readonly string[],
): string[] {
  const visibleGroupIdSet = new Set(visibleGroupIds);
  return previouslyExpandedGroupIds.filter((groupId) => visibleGroupIdSet.has(groupId));
}

export function resolveSidebarProjectGroupCollapseAction({
  visibleGroupIds,
  expandedGroupIds,
  previouslyExpandedGroupIds,
}: {
  visibleGroupIds: readonly string[];
  expandedGroupIds: ReadonlySet<string>;
  previouslyExpandedGroupIds: readonly string[];
}): SidebarProjectGroupCollapseAction | null {
  const expandedVisibleGroupIds = listExpandedVisibleProjectGroupIds(
    visibleGroupIds,
    expandedGroupIds,
  );
  if (expandedVisibleGroupIds.length > 1) return "collapse-all";

  const reopenableGroupIds = listReopenableVisibleProjectGroupIds(
    visibleGroupIds,
    previouslyExpandedGroupIds,
  );
  if (expandedVisibleGroupIds.length === 0 && reopenableGroupIds.length > 0)
    return "reopen-previous";

  return null;
}
