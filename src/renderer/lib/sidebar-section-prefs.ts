export const SIDEBAR_COLLAPSIBLE_SECTION_IDS = [
  "pinned",
  "library",
  "projects",
  "chats",
] as const;

export type SidebarCollapsibleSectionId = (typeof SIDEBAR_COLLAPSIBLE_SECTION_IDS)[number];

export type SidebarCollapsibleSectionsState = Record<SidebarCollapsibleSectionId, boolean>;

export const SIDEBAR_SECTION_ITEM_LIMITS = [5, 10, 15, 20] as const;

export type SidebarSectionItemLimit = (typeof SIDEBAR_SECTION_ITEM_LIMITS)[number];

export function makeDefaultSidebarCollapsibleSectionsState(): SidebarCollapsibleSectionsState {
  return SIDEBAR_COLLAPSIBLE_SECTION_IDS.reduce<SidebarCollapsibleSectionsState>((acc, sectionId) => {
    acc[sectionId] = false;
    return acc;
  }, {} as SidebarCollapsibleSectionsState);
}

export function isSidebarCollapsibleSectionId(value: unknown): value is SidebarCollapsibleSectionId {
  return typeof value === "string" && SIDEBAR_COLLAPSIBLE_SECTION_IDS.includes(value as SidebarCollapsibleSectionId);
}

export function normalizeSidebarCollapsibleSectionsState(value: unknown): SidebarCollapsibleSectionsState {
  const defaults = makeDefaultSidebarCollapsibleSectionsState();
  if (typeof value !== "object" || value === null || Array.isArray(value)) return defaults;

  return SIDEBAR_COLLAPSIBLE_SECTION_IDS.reduce<SidebarCollapsibleSectionsState>((acc, sectionId) => {
    const collapsed = (value as Record<string, unknown>)[sectionId];
    acc[sectionId] = typeof collapsed === "boolean" ? collapsed : defaults[sectionId];
    return acc;
  }, {} as SidebarCollapsibleSectionsState);
}
