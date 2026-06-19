import {
  Database,
  FileText,
  Search,
} from "lucide-react";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  NfmSideMenuChevronRightIcon,
  SpinnerIcon,
} from "@/components/shared/icons";
import { normalizeProjectIcon } from "@/lib/project-icon";
import type { BoardSummary, Project } from "@/lib/types";
import { useAllBoards } from "@/lib/use-all-boards";
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

interface NfmMoveToMenuProps {
  sourceProjectId: string | null;
  sourceCardId: string | null;
  onAccept: (destination: NfmMoveToDestination) => Promise<void> | void;
  onClose: () => void;
  resultScope?: NfmMoveToResultScope;
  ariaLabel?: string;
  placeholder?: string;
}

export interface NfmMoveToMenuSurfaceProps extends NfmMoveToMenuProps {
  projects: Project[];
  boardMap: ReadonlyMap<string, BoardSummary>;
  loading: boolean;
  loadError?: string | null;
  initialQuery?: string;
}

const MOVE_TO_MENU_LOAD_DELAY_MS = 400;
const MOVE_TO_MENU_ERROR = "Something went wrong";

function getMoveToRowDomId(listboxId: string, index: number) {
  return `${listboxId}-option-${index}`;
}

function keepEditorSelection(event: ReactPointerEvent<HTMLElement>) {
  if (event.button !== 0) return;
  event.preventDefault();
}

function MoveToProjectIcon({
  projectIcon,
  className,
}: {
  projectIcon?: string;
  className?: string;
}) {
  const normalizedIcon = normalizeProjectIcon(projectIcon);
  if (normalizedIcon) {
    return (
      <span
        aria-hidden="true"
        className={cn("text-[15px] leading-none", className)}
      >
        {normalizedIcon}
      </span>
    );
  }

  return <Database className={cn("size-4", className)} aria-hidden="true" />;
}

function MoveToColumnIcon() {
  return (
    <span
      aria-hidden="true"
      className="size-2 rounded-full bg-token-foreground/35 ring-[3px] ring-token-foreground/5"
    />
  );
}

function MoveToRowIcon({ row }: { row: NfmMoveToRow }) {
  if (row.kind === "card") return <FileText className="size-4" aria-hidden="true" />;
  if (row.kind === "db-column") return <MoveToColumnIcon />;
  return <MoveToProjectIcon projectIcon={row.projectIcon} />;
}

function getMoveToRowLabel(row: NfmMoveToRow) {
  if (row.kind === "card") return row.cardTitle;
  if (row.kind === "db-column") return row.columnName;
  return row.projectName;
}

function getMoveToRowMeta(row: NfmMoveToRow) {
  if (row.kind === "card") return `${row.projectName} / ${row.columnName}`;
  if (row.kind === "db-column") return row.projectName;
  return "";
}

function isAcceptableMoveToRow(
  row: NfmMoveToRow,
): row is Extract<NfmMoveToRow, { kind: "card" | "db-column" }> {
  return row.kind === "card" || row.kind === "db-column";
}

function MoveToStatusRow({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="flex h-9 items-center px-3 text-[13px] leading-5 text-token-description-foreground">
      {children}
    </div>
  );
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
      style={{ paddingLeft: row.kind === "db-column" ? 28 : 6 }}
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
      {row.kind === "db" ? (
        <span className="flex size-5 shrink-0 items-center justify-center text-token-description-foreground">
          <NfmSideMenuChevronRightIcon
            className={cn(
              "size-3 transition-transform duration-150 ease-out",
              row.expanded ? "rotate-90" : "rotate-0",
            )}
          />
        </span>
      ) : null}
      <span
        className={cn(
          "flex h-[18px] w-[22px] shrink-0 items-center justify-center text-token-description-foreground",
          row.kind === "db-column" && "w-[18px]",
        )}
      >
        <MoveToRowIcon row={row} />
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
        <SpinnerIcon className="size-3.5 shrink-0 text-token-description-foreground" />
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
    <div className="pb-1">
      <div className="flex h-7 items-end px-[14px] pb-1 pt-3 text-[12px] leading-4 font-medium text-token-description-foreground">
        <span className="min-w-0 flex-1 truncate">{section.label}</span>
      </div>
      <div className="flex flex-col gap-px px-1">
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
      </div>
    </div>
  );
}

export function NfmMoveToMenu({
  sourceProjectId,
  sourceCardId,
  onAccept,
  onClose,
  resultScope,
  ariaLabel,
  placeholder,
}: NfmMoveToMenuProps) {
  const {
    projects,
    boards,
    loading,
    error,
  } = useAllBoards();

  return (
    <NfmMoveToMenuSurface
      projects={projects}
      boardMap={boards}
      loading={loading}
      loadError={error}
      sourceProjectId={sourceProjectId}
      sourceCardId={sourceCardId}
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
  boardMap,
  sourceProjectId,
  sourceCardId,
  loading,
  loadError = null,
  initialQuery = "",
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
    if (!loading) {
      setShowDelayedLoading(false);
      return;
    }

    const timer = window.setTimeout(() => {
      setShowDelayedLoading(true);
    }, MOVE_TO_MENU_LOAD_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [loading]);

  const searchIndex = useMemo(
    () => createNfmMoveToSearchIndex({
      projects,
      boardMap,
      sourceProjectId,
      sourceCardId,
    }),
    [boardMap, projects, sourceCardId, sourceProjectId],
  );
  const searchResult = useMemo(
    () => searchIndex.search(deferredQuery),
    [deferredQuery, searchIndex],
  );
  const sections = useMemo(
    () => buildNfmMoveToSections({
      projects,
      boardMap,
      sourceProjectId,
      sourceCardId,
      expandedProjectIds,
      query: deferredQuery,
      searchResult,
      resultScope,
    }),
    [
      boardMap,
      deferredQuery,
      expandedProjectIds,
      projects,
      resultScope,
      searchResult,
      sourceCardId,
      sourceProjectId,
    ],
  );
  const rows = useMemo(() => flattenNfmMoveToRows(sections), [sections]);
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
  const displayError = acceptError ?? loadError;
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
      activateRow(rows[focusedIndex]);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  };

  let rowIndex = 0;

  return (
    <div
      role="dialog"
      aria-label={ariaLabel}
      className="flex max-h-[70vh] w-[330px] max-w-[calc(100vw-24px)] flex-col overflow-hidden text-[14px] leading-[1.2]"
      contentEditable={false}
    >
      <div className="flex h-[38px] shrink-0 items-center gap-1.5 px-2 py-[5px]">
        <Search className="size-4 shrink-0 text-token-description-foreground" aria-hidden="true" />
        <input
          id={comboboxId}
          role="combobox"
          aria-label={ariaLabel}
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded="true"
          aria-haspopup="listbox"
          aria-activedescendant={activeDescendantId}
          value={query}
          placeholder={placeholder}
          className="h-7 min-w-0 flex-1 rounded-[7px] bg-transparent px-1.5 py-[3px] text-[14px] text-token-foreground outline-hidden placeholder:text-token-description-foreground focus:bg-token-foreground/5"
          onChange={(event) => {
            setAcceptError(null);
            setFocusedRowId(null);
            setQuery(event.target.value);
          }}
          onKeyDown={handleInputKeyDown}
        />
      </div>
      <div className="notion-scroller vertical h-[374px] min-h-0 overflow-y-auto pb-3">
        <div id={listboxId} role="listbox" aria-labelledby={comboboxId}>
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
                onToggleProject={toggleProject}
                onAccept={(row) => {
                  void acceptRow(row);
                }}
                onFocusRowChange={setFocusedRowId}
              />
            );
          })}
          {showDelayedLoading ? (
            <MoveToStatusRow>
              <SpinnerIcon className="mr-2 size-3.5 text-token-description-foreground" />
              Loading…
            </MoveToStatusRow>
          ) : null}
          {displayError ? (
            <MoveToStatusRow>{MOVE_TO_MENU_ERROR}</MoveToStatusRow>
          ) : null}
          {!loading && !displayError && visibleRowCount === 0 ? (
            <MoveToStatusRow>No results</MoveToStatusRow>
          ) : null}
        </div>
      </div>
    </div>
  );
}
