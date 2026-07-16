export const PAGE_STAGE_COLLAPSIBLE_PROPERTIES = [
  "tags",
  "assignee",
  "threads",
  "schedule",
] as const;

export type PageStageCollapsibleProperty = (typeof PAGE_STAGE_COLLAPSIBLE_PROPERTIES)[number];

export const DEFAULT_PAGE_STAGE_COLLAPSED_PROPERTIES: PageStageCollapsibleProperty[] = [];

export const PAGE_STAGE_COLLAPSIBLE_PROPERTY_LABELS: Record<PageStageCollapsibleProperty, string> = {
  tags: "Tags",
  assignee: "Assignee",
  threads: "Threads",
  schedule: "Schedule",
};

export const PAGE_STAGE_COLLAPSED_PROPERTIES_STORAGE_KEY = "nodex-page-stage-collapsed-properties-v1";

function isPageStageCollapsibleProperty(value: unknown): value is PageStageCollapsibleProperty {
  return typeof value === "string" && PAGE_STAGE_COLLAPSIBLE_PROPERTIES.includes(value as PageStageCollapsibleProperty);
}

function normalizeList(values: unknown[]): PageStageCollapsibleProperty[] {
  const selected = new Set<PageStageCollapsibleProperty>();

  for (const value of values) {
    if (!isPageStageCollapsibleProperty(value)) continue;
    selected.add(value);
  }

  return PAGE_STAGE_COLLAPSIBLE_PROPERTIES.filter((property) => selected.has(property));
}

export function normalizePageStageCollapsedProperties(value: unknown): PageStageCollapsibleProperty[] {
  if (Array.isArray(value)) return normalizeList(value);

  if (typeof value === "string") {
    const entries = value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    return normalizeList(entries);
  }

  return [...DEFAULT_PAGE_STAGE_COLLAPSED_PROPERTIES];
}

export function readPageStageCollapsedProperties(): PageStageCollapsibleProperty[] {
  try {
    const raw = localStorage.getItem(PAGE_STAGE_COLLAPSED_PROPERTIES_STORAGE_KEY);
    return raw === null ? [...DEFAULT_PAGE_STAGE_COLLAPSED_PROPERTIES] : normalizePageStageCollapsedProperties(raw);
  } catch {
    return [...DEFAULT_PAGE_STAGE_COLLAPSED_PROPERTIES];
  }
}

export function writePageStageCollapsedProperties(value: unknown): PageStageCollapsibleProperty[] {
  const normalized = normalizePageStageCollapsedProperties(value);

  try {
    localStorage.setItem(PAGE_STAGE_COLLAPSED_PROPERTIES_STORAGE_KEY, normalized.join(","));
  } catch {
    // localStorage may be unavailable.
  }

  return normalized;
}

export function togglePageStageCollapsedProperty(
  current: readonly PageStageCollapsibleProperty[],
  property: PageStageCollapsibleProperty,
): PageStageCollapsibleProperty[] {
  const selected = new Set(current);

  if (selected.has(property)) {
    selected.delete(property);
  } else {
    selected.add(property);
  }

  return PAGE_STAGE_COLLAPSIBLE_PROPERTIES.filter((entry) => selected.has(entry));
}

export function formatPageStageCollapsedPropertyCountLabel(count: number, expanded: boolean): string {
  const normalizedCount = Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0;
  const suffix = normalizedCount === 1 ? "property" : "properties";

  return expanded
    ? `Hide ${normalizedCount} ${suffix}`
    : `${normalizedCount} more ${suffix}`;
}
