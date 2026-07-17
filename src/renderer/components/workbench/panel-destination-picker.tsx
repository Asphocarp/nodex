import {
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
  type ReactNode,
} from "react";
import {
  CodexFolderIcon,
  SpinnerIcon,
} from "@/components/shared/icons";
import { createNfmMoveToSearchIndex } from "@/components/kanban/editor/nfm-move-to-menu-search";
import { normalizeProjectIcon } from "@/lib/project-icon";
import {
  resolveQueryFreshAccept,
  shouldConsumeStalePickerNavigation,
} from "@/lib/query-fresh-picker";
import { normalizeSearchText } from "@/lib/search-text";
import type { BoardSummary, Project } from "@/lib/types";
import { useBoardsForProjects } from "@/lib/use-all-boards";
import { readDatabaseModule } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  DATABASE_MODULE_V2_CONTRACT_VERSION,
  type DatabaseContainerDescriptorV2,
} from "../../../shared/database-module-v2";
import {
  buildPanelDestinationSections,
  flattenPanelDestinationRows,
  movePanelDestinationFocusedRowId,
  resolvePanelDestinationFocusedRowId,
  type PanelDestination,
  type PanelDestinationPickerScope,
  type PanelDestinationRow,
  type PanelDestinationSection,
} from "./panel-destination-picker-model";

interface PanelDestinationPickerProps {
  projects: readonly Project[];
  onAccept: (destination: PanelDestination) => Promise<void> | void;
  onClose: () => void;
  scope?: PanelDestinationPickerScope;
  ariaLabel?: string;
  placeholder?: string;
  currentProjectId?: string | null;
}

export interface PanelDestinationPickerSurfaceProps extends PanelDestinationPickerProps {
  boardMap: ReadonlyMap<string, BoardSummary>;
  databaseDescriptorMap: ReadonlyMap<string, DatabaseContainerDescriptorV2>;
  loading: boolean;
  loadError?: string | null;
  initialQuery?: string;
}

const PANEL_DESTINATION_LOAD_DELAY_MS = 400;
const PANEL_DESTINATION_ERROR = "Something went wrong";

function getPanelDestinationRowDomId(listboxId: string, index: number) {
  return `${listboxId}-option-${index}`;
}

function PanelDestinationStatusRow({
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

function PanelDestinationProjectIcon({
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

  return (
    <CodexFolderIcon
      className={cn("text-token-description-foreground", className)}
    />
  );
}

function PanelDestinationRowIcon({ row }: { row: PanelDestinationRow }) {
  if (row.kind === "page") return <FileText className="size-4" aria-hidden="true" />;
  return <PanelDestinationProjectIcon projectIcon={row.projectIcon} />;
}

function getPanelDestinationRowLabel(row: PanelDestinationRow) {
  if (row.kind === "page") return row.pageTitle;
  return row.viewName;
}

function getPanelDestinationRowMeta(row: PanelDestinationRow) {
  if (row.kind === "page") return `${row.projectName} / ${row.columnName}`;
  return `${row.projectName} / ${row.databaseName}`;
}

function useProjectDatabaseDescriptors(
  projects: readonly Project[],
  enabled: boolean,
): {
  readonly descriptors: ReadonlyMap<string, DatabaseContainerDescriptorV2>;
  readonly loading: boolean;
  readonly error: string | null;
} {
  const projectKey = projects.map((project) => project.id).join("\u0000");
  const [state, setState] = useState<{
    descriptors: ReadonlyMap<string, DatabaseContainerDescriptorV2>;
    loading: boolean;
    error: string | null;
  }>(() => ({ descriptors: new Map(), loading: enabled, error: null }));

  useEffect(() => {
    if (!enabled) {
      setState({ descriptors: new Map(), loading: false, error: null });
      return;
    }
    let cancelled = false;
    setState((current) => ({ ...current, loading: true, error: null }));
    const projectIds = projectKey ? projectKey.split("\u0000") : [];
    void Promise.all(projectIds.map(async (projectId) => {
      const result = await readDatabaseModule(projectId, {
        version: DATABASE_MODULE_V2_CONTRACT_VERSION,
        projectId,
        read: { target: { kind: "project_default" }, mode: "database" },
      });
      if (!result.ok) throw new Error("Database Views could not be loaded");
      if (result.value.value.kind !== "database") {
        throw new Error("Database Module did not return the bound Database");
      }
      return [projectId, result.value.value.value] as const;
    })).then((entries) => {
      if (cancelled) return;
      setState({
        descriptors: new Map(entries),
        loading: false,
        error: null,
      });
    }).catch(() => {
      if (cancelled) return;
      setState({
        descriptors: new Map(),
        loading: false,
        error: "Something went wrong",
      });
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, projectKey]);

  return state;
}

function PanelDestinationResultRow({
  row,
  index,
  listboxId,
  focused,
  disabled,
  accepting,
  onAccept,
  onFocusRowChange,
}: {
  row: PanelDestinationRow;
  index: number;
  listboxId: string;
  focused: boolean;
  disabled: boolean;
  accepting: boolean;
  onAccept: (row: PanelDestinationRow) => void;
  onFocusRowChange: (rowId: string) => void;
}) {
  const metadata = getPanelDestinationRowMeta(row);

  return (
    <button
      id={getPanelDestinationRowDomId(listboxId, index)}
      type="button"
      role="option"
      aria-selected={focused}
      aria-disabled={disabled || undefined}
      data-focused={focused ? "true" : undefined}
      data-panel-destination-row-kind={row.kind}
      className={cn(
        "group flex h-7 w-full select-none items-center gap-1.5 rounded-[7px] pr-2 pl-1.5 text-left text-[14px] leading-7 outline-hidden",
        "text-token-foreground",
        disabled ? "cursor-default opacity-55" : "cursor-interaction hover:bg-token-list-hover-background",
        focused && "bg-token-list-hover-background",
      )}
      onPointerEnter={() => onFocusRowChange(row.id)}
      onClick={(event) => {
        event.stopPropagation();
        if (disabled) return;
        onAccept(row);
      }}
    >
      <span className="flex h-[18px] w-[22px] shrink-0 items-center justify-center text-token-description-foreground">
        <PanelDestinationRowIcon row={row} />
      </span>
      <span className="min-w-0 flex-1 truncate">
        {getPanelDestinationRowLabel(row)}
      </span>
      {metadata ? (
        <span className="ml-1 max-w-[128px] shrink truncate text-[12px] leading-4 text-token-description-foreground">
          {metadata}
        </span>
      ) : null}
      {accepting ? (
        <SpinnerIcon className="size-3.5 shrink-0 text-token-description-foreground" />
      ) : null}
    </button>
  );
}

function PanelDestinationSectionView({
  section,
  listboxId,
  startIndex,
  focusedIndex,
  disabled,
  acceptingRowId,
  onAccept,
  onFocusRowChange,
}: {
  section: PanelDestinationSection;
  listboxId: string;
  startIndex: number;
  focusedIndex: number;
  disabled: boolean;
  acceptingRowId: string | null;
  onAccept: (row: PanelDestinationRow) => void;
  onFocusRowChange: (rowId: string) => void;
}) {
  if (section.rows.length === 0) return null;

  return (
    <div className="pb-1">
      <div className="flex h-7 items-end px-[14px] pt-3 pb-1 text-[12px] leading-4 font-medium text-token-description-foreground">
        <span className="min-w-0 flex-1 truncate">{section.label}</span>
      </div>
      <div className="flex flex-col gap-px px-1">
        {section.rows.map((row, offset) => {
          const index = startIndex + offset;
          return (
            <PanelDestinationResultRow
              key={row.id}
              row={row}
              index={index}
              listboxId={listboxId}
              focused={focusedIndex === index}
              disabled={disabled}
              accepting={acceptingRowId === row.id}
              onAccept={onAccept}
              onFocusRowChange={onFocusRowChange}
            />
          );
        })}
      </div>
    </div>
  );
}

export function PanelDestinationPicker({
  projects,
  onAccept,
  onClose,
  scope,
  ariaLabel,
  placeholder,
  currentProjectId,
}: PanelDestinationPickerProps) {
  const {
    boards,
    loading,
    error,
  } = useBoardsForProjects(projects);
  const databaseDescriptors = useProjectDatabaseDescriptors(
    projects,
    scope !== "page-only",
  );

  return (
    <PanelDestinationPickerSurface
      projects={projects}
      boardMap={boards}
      databaseDescriptorMap={databaseDescriptors.descriptors}
      loading={loading || databaseDescriptors.loading}
      loadError={error ?? databaseDescriptors.error}
      onAccept={onAccept}
      onClose={onClose}
      scope={scope}
      ariaLabel={ariaLabel}
      placeholder={placeholder}
      currentProjectId={currentProjectId}
    />
  );
}

export function PanelDestinationPickerSurface({
  projects,
  boardMap,
  databaseDescriptorMap,
  loading,
  loadError = null,
  initialQuery = "",
  scope = "all",
  ariaLabel = "Open panel tab",
  placeholder = "Open Database or Page…",
  currentProjectId = null,
  onAccept,
  onClose,
}: PanelDestinationPickerSurfaceProps) {
  const listboxId = useId();
  const comboboxId = useId();
  const [query, setQuery] = useState(initialQuery);
  const deferredQuery = useDeferredValue(query);
  const [focusedRowId, setFocusedRowId] = useState<string | null>(null);
  const [acceptingRowId, setAcceptingRowId] = useState<string | null>(null);
  const [acceptError, setAcceptError] = useState<string | null>(null);
  const [showDelayedLoading, setShowDelayedLoading] = useState(false);

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
    }, PANEL_DESTINATION_LOAD_DELAY_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [loading]);

  const searchIndex = useMemo(
    () => createNfmMoveToSearchIndex({
      projects,
      boardMap,
      sourceProjectId: null,
      sourcePageId: null,
    }),
    [boardMap, projects],
  );
  const searchResult = useMemo(
    () => searchIndex.search(deferredQuery),
    [deferredQuery, searchIndex],
  );
  const sections = useMemo(
    () => buildPanelDestinationSections({
      projects,
      boardMap,
      databaseDescriptorMap,
      query: deferredQuery,
      searchResult,
      scope,
      currentProjectId,
    }),
    [boardMap, currentProjectId, databaseDescriptorMap, deferredQuery, projects, scope, searchResult],
  );
  const rows = useMemo(() => flattenPanelDestinationRows(sections), [sections]);
  const buildRowsForQuery = useCallback((nextQuery: string): readonly PanelDestinationRow[] => {
    const nextSearchResult = searchIndex.search(nextQuery);
    const nextSections = buildPanelDestinationSections({
      projects,
      boardMap,
      databaseDescriptorMap,
      query: nextQuery,
      searchResult: nextSearchResult,
      scope,
      currentProjectId,
    });
    return flattenPanelDestinationRows(nextSections);
  }, [
    boardMap,
    currentProjectId,
    databaseDescriptorMap,
    projects,
    scope,
    searchIndex,
  ]);
  const rowsStale = shouldConsumeStalePickerNavigation({
    liveQuery: query,
    rowsQuery: deferredQuery,
    normalizeQuery: normalizeSearchText,
  });
  const resolvedFocusedRowId = resolvePanelDestinationFocusedRowId(
    focusedRowId,
    deferredQuery,
    rows,
  );
  const focusedIndex = resolvedFocusedRowId
    ? rows.findIndex((row) => row.id === resolvedFocusedRowId)
    : -1;
  const activeDescendantId = focusedIndex >= 0 && focusedIndex < rows.length
    ? getPanelDestinationRowDomId(listboxId, focusedIndex)
    : undefined;
  const displayError = acceptError ?? loadError;
  const disabled = Boolean(acceptingRowId);

  const acceptRow = useCallback(async (row: PanelDestinationRow) => {
    setAcceptError(null);
    setAcceptingRowId(row.id);
    try {
      await onAccept(row.destination);
      setAcceptingRowId(null);
      onClose();
    } catch {
      setAcceptError(PANEL_DESTINATION_ERROR);
      setAcceptingRowId(null);
    }
  }, [onAccept, onClose]);

  const activateRow = useCallback((row: PanelDestinationRow | undefined) => {
    if (!row || disabled) return;
    void acceptRow(row);
  }, [acceptRow, disabled]);

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (rowsStale) return;
      setFocusedRowId((currentRowId) =>
        movePanelDestinationFocusedRowId(
          resolvePanelDestinationFocusedRowId(currentRowId, deferredQuery, rows),
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
        movePanelDestinationFocusedRowId(
          resolvePanelDestinationFocusedRowId(currentRowId, deferredQuery, rows),
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
        <div id={listboxId} role="listbox" aria-labelledby={comboboxId} aria-busy={rowsStale || loading}>
          {sections.map((section) => {
            const startIndex = rowIndex;
            rowIndex += section.rows.length;
            return (
              <PanelDestinationSectionView
                key={section.key}
                section={section}
                listboxId={listboxId}
                startIndex={startIndex}
                focusedIndex={focusedIndex}
                disabled={disabled}
                acceptingRowId={acceptingRowId}
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
            <PanelDestinationStatusRow>
              <SpinnerIcon className="mr-2 size-3.5 text-token-description-foreground" />
              Loading…
            </PanelDestinationStatusRow>
          ) : null}
          {displayError ? (
            <PanelDestinationStatusRow>{PANEL_DESTINATION_ERROR}</PanelDestinationStatusRow>
          ) : null}
          {!loading && !displayError && rows.length === 0 ? (
            <PanelDestinationStatusRow>No results</PanelDestinationStatusRow>
          ) : null}
        </div>
      </div>
    </div>
  );
}
