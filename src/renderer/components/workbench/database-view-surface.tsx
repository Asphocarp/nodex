import {
  useDeferredValue,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type DragEvent as ReactDragEvent,
} from "react";
import { ArrowDown, ArrowUp, GripVertical } from "@/components/shared/icons/generic-icons";
import {
  type DatabaseViewLayout,
  type DatabaseViewPresentationConfig,
  type EffectiveDatabaseViewPresentation,
  type DatabaseJsonValue,
  type DatabasePropertyOption,
} from "../../../shared/database-kernel";
import type {
  DataSourcePageRowV2,
  DataSourcePropertyRecordV2,
} from "../../../shared/database-module-v2";
import type { ColumnPaginationState } from "@/lib/board-store";
import { NodexIconButton } from "@/components/ui/button";
import {
  compilePageCollectionSearchQuery,
  matchesPageCollectionSearchQuery,
} from "@/lib/page-search";
import {
  databaseViewSupportsManualReorder,
  buildDatabaseViewMovePageRunOperations,
  buildDatabaseViewPropertyValueOperations,
  canMoveDatabaseViewPage,
  commitDatabaseViewOperations,
  DatabaseViewMutationError,
} from "@/lib/database-view-row-mutations";
import {
  buildDatabaseViewColumns,
  groupScopeKeyForPath,
  type DatabaseViewRenderColumn,
  type DatabaseViewRenderModel,
  type DatabaseViewRenderRow,
} from "@/lib/database-view-render-model";
import { readDatabasePropertyOptions } from "@/lib/database-view-authoring";
import { collectRequiredPropertyOptionIds } from "@/lib/database-option-registry-requirements";
import { databasePropertyValueSearchText } from "@/lib/database-property-search-text";
import { normalizeSearchText } from "@/lib/search-text";
import { cn } from "@/lib/utils";
import { parseDataSourcePropertyId } from "../../../shared/database-identities";
import {
  buildDataSourceCreateOptionAndSelectOperations,
  buildDataSourceMultiSelectPatchOperations,
  buildDataSourceRelationReplacementOperations,
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
} from "../board/board-keyboard-navigation";
import { PagePresenceRail } from "../board/page-presence-rail";
import { BoardPageKey } from "../board/board-page-key";
import { buildDatabaseViewBoardDropOperations } from "@/lib/database-view-drag-operations";
import {
  buildBlockToDataSourceTransferIntent,
  containsCanvasBlockDrag,
  containsDatabaseBlockDrag,
  endLocalBlockDragSession,
  hasDragType,
  NODEX_BLOCK_TRANSFER_DRAG_MIME,
  resolveLocalBlockDragDropSession,
  shouldHandleNativeCrossSurfaceDrag,
} from "../board/cross-surface-drag";
import { transferBlocks } from "@/lib/api";
import { resolveBlockDocumentMutationBarrier } from "@/lib/block-document-mutation-registry";
import { toast } from "@/components/ui/toast";
import { computeNativeDropIndexFromSurface } from "../board/native-drop-index";
import { DatabaseList } from "./database-list/database-list";
import {
  useDatabaseViewMutationHistory,
  type DatabaseViewMutationHistory,
} from "./database-view-mutation-history";

const DATABASE_VIEW_PAGE_DRAG_MIME =
  "application/vnd.nodex.database-view-pages.v1+json";

const readDraggedPageIds = (dataTransfer: DataTransfer): readonly string[] => {
  const serialized = dataTransfer.getData(DATABASE_VIEW_PAGE_DRAG_MIME);
  if (!serialized) return [];
  try {
    const value = JSON.parse(serialized) as { pageIds?: unknown };
    if (!Array.isArray(value.pageIds)) return [];
    const pageIds = value.pageIds.filter(
      (pageId): pageId is string => typeof pageId === "string" && pageId.length > 0,
    );
    return pageIds.length === value.pageIds.length
      && new Set(pageIds).size === pageIds.length
      ? pageIds
      : [];
  } catch {
    return [];
  }
};

interface DatabaseViewSurfaceProps {
  readonly model: DatabaseViewRenderModel;
  readonly presentationLayout?: DatabaseViewLayout;
  readonly effectivePresentation?: EffectiveDatabaseViewPresentation;
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
  readonly mutationHistory?: DatabaseViewMutationHistory;
  readonly keyboardSurface?: {
    readonly surfaceId: string;
    readonly presentationId: string;
  };
  readonly presentedPageIds?: ReadonlySet<string>;
  readonly initialSelectedPageIds?: ReadonlySet<string>;
  readonly onSelectedPageIdsChange?: (pageIds: ReadonlySet<string>) => void;
  readonly pageCreateSurfaceId?: string;
  readonly onRequestCreatePage?: (groupKey: string) => void;
}

const rowByPageId = (
  model: DatabaseViewRenderModel,
  pageId: string,
): DataSourcePageRowV2 | null =>
  model.query.rows.find((row) => row.page.pageId === pageId) ?? null;

const searchablePropertyValues = (
  model: DatabaseViewRenderModel,
  pageId: string,
  optionRegistries: Readonly<Record<string, readonly DatabasePropertyOption[]>>,
): string => {
  const row = rowByPageId(model, pageId);
  if (!row) return "";
  const propertyById = new Map(
    model.query.properties.map((property) => [String(property.propertyId), property] as const),
  );
  return Object.values(row.values)
    .map((value) => {
      const relation = readRelationValuePreview(value.value);
      if (!relation) {
        return databasePropertyValueSearchText(
          value.value,
          {
            optionBacked: propertyById.get(value.propertyId)?.valueType === "select"
              || propertyById.get(value.propertyId)?.valueType === "multi_select",
            options: optionRegistries[value.propertyId],
          },
        );
      }
      return relation.targets
        .flatMap((target) => target.kind === "visible" ? [target.title] : [])
        .join(" ");
    })
    .join(" ");
};

const displayedProperties = (
  model: DatabaseViewRenderModel,
  layout: DatabaseViewLayout,
  presentation: DatabaseViewPresentationConfig,
): readonly DataSourcePropertyRecordV2[] => {
  const propertyById = new Map<string, DataSourcePropertyRecordV2>(
    model.query.properties
      .filter((property) => property.lifecycle === "active")
      .map((property) => [property.propertyId, property]),
  );
  return presentation.layouts[layout].fields.flatMap(
    (field) => {
      if (field.kind !== "property") return [];
      const property = propertyById.get(field.propertyId);
      return property ? [property] : [];
    },
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

function BoardPageCardSurface({
  model,
  row,
  trailingProperties,
  showPageKey,
  pendingMutationKeys,
  mutationErrors,
  canMoveUp,
  canMoveDown,
  onOpenPage,
  onSetValue,
  onPatchOptions,
  onPatchRelation,
  onReplaceOneRelation,
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
  draggable,
  dragging,
  onDragStartPage,
  onDragEndPage,
  onDropBefore,
}: {
  readonly model: DatabaseViewRenderModel;
  readonly row: DatabaseViewRenderRow;
  readonly trailingProperties: readonly DataSourcePropertyRecordV2[];
  readonly showPageKey: boolean;
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
  readonly onReplaceOneRelation: (
    pageId: string,
    property: DataSourcePropertyRecordV2,
    targetPageId: string | null,
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
  readonly draggable: boolean;
  readonly dragging: boolean;
  readonly onDragStartPage: (
    row: DatabaseViewRenderRow,
    event: ReactDragEvent<HTMLButtonElement>,
  ) => void;
  readonly onDragEndPage: () => void;
  readonly onDropBefore: (
    row: DatabaseViewRenderRow,
    event: ReactDragEvent<HTMLElement>,
  ) => void;
}) {
  const authority = rowByPageId(model, row.pageId);
  if (!authority) return null;
  const movePending = pendingMutationKeys.has(`page:${row.pageId}`);
  const title = row.title || "Untitled";
  const renderPropertyEditor = (property: DataSourcePropertyRecordV2) => {
    const current = authority.values[property.propertyId];
    const propertyError = mutationErrors.get(
      `value:${row.pageId}:${property.propertyId}`,
    );
    return (
      <div
        key={property.propertyId}
        data-database-view-property-id={property.propertyId}
        className="min-w-0 shrink-0"
      >
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
          relationSourcePageId={row.pageId}
          onChange={(value) =>
            onSetValue(row.pageId, property.propertyId, value)}
          onCreateOption={(option) =>
            onCreateOption(row.pageId, property, option)}
          onPatchOptions={(delta) =>
            onPatchOptions(row.pageId, property, delta)}
          onPatchRelation={(delta) =>
            onPatchRelation(row.pageId, property.propertyId, delta)}
          onReplaceOneRelation={(targetPageId) =>
            onReplaceOneRelation(row.pageId, property, targetPageId)}
          onLoadRelationTargets={(after) =>
            onLoadRelationTargets(row.pageId, property.propertyId, after)}
          onSearchRelationCandidates={(query, after) =>
            onSearchRelationCandidates(property, query, after)}
          onLoadRelationTargetDescriptor={() =>
            onLoadRelationTargetDescriptor(property)}
          onOpenRelationPage={(pageId, relationTitle) =>
            onOpenPage(pageId, relationTitle)}
          onRelationValueStale={onRelationValueStale}
        />
        {propertyError ? (
          <PropertyEditorFeedback message={propertyError} />
        ) : null}
      </div>
    );
  };
  return (
    <article
      data-database-view-page-id={row.pageId}
      data-board-uuid-v7={row.pageId}
      data-database-view-page-presented={presented ? "true" : undefined}
      tabIndex={highlighted ? 0 : -1}
      aria-selected={selected}
      onPointerDown={() => onHighlight(row.pageId)}
      onFocus={() => onHighlight(row.pageId)}
      onDragOver={draggable
        ? (event) => {
            const internal = event.dataTransfer.types.includes(
              DATABASE_VIEW_PAGE_DRAG_MIME,
            );
            const blocks = shouldHandleNativeCrossSurfaceDrag(event.dataTransfer)
              && hasDragType(event.dataTransfer, NODEX_BLOCK_TRANSFER_DRAG_MIME);
            if (!internal && !blocks) return;
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = event.altKey && blocks ? "copy" : "move";
          }
        : undefined}
      onDrop={draggable
        ? (event) => onDropBefore(row, event)
        : undefined}
      className={cn(
        "group/card relative min-w-0 overflow-hidden rounded-lg bg-token-foreground/5 px-2.5 py-2 outline-none hover:bg-token-foreground/8",
        (highlighted || selected) && "ring-1 ring-inset",
        highlighted && !selected
          && "ring-[color-mix(in_srgb,var(--accent-blue)_50%,transparent)]",
        selected
          && "bg-[color-mix(in_srgb,var(--accent-blue)_7%,transparent)] ring-[color-mix(in_srgb,var(--accent-blue)_72%,transparent)]",
        dragging && "opacity-45",
      )}
    >
      {presented ? <PagePresenceRail /> : null}
      <BoardPageKey
        pageKey={row.pageKey}
        showPageKey={showPageKey}
        className="mb-0.5"
      />
      <div className="flex min-h-6 min-w-0 items-center gap-1">
        {draggable ? (
          <button
            type="button"
            draggable="true"
            aria-label={`Drag ${title}`}
            className="-ml-1 flex size-5 shrink-0 cursor-grab items-center justify-center rounded text-token-description-foreground opacity-0 outline-none hover:bg-token-foreground/7 hover:text-token-text-primary focus-visible:opacity-100 group-hover/card:opacity-100 active:cursor-grabbing"
            onPointerDown={(event) => event.stopPropagation()}
            onDragStart={(event) => onDragStartPage(row, event)}
            onDragEnd={onDragEndPage}
          >
            <GripVertical className="size-3.5" />
          </button>
        ) : null}
        <button
          type="button"
          aria-label={`Open Page ${showPageKey && row.pageKey ? `${row.pageKey} ` : ""}${title}`}
          className="min-w-0 flex-1 text-left text-sm text-token-text-primary outline-none"
          onClick={() => onOpenPage(row.pageId, row.title)}
        >
          <span className="block truncate">{title}</span>
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
      {trailingProperties.length > 0 ? (
        <div className="mt-1.5 flex min-w-0 flex-col items-start gap-x-2 gap-y-1">
          {trailingProperties.map(renderPropertyEditor)}
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

export function DatabaseViewSurface(props: DatabaseViewSurfaceProps) {
  const { onSelectedPageIdsChange } = props;
  const localMutationHistory = useDatabaseViewMutationHistory(
    `${props.model.storeEpoch}:${props.model.databaseViewId}`,
  );
  const mutationHistory = props.mutationHistory ?? localMutationHistory;
  const [selectedPageIds, setSelectedPageIds] = useState<ReadonlySet<string>>(
    () => new Set(props.initialSelectedPageIds),
  );
  const handleSelectedPageIdsChange = useCallback((next: ReadonlySet<string>): void => {
    setSelectedPageIds((current) => {
      if (
        current.size === next.size
        && [...current].every((pageId) => next.has(pageId))
      ) {
        return current;
      }
      return new Set(next);
    });
    onSelectedPageIdsChange?.(next);
  }, [onSelectedPageIdsChange]);
  const effectivePresentation = props.effectivePresentation ?? {
    layout: props.presentationLayout ?? props.model.query.view.defaultLayout,
    presentation: props.model.query.view.config.presentation,
  };
  if (effectivePresentation.layout === "list") {
    return (
      <DatabaseList
        model={props.model}
        effectivePresentation={effectivePresentation}
        groupPagination={props.groupPagination}
        onLoadMoreGroup={props.onLoadMoreGroup}
        searchQuery={props.searchQuery}
        onOpenPage={props.onOpenPage}
        onCommitted={props.onCommitted}
        commitOperations={props.commitOperations}
        presentedPageIds={props.presentedPageIds}
        initialSelectedPageIds={selectedPageIds}
        onSelectedPageIdsChange={handleSelectedPageIdsChange}
        pageCreateSurfaceId={props.pageCreateSurfaceId}
        onRequestCreatePage={props.onRequestCreatePage}
        mutationHistory={mutationHistory}
      />
    );
  }
  return (
    <BoardDatabaseViewSurface
      {...props}
      effectivePresentation={effectivePresentation}
      initialSelectedPageIds={selectedPageIds}
      onSelectedPageIdsChange={handleSelectedPageIdsChange}
    />
  );
}

function BoardDatabaseViewSurface({
  model,
  effectivePresentation,
  groupPagination,
  onLoadMoreGroup,
  searchQuery,
  onOpenPage,
  onCommitted,
  commitOperations = commitDatabaseViewOperations,
  keyboardSurface,
  presentedPageIds,
  initialSelectedPageIds,
  onSelectedPageIdsChange,
}: Omit<DatabaseViewSurfaceProps, "effectivePresentation"> & {
  readonly effectivePresentation: EffectiveDatabaseViewPresentation;
}) {
  const [pendingMutationKeys, setPendingMutationKeys] = useState<ReadonlyMap<
    string,
    number
  >>(() => new Map());
  const [mutationErrors, setMutationErrors] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );
  const [highlightedPageId, setHighlightedPageId] = useState<string | null>(null);
  const [selectedPageIds, setSelectedPageIds] = useState<ReadonlySet<string>>(
    () => new Set(initialSelectedPageIds),
  );
  const [draggingPageIds, setDraggingPageIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const keyboardSurfaceFallbackId = useId();
  const surfaceId = keyboardSurface?.surfaceId
    ?? `database-view:${model.databaseViewId}:${keyboardSurfaceFallbackId}`;
  const presentationId = keyboardSurface?.presentationId
    ?? `database-view-presentation:${keyboardSurfaceFallbackId}`;
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const requiredOptionIds = useMemo(
    () => collectRequiredPropertyOptionIds({
      properties: model.query.properties,
      rows: model.query.rows,
      filter: model.query.view.config.filter,
    }),
    [model.query.properties, model.query.rows, model.query.view.config.filter],
  );
  const propertyOptionRegistries = usePropertyOptionRegistries({
    accessContext: model.accessContext,
    properties: model.query.properties,
    requiredOptionIds,
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

  useEffect(() => {
    onSelectedPageIdsChange?.(selectedPageIds);
  }, [onSelectedPageIdsChange, selectedPageIds]);
  const activeLayout = effectivePresentation.layout;
  const presentation = effectivePresentation.presentation;
  const compiledSearchQuery = useMemo(
    () => compilePageCollectionSearchQuery(deferredSearchQuery),
    [deferredSearchQuery],
  );
  const trailingBoardProperties = useMemo(
    () => displayedProperties(model, "board", presentation),
    [model, presentation],
  );
  const showBoardPageKey = presentation.layouts.board.fields.some(
    (field) => field.kind === "intrinsic" && field.field === "page_key",
  );
  const columns = useMemo(
    () => buildDatabaseViewColumns(
      model.query,
      presentation.group?.propertyId ?? null,
      presentation.layouts[activeLayout ?? "list"].showEmptyGroups,
    ).map((column): DatabaseViewRenderColumn => ({
      ...column,
      rows: compiledSearchQuery.normalizedQuery.length === 0
        ? column.rows
        : column.rows.filter((row) =>
              matchesPageCollectionSearchQuery(
                row.pageKey,
                normalizeSearchText(
                  `${row.title} ${row.preview} ${row.plainText} ${searchablePropertyValues(model, row.pageId, optionRegistries)}`,
                ),
                compiledSearchQuery,
            )),
    })),
    [activeLayout, compiledSearchQuery, model, optionRegistries, presentation],
  );
  const subgroupsByColumn = useMemo(() => {
    const subgroupPropertyId = presentation.subgroup?.propertyId;
    if (!subgroupPropertyId) {
      return new Map(columns.map((column) => [column.id, [{
        key: null,
        name: null,
        scopeKey: column.scopeKey,
        rows: column.rows,
      }]] as const));
    }
    const property = model.query.properties.find((candidate) =>
      candidate.lifecycle === "active"
      && candidate.propertyId === subgroupPropertyId);
    if (!property) return new Map<string, readonly {
      readonly key: string | null;
      readonly name: string | null;
      readonly scopeKey: string;
      readonly rows: readonly DatabaseViewRenderRow[];
    }[]>();
    const options = readDatabasePropertyOptions(property);
    const optionNames = new Map(options.map((option) => [option.id, option.name]));
    const showEmpty = presentation.layouts[activeLayout ?? "list"].showEmptyGroups;
    const finiteKeys = showEmpty
      ? property.valueType === "checkbox"
        ? ["false", "true"]
        : property.valueType === "select"
          ? options.map((option) => option.id)
          : []
      : [];
    return new Map(columns.map((column) => {
      const keys = [
        ...finiteKeys,
        ...column.rows.map((row) => row.subgroupKey),
      ].filter((key, index, all) => all.indexOf(key) === index);
      const normalizedKeys = keys.length > 0 ? keys : [null];
      return [column.id, normalizedKeys.map((key) => ({
        key,
        name: key === null
          ? `No ${property.name}`
          : optionNames.get(key)
            ?? (key === "true" ? "Checked" : key === "false" ? "Unchecked" : key),
        scopeKey: groupScopeKeyForPath(column.groupKey, key),
        rows: column.rows.filter((row) => row.subgroupKey === key),
      }))] as const;
    }));
  }, [activeLayout, columns, model.query.properties, presentation]);
  const boardSubgroups = useMemo(() => {
    const entries = columns.flatMap((column) =>
      subgroupsByColumn.get(column.id) ?? []
    );
    const unique = new Map<string, { key: string | null; name: string | null }>();
    for (const entry of entries) {
      const identity = entry.key === null ? "null" : `key:${entry.key}`;
      if (!unique.has(identity)) {
        unique.set(identity, { key: entry.key, name: entry.name });
      }
    }
    return [...unique.values()];
  }, [columns, subgroupsByColumn]);
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
  const failedContinuations = [...(groupPagination?.values() ?? [])]
    .filter((state) => state.error !== null);
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
  const togglePageSelection = (pageId: string): void => {
    setSelectedPageIds((current) => {
      const next = new Set(current);
      if (next.has(pageId)) next.delete(pageId);
      else next.add(pageId);
      return next;
    });
  };
  const startPageDrag = (
    row: DatabaseViewRenderRow,
    event: ReactDragEvent<HTMLButtonElement>,
  ): void => {
    const pageIds = selectedPageIds.has(row.pageId)
      ? allRows.flatMap((candidate) =>
          selectedPageIds.has(candidate.pageId) ? [candidate.pageId] : []
        )
      : [row.pageId];
    event.dataTransfer.setData(
      DATABASE_VIEW_PAGE_DRAG_MIME,
      JSON.stringify({ pageIds }),
    );
    event.dataTransfer.effectAllowed = "move";
    setDraggingPageIds(new Set(pageIds));
    highlightPage(row.pageId);
  };
  const endPageDrag = (): void => {
    setDraggingPageIds(new Set());
  };
  const dropPages = (
    event: ReactDragEvent<HTMLElement>,
    target: {
      readonly groupKey: string | null;
      readonly subgroupKey: string | null;
      readonly beforePageId?: string;
    },
  ): void => {
    const pageIds = readDraggedPageIds(event.dataTransfer);
    if (pageIds.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const operations = buildDatabaseViewBoardDropOperations({
      model,
      pageIds,
      target,
    });
    endPageDrag();
    if (operations.length === 0) return;
    void commit(
      operations,
      pageIds.map((pageId) => `page:${pageId}`),
    );
  };
  const dropBlocks = async (
    event: ReactDragEvent<HTMLElement>,
    target: {
      readonly groupKey: string | null;
      readonly subgroupKey: string | null;
      readonly beforePageId?: string;
    },
  ): Promise<void> => {
    const session = resolveLocalBlockDragDropSession(event.dataTransfer);
    if (!session) return;
    event.preventDefault();
    event.stopPropagation();
    endLocalBlockDragSession({ sessionId: session.sessionId });
    if (model.accessContext.kind !== "project") {
      toast.info("Blocks can only move into a Project Database View.");
      return;
    }
    if (
      session.payload.projectId !== model.accessContext.projectId
      || session.payload.storeEpoch !== model.storeEpoch
    ) {
      toast.danger("Block transfer belongs to another Project or store generation.");
      return;
    }
    if (containsCanvasBlockDrag(session.payload)) {
      toast.info("Canvas can only move between Page Documents, not into a Board.");
      return;
    }
    if (containsDatabaseBlockDrag(session.payload)) {
      toast.info("Database blocks can only move through a typed Database action.");
      return;
    }
    if (
      !presentation.group
      || presentation.subgroup
      || target.groupKey === null
      || target.subgroupKey !== null
    ) {
      toast.info("Block transfer requires a Board grouped by one assigned property.");
      return;
    }
    const sourceBarrier = resolveBlockDocumentMutationBarrier(
      session.payload.sourceSurfaceId,
    );
    const sourceHead = await sourceBarrier?.flushAndFence();
    if (sourceHead && sourceHead.storeEpoch !== model.storeEpoch) {
      toast.danger("The dragged Document belongs to another store generation.");
      return;
    }
    const result = await transferBlocks(
      model.accessContext.projectId,
      buildBlockToDataSourceTransferIntent({
        operationId: crypto.randomUUID(),
        projectId: model.accessContext.projectId,
        storeEpoch: model.storeEpoch,
        payload: session.payload,
        dataSourceId: model.dataSourceId,
        viewId: model.databaseViewId,
        groupKey: target.groupKey,
        ...(target.beforePageId ? { beforePageId: target.beforePageId } : {}),
        altKey: event.altKey,
        ...(sourceHead
          ? {
              causalDependencies: [{
                documentId: sourceHead.documentId,
                generation: sourceHead.generation,
                expectedHeadSeq: sourceHead.expectedHeadSeq,
              }],
            }
          : {}),
      }),
    );
    if (!result.ok) {
      toast.danger(result.error.message);
      return;
    }
    await onCommitted?.();
  };
  const dropOnBoardTarget = (
    event: ReactDragEvent<HTMLElement>,
    target: {
      readonly groupKey: string | null;
      readonly subgroupKey: string | null;
      readonly beforePageId?: string;
    },
  ): void => {
    if (event.dataTransfer.types.includes(DATABASE_VIEW_PAGE_DRAG_MIME)) {
      dropPages(event, target);
      return;
    }
    void dropBlocks(event, target);
  };
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
    const destinationColumn = columns[active.columnIndex + offset];
    const activeRenderRow = allRows.find((row) => row.pageId === active.pageId);
    if (!destinationColumn || !activeRenderRow) return null;
    const sourceColumn = columns[active.columnIndex];
    const sourceSubgroupIndex = sourceColumn?.rows
      .filter((row) => row.subgroupKey === activeRenderRow.subgroupKey)
      .findIndex((row) => row.pageId === active.pageId) ?? -1;
    if (sourceSubgroupIndex < 0) return null;
    const selected = new Set(actionPageIds);
    const remainingDestinationPageIds = destinationColumn.rows.flatMap((row) =>
      row.subgroupKey === activeRenderRow.subgroupKey && !selected.has(row.pageId)
        ? [row.pageId]
        : []
    );
    const newOrder = Math.min(
      sourceSubgroupIndex,
      remainingDestinationPageIds.length,
    );
    const beforePageId = remainingDestinationPageIds[newOrder];
    const operations = buildDatabaseViewBoardDropOperations({
      model,
      pageIds: actionPageIds,
      target: {
        groupKey: destinationColumn.groupKey,
        subgroupKey: activeRenderRow.subgroupKey,
        ...(beforePageId ? { beforePageId } : {}),
      },
    });
    return operations.length > 0 ? operations : null;
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
      if (
        commandId === "boardFocusNext"
        || commandId === "boardFocusPrevious"
      ) return allRows.length > 0;
      if (
        commandId === "boardFocusLeft"
        || commandId === "boardFocusRight"
      ) return activeLayout === "board" && allRows.length > 0;
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
        togglePageSelection(activeRow.pageId);
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
  const replaceRelation = (
    pageId: string,
    property: DataSourcePropertyRecordV2,
    targetPageId: string | null,
  ) => void commit(
    buildDataSourceRelationReplacementOperations({
      pageId,
      dataSourceId: model.query.dataSource.dataSourceId,
      property,
      expectedValueRevision:
        rowByPageId(model, pageId)?.values[property.propertyId]?.revision ?? 0,
      targetPageId,
    }),
    [`value:${pageId}:${property.propertyId}`],
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
    trailingProperties: trailingBoardProperties,
    showPageKey: showBoardPageKey,
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
    onReplaceOneRelation: replaceRelation,
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
    draggable: activeLayout === "board" && model.readOnlyReason === null,
    dragging: draggingPageIds.has(row.pageId),
    onDragStartPage: startPageDrag,
    onDragEndPage: endPageDrag,
    onDropBefore: (targetRow: DatabaseViewRenderRow, event: ReactDragEvent<HTMLElement>) => {
      dropOnBoardTarget(event, {
        groupKey: targetRow.groupKey,
        subgroupKey: targetRow.subgroupKey,
        beforePageId: targetRow.pageId,
      });
    },
  } as const);

  const handleListKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (activeLayout !== "list") return;
    const target = event.target as HTMLElement;
    const row = target.closest<HTMLElement>("[data-database-view-page-id]");
    if (!row || target !== row) return;
    const pageId = row.dataset.databaseViewPageId;
    if (!pageId) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const index = allRows.findIndex((candidate) => candidate.pageId === pageId);
      const offset = event.key === "ArrowDown" ? 1 : -1;
      const next = allRows[index + offset];
      if (next) highlightPage(next.pageId, true);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const next = event.key === "Home" ? allRows[0] : allRows.at(-1);
      if (next) highlightPage(next.pageId, true);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const active = allRows.find((candidate) => candidate.pageId === pageId);
      if (active) onOpenPage(active.pageId, active.title);
      return;
    }
    if (event.key !== " ") return;
    event.preventDefault();
    togglePageSelection(pageId);
  };

  return (
    <div
      ref={surfaceRef}
      className="flex h-full min-h-0 flex-col bg-token-main-surface-primary"
      data-database-view-id={model.databaseViewId}
      onFocusCapture={() => markContextualKeyboardActionTargetActive(surfaceId)}
      onPointerDownCapture={() => markContextualKeyboardActionTargetActive(surfaceId)}
      onKeyDown={handleListKeyDown}
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
          {compiledSearchQuery.normalizedQuery.length > 0
            ? "No matching Pages"
            : "This View has no Pages"}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <div className="min-w-max">
            <div className="flex gap-2">
              {columns.map((column) => (
                <div
                  key={column.id}
                  className="flex h-7 w-64 shrink-0 items-center gap-2 px-1 text-xs text-token-text-secondary"
                >
                  <span className="min-w-0 flex-1 truncate font-medium text-token-text-primary">
                    {column.name}
                  </span>
                  <span className="tabular-nums">
                    {(subgroupsByColumn.get(column.id) ?? []).reduce(
                      (total, subgroup) =>
                        total + (groupPagination?.get(subgroup.scopeKey)?.totalRows
                          ?? subgroup.rows.length),
                      0,
                    )}
                  </span>
                </div>
              ))}
            </div>
            {boardSubgroups.map((subgroupIdentity) => (
              <section
                key={subgroupIdentity.key === null
                  ? "subgroup:null"
                  : `subgroup:${subgroupIdentity.key}`}
                className="mt-1"
              >
                {subgroupIdentity.name ? (
                  <div className="sticky left-0 z-10 flex h-7 w-64 items-center px-1 text-[11px] font-medium text-token-description-foreground">
                    {subgroupIdentity.name}
                  </div>
                ) : null}
                <div className="flex items-stretch gap-2">
                  {columns.map((column) => {
                    const subgroup = (subgroupsByColumn.get(column.id) ?? [])
                      .find((candidate) => candidate.key === subgroupIdentity.key);
                    const rows = subgroup?.rows ?? [];
                    return (
                      <div
                        key={`${column.id}:${subgroupIdentity.key ?? "null"}`}
                        data-app-action-board-column-id={column.groupKey ?? "unassigned"}
                        data-database-view-subgroup-key={subgroupIdentity.key ?? "unassigned"}
                        className={cn(
                          "flex min-h-14 w-64 shrink-0 flex-col gap-1 rounded-lg p-0.5 transition-colors",
                          draggingPageIds.size > 0 && "bg-token-foreground/[0.025]",
                        )}
                        onDragOver={(event) => {
                          const internal = event.dataTransfer.types.includes(
                            DATABASE_VIEW_PAGE_DRAG_MIME,
                          );
                          const blocks = shouldHandleNativeCrossSurfaceDrag(event.dataTransfer)
                            && hasDragType(
                              event.dataTransfer,
                              NODEX_BLOCK_TRANSFER_DRAG_MIME,
                            );
                          if (!internal && !blocks) return;
                          event.preventDefault();
                          event.dataTransfer.dropEffect = event.altKey && blocks
                            ? "copy"
                            : "move";
                        }}
                        onDrop={(event) => {
                          const internalPageIds = readDraggedPageIds(event.dataTransfer);
                          const ignoredPageIds = new Set(internalPageIds);
                          const index = computeNativeDropIndexFromSurface(
                            event.currentTarget,
                            event.clientY,
                            { ignoredPageIds },
                          );
                          const remainingRows = rows.filter(
                            (row) => !ignoredPageIds.has(row.pageId),
                          );
                          dropOnBoardTarget(event, {
                            groupKey: column.groupKey,
                            subgroupKey: subgroupIdentity.key,
                            ...(remainingRows[index]
                              ? { beforePageId: remainingRows[index].pageId }
                              : {}),
                          });
                        }}
                      >
                        {rows.map((row) => (
                          <BoardPageCardSurface key={row.pageId} {...pageProps(row)} />
                        ))}
                        {subgroup ? groupShowMore(subgroup.scopeKey) : null}
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
