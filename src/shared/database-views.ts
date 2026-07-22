import { WORKFLOW_STATUS_ORDER } from "./workflow-status";
import type {
  DatabaseViewFilterNode,
  DatabaseViewKind,
  DatabaseViewSort,
  DatabaseViewConfig,
} from "./database-kernel";
import type { DatabasePageSummary, Estimate, Priority } from "./types";

export interface ReadDatabaseViewReferenceInput {
  /**
   * The Project containing the reference surface. It authorizes the read and
   * remains the execution scope for actions exposed by the returned model.
   */
  readonly requestingProjectId: string;
  readonly databaseViewId: string;
  /** Host Page identity used only for window-local include/exclude projection. */
  readonly hostBlockId?: string;
}

export type { DatabaseViewKind } from "./database-kernel";

export type DatabaseViewJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly DatabaseViewJsonValue[]
  | { readonly [key: string]: DatabaseViewJsonValue };

export interface DatabaseViewDefinition {
  readonly id: string;
  readonly databaseBlockId: string;
  /** Requesting Project scope; Database/View identity itself is Library-owned. */
  readonly projectId: string;
  readonly name: string;
  readonly kind: DatabaseViewKind;
  readonly config: Readonly<Record<string, DatabaseViewJsonValue>>;
  readonly isPrimary: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DatabaseViewPageRow {
  readonly page: DatabasePageSummary;
  readonly groupKey: string | null;
  readonly rankKey: string;
}

export interface DatabaseViewReadModel {
  readonly libraryId: string;
  readonly storeEpoch: string;
  readonly changeLogSeq: number;
  readonly dataSourceId: string;
  readonly view: DatabaseViewDefinition;
  readonly rows: readonly DatabaseViewPageRow[];
}

type LegacyFilterClause =
  | {
      readonly field: "status";
      readonly op: "in";
      readonly values: readonly DatabasePageSummary["status"][];
    }
  | {
      readonly field: "priority";
      readonly op: "in";
      readonly values: readonly Priority[];
      readonly includeEmpty: boolean;
    }
  | {
      readonly field: "tags";
      readonly op: "hasAny" | "hasAll" | "hasNone";
      readonly values: readonly string[];
    };

type LegacySortField =
  "board-order" | "status" | "priority" | "estimate" | "created" | "title";

interface LegacySortKey {
  readonly field: LegacySortField;
  readonly direction: "asc" | "desc";
  readonly emptyPlacement: "first" | "last";
}

interface ValidLegacyViewQuery {
  readonly groups: readonly (readonly LegacyFilterClause[])[];
  readonly sort: readonly LegacySortKey[];
  readonly includeHostPage: boolean;
}

const PRIORITY_ORDER: readonly Priority[] = [
  "p0-critical",
  "p1-high",
  "p2-medium",
  "p3-low",
  "p4-later",
];
const ESTIMATE_ORDER: readonly Estimate[] = ["xs", "s", "m", "l", "xl"];
const LEGACY_SORT_FIELDS: readonly LegacySortField[] = [
  "board-order",
  "status",
  "priority",
  "estimate",
  "created",
  "title",
];
const DEFAULT_LEGACY_FILTER_GROUPS: ValidLegacyViewQuery["groups"] = [
  [
    { field: "status", op: "in", values: WORKFLOW_STATUS_ORDER },
    {
      field: "priority",
      op: "in",
      values: PRIORITY_ORDER,
      includeEmpty: true,
    },
  ],
];
const DEFAULT_LEGACY_SORT: ValidLegacyViewQuery["sort"] = [
  { field: "board-order", direction: "asc", emptyPlacement: "last" },
  { field: "created", direction: "desc", emptyPlacement: "last" },
];

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const parseLegacyFilterClause = (value: unknown): LegacyFilterClause | null => {
  if (!isRecord(value) || !isStringArray(value.values)) return null;
  if (value.field === "status" && value.op === "in") {
    if (
      !value.values.every((item) =>
        WORKFLOW_STATUS_ORDER.includes(item as DatabasePageSummary["status"]),
      )
    )
      return null;
    return {
      field: "status",
      op: "in",
      values: value.values as readonly DatabasePageSummary["status"][],
    };
  }
  if (value.field === "priority" && value.op === "in") {
    if (
      !value.values.every((item) => PRIORITY_ORDER.includes(item as Priority))
    ) {
      return null;
    }
    const values = value.values as readonly Priority[];
    return {
      field: "priority",
      op: "in",
      values,
      includeEmpty:
        typeof value.includeEmpty === "boolean"
          ? value.includeEmpty
          : PRIORITY_ORDER.every((priority) => values.includes(priority)),
    };
  }
  if (
    value.field === "tags" &&
    (value.op === "hasAny" || value.op === "hasAll" || value.op === "hasNone")
  ) {
    return { field: "tags", op: value.op, values: value.values };
  }
  return null;
};

const parseLegacyFilterGroups = (
  value: unknown,
): readonly (readonly LegacyFilterClause[])[] | null => {
  if (!isRecord(value) || !Array.isArray(value.any)) return null;
  const groups: LegacyFilterClause[][] = [];
  for (const candidateGroup of value.any) {
    if (!isRecord(candidateGroup) || !Array.isArray(candidateGroup.all))
      return null;
    const clauses: LegacyFilterClause[] = [];
    for (const candidateClause of candidateGroup.all) {
      const clause = parseLegacyFilterClause(candidateClause);
      if (!clause) return null;
      clauses.push(clause);
    }
    groups.push(clauses);
  }
  return groups;
};

const parseLegacySort = (value: unknown): readonly LegacySortKey[] | null => {
  if (!Array.isArray(value)) return null;
  const result: LegacySortKey[] = [];
  for (const candidate of value) {
    if (!isRecord(candidate)) return null;
    if (!LEGACY_SORT_FIELDS.includes(candidate.field as LegacySortField))
      return null;
    if (candidate.direction !== "asc" && candidate.direction !== "desc")
      return null;
    if (
      candidate.emptyPlacement !== undefined &&
      candidate.emptyPlacement !== "first" &&
      candidate.emptyPlacement !== "last"
    )
      return null;
    result.push({
      field: candidate.field as LegacySortField,
      direction: candidate.direction,
      emptyPlacement: candidate.emptyPlacement === "first" ? "first" : "last",
    });
  }
  return result;
};

const parseLegacyViewQuery = (
  config: Readonly<Record<string, DatabaseViewJsonValue>>,
): ValidLegacyViewQuery | null => {
  if (
    config.schemaKey !== "nodex.database-view/legacy-inline" ||
    config.schemaVersion !== 1
  )
    return null;
  const parsedGroups = parseLegacyFilterGroups(config.filter);
  const parsedSort = parseLegacySort(config.sort);
  const groups =
    parsedGroups && parsedGroups.length > 0
      ? parsedGroups
      : DEFAULT_LEGACY_FILTER_GROUPS;
  const sort =
    parsedSort && parsedSort.length > 0 ? parsedSort : DEFAULT_LEGACY_SORT;
  const includeHostPage =
    isRecord(config.options) &&
    typeof config.options.includeHostCard === "boolean"
      ? config.options.includeHostCard
      : false;
  return {
    groups,
    sort,
    includeHostPage,
  };
};

const matchesLegacyClause = (
  page: DatabasePageSummary,
  clause: LegacyFilterClause,
): boolean => {
  if (clause.field === "status") return clause.values.includes(page.status);
  if (clause.field === "priority") {
    if (!page.priority) return clause.includeEmpty;
    return clause.values.includes(page.priority);
  }
  const selectedTags = new Set(clause.values);
  if (clause.op === "hasAny") {
    return page.tags.some((tag) => selectedTags.has(tag));
  }
  if (clause.op === "hasAll") {
    return clause.values.every((tag) => page.tags.includes(tag));
  }
  return !page.tags.some((tag) => selectedTags.has(tag));
};

const matchesLegacyFilter = (
  page: DatabasePageSummary,
  groups: ValidLegacyViewQuery["groups"],
): boolean =>
  groups.length === 0 ||
  groups.some((clauses) =>
    clauses.every((clause) => matchesLegacyClause(page, clause)),
  );

const compareRankKeys = (
  left: DatabaseViewPageRow,
  right: DatabaseViewPageRow,
): number =>
  left.rankKey.localeCompare(right.rankKey) ||
  left.page.id.localeCompare(right.page.id);

const compareRankOnly = (
  left: DatabaseViewPageRow,
  right: DatabaseViewPageRow,
): number => left.rankKey.localeCompare(right.rankKey);

const compareBoardOrder = (
  left: DatabaseViewPageRow,
  right: DatabaseViewPageRow,
): number =>
  WORKFLOW_STATUS_ORDER.indexOf(left.page.status) -
    WORKFLOW_STATUS_ORDER.indexOf(right.page.status) ||
  compareRankOnly(left, right);

const compareNullableRank = (
  left: number | null,
  right: number | null,
  key: LegacySortKey,
): number => {
  if (left === null && right === null) return 0;
  if (left === null) return key.emptyPlacement === "first" ? -1 : 1;
  if (right === null) return key.emptyPlacement === "first" ? 1 : -1;
  return (left - right) * (key.direction === "asc" ? 1 : -1);
};

const compareByLegacySortKey = (
  left: DatabaseViewPageRow,
  right: DatabaseViewPageRow,
  key: LegacySortKey,
): number => {
  const sign = key.direction === "asc" ? 1 : -1;
  if (key.field === "board-order") return compareBoardOrder(left, right) * sign;
  if (key.field === "status") {
    return (
      (WORKFLOW_STATUS_ORDER.indexOf(left.page.status) -
        WORKFLOW_STATUS_ORDER.indexOf(right.page.status)) *
      sign
    );
  }
  if (key.field === "priority") {
    return compareNullableRank(
      left.page.priority ? PRIORITY_ORDER.indexOf(left.page.priority) : null,
      right.page.priority ? PRIORITY_ORDER.indexOf(right.page.priority) : null,
      key,
    );
  }
  if (key.field === "estimate") {
    return compareNullableRank(
      left.page.estimate ? ESTIMATE_ORDER.indexOf(left.page.estimate) : null,
      right.page.estimate ? ESTIMATE_ORDER.indexOf(right.page.estimate) : null,
      key,
    );
  }
  if (key.field === "created") {
    return (
      (new Date(left.page.created).getTime() -
        new Date(right.page.created).getTime()) *
      sign
    );
  }
  return left.page.title.localeCompare(right.page.title) * sign;
};

/**
 * Executes the migrated legacy View query over durable membership rows.
 * Missing or invalid effective fields use the canonical show-all query. This
 * keeps Pages accessible, excludes the host by default, and gives old or
 * partially migrated configs the same deterministic order as a new View.
 */
export const evaluateDatabaseViewRows = (
  model: DatabaseViewReadModel,
  context: { readonly hostBlockId?: string } = {},
): readonly DatabaseViewPageRow[] => {
  const query = parseLegacyViewQuery(model.view.config);
  if (!query) {
    const includeHostPage =
      isRecord(model.view.config.options) &&
      model.view.config.options.includeHostPage === true;
    return context.hostBlockId && !includeHostPage
      ? model.rows.filter((row) => row.page.id !== context.hostBlockId)
      : model.rows;
  }
  const filtered = model.rows.filter((row) => {
    if (!query.includeHostPage && row.page.id === context.hostBlockId)
      return false;
    return matchesLegacyFilter(row.page, query.groups);
  });
  return [...filtered].sort((left, right) => {
    for (const key of query.sort) {
      const result = compareByLegacySortKey(left, right, key);
      if (result !== 0) return result;
    }
    return compareRankKeys(left, right);
  });
};

export interface LegacyInlineDatabaseViewProps {
  readonly sourceProjectId: string;
  readonly rulesV2B64?: string;
  readonly propertyOrderCsv?: string;
  readonly hiddenPropertiesCsv?: string;
  readonly showEmptyEstimate?: "true" | "false";
  readonly showEmptyPriority?: "true" | "false";
}

export interface LegacyInlineDatabaseViewConfigV1 {
  readonly schemaKey: "nodex.database-view/legacy-inline";
  readonly schemaVersion: 1;
  readonly filter: DatabaseViewJsonValue;
  readonly sort: readonly DatabaseViewJsonValue[];
  readonly group: null;
  readonly display: {
    readonly propertyOrder: readonly string[];
    readonly hiddenProperties: readonly string[];
    readonly showEmptyEstimate: boolean;
    readonly showEmptyPriority: boolean;
  };
  readonly options: {
    readonly includeHostCard: boolean;
  };
  /**
   * Lossless migration provenance. `rulesV2B64` is deliberately retained even
   * when it is malformed so a later schema migration can recover or inspect
   * the exact legacy payload instead of guessing at renderer defaults.
   */
  readonly legacy: {
    readonly source: "toggleListInlineView";
    readonly sourceBlockId: string;
    readonly sourceProjectId: string;
    readonly rulesV2B64: string;
    readonly rulesV2: DatabaseViewJsonValue;
    readonly propertyOrderCsv: string;
    readonly hiddenPropertiesCsv: string;
    readonly showEmptyEstimate: "true" | "false";
    readonly showEmptyPriority: "true" | "false";
  };
}

const decodeBase64Url = (value: string): string | null => {
  if (!value) return null;
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const remainder = normalized.length % 4;
  const padded =
    remainder === 0 ? normalized : `${normalized}${"=".repeat(4 - remainder)}`;

  try {
    const binary = globalThis.atob(padded);
    const bytes = Uint8Array.from(binary, (character) =>
      character.charCodeAt(0),
    );
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
};

const parseJsonValue = (value: string): DatabaseViewJsonValue => {
  try {
    return JSON.parse(value) as DatabaseViewJsonValue;
  } catch {
    return null;
  }
};

const isJsonRecord = (
  value: DatabaseViewJsonValue,
): value is Readonly<Record<string, DatabaseViewJsonValue>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseCsv = (value: string): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const rawItem of value.split(",")) {
    const item = rawItem.trim();
    if (!item || seen.has(item)) continue;
    seen.add(item);
    result.push(item);
  }
  return result;
};

const serializeLegacyFilterClause = (
  clause: LegacyFilterClause,
): DatabaseViewJsonValue => {
  if (clause.field !== "priority") {
    return { field: clause.field, op: clause.op, values: clause.values };
  }
  return {
    field: clause.field,
    op: clause.op,
    values: clause.values,
    includeEmpty: clause.includeEmpty,
  };
};

const serializeLegacyFilterGroups = (
  groups: ValidLegacyViewQuery["groups"],
): DatabaseViewJsonValue => ({
  any: groups.map((clauses) => ({
    all: clauses.map(serializeLegacyFilterClause),
  })),
});

const serializeLegacySort = (
  sort: ValidLegacyViewQuery["sort"],
): readonly DatabaseViewJsonValue[] =>
  sort.map((key) => ({
    field: key.field,
    direction: key.direction,
    ...(key.emptyPlacement === "first" ? { emptyPlacement: "first" } : {}),
  }));

const normalizeLegacyFilterValue = (value: unknown): DatabaseViewJsonValue => {
  const parsed = parseLegacyFilterGroups(value);
  return serializeLegacyFilterGroups(
    parsed && parsed.length > 0 ? parsed : DEFAULT_LEGACY_FILTER_GROUPS,
  );
};

const normalizeLegacySortValue = (
  value: unknown,
): readonly DatabaseViewJsonValue[] => {
  const parsed = parseLegacySort(value);
  return serializeLegacySort(
    parsed && parsed.length > 0 ? parsed : DEFAULT_LEGACY_SORT,
  );
};

export const inlineDatabaseViewId = (sourceBlockId: string): string =>
  `database-view:inline:${sourceBlockId}`;

export const createLegacyInlineDatabaseViewConfig = (input: {
  readonly sourceBlockId: string;
  readonly props: LegacyInlineDatabaseViewProps;
}): LegacyInlineDatabaseViewConfigV1 => {
  const rulesV2B64 = input.props.rulesV2B64 ?? "";
  const decodedRules = decodeBase64Url(rulesV2B64);
  const rulesV2 = decodedRules === null ? null : parseJsonValue(decodedRules);
  const rulesRecord = isJsonRecord(rulesV2) ? rulesV2 : null;
  const propertyOrderCsv = input.props.propertyOrderCsv ?? "";
  const hiddenPropertiesCsv = input.props.hiddenPropertiesCsv ?? "";
  const showEmptyEstimate =
    input.props.showEmptyEstimate === "true" ? "true" : "false";
  const showEmptyPriority =
    input.props.showEmptyPriority === "true" ? "true" : "false";

  return {
    schemaKey: "nodex.database-view/legacy-inline",
    schemaVersion: 1,
    filter: normalizeLegacyFilterValue(rulesRecord?.filter),
    sort: normalizeLegacySortValue(rulesRecord?.sort),
    group: null,
    display: {
      propertyOrder: parseCsv(propertyOrderCsv),
      hiddenProperties: parseCsv(hiddenPropertiesCsv),
      showEmptyEstimate: showEmptyEstimate === "true",
      showEmptyPriority: showEmptyPriority === "true",
    },
    options: {
      includeHostCard: rulesRecord?.includeHostCard === true,
    },
    legacy: {
      source: "toggleListInlineView",
      sourceBlockId: input.sourceBlockId,
      sourceProjectId: input.props.sourceProjectId,
      rulesV2B64,
      rulesV2,
      propertyOrderCsv,
      hiddenPropertiesCsv,
      showEmptyEstimate,
      showEmptyPriority,
    },
  };
};

const inlinePropertyId = (databaseBlockId: string, key: string): string =>
  `${databaseBlockId}:property:${key}`;

const compileLegacyClause = (
  databaseBlockId: string,
  clause: LegacyFilterClause,
): DatabaseViewFilterNode => {
  const propertyId = inlinePropertyId(databaseBlockId, clause.field);
  const valueClauses: DatabaseViewFilterNode[] = clause.values.map((value) => ({
    kind: "clause",
    propertyId,
    operator: clause.field === "tags" ? "contains" : "equals",
    value,
  }));
  if (clause.field === "priority" && clause.includeEmpty) {
    valueClauses.push({ kind: "clause", propertyId, operator: "is_empty" });
  }
  if (clause.field !== "tags" || clause.op === "hasAny") {
    return { kind: "group", operator: "or", children: valueClauses };
  }
  if (clause.op === "hasAll") {
    return { kind: "group", operator: "and", children: valueClauses };
  }
  return {
    kind: "group",
    operator: "and",
    children: clause.values.map((value) => ({
      kind: "clause",
      propertyId,
      operator: "not_contains",
      value,
    })),
  };
};

const compileLegacySort = (
  databaseBlockId: string,
  sort: LegacySortKey,
): DatabaseViewSort => ({
  field:
    sort.field === "board-order"
      ? { kind: "manual" }
      : sort.field === "title" || sort.field === "created"
        ? { kind: sort.field }
        : {
            kind: "property",
            propertyId: inlinePropertyId(databaseBlockId, sort.field),
          },
  direction: sort.direction,
  nulls: sort.emptyPlacement,
});

/** Convert one legacy inline query directly into the canonical durable View schema. */
export const createGeneralInlineDatabaseViewConfig = (input: {
  readonly databaseBlockId: string;
  readonly sourceBlockId: string;
  readonly props: LegacyInlineDatabaseViewProps;
}): DatabaseViewConfig => {
  const legacy = createLegacyInlineDatabaseViewConfig(input);
  const query = parseLegacyViewQuery(
    legacy as unknown as Readonly<Record<string, DatabaseViewJsonValue>>,
  );
  if (!query) {
    throw new TypeError("Canonical legacy inline View config could not be parsed");
  }
  const groups = query.groups.map(
    (clauses): DatabaseViewFilterNode => ({
      kind: "group",
      operator: "and",
      children: clauses.map((clause) =>
        compileLegacyClause(input.databaseBlockId, clause),
      ),
    }),
  );
  const propertyOrder =
    legacy.display.propertyOrder.length > 0
      ? legacy.display.propertyOrder
      : ["priority", "estimate", "status", "tags"];
  const hidden = new Set(legacy.display.hiddenProperties);
  const supportedProperties = new Set([
    "status",
    "priority",
    "estimate",
    "tags",
    "due_date",
    "scheduled_start",
    "scheduled_end",
    "assignee",
  ]);
  return {
    schemaKey: "nodex.database-view",
    schemaVersion: 1,
    filter: { kind: "group", operator: "or", children: groups },
    sort: query.sort.map((sort) =>
      compileLegacySort(input.databaseBlockId, sort),
    ),
    group: null,
    display: {
      propertyIds: propertyOrder
        .filter((key) => supportedProperties.has(key) && !hidden.has(key))
        .map((key) => inlinePropertyId(input.databaseBlockId, key)),
      showTitle: true,
    },
    options: { includeHostPage: query.includeHostPage },
  };
};
