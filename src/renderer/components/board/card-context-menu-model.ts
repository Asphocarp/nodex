export interface CardActionMenuEntry {
  id:
    | "favorite"
    | "edit-icon"
    | "layout"
    | "property-visibility"
    | "open-page"
    | "open-in-new-chat"
    | "send-to-chat"
    | "copy-page-key"
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
  hasPageKey?: boolean;
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
    id: "open-page",
    label: "Open Page",
    keywords: ["open", "page", "stage", "panel"],
  },
  {
    id: "open-in-new-chat",
    label: "Open in New Chat",
    keywords: ["open", "new", "chat", "session", "focus"],
  },
  {
    id: "send-to-chat",
    label: "Send Page to Chat…",
    keywords: ["send", "page", "chat", "thread", "agent"],
  },
  {
    id: "copy-page-key",
    label: "Copy Page key",
    keywords: ["copy", "page", "key", "identifier", "issue"],
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
  const { query, showMockActions, hasPageKey = true } = input;
  const normalizedQuery = normalizeSearchValue(query);
  const entries = CARD_ACTION_MENU_ENTRIES.filter((entry) => (
    (showMockActions || !entry.mockReason)
    && (entry.id !== "copy-page-key" || hasPageKey)
  ));

  if (normalizedQuery.length === 0) {
    return entries;
  }

  return entries.filter((entry) => {
    const haystack = [entry.label, entry.mockReason ? "mock" : "", ...entry.keywords].join(" ").toLowerCase();
    return haystack.includes(normalizedQuery);
  });
}
