import {
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { ActivitySpinnerIcon, NfmSideMenuChevronRightIcon, PageIcon } from "@/components/shared/icons";
import {
  resolveQueryFreshAccept,
  shouldConsumeStalePickerNavigation,
} from "@/lib/query-fresh-picker";
import { normalizeSearchText } from "@/lib/search-text";
import { StatusIcon } from "@/lib/status-presentation";
import type { BoardSummary, Project } from "@/lib/types";
import { useProjects } from "@/lib/use-projects";
import { useBoardsForProjects } from "@/lib/use-project-board-windows";
import {
  mergeDestinationSearchResults,
  useProjectPageDestinationSearch,
} from "@/lib/use-project-page-destination-search";
import { cn } from "@/lib/utils";
import {
  buildNfmMoveToSections,
  flattenNfmMoveToRows,
  getDefaultNfmMoveToExpandedProjectIds,
  moveNfmMoveToFocusedRowId,
  resolveNfmMoveToFocusedRowId,
  type NfmMoveToDestination,
  type NfmMoveToResultScope,
  type NfmMoveToRow,
  type NfmMoveToSection,
} from "./nfm-move-to-menu-model";
import { createNfmMoveToSearchIndex } from "./nfm-move-to-menu-search";
import { ProjectMarker } from "@/components/workbench/project-marker";
import {
  NodexDestinationPicker,
  NodexDestinationPickerSection,
  NodexDestinationPickerStatus,
} from "@/components/ui/destination-picker";

interface NfmMoveToMenuProps {
  sourceProjectId: string | null;
  sourcePageId: string | null;
  onAccept: (destination: NfmMoveToDestination) => Promise<void> | void;
  onClose: () => void;
  resultScope?: NfmMoveToResultScope;
  ariaLabel?: string;
  placeholder?: string;
}

export interface NfmMoveToMenuSurfaceProps extends NfmMoveToMenuProps {
  projects: readonly Project[];
  boardMap: ReadonlyMap<string, BoardSummary>;
  loading: boolean;
  loadError?: string | null;
  initialQuery?: string;
  loadExpandedBoards?: boolean;
  enableRemotePageSearch?: boolean;
}

const MOVE_TO_MENU_LOAD_DELAY_MS = 400;
const MOVE_TO_MENU_ERROR = "Something went wrong";
const MOVE_TO_ROW_BASE_PADDING_X = 6;
const MOVE_TO_ROW_GAP = 6;
const MOVE_TO_ROW_PROJECT_ICON_SLOT_WIDTH = 22;
const MOVE_TO_ROW_COLUMN_ICON_SLOT_WIDTH = 18;
const MOVE_TO_ROW_COLUMN_PADDING_LEFT =
  MOVE_TO_ROW_BASE_PADDING_X
  + MOVE_TO_ROW_PROJECT_ICON_SLOT_WIDTH
  + MOVE_TO_ROW_GAP
  - MOVE_TO_ROW_COLUMN_ICON_SLOT_WIDTH;

function getMoveToRowDomId(listboxId: string, index: number) {
  return `${listboxId}-option-${index}`;
}

function keepEditorSelection(event: ReactPointerEvent<HTMLElement>) {
  if (event.button !== 0) return;
  event.preventDefault();
}

function MoveToProjectIcon({
  projectAppearance,
  className,
}: {
  projectAppearance: Project["appearance"];
  className?: string;
}) {
  return <ProjectMarker appearance={projectAppearance} className={className} />;
}

function MoveToRowIcon({ row }: { row: NfmMoveToRow }) {
  if (row.kind === "page") return <PageIcon className="size-4" aria-hidden="true" />;
  if (row.kind === "db-column") {
    return (
      <StatusIcon
        statusId={row.columnId}
        label={row.columnName}
        className="size-4"
      />
    );
  }
  return <MoveToProjectIcon projectAppearance={row.projectAppearance} />;
}

function getMoveToRowLabel(row: NfmMoveToRow) {
  if (row.kind === "page") return row.pageTitle;
  if (row.kind === "db-column") return row.columnName;
  return row.projectName;
}

function getMoveToRowMeta(row: NfmMoveToRow) {
  if (row.kind === "page") return `${row.projectName} / ${row.columnName}`;
  if (row.kind === "db-column") return row.projectName;
  return "";
}

function isAcceptableMoveToRow(
  row: NfmMoveToRow,
): row is Extract<NfmMoveToRow, { kind: "page" | "db-column" }> {
  return row.kind === "page" || row.kind === "db-column";
}

function NfmMoveToResultRow({
  row,
  index,
  listboxId,
  focused,
  disabled,
  accepting,
  onToggleProject,
  onAccept,
  onFocusRowChange,
}: {
  row: NfmMoveToRow;
  index: number;
  listboxId: string;
  focused: boolean;
  disabled: boolean;
  accepting: boolean;
  onToggleProject: (projectId: string) => void;
  onAccept: (row: NfmMoveToRow) => void;
  onFocusRowChange: (rowId: string) => void;
}) {
  const metadata = getMoveToRowMeta(row);
  const acceptable = isAcceptableMoveToRow(row);

  return (
    <button
      id={getMoveToRowDomId(listboxId, index)}
      type="button"
      role="option"
      aria-selected={focused}
      aria-expanded={row.kind === "db" ? row.expanded : undefined}
      aria-disabled={disabled || undefined}
      data-focused={focused ? "true" : undefined}
      data-nfm-move-to-row-kind={row.kind}
      className={cn(
        "group flex h-7 w-full select-none items-center gap-1.5 rounded-[7px] pr-2 text-left text-[14px] leading-7 outline-hidden",
        "text-token-foreground",
        disabled ? "cursor-default opacity-55" : "cursor-interaction hover:bg-token-list-hover-background",
        focused && "bg-token-list-hover-background",
      )}
      style={{
        paddingLeft: row.kind === "db-column"
          ? MOVE_TO_ROW_COLUMN_PADDING_LEFT
          : MOVE_TO_ROW_BASE_PADDING_X,
      }}
      onPointerDown={keepEditorSelection}
      onPointerEnter={() => onFocusRowChange(row.id)}
      onClick={(event) => {
        event.stopPropagation();
        if (disabled) return;
        if (row.kind === "db") {
          onToggleProject(row.projectId);
          return;
        }
        onAccept(row);
      }}
    >
      <span
        className={cn(
          "relative flex h-[18px] w-[22px] shrink-0 items-center justify-center text-token-description-foreground",
          row.kind === "db-column" && "w-[18px]",
        )}
      >
        {row.kind === "db" ? (
          <>
            <span
              aria-hidden="true"
              className={cn(
                "absolute inset-0 flex items-center justify-center",
                "group-hover:opacity-0 group-focus-visible:opacity-0",
                focused && "opacity-0",
              )}
            >
              <MoveToRowIcon row={row} />
            </span>
            <NfmSideMenuChevronRightIcon
              className={cn(
                "icon-2xs opacity-0 transition-transform duration-150 ease-out",
                "group-hover:opacity-100 group-focus-visible:opacity-100",
                focused && "opacity-100",
                row.expanded ? "rotate-90" : "rotate-0",
              )}
            />
          </>
        ) : (
          <MoveToRowIcon row={row} />
        )}
      </span>
      <span className="min-w-0 flex-1 truncate">
        {getMoveToRowLabel(row)}
      </span>
      {metadata ? (
        <span className="ml-1 max-w-[108px] shrink truncate text-[12px] leading-4 text-token-description-foreground">
          {metadata}
        </span>
      ) : null}
      {accepting && acceptable ? (
        <ActivitySpinnerIcon className="size-3.5 shrink-0 text-token-description-foreground" />
      ) : null}
    </button>
  );
}

function NfmMoveToSectionView({
  section,
  listboxId,
  startIndex,
  focusedIndex,
  disabled,
  acceptingRowId,
  onToggleProject,
  onAccept,
  onFocusRowChange,
}: {
  section: NfmMoveToSection;
  listboxId: string;
  startIndex: number;
  focusedIndex: number;
  disabled: boolean;
  acceptingRowId: string | null;
  onToggleProject: (projectId: string) => void;
  onAccept: (row: NfmMoveToRow) => void;
  onFocusRowChange: (rowId: string) => void;
}) {
  if (section.rows.length === 0) return null;

  return (
    <NodexDestinationPickerSection label={section.label}>
        {section.rows.map((row, offset) => {
          const index = startIndex + offset;
          return (
            <NfmMoveToResultRow
              key={row.id}
              row={row}
              index={index}
              listboxId={listboxId}
              focused={focusedIndex === index}
              disabled={disabled}
              accepting={acceptingRowId === row.id}
              onToggleProject={onToggleProject}
              onAccept={onAccept}
              onFocusRowChange={onFocusRowChange}
            />
          );
        })}
    </NodexDestinationPickerSection>
  );
}

export function NfmMoveToMenu({
  sourceProjectId,
  sourcePageId,
  onAccept,
  onClose,
  resultScope,
  ariaLabel,
  placeholder,
}: NfmMoveToMenuProps) {
  const {
    projects,
    loading,
    error,
  } = useProjects();

  return (
    <NfmMoveToMenuSurface
      projects={projects}
      boardMap={new Map()}
      loading={loading}
      loadError={error}
      loadExpandedBoards
      enableRemotePageSearch
      sourceProjectId={sourceProjectId}
      sourcePageId={sourcePageId}
      onAccept={onAccept}
      onClose={onClose}
      resultScope={resultScope}
      ariaLabel={ariaLabel}
      placeholder={placeholder}
    />
  );
}

export function NfmMoveToMenuSurface({
  projects,
  boardMap: providedBoardMap,
  sourceProjectId,
  sourcePageId,
  loading,
  loadError = null,
  initialQuery = "",
  loadExpandedBoards = false,
  enableRemotePageSearch = false,
  resultScope = "all",
  ariaLabel = "Move blocks to",
  placeholder = "Move blocks to…",
  onAccept,
  onClose,
}: NfmMoveToMenuSurfaceProps) {
  const listboxId = useId();
  const comboboxId = useId();
  const [query, setQuery] = useState(initialQuery);
  const deferredQuery = useDeferredValue(query);
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null);
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(
    () => getDefaultNfmMoveToExpandedProjectIds(projects, sourceProjectId),
  );
  const expandedProjects = useMemo(
    () =>
      loadExpandedBoards
        ? projects.filter((project) => expandedProjectIds.has(project.id))
        : [],
    [expandedProjectIds, loadExpandedBoards, projects],
  );
  const expandedBoards = useBoardsForProjects(expandedProjects);
  const boardMap = useMemo(() => {
    if (!loadExpandedBoards) return providedBoardMap;
    return new Map([...providedBoardMap, ...expandedBoards.boards]);
  }, [expandedBoards.boards, loadExpandedBoards, providedBoardMap]);
  const resolvedLoading = loading || expandedBoards.loading;
  const resolvedLoadError = loadError ?? expandedBoards.error;
  const [acceptingRowId, setAcceptingRowId] = useState<string | null>(null);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [showDelayedLoading, setShowDelayedLoading] = useState(false);

  useEffect(() => {
    setExpandedProjectIds(getDefaultNfmMoveToExpandedProjectIds(projects, sourceProjectId));
  }, [projects, sourceProjectId]);

  useEffect(() => {
    setQuery(initialQuery);
    setFocusedRowId(null);
  }, [initialQuery]);

  useEffect(() => {
    if (!resolvedLoading) {
      setShowDelayedLoading(false);
      return;
    }

    const timer = window.setTimeout(() => {
      setShowDelayedLoading(true);
    }, MOVE_TO_MENU_LOAD_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [resolvedLoading]);

  const searchIndex = useMemo(
    () => createNfmMoveToSearchIndex({
      projects,
      boardMap,
      sourceProjectId,
      sourcePageId,
    }),
    [boardMap, projects, sourcePageId, sourceProjectId],
  );
  const searchResult = useMemo(
    () => searchIndex.search(deferredQuery),
    [deferredQuery, searchIndex],
  );
  const remoteSearchResult = useProjectPageDestinationSearch({
    projects,
    query: deferredQuery,
    enabled: enableRemotePageSearch && resultScope !== "db-only",
    sourceProjectId,
    sourcePageId,
  });
  const resolvedSearchResult = useMemo(
    () => mergeDestinationSearchResults(searchResult, remoteSearchResult),
    [remoteSearchResult, searchResult],
  );
  const sections = useMemo(
    () => buildNfmMoveToSections({
      projects,
      boardMap,
      sourceProjectId,
      sourcePageId,
      expandedProjectIds,
      query: deferredQuery,
      searchResult: resolvedSearchResult,
      resultScope,
    }),
    [
      boardMap,
      deferredQuery,
      expandedProjectIds,
      projects,
      resultScope,
      resolvedSearchResult,
      sourcePageId,
      sourceProjectId,
    ],
  );
  const rows = useMemo(() => flattenNfmMoveToRows(sections), [sections]);
  const buildRowsForQuery = useCallback((nextQuery: string): readonly NfmMoveToRow[] => {
    const nextSearchResult = normalizeSearchText(nextQuery) === resolvedSearchResult.normalizedQuery
      ? resolvedSearchResult
      : searchIndex.search(nextQuery);
    const nextSections = buildNfmMoveToSections({
      projects,
      boardMap,
      sourceProjectId,
      sourcePageId,
      expandedProjectIds,
      query: nextQuery,
      searchResult: nextSearchResult,
      resultScope,
    });
    return flattenNfmMoveToRows(nextSections);
  }, [
    boardMap,
    expandedProjectIds,
    projects,
    resultScope,
    resolvedSearchResult,
    searchIndex,
    sourcePageId,
    sourceProjectId,
  ]);
  const rowsStale = shouldConsumeStalePickerNavigation({
    liveQuery: query,
    rowsQuery: deferredQuery,
    normalizeQuery: normalizeSearchText,
  });
  const resolvedFocusedRowId = resolveNfmMoveToFocusedRowId(
    focusedRowId,
    deferredQuery,
    rows,
  );
  const focusedIndex = resolvedFocusedRowId
    ? rows.findIndex((row) => row.id === resolvedFocusedRowId)
    : -1;
  const activeDescendantId = focusedIndex >= 0 && focusedIndex < rows.length
    ? getMoveToRowDomId(listboxId, focusedIndex)
    : undefined;
  const displayError = acceptError ?? resolvedLoadError;
  const visibleRowCount = rows.length;
  const disabled = Boolean(acceptingRowId);

  const toggleProject = useCallback((projectId: string) => {
    setExpandedProjectIds((current) => {
      const next = new Set(current);
      if (next.has(projectId)) {
        next.delete(projectId);
        return next;
      }
      next.add(projectId);
      return next;
    });
  }, []);

  const acceptRow = useCallback(async (row: NfmMoveToRow) => {
    if (!isAcceptableMoveToRow(row)) return;
    setAcceptError(null);
    setAcceptingRowId(row.id);
    try {
      await onAccept(row.destination);
      setAcceptingRowId(null);
    } catch {
      setAcceptError(MOVE_TO_MENU_ERROR);
      setAcceptingRowId(null);
    }
  }, [onAccept]);

  const activateRow = useCallback((row: NfmMoveToRow | undefined) => {
    if (!row || disabled) return;
    if (row.kind === "db") {
      toggleProject(row.projectId);
      return;
    }
    void acceptRow(row);
  }, [acceptRow, disabled, toggleProject]);

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (rowsStale) return;
      setFocusedRowId((currentRowId) =>
        moveNfmMoveToFocusedRowId(
          resolveNfmMoveToFocusedRowId(currentRowId, deferredQuery, rows),
          1,
          rows,
        )
      );
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (rowsStale) return;
      setFocusedRowId((currentRowId) =>
        moveNfmMoveToFocusedRowId(
          resolveNfmMoveToFocusedRowId(currentRowId, deferredQuery, rows),
          -1,
          rows,
        )
      );
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const result = resolveQueryFreshAccept({
        liveQuery: query,
        rowsQuery: deferredQuery,
        rows,
        focusedIndex,
        buildFreshRows: buildRowsForQuery,
        getRowId: (row) => row.id,
        normalizeQuery: normalizeSearchText,
      });
      if (result.status === "accepted") {
        activateRow(result.row);
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  let rowIndex = 0;

  return (
    <NodexDestinationPicker
      ariaLabel={ariaLabel}
      placeholder={placeholder}
      query={query}
      inputId={comboboxId}
      listboxId={listboxId}
      activeDescendantId={activeDescendantId}
      busy={rowsStale || resolvedLoading}
      onQueryChange={(nextQuery) => {
        setAcceptError(null);
        setFocusedRowId(null);
        setQuery(nextQuery);
      }}
      onKeyDown={handleInputKeyDown}
    >
          {sections.map((section) => {
            const startIndex = rowIndex;
            rowIndex += section.rows.length;
            return (
              <NfmMoveToSectionView
                key={section.key}
                section={section}
                listboxId={listboxId}
                startIndex={startIndex}
                focusedIndex={focusedIndex}
                disabled={disabled}
                acceptingRowId={acceptingRowId}
                onToggleProject={(projectId) => {
                  if (rowsStale) return;
                  toggleProject(projectId);
                }}
                onAccept={(row) => {
                  if (rowsStale) return;
                  void acceptRow(row);
                }}
                onFocusRowChange={(rowId) => {
                  if (rowsStale) return;
                  setFocusedRowId(rowId);
                }}
              />
            );
          })}
          {showDelayedLoading ? (
            <NodexDestinationPickerStatus>
              <ActivitySpinnerIcon className="mr-2 size-3.5 text-token-description-foreground" />
              Loading…
            </NodexDestinationPickerStatus>
          ) : null}
          {displayError ? (
            <NodexDestinationPickerStatus>{MOVE_TO_MENU_ERROR}</NodexDestinationPickerStatus>
          ) : null}
          {!resolvedLoading && !displayError && visibleRowCount === 0 ? (
            <NodexDestinationPickerStatus>No results</NodexDestinationPickerStatus>
          ) : null}
    </NodexDestinationPicker>
  );
}
