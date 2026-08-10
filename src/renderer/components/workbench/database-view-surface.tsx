import { CalendarIcon } from "@/components/shared/icons";
import {
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { ArrowDown, ArrowUp, List } from "@/components/shared/icons/generic-icons";
import {
  stableStringifyDatabaseJson,
  type DatabaseJsonValue,
  type DatabasePropertyOption,
} from "../../../shared/database-kernel";
import type {
  DataSourcePageRowV2,
  DataSourcePropertyRecordV2,
} from "../../../shared/database-module-v2";
import type { ColumnPaginationState } from "@/lib/kanban-store";
import { NodexIconButton } from "@/components/ui/button";
import { matchesSearchTokens, tokenizeSearchQuery } from "@/lib/page-search";
import {
  databaseViewSupportsManualReorder,
  buildDatabaseViewMovePageRunOperations,
  buildDatabaseViewPropertyValueOperations,
  canMoveDatabaseViewPage,
  commitDatabaseViewOperations,
  DatabaseViewMutationError,
} from "@/lib/database-view-row-mutations";
import type {
  DatabaseViewRenderColumn,
  DatabaseViewRenderModel,
  DatabaseViewRenderRow,
} from "@/lib/database-view-render-model";
import { readDatabasePropertyOptions } from "@/lib/database-view-authoring";
import { normalizeSearchText } from "@/lib/search-text";
import { dataSourceCalendarDateKey } from "@/lib/data-source-property-date";
import { cn } from "@/lib/utils";
import { parseDataSourcePropertyId } from "../../../shared/database-identities";
import {
  buildDataSourceCreateOptionAndSelectOperations,
  buildDataSourceMultiSelectPatchOperations,
} from "@/lib/data-source-property-value-operations";
import {
  readRelationValuePreview,
  type RelationTargetWindow,
} from "@/lib/data-source-relation-value";
import { DataSourcePropertyValueEditor } from "../database/data-source-property-value-editor";
import { PropertyEditorFeedback } from "../database/property-editor-feedback";
import type { DataSourcePropertyOptionRegistryState } from "../database/data-source-property-editor-binding";
import { usePropertyOptionRegistries } from "../database/use-property-option-registries";
import {
  readDataSourceRelationTargets,
  readDataSourceRelationTargetDescriptor,
  searchDataSourceRelationCandidates,
} from "@/lib/data-source-relation-runtime";
import { useContextualKeyboardActionTarget } from "@/lib/use-contextual-keyboard-action-target";
import { markContextualKeyboardActionTargetActive } from "@/lib/contextual-keyboard-actions";
import type { CommandId } from "../../../shared/command-keybindings";
import {
  resolveBoardKeyboardActionPageIds,
  findBoardKeyboardLocation,
  resolveBoardKeyboardNavigation,
  type BoardKeyboardDirection,
} from "../kanban/board-keyboard-navigation";
import { compileDatabasePagesDragFromQuery } from "../../../shared/database-page-drag";
import { isWorkflowStatus } from "../../../shared/workflow-status";
import { PagePresenceRail } from "../kanban/page-presence-rail";

interface DatabaseViewSurfaceProps {
  readonly model: DatabaseViewRenderModel;
  readonly groupPagination?: ReadonlyMap<string, ColumnPaginationState>;
  readonly onLoadMoreGroup?: (scopeKey: string) => Promise<void> | void;
  readonly searchQuery: string;
  readonly showViewLabel?: boolean;
  readonly onOpenPage: (
    pageId: string,
    titleSnapshot: string,
  ) => void;
  readonly onCommitted?: () => void | Promise<void>;
  readonly commitOperations?: typeof commitDatabaseViewOperations;
  readonly keyboardSurface?: {
    readonly surfaceId: string;
    readonly presentationId: string;
  };
  readonly presentedPageIds?: ReadonlySet<string>;
}

const rowByPageId = (
  model: DatabaseViewRenderModel,
  pageId: string,
): DataSourcePageRowV2 | null =>
  model.query.rows.find((row) => row.page.pageId === pageId) ?? null;

const searchablePropertyValues = (
  model: DatabaseViewRenderModel,
  pageId: string,
): string => {
  const row = rowByPageId(model, pageId);
  if (!row) return "";
  return Object.values(row.values)
    .map((value) => {
      const relation = readRelationValuePreview(value.value);
      if (!relation) return stableStringifyDatabaseJson(value.value);
      return relation.targets
        .flatMap((target) => target.kind === "visible" ? [target.title] : [])
        .join(" ");
    })
    .join(" ");
};

const displayedProperties = (
  model: DatabaseViewRenderModel,
): readonly DataSourcePropertyRecordV2[] => {
  const visible = new Set(model.query.view.config.display.propertyIds);
  return model.query.properties.filter(
    (property) =>
      property.lifecycle === "active"
      && visible.has(property.propertyId),
  );
};

export const databaseViewMutationErrorMessage = (
  error: unknown,
  pageMutation: boolean,
): string => {
  if (
    error instanceof DatabaseViewMutationError
    && error.commandError.code === "revision_conflict"
  ) {
    return pageMutation
      ? "Page position changed elsewhere. Review and try again."
      : "Value changed elsewhere. Review and try again.";
  }
  if (
    error instanceof DatabaseViewMutationError
    && error.commandError.code === "resource_not_found"
  ) {
    return pageMutation
      ? "This page is no longer available."
      : "This property is no longer available.";
  }
  return pageMutation
    ? "Couldn’t move this page. Try again."
    : "Couldn’t save this property. Try again.";
};

function DurablePageSurface({
  model,
  row,
  compact,
  pendingMutationKeys,
  mutationErrors,
  canMoveUp,
  canMoveDown,
  onOpenPage,
  onSetValue,
  onPatchOptions,
  onPatchRelation,
  onCreateOption,
  onLoadRelationTargets,
  onSearchRelationCandidates,
  onLoadRelationTargetDescriptor,
  onRelationValueStale,
  onRequestOptions,
  onRequestMoreOptions,
  optionRegistries,
  optionRegistryStates,
  optionRegistryHasMore,
  optionRegistryLoadingMore,
  onMove,
  highlighted,
  presented,
  selected,
  onHighlight,
}: {
  readonly model: DatabaseViewRenderModel;
  readonly row: DatabaseViewRenderRow;
  readonly compact: boolean;
  readonly pendingMutationKeys: ReadonlyMap<string, number>;
  readonly mutationErrors: ReadonlyMap<string, string>;
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
  readonly onOpenPage: DatabaseViewSurfaceProps["onOpenPage"];
  readonly onSetValue: (
    pageId: string,
    propertyId: string,
    value: DatabaseJsonValue,
  ) => void;
  readonly onPatchRelation: (
    pageId: string,
    propertyId: string,
    delta: { readonly addPageIds: readonly string[]; readonly removeEdgeIds: readonly string[] },
  ) => void;
  readonly onPatchOptions: (
    pageId: string,
    property: DataSourcePropertyRecordV2,
    delta: {
      readonly addOptionIds: readonly string[];
      readonly removeOptionIds: readonly string[];
    },
  ) => void;
  readonly onCreateOption: (
    pageId: string,
    property: DataSourcePropertyRecordV2,
    option: { readonly optionId: string; readonly name: string; readonly color?: string },
  ) => Promise<void>;
  readonly onLoadRelationTargets: (
    pageId: string,
    propertyId: string,
    after: string | null,
  ) => Promise<RelationTargetWindow>;
  readonly onSearchRelationCandidates: (
    property: DataSourcePropertyRecordV2,
    query: string,
    after?: string | null,
  ) => ReturnType<typeof searchDataSourceRelationCandidates>;
  readonly onLoadRelationTargetDescriptor: (
    property: DataSourcePropertyRecordV2,
  ) => ReturnType<typeof readDataSourceRelationTargetDescriptor>;
  readonly onRelationValueStale: () => void;
  readonly onRequestOptions: (property: DataSourcePropertyRecordV2) => void;
  readonly onRequestMoreOptions: (property: DataSourcePropertyRecordV2) => void;
  readonly optionRegistries: Readonly<Record<string, readonly DatabasePropertyOption[]>>;
  readonly optionRegistryStates: Readonly<Record<
    string,
    DataSourcePropertyOptionRegistryState
  >>;
  readonly optionRegistryHasMore: Readonly<Record<string, boolean>>;
  readonly optionRegistryLoadingMore: Readonly<Record<string, boolean>>;
  readonly onMove: (pageId: string, direction: "up" | "down") => void;
  readonly highlighted: boolean;
  readonly presented: boolean;
  readonly selected: boolean;
  readonly onHighlight: (pageId: string) => void;
}) {
  const authority = rowByPageId(model, row.pageId);
  if (!authority) return null;
  const properties = displayedProperties(model);
  const showTitle = model.query.view.config.display.showTitle;
  const movePending = pendingMutationKeys.has(`page:${row.pageId}`);
  return (
    <article
      data-database-view-page-id={row.pageId}
      data-database-view-page-presented={presented ? "true" : undefined}
      tabIndex={highlighted ? 0 : -1}
      aria-selected={selected}
      onPointerDown={() => onHighlight(row.pageId)}
      onFocus={() => onHighlight(row.pageId)}
      className={cn(
        "group/card relative min-w-0 overflow-hidden rounded-lg bg-token-foreground/5 outline-none",
        "hover:bg-token-foreground/8",
        (highlighted || selected) && "ring-1 ring-inset",
        highlighted && !selected
          && "ring-[color-mix(in_srgb,var(--accent-blue)_50%,transparent)]",
        selected
          && "bg-[color-mix(in_srgb,var(--accent-blue)_7%,transparent)] ring-[color-mix(in_srgb,var(--accent-blue)_72%,transparent)]",
        compact ? "px-2.5 py-2" : "px-2 py-1.5",
      )}
    >
      {presented ? <PagePresenceRail /> : null}
      <div className="flex min-h-6 items-center gap-1">
        <button
          type="button"
          aria-label={`Open Page ${row.title}`}
          className={cn(
            "min-w-0 flex-1 text-left text-sm text-token-text-primary outline-none",
            showTitle ? "truncate" : "text-token-description-foreground",
          )}
          onClick={() => onOpenPage(row.pageId, row.title)}
        >
          {showTitle ? row.title || "Untitled" : "Open Page"}
        </button>
        {databaseViewSupportsManualReorder(model) ? (
          <div className="flex shrink-0 opacity-0 group-hover/card:opacity-100 focus-within:opacity-100">
            <NodexIconButton
              icon={ArrowUp}
              size="xs"
              ariaLabel={`Move ${row.title} up`}
              disabled={movePending || !canMoveUp}
              onClick={() => onMove(row.pageId, "up")}
            />
            <NodexIconButton
              icon={ArrowDown}
              size="xs"
              ariaLabel={`Move ${row.title} down`}
              disabled={movePending || !canMoveDown}
              onClick={() => onMove(row.pageId, "down")}
            />
          </div>
        ) : null}
      </div>
      {properties.length > 0 ? (
        <div className={cn("mt-1.5 flex min-w-0 flex-wrap gap-x-2 gap-y-1", compact && "flex-col items-start")}>
          {properties.map((property) => {
            const current = authority.values[property.propertyId];
            const propertyError = mutationErrors.get(
              `value:${row.pageId}:${property.propertyId}`,
            );
            return (
              <div key={property.propertyId} className="min-w-0">
                <DataSourcePropertyValueEditor
                  property={property}
                  value={current?.value}
                  revision={current?.revision ?? 0}
                  disabled={false}
                  pending={
                    pendingMutationKeys.has(`value:${row.pageId}:${property.propertyId}`)
                    || pendingMutationKeys.has(`property:${property.propertyId}`)
                  }
                  options={optionRegistries[property.propertyId]
                    ?? readDatabasePropertyOptions(property)}
                  optionRegistryState={optionRegistryStates[property.propertyId] ?? "ready"}
                  optionRegistryHasMore={optionRegistryHasMore[property.propertyId] ?? false}
                  optionRegistryLoadingMore={
                    optionRegistryLoadingMore[property.propertyId] ?? false
                  }
                  onRequestOptions={() => onRequestOptions(property)}
                  onRequestMoreOptions={() => onRequestMoreOptions(property)}
                  relationCandidates={model.query.rows.map((candidate) => ({
                    pageId: candidate.page.pageId,
                    title: candidate.page.title,
                  }))}
                  onChange={(value) =>
                    onSetValue(row.pageId, property.propertyId, value)}
                  onCreateOption={(option) =>
                    onCreateOption(row.pageId, property, option)}
                  onPatchOptions={(delta) =>
                    onPatchOptions(row.pageId, property, delta)}
                  onPatchRelation={(delta) =>
                    onPatchRelation(row.pageId, property.propertyId, delta)}
                  onLoadRelationTargets={(after) =>
                    onLoadRelationTargets(row.pageId, property.propertyId, after)}
                  onSearchRelationCandidates={(query, after) =>
                    onSearchRelationCandidates(property, query, after)}
                  onLoadRelationTargetDescriptor={() =>
                    onLoadRelationTargetDescriptor(property)}
                  onOpenRelationPage={(pageId, title) => onOpenPage(pageId, title)}
                  onRelationValueStale={onRelationValueStale}
                />
                {propertyError ? (
                  <PropertyEditorFeedback message={propertyError} />
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
      {mutationErrors.get(`page:${row.pageId}`) ? (
        <PropertyEditorFeedback
          message={mutationErrors.get(`page:${row.pageId}`)!}
          className="mt-1"
        />
      ) : null}
    </article>
  );
}

const calendarProperty = (
  model: DatabaseViewRenderModel,
): DataSourcePropertyRecordV2 | null => {
  const visible = displayedProperties(model).find(
    (property) => property.valueType === "date" || property.valueType === "datetime",
  );
  if (visible) return visible;
  return model.query.properties.find(
    (property) =>
      property.lifecycle === "active" &&
      (property.valueType === "date" || property.valueType === "datetime"),
  ) ?? null;
};

const calendarDateKey = (
  model: DatabaseViewRenderModel,
  row: DatabaseViewRenderRow,
  property: DataSourcePropertyRecordV2 | null,
): string | null => {
  if (!property) return null;
  const value = rowByPageId(model, row.pageId)
    ?.values[property.propertyId]?.value;
  return dataSourceCalendarDateKey(
    value,
    property.valueType === "datetime" ? "datetime" : "date",
  );
};

const calendarSections = (
  model: DatabaseViewRenderModel,
  rows: readonly DatabaseViewRenderRow[],
): readonly { readonly id: string; readonly label: string; readonly rows: readonly DatabaseViewRenderRow[] }[] => {
  const property = calendarProperty(model);
  const grouped = new Map<string | null, DatabaseViewRenderRow[]>();
  for (const row of rows) {
    const key = calendarDateKey(model, row, property);
    const current = grouped.get(key) ?? [];
    current.push(row);
    grouped.set(key, current);
  }
  return [...grouped]
    .sort(([left], [right]) => {
      if (left === null) return 1;
      if (right === null) return -1;
      return left.localeCompare(right);
    })
    .map(([key, sectionRows]) => ({
      id: key ?? "undated",
      label: key ?? (property ? `No ${property.name}` : "No date property"),
      rows: sectionRows,
    }));
};

export function DatabaseViewSurface({
  model,
  groupPagination,
  onLoadMoreGroup,
  searchQuery,
  showViewLabel = true,
  onOpenPage,
  onCommitted,
  commitOperations = commitDatabaseViewOperations,
  keyboardSurface,
  presentedPageIds,
}: DatabaseViewSurfaceProps) {
  const [pendingMutationKeys, setPendingMutationKeys] = useState<ReadonlyMap<
    string,
    number
  >>(() => new Map());
  const [mutationErrors, setMutationErrors] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );
  const [highlightedPageId, setHighlightedPageId] = useState<string | null>(null);
  const [selectedPageIds, setSelectedPageIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const keyboardSurfaceFallbackId = useId();
  const surfaceId = keyboardSurface?.surfaceId
    ?? `database-view:${model.databaseViewId}:${keyboardSurfaceFallbackId}`;
  const presentationId = keyboardSurface?.presentationId
    ?? `database-view-presentation:${keyboardSurfaceFallbackId}`;
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const propertyOptionRegistries = usePropertyOptionRegistries({
    accessContext: model.accessContext,
    properties: model.query.properties,
  });
  const {
    options: optionRegistries,
    states: optionRegistryStates,
    hasMore: optionRegistryHasMore,
    loadingMore: optionRegistryLoadingMore,
    requestOptions,
    requestMoreOptions,
  } = propertyOptionRegistries;
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const searchTokens = useMemo(
    () => tokenizeSearchQuery(deferredSearchQuery),
    [deferredSearchQuery],
  );
  const columns = useMemo(
    () => model.columns.map((column): DatabaseViewRenderColumn => ({
      ...column,
      rows: searchTokens.length === 0
        ? column.rows
        : column.rows.filter((row) =>
            matchesSearchTokens(
              normalizeSearchText(
                `${row.title} ${row.preview} ${row.plainText} ${row.tags.join(" ")} ${searchablePropertyValues(model, row.pageId)}`,
              ),
              searchTokens,
            )),
    })),
    [model, searchTokens],
  );
  const allRows = useMemo(
    () => columns.flatMap((column) => column.rows),
    [columns],
  );
  const keyboardBoard = useMemo(() => ({
    columns: columns.map((column) => ({
      id: column.id,
      cards: column.rows.map((row) => ({ id: row.pageId })),
    })),
  }), [columns]);
  const visiblePageIds = useMemo(
    () => new Set(allRows.map((row) => row.pageId)),
    [allRows],
  );

  useEffect(() => {
    setHighlightedPageId((current) =>
      current && !visiblePageIds.has(current) ? null : current
    );
    setSelectedPageIds((current) => {
      const next = new Set(
        [...current].filter((pageId) => visiblePageIds.has(pageId)),
      );
      return next.size === current.size ? current : next;
    });
  }, [visiblePageIds]);
  const continuableScopes = [...(groupPagination?.values() ?? [])]
    .filter((state) => state.hasMore);
  const anyContinuationLoading = continuableScopes
    .some((state) => state.loadingMore);
  const failedContinuations = [...(groupPagination?.values() ?? [])]
    .filter((state) => state.error !== null);
  const loadMoreEverywhere = () => {
    for (const state of continuableScopes) {
      void onLoadMoreGroup?.(state.scopeKey);
    }
  };
  const groupShowMore = (scopeKey: string) => {
    const state = groupPagination?.get(scopeKey);
    if (!state?.hasMore || !onLoadMoreGroup) return null;
    return (
      <button
        type="button"
        disabled={state.loadingMore}
        onClick={() => void onLoadMoreGroup(scopeKey)}
        className="mt-1 w-full rounded-md px-2 py-1 text-left text-xs text-token-text-secondary hover:bg-token-foreground/5 disabled:opacity-50"
      >
        {state.loadingMore ? "Loading…" : "Show more"}
      </button>
    );
  };

  const commit = async (
    operations: Parameters<typeof commitDatabaseViewOperations>[0]["operations"],
    mutationKeys: readonly string[],
    propagateError = false,
  ) => {
    if (operations.length === 0) return;
    setPendingMutationKeys((current) => {
      const next = new Map(current);
      for (const key of mutationKeys) next.set(key, (next.get(key) ?? 0) + 1);
      return next;
    });
    setMutationErrors((current) => {
      const next = new Map(current);
      for (const key of mutationKeys) next.delete(key);
      return next;
    });
    try {
      await commitOperations({
        model,
        operations,
      });
      await onCommitted?.();
    } catch (nextError) {
      console.error("[database-view:mutation]", nextError);
      const pageMutation = mutationKeys.some((key) => key.startsWith("page:"));
      const message = databaseViewMutationErrorMessage(nextError, pageMutation);
      if (!propagateError) {
        setMutationErrors((current) => {
          const next = new Map(current);
          for (const key of mutationKeys) next.set(key, message);
          return next;
        });
      }
      await onCommitted?.();
      if (propagateError) throw nextError;
    } finally {
      setPendingMutationKeys((current) => {
        const next = new Map(current);
        for (const key of mutationKeys) {
          const count = next.get(key) ?? 0;
          if (count <= 1) next.delete(key);
          else next.set(key, count - 1);
        }
        return next;
      });
    }
  };

  const setValue = (
    pageId: string,
    propertyId: string,
    value: DatabaseJsonValue,
  ) => void commit(
    buildDatabaseViewPropertyValueOperations({ model, pageId, propertyId, value }),
    [`value:${pageId}:${propertyId}`],
  );
  const isPageRunGroupComplete = (pageIds: readonly string[]): boolean => {
    const owningColumns = pageIds.map((pageId) =>
      columns.find((column) =>
        column.rows.some((row) => row.pageId === pageId)
      )
    );
    const first = owningColumns[0];
    if (!first || owningColumns.some((column) => column?.id !== first.id)) {
      return false;
    }
    return groupPagination?.get(first.scopeKey)?.hasMore !== true;
  };
  const move = (
    pageIds: string | readonly string[],
    direction: "up" | "down" | "top" | "bottom",
  ) => {
    const orderedPageIds = typeof pageIds === "string" ? [pageIds] : pageIds;
    const groupComplete = isPageRunGroupComplete(orderedPageIds);
    void commit(
      buildDatabaseViewMovePageRunOperations({
        model,
        pageIds: orderedPageIds,
        direction,
        groupComplete,
      }),
      orderedPageIds.map((pageId) => `page:${pageId}`),
    );
  };
  const highlightPage = (pageId: string, focus = false) => {
    setHighlightedPageId(pageId);
    markContextualKeyboardActionTargetActive(surfaceId);
    if (!focus) return;
    requestAnimationFrame(() => {
      const element = Array.from(
        surfaceRef.current?.querySelectorAll<HTMLElement>(
          "[data-database-view-page-id]",
        ) ?? [],
      ).find((candidate) =>
        candidate.dataset.databaseViewPageId === pageId
      );
      element?.focus({ preventScroll: true });
      element?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
  };
  const navigateHighlight = (direction: BoardKeyboardDirection): boolean => {
    const next = resolveBoardKeyboardNavigation(
      keyboardBoard,
      highlightedPageId,
      direction,
    );
    if (!next) return false;
    highlightPage(next.pageId, true);
    return true;
  };
  const activeRow = highlightedPageId
    ? allRows.find((row) => row.pageId === highlightedPageId) ?? null
    : null;
  const actionPageIds = resolveBoardKeyboardActionPageIds(
    keyboardBoard,
    highlightedPageId,
    selectedPageIds,
  );
  const moveDirectionForCommand = (
    commandId: CommandId,
  ): "up" | "down" | "top" | "bottom" | null => {
    if (commandId === "boardMoveUp") return "up";
    if (commandId === "boardMoveDown") return "down";
    if (commandId === "boardMoveTop") return "top";
    if (commandId === "boardMoveBottom") return "bottom";
    return null;
  };
  const buildHorizontalMoveOperations = (
    commandId: "boardMoveLeft" | "boardMoveRight",
  ) => {
    if (model.readOnlyReason) return null;
    const active = findBoardKeyboardLocation(keyboardBoard, highlightedPageId);
    if (!active || actionPageIds.length === 0) return null;
    const offset = commandId === "boardMoveRight" ? 1 : -1;
    const destinationColumn = keyboardBoard.columns[active.columnIndex + offset];
    if (!destinationColumn || !isWorkflowStatus(destinationColumn.id)) return null;
    const sourceStatuses = actionPageIds.map((pageId) =>
      model.query.rows.find((row) => row.page.pageId === pageId)?.effectiveGroupKey
    );
    if (sourceStatuses.some((status) => !isWorkflowStatus(status))) return null;
    const sharedSource = sourceStatuses.every((status) => status === sourceStatuses[0])
      ? sourceStatuses[0]
      : undefined;
    const selected = new Set(actionPageIds);
    const remainingDestinationPageIds = destinationColumn.cards.flatMap((card) =>
      selected.has(card.id) ? [] : [card.id]
    );
    const newOrder = Math.min(active.cardIndex, remainingDestinationPageIds.length);
    try {
      return compileDatabasePagesDragFromQuery({
        query: model.query,
        move: {
          pageIds: [...actionPageIds],
          ...(isWorkflowStatus(sharedSource) ? { fromStatus: sharedSource } : {}),
          toStatus: destinationColumn.id,
          newOrder,
        },
      }).operations;
    } catch {
      return null;
    }
  };
  const canMoveHighlightedPage = (commandId: CommandId): boolean => {
    if (model.readOnlyReason) return false;
    if (commandId === "boardMoveLeft" || commandId === "boardMoveRight") {
      return buildHorizontalMoveOperations(commandId) !== null;
    }
    const direction = moveDirectionForCommand(commandId);
    if (!direction || actionPageIds.length === 0) return false;
    try {
      return buildDatabaseViewMovePageRunOperations({
        model,
        pageIds: actionPageIds,
        direction,
        groupComplete: isPageRunGroupComplete(actionPageIds),
      }).length > 0;
    } catch {
      return false;
    }
  };

  useContextualKeyboardActionTarget({
    surfaceId,
    presentationId,
    canExecute: (commandId) => {
      if (model.query.view.kind !== "kanban") return false;
      if (
        commandId === "boardFocusNext"
        || commandId === "boardFocusPrevious"
        || commandId === "boardFocusLeft"
        || commandId === "boardFocusRight"
      ) return allRows.length > 0;
      if (commandId === "boardClearSelection") {
        return selectedPageIds.size > 0;
      }
      if (
        commandId === "boardOpen"
        || commandId === "boardToggleSelection"
      ) return activeRow !== null;
      if (commandId.startsWith("boardMove")) {
        return canMoveHighlightedPage(commandId);
      }
      return false;
    },
    execute: (commandId) => {
      if (commandId === "boardFocusNext") return navigateHighlight("next");
      if (commandId === "boardFocusPrevious") return navigateHighlight("previous");
      if (commandId === "boardFocusLeft") return navigateHighlight("left");
      if (commandId === "boardFocusRight") return navigateHighlight("right");
      if (commandId === "boardClearSelection") {
        setSelectedPageIds(new Set());
        return true;
      }
      if (commandId === "boardOpen" && activeRow) {
        onOpenPage(activeRow.pageId, activeRow.title);
        return true;
      }
      if (commandId === "boardToggleSelection" && activeRow) {
        setSelectedPageIds((current) => {
          const next = new Set(current);
          if (next.has(activeRow.pageId)) next.delete(activeRow.pageId);
          else next.add(activeRow.pageId);
          return next;
        });
        return true;
      }
      if (commandId === "boardMoveLeft" || commandId === "boardMoveRight") {
        const operations = buildHorizontalMoveOperations(commandId);
        if (!operations) return false;
        void commit(
          operations,
          actionPageIds.map((pageId) => `page:${pageId}`),
        );
        return true;
      }
      const direction = moveDirectionForCommand(commandId);
      if (!direction || !canMoveHighlightedPage(commandId)) return false;
      move(actionPageIds, direction);
      return true;
    },
  });
  const patchRelation = (
    pageId: string,
    propertyId: string,
    delta: { readonly addPageIds: readonly string[]; readonly removeEdgeIds: readonly string[] },
  ) => void commit(
    [{
      kind: "edit_property_values",
      edits: [{
        pageId,
        dataSourceId: model.query.dataSource.dataSourceId,
        propertyId: parseDataSourcePropertyId(propertyId),
        edit: {
          kind: "patch_set",
          delta: { kind: "relation", ...delta },
        },
      }],
    }],
    [`value:${pageId}:${propertyId}`],
  );
  const patchOptions = (
    pageId: string,
    property: DataSourcePropertyRecordV2,
    delta: {
      readonly addOptionIds: readonly string[];
      readonly removeOptionIds: readonly string[];
    },
  ) => void commit(
    buildDataSourceMultiSelectPatchOperations({
      pageId,
      dataSourceId: model.query.dataSource.dataSourceId,
      property,
      ...delta,
    }),
    [`value:${pageId}:${property.propertyId}`],
  );
  const createOption = (
    pageId: string,
    property: DataSourcePropertyRecordV2,
    option: { readonly optionId: string; readonly name: string; readonly color?: string },
  ) => commit(
    buildDataSourceCreateOptionAndSelectOperations({
      pageId,
      dataSourceId: model.query.dataSource.dataSourceId,
      property,
      current: rowByPageId(model, pageId)?.values[property.propertyId],
      option: {
        id: option.optionId,
        name: option.name,
        ...(option.color === undefined ? {} : { color: option.color }),
      },
    }),
    [`property:${property.propertyId}`, `value:${pageId}:${property.propertyId}`],
    true,
  );
  const loadRelationTargets = async (
    pageId: string,
    propertyId: string,
    after: string | null,
  ) => {
    const property = model.query.properties.find(
      (candidate) => candidate.propertyId === propertyId,
    );
    if (!property) throw new Error(`Property is unavailable: ${propertyId}`);
    return await readDataSourceRelationTargets({
      accessContext: model.accessContext,
      pageId,
      property,
      after,
    });
  };
  const searchRelationCandidates = async (
    property: DataSourcePropertyRecordV2,
    query: string,
    after?: string | null,
  ) => {
    return await searchDataSourceRelationCandidates({
      accessContext: model.accessContext,
      property,
      query,
      after,
    });
  };
  const loadRelationTargetDescriptor = async (
    property: DataSourcePropertyRecordV2,
  ) => await readDataSourceRelationTargetDescriptor({
    accessContext: model.accessContext,
    property,
  });
  const pageProps = (row: DatabaseViewRenderRow) => ({
    model,
    row,
    pendingMutationKeys,
    mutationErrors,
    canMoveUp: canMoveDatabaseViewPage({
      model,
      pageId: row.pageId,
      direction: "up",
      groupComplete: isPageRunGroupComplete([row.pageId]),
    }),
    canMoveDown: canMoveDatabaseViewPage({
      model,
      pageId: row.pageId,
      direction: "down",
      groupComplete: isPageRunGroupComplete([row.pageId]),
    }),
    onOpenPage,
    onSetValue: setValue,
    onPatchOptions: patchOptions,
    onPatchRelation: patchRelation,
    onCreateOption: createOption,
    onLoadRelationTargets: loadRelationTargets,
    onSearchRelationCandidates: searchRelationCandidates,
    onLoadRelationTargetDescriptor: loadRelationTargetDescriptor,
    onRelationValueStale: () => {
      void onCommitted?.();
    },
    onRequestOptions: requestOptions,
    onRequestMoreOptions: requestMoreOptions,
    optionRegistries,
    optionRegistryStates,
    optionRegistryHasMore,
    optionRegistryLoadingMore,
    onMove: move,
    highlighted: row.pageId === highlightedPageId,
    presented: presentedPageIds?.has(row.pageId) ?? false,
    selected: selectedPageIds.has(row.pageId),
    onHighlight: highlightPage,
  } as const);

  return (
    <div
      ref={surfaceRef}
      className="flex h-full min-h-0 flex-col bg-token-main-surface-primary"
      data-database-view-id={model.databaseViewId}
      onFocusCapture={() => markContextualKeyboardActionTargetActive(surfaceId)}
      onPointerDownCapture={() => markContextualKeyboardActionTargetActive(surfaceId)}
    >
      {failedContinuations.length > 0 && onLoadMoreGroup ? (
        <div
          role="alert"
          className="mx-3 mt-2 flex min-h-8 items-center gap-2 rounded-md bg-token-error-background/20 px-2.5 text-xs text-token-error-foreground"
        >
          <span className="min-w-0 flex-1 truncate">
            Couldn’t load more pages
          </span>
          <button
            type="button"
            className="shrink-0 rounded-md px-2 py-1 text-token-text-primary hover:bg-token-foreground/5"
            onClick={() => {
              for (const state of failedContinuations) {
                void onLoadMoreGroup(state.scopeKey);
              }
            }}
          >
            Retry
          </button>
        </div>
      ) : null}
      {allRows.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-sm text-token-description-foreground">
          {searchTokens.length > 0
            ? "No matching Pages"
            : "This View has no Pages"}
        </div>
      ) : model.query.view.kind === "kanban" ? (
        <div className="flex min-h-0 flex-1 gap-2 overflow-auto p-3">
          {columns.map((column) => (
            <section key={column.id} className="w-64 shrink-0">
              <div className="mb-1.5 flex h-7 items-center gap-2 px-1 text-xs text-token-text-secondary">
                <span className="min-w-0 flex-1 truncate font-medium text-token-text-primary">{column.name}</span>
                <span>
                  {groupPagination?.get(column.scopeKey)?.totalRows
                    ?? column.rows.length}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                {column.rows.map((row) => (
                  <DurablePageSurface key={row.pageId} compact {...pageProps(row)} />
                ))}
                {groupShowMore(column.scopeKey)}
              </div>
            </section>
          ))}
        </div>
      ) : model.query.view.kind === "calendar" ? (
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <div className="mx-auto max-w-4xl space-y-3">
            {calendarSections(model, allRows).map((section) => (
              <section key={section.id}>
                <div className="mb-1 flex h-7 items-center gap-2 px-2 text-xs text-token-description-foreground">
                  <CalendarIcon className="size-3.5" />
                  <span className="min-w-0 flex-1 font-medium text-token-text-primary">{section.label}</span>
                  <span>{section.rows.length}</span>
                </div>
                <div className="space-y-1">
                  {section.rows.map((row) => (
                    <DurablePageSurface key={row.pageId} compact={false} {...pageProps(row)} />
                  ))}
                </div>
              </section>
            ))}
            {continuableScopes.length > 0 && onLoadMoreGroup ? (
              <button
                type="button"
                disabled={anyContinuationLoading}
                onClick={loadMoreEverywhere}
                className="w-full rounded-md px-2 py-1.5 text-left text-xs text-token-text-secondary hover:bg-token-foreground/5 disabled:opacity-50"
              >
                {anyContinuationLoading ? "Loading…" : "Show more"}
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <div className="mx-auto max-w-4xl">
            {showViewLabel ? (
              <div className="mb-1 flex h-7 items-center gap-2 px-2 text-xs text-token-description-foreground">
                <List className="size-3.5" />
                <span className="min-w-0 flex-1 truncate">{model.databaseName} / {model.viewName}</span>
                <span>{allRows.length}</span>
              </div>
            ) : null}
            <div className="space-y-1">
              {allRows.map((row) => (
                <DurablePageSurface key={row.pageId} compact={false} {...pageProps(row)} />
              ))}
              {continuableScopes.length > 0 && onLoadMoreGroup ? (
                <button
                  type="button"
                  disabled={anyContinuationLoading}
                  onClick={loadMoreEverywhere}
                  className="w-full rounded-md px-2 py-1.5 text-left text-xs text-token-text-secondary hover:bg-token-foreground/5 disabled:opacity-50"
                >
                  {anyContinuationLoading ? "Loading…" : "Show more"}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
