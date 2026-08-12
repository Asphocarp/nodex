import {
  useDeferredValue,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import {
  LoaderCircle,
} from "@/components/shared/icons/generic-icons";
import { NodexButton } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { usePropertyOptionRegistries } from "@/components/database/use-property-option-registries";
import type { ColumnPaginationState } from "@/lib/board-store";
import {
  buildDataSourceCreateOptionAndSelectOperations,
  buildDataSourceMultiSelectPatchOperations,
  buildDataSourceRelationReplacementOperations,
} from "@/lib/data-source-property-value-operations";
import {
  readDataSourceRelationTargets,
  readDataSourceRelationTargetDescriptor,
  searchDataSourceRelationCandidates,
} from "@/lib/data-source-relation-runtime";
import { readDatabasePropertyOptions } from "@/lib/database-view-authoring";
import { resolveDatabaseTaskFilterCapabilities } from "@/lib/database-view-task-filter";
import {
  buildDatabaseViewColumns,
  type DatabaseViewRenderColumn,
  type DatabaseViewRenderModel,
  type DatabaseViewRenderRow,
} from "@/lib/database-view-render-model";
import {
  buildDatabaseViewMovePageRunOperations,
  buildDatabaseViewPropertyValueOperations,
  canMoveDatabaseViewPage,
  commitDatabaseViewOperations,
  DatabaseViewMutationError,
  type DatabaseViewMutationReceipt,
} from "@/lib/database-view-row-mutations";
import { matchesSearchTokens, tokenizeSearchQuery } from "@/lib/page-search";
import { normalizeSearchText } from "@/lib/search-text";
import { resolveDataSourcePropertyPresentationRole } from "@/lib/data-source-property-presentation-role";
import { cn } from "@/lib/utils";
import { StatusIcon } from "@/lib/status-chip";
import type {
  DatabaseJsonValue,
  DatabaseViewField,
  EffectiveDatabaseViewPresentation,
} from "../../../../shared/database-kernel";
import { isPriority } from "../../../../shared/priority";
import type { DatabaseApplyOperationV2 } from "../../../../shared/database-module-v2";
import type {
  DataSourcePageRowV2,
  DataSourcePropertyRecordV2,
} from "../../../../shared/database-module-v2";
import { parseDataSourcePropertyId } from "../../../../shared/database-identities";
import {
  buildDatabaseListProjection,
  applyOptimisticDatabaseListDrop,
  captureDatabaseListScrollAnchor,
  computeDatabaseListVirtualWindow,
  databaseListScrollTopForOccurrence,
  databaseListMountedActiveOccurrenceKey,
  databaseListGroupKey,
  emptyDatabaseListSelection,
  isDatabaseListOccurrenceSelected,
  moveDatabaseListActiveOccurrence,
  moveDatabaseListActiveOccurrenceToBoundary,
  projectCoreDatabaseListRows,
  resolveDatabaseListAuthority,
  restoreDatabaseListScrollTop,
  selectAllDatabaseListOccurrences,
  selectDatabaseListOccurrence,
  selectedDatabaseListPageIds,
  syncDatabaseListSelection,
  type DatabaseListPageRow,
  type DatabaseListProjectionRow,
  type DatabaseListSelectionState,
} from "./database-list-model";
import {
  DatabaseListInlineProperties,
  DatabaseListTrailingPropertyCells,
  type DatabaseListPropertyRuntime,
} from "./database-list-property-cells";
import {
  DatabaseListDisclosureIcon,
  DatabaseListPlusIcon,
  DatabaseListPriorityIcon,
} from "./database-list-icons";
import { databaseListGroupLabel } from "./database-list-property-presentation";
import { isWorkflowStatus } from "../../../../shared/workflow-status";
import {
  DATABASE_LIST_INTERACTIVE_SELECTOR,
  DatabaseListRow,
} from "./database-list-row";
import { DatabaseListRowContextMenu } from "./database-list-row-context-menu";
import { DatabaseListSelectionActionBar } from "./database-list-selection-action-bar";
import { useDatabaseListGrid } from "./use-database-list-grid";
import { withForcedDatabaseListField } from "./database-list-grid";
import {
  compileDatabaseListDropIntent,
  type DatabaseListDragSourceOccurrence,
  type DatabaseListDropPosition,
} from "./compile-list-drop-intent";
import { useDatabaseListWindow } from "./use-database-list-window";
import { buildDatabaseListDropUndoOperations } from "./database-list-undo";
import { databaseListNestingContinuations } from "./database-list-nesting-lines";
import { DATABASE_LIST_THEME_CLASS_NAME } from "./database-list-theme";

const DATABASE_VIEW_PAGE_DRAG_MIME =
  "application/vnd.nodex.database-view-pages.v1+json";
const INITIAL_OVERSCAN = 100;
const IDLE_OVERSCAN_STEP = 600;
const IDLE_OVERSCAN_PASSES = 3;

interface DatabaseListProps {
  readonly model: DatabaseViewRenderModel;
  readonly effectivePresentation?: EffectiveDatabaseViewPresentation;
  readonly groupPagination?: ReadonlyMap<string, ColumnPaginationState>;
  readonly onLoadMoreGroup?: (scopeKey: string) => Promise<void> | void;
  readonly searchQuery: string;
  readonly onOpenPage: (pageId: string, titleSnapshot: string) => void;
  readonly onCommitted?: () => Promise<void> | void;
  readonly commitOperations?: typeof commitDatabaseViewOperations;
  readonly presentedPageIds?: ReadonlySet<string>;
  readonly initialSelectedPageIds?: ReadonlySet<string>;
  readonly onSelectedPageIdsChange?: (pageIds: ReadonlySet<string>) => void;
  readonly collapsedGroupKeys?: readonly string[];
  readonly onCollapsedGroupKeysChange?: (keys: readonly string[]) => void;
  readonly scrollStateKey?: string;
  readonly forcedDisplayField?: DatabaseViewField | null;
  readonly pageCreateSurfaceId?: string;
  readonly onRequestCreatePage?: (groupKey: string) => void;
}

interface DatabaseListCommitOptions {
  readonly mutationKeys?: readonly string[];
  readonly errorMessage?: string;
  readonly inlineError?: boolean;
  readonly propagateError?: boolean;
  readonly settleDrag?: boolean;
  readonly deferError?: boolean;
  readonly modelOverride?: DatabaseViewRenderModel;
}

interface DatabaseListFocusRequest {
  readonly id: number;
  readonly occurrenceKey: string;
}

interface DatabaseListInteractionState {
  readonly selection: DatabaseListSelectionState;
  readonly focusRequest: DatabaseListFocusRequest | null;
}

type DatabaseListSelectionUpdate = (
  current: DatabaseListSelectionState,
) => DatabaseListSelectionState;

type DatabaseListInteractionAction =
  | {
      readonly kind: "update-selection";
      readonly update: DatabaseListSelectionUpdate;
      readonly focusRequestId?: number;
      readonly preserveFocusRequest?: boolean;
    }
  | {
      readonly kind: "consume-focus-request";
      readonly focusRequestId: number;
    };

const reduceDatabaseListInteraction = (
  state: DatabaseListInteractionState,
  action: DatabaseListInteractionAction,
): DatabaseListInteractionState => {
  if (action.kind === "consume-focus-request") {
    if (state.focusRequest?.id !== action.focusRequestId) return state;
    return { ...state, focusRequest: null };
  }

  const selection = action.update(state.selection);
  const occurrenceKey = selection.activeOccurrenceKey;
  const focusRequest = action.focusRequestId !== undefined && occurrenceKey
    ? { id: action.focusRequestId, occurrenceKey }
    : action.preserveFocusRequest
      ? state.focusRequest
      : null;
  if (
    selection === state.selection
    && focusRequest === state.focusRequest
  ) return state;
  return { selection, focusRequest };
};

const propertyValueMutationKey = (pageId: string, propertyId: string): string =>
  `PROPERTY_VALUE_${encodeURIComponent(pageId)}_${encodeURIComponent(propertyId)}`;

const propertyDefinitionMutationKey = (propertyId: string): string =>
  `PROPERTY_DEFINITION_${encodeURIComponent(propertyId)}`;

const pageMutationKey = (pageId: string): string =>
  `PAGE_${encodeURIComponent(pageId)}`;

const updateMutationCounts = (
  current: ReadonlyMap<string, number>,
  keys: readonly string[],
  delta: 1 | -1,
): ReadonlyMap<string, number> => {
  const next = new Map(current);
  for (const key of new Set(keys)) {
    const count = (next.get(key) ?? 0) + delta;
    if (count <= 0) next.delete(key);
    else next.set(key, count);
  }
  return next;
};

interface DatabaseListDragPayload {
  readonly pageIds: readonly string[];
  readonly sourceOccurrences: readonly DatabaseListDragSourceOccurrence[];
}

const readDatabaseListDragPayload = (
  dataTransfer: DataTransfer,
): DatabaseListDragPayload | null => {
  const serialized = dataTransfer.getData(DATABASE_VIEW_PAGE_DRAG_MIME);
  if (!serialized) return null;
  try {
    const payload = JSON.parse(serialized) as {
      pageIds?: unknown;
      sourceOccurrences?: unknown;
    };
    if (!Array.isArray(payload.pageIds)) return null;
    const pageIds = payload.pageIds.filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
    if (pageIds.length !== payload.pageIds.length) return null;
    const allowedPageIds = new Set(pageIds);
    const sourceOccurrences = Array.isArray(payload.sourceOccurrences)
      ? payload.sourceOccurrences.flatMap((value): DatabaseListDragSourceOccurrence[] => {
          if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
          const occurrence = value as Record<string, unknown>;
          if (
            typeof occurrence.occurrenceKey !== "string"
            || typeof occurrence.pageId !== "string"
            || !allowedPageIds.has(occurrence.pageId)
            || !(typeof occurrence.groupKey === "string" || occurrence.groupKey === null)
            || !(typeof occurrence.subgroupKey === "string" || occurrence.subgroupKey === null)
          ) return [];
          return [{
            occurrenceKey: occurrence.occurrenceKey,
            pageId: occurrence.pageId,
            groupKey: occurrence.groupKey,
            subgroupKey: occurrence.subgroupKey,
          }];
        })
      : [];
    return { pageIds: [...new Set(pageIds)], sourceOccurrences };
  } catch {
    return null;
  }
};

const searchablePropertyValues = (
  model: DatabaseViewRenderModel,
  pageId: string,
): string => {
  const row = model.query.rows.find((candidate) => candidate.page.pageId === pageId);
  if (!row) return "";
  return Object.values(row.values).map((entry) => JSON.stringify(entry.value)).join(" ");
};

const searchableAuthorityValues = (
  authority: DataSourcePageRowV2,
): string => Object.values(authority.values)
  .map((entry) => JSON.stringify(entry.value))
  .join(" ");

const availableListFields = (
  model: DatabaseViewRenderModel,
  fields: readonly DatabaseViewField[],
): readonly DatabaseViewField[] => {
  const propertyIds = new Set(model.query.properties.flatMap((property) =>
    property.lifecycle === "active" ? [String(property.propertyId)] : []
  ));
  return fields.filter((field) => {
    if (field.kind === "intrinsic") return true;
    if (!propertyIds.has(String(field.propertyId))) return false;
    return field.propertyId !== "status" && field.propertyId !== "priority";
  });
};

const groupLabel = (
  model: DatabaseViewRenderModel,
  propertyId: string | undefined,
  key: string | null,
): string => {
  const property = model.query.properties.find((candidate) =>
    candidate.lifecycle === "active" && candidate.propertyId === propertyId
  );
  const option = property
    ? readDatabasePropertyOptions(property).find((candidate) => candidate.id === key)
    : undefined;
  return databaseListGroupLabel(propertyId, key, option?.name);
};

const databaseListGroupMarker = (
  propertyId: string | undefined,
  key: string | null,
): ReactNode => {
  if (propertyId === "status" && key) {
    return <StatusIcon statusId={key} className="size-4 shrink-0" />;
  }
  if (propertyId === "priority" && isPriority(key)) {
    return <DatabaseListPriorityIcon priority={key} className="size-4" />;
  }
  return <span className="size-2 shrink-0 rounded-full ring-[1px] ring-[var(--database-list-icon-muted)]" />;
};

const initialSelection = (
  rows: readonly DatabaseListProjectionRow[],
  pageIds: ReadonlySet<string> | undefined,
): DatabaseListSelectionState => {
  const firstVisibleOccurrenceKey = rows.find((row) => row.kind === "page")?.key ?? null;
  if (!pageIds || pageIds.size === 0) {
    return {
      ...emptyDatabaseListSelection(),
      activeOccurrenceKey: firstVisibleOccurrenceKey,
    };
  }
  const selectedOccurrenceKeys = new Set(rows.flatMap((row) =>
    row.kind === "page" && pageIds.has(row.pageId) ? [row.key] : []
  ));
  const first = selectedOccurrenceKeys.values().next().value ?? null;
  return {
    selectedOccurrenceKeys,
    allMatching: false,
    excludedOccurrenceKeys: new Set(),
    anchorOccurrenceKey: first,
    activeOccurrenceKey: first,
  };
};

const idleCallback = (callback: () => void): (() => void) => {
  if (typeof window === "undefined") return () => undefined;
  if ("requestIdleCallback" in window) {
    const id = window.requestIdleCallback(callback, { timeout: 300 });
    return () => window.cancelIdleCallback(id);
  }
  const id = globalThis.setTimeout(callback, 32);
  return () => globalThis.clearTimeout(id);
};

const samePageIds = (
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): boolean => left.size === right.size && [...left].every((pageId) => right.has(pageId));

export function DatabaseList({
  model,
  effectivePresentation,
  groupPagination,
  onLoadMoreGroup,
  searchQuery,
  onOpenPage,
  onCommitted,
  commitOperations = commitDatabaseViewOperations,
  presentedPageIds,
  initialSelectedPageIds,
  onSelectedPageIdsChange,
  collapsedGroupKeys: controlledCollapsedGroupKeys,
  onCollapsedGroupKeysChange,
  scrollStateKey = `database-view:${model.databaseViewId}:list`,
  forcedDisplayField = null,
  pageCreateSurfaceId,
  onRequestCreatePage,
}: DatabaseListProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const inFlightScopesRef = useRef(new Set<string>());
  const dragSettlingRef = useRef(false);
  const previousProjectionRef = useRef<readonly DatabaseListProjectionRow[]>([]);
  const scrollFrameRef = useRef<number | null>(null);
  const scrollDelayRef = useRef<number | null>(null);
  const latestScrollTopRef = useRef(0);
  const lastScrollCommitAtRef = useRef(0);
  const pointerTimerRef = useRef<number | null>(null);
  const restoredScrollStateKeyRef = useRef<string | null>(null);
  const lastReportedSelectionRef = useRef<{
    readonly handler: NonNullable<DatabaseListProps["onSelectedPageIdsChange"]>;
    readonly pageIds: ReadonlySet<string>;
  } | null>(null);
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const presentation = effectivePresentation?.presentation
    ?? model.query.view.config.presentation;
  const effective = effectivePresentation ?? {
    layout: "list" as const,
    presentation,
  };
  const usesCoreAuthority = model.authorization !== null;
  const coreWindow = useDatabaseListWindow({ model, effective });
  const grouped = presentation.group !== null;
  const subgrouped = presentation.subgroup !== null;
  const listConfig = presentation.layouts.list;
  const sessionListFields = useMemo(() => {
    return withForcedDatabaseListField(listConfig.fields, forcedDisplayField);
  }, [forcedDisplayField, listConfig.fields]);
  const requiredOptionIds = useMemo(() => {
    const displayedPropertyIds = new Set(sessionListFields.flatMap((field) =>
      field.kind === "property" ? [String(field.propertyId)] : []
    ));
    const optionProperties = new Map(model.query.properties.flatMap((property) => {
      if (!displayedPropertyIds.has(property.propertyId)) return [];
      if (property.lifecycle !== "active") return [];
      if (property.valueType !== "select" && property.valueType !== "multi_select") return [];
      const role = resolveDataSourcePropertyPresentationRole(property);
      if (role.kind === "status" || role.kind === "priority" || role.kind === "estimate") {
        return [];
      }
      return [[property.propertyId, property] as const];
    }));
    const selected = new Map<string, Set<string>>(
      [...optionProperties.keys()].map((propertyId) => [propertyId, new Set()]),
    );
    const rows = [
      ...model.query.rows,
      ...coreWindow.rows.flatMap((item) => item.kind === "page" ? [item.row] : []),
    ];
    for (const row of rows) {
      for (const [propertyId, property] of optionProperties) {
        const value = row.values[propertyId]?.value;
        const values = property.valueType === "multi_select"
          ? Array.isArray(value) ? value : []
          : typeof value === "string" ? [value] : [];
        for (const optionId of values) {
          if (typeof optionId === "string") selected.get(propertyId)?.add(optionId);
        }
      }
    }
    return Object.fromEntries(
      [...selected].map(([propertyId, optionIds]) => [propertyId, [...optionIds]]),
    );
  }, [coreWindow.rows, model.query.properties, model.query.rows, sessionListFields]);
  const propertyOptionRegistries = usePropertyOptionRegistries({
    accessContext: model.accessContext,
    properties: model.query.properties,
    requiredOptionIds,
  });
  const nested = presentation.hierarchy.showSubPages
    && presentation.hierarchy.nestedSubPages;
  const [localCollapsedGroupKeys, setLocalCollapsedGroupKeys] = useState<ReadonlySet<string>>(
    () => new Set(controlledCollapsedGroupKeys ?? []),
  );
  const collapsedGroupKeys = useMemo(
    () => controlledCollapsedGroupKeys === undefined
      ? localCollapsedGroupKeys
      : new Set(controlledCollapsedGroupKeys),
    [controlledCollapsedGroupKeys, localCollapsedGroupKeys],
  );
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [overscan, setOverscan] = useState(INITIAL_OVERSCAN);
  const [pointerSuppressed, setPointerSuppressed] = useState(false);
  const [draggingPageIds, setDraggingPageIds] = useState<ReadonlySet<string>>(new Set());
  const [dropTarget, setDropTarget] = useState<{
    readonly occurrenceKey: string;
    readonly position: DatabaseListDropPosition;
  } | null>(null);
  const [optimisticProjection, setOptimisticProjection] = useState<
    readonly DatabaseListProjectionRow[] | null
  >(null);
  const [pendingMutationCount, setPendingMutationCount] = useState(0);
  const [pendingMutationKeys, setPendingMutationKeys] = useState<ReadonlyMap<string, number>>(
    new Map(),
  );
  const [inlineMutationErrors, setInlineMutationErrors] = useState<ReadonlyMap<string, string>>(
    new Map(),
  );
  const [continuationError, setContinuationError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const mutationPending = pendingMutationCount > 0;
  const searchTokens = useMemo(
    () => tokenizeSearchQuery(deferredSearchQuery),
    [deferredSearchQuery],
  );
  const columns = useMemo(() => {
    const projected = buildDatabaseViewColumns(
      model.query,
      presentation.group?.propertyId ?? null,
      listConfig.showEmptyGroups,
    ).map((column): DatabaseViewRenderColumn => ({
      ...column,
      name: groupLabel(model, presentation.group?.propertyId, column.groupKey),
      rows: searchTokens.length === 0
        ? column.rows
        : column.rows.filter((row) => matchesSearchTokens(
            normalizeSearchText(
              `${row.title} ${row.preview} ${row.plainText} ${row.tags.join(" ")} ${searchablePropertyValues(model, row.pageId)}`,
            ),
            searchTokens,
          )),
        }));
    return presentation.groupDirection === "desc"
      ? [...projected].reverse()
      : projected;
  }, [
    listConfig.showEmptyGroups,
    model,
    presentation.group?.propertyId,
    presentation.groupDirection,
    searchTokens,
  ]);
  const totalRowsByScope = useMemo(() => new Map(columns.map((column) => [
    column.scopeKey,
    groupPagination?.get(column.scopeKey)?.totalRows ?? column.rows.length,
  ])), [columns, groupPagination]);
  const taskFilterCapabilities = useMemo(
    () => resolveDatabaseTaskFilterCapabilities(model.query.properties),
    [model.query.properties],
  );
  const statusOptions = taskFilterCapabilities.status?.options ?? [];
  const priorityOptions = taskFilterCapabilities.priority?.options ?? [];
  const clientProjection = useMemo(() => buildDatabaseListProjection({
    columns,
    grouped,
    subgrouped,
    showSubPages: presentation.hierarchy.showSubPages,
    nested,
    collapsedGroupKeys,
    totalRowsByScope,
  }), [
    collapsedGroupKeys,
    columns,
    grouped,
    nested,
    presentation.hierarchy.showSubPages,
    subgrouped,
    totalRowsByScope,
  ]);
  const coreProjection = useMemo(() => projectCoreDatabaseListRows({
    rows: coreWindow.rows,
    properties: model.query.properties,
    collapsedGroupKeys,
    groupLabel: (key) => groupLabel(
      model,
      presentation.group?.propertyId,
      key,
    ),
    subgroupLabel: (key) => groupLabel(
      model,
      presentation.subgroup?.propertyId,
      key,
    ),
    ...(searchTokens.length === 0
      ? {}
      : {
          matchesPage: (
            row: DatabaseViewRenderRow,
            authority: DataSourcePageRowV2,
          ) => matchesSearchTokens(
            normalizeSearchText(
              `${row.title} ${row.preview} ${row.plainText} ${row.tags.join(" ")} ${searchableAuthorityValues(authority)}`,
            ),
            searchTokens,
          ),
        }),
  }), [
    collapsedGroupKeys,
    coreWindow.rows,
    model,
    presentation.group?.propertyId,
    presentation.subgroup?.propertyId,
    searchTokens,
  ]);
  // Authorized runtime Views have exactly one ordering authority: Core's List
  // occurrence projection. Falling back to the Board query while that window
  // loads makes rows visibly reorder once or several times during handoff.
  const authoritativeProjection = resolveDatabaseListAuthority({
    coreAuthorized: usesCoreAuthority,
    coreRows: coreProjection.rows,
    clientRows: clientProjection,
  });
  const projection = optimisticProjection ?? authoritativeProjection;
  const authorityByPageId = useMemo(() => {
    const authority = new Map(model.query.rows.map((row) => [
      row.page.pageId,
      row,
    ] as const));
    for (const [pageId, row] of coreProjection.authorityByPageId) {
      authority.set(pageId, row);
    }
    return authority;
  }, [coreProjection.authorityByPageId, model.query.rows]);
  const mutationModel = useMemo<DatabaseViewRenderModel>(() => {
    const orderedAuthority = new Map<string, DataSourcePageRowV2>();
    if (coreWindow.active) {
      for (const snapshot of coreWindow.rows) {
        if (snapshot.kind !== "page") continue;
        if (!orderedAuthority.has(snapshot.row.page.pageId)) {
          orderedAuthority.set(snapshot.row.page.pageId, snapshot.row);
        }
      }
    }
    for (const row of model.query.rows) {
      if (!orderedAuthority.has(row.page.pageId)) {
        orderedAuthority.set(row.page.pageId, row);
      }
    }
    return {
      ...model,
      query: {
        ...model.query,
        view: {
          ...model.query.view,
          defaultLayout: effective.layout,
          config: {
            ...model.query.view.config,
            presentation,
          },
        },
        rows: [...orderedAuthority.values()],
      },
    };
  }, [coreWindow.active, coreWindow.rows, effective.layout, model, presentation]);
  const mutationModelRef = useRef(mutationModel);
  mutationModelRef.current = mutationModel;
  const effectiveRef = useRef(effective);
  effectiveRef.current = effective;
  const [interaction, dispatchInteraction] = useReducer(
    reduceDatabaseListInteraction,
    {
      selection: initialSelection(projection, initialSelectedPageIds),
      focusRequest: null,
    },
  );
  const { focusRequest, selection } = interaction;
  const focusRequestIdRef = useRef(0);
  const updateSelection = (
    update: DatabaseListSelectionUpdate,
    requestFocus = false,
  ): void => {
    const focusRequestId = requestFocus
      ? ++focusRequestIdRef.current
      : undefined;
    dispatchInteraction({
      kind: "update-selection",
      update,
      focusRequestId,
    });
  };
  const allFields = useMemo(
    () => availableListFields(model, sessionListFields),
    [model, sessionListFields],
  );
  const selectedPropertyIds = useMemo(
    () => new Set(sessionListFields.flatMap((field) =>
      field.kind === "property" ? [String(field.propertyId)] : []
    )),
    [sessionListFields],
  );
  const activePropertyIds = useMemo(
    () => new Set(model.query.properties.flatMap((property) =>
      property.lifecycle === "active" ? [String(property.propertyId)] : []
    )),
    [model.query.properties],
  );
  const coreColumnVisibility = useMemo(() => ({
    priority: selectedPropertyIds.has("priority") && activePropertyIds.has("priority"),
    status: selectedPropertyIds.has("status") && activePropertyIds.has("status"),
  }), [activePropertyIds, selectedPropertyIds]);
  const { inlineFields, trailingFields, gridTemplateColumns } = useDatabaseListGrid(
    allFields,
    coreColumnVisibility,
  );
  const virtualWindow = useMemo(() => computeDatabaseListVirtualWindow(
    projection,
    scrollTop,
    viewportHeight,
    overscan,
  ), [overscan, projection, scrollTop, viewportHeight]);
  const renderedRows = projection.slice(
    virtualWindow.startIndex,
    virtualWindow.endIndex,
  );
  const mountedActiveOccurrenceKey = databaseListMountedActiveOccurrenceKey({
    rows: projection,
    startIndex: virtualWindow.startIndex,
    endIndex: virtualWindow.endIndex,
    activeOccurrenceKey: selection.activeOccurrenceKey,
  });
  const selectedPageIds = useMemo(() => selectedDatabaseListPageIds(
    projection,
    selection,
  ), [projection, selection]);
  const projectionIndexByKey = useMemo(
    () => new Map(projection.map((row, index) => [row.key, index] as const)),
    [projection],
  );
  const nestingContinuationsByKey = useMemo(
    () => databaseListNestingContinuations(projection),
    [projection],
  );
  const logicalExtraRows = usesCoreAuthority
    ? coreWindow.active && searchTokens.length === 0
      ? Math.max(0, coreWindow.totalProjectionRowCount - coreWindow.rows.length)
      : 0
    : [...(groupPagination?.values() ?? [])].reduce(
        (total, state) => total
          + Math.max(0, (state.totalRows ?? state.loadedRows) - state.loadedRows),
        0,
      );
  const paginationError = usesCoreAuthority
    ? null
    : [...(groupPagination?.values() ?? [])]
        .find((state) => state.error !== null)?.error ?? null;
  const visibleError = mutationError
    ?? coreWindow.error
    ?? continuationError
    ?? paginationError;
  const activePage = projection.find((row): row is DatabaseListPageRow =>
    row.kind === "page" && row.key === selection.activeOccurrenceKey
  ) ?? null;
  const listOrderReady = !usesCoreAuthority
    || (coreWindow.active && !coreWindow.loading);
  const allMatchingReady = listOrderReady && (
    !selection.allMatching || !usesCoreAuthority || coreWindow.isComplete
  );
  const selectionCount = selection.allMatching && coreWindow.active
    ? coreWindow.isComplete
      ? selectedPageIds.size
      : coreWindow.totalModelCount
    : selectedPageIds.size;

  useEffect(() => {
    dispatchInteraction({
      kind: "update-selection",
      update: (current) => syncDatabaseListSelection(
        current,
        projection,
        previousProjectionRef.current,
      ),
      preserveFocusRequest: true,
    });
    previousProjectionRef.current = projection;
  }, [projection]);

  useEffect(() => {
    if (!onSelectedPageIdsChange) {
      lastReportedSelectionRef.current = null;
      return;
    }
    const previous = lastReportedSelectionRef.current;
    if (
      previous?.handler === onSelectedPageIdsChange
      && samePageIds(previous.pageIds, selectedPageIds)
    ) {
      return;
    }
    lastReportedSelectionRef.current = {
      handler: onSelectedPageIdsChange,
      pageIds: selectedPageIds,
    };
    onSelectedPageIdsChange(selectedPageIds);
  }, [onSelectedPageIdsChange, selectedPageIds]);

  useEffect(() => {
    if (!selection.allMatching || !coreWindow.active || coreWindow.isComplete) return;
    coreWindow.loadMore();
  }, [coreWindow, selection.allMatching]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const measure = (): void => setViewportHeight(scroller.clientHeight);
    measure();
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(measure);
    observer?.observe(scroller);
    return () => observer?.disconnect();
  }, [scrollStateKey]);

  useEffect(() => {
    if (projection.length === 0 || restoredScrollStateKeyRef.current === scrollStateKey) {
      return;
    }
    const scroller = scrollerRef.current;
    if (!scroller) return;
    let restoredTop: number | null = null;
    try {
      const rawAnchor = window.sessionStorage.getItem(`${scrollStateKey}:anchor`);
      if (rawAnchor) {
        const value = JSON.parse(rawAnchor) as {
          rowKey?: unknown;
          intraRowOffset?: unknown;
        };
        if (typeof value.rowKey === "string" && typeof value.intraRowOffset === "number") {
          restoredTop = restoreDatabaseListScrollTop(projection, {
            rowKey: value.rowKey,
            intraRowOffset: value.intraRowOffset,
          });
        }
      }
      if (restoredTop === null) {
        const legacyTop = Number(window.sessionStorage.getItem(`${scrollStateKey}:top`));
        if (Number.isFinite(legacyTop) && legacyTop > 0) restoredTop = legacyTop;
      }
    } catch {
      // Session restoration is best effort; Core data remains authoritative.
    }
    if (restoredTop !== null) {
      scroller.scrollTop = restoredTop;
      setScrollTop(restoredTop);
    }
    restoredScrollStateKeyRef.current = scrollStateKey;
  }, [projection, scrollStateKey]);

  useEffect(() => {
    let pass = 0;
    let cancel: () => void = () => undefined;
    const schedule = (): void => {
      cancel = idleCallback(() => {
        pass += 1;
        setOverscan(INITIAL_OVERSCAN + pass * IDLE_OVERSCAN_STEP);
        if (pass < IDLE_OVERSCAN_PASSES) schedule();
      });
    };
    schedule();
    return () => cancel();
  }, [model.databaseViewId]);

  useEffect(() => {
    if (!focusRequest) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const target = [...(hostRef.current?.querySelectorAll<HTMLElement>(
      "[data-list-key]",
    ) ?? [])].find(
      (candidate) => candidate.dataset.listKey === focusRequest.occurrenceKey,
    );
    if (target) {
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: "nearest" });
      dispatchInteraction({
        kind: "consume-focus-request",
        focusRequestId: focusRequest.id,
      });
      return;
    }
    const nextTop = databaseListScrollTopForOccurrence({
      rows: projection,
      occurrenceKey: focusRequest.occurrenceKey,
      viewportTop: scroller.scrollTop,
      viewportHeight: scroller.clientHeight,
    });
    if (nextTop === null || nextTop === scroller.scrollTop) {
      dispatchInteraction({
        kind: "consume-focus-request",
        focusRequestId: focusRequest.id,
      });
      return;
    }
    scroller.scrollTop = nextTop;
    setScrollTop(nextTop);
  }, [
    focusRequest,
    projection,
    virtualWindow.endIndex,
    virtualWindow.startIndex,
  ]);

  useEffect(() => () => {
    if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
    if (scrollDelayRef.current !== null) window.clearTimeout(scrollDelayRef.current);
    if (pointerTimerRef.current !== null) window.clearTimeout(pointerTimerRef.current);
  }, []);

  const loadMoreGroup = async (scopeKey: string): Promise<void> => {
    if (!onLoadMoreGroup || inFlightScopesRef.current.has(scopeKey)) return;
    inFlightScopesRef.current.add(scopeKey);
    setContinuationError(null);
    try {
      await onLoadMoreGroup(scopeKey);
    } catch {
      setContinuationError("Couldn’t load the next List window.");
    } finally {
      inFlightScopesRef.current.delete(scopeKey);
    }
  };

  useEffect(() => {
    if (viewportHeight <= 0) return;
    const nearEnd = scrollTop + viewportHeight >= virtualWindow.totalHeight - 640;
    if (!nearEnd) return;
    if (usesCoreAuthority) {
      coreWindow.loadMore();
      return;
    }
    if (!onLoadMoreGroup) return;
    for (const pagination of groupPagination?.values() ?? []) {
      if (!pagination.hasMore || pagination.loadingMore) continue;
      void loadMoreGroup(pagination.scopeKey);
    }
  // Pagination functions intentionally read their latest in-flight refs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    coreWindow.active,
    coreWindow.isComplete,
    coreWindow.loadingMore,
    coreWindow.nextCursor,
    groupPagination,
    onLoadMoreGroup,
    scrollTop,
    viewportHeight,
    virtualWindow.totalHeight,
    usesCoreAuthority,
  ]);

  const commit = async (
    operations: readonly DatabaseApplyOperationV2[],
    options: DatabaseListCommitOptions = {},
  ): Promise<DatabaseViewMutationReceipt | null> => {
    if (operations.length === 0) return null;
    const mutationKeys = [...new Set(options.mutationKeys ?? [])];
    setPendingMutationCount((current) => current + 1);
    setPendingMutationKeys((current) => updateMutationCounts(current, mutationKeys, 1));
    setMutationError(null);
    if (mutationKeys.length > 0) {
      setInlineMutationErrors((current) => {
        const next = new Map(current);
        for (const key of mutationKeys) next.delete(key);
        return next;
      });
    }
    try {
      const receipt = await commitOperations({
        model: options.modelOverride ?? mutationModel,
        operations,
      });
      await onCommitted?.();
      return receipt;
    } catch (cause) {
      const message = options.errorMessage
        ?? "Couldn’t update these pages. Refresh and try again.";
      if (options.deferError) {
        // A semantic caller may rebase once before surfacing the conflict.
      } else if (options.inlineError && mutationKeys.length > 0) {
        setInlineMutationErrors((current) => {
          const next = new Map(current);
          for (const key of mutationKeys) next.set(key, message);
          return next;
        });
      } else {
        setMutationError(message);
      }
      await onCommitted?.();
      if (options.propagateError) throw cause;
      return null;
    } finally {
      if (options.settleDrag) {
        await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 100));
        dragSettlingRef.current = false;
        setOptimisticProjection(null);
        setDraggingPageIds(new Set());
        setDropTarget(null);
      }
      setPendingMutationCount((current) => Math.max(0, current - 1));
      setPendingMutationKeys((current) => updateMutationCounts(current, mutationKeys, -1));
    }
  };

  const isGroupComplete = (pageIds: readonly string[]): boolean => {
    if (usesCoreAuthority) {
      return coreWindow.active && !coreWindow.loading && coreWindow.isComplete;
    }
    const column = columns.find((candidate) => pageIds.every((pageId) =>
      candidate.rows.some((row) => row.pageId === pageId)
    ));
    return column ? groupPagination?.get(column.scopeKey)?.hasMore !== true : false;
  };

  const movePages = (
    pageIds: readonly string[],
    direction: "up" | "down" | "top" | "bottom",
  ): void => {
    try {
      const operations = buildDatabaseViewMovePageRunOperations({
        model: mutationModel,
        pageIds,
        direction,
        groupComplete: isGroupComplete(pageIds),
      });
      if (operations.length === 0) {
        setMutationError("This selection can’t be moved in the current ordering.");
        return;
      }
      void commit(operations, {
        mutationKeys: pageIds.map(pageMutationKey),
        errorMessage: "Couldn’t move this selection. Try again.",
      });
    } catch {
      setMutationError("This selection can’t be moved as one run.");
    }
  };

  const setProperty = (
    pageId: string,
    propertyId: "status" | "priority",
    value: string | null,
  ): void => {
    try {
      void commit(buildDatabaseViewPropertyValueOperations({
        model: mutationModel,
        pageId,
        propertyId,
        value,
      }), {
        mutationKeys: [propertyValueMutationKey(pageId, propertyId)],
        errorMessage: "Couldn’t save this property. Try again.",
        inlineError: true,
      });
    } catch {
      setMutationError(`Couldn’t update this Page’s ${propertyId}.`);
    }
  };

  const setPropertyValue = (
    pageId: string,
    propertyId: string,
    value: DatabaseJsonValue,
  ): void => {
    try {
      void commit(buildDatabaseViewPropertyValueOperations({
        model: mutationModel,
        pageId,
        propertyId,
        value,
      }), {
        mutationKeys: [propertyValueMutationKey(pageId, propertyId)],
        errorMessage: "Couldn’t save this property. Try again.",
        inlineError: true,
      });
    } catch {
      setMutationError("Couldn’t update this property.");
    }
  };

  const patchOptions = (
    pageId: string,
    property: DataSourcePropertyRecordV2,
    delta: {
      readonly addOptionIds: readonly string[];
      readonly removeOptionIds: readonly string[];
    },
  ): void => {
    try {
      void commit(buildDataSourceMultiSelectPatchOperations({
        pageId,
        dataSourceId: model.dataSourceId,
        property,
        ...delta,
      }), {
        mutationKeys: [propertyValueMutationKey(pageId, property.propertyId)],
        errorMessage: "Couldn’t save this property. Try again.",
        inlineError: true,
      });
    } catch {
      setMutationError("Couldn’t update this property.");
    }
  };

  const patchRelation = (
    pageId: string,
    propertyId: string,
    delta: {
      readonly addPageIds: readonly string[];
      readonly removeEdgeIds: readonly string[];
    },
  ): void => {
    void commit([{
      kind: "edit_property_values",
      edits: [{
        pageId,
        dataSourceId: model.dataSourceId,
        propertyId: parseDataSourcePropertyId(propertyId),
        edit: { kind: "patch_set", delta: { kind: "relation", ...delta } },
      }],
    }], {
      mutationKeys: [propertyValueMutationKey(pageId, propertyId)],
      errorMessage: "Couldn’t save this property. Try again.",
      inlineError: true,
    });
  };

  const replaceRelation = (
    pageId: string,
    property: DataSourcePropertyRecordV2,
    targetPageId: string | null,
  ): void => {
    const current = authorityByPageId.get(pageId)?.values[property.propertyId];
    void commit(buildDataSourceRelationReplacementOperations({
      pageId,
      dataSourceId: model.dataSourceId,
      property,
      expectedValueRevision: current?.revision ?? 0,
      targetPageId,
    }), {
      mutationKeys: [propertyValueMutationKey(pageId, property.propertyId)],
      errorMessage: "Couldn’t save this property. Try again.",
      inlineError: true,
    });
  };

  const createOption = async (
    pageId: string,
    property: DataSourcePropertyRecordV2,
    option: { readonly optionId: string; readonly name: string; readonly color?: string },
  ): Promise<void> => {
    const current = authorityByPageId.get(pageId)?.values[property.propertyId];
    await commit(buildDataSourceCreateOptionAndSelectOperations({
      pageId,
      dataSourceId: model.dataSourceId,
      property,
      current,
      option: {
        id: option.optionId,
        name: option.name,
        ...(option.color === undefined ? {} : { color: option.color }),
      },
    }), {
      mutationKeys: [
        propertyDefinitionMutationKey(property.propertyId),
        propertyValueMutationKey(pageId, property.propertyId),
      ],
      errorMessage: "Couldn’t save this property. Try again.",
      inlineError: true,
      propagateError: true,
    });
  };

  const propertyRuntime: DatabaseListPropertyRuntime = {
    disabled: model.readOnlyReason !== null,
    isPending: (pageId, propertyId) =>
      pendingMutationKeys.has(propertyValueMutationKey(pageId, propertyId))
      || pendingMutationKeys.has(propertyDefinitionMutationKey(propertyId)),
    errorFor: (pageId, propertyId) =>
      inlineMutationErrors.get(propertyValueMutationKey(pageId, propertyId))
      ?? inlineMutationErrors.get(propertyDefinitionMutationKey(propertyId))
      ?? null,
    options: propertyOptionRegistries.options,
    optionStates: propertyOptionRegistries.states,
    optionHasMore: propertyOptionRegistries.hasMore,
    optionLoadingMore: propertyOptionRegistries.loadingMore,
    relationCandidates: [...authorityByPageId.values()].map((row) => ({
      pageId: row.page.pageId,
      title: row.page.title,
    })),
    onSetValue: setPropertyValue,
    onPatchOptions: patchOptions,
    onPatchRelation: patchRelation,
    onReplaceRelation: replaceRelation,
    onCreateOption: createOption,
    onRequestOptions: propertyOptionRegistries.requestOptions,
    onRequestMoreOptions: propertyOptionRegistries.requestMoreOptions,
    onLoadRelationTargets: async (pageId, property, after) =>
      await readDataSourceRelationTargets({
        accessContext: model.accessContext,
        pageId,
        property,
        after,
      }),
    onSearchRelationCandidates: async (property, query, after) =>
      await searchDataSourceRelationCandidates({
        accessContext: model.accessContext,
        property,
        query,
        after,
      }),
    onLoadRelationTargetDescriptor: async (property) =>
      await readDataSourceRelationTargetDescriptor({
        accessContext: model.accessContext,
        property,
      }),
    onOpenRelationPage: onOpenPage,
    onRelationValueStale: () => void onCommitted?.(),
  };

  const dropPages = (
    event: DragEvent<HTMLElement>,
    target: {
      readonly occurrenceKey: string;
      readonly groupKey: string | null;
      readonly subgroupKey: string | null;
      readonly targetPageId?: string;
      readonly position: DatabaseListDropPosition;
    },
  ): void => {
    const dragPayload = readDatabaseListDragPayload(event.dataTransfer);
    if (!dragPayload || dragPayload.pageIds.length === 0) return;
    const { pageIds, sourceOccurrences } = dragPayload;
    event.preventDefault();
    event.stopPropagation();
    const compiled = compileDatabaseListDropIntent({
      model: mutationModel,
      effective: effectivePresentation ?? {
        layout: "list",
        presentation,
      },
      pageIds,
      sourceOccurrences,
      targetPageId: target.targetPageId,
      position: target.position,
      groupKey: target.groupKey,
      subgroupKey: target.subgroupKey,
    });
    if (!compiled.ok) {
      setMutationError(compiled.reason);
      setDraggingPageIds(new Set());
      setDropTarget(null);
      return;
    }
    void (async () => {
      let attempt = compiled.value;
      let attemptModel = mutationModel;
      for (let attemptIndex = 0; attemptIndex < 2; attemptIndex += 1) {
        dragSettlingRef.current = true;
        setOptimisticProjection(applyOptimisticDatabaseListDrop({
          rows: authoritativeProjection,
          pageIds: new Set(attempt.pageIds),
          targetOccurrenceKey: target.occurrenceKey,
          position: target.position,
          groupKey: target.groupKey,
          subgroupKey: target.subgroupKey,
        }));
        try {
          const receipt = await commit(attempt.operations, {
          mutationKeys: pageIds.map(pageMutationKey),
          errorMessage: "Couldn’t move these Pages. Try again.",
          propagateError: true,
          deferError: attemptIndex === 0,
          settleDrag: true,
          modelOverride: attemptModel,
        });
        if (!receipt) return;
        const undoOperations = buildDatabaseListDropUndoOperations({
          model: attemptModel,
          compiled: attempt,
          receipt,
        });
        toast.success("Pages moved", {
          ...(undoOperations && undoOperations.length > 0
            ? {
                action: {
                  label: "Undo",
                  onClick: () => {
                    void commit(undoOperations, {
                      mutationKeys: pageIds.map(pageMutationKey),
                      errorMessage: "Couldn’t undo this move. Refresh and try again.",
                    });
                  },
                },
              }
            : {}),
        });
          return;
        } catch (cause) {
          const canRebase = attemptIndex === 0
            && cause instanceof DatabaseViewMutationError
            && cause.commandError.code === "revision_conflict";
          if (!canRebase) {
            setMutationError("Couldn’t move these Pages. Review the latest order and try again.");
            return;
          }
          await new Promise<void>((resolve) => globalThis.setTimeout(resolve, 0));
          attemptModel = mutationModelRef.current;
          const rebased = compileDatabaseListDropIntent({
            model: attemptModel,
            effective: effectiveRef.current,
            pageIds,
            sourceOccurrences,
            targetPageId: target.targetPageId,
            position: target.position,
            groupKey: target.groupKey,
            subgroupKey: target.subgroupKey,
          });
          if (!rebased.ok) {
            setMutationError(rebased.reason);
            return;
          }
          attempt = rebased.value;
        }
      }
    })();
  };

  const updateCollapsedGroups = (
    update: (current: ReadonlySet<string>) => ReadonlySet<string>,
  ): void => {
    const next = update(collapsedGroupKeys);
    if (controlledCollapsedGroupKeys === undefined) setLocalCollapsedGroupKeys(next);
    onCollapsedGroupKeysChange?.([...next]);
  };

  const toggleCollapseKey = (key: string): void => updateCollapsedGroups((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if ((event.target as HTMLElement).closest(DATABASE_LIST_INTERACTIVE_SELECTOR)) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      updateSelection((current) => moveDatabaseListActiveOccurrence({
        state: current,
        rows: projection,
        direction: event.key === "ArrowDown" ? 1 : -1,
        extendSelection: event.shiftKey,
      }), true);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      updateSelection((current) => moveDatabaseListActiveOccurrenceToBoundary({
        state: current,
        rows: projection,
        boundary: event.key === "Home" ? "first" : "last",
        extendSelection: event.shiftKey,
      }), true);
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      updateSelection((current) => selectAllDatabaseListOccurrences({
        state: current,
        rows: projection,
      }));
      return;
    }
    if (event.key === " " && activePage) {
      event.preventDefault();
      updateSelection((current) => selectDatabaseListOccurrence({
        state: current,
        rows: projection,
        occurrenceKey: activePage.key,
        mode: "toggle",
      }));
      return;
    }
    if (event.key === "Enter" && activePage) {
      event.preventDefault();
      onOpenPage(activePage.pageId, activePage.row.title);
      return;
    }
    if (
      event.key === "Escape"
      && (selection.allMatching || selection.selectedOccurrenceKeys.size > 0)
    ) {
      event.preventDefault();
      updateSelection((current) => ({
        ...current,
        selectedOccurrenceKeys: new Set(),
        allMatching: false,
        excludedOccurrenceKeys: new Set(),
        anchorOccurrenceKey: null,
      }));
      return;
    }
    if (event.key.toLowerCase() !== "t") return;
    event.preventDefault();
    if (event.altKey) {
      const collapsibleKeys = projection.flatMap((row) =>
        row.kind === "group" ? [row.key] : []
      );
      updateCollapsedGroups((current) => current.size > 0
        ? new Set()
        : new Set(collapsibleKeys));
      return;
    }
    if (!activePage || !grouped) return;
    toggleCollapseKey(databaseListGroupKey(activePage.groupKey));
  };

  const renderPage = (item: DatabaseListPageRow, logicalIndex: number) => {
    const authority = authorityByPageId.get(item.pageId);
    if (!authority) return null;
    const selected = isDatabaseListOccurrenceSelected(selection, item.key);
    const projectionIndex = projectionIndexByKey.get(item.key) ?? -1;
    const previousRow = projection[projectionIndex - 1];
    const nextRow = projection[projectionIndex + 1];
    const selectedBefore = previousRow?.kind === "page"
      && isDatabaseListOccurrenceSelected(selection, previousRow.key);
    const selectedAfter = nextRow?.kind === "page"
      && isDatabaseListOccurrenceSelected(selection, nextRow.key);
    const selectedForDrag = selected
      ? projection.filter((row): row is DatabaseListPageRow =>
          row.kind === "page" && isDatabaseListOccurrenceSelected(selection, row.key)
        )
      : [item];
    const uniqueDragPageIds = [...new Set(selectedForDrag.map((row) => row.pageId))];
    const dragSourceOccurrences: readonly DatabaseListDragSourceOccurrence[] = selectedForDrag.map(
      (row) => ({
        occurrenceKey: row.key,
        pageId: row.pageId,
        groupKey: row.groupKey,
        subgroupKey: row.subgroupKey,
      }),
    );
    const groupComplete = isGroupComplete([item.pageId]);
    const canMoveUp = canMoveDatabaseViewPage({
      model: mutationModel,
      pageId: item.pageId,
      direction: "up",
      groupComplete,
    });
    const canMoveDown = canMoveDatabaseViewPage({
      model: mutationModel,
      pageId: item.pageId,
      direction: "down",
      groupComplete,
    });
    const row = (
      <DatabaseListRow
        item={item}
        libraryId={model.libraryId}
        selected={selected}
        selectedBefore={selectedBefore}
        selectedAfter={selectedAfter}
        active={mountedActiveOccurrenceKey === item.key}
        dragging={draggingPageIds.has(item.pageId)}
        presented={presentedPageIds?.has(item.pageId) ?? false}
        inlineProperties={(
          <DatabaseListInlineProperties
            fields={inlineFields}
            properties={model.query.properties}
            authority={authority}
            runtime={propertyRuntime}
          />
        )}
        trailingCells={(
          <DatabaseListTrailingPropertyCells
            fields={trailingFields}
            authority={authority}
          />
        )}
        ariaRowIndex={logicalIndex + 1}
        onSelect={(mode) => updateSelection((current) => selectDatabaseListOccurrence({
          state: current,
          rows: projection,
          occurrenceKey: item.key,
          mode,
        }))}
        onActivate={() => updateSelection((current) =>
          current.activeOccurrenceKey === item.key
            ? current
            : { ...current, activeOccurrenceKey: item.key }
        )}
        onOpen={(titleSnapshot) => onOpenPage(item.pageId, titleSnapshot)}
        onDragStart={(event) => {
          if (!allMatchingReady) {
            event.preventDefault();
            setMutationError(coreWindow.loading
              ? "Wait for the List to finish refreshing before dragging."
              : "Finish loading the full selection before dragging it.");
            return;
          }
          event.dataTransfer.setData(
            DATABASE_VIEW_PAGE_DRAG_MIME,
            JSON.stringify({
              pageIds: uniqueDragPageIds,
              sourceOccurrences: dragSourceOccurrences,
            }),
          );
          event.dataTransfer.effectAllowed = "move";
          const rowElement = event.currentTarget.closest<HTMLElement>(
            '[data-list-row="true"]',
          );
          if (rowElement) {
            const rect = rowElement.getBoundingClientRect();
            event.dataTransfer.setDragImage(
              rowElement,
              Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
              Math.max(0, Math.min(rect.height, event.clientY - rect.top)),
            );
          }
          setDraggingPageIds(new Set(uniqueDragPageIds));
        }}
        onDragEnd={() => {
          if (dragSettlingRef.current) return;
          setDraggingPageIds(new Set());
          setDropTarget(null);
        }}
        dropPosition={dropTarget?.occurrenceKey === item.key
          ? dropTarget.position
          : null}
        onDragTargetChange={(position) => setDropTarget(position
          ? { occurrenceKey: item.key, position }
          : null)}
        onDrop={(event, position) => dropPages(event, {
          occurrenceKey: item.key,
          groupKey: item.groupKey,
          subgroupKey: item.subgroupKey,
          targetPageId: item.pageId,
          position,
        })}
        statusOptions={statusOptions}
        priorityOptions={priorityOptions}
        onSetStatus={(optionId) => setProperty(item.pageId, "status", optionId)}
        onSetPriority={(optionId) => setProperty(item.pageId, "priority", optionId)}
        statusMutationDisabled={
          model.readOnlyReason !== null
          || pendingMutationKeys.has(propertyValueMutationKey(item.pageId, "status"))
        }
        priorityMutationDisabled={
          model.readOnlyReason !== null
          || pendingMutationKeys.has(propertyValueMutationKey(item.pageId, "priority"))
        }
        showPriority={coreColumnVisibility.priority}
        showStatus={coreColumnVisibility.status}
        nestingContinuations={nestingContinuationsByKey.get(item.key) ?? []}
      />
    );
    return (
      <DatabaseListRowContextMenu
        key={item.key}
        selected={selected}
        canMoveUp={canMoveUp}
        canMoveDown={canMoveDown}
        onOpen={() => onOpenPage(item.pageId, item.row.title)}
        onSelectOnly={() => updateSelection((current) => selectDatabaseListOccurrence({
          state: current,
          rows: projection,
          occurrenceKey: item.key,
          mode: "replace",
        }))}
        onToggleSelection={() => updateSelection((current) => selectDatabaseListOccurrence({
          state: current,
          rows: projection,
          occurrenceKey: item.key,
          mode: "toggle",
        }))}
        onMove={(direction) => movePages([item.pageId], direction)}
      >
        {row}
      </DatabaseListRowContextMenu>
    );
  };

  const selectedIds = [...selectedPageIds];
  const canMoveSelection = (direction: "up" | "down"): boolean => {
    if (!allMatchingReady) return false;
    try {
      return buildDatabaseViewMovePageRunOperations({
        model: mutationModel,
        pageIds: selectedIds,
        direction,
        groupComplete: isGroupComplete(selectedIds),
      }).length > 0;
    } catch {
      return false;
    }
  };
  const canMoveSelectionUp = canMoveSelection("up");
  const canMoveSelectionDown = canMoveSelection("down");

  return (
    <div
      ref={hostRef}
      data-database-view-id={model.databaseViewId}
      data-page-create-surface-id={pageCreateSurfaceId}
      className={cn(
        "relative h-full min-h-0 min-w-0 bg-[var(--database-list-surface)] text-[var(--database-list-text-primary)]",
        DATABASE_LIST_THEME_CLASS_NAME,
      )}
    >
      <div
        ref={scrollerRef}
        role="grid"
        aria-label={`${model.viewName} List`}
        aria-rowcount={projection.length + logicalExtraRows}
        aria-busy={mutationPending || coreWindow.loading || undefined}
        data-list-container="true"
        className={cn(
          "h-full min-h-0 overflow-auto overscroll-contain [scrollbar-gutter:stable]",
          selectionCount > 0 ? "pb-16" : "pb-2",
          pointerSuppressed && "[&_[data-list-row=true]]:pointer-events-none",
        )}
        onKeyDown={handleKeyDown}
        onScroll={(event) => {
          const nextTop = event.currentTarget.scrollTop;
          latestScrollTopRef.current = nextTop;
          const flushScroll = (): void => {
            scrollDelayRef.current = null;
            scrollFrameRef.current = requestAnimationFrame(() => {
              const committedTop = latestScrollTopRef.current;
              lastScrollCommitAtRef.current = performance.now();
              setScrollTop(committedTop);
              try {
                window.sessionStorage.setItem(`${scrollStateKey}:top`, String(committedTop));
                const anchor = captureDatabaseListScrollAnchor(projection, committedTop);
                if (anchor) {
                  window.sessionStorage.setItem(
                    `${scrollStateKey}:anchor`,
                    JSON.stringify(anchor),
                  );
                }
              } catch {
                // A blocked session store must not affect List scrolling.
              }
              scrollFrameRef.current = null;
            });
          };
          if (scrollFrameRef.current === null && scrollDelayRef.current === null) {
            const elapsed = performance.now() - lastScrollCommitAtRef.current;
            if (elapsed >= 50) flushScroll();
            else {
              scrollDelayRef.current = window.setTimeout(flushScroll, 50 - elapsed);
            }
          }
          setPointerSuppressed(true);
          if (pointerTimerRef.current !== null) window.clearTimeout(pointerTimerRef.current);
          pointerTimerRef.current = window.setTimeout(() => {
            setPointerSuppressed(false);
            pointerTimerRef.current = null;
          }, 100);
        }}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes(DATABASE_VIEW_PAGE_DRAG_MIME)) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const distanceFromTop = event.clientY - rect.top;
          const distanceFromBottom = rect.bottom - event.clientY;
          if (distanceFromTop < 40) event.currentTarget.scrollBy({ top: -18 });
          else if (distanceFromBottom < 40) event.currentTarget.scrollBy({ top: 18 });
        }}
      >
        {visibleError ? (
          <div
            role="alert"
            className="sticky top-0 z-20 mx-2 mb-2 flex min-h-8 items-center justify-between gap-3 rounded-lg border border-token-error-foreground/15 bg-token-error-background/90 px-2.5 text-xs text-token-error-foreground backdrop-blur"
          >
            <span>{visibleError}</span>
            {coreWindow.error || continuationError || paginationError ? (
              <NodexButton
                size="xs"
                variant="ghost"
                onClick={() => {
                  if (coreWindow.error) {
                    coreWindow.retry();
                    return;
                  }
                  setContinuationError(null);
                  for (const pagination of groupPagination?.values() ?? []) {
                    if (pagination.hasMore) void loadMoreGroup(pagination.scopeKey);
                  }
                }}
              >
                Retry
              </NodexButton>
            ) : null}
          </div>
        ) : null}
        {projection.length === 0 ? (
          <div className="flex min-h-40 items-center justify-center text-sm text-token-description-foreground">
            {usesCoreAuthority && coreWindow.loading
              ? "Loading Pages…"
              : searchTokens.length > 0
                ? "No matching Pages"
                : "No Pages in this View"}
          </div>
        ) : (
          <div
            className="grid min-w-[320px] items-stretch gap-x-2"
            style={{ gridTemplateColumns } as CSSProperties}
          >
            {virtualWindow.paddingStart > 0 ? (
              <div
                aria-hidden="true"
                className="col-span-full"
                style={{ height: virtualWindow.paddingStart }}
              />
            ) : null}
            {renderedRows.map((item, renderedIndex) => {
              const logicalIndex = virtualWindow.startIndex + renderedIndex;
              if (item.kind === "page") return renderPage(item, logicalIndex);
              if (item.kind === "subgroup") {
                return (
                  <div
                    key={item.key}
                    role="row"
                    aria-rowindex={logicalIndex + 1}
                    data-list-row="true"
                    data-list-key={item.key}
                    className="sticky top-[35.5px] z-[9] grid h-8 items-center gap-x-2 bg-[var(--database-list-surface)] [grid-template-columns:subgrid] [grid-column:1/-1]"
                    onDragOver={(event) => {
                      if (!event.dataTransfer.types.includes(DATABASE_VIEW_PAGE_DRAG_MIME)) return;
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(event) => dropPages(event, {
                      occurrenceKey: item.key,
                      groupKey: item.groupKey,
                      subgroupKey: item.subgroupKey,
                      position: "root",
                    })}
                  >
                    <div
                      role="gridcell"
                      className="mx-2 grid h-8 items-center gap-x-2 rounded-lg bg-[var(--database-list-subgroup)] [grid-template-columns:subgrid] [grid-column:1/-1]"
                    >
                      <span aria-hidden="true" style={{ gridColumn: "indent" }} />
                      <span
                        className="flex items-center justify-center text-[var(--database-list-text-muted)]"
                        style={{ gridColumn: "checkbox" }}
                      >
                        {databaseListGroupMarker(
                          presentation.subgroup?.propertyId,
                          item.subgroupKey,
                        )}
                      </span>
                      <span
                        className="flex min-w-0 items-center gap-2"
                        style={{ gridColumn: "identifier / list-end" }}
                      >
                        <span className="truncate text-xs font-medium text-[var(--database-list-group-text)]">
                          {groupLabel(
                            model,
                            presentation.subgroup?.propertyId,
                            item.subgroupKey,
                          )}
                        </span>
                        <span className="shrink-0 text-xs tabular-nums text-[var(--database-list-group-count)]">
                          {item.totalRows}
                        </span>
                      </span>
                    </div>
                  </div>
                );
              }
              const resolvedGroupLabel = groupLabel(
                model,
                presentation.group?.propertyId,
                item.groupKey,
              );
              const groupCreateAction = model.readOnlyReason === null
                && presentation.group?.propertyId === "status"
                && isWorkflowStatus(item.groupKey)
                && onRequestCreatePage
                ? { status: item.groupKey, request: onRequestCreatePage }
                : null;
              return (
                <div
                  key={item.key}
                  role="row"
                  aria-rowindex={logicalIndex + 1}
                  data-list-row="true"
                  data-list-key={item.key}
                  className="sticky top-[-0.5px] z-10 mb-0.5 grid h-9 items-center gap-x-2 bg-[var(--database-list-surface)] [grid-template-columns:subgrid] [grid-column:1/-1]"
                  onDragOver={(event) => {
                    if (!event.dataTransfer.types.includes(DATABASE_VIEW_PAGE_DRAG_MIME)) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(event) => dropPages(event, {
                    occurrenceKey: item.key,
                    groupKey: item.groupKey,
                    subgroupKey: null,
                    position: "root",
                  })}
                >
                  <div
                    role="gridcell"
                    data-list-group-divider="true"
                    className="mx-2 grid h-9 items-center gap-x-2 overflow-hidden rounded-lg pr-2 [grid-template-columns:subgrid] [grid-column:1/-1]"
                    style={{
                      background: "linear-gradient(90deg, var(--database-list-group-start) 0%, var(--database-list-group-end) 100%), var(--database-list-group-end)",
                    }}
                  >
                    <span aria-hidden="true" style={{ gridColumn: "indent" }} />
                    <button
                      type="button"
                      aria-expanded={!item.collapsed}
                      aria-label={`${item.collapsed ? "Expand" : "Collapse"} ${resolvedGroupLabel}`}
                      className="grid size-7 place-items-center rounded-full text-[var(--database-list-text-muted)] outline-none hover:bg-[var(--database-list-row-hover)] focus-visible:ring-1 focus-visible:ring-[var(--database-list-focus)]"
                      style={{ gridColumn: "checkbox" }}
                      onClick={() => toggleCollapseKey(item.key)}
                    >
                      <DatabaseListDisclosureIcon open={!item.collapsed} />
                    </button>
                    {coreColumnVisibility.priority ? (
                      <span
                        className="flex size-4 items-center justify-center text-[var(--database-list-text-muted)]"
                        style={{ gridColumn: "priority" }}
                      >
                        {databaseListGroupMarker(
                          presentation.group?.propertyId,
                          item.groupKey,
                        )}
                      </span>
                    ) : null}
                    <span
                      className="flex min-w-0 items-center gap-2"
                      style={{ gridColumn: "identifier / list-end" }}
                    >
                      {!coreColumnVisibility.priority ? databaseListGroupMarker(
                        presentation.group?.propertyId,
                        item.groupKey,
                      ) : null}
                      <span className="truncate text-[13px] font-medium leading-[normal] text-[var(--database-list-group-text)]">
                        {resolvedGroupLabel}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-[var(--database-list-group-count)]">
                        {item.totalRows}
                      </span>
                      {groupCreateAction ? (
                        <NodexButton
                          variant="ghost"
                          size="icon-xs"
                          aria-label="Create new Page"
                          data-page-create-trigger="header"
                          data-page-create-column-id={groupCreateAction.status}
                          className="ml-auto size-6 rounded-full px-0.5 text-[var(--database-list-text-muted)]"
                          onClick={() => groupCreateAction.request(groupCreateAction.status)}
                        >
                          <DatabaseListPlusIcon />
                        </NodexButton>
                      ) : null}
                    </span>
                  </div>
                </div>
              );
            })}
            {virtualWindow.paddingEnd > 0 ? (
              <div
                aria-hidden="true"
                className="col-span-full"
                style={{ height: virtualWindow.paddingEnd }}
              />
            ) : null}
          </div>
        )}
        {coreWindow.loadingMore
          || (!usesCoreAuthority
            && [...(groupPagination?.values() ?? [])].some((state) => state.loadingMore)) ? (
          <div role="status" className="flex h-8 items-center justify-center gap-1.5 text-xs text-token-description-foreground">
            <LoaderCircle className="icon-2xs animate-spin" />
            Loading more…
          </div>
        ) : null}
      </div>
      <DatabaseListSelectionActionBar
        count={selectionCount}
        canMoveUp={canMoveSelectionUp}
        canMoveDown={canMoveSelectionDown}
        onMove={(direction) => movePages(selectedIds, direction)}
        onClear={() => updateSelection((current) => ({
          ...current,
          selectedOccurrenceKeys: new Set(),
          allMatching: false,
          excludedOccurrenceKeys: new Set(),
          anchorOccurrenceKey: null,
        }))}
      />
    </div>
  );
}
