import { startTransition, useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { filterSuggestionItems, insertOrUpdateBlockForSlashMenu } from "@blocknote/core/extensions";
import {
  SuggestionMenuController,
  getDefaultReactSlashMenuItems,
  useBlockNoteEditor,
  type DefaultReactSuggestionItem,
  type SuggestionMenuProps,
} from "@blocknote/react";
import { Bell, CalendarDays, Clock, FileText, Link2, ListTree, SendHorizontal, Settings2 } from "lucide-react";
import {
  NodexDropdownActionRow,
  NodexDropdownMessage,
  NodexDropdownScrollList,
  NodexDropdownSectionLabel,
  NodexDropdownSurface,
} from "@/components/ui/dropdown";
import { NodexTooltip } from "@/components/ui/tooltip";
import { getDefaultToggleListInlineViewProps } from "@/lib/toggle-list/inline-view-props";
import { useAllBoards } from "@/lib/use-all-boards";
import type { Project } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { CommandPaletteCard, CommandPaletteThread } from "@/lib/command-palette";
import {
  buildCommandPaletteCardDescriptionSearchScopeKey,
  buildCommandPaletteCardItemsFromBoardSummaries,
  searchCommandPaletteCardDescriptions,
  selectCommandPaletteCardResults,
  type CommandPaletteCardDescriptionSearchBatch,
} from "@/lib/command-palette-card-results";
import {
  listCommandPaletteThreadItems,
  searchCommandPaletteThreadContent,
  selectCommandPaletteChatResults,
  type CommandPaletteThreadContentSearchBatch,
} from "@/lib/command-palette-chat-search";
import { createCommandPaletteThreadSearchIndex } from "@/lib/command-palette-thread-search";
import { useCommandPaletteCardSearchIndex } from "@/lib/use-command-palette-card-search-index";
import {
  NFM_SUGGESTION_MENU_FLOATING_OPTIONS,
  NFM_SUGGESTION_MENU_PORTAL_ELEMENT,
  NFM_SUGGESTION_MENU_TOOLTIP_Z_INDEX,
} from "./nfm-blocknote-floating-ui";
import { createEmptyThreadSectionBlock } from "./thread-section";
import { formatThreadMentionShortUuid } from "@/lib/nfm/thread-mention-display";
import { CodexThreadIcon, NfmSideMenuTableHeaderIcon } from "@/components/shared/icons";
import { CARD_STATUS_LABELS } from "../../../../shared/card-status";
import {
  buildDateMentionQueryMatches,
  isDateMentionQuery,
  type DateMentionQueryMatch,
} from "@/lib/nfm/date-mention";
import type { NfmDateMentionInlineContent } from "@/lib/nfm/types";
import { dateMentionPayloadToProps } from "./date-mention-chip";

interface NfmSlashMenuProps {
  projectId: string;
  allowCardReferences?: boolean;
}

type UnsafeEditor = Parameters<typeof insertOrUpdateBlockForSlashMenu>[0];
type UnsafeBlock = Parameters<typeof insertOrUpdateBlockForSlashMenu>[1];
export type NfmSuggestionItem = DefaultReactSuggestionItem & {
  key?: string;
  hint?: string | null;
  tooltipContent?: ReactNode | null;
};
type UnsafeInlineContentEditor = {
  insertInlineContent: (content: unknown[], options?: { updateSelection?: boolean }) => void;
};

const SUGGESTION_SYNTAX_HINT_BY_KEY: Record<string, string> = {
  paragraph: "text",
  heading: "#",
  heading_2: "##",
  heading_3: "###",
  heading_4: "####",
  heading_5: "#####",
  heading_6: "######",
  toggle_heading: "> #",
  toggle_heading_2: "> ##",
  toggle_heading_3: "> ###",
  quote: ">",
  toggle_list: ">",
  numbered_list: "1.",
  bullet_list: "-",
  check_list: "[]",
  code_block: "```",
  divider: "---",
  table: "table",
  image: "image",
  video: "video",
  audio: "audio",
  file: "file",
  emoji: ":",
};

export const NFM_SUGGESTION_MENU_CONTROLLER_PORTAL_PROPS = {
  portalElement: NFM_SUGGESTION_MENU_PORTAL_ELEMENT,
  floatingUIOptions: NFM_SUGGESTION_MENU_FLOATING_OPTIONS,
} as const;

function insertBlock(editor: unknown, block: Record<string, unknown>) {
  insertOrUpdateBlockForSlashMenu(editor as UnsafeEditor, block as UnsafeBlock);
}

function insertInlineContent(editor: unknown, content: unknown[]) {
  (editor as UnsafeInlineContentEditor).insertInlineContent(content, { updateSelection: true });
}

function createDefaultNfmTableBlock() {
  return {
    type: "table",
    content: {
      type: "tableContent",
      columnWidths: [undefined, undefined],
      rows: Array.from({ length: 3 }, () => ({
        cells: Array.from({ length: 2 }, () => ({
          type: "tableCell",
          props: {
            backgroundColor: "default",
            textColor: "default",
            textAlignment: "left",
          },
          content: [],
        })),
      })),
    },
    children: [],
  };
}

function normalizeSuggestionAliasHint(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("/") || trimmed.startsWith("@") || trimmed.startsWith(":")) return trimmed;
  if (trimmed.includes(" ")) return null;
  return `/${trimmed}`;
}

export function scrollElementIntoContainerView(container: HTMLElement, element: HTMLElement) {
  const containerHeight = container.clientHeight;
  if (containerHeight <= 0) return;

  const containerRect = container.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  const elementTop = elementRect.top - containerRect.top + container.scrollTop;
  const rectHeight = elementRect.height || elementRect.bottom - elementRect.top;
  const elementHeight = Math.max(rectHeight || element.offsetHeight, 0);
  const elementBottom = elementTop + elementHeight;
  const visibleTop = container.scrollTop;
  const visibleBottom = visibleTop + containerHeight;

  if (elementHeight >= containerHeight) {
    if (elementTop < visibleTop || elementTop > visibleBottom) {
      container.scrollTop = elementTop;
    }
    return;
  }

  if (elementTop < visibleTop) {
    container.scrollTop = elementTop;
    return;
  }

  if (elementBottom > visibleBottom) {
    container.scrollTop = elementBottom - containerHeight;
  }
}

export function resolveNfmSuggestionHint(item: DefaultReactSuggestionItem) {
  const nfmItem = item as NfmSuggestionItem;
  if (nfmItem.hint !== undefined) {
    const explicitHint = nfmItem.hint?.trim();
    return explicitHint || null;
  }

  const key = nfmItem.key;
  if (key) {
    const syntaxHint = SUGGESTION_SYNTAX_HINT_BY_KEY[key];
    if (syntaxHint) return syntaxHint;
  }

  if (item.badge?.trim()) return item.badge.trim();

  const aliasHint = item.aliases?.map(normalizeSuggestionAliasHint).find((value): value is string => value !== null);
  if (aliasHint) return aliasHint;

  return null;
}

function resolveSuggestionTooltipContent(item: DefaultReactSuggestionItem) {
  const tooltipContent = (item as NfmSuggestionItem).tooltipContent;
  if (tooltipContent !== undefined) return tooltipContent;

  if (!item.subtext) return null;

  return (
    <div className="max-w-64 text-sm leading-5 text-token-foreground">
      {item.subtext}
    </div>
  );
}

export function NfmSuggestionMenuSurface({
  items,
  loadingState,
  itemsStale = false,
  selectedIndex,
  onItemClick,
}: SuggestionMenuProps<DefaultReactSuggestionItem>) {
  const loading = loadingState === "loading-initial" || loadingState === "loading";
  const listRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (selectedIndex === undefined) return;

    const list = listRef.current;
    if (!list) return;

    const item = list.querySelector<HTMLElement>(`#bn-suggestion-menu-item-${selectedIndex}`);
    if (!item) return;

    scrollElementIntoContainerView(list, item);
  }, [selectedIndex]);

  const renderedItems = useMemo(() => {
    let currentGroup: string | undefined;

    return items.flatMap((item, index) => {
      const nodes = [];
      const group = item.group?.trim();

      if (group && group !== currentGroup) {
        currentGroup = group;
        nodes.push(
          <NodexDropdownSectionLabel
            key={`group:${group}:${index}`}
            className="pb-0.5 pt-1.5 text-xs leading-4 text-token-description-foreground"
          >
            {group}
          </NodexDropdownSectionLabel>,
        );
      }

      const selected = selectedIndex === index;
      const hint = resolveNfmSuggestionHint(item);
      const row = (
        <NodexDropdownActionRow
          id={`bn-suggestion-menu-item-${index}`}
          role="option"
          aria-selected={selected}
          data-selected={selected || undefined}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onItemClick?.(item)}
          className={cn(
            "min-h-7 items-center gap-2 px-2 py-1 text-left opacity-85",
            "data-[selected=true]:bg-token-list-hover-background data-[selected=true]:opacity-100",
            "hover:opacity-100",
          )}
        >
          {item.icon ? (
            <span className="flex size-5 shrink-0 items-center justify-center text-token-description-foreground [&_svg]:size-3.5">
              {item.icon}
            </span>
          ) : null}
          <span className="min-w-0 flex-1 truncate text-sm leading-4 text-token-foreground">
            {item.title}
          </span>
          {hint ? (
            <span
              aria-label={`Shortcut ${hint}`}
              className="ml-2 shrink-0 rounded-sm px-1 text-xs leading-4 text-token-description-foreground"
            >
              {hint}
            </span>
          ) : null}
        </NodexDropdownActionRow>
      );
      const tooltipContent = resolveSuggestionTooltipContent(item);

      nodes.push(
        <NodexTooltip
          key={`${item.title}:${index}`}
          tooltipContent={tooltipContent}
          disabled={!tooltipContent}
          side="right"
          align="start"
          sideOffset={6}
          tooltipBodyClassName="min-w-0"
          style={{ zIndex: NFM_SUGGESTION_MENU_TOOLTIP_Z_INDEX }}
        >
          {row}
        </NodexTooltip>,
      );

      return nodes;
    });
  }, [items, onItemClick, selectedIndex]);

  return (
    <NodexDropdownSurface
      id="bn-suggestion-menu"
      role="listbox"
      aria-busy={loading || itemsStale}
      className="w-[min(17.5rem,calc(100vw-16px))] overflow-hidden"
    >
      <NodexDropdownScrollList
        ref={listRef}
        data-nfm-suggestion-menu-scroll-list="true"
        className="scrollbar-token max-h-[min(18rem,calc(100vh-24px))] gap-0.5"
      >
        {renderedItems}
        {items.length === 0 ? (
          <NodexDropdownMessage compact centered>
            {loading ? "Loading..." : "No matching commands"}
          </NodexDropdownMessage>
        ) : itemsStale ? (
          <NodexDropdownMessage compact centered>
            Updating...
          </NodexDropdownMessage>
        ) : null}
      </NodexDropdownScrollList>
    </NodexDropdownSurface>
  );
}

export function getNfmSlashMenuCustomItems(
  editor: unknown,
  projectId: string,
  options: { readonly allowCardReferences?: boolean } = {},
): DefaultReactSuggestionItem[] {
  const allowCardReferences = options.allowCardReferences ?? true;
  const tableItem = {
    key: "table",
    title: "Table",
    subtext: "Insert a simple editable table",
    aliases: ["table", "grid"],
    group: "Basic blocks",
    badge: "/table",
    icon: <NfmSideMenuTableHeaderIcon className="size-4" />,
    onItemClick: () => {
      insertBlock(editor, createDefaultNfmTableBlock());
    },
  };

  const toggleListItem = {
    key: "toggle_list_inline_view",
    title: "Toggle List Inline View",
    subtext: "Embed a project's toggle-list section",
    aliases: ["toggle-list", "project view", "inline toggle"],
    group: "Others",
    badge: "/toggle-list",
    icon: <ListTree size={16} />,
    onItemClick: () => {
      insertBlock(editor, {
        type: "toggleListInlineView",
        props: getDefaultToggleListInlineViewProps(projectId || "default"),
      });
    },
  };

  const cardRefItem = {
    key: "card_reference",
    title: "Card Reference",
    subtext: "Embed a single card with inline editing",
    aliases: ["card", "card-reference", "card ref", "card-ref", "embed card"],
    group: "Others",
    badge: "/card",
    icon: <Link2 size={16} />,
    onItemClick: () => {
      insertBlock(editor, {
        type: "cardRef",
        props: { sourceProjectId: projectId || "default", cardId: "" },
      });
    },
  };

  const threadSectionItem = {
    key: "thread_section",
    title: "Thread Section",
    subtext: "Insert a runnable notebook-style prompt boundary",
    aliases: ["thread", "section", "prompt section", "cell"],
    group: "Others",
    badge: "/thread",
    icon: <SendHorizontal size={16} />,
    onItemClick: () => {
      insertBlock(editor, createEmptyThreadSectionBlock() as unknown as Record<string, unknown>);
    },
  };

  const agentConfigItem = {
    key: "agent_config",
    title: "Agent Config",
    subtext: "Insert a one-send plan-mode config chip",
    aliases: ["agent-config", "agent config", "plan", "plan mode", "mode", "model", "reasoning"],
    group: "Others",
    badge: "/agent-config",
    icon: <Settings2 size={16} />,
    onItemClick: () => {
      insertInlineContent(editor, [
        {
          type: "agentConfig",
          props: {
            mode: "plan",
            model: "",
            reasoning: "",
            unknownAttributes: "",
            rawAttributes: "",
          },
        },
        " ",
      ]);
    },
  };

  return [
    tableItem,
    ...(allowCardReferences ? [toggleListItem, cardRefItem] : []),
    threadSectionItem,
    agentConfigItem,
  ];
}

export function NfmSlashMenu({
  projectId,
  allowCardReferences = true,
}: NfmSlashMenuProps) {
  const editor = useBlockNoteEditor();

  const getItems = useMemo(
    () => async (query: string) => {
      const defaults = getDefaultReactSlashMenuItems(editor).filter((item) => {
        const key = (item as NfmSuggestionItem).key;
        return key !== "table" && item.title.toLocaleLowerCase() !== "table";
      });
      return filterSuggestionItems([
        ...defaults,
        ...getNfmSlashMenuCustomItems(editor, projectId, {
          allowCardReferences,
        }),
      ], query);
    },
    [allowCardReferences, editor, projectId],
  );

  return (
    <>
      <SuggestionMenuController
        triggerCharacter="/"
        getItems={getItems}
        {...NFM_SUGGESTION_MENU_CONTROLLER_PORTAL_PROPS}
        suggestionMenuComponent={NfmSuggestionMenuSurface}
      />
      <MentionMenu
        projectId={projectId}
        allowCardReferences={allowCardReferences}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// @ mention for cards and Codex threads
// ---------------------------------------------------------------------------

const CURRENT_PROJECT_MENTION_GROUP = "Current project";
const DATE_MENTION_GROUP = "Dates";
const REMINDER_MENTION_GROUP = "Reminders";
const CHAT_MENTION_GROUP = "Chats";
const CARD_MENTION_GROUP = "Cards";

type ThreadMentionSubtextInput = {
  threadId: string;
  projectId: string | null;
  projectName?: string | null;
  statusType: string;
  statusActiveFlags: readonly string[];
  archived?: boolean;
};

function resolveMentionSearchPreviewExcerpt(
  searchPreview: CommandPaletteCard["searchPreview"] | CommandPaletteThread["searchPreview"] | undefined,
): string | null {
  const excerpt = searchPreview?.excerpt?.replace(/\s+/g, " ").trim();
  return excerpt || null;
}

function appendMentionSearchPreviewSubtext(
  baseSubtext: string,
  searchPreview: CommandPaletteCard["searchPreview"] | CommandPaletteThread["searchPreview"] | undefined,
): string {
  const excerpt = resolveMentionSearchPreviewExcerpt(searchPreview);
  if (!excerpt) return baseSubtext;
  return `${baseSubtext} / ${excerpt}`;
}

function buildMentionTooltipContent(
  contextText: string,
  searchPreview: CommandPaletteCard["searchPreview"] | CommandPaletteThread["searchPreview"] | undefined,
): ReactNode {
  const excerpt = resolveMentionSearchPreviewExcerpt(searchPreview);
  if (!contextText && !excerpt) return null;

  return (
    <div className="max-w-72 space-y-1 text-sm leading-5">
      {contextText ? (
        <div className="text-token-foreground">
          {contextText}
        </div>
      ) : null}
      {excerpt ? (
        <div className="text-token-description-foreground">
          {excerpt}
        </div>
      ) : null}
    </div>
  );
}

function resolveThreadMentionTitle(thread: CommandPaletteThread): string {
  const title = thread.title.trim();
  if (title) return title;

  const firstPreviewLine = thread.preview
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return firstPreviewLine || formatThreadMentionShortUuid(thread.threadId);
}

function resolveThreadMentionStateLabel(thread: Pick<ThreadMentionSubtextInput, "archived" | "statusType" | "statusActiveFlags">): string {
  if (thread.archived) return "Archived";
  if (thread.statusType === "systemError") return "Error";
  if (thread.statusActiveFlags.includes("waitingOnApproval")) return "Needs approval";
  if (thread.statusActiveFlags.includes("waitingOnUserInput")) return "Waiting";
  if (thread.statusType === "active") return "Running";
  return "";
}

export function resolveThreadMentionSubtext(thread: ThreadMentionSubtextInput, project: Pick<Project, "id" | "name"> | null): string {
  const projectLabel = project?.name?.trim()
    || project?.id
    || thread.projectName?.trim()
    || thread.projectId
    || "Chats";
  const stateLabel = resolveThreadMentionStateLabel(thread);
  return [projectLabel, stateLabel, formatThreadMentionShortUuid(thread.threadId)]
    .filter(Boolean)
    .join(" / ");
}

function resolveCardMentionContext(item: CommandPaletteCard): string {
  const columnName = item.columnName.trim();
  const stateLabel = CARD_STATUS_LABELS[item.card.status];
  const shouldShowStateLabel = normalizeMentionContextPart(columnName) !== normalizeMentionContextPart(stateLabel);

  return [item.projectName, columnName, shouldShowStateLabel ? stateLabel : ""]
    .filter(Boolean)
    .join(" / ");
}

function normalizeMentionContextPart(value: string): string {
  return value.trim().replace(/[_\s-]+/g, " ").toLowerCase();
}

function resolveCardMentionSubtext(item: CommandPaletteCard): string {
  return appendMentionSearchPreviewSubtext(resolveCardMentionContext(item), item.searchPreview);
}

function resolveThreadMentionContext(item: CommandPaletteThread): string {
  const projectLabel = item.projectName?.trim() || (item.projectless ? "Projectless chat" : CHAT_MENTION_GROUP);
  const stateLabel = resolveThreadMentionStateLabel(item);
  return [projectLabel, stateLabel].filter(Boolean).join(" / ");
}

function resolveCommandPaletteThreadMentionSubtext(item: CommandPaletteThread): string {
  return appendMentionSearchPreviewSubtext(
    resolveThreadMentionContext(item),
    item.searchPreview,
  );
}

export function buildNfmCardMentionBlock(item: CommandPaletteCard): Record<string, unknown> {
  return {
    type: "cardRef",
    props: { sourceProjectId: item.projectId, cardId: item.card.id },
  };
}

export function buildNfmThreadMentionInlineContent(item: CommandPaletteThread): unknown[] {
  return [
    {
      type: "threadMention",
      props: { uuid: item.threadId },
    },
    " ",
  ];
}

export function buildNfmDateMentionInlineContent(payload: NfmDateMentionInlineContent): unknown[] {
  return [
    {
      type: "dateMention",
      props: dateMentionPayloadToProps(payload),
    },
    " ",
  ];
}

export function buildNfmDateMentionSuggestionItem(
  editor: unknown,
  match: DateMentionQueryMatch,
): NfmSuggestionItem {
  const isReminder = match.group === "Reminders";
  const Icon = isReminder ? Bell : match.key === "date:now" ? Clock : CalendarDays;
  return {
    key: match.key,
    title: match.title,
    subtext: match.subtext,
    aliases: match.aliases,
    group: isReminder ? REMINDER_MENTION_GROUP : DATE_MENTION_GROUP,
    hint: match.aliases[0] ? `@${match.aliases[0]}` : "@date",
    tooltipContent: (
      <div className="max-w-64 text-sm leading-5 text-token-foreground">
        {match.subtext}
      </div>
    ),
    icon: <Icon className="size-4" aria-hidden="true" />,
    onItemClick: () => {
      insertInlineContent(editor, buildNfmDateMentionInlineContent(match.payload));
    },
  };
}

export function buildNfmDateMentionSuggestionItems(
  editor: unknown,
  query: string,
  now = new Date(),
): NfmSuggestionItem[] {
  return buildDateMentionQueryMatches(query, now).map((match) =>
    buildNfmDateMentionSuggestionItem(editor, match),
  );
}

export function buildNfmCardMentionSuggestionItem(
  editor: unknown,
  item: CommandPaletteCard,
  options: { group?: string } = {},
): NfmSuggestionItem {
  const contextText = resolveCardMentionContext(item);
  return {
    title: item.card.title || "Untitled",
    subtext: resolveCardMentionSubtext(item),
    aliases: [],
    group: options.group ?? CARD_MENTION_GROUP,
    hint: null,
    tooltipContent: buildMentionTooltipContent(contextText, item.searchPreview),
    icon: <FileText className="size-4" aria-hidden="true" />,
    onItemClick: () => {
      insertBlock(editor, buildNfmCardMentionBlock(item));
    },
  };
}

export function buildNfmThreadMentionSuggestionItem(
  editor: unknown,
  item: CommandPaletteThread,
  options: { group?: string } = {},
): NfmSuggestionItem {
  const contextText = resolveThreadMentionContext(item);
  return {
    title: resolveThreadMentionTitle(item),
    subtext: resolveCommandPaletteThreadMentionSubtext(item),
    aliases: [],
    group: options.group ?? CHAT_MENTION_GROUP,
    hint: null,
    tooltipContent: buildMentionTooltipContent(contextText, item.searchPreview),
    icon: <CodexThreadIcon className="size-4" />,
    onItemClick: () => {
      insertInlineContent(editor, buildNfmThreadMentionInlineContent(item));
    },
  };
}

function partitionMentionResultsByActiveProject<T extends { inActiveProject: boolean }>(
  items: readonly T[],
): { activeProjectItems: T[]; otherItems: T[] } {
  const activeProjectItems: T[] = [];
  const otherItems: T[] = [];

  items.forEach((item) => {
    if (item.inActiveProject) {
      activeProjectItems.push(item);
      return;
    }

    otherItems.push(item);
  });

  return { activeProjectItems, otherItems };
}

export function buildNfmMentionSuggestionItems({
  editor,
  query = "",
  cardResults,
  threadResults,
}: {
  editor: unknown;
  query?: string;
  cardResults: readonly CommandPaletteCard[];
  threadResults: readonly CommandPaletteThread[];
}): DefaultReactSuggestionItem[] {
  const {
    activeProjectItems: activeProjectThreads,
    otherItems: otherThreads,
  } = partitionMentionResultsByActiveProject(threadResults);
  const {
    activeProjectItems: activeProjectCards,
    otherItems: otherCards,
  } = partitionMentionResultsByActiveProject(cardResults);
  const currentProjectItems = [
    ...activeProjectThreads.map((item) => buildNfmThreadMentionSuggestionItem(
      editor,
      item,
      { group: CURRENT_PROJECT_MENTION_GROUP },
    )),
    ...activeProjectCards.map((item) => buildNfmCardMentionSuggestionItem(
      editor,
      item,
      { group: CURRENT_PROJECT_MENTION_GROUP },
    )),
  ];
  const dateItems = buildNfmDateMentionSuggestionItems(editor, query);
  const otherMentionItems = [
    ...otherThreads.map((item) => buildNfmThreadMentionSuggestionItem(
      editor,
      item,
      { group: CHAT_MENTION_GROUP },
    )),
    ...otherCards.map((item) => buildNfmCardMentionSuggestionItem(
      editor,
      item,
      { group: CARD_MENTION_GROUP },
    )),
  ];

  return isDateMentionQuery(query)
    ? [...dateItems, ...currentProjectItems, ...otherMentionItems]
    : [...currentProjectItems, ...dateItems, ...otherMentionItems];
}

interface NfmMentionSearchState {
  editor: unknown;
  cardItems: CommandPaletteCard[];
  cardSearchIndex: ReturnType<typeof useCommandPaletteCardSearchIndex>;
  projectIdsForCardSearch: string[];
}

export interface NfmMentionGetItemsLoaders {
  searchCardDescriptions: typeof searchCommandPaletteCardDescriptions;
  listThreadItems: typeof listCommandPaletteThreadItems;
  searchThreadContent: typeof searchCommandPaletteThreadContent;
  selectCardResults: typeof selectCommandPaletteCardResults;
  selectChatResults: typeof selectCommandPaletteChatResults;
  createThreadSearchIndex: typeof createCommandPaletteThreadSearchIndex;
}

interface NfmMentionGetItemsInput {
  editor: unknown;
  projectId: string;
  cardItems: CommandPaletteCard[];
  cardSearchIndex: ReturnType<typeof useCommandPaletteCardSearchIndex>;
  projectIdsForCardSearch: string[];
  loaders?: NfmMentionGetItemsLoaders;
}

const DEFAULT_NFM_MENTION_GET_ITEMS_LOADERS: NfmMentionGetItemsLoaders = {
  searchCardDescriptions: searchCommandPaletteCardDescriptions,
  listThreadItems: listCommandPaletteThreadItems,
  searchThreadContent: searchCommandPaletteThreadContent,
  selectCardResults: selectCommandPaletteCardResults,
  selectChatResults: selectCommandPaletteChatResults,
  createThreadSearchIndex: createCommandPaletteThreadSearchIndex,
};

type NfmCardDescriptionSearchResults = Awaited<
  ReturnType<NfmMentionGetItemsLoaders["searchCardDescriptions"]>
>;

type NfmThreadContentSearchResults = Awaited<
  ReturnType<NfmMentionGetItemsLoaders["searchThreadContent"]>
>;

interface NfmMentionAsyncSearchResults {
  key: string;
  cardDescriptionSearchResults?: NfmCardDescriptionSearchResults;
  threadContentSearchResults?: NfmThreadContentSearchResults;
}

function buildNfmMentionAsyncSearchKey({
  activeProjectId,
  projectIdsForCardSearch,
  query,
}: {
  activeProjectId: string;
  projectIdsForCardSearch: readonly string[];
  query: string;
}) {
  return JSON.stringify([
    activeProjectId,
    projectIdsForCardSearch,
    query,
  ]);
}

export function useNfmMentionGetItems({
  editor,
  projectId,
  cardItems,
  cardSearchIndex,
  projectIdsForCardSearch,
  loaders = DEFAULT_NFM_MENTION_GET_ITEMS_LOADERS,
}: NfmMentionGetItemsInput): (query: string) => Promise<DefaultReactSuggestionItem[]> {
  const [asyncRefreshKey, setAsyncRefreshKey] = useState(0);
  const threadItemsRef = useRef<{ activeProjectId: string; items: CommandPaletteThread[] } | null>(null);
  const threadLoadPromiseRef = useRef<{ activeProjectId: string; promise: Promise<CommandPaletteThread[]> } | null>(null);
  const threadSearchIndexRef = useRef<{
    activeProjectId: string;
    items: CommandPaletteThread[];
    index: ReturnType<typeof createCommandPaletteThreadSearchIndex>;
  } | null>(null);
  const asyncSearchResultsRef = useRef<NfmMentionAsyncSearchResults | null>(null);
  const latestAsyncSearchKeyRef = useRef<string | null>(null);
  const cardDescriptionSearchRequestRef = useRef<{ key: string; id: number } | null>(null);
  const threadContentSearchRequestRef = useRef<{ key: string; id: number } | null>(null);
  const asyncRequestIdRef = useRef(0);
  const projectIdRef = useRef(projectId);
  const loadersRef = useRef(loaders);
  const searchStateRef = useRef<NfmMentionSearchState>({
    editor,
    cardItems,
    cardSearchIndex,
    projectIdsForCardSearch,
  });

  projectIdRef.current = projectId;
  loadersRef.current = loaders;
  searchStateRef.current = {
    editor,
    cardItems,
    cardSearchIndex,
    projectIdsForCardSearch,
  };

  const bumpAsyncRefresh = useCallback(() => {
    startTransition(() => {
      setAsyncRefreshKey((current) => current + 1);
    });
  }, []);

  const loadThreadItems = useCallback(() => {
    const activeProjectId = projectIdRef.current;
    const cachedThreads = threadItemsRef.current;
    if (cachedThreads?.activeProjectId === activeProjectId) {
      return Promise.resolve(cachedThreads.items);
    }

    const inFlight = threadLoadPromiseRef.current;
    if (inFlight?.activeProjectId === activeProjectId) {
      return inFlight.promise;
    }

    const promise = loadersRef.current.listThreadItems({ activeProjectId })
      .catch(() => [])
      .then((items) => {
        if (projectIdRef.current !== activeProjectId) {
          return items;
        }

        threadItemsRef.current = { activeProjectId, items };
        bumpAsyncRefresh();
        return items;
      })
      .finally(() => {
        const current = threadLoadPromiseRef.current;
        if (current?.activeProjectId !== activeProjectId) return;
        threadLoadPromiseRef.current = null;
      });
    threadLoadPromiseRef.current = { activeProjectId, promise };
    return promise;
  }, [bumpAsyncRefresh]);

  const getThreadSearchIndex = useCallback((threadItems: CommandPaletteThread[]) => {
    const activeProjectId = projectIdRef.current;
    const cachedIndex = threadSearchIndexRef.current;
    if (cachedIndex?.activeProjectId === activeProjectId && cachedIndex.items === threadItems) {
      return cachedIndex.index;
    }

    const index = loadersRef.current.createThreadSearchIndex(threadItems);
    threadSearchIndexRef.current = {
      activeProjectId,
      items: threadItems,
      index,
    };
    return index;
  }, []);

  const ensureAsyncSearches = useCallback(({
    projectIdsForCardSearch: currentProjectIdsForCardSearch,
    query,
    requestKey,
  }: {
    projectIdsForCardSearch: readonly string[];
    query: string;
    requestKey: string;
  }) => {
    const queryText = query.trimStart().trim();
    if (queryText.length === 0) {
      return;
    }

    if (asyncSearchResultsRef.current?.key !== requestKey) {
      asyncSearchResultsRef.current = { key: requestKey };
    }

    const currentResults = asyncSearchResultsRef.current;
    if (!currentResults) {
      return;
    }

    const currentLoaders = loadersRef.current;

    if (
      currentProjectIdsForCardSearch.length > 0 &&
      currentResults.cardDescriptionSearchResults === undefined &&
      cardDescriptionSearchRequestRef.current?.key !== requestKey
    ) {
      const requestId = asyncRequestIdRef.current + 1;
      asyncRequestIdRef.current = requestId;
      cardDescriptionSearchRequestRef.current = { key: requestKey, id: requestId };

      void currentLoaders.searchCardDescriptions({
        projectIds: currentProjectIdsForCardSearch,
        query,
      })
        .then((results) => {
          if (
            latestAsyncSearchKeyRef.current !== requestKey ||
            cardDescriptionSearchRequestRef.current?.id !== requestId
          ) {
            return;
          }

          asyncSearchResultsRef.current = {
            ...(asyncSearchResultsRef.current?.key === requestKey
              ? asyncSearchResultsRef.current
              : { key: requestKey }),
            key: requestKey,
            cardDescriptionSearchResults: results,
          };
          bumpAsyncRefresh();
        })
        .catch(() => {
          if (
            latestAsyncSearchKeyRef.current !== requestKey ||
            cardDescriptionSearchRequestRef.current?.id !== requestId
          ) {
            return;
          }

          asyncSearchResultsRef.current = {
            ...(asyncSearchResultsRef.current?.key === requestKey
              ? asyncSearchResultsRef.current
              : { key: requestKey }),
            key: requestKey,
            cardDescriptionSearchResults: [],
          };
          bumpAsyncRefresh();
        });
    }

    if (
      currentResults.threadContentSearchResults === undefined &&
      threadContentSearchRequestRef.current?.key !== requestKey
    ) {
      const requestId = asyncRequestIdRef.current + 1;
      asyncRequestIdRef.current = requestId;
      threadContentSearchRequestRef.current = { key: requestKey, id: requestId };

      void currentLoaders.searchThreadContent({ query })
        .then((results) => {
          if (
            latestAsyncSearchKeyRef.current !== requestKey ||
            threadContentSearchRequestRef.current?.id !== requestId
          ) {
            return;
          }

          asyncSearchResultsRef.current = {
            ...(asyncSearchResultsRef.current?.key === requestKey
              ? asyncSearchResultsRef.current
              : { key: requestKey }),
            key: requestKey,
            threadContentSearchResults: results,
          };
          bumpAsyncRefresh();
        })
        .catch(() => {
          if (
            latestAsyncSearchKeyRef.current !== requestKey ||
            threadContentSearchRequestRef.current?.id !== requestId
          ) {
            return;
          }

          asyncSearchResultsRef.current = {
            ...(asyncSearchResultsRef.current?.key === requestKey
              ? asyncSearchResultsRef.current
              : { key: requestKey }),
            key: requestKey,
            threadContentSearchResults: [],
          };
          bumpAsyncRefresh();
        });
    }
  }, [bumpAsyncRefresh]);

  return useCallback(
    async (query: string) => {
      void asyncRefreshKey;

      const {
        editor: currentEditor,
        cardItems: currentCardItems,
        cardSearchIndex: currentCardSearchIndex,
        projectIdsForCardSearch: currentProjectIdsForCardSearch,
      } = searchStateRef.current;
      const currentLoaders = loadersRef.current;
      const activeProjectId = projectIdRef.current;
      const requestKey = buildNfmMentionAsyncSearchKey({
        activeProjectId,
        projectIdsForCardSearch: currentProjectIdsForCardSearch,
        query,
      });
      latestAsyncSearchKeyRef.current = requestKey;

      void loadThreadItems();
      ensureAsyncSearches({
        projectIdsForCardSearch: currentProjectIdsForCardSearch,
        query,
        requestKey,
      });

      const asyncResults = asyncSearchResultsRef.current?.key === requestKey
        ? asyncSearchResultsRef.current
        : undefined;
      const cachedThreads = threadItemsRef.current?.activeProjectId === activeProjectId
        ? threadItemsRef.current.items
        : [];
      const cardDescriptionSearchScopeKey = buildCommandPaletteCardDescriptionSearchScopeKey(currentProjectIdsForCardSearch);
      const cardDescriptionSearchBatch: CommandPaletteCardDescriptionSearchBatch | undefined =
        asyncResults?.cardDescriptionSearchResults
          ? {
            query,
            scopeKey: cardDescriptionSearchScopeKey,
            results: asyncResults.cardDescriptionSearchResults,
            loading: false,
          }
          : undefined;
      const threadContentSearchBatch: CommandPaletteThreadContentSearchBatch | undefined =
        asyncResults?.threadContentSearchResults
          ? {
            query,
            results: asyncResults.threadContentSearchResults,
            loading: false,
          }
          : undefined;
      const cardResults = currentLoaders.selectCardResults({
        query,
        cards: currentCardItems,
        cardSearchIndex: currentCardSearchIndex,
        cardDescriptionSearchBatch,
        cardDescriptionSearchScopeKey,
        metadataCardLimit: 24,
        mergedCardLimit: 24,
        preferActiveProject: true,
      });
      const threadResults = currentLoaders.selectChatResults({
        query,
        threads: cachedThreads,
        threadSearchIndex: getThreadSearchIndex(cachedThreads),
        threadContentSearchBatch,
        threadLimit: 24,
        preferActiveProject: true,
      });

      return buildNfmMentionSuggestionItems({
        editor: currentEditor,
        query,
        cardResults,
        threadResults,
      });
    },
    [asyncRefreshKey, ensureAsyncSearches, getThreadSearchIndex, loadThreadItems],
  );
}

function MentionMenu({
  projectId,
  allowCardReferences,
}: {
  projectId: string;
  allowCardReferences: boolean;
}) {
  const editor = useBlockNoteEditor();
  const { boards, projects } = useAllBoards();
  const cardItems = useMemo(
    () => allowCardReferences
      ? buildCommandPaletteCardItemsFromBoardSummaries({
          projects,
          boardMap: boards,
          activeProjectId: projectId,
        })
      : [],
    [allowCardReferences, boards, projectId, projects],
  );
  const cardSearchIndex = useCommandPaletteCardSearchIndex(cardItems);
  const projectIdsForCardSearch = useMemo(
    () => allowCardReferences
      ? projects.map((project) => project.id)
      : [],
    [allowCardReferences, projects],
  );
  const getItems = useNfmMentionGetItems({
    editor,
    projectId,
    cardItems,
    cardSearchIndex,
    projectIdsForCardSearch,
  });

  return (
    <SuggestionMenuController
      triggerCharacter="@"
      getItems={getItems}
      {...NFM_SUGGESTION_MENU_CONTROLLER_PORTAL_PROPS}
      suggestionMenuComponent={NfmSuggestionMenuSurface}
    />
  );
}
