import { useDeferredValue, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  ListFilter,
} from "lucide-react";
import { CodexSidebarVisibleIcon } from "@/components/shared/icons";
import {
  areCommandPaletteCardFiltersEqual,
  cloneCommandPaletteCardFilters,
  filterCommandPaletteItems,
  hasActiveCommandPaletteCardFilters,
  matchesCommandPaletteCardFilters,
  normalizeCommandPaletteCardFilters,
  readCommandPaletteCardFilters,
  type CommandMenuMode,
  type CommandPaletteCard,
  type CommandPaletteCardFilters,
  type CommandPaletteCommandGroup,
  type CommandPaletteCommand,
  type CommandPaletteThread,
  writeCommandPaletteCardFilters,
} from "../../lib/command-palette";
import type { CommandPaletteCardSearchIndex } from "../../lib/command-palette-card-search";
import {
  buildCommandPaletteQueryHighlightPreview,
  type CommandPaletteHighlightSegment,
} from "../../lib/command-palette-highlight";
import type { CommandPaletteThreadSearchIndex } from "../../lib/command-palette-thread-search";
import { invoke, subscribeCommandPaletteThreadIndexUpdates } from "../../lib/api";
import type { CardSearchResult, CommandPaletteThreadContentSearchResult } from "../../lib/types";
import { cn } from "../../lib/utils";
import { CardIcon } from "./card-icon";
import { CommandMenuReferenceIcon } from "./command-menu-reference-icons";
import {
  CommandPaletteCardFilterPopover,
  CommandPaletteCardFiltersSummaryRow,
} from "./command-palette-filters";
import { ThreadsIcon } from "./threads-icon";
import { NodexIconButton } from "@/components/ui/button";
import {
  NAVIGATE_BACK_COMMAND_ID,
  NAVIGATE_FORWARD_COMMAND_ID,
  RENAME_THREAD_COMMAND_ID,
  TOGGLE_SIDEBAR_COMMAND_ID,
} from "../../../shared/window-navigation";
import { OPEN_DB_VIEW_TAB_COMMAND_ID } from "@/lib/command-palette-commands";

type PaletteItem = CommandPaletteCommand | CommandPaletteCard | CommandPaletteThread;
type PaletteSectionModel = { title: string; items: PaletteItem[] };

interface CommandPaletteSurfaceProps {
  open: boolean;
  openTriggerTick: number;
  mode: CommandMenuMode;
  initialQuery?: string;
  commands: CommandPaletteCommand[];
  cards: CommandPaletteCard[];
  threads?: CommandPaletteThread[];
  cardSearchIndex?: CommandPaletteCardSearchIndex | null;
  threadSearchIndex?: CommandPaletteThreadSearchIndex | null;
  loading: boolean;
  cardsLoading: boolean;
  chatsLoading: boolean;
  onChangeMode: (mode: CommandMenuMode) => void;
  onRequestClose: () => void;
  onExecute: (item: PaletteItem) => void;
}

const COMMAND_GROUP_ORDER: CommandPaletteCommandGroup[] = [
  "Suggested",
  "Chat",
  "Navigation",
  "Panels",
  "Project",
  "Configure",
  "Skills",
  "App",
];

function getPaletteItemDomId(listId: string, index: number): string {
  return `${listId}-item-${index}`;
}

function isPaletteItemDisabled(item: PaletteItem | undefined): boolean {
  return item?.kind === "command" && item.disabled === true;
}

function getModePlaceholder(mode: CommandMenuMode): string {
  if (mode === "chats") return "Search chats";
  if (mode === "cards") return "Search cards";
  if (mode === "files") return "Search files";
  return "Type command";
}

function getEmptyMessage(mode: CommandMenuMode, query: string, loading: boolean): string {
  if (loading) {
    if (mode === "chats") return "Loading chats...";
    if (mode === "cards") return "Loading cards...";
    if (mode === "files") return "Loading files...";
    return "Loading commands...";
  }

  if (mode === "chats") return query.length > 0 ? "No matching chats." : "No chats.";
  if (mode === "cards") return query.length > 0 ? "No matching cards." : "No cards.";
  if (mode === "files") return "File search is not available in Nodex yet.";
  return "No matching commands.";
}

function resolveSelectableIndex(
  items: readonly PaletteItem[],
  preferredIndex: number,
  direction: -1 | 1,
): number {
  if (items.length === 0) return -1;

  const startIndex = ((preferredIndex % items.length) + items.length) % items.length;
  for (let step = 0; step < items.length; step += 1) {
    const nextIndex = (startIndex + direction * step + items.length) % items.length;
    if (!isPaletteItemDisabled(items[nextIndex])) {
      return nextIndex;
    }
  }

  return -1;
}

function getCommandGlyph(id: string) {
  if (id === NAVIGATE_BACK_COMMAND_ID) return (props: { className?: string }) => (
    <CommandMenuReferenceIcon name="search" {...props} />
  );
  if (id === NAVIGATE_FORWARD_COMMAND_ID) return (props: { className?: string }) => (
    <CommandMenuReferenceIcon name="search" {...props} />
  );
  if (id === "newThread" || id === "newThreadInProject" || id === "quickChat") return (props: { className?: string }) => (
    <CommandMenuReferenceIcon name="compose" {...props} />
  );
  if (id === TOGGLE_SIDEBAR_COMMAND_ID) return CodexSidebarVisibleIcon;
  if (id === RENAME_THREAD_COMMAND_ID) return (props: { className?: string }) => (
    <CommandMenuReferenceIcon name="compose" {...props} />
  );
  if (id === "archiveThread") return (props: { className?: string }) => (
    <CommandMenuReferenceIcon name="archive" {...props} />
  );
  if (id === "toggleThreadPin") return (props: { className?: string }) => (
    <CommandMenuReferenceIcon name="pin" {...props} />
  );
  if (id === "openThreadInNewWindow") return (props: { className?: string }) => (
    <CommandMenuReferenceIcon name="search" {...props} />
  );
  if (id === "toggleFileTreePanel" || id === "openFolder" || id === "searchFiles") return (props: { className?: string }) => (
    <CommandMenuReferenceIcon name="folder" {...props} />
  );
  if (id === "openBrowserTab" || id === "focusBrowserAddressBar") return (props: { className?: string }) => (
    <CommandMenuReferenceIcon name="globe" {...props} />
  );
  if (id === "toggleTerminal" || id === "installPrimaryRuntime") return (props: { className?: string }) => (
    <CommandMenuReferenceIcon name="terminal" {...props} />
  );
  if (id === "searchChats" || id === "searchCards" || id === "findInThread") return (props: { className?: string }) => (
    <CommandMenuReferenceIcon name="search" {...props} />
  );
  if (id === OPEN_DB_VIEW_TAB_COMMAND_ID) return CardIcon;
  if (id === "openSideChat") return CardIcon;
  if (id === "settings" || id === "showKeyboardShortcuts" || id.endsWith("Settings")) return (props: { className?: string }) => (
    <CommandMenuReferenceIcon name="settings" {...props} />
  );
  if (id === "openAvatarOverlay" || id === "tuckAwayPetOverlay" || id === "personalitySettings") return (props: { className?: string }) => (
    <CommandMenuReferenceIcon name="avatar" {...props} />
  );
  return (props: { className?: string }) => <CommandMenuReferenceIcon name="search" {...props} />;
}

function buildServerDescriptionSearchPreview(
  excerpt: string,
  query: string,
): CommandPaletteCard["searchPreview"] {
  return buildCommandPaletteQueryHighlightPreview(excerpt, query);
}

function buildThreadContentSearchPreview(
  excerpt: string,
  query: string,
  segments?: CommandPaletteThreadContentSearchResult["snippetSegments"],
): CommandPaletteThread["searchPreview"] {
  const preview = segments && segments.length > 0
    ? {
      excerpt: excerpt.replace(/\s+/g, " ").trim(),
      segments,
    }
    : buildCommandPaletteQueryHighlightPreview(excerpt, query);
  if (!preview) return null;

  return {
    ...preview,
    source: "content",
  };
}

function CommandRow({
  item,
  selected,
  showSubtitle,
}: {
  item: CommandPaletteCommand;
  selected: boolean;
  showSubtitle: boolean;
}) {
  const Glyph = getCommandGlyph(item.id);
  const subtitle = item.mockReason ?? item.subtitle;
  const isMock = Boolean(item.mockReason);

  return (
    <div className={cn("flex w-full gap-2", showSubtitle ? "items-start" : "items-center")}>
      <Glyph className={cn(
        "size-4 shrink-0 text-token-description-foreground",
        selected && "text-token-foreground",
        showSubtitle && "mt-0.5",
      )} />
      <div className="min-w-0 flex-1 leading-tight">
        <div className="flex min-w-0 items-center gap-1.5">
          <div className="min-w-0 truncate text-token-foreground">{item.title}</div>
          {isMock ? (
            <span
              title={item.mockReason}
              className="inline-flex h-4 shrink-0 items-center rounded-sm bg-token-foreground/5 px-1 text-[10px] font-medium uppercase leading-none text-token-description-foreground"
            >
              Mock
            </span>
          ) : null}
        </div>
        {showSubtitle ? (
          <div className="mt-0.5 truncate text-xs text-token-description-foreground">
            {subtitle}
          </div>
        ) : null}
      </div>
      {item.shortcut ? (
        <kbd className="shrink-0 rounded-sm bg-token-foreground/5 px-1.5 py-0.5 text-[11px] font-sans font-medium leading-none tracking-wide text-token-description-foreground">
          {item.shortcut}
        </kbd>
      ) : null}
    </div>
  );
}

function formatThreadDate(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return "";
  }

  const ms = timestamp > 10_000_000_000 ? timestamp : timestamp * 1000;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(new Date(ms));
}

function getCwdLabel(cwd: string | null): string {
  if (!cwd) return "";
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? cwd;
}

function renderSegments(
  segments: Array<CommandPaletteHighlightSegment>,
  keyPrefix: string,
) {
  return segments.map((segment, index) => (
    <span
      key={`${keyPrefix}:${index}`}
      className={segment.highlight ? "rounded-[3px] bg-token-foreground/8 px-0.5 text-token-foreground" : undefined}
    >
      {segment.text}
    </span>
  ));
}

function CardRow({
  item,
  selected,
  showSubtitle,
}: {
  item: CommandPaletteCard;
  selected: boolean;
  showSubtitle: boolean;
}) {
  const hasPreview = Boolean(item.searchPreview);
  const decorations = item.searchDecorations;
  return (
    <div className={cn("flex w-full gap-2", hasPreview ? "items-start" : "items-center")}>
      <div className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-lg bg-token-foreground/5 text-xs text-token-description-foreground",
        selected && "bg-token-foreground/10 text-token-foreground",
        hasPreview && "mt-0.5",
      )}>
        {item.projectIcon || item.projectName.slice(0, 1).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-token-foreground">
          {decorations?.titleSegments
            ? renderSegments(decorations.titleSegments, `${item.id}:title`)
            : item.card.title || "Untitled"}
        </div>
        {showSubtitle ? (
          <div className="truncate text-xs text-token-description-foreground">
            {decorations?.projectNameSegments
              ? renderSegments(decorations.projectNameSegments, `${item.id}:project`)
              : item.projectName}
            {" / "}
            {decorations?.columnNameSegments
              ? renderSegments(decorations.columnNameSegments, `${item.id}:column`)
              : item.columnName}
            {item.recentIndex !== null ? " / Recent" : ""}
          </div>
        ) : null}
        {decorations && decorations.badges.length > 0 ? (
          <div className="mt-1 flex flex-wrap gap-1">
            {decorations.badges.map((badge) => (
              <span
                key={`${item.id}:badge:${badge.id}`}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md bg-token-foreground/5 px-1.5 py-0.5 text-[11px] leading-none text-token-description-foreground",
                  badge.tone === "monospace" && "font-mono",
                )}
              >
                <span className="text-token-description-foreground/80">{badge.label}</span>
                <span className={badge.tone === "monospace" ? "font-mono" : undefined}>
                  {renderSegments(badge.segments, `${item.id}:badge:${badge.id}`)}
                </span>
              </span>
            ))}
          </div>
        ) : null}
        {item.searchPreview ? (
          <div className="mt-1 line-clamp-3 text-xs/relaxed wrap-break-word text-token-description-foreground/90">
            {renderSegments(item.searchPreview.segments, `${item.id}:preview`)}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ThreadRow({
  item,
  selected,
}: {
  item: CommandPaletteThread;
  selected: boolean;
}) {
  const hasPreview = Boolean(item.searchPreview);
  const decorations = item.searchDecorations;
  const cwdLabel = getCwdLabel(item.cwd);
  const updatedLabel = formatThreadDate(item.updatedAt);
  const projectLabel = item.projectName ?? "Chats";

  return (
    <div className={cn("flex w-full gap-2", hasPreview ? "items-start" : "items-center")}>
      <div className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-lg bg-token-foreground/5 text-token-description-foreground",
        selected && "bg-token-foreground/10 text-token-foreground",
        hasPreview && "mt-0.5",
      )}>
        <ThreadsIcon className="size-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-token-foreground">
          {decorations?.titleSegments
            ? renderSegments(decorations.titleSegments, `${item.id}:title`)
            : item.title || "New chat"}
        </div>
        <div className="truncate text-xs text-token-description-foreground">
          {decorations?.projectNameSegments
            ? renderSegments(decorations.projectNameSegments, `${item.id}:project`)
            : projectLabel}
          {cwdLabel ? (
            <>
              {" / "}
              {decorations?.cwdSegments
                ? renderSegments(decorations.cwdSegments, `${item.id}:cwd`)
                : cwdLabel}
            </>
          ) : null}
          {updatedLabel ? ` / ${updatedLabel}` : ""}
        </div>
        {item.searchPreview ? (
          <div className="mt-1 line-clamp-2 text-xs/relaxed wrap-break-word text-token-description-foreground/90">
            {renderSegments(item.searchPreview.segments, `${item.id}:preview`)}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PaletteSection({
  title,
  items,
  listId,
  selectedIndex,
  startIndex,
  onSelectIndex,
  onExecute,
  showSubtitle,
}: {
  title: string;
  items: PaletteItem[];
  listId: string;
  selectedIndex: number;
  startIndex: number;
  onSelectIndex: (index: number) => void;
  onExecute: (item: PaletteItem) => void;
  showSubtitle: boolean;
}) {
  if (items.length === 0) return null;

  return (
    <section cmdk-group="" role="presentation" className="flex flex-col gap-[var(--spacing)]" data-value={title}>
      <div cmdk-group-heading="" aria-hidden="true">
        <span className="block px-2 pt-2 text-sm text-token-description-foreground">{title}</span>
      </div>
      <div cmdk-group-items="" role="group" aria-label={title}>
        {items.map((item, offset) => {
          const index = startIndex + offset;
          const selected = index === selectedIndex;
          return (
            <button
              id={getPaletteItemDomId(listId, index)}
              key={item.id}
              type="button"
              role="option"
              cmdk-item=""
              data-palette-index={index}
              data-selected={selected}
              aria-selected={selected}
              aria-disabled={item.kind === "command" && item.disabled ? "true" : undefined}
              onMouseMove={() => onSelectIndex(index)}
              onClick={() => onExecute(item)}
              disabled={item.kind === "command" && item.disabled}
              className={cn(
                "flex min-h-[calc(var(--spacing)*6)] w-full cursor-interaction rounded-lg px-[var(--padding-row-x)] py-[var(--padding-row-y)] text-left text-sm text-token-foreground opacity-75 outline-none",
                (item.kind === "card" || item.kind === "thread") && item.searchPreview && "py-[calc(var(--padding-row-y)+2px)]",
                item.kind === "command" && item.disabled
                  ? "cursor-not-allowed opacity-40 hover:bg-transparent hover:opacity-40"
                  : selected ? "bg-token-list-hover-background opacity-100" : "hover:bg-token-list-hover-background hover:opacity-100",
              )}
            >
              {item.kind === "command" ? (
                <CommandRow item={item} selected={selected} showSubtitle={showSubtitle} />
              ) : (
                item.kind === "card" ? (
                  <CardRow item={item} selected={selected} showSubtitle={showSubtitle} />
                ) : (
                  <ThreadRow item={item} selected={selected} />
                )
              )}
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function CommandPaletteSurface({
  open,
  openTriggerTick,
  mode,
  initialQuery,
  commands,
  cards,
  threads = [],
  cardSearchIndex,
  threadSearchIndex,
  loading,
  cardsLoading,
  chatsLoading,
  onChangeMode,
  onRequestClose,
  onExecute,
}: CommandPaletteSurfaceProps) {
  const inputId = useId();
  const labelId = useId();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollViewportRef = useRef<HTMLDivElement | null>(null);
  const previousModeRef = useRef<CommandMenuMode>(mode);
  const [query, setQuery] = useState("");
  const [cardFilters, setCardFilters] = useState<CommandPaletteCardFilters>(() => readCommandPaletteCardFilters());
  const [filterOpen, setFilterOpen] = useState(false);
  const [descriptionSearchResults, setDescriptionSearchResults] = useState<CardSearchResult[]>([]);
  const [threadContentSearchResults, setThreadContentSearchResults] = useState<CommandPaletteThreadContentSearchResult[]>([]);
  const [threadContentRefreshTick, setThreadContentRefreshTick] = useState(0);
  const deferredQuery = useDeferredValue(query);
  const availableTags = useMemo(
    () => Array.from(new Set(cards.flatMap((item) => item.card.tags))).sort((left, right) => left.localeCompare(right)),
    [cards],
  );
  const availableAssignees = useMemo(
    () => Array.from(new Set(
      cards
        .map((item) => item.card.assignee?.trim() ?? "")
        .filter((value) => value.length > 0),
    )).sort((left, right) => left.localeCompare(right)),
    [cards],
  );
  const availableProjects = useMemo(
    () => Array.from(new Map(
      cards.map((item) => [item.projectId, { id: item.projectId, label: item.projectName }] as const),
    ).values()).sort((left, right) => left.label.localeCompare(right.label)),
    [cards],
  );
  const projectNameById = useMemo(
    () => new Map(availableProjects.map((project) => [project.id, project.label] as const)),
    [availableProjects],
  );
  const normalizedCardFilters = useMemo(
    () => normalizeCommandPaletteCardFilters(cardFilters, {
      allowedTags: availableTags,
      allowedAssignees: availableAssignees,
      allowedProjectIds: availableProjects.map((project) => project.id),
    }),
    [availableAssignees, availableProjects, availableTags, cardFilters],
  );
  const projectIdsForSearch = useMemo(() => {
    const allProjectIds = availableProjects.map((project) => project.id);
    if (normalizedCardFilters.projectIds.length === 0) {
      return allProjectIds;
    }

    const selectedProjectIds = new Set(normalizedCardFilters.projectIds);
    return allProjectIds.filter((projectId) => selectedProjectIds.has(projectId));
  }, [availableProjects, normalizedCardFilters.projectIds]);
  const cardByProjectAndId = useMemo(
    () => new Map(cards.map((item) => [`${item.projectId}:${item.card.id}`, item] as const)),
    [cards],
  );
  const threadById = useMemo(
    () => new Map(threads.map((item) => [item.threadId, item] as const)),
    [threads],
  );
  const results = useMemo(
    () => filterCommandPaletteItems({
      query: deferredQuery,
      mode,
      commands,
      cards,
      threads,
      cardFilters: normalizedCardFilters,
      cardSearchIndex,
      threadSearchIndex,
    }),
    [cardSearchIndex, cards, commands, deferredQuery, mode, normalizedCardFilters, threadSearchIndex, threads],
  );
  const descriptionSearchCards = useMemo(() => {
    if (mode !== "cards" || results.query.length === 0) {
      return [];
    }

    return descriptionSearchResults.flatMap((result) => {
      const item = cardByProjectAndId.get(`${result.projectId}:${result.cardId}`);
      if (!item || !matchesCommandPaletteCardFilters(item, normalizedCardFilters)) {
        return [];
      }

      return [{
        ...item,
        searchPreview: buildServerDescriptionSearchPreview(result.excerpt, results.query) ?? item.searchPreview,
      }];
    });
  }, [cardByProjectAndId, descriptionSearchResults, mode, normalizedCardFilters, results.query]);
  const visibleCards = useMemo(() => {
    if (mode !== "cards" || results.query.length === 0 || descriptionSearchCards.length === 0) {
      return results.cards;
    }

    const serverMatchesById = new Map(descriptionSearchCards.map((item) => [item.id, item] as const));
    const merged = results.cards.map((item) => {
      const serverMatch = serverMatchesById.get(item.id);
      if (!serverMatch?.searchPreview || item.searchPreview) {
        return item;
      }

      return {
        ...item,
        searchPreview: serverMatch.searchPreview,
      };
    });
    const seenIds = new Set(merged.map((item) => item.id));
    descriptionSearchCards.forEach((item) => {
      if (seenIds.has(item.id)) return;
      seenIds.add(item.id);
      merged.push(item);
    });

    return merged.slice(0, 24);
  }, [descriptionSearchCards, mode, results.cards, results.query]);
  const contentSearchThreads = useMemo(() => {
    if (mode !== "chats" || results.query.length === 0) {
      return [];
    }

    return threadContentSearchResults.flatMap((result) => {
      const item = threadById.get(result.threadId);
      if (!item) return [];
      const searchPreview = buildThreadContentSearchPreview(result.snippet, results.query, result.snippetSegments);
      if (!searchPreview) return [];
      return [{
        ...item,
        searchPreview,
      }];
    });
  }, [mode, results.query, threadById, threadContentSearchResults]);
  const visibleThreads = useMemo(() => {
    if (mode !== "chats" || results.query.length === 0 || contentSearchThreads.length === 0) {
      return results.threads;
    }

    const contentMatchesById = new Map(contentSearchThreads.map((item) => [item.id, item] as const));
    const merged = results.threads.map((item) => {
      const contentMatch = contentMatchesById.get(item.id);
      if (!contentMatch?.searchPreview || item.searchPreview) {
        return item;
      }

      return {
        ...item,
        searchPreview: contentMatch.searchPreview,
      };
    });
    const seenIds = new Set(merged.map((item) => item.id));
    contentSearchThreads.forEach((item) => {
      if (seenIds.has(item.id)) return;
      seenIds.add(item.id);
      merged.push(item);
    });

    return merged.slice(0, 8);
  }, [contentSearchThreads, mode, results.query, results.threads]);
  const sections = useMemo<PaletteSectionModel[]>(() => {
    if (mode === "root") {
      return COMMAND_GROUP_ORDER
        .map((title) => ({
          title,
          items: results.commands.filter((item) => item.group === title),
        }))
        .filter((section) => section.items.length > 0);
    }

    if (mode === "chats") {
      return [{ title: "Chats", items: visibleThreads }];
    }

    if (mode === "cards") {
      return [{ title: "Cards", items: visibleCards }];
    }

    return [];
  }, [mode, results.commands, visibleCards, visibleThreads]);
  const flatItems = useMemo(
    () => sections.flatMap((section) => section.items),
    [sections],
  );
  const filterActive = hasActiveCommandPaletteCardFilters(normalizedCardFilters);
  const showSubtitle = results.query.length > 0 || mode !== "root";
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    if (!open) return;

    const nextQuery = initialQuery ?? "";
    setQuery(nextQuery);
    setFilterOpen(false);

    const rafId = window.requestAnimationFrame(() => {
      const input = inputRef.current;
      input?.focus();
      if (!input) {
        return;
      }

      if (nextQuery.length > 0) {
        input.setSelectionRange(nextQuery.length, nextQuery.length);
        return;
      }

      input.select();
    });

    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [initialQuery, open, openTriggerTick]);

  useEffect(() => {
    if (!open) {
      previousModeRef.current = mode;
      return;
    }

    if (previousModeRef.current === mode) return;
    previousModeRef.current = mode;
    setQuery(initialQuery ?? "");
    setSelectedIndex(0);
    setFilterOpen(false);
  }, [initialQuery, mode, open]);

  useEffect(() => {
    if (open) return;
    setQuery("");
    setSelectedIndex(0);
    setDescriptionSearchResults((current) => current.length === 0 ? current : []);
    setThreadContentSearchResults((current) => current.length === 0 ? current : []);
  }, [open]);

  useEffect(() => {
    const rawQuery = deferredQuery.trimStart();
    const queryText = rawQuery.trim();
    if (mode !== "cards" || !open || queryText.length === 0 || projectIdsForSearch.length === 0) {
      setDescriptionSearchResults((current) => current.length === 0 ? current : []);
      return;
    }

    let cancelled = false;
    void invoke("cards:search", {
      projectIds: projectIdsForSearch,
      query: queryText,
      limit: 60,
    })
      .then((nextResults) => {
        if (cancelled) return;
        const safeResults = Array.isArray(nextResults) ? nextResults : [];
        setDescriptionSearchResults((current) => (
          current.length === 0 && safeResults.length === 0 ? current : safeResults
        ));
      })
      .catch(() => {
        if (cancelled) return;
        setDescriptionSearchResults((current) => current.length === 0 ? current : []);
      });

    return () => {
      cancelled = true;
    };
  }, [deferredQuery, mode, open, projectIdsForSearch]);

  useEffect(() => {
    if (mode !== "chats" || !open) return;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeCommandPaletteThreadIndexUpdates(() => {
      if (refreshTimer !== null) {
        clearTimeout(refreshTimer);
      }
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        setThreadContentRefreshTick((current) => current + 1);
      }, 250);
    });

    return () => {
      if (refreshTimer !== null) {
        clearTimeout(refreshTimer);
      }
      unsubscribe();
    };
  }, [mode, open]);

  useEffect(() => {
    const rawQuery = deferredQuery.trimStart();
    const queryText = rawQuery.trim();
    if (mode !== "chats" || !open || queryText.length < 2) {
      setThreadContentSearchResults((current) => current.length === 0 ? current : []);
      return;
    }

    let cancelled = false;
    void invoke("codex:threads:palette:search-content", {
      scope: "sidebar",
      query: queryText,
      limit: 60,
    })
      .then((nextResults) => {
        if (cancelled) return;
        const safeResults = Array.isArray(nextResults) ? nextResults : [];
        setThreadContentSearchResults((current) => (
          current.length === 0 && safeResults.length === 0 ? current : safeResults
        ));
      })
      .catch(() => {
        if (cancelled) return;
        setThreadContentSearchResults((current) => current.length === 0 ? current : []);
      });

    return () => {
      cancelled = true;
    };
  }, [deferredQuery, mode, open, threadContentRefreshTick]);

  useEffect(() => {
    if (!open) return;
    setSelectedIndex(0);
  }, [mode, open, results.query]);

  useEffect(() => {
    if (mode === "cards") return;
    setFilterOpen(false);
  }, [mode]);

  useEffect(() => {
    if (areCommandPaletteCardFiltersEqual(cardFilters, normalizedCardFilters)) {
      return;
    }

    setCardFilters(normalizedCardFilters);
  }, [cardFilters, normalizedCardFilters]);

  useEffect(() => {
    writeCommandPaletteCardFilters(
      areCommandPaletteCardFiltersEqual(cardFilters, normalizedCardFilters)
        ? cardFilters
        : normalizedCardFilters,
    );
  }, [cardFilters, normalizedCardFilters]);

  useEffect(() => {
    if (flatItems.length === 0) {
      if (selectedIndex === -1) return;
      setSelectedIndex(-1);
      return;
    }

    const preferredIndex = selectedIndex < 0 ? 0 : selectedIndex;
    const nextIndex = resolveSelectableIndex(flatItems, preferredIndex, 1);
    if (selectedIndex === nextIndex) return;
    setSelectedIndex(nextIndex);
  }, [flatItems, selectedIndex]);

  useEffect(() => {
    if (selectedIndex < 0) return;
    const next = scrollViewportRef.current?.querySelector<HTMLElement>(`[data-palette-index="${selectedIndex}"]`);
    next?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  useEffect(() => {
    const list = scrollViewportRef.current;
    if (!list || typeof ResizeObserver === "undefined") return;

    const updateHeight = () => {
      list.style.setProperty("--cmdk-list-height", `${list.scrollHeight.toFixed(1)}px`);
    };
    updateHeight();

    const observer = new ResizeObserver(updateHeight);
    observer.observe(list);
    Array.from(list.children).forEach((child) => observer.observe(child));
    return () => observer.disconnect();
  }, [sections]);

  const handleExecute = (item: PaletteItem) => {
    if (isPaletteItemDisabled(item)) return;
    if (item.kind === "command" && item.id === "searchChats") {
      onChangeMode("chats");
      return;
    }

    if (item.kind === "command" && item.id === "searchCards") {
      onChangeMode("cards");
      return;
    }

    if (item.kind === "command" && item.id === "searchFiles") {
      onChangeMode("files");
      return;
    }

    onRequestClose();
    onExecute(item);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    const moveSelection = (direction: -1 | 1) => {
      if (flatItems.length === 0) return;
      const currentIndex = selectedIndex < 0
        ? direction > 0 ? -1 : 0
        : selectedIndex;
      const nextIndex = resolveSelectableIndex(flatItems, currentIndex + direction, direction);
      if (nextIndex < 0) return;
      setSelectedIndex(nextIndex);
    };

    if (event.key === "ArrowDown" || (event.ctrlKey && (event.key === "j" || event.key === "n"))) {
      event.preventDefault();
      moveSelection(1);
      return;
    }

    if (event.key === "ArrowUp" || (event.ctrlKey && (event.key === "k" || event.key === "p"))) {
      event.preventDefault();
      moveSelection(-1);
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      if (flatItems.length === 0) return;
      setSelectedIndex(resolveSelectableIndex(flatItems, 0, 1));
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      if (flatItems.length === 0) return;
      setSelectedIndex(resolveSelectableIndex(flatItems, flatItems.length - 1, -1));
      return;
    }

    if (event.key === "Enter") {
      if (selectedIndex < 0 || selectedIndex >= flatItems.length) return;
      if (isPaletteItemDisabled(flatItems[selectedIndex])) return;
      event.preventDefault();
      handleExecute(flatItems[selectedIndex] as PaletteItem);
      return;
    }

    if (event.key !== "Escape" || query.trim().length === 0) return;
    event.preventDefault();
    setQuery("");
  };
  const activeDescendantId = selectedIndex >= 0 && selectedIndex < flatItems.length
    ? getPaletteItemDomId(listId, selectedIndex)
    : undefined;

  return (
    <div
      cmdk-root=""
      data-cmdk-root
      title="Command menu"
      className="flex min-w-full select-none flex-col gap-1.25 overflow-hidden rounded-2xl border border-transparent bg-token-dropdown-background px-1.25 py-[calc(var(--spacing)*1.15)] text-sm text-token-foreground shadow-2xl"
    >
      <label
        cmdk-label=""
        htmlFor={inputId}
        id={labelId}
        style={{
          position: "absolute",
          width: "1px",
          height: "1px",
          padding: 0,
          margin: "-1px",
          overflow: "hidden",
          clip: "rect(0px, 0px, 0px, 0px)",
          whiteSpace: "nowrap",
          borderWidth: 0,
        }}
      >
        Command menu
      </label>
      <div className="flex items-center gap-1.5 px-[calc(var(--spacing)*2.2)]">
        <input
          ref={inputRef}
          cmdk-input=""
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          aria-autocomplete="list"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={activeDescendantId}
          aria-labelledby={labelId}
          id={inputId}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={getModePlaceholder(mode)}
          aria-label="Command palette search"
          className="w-full border-none bg-transparent px-[calc(var(--spacing)*0.55)] py-[calc(var(--spacing)*1.75)] text-base text-token-foreground outline-none placeholder:text-token-description-foreground"
        />

        {mode === "cards" ? (
          <CommandPaletteCardFilterPopover
            open={filterOpen}
            onOpenChange={setFilterOpen}
            filters={cardFilters}
            availableTags={availableTags}
            availableAssignees={availableAssignees}
            availableProjects={availableProjects}
            disabled={false}
            onChange={(update) => setCardFilters((prev) => update(cloneCommandPaletteCardFilters(prev)))}
          >
            <NodexIconButton
              icon={ListFilter}
              size="sm"
              active={filterActive}
              ariaLabel="Filter cards"
              title="Filter cards"
            />
          </CommandPaletteCardFilterPopover>
        ) : null}
      </div>

      {mode === "cards" && filterActive ? (
        <div className="px-[calc(var(--spacing)*2.75)] pb-[calc(var(--spacing)*0.5)]">
          <CommandPaletteCardFiltersSummaryRow
            filters={cardFilters}
            projectNameById={projectNameById}
            onOpenFilter={() => setFilterOpen(true)}
          />
        </div>
      ) : null}

      <div
        ref={scrollViewportRef}
        cmdk-list=""
        role="listbox"
        tabIndex={-1}
        aria-label="Suggestions"
        id={listId}
        className="scrollbar-token flex max-h-[min(440px,var(--cmdk-list-height,440px),75vh)] flex-col gap-[var(--spacing)] overflow-y-auto overscroll-contain transition-[max-height] duration-100"
      >
        {sections.map((section) => {
          const startIndex = sections
            .slice(0, sections.indexOf(section))
            .reduce((sum, candidate) => sum + candidate.items.length, 0);
          return (
            <PaletteSection
              key={section.title}
              title={section.title}
              items={section.items}
              listId={listId}
              selectedIndex={selectedIndex}
              startIndex={startIndex}
              onSelectIndex={setSelectedIndex}
              onExecute={handleExecute}
              showSubtitle={showSubtitle}
            />
          );
        })}
        {flatItems.length === 0 ? (
          <div data-cmdk-empty className="flex min-h-[calc(var(--spacing)*8)] items-center justify-center px-[calc(var(--spacing)*2.5)] py-[calc(var(--spacing)*1.5)] text-center text-sm text-token-description-foreground">
            {getEmptyMessage(mode, results.query, mode === "chats" ? chatsLoading : mode === "cards" ? cardsLoading : loading)}
          </div>
        ) : null}
      </div>
    </div>
  );
}
