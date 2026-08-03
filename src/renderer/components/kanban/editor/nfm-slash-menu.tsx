import {
  startTransition,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  filterSuggestionItems,
  insertOrUpdateBlockForSlashMenu,
} from "@blocknote/core/extensions";
import {
  SuggestionMenuController,
  getDefaultReactSlashMenuItems,
  useBlockNoteEditor,
  type DefaultReactSuggestionItem,
  type SuggestionMenuProps,
} from "@blocknote/react";
import { SendHorizontal, Settings2 } from "@/components/shared/icons/generic-icons";
import { PageIcon } from "@/components/shared/icons";
import {
  NodexDropdownActionRow,
  NodexDropdownMessage,
  NodexDropdownScrollList,
  NodexDropdownSectionLabel,
  NodexDropdownSurface,
} from "@/components/ui/dropdown";
import { NodexTooltip } from "@/components/ui/tooltip";
import { useProjects } from "@/lib/use-projects";
import type { Project } from "@/lib/types";
import { cn } from "@/lib/utils";
import type {
  CommandPalettePage,
  CommandPaletteThread,
} from "@/lib/command-palette";
import {
  buildCommandPalettePageDescriptionSearchScopeKey,
  searchCommandPalettePageDescriptions,
  selectCommandPalettePageResults,
  type CommandPalettePageDescriptionSearchBatch,
} from "@/lib/command-palette-page-results";
import {
  listCommandPaletteThreadItems,
  searchCommandPaletteThreads,
  selectCommandPaletteChatResults,
  type CommandPaletteThreadSearchBatch,
} from "@/lib/command-palette-chat-search";
import { createCommandPaletteThreadSearchIndex } from "@/lib/command-palette-thread-search";
import { useCommandPalettePageSearchIndex } from "@/lib/use-command-palette-page-search-index";
import {
  NFM_SUGGESTION_MENU_FLOATING_OPTIONS,
  NFM_SUGGESTION_MENU_PORTAL_ELEMENT,
  NFM_SUGGESTION_MENU_TOOLTIP_Z_INDEX,
} from "./nfm-blocknote-floating-ui";
import { createEmptyThreadSectionBlock } from "./thread-section";
import { formatThreadMentionShortUuid } from "@/lib/nfm/thread-mention-display";
import {
  ThreadIcon,
  NfmSideMenuTableHeaderIcon,
  BellIcon,
  CalendarIcon,
  ClockIcon,
  CanvasIcon,
} from "@/components/shared/icons";
import { WORKFLOW_STATUS_LABELS } from "../../../../shared/workflow-status";
import {
  buildDateMentionQueryMatches,
  isDateMentionQuery,
  type DateMentionQueryMatch,
} from "@/lib/nfm/date-mention";
import type { NfmDateMentionInlineContent } from "@/lib/nfm/types";
import { dateMentionPayloadToProps } from "./date-mention-chip";
import { useBlockReferenceHostRuntime } from "@/components/block-documents/block-reference-runtime-context";
import { toast } from "@/components/ui/toast";
import { setCanvasCreatePending } from "./canvas-create-pending-extension";

interface NfmSlashMenuProps {
  projectId: string;
  allowPageReferences?: boolean;
}

type UnsafeEditor = Parameters<typeof insertOrUpdateBlockForSlashMenu>[0];
type UnsafeBlock = Parameters<typeof insertOrUpdateBlockForSlashMenu>[1];
export type NfmSuggestionItem = DefaultReactSuggestionItem & {
  key?: string;
  hint?: string | null;
  tooltipContent?: ReactNode | null;
};
type UnsafeInlineContentEditor = {
  insertInlineContent: (
    content: unknown[],
    options?: { updateSelection?: boolean },
  ) => void;
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
  (editor as UnsafeInlineContentEditor).insertInlineContent(content, {
    updateSelection: true,
  });
}

type CanvasSlashEditor = UnsafeEditor & {
  getTextCursorPosition: () => {
    readonly block?: {
      readonly id?: string;
      readonly type?: string;
    };
  };
};

export function prepareCanvasCreateParagraph(editor: unknown): string {
  insertOrUpdateBlockForSlashMenu(
    editor as UnsafeEditor,
    { type: "paragraph" } as UnsafeBlock,
  );
  const block = (editor as CanvasSlashEditor).getTextCursorPosition().block;
  if (!block?.id || block.type !== "paragraph") {
    throw new Error("Choose an empty paragraph to create a Canvas.");
  }
  return block.id;
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
  if (
    trimmed.startsWith("/") ||
    trimmed.startsWith("@") ||
    trimmed.startsWith(":")
  )
    return trimmed;
  if (trimmed.includes(" ")) return null;
  return `/${trimmed}`;
}

export function scrollElementIntoContainerView(
  container: HTMLElement,
  element: HTMLElement,
) {
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

  const aliasHint = item.aliases
    ?.map(normalizeSuggestionAliasHint)
    .find((value): value is string => value !== null);
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
  const loading =
    loadingState === "loading-initial" || loadingState === "loading";
  const listRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (selectedIndex === undefined) return;

    const list = listRef.current;
    if (!list) return;

    const item = list.querySelector<HTMLElement>(
      `#bn-suggestion-menu-item-${selectedIndex}`,
    );
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
  createCanvasAtEmptyParagraph?: (input: {
    readonly blockId: string;
    readonly displayName?: string;
  }) => Promise<{ readonly canvasBlockId: string }>,
): DefaultReactSuggestionItem[] {
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

  const threadSectionItem = {
    key: "thread_section",
    title: "Thread Section",
    subtext: "Insert a runnable notebook-style prompt boundary",
    aliases: ["thread", "section", "prompt section", "cell"],
    group: "Others",
    badge: "/thread",
    icon: <SendHorizontal size={16} />,
    onItemClick: () => {
      insertBlock(
        editor,
        createEmptyThreadSectionBlock() as unknown as Record<string, unknown>,
      );
    },
  };

  const agentConfigItem = {
    key: "agent_config",
    title: "Agent Config",
    subtext: "Insert a one-send plan-mode config chip",
    aliases: [
      "agent-config",
      "agent config",
      "plan",
      "plan mode",
      "mode",
      "model",
      "reasoning",
    ],
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

  const canvasItem = createCanvasAtEmptyParagraph
    ? {
        key: "canvas",
        title: "Canvas",
        subtext: "Create an independent Canvas in this Page",
        aliases: ["canvas", "whiteboard", "drawing"],
        group: "Basic blocks",
        badge: "/canvas",
        icon: <CanvasIcon className="icon-xs" />,
        onItemClick: () => {
          void (async () => {
            let blockId: string | null = null;
            try {
              blockId = prepareCanvasCreateParagraph(editor);
              setCanvasCreatePending(
                editor as Parameters<typeof setCanvasCreatePending>[0],
                blockId,
                true,
              );
              await createCanvasAtEmptyParagraph({ blockId });
            } catch (error) {
              if (blockId) {
                setCanvasCreatePending(
                  editor as Parameters<typeof setCanvasCreatePending>[0],
                  blockId,
                  false,
                );
              }
              toast.danger(
                error instanceof Error
                  ? error.message
                  : "Could not create Canvas",
              );
            }
          })();
        },
      }
    : null;

  return [
    tableItem,
    ...(canvasItem ? [canvasItem] : []),
    threadSectionItem,
    agentConfigItem,
  ];
}

export function NfmSlashMenu({
  projectId,
  allowPageReferences = true,
}: NfmSlashMenuProps) {
  const editor = useBlockNoteEditor();
  const hostRuntime = useBlockReferenceHostRuntime();

  const getItems = useMemo(
    () => async (query: string) => {
      const defaults = getDefaultReactSlashMenuItems(editor).filter((item) => {
        const key = (item as NfmSuggestionItem).key;
        return key !== "table" && item.title.toLocaleLowerCase() !== "table";
      });
      return filterSuggestionItems(
        [
          ...defaults,
          ...getNfmSlashMenuCustomItems(
            editor,
            hostRuntime?.createCanvasAtEmptyParagraph,
          ),
        ],
        query,
      );
    },
    [editor, hostRuntime?.createCanvasAtEmptyParagraph],
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
        allowPageReferences={allowPageReferences}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// @ mention for pages and Codex threads
// ---------------------------------------------------------------------------

const CURRENT_PROJECT_MENTION_GROUP = "Current project";
const DATE_MENTION_GROUP = "Dates";
const REMINDER_MENTION_GROUP = "Reminders";
const CHAT_MENTION_GROUP = "Chats";
const CARD_MENTION_GROUP = "Pages";

type ThreadMentionSubtextInput = Pick<
  CommandPaletteThread,
  "threadId" | "projectId" | "statusType" | "statusActiveFlags"
> & Partial<Pick<CommandPaletteThread, "projectName">> & {
  archived?: boolean;
};

function resolveMentionSearchPreviewExcerpt(
  searchPreview:
    | CommandPalettePage["searchPreview"]
    | CommandPaletteThread["searchPreview"]
    | undefined,
): string | null {
  const excerpt = searchPreview?.excerpt?.replace(/\s+/g, " ").trim();
  return excerpt || null;
}

function appendMentionSearchPreviewSubtext(
  baseSubtext: string,
  searchPreview:
    | CommandPalettePage["searchPreview"]
    | CommandPaletteThread["searchPreview"]
    | undefined,
): string {
  const excerpt = resolveMentionSearchPreviewExcerpt(searchPreview);
  if (!excerpt) return baseSubtext;
  return `${baseSubtext} / ${excerpt}`;
}

function buildMentionTooltipContent(
  contextText: string,
  searchPreview:
    | CommandPalettePage["searchPreview"]
    | CommandPaletteThread["searchPreview"]
    | undefined,
): ReactNode {
  const excerpt = resolveMentionSearchPreviewExcerpt(searchPreview);
  if (!contextText && !excerpt) return null;

  return (
    <div className="max-w-72 space-y-1 text-sm leading-5">
      {contextText ? (
        <div className="text-token-foreground">{contextText}</div>
      ) : null}
      {excerpt ? (
        <div className="text-token-description-foreground">{excerpt}</div>
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

function resolveThreadMentionStateLabel(
  thread: Pick<
    ThreadMentionSubtextInput,
    "archived" | "statusType" | "statusActiveFlags"
  >,
): string {
  if (thread.archived) return "Archived";
  if (thread.statusType === "systemError") return "Error";
  if (thread.statusActiveFlags.includes("waitingOnApproval"))
    return "Needs approval";
  if (thread.statusActiveFlags.includes("waitingOnUserInput")) return "Waiting";
  if (thread.statusType === "active") return "Running";
  return "";
}

export function resolveThreadMentionSubtext(
  thread: ThreadMentionSubtextInput,
  project: Pick<Project, "id" | "name"> | null,
): string {
  const projectLabel =
    project?.name?.trim() ||
    project?.id ||
    thread.projectName?.trim() ||
    thread.projectId ||
    "Chats";
  const stateLabel = resolveThreadMentionStateLabel(thread);
  return [
    projectLabel,
    stateLabel,
    formatThreadMentionShortUuid(thread.threadId),
  ]
    .filter(Boolean)
    .join(" / ");
}

function resolvePageMentionContext(item: CommandPalettePage): string {
  const columnName = item.columnName.trim();
  const stateLabel = WORKFLOW_STATUS_LABELS[item.page.status];
  const shouldShowStateLabel =
    normalizeMentionContextPart(columnName) !==
    normalizeMentionContextPart(stateLabel);

  return [item.projectName, columnName, shouldShowStateLabel ? stateLabel : ""]
    .filter(Boolean)
    .join(" / ");
}

function normalizeMentionContextPart(value: string): string {
  return value
    .trim()
    .replace(/[_\s-]+/g, " ")
    .toLowerCase();
}

function resolvePageMentionSubtext(item: CommandPalettePage): string {
  return appendMentionSearchPreviewSubtext(
    resolvePageMentionContext(item),
    item.searchPreview,
  );
}

function resolveThreadMentionContext(item: CommandPaletteThread): string {
  const projectLabel =
    item.projectName?.trim() ||
    (item.projectless ? "Projectless chat" : CHAT_MENTION_GROUP);
  const stateLabel = resolveThreadMentionStateLabel(item);
  return [projectLabel, stateLabel].filter(Boolean).join(" / ");
}

function resolveCommandPaletteThreadMentionSubtext(
  item: CommandPaletteThread,
): string {
  return appendMentionSearchPreviewSubtext(
    resolveThreadMentionContext(item),
    item.searchPreview,
  );
}

export function buildNfmPageMentionBlock(
  item: CommandPalettePage,
): Record<string, unknown> {
  return {
    type: "pageRef",
    props: {
      targetBlockId: item.page.id,
    },
  };
}

export function buildNfmThreadMentionInlineContent(
  item: CommandPaletteThread,
): unknown[] {
  return [
    {
      type: "threadMention",
      props: { uuid: item.threadId },
    },
    " ",
  ];
}

export function buildNfmDateMentionInlineContent(
  payload: NfmDateMentionInlineContent,
): unknown[] {
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
  const Icon = isReminder
    ? BellIcon
    : match.key === "date:now"
      ? ClockIcon
      : CalendarIcon;
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
      insertInlineContent(
        editor,
        buildNfmDateMentionInlineContent(match.payload),
      );
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

export function buildNfmPageMentionSuggestionItem(
  editor: unknown,
  item: CommandPalettePage,
  options: { group?: string } = {},
): NfmSuggestionItem {
  const contextText = resolvePageMentionContext(item);
  return {
    title: item.page.title || "Untitled",
    subtext: resolvePageMentionSubtext(item),
    aliases: [],
    group: options.group ?? CARD_MENTION_GROUP,
    hint: null,
    tooltipContent: buildMentionTooltipContent(contextText, item.searchPreview),
    icon: <PageIcon className="size-4" aria-hidden="true" />,
    onItemClick: () => {
      insertBlock(editor, buildNfmPageMentionBlock(item));
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
    icon: <ThreadIcon className="size-4" />,
    onItemClick: () => {
      insertInlineContent(editor, buildNfmThreadMentionInlineContent(item));
    },
  };
}

function partitionMentionResultsByActiveProject<
  T extends { inActiveProject: boolean },
>(items: readonly T[]): { activeProjectItems: T[]; otherItems: T[] } {
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
  pageResults,
  threadResults,
}: {
  editor: unknown;
  query?: string;
  pageResults: readonly CommandPalettePage[];
  threadResults: readonly CommandPaletteThread[];
}): DefaultReactSuggestionItem[] {
  const { activeProjectItems: activeProjectThreads, otherItems: otherThreads } =
    partitionMentionResultsByActiveProject(threadResults);
  const { activeProjectItems: activeProjectPages, otherItems: otherPages } =
    partitionMentionResultsByActiveProject(pageResults);
  const currentProjectItems = [
    ...activeProjectThreads.map((item) =>
      buildNfmThreadMentionSuggestionItem(editor, item, {
        group: CURRENT_PROJECT_MENTION_GROUP,
      }),
    ),
    ...activeProjectPages.map((item) =>
      buildNfmPageMentionSuggestionItem(editor, item, {
        group: CURRENT_PROJECT_MENTION_GROUP,
      }),
    ),
  ];
  const dateItems = buildNfmDateMentionSuggestionItems(editor, query);
  const otherMentionItems = [
    ...otherThreads.map((item) =>
      buildNfmThreadMentionSuggestionItem(editor, item, {
        group: CHAT_MENTION_GROUP,
      }),
    ),
    ...otherPages.map((item) =>
      buildNfmPageMentionSuggestionItem(editor, item, {
        group: CARD_MENTION_GROUP,
      }),
    ),
  ];

  return isDateMentionQuery(query)
    ? [...dateItems, ...currentProjectItems, ...otherMentionItems]
    : [...currentProjectItems, ...dateItems, ...otherMentionItems];
}

interface NfmMentionSearchState {
  editor: unknown;
  pageItems: CommandPalettePage[];
  pageSearchIndex: ReturnType<typeof useCommandPalettePageSearchIndex>;
  projectIdsForPageSearch: string[];
}

export interface NfmMentionGetItemsLoaders {
  searchPageDescriptions: typeof searchCommandPalettePageDescriptions;
  listThreadItems: typeof listCommandPaletteThreadItems;
  searchThreads: typeof searchCommandPaletteThreads;
  selectPageResults: typeof selectCommandPalettePageResults;
  selectChatResults: typeof selectCommandPaletteChatResults;
  createThreadSearchIndex: typeof createCommandPaletteThreadSearchIndex;
}

interface NfmMentionGetItemsInput {
  editor: unknown;
  projectId: string;
  pageItems: CommandPalettePage[];
  pageSearchIndex: ReturnType<typeof useCommandPalettePageSearchIndex>;
  projectIdsForPageSearch: string[];
  loaders?: NfmMentionGetItemsLoaders;
}

const DEFAULT_NFM_MENTION_GET_ITEMS_LOADERS: NfmMentionGetItemsLoaders = {
  searchPageDescriptions: searchCommandPalettePageDescriptions,
  listThreadItems: listCommandPaletteThreadItems,
  searchThreads: searchCommandPaletteThreads,
  selectPageResults: selectCommandPalettePageResults,
  selectChatResults: selectCommandPaletteChatResults,
  createThreadSearchIndex: createCommandPaletteThreadSearchIndex,
};

type NfmPageDescriptionSearchResults = Awaited<
  ReturnType<NfmMentionGetItemsLoaders["searchPageDescriptions"]>
>;

type NfmThreadSearchResults = Awaited<
  ReturnType<NfmMentionGetItemsLoaders["searchThreads"]>
>;

interface NfmMentionAsyncSearchResults {
  key: string;
  pageDescriptionSearchResults?: NfmPageDescriptionSearchResults;
  threadSearchResults?: NfmThreadSearchResults;
}

function buildNfmMentionAsyncSearchKey({
  activeProjectId,
  projectIdsForPageSearch,
  query,
}: {
  activeProjectId: string;
  projectIdsForPageSearch: readonly string[];
  query: string;
}) {
  return JSON.stringify([activeProjectId, projectIdsForPageSearch, query]);
}

export function useNfmMentionGetItems({
  editor,
  projectId,
  pageItems,
  pageSearchIndex,
  projectIdsForPageSearch,
  loaders = DEFAULT_NFM_MENTION_GET_ITEMS_LOADERS,
}: NfmMentionGetItemsInput): (
  query: string,
) => Promise<DefaultReactSuggestionItem[]> {
  const [asyncRefreshKey, setAsyncRefreshKey] = useState(0);
  const threadItemsRef = useRef<{
    activeProjectId: string;
    items: CommandPaletteThread[];
  } | null>(null);
  const threadLoadPromiseRef = useRef<{
    activeProjectId: string;
    promise: Promise<CommandPaletteThread[]>;
  } | null>(null);
  const threadSearchIndexRef = useRef<{
    activeProjectId: string;
    items: CommandPaletteThread[];
    index: ReturnType<typeof createCommandPaletteThreadSearchIndex>;
  } | null>(null);
  const asyncSearchResultsRef = useRef<NfmMentionAsyncSearchResults | null>(
    null,
  );
  const latestAsyncSearchKeyRef = useRef<string | null>(null);
  const pageDescriptionSearchRequestRef = useRef<{
    key: string;
    id: number;
  } | null>(null);
  const threadSearchRequestRef = useRef<{
    key: string;
    id: number;
  } | null>(null);
  const asyncRequestIdRef = useRef(0);
  const projectIdRef = useRef(projectId);
  const loadersRef = useRef(loaders);
  const searchStateRef = useRef<NfmMentionSearchState>({
    editor,
    pageItems,
    pageSearchIndex,
    projectIdsForPageSearch,
  });

  projectIdRef.current = projectId;
  loadersRef.current = loaders;
  searchStateRef.current = {
    editor,
    pageItems,
    pageSearchIndex,
    projectIdsForPageSearch,
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

    const promise = loadersRef.current
      .listThreadItems({ activeProjectId })
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

  const getThreadSearchIndex = useCallback(
    (threadItems: CommandPaletteThread[]) => {
      const activeProjectId = projectIdRef.current;
      const cachedIndex = threadSearchIndexRef.current;
      if (
        cachedIndex?.activeProjectId === activeProjectId &&
        cachedIndex.items === threadItems
      ) {
        return cachedIndex.index;
      }

      const index = loadersRef.current.createThreadSearchIndex(threadItems);
      threadSearchIndexRef.current = {
        activeProjectId,
        items: threadItems,
        index,
      };
      return index;
    },
    [],
  );

  const ensureAsyncSearches = useCallback(
    ({
      projectIdsForPageSearch: currentProjectIdsForPageSearch,
      query,
      requestKey,
    }: {
      projectIdsForPageSearch: readonly string[];
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
        currentProjectIdsForPageSearch.length > 0 &&
        currentResults.pageDescriptionSearchResults === undefined &&
        pageDescriptionSearchRequestRef.current?.key !== requestKey
      ) {
        const requestId = asyncRequestIdRef.current + 1;
        asyncRequestIdRef.current = requestId;
        pageDescriptionSearchRequestRef.current = {
          key: requestKey,
          id: requestId,
        };

        void currentLoaders
          .searchPageDescriptions({
            projectIds: currentProjectIdsForPageSearch,
            query,
          })
          .then((results) => {
            if (
              latestAsyncSearchKeyRef.current !== requestKey ||
              pageDescriptionSearchRequestRef.current?.id !== requestId
            ) {
              return;
            }

            asyncSearchResultsRef.current = {
              ...(asyncSearchResultsRef.current?.key === requestKey
                ? asyncSearchResultsRef.current
                : { key: requestKey }),
              key: requestKey,
              pageDescriptionSearchResults: results,
            };
            bumpAsyncRefresh();
          })
          .catch(() => {
            if (
              latestAsyncSearchKeyRef.current !== requestKey ||
              pageDescriptionSearchRequestRef.current?.id !== requestId
            ) {
              return;
            }

            asyncSearchResultsRef.current = {
              ...(asyncSearchResultsRef.current?.key === requestKey
                ? asyncSearchResultsRef.current
                : { key: requestKey }),
              key: requestKey,
              pageDescriptionSearchResults: [],
            };
            bumpAsyncRefresh();
          });
      }

      if (
        currentResults.threadSearchResults === undefined &&
        threadSearchRequestRef.current?.key !== requestKey
      ) {
        const requestId = asyncRequestIdRef.current + 1;
        asyncRequestIdRef.current = requestId;
        threadSearchRequestRef.current = {
          key: requestKey,
          id: requestId,
        };

        void currentLoaders
          .searchThreads({ query })
          .then((results) => {
            if (
              latestAsyncSearchKeyRef.current !== requestKey ||
              threadSearchRequestRef.current?.id !== requestId
            ) {
              return;
            }

            asyncSearchResultsRef.current = {
              ...(asyncSearchResultsRef.current?.key === requestKey
                ? asyncSearchResultsRef.current
                : { key: requestKey }),
              key: requestKey,
              threadSearchResults: results,
            };
            bumpAsyncRefresh();
          })
          .catch(() => {
            if (
              latestAsyncSearchKeyRef.current !== requestKey ||
              threadSearchRequestRef.current?.id !== requestId
            ) {
              return;
            }

            asyncSearchResultsRef.current = {
              ...(asyncSearchResultsRef.current?.key === requestKey
                ? asyncSearchResultsRef.current
                : { key: requestKey }),
              key: requestKey,
              threadSearchResults: [],
            };
            bumpAsyncRefresh();
          });
      }
    },
    [bumpAsyncRefresh],
  );

  return useCallback(
    async (query: string) => {
      void asyncRefreshKey;

      const {
        editor: currentEditor,
        pageItems: currentPageItems,
        pageSearchIndex: currentPageSearchIndex,
        projectIdsForPageSearch: currentProjectIdsForPageSearch,
      } = searchStateRef.current;
      const currentLoaders = loadersRef.current;
      const activeProjectId = projectIdRef.current;
      const requestKey = buildNfmMentionAsyncSearchKey({
        activeProjectId,
        projectIdsForPageSearch: currentProjectIdsForPageSearch,
        query,
      });
      latestAsyncSearchKeyRef.current = requestKey;

      void loadThreadItems();
      ensureAsyncSearches({
        projectIdsForPageSearch: currentProjectIdsForPageSearch,
        query,
        requestKey,
      });

      const asyncResults =
        asyncSearchResultsRef.current?.key === requestKey
          ? asyncSearchResultsRef.current
          : undefined;
      const cachedThreads =
        threadItemsRef.current?.activeProjectId === activeProjectId
          ? threadItemsRef.current.items
          : [];
      const pageDescriptionSearchScopeKey =
        buildCommandPalettePageDescriptionSearchScopeKey(
          currentProjectIdsForPageSearch,
        );
      const pageDescriptionSearchBatch:
        CommandPalettePageDescriptionSearchBatch | undefined =
        asyncResults?.pageDescriptionSearchResults
          ? {
              query,
              scopeKey: pageDescriptionSearchScopeKey,
              results: asyncResults.pageDescriptionSearchResults,
              status: "success",
              error: null,
            }
          : undefined;
      const threadSearchBatch:
        CommandPaletteThreadSearchBatch | undefined =
        asyncResults?.threadSearchResults
          ? {
              query,
              results: asyncResults.threadSearchResults,
              loading: false,
              error: null,
            }
          : undefined;
      const pageResults = currentLoaders.selectPageResults({
        query,
        pages: currentPageItems,
        pageSearchIndex: currentPageSearchIndex,
        pageDescriptionSearchBatch,
        pageDescriptionSearchScopeKey,
        metadataPageLimit: 24,
        mergedPageLimit: 24,
        preferActiveProject: true,
      });
      const threadResults = currentLoaders.selectChatResults({
        query,
        threads: cachedThreads,
        threadSearchIndex: getThreadSearchIndex(cachedThreads),
        threadSearchBatch,
        threadLimit: 24,
        preferActiveProject: true,
        activeProjectId,
      });

      return buildNfmMentionSuggestionItems({
        editor: currentEditor,
        query,
        pageResults,
        threadResults,
      });
    },
    [
      asyncRefreshKey,
      ensureAsyncSearches,
      getThreadSearchIndex,
      loadThreadItems,
    ],
  );
}

function MentionMenu({
  projectId,
  allowPageReferences,
}: {
  projectId: string;
  allowPageReferences: boolean;
}) {
  const editor = useBlockNoteEditor();
  const { projects } = useProjects();
  const pageItems = useMemo<CommandPalettePage[]>(() => [], []);
  const pageSearchIndex = useCommandPalettePageSearchIndex(pageItems);
  const projectIdsForPageSearch = useMemo(
    () => (allowPageReferences ? projects.map((project) => project.id) : []),
    [allowPageReferences, projects],
  );
  const getItems = useNfmMentionGetItems({
    editor,
    projectId,
    pageItems,
    pageSearchIndex,
    projectIdsForPageSearch,
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
