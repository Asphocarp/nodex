export interface CardActionMenuEntry {
  id:
    | "favorite"
    | "edit-icon"
    | "edit-property"
    | "layout"
    | "property-visibility"
    | "open-in"
    | "copy-link"
    | "duplicate"
    | "delete";
  label: string;
  shortcut?: string;
  disabled?: boolean;
  mockReason?: string;
  keywords: string[];
}

interface CardActionMenuQuery {
  query: string;
  showMockActions: boolean;
}

const MOCK_ACTION_REASON = "Mock UI only. Not available in Nodex yet.";

const CARD_ACTION_MENU_ENTRIES: CardActionMenuEntry[] = [
  {
    id: "favorite",
    label: "Add to Favorites",
    disabled: true,
    mockReason: MOCK_ACTION_REASON,
    keywords: ["favorite", "star", "pin"],
  },
  {
    id: "edit-icon",
    label: "Edit icon",
    disabled: true,
    mockReason: MOCK_ACTION_REASON,
    keywords: ["icon", "emoji", "cover"],
  },
  {
    id: "edit-property",
    label: "Edit property",
    disabled: true,
    mockReason: MOCK_ACTION_REASON,
    keywords: ["property", "field", "metadata"],
  },
  {
    id: "layout",
    label: "Layout",
    disabled: true,
    mockReason: MOCK_ACTION_REASON,
    keywords: ["layout", "view", "appearance"],
  },
  {
    id: "property-visibility",
    label: "Property visibility",
    disabled: true,
    mockReason: MOCK_ACTION_REASON,
    keywords: ["property", "visibility", "display"],
  },
  {
    id: "open-in",
    label: "Open in",
    disabled: true,
    mockReason: MOCK_ACTION_REASON,
    keywords: ["open", "stage", "panel"],
  },
  {
    id: "copy-link",
    label: "Copy deeplink",
    keywords: ["copy", "link", "reference"],
  },
  {
    id: "duplicate",
    label: "Duplicate",
    shortcut: "⌘D",
    disabled: true,
    mockReason: MOCK_ACTION_REASON,
    keywords: ["duplicate", "clone", "copy"],
  },
  {
    id: "delete",
    label: "Delete",
    shortcut: "Del",
    keywords: ["delete", "remove", "trash"],
  },
];

function normalizeSearchValue(value: string): string {
  return value.trim().toLowerCase();
}

export function getPageActionMenuEntries(input: CardActionMenuQuery): CardActionMenuEntry[] {
  const { query, showMockActions } = input;
  const normalizedQuery = normalizeSearchValue(query);
  const entries = CARD_ACTION_MENU_ENTRIES.filter((entry) => showMockActions || !entry.mockReason);

  if (normalizedQuery.length === 0) {
    return entries;
  }

  return entries.filter((entry) => {
    const haystack = [entry.label, entry.mockReason ? "mock" : "", ...entry.keywords].join(" ").toLowerCase();
    return haystack.includes(normalizedQuery);
  });
}
