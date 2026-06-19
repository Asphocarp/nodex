export type NfmSideMenuActionKind = "action" | "submenu";
export type NfmSideMenuVisualGroup =
  | "block-shape"
  | "block-move"
  | "collaboration"
  | "presentation"
  | "ai"
  | "nodex"
  | "table";

export type NfmSideMenuActionKey =
  | "turn-into"
  | "color"
  | "copy-link-to-block"
  | "duplicate"
  | "move-to"
  | "delete"
  | "comment"
  | "suggest-edits"
  | "present-from-here"
  | "ask-ai"
  | "convert-divider-to-thread-section"
  | "table-header-row"
  | "table-header-column";

export type NfmSideMenuSubmenuKey = "turn-into" | "color" | "move-to";

export interface NfmSideMenuAction {
  key: NfmSideMenuActionKey;
  label: string;
  kind: NfmSideMenuActionKind;
  section: "reference" | "nodex" | "table";
  visualGroup: NfmSideMenuVisualGroup;
  enabled: boolean;
  inactiveMock?: boolean;
  shortcut?: string;
  badge?: string;
  submenu?: NfmSideMenuSubmenuKey;
  keywords?: readonly string[];
}

export interface NfmSideMenuSection {
  key: "text" | "nodex" | "table";
  label: string;
  rows: NfmSideMenuAction[];
}

export interface NfmSideMenuModelInput {
  currentBlockId: string | null;
  currentBlockType: string | null;
  isEditable: boolean;
  canUseColor: boolean;
  canSendBlocks: boolean;
  hasConvertDividerToThreadSection: boolean;
  isTableBlock: boolean;
  canUseTableHeaders: boolean;
}

export interface NfmSideMenuFlatRow {
  sectionKey: NfmSideMenuSection["key"];
  row: NfmSideMenuAction;
}

const REFERENCE_ACTIONS: readonly Omit<NfmSideMenuAction, "section" | "enabled" | "inactiveMock">[] = [
  {
    key: "turn-into",
    label: "Turn into",
    kind: "submenu",
    visualGroup: "block-shape",
    submenu: "turn-into",
    keywords: ["convert", "type", "block"],
  },
  {
    key: "color",
    label: "Color",
    kind: "submenu",
    visualGroup: "block-shape",
    submenu: "color",
    keywords: ["colour", "background", "text"],
  },
  {
    key: "copy-link-to-block",
    label: "Copy link to block",
    kind: "action",
    visualGroup: "block-move",
    shortcut: "⌘⌃L",
    keywords: ["url", "anchor"],
  },
  {
    key: "duplicate",
    label: "Duplicate",
    kind: "action",
    visualGroup: "block-move",
    shortcut: "⌘D",
    keywords: ["copy"],
  },
  {
    key: "move-to",
    label: "Move to",
    kind: "submenu",
    visualGroup: "block-move",
    submenu: "move-to",
    shortcut: "⌘⇧P",
    keywords: ["relocate", "page", "card", "database", "db", "nodex"],
  },
  {
    key: "delete",
    label: "Delete",
    kind: "action",
    visualGroup: "block-move",
    shortcut: "Del",
    keywords: ["remove", "trash"],
  },
  {
    key: "comment",
    label: "Comment",
    kind: "action",
    visualGroup: "collaboration",
    shortcut: "⌘⇧M",
    keywords: ["note"],
  },
  {
    key: "suggest-edits",
    label: "Suggest edits",
    kind: "action",
    visualGroup: "collaboration",
    shortcut: "⌘⇧⌥X",
    keywords: ["review", "proposal"],
  },
  {
    key: "present-from-here",
    label: "Present from here",
    kind: "action",
    visualGroup: "presentation",
    shortcut: "⌘⌥P",
    badge: "Beta",
    keywords: ["presentation", "play"],
  },
  {
    key: "ask-ai",
    label: "Ask AI",
    kind: "action",
    visualGroup: "ai",
    shortcut: "⌘J",
    keywords: ["assistant", "codex"],
  },
] as const;

function enabledForReferenceAction(
  action: Pick<NfmSideMenuAction, "key">,
  input: NfmSideMenuModelInput,
) {
  if (!input.currentBlockId) return false;
  if (!input.isEditable) return false;

  if (action.key === "turn-into") return true;
  if (action.key === "color") return input.canUseColor;
  if (action.key === "duplicate") return true;
  if (action.key === "move-to") return input.canSendBlocks;
  if (action.key === "delete") return true;

  return false;
}

export function buildNfmSideMenuSections(input: NfmSideMenuModelInput): NfmSideMenuSection[] {
  const referenceRows = REFERENCE_ACTIONS.map((action) => {
    const enabled = enabledForReferenceAction(action, input);
    return {
      ...action,
      section: "reference" as const,
      enabled,
      inactiveMock: !enabled,
    };
  });

  const nodexRows: NfmSideMenuAction[] = [];
  if (
    input.currentBlockId
    && input.currentBlockType === "divider"
    && input.hasConvertDividerToThreadSection
  ) {
    nodexRows.push({
      key: "convert-divider-to-thread-section",
      label: "Make thread section",
      kind: "action",
      section: "nodex",
      visualGroup: "nodex",
      enabled: input.isEditable,
      inactiveMock: !input.isEditable,
      keywords: ["divider", "thread", "section"],
    });
  }

  const tableRows: NfmSideMenuAction[] = input.currentBlockId
    && input.isTableBlock
    && input.canUseTableHeaders
    ? [
        {
          key: "table-header-row",
          label: "Header row",
          kind: "action",
          section: "table",
          visualGroup: "table",
          enabled: input.isEditable,
          inactiveMock: !input.isEditable,
          keywords: ["table"],
        },
        {
          key: "table-header-column",
          label: "Header column",
          kind: "action",
          section: "table",
          visualGroup: "table",
          enabled: input.isEditable,
          inactiveMock: !input.isEditable,
          keywords: ["table"],
        },
      ]
    : [];

  const sections: NfmSideMenuSection[] = [
    { key: "text", label: "Text", rows: referenceRows },
    { key: "nodex", label: "Nodex", rows: nodexRows },
    { key: "table", label: "Table", rows: tableRows },
  ];

  return sections.filter((section) => section.rows.length > 0);
}

function normalizeQueryPart(value: string) {
  return value.toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

function rowMatchesQuery(row: NfmSideMenuAction, query: string) {
  const normalizedQuery = normalizeQueryPart(query);
  if (!normalizedQuery) return true;

  const haystack = normalizeQueryPart([
    row.label,
    row.shortcut ?? "",
    row.badge ?? "",
    ...(row.keywords ?? []),
  ].join(" "));

  return haystack.includes(normalizedQuery);
}

export function filterNfmSideMenuSections(
  sections: readonly NfmSideMenuSection[],
  query: string,
): NfmSideMenuSection[] {
  return sections
    .map((section) => ({
      ...section,
      rows: section.rows.filter((row) => rowMatchesQuery(row, query)),
    }))
    .filter((section) => section.rows.length > 0);
}

export function flattenNfmSideMenuRows(
  sections: readonly NfmSideMenuSection[],
): NfmSideMenuFlatRow[] {
  return sections.flatMap((section) => section.rows.map((row) => ({
    sectionKey: section.key,
    row,
  })));
}

export function shouldRenderNfmSideMenuSeparatorBefore(
  previousRow: NfmSideMenuFlatRow | undefined,
  currentRow: NfmSideMenuFlatRow,
) {
  return Boolean(previousRow && previousRow.row.visualGroup !== currentRow.row.visualGroup);
}

export function getNfmSideMenuSeparatorBeforeKeys(
  rows: readonly NfmSideMenuFlatRow[],
): NfmSideMenuActionKey[] {
  return rows
    .filter((row, index) => shouldRenderNfmSideMenuSeparatorBefore(rows[index - 1], row))
    .map(({ row }) => row.key);
}

export function getInitialNfmSideMenuFocusIndex(
  query: string,
  rows: readonly NfmSideMenuFlatRow[],
) {
  if (!normalizeQueryPart(query)) return -1;
  return rows.length > 0 ? 0 : -1;
}

export function moveNfmSideMenuFocus(
  currentIndex: number,
  direction: 1 | -1,
  rows: readonly NfmSideMenuFlatRow[],
) {
  if (rows.length === 0) return -1;
  if (currentIndex < 0) return direction > 0 ? 0 : rows.length - 1;

  const nextIndex = currentIndex + direction;
  if (nextIndex < 0) return rows.length - 1;
  if (nextIndex >= rows.length) return 0;
  return nextIndex;
}
