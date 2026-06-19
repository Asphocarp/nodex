import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { filterSuggestionItems, insertOrUpdateBlockForSlashMenu } from "@blocknote/core/extensions";
import {
  SuggestionMenuController,
  getDefaultReactSlashMenuItems,
  useBlockNoteEditor,
  type DefaultReactSuggestionItem,
  type SuggestionMenuProps,
} from "@blocknote/react";
import { Link2, ListTree, SendHorizontal, Settings2 } from "lucide-react";
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
import type { CodexThreadSummary, Project } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useProjects } from "@/lib/use-projects";
import { useDefaultCodexAppServerManager } from "@/features/local-conversation";
import {
  NFM_SUGGESTION_MENU_FLOATING_OPTIONS,
  NFM_SUGGESTION_MENU_PORTAL_ELEMENT,
  NFM_SUGGESTION_MENU_TOOLTIP_Z_INDEX,
} from "./nfm-blocknote-floating-ui";
import { createEmptyThreadSectionBlock } from "./thread-section";
import { formatThreadMentionShortUuid } from "@/lib/nfm/thread-mention-display";
import { CodexThreadIcon } from "@/components/shared/icons";

interface NfmSlashMenuProps {
  projectId: string;
}

type UnsafeEditor = Parameters<typeof insertOrUpdateBlockForSlashMenu>[0];
type UnsafeBlock = Parameters<typeof insertOrUpdateBlockForSlashMenu>[1];
type NfmSuggestionItem = DefaultReactSuggestionItem & {
  key?: string;
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
  const key = (item as NfmSuggestionItem).key;
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
        ) : null}
      </NodexDropdownScrollList>
    </NodexDropdownSurface>
  );
}

export function getNfmSlashMenuCustomItems(
  editor: unknown,
  projectId: string,
): DefaultReactSuggestionItem[] {
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

  return [toggleListItem, cardRefItem, threadSectionItem, agentConfigItem];
}

export function NfmSlashMenu({ projectId }: NfmSlashMenuProps) {
  const editor = useBlockNoteEditor();

  const getItems = useMemo(
    () => async (query: string) => {
      const defaults = getDefaultReactSlashMenuItems(editor);
      return filterSuggestionItems([...defaults, ...getNfmSlashMenuCustomItems(editor, projectId)], query);
    },
    [editor, projectId],
  );

  return (
    <>
      <SuggestionMenuController
        triggerCharacter="/"
        getItems={getItems}
        {...NFM_SUGGESTION_MENU_CONTROLLER_PORTAL_PROPS}
        suggestionMenuComponent={NfmSuggestionMenuSurface}
      />
      <MentionMenu projectId={projectId} />
    </>
  );
}

// ---------------------------------------------------------------------------
// @ mention for cards and Codex threads
// ---------------------------------------------------------------------------

function resolveThreadMentionTitle(thread: CodexThreadSummary): string {
  const threadName = thread.threadName?.trim();
  if (threadName) return threadName;

  const firstPreviewLine = thread.threadPreview
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return firstPreviewLine || formatThreadMentionShortUuid(thread.threadId);
}

export function resolveThreadMentionSubtext(thread: CodexThreadSummary, project: Project | null): string {
  const projectLabel = project?.name?.trim() || project?.id || thread.projectId || "Unscoped";
  const stateLabel = thread.archived
    ? "Archived"
    : thread.statusType === "systemError"
      ? "Error"
      : thread.statusActiveFlags.includes("waitingOnApproval")
        ? "Needs approval"
        : thread.statusActiveFlags.includes("waitingOnUserInput")
        ? "Waiting"
        : thread.statusType === "active"
          ? "Running"
          : "";
  return [projectLabel, stateLabel, formatThreadMentionShortUuid(thread.threadId)]
    .filter(Boolean)
    .join(" / ");
}

function sortProjectsForMentions(projects: readonly Project[], currentProjectId: string): Project[] {
  return [...projects].sort((a, b) => {
    if (a.id === currentProjectId) return -1;
    if (b.id === currentProjectId) return 1;
    return a.name.localeCompare(b.name);
  });
}

function MentionMenu({ projectId }: { projectId: string }) {
  const editor = useBlockNoteEditor();
  const { boards } = useAllBoards();
  const { projects } = useProjects();
  const manager = useDefaultCodexAppServerManager();
  const threadLoadPromisesRef = useRef<Map<string, Promise<CodexThreadSummary[]>>>(new Map());
  const archivedThreadProjectsLoadedRef = useRef<Set<string>>(new Set());

  const loadProjectThreads = useCallback((targetProjectId: string) => {
    const cachedThreads = manager.readProjectThreadSummaries(targetProjectId);
    if (archivedThreadProjectsLoadedRef.current.has(targetProjectId)) return Promise.resolve(cachedThreads);

    const cacheKey = `${targetProjectId}:includeArchived`;
    const existingPromise = threadLoadPromisesRef.current.get(cacheKey);
    if (existingPromise) return existingPromise;

    const loadPromise = manager.loadThreads(targetProjectId, { includeArchived: true })
      .then((threads) => {
        archivedThreadProjectsLoadedRef.current.add(targetProjectId);
        return threads;
      })
      .finally(() => {
        threadLoadPromisesRef.current.delete(cacheKey);
      });
    threadLoadPromisesRef.current.set(cacheKey, loadPromise);
    return loadPromise;
  }, [manager]);

  const getItems = useMemo(
    () => async (query: string) => {
      const cardItems: DefaultReactSuggestionItem[] = [];
      const threadItems: DefaultReactSuggestionItem[] = [];

      // Current project first, then others
      const sortedEntries = [...boards.entries()].sort(([a], [b]) => {
        if (a === projectId) return -1;
        if (b === projectId) return 1;
        return 0;
      });

      for (const [projId, board] of sortedEntries) {
        for (const column of board.columns) {
          for (const card of column.cards) {
            cardItems.push({
              title: card.title || "Untitled",
              subtext: `${projId} / ${column.name}`,
              aliases: [],
              group: `Cards / ${projId}`,
              badge: "@",
              icon: <Link2 size={16} />,
              onItemClick: () => {
                insertBlock(editor, {
                  type: "cardRef",
                  props: { sourceProjectId: projId, cardId: card.id },
                });
              },
            });
          }
        }
      }

      const sortedProjects = sortProjectsForMentions(projects, projectId);
      const projectThreadEntries = await Promise.all(
        sortedProjects.map(async (project) => {
          try {
            return {
              project,
              threads: await loadProjectThreads(project.id),
            };
          } catch {
            return {
              project,
              threads: manager.readProjectThreadSummaries(project.id),
            };
          }
        }),
      );

      for (const { project, threads } of projectThreadEntries) {
        const sortedThreads = [...threads].sort((a, b) => {
          if (a.archived !== b.archived) return a.archived ? 1 : -1;
          return b.updatedAt - a.updatedAt;
        });

        for (const thread of sortedThreads) {
          threadItems.push({
            title: resolveThreadMentionTitle(thread),
            subtext: resolveThreadMentionSubtext(thread, project),
            aliases: [thread.threadId, thread.threadName ?? "", thread.threadPreview],
            group: project.id === projectId ? "Threads" : `Threads / ${project.name || project.id}`,
            badge: "@thread",
            icon: <CodexThreadIcon className="size-4" />,
            onItemClick: () => {
              insertInlineContent(editor, [
                {
                  type: "threadMention",
                  props: { uuid: thread.threadId },
                },
                " ",
              ]);
            },
          });
        }
      }

      return filterSuggestionItems([...threadItems, ...cardItems], query);
    },
    [boards, editor, loadProjectThreads, manager, projectId, projects],
  );

  return (
    <SuggestionMenuController
      triggerCharacter="@"
      getItems={getItems}
      {...NFM_SUGGESTION_MENU_CONTROLLER_PORTAL_PROPS}
      suggestionMenuComponent={NfmSuggestionMenuSurface}
    />
  );
}
