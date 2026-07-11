import { CARD_STATUS_ORDER } from "./card-status";
import type { CardSummary, Estimate, Priority } from "./types";

export interface ReadDatabaseViewReferenceInput {
  /**
   * The Project containing the reference surface. The durable View may belong
   * to another Project and reports that canonical Project in its definition.
   */
  readonly requestingProjectId: string;
  readonly databaseViewId: string;
  /** Host Card identity used only for window-local include/exclude projection. */
  readonly hostBlockId?: string;
}

export type DatabaseViewKind = "kanban" | "list" | "calendar" | "canvas";

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
  readonly projectId: string;
  readonly name: string;
  readonly kind: DatabaseViewKind;
  readonly config: Readonly<Record<string, DatabaseViewJsonValue>>;
  readonly isPrimary: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DatabaseViewCardRow {
  readonly card: CardSummary;
  readonly groupKey: string | null;
  readonly rankKey: string;
}

export interface DatabaseViewReadModel {
  readonly view: DatabaseViewDefinition;
  readonly rows: readonly DatabaseViewCardRow[];
}

type LegacyFilterClause =
  | {
      readonly field: "status";
      readonly op: "in";
      readonly values: readonly CardSummary["status"][];
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
  readonly includeHostCard: boolean;
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
    { field: "status", op: "in", values: CARD_STATUS_ORDER },
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
        CARD_STATUS_ORDER.includes(item as CardSummary["status"]),
      )
    )
      return null;
    return {
      field: "status",
      op: "in",
      values: value.values as readonly CardSummary["status"][],
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
  const includeHostCard =
    isRecord(config.options) &&
    typeof config.options.includeHostCard === "boolean"
      ? config.options.includeHostCard
      : false;
  return {
    groups,
    sort,
    includeHostCard,
  };
};

const matchesLegacyClause = (
  card: CardSummary,
  clause: LegacyFilterClause,
): boolean => {
  if (clause.field === "status") return clause.values.includes(card.status);
  if (clause.field === "priority") {
    if (!card.priority) return clause.includeEmpty;
    return clause.values.includes(card.priority);
  }
  const selectedTags = new Set(clause.values);
  if (clause.op === "hasAny") {
    return card.tags.some((tag) => selectedTags.has(tag));
  }
  if (clause.op === "hasAll") {
    return clause.values.every((tag) => card.tags.includes(tag));
  }
  return !card.tags.some((tag) => selectedTags.has(tag));
};

const matchesLegacyFilter = (
  card: CardSummary,
  groups: ValidLegacyViewQuery["groups"],
): boolean =>
  groups.length === 0 ||
  groups.some((clauses) =>
    clauses.every((clause) => matchesLegacyClause(card, clause)),
  );

const compareRankKeys = (
  left: DatabaseViewCardRow,
  right: DatabaseViewCardRow,
): number =>
  left.rankKey.localeCompare(right.rankKey) ||
  left.card.id.localeCompare(right.card.id);

const compareRankOnly = (
  left: DatabaseViewCardRow,
  right: DatabaseViewCardRow,
): number => left.rankKey.localeCompare(right.rankKey);

const compareBoardOrder = (
  left: DatabaseViewCardRow,
  right: DatabaseViewCardRow,
): number =>
  CARD_STATUS_ORDER.indexOf(left.card.status) -
    CARD_STATUS_ORDER.indexOf(right.card.status) ||
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
  left: DatabaseViewCardRow,
  right: DatabaseViewCardRow,
  key: LegacySortKey,
): number => {
  const sign = key.direction === "asc" ? 1 : -1;
  if (key.field === "board-order") return compareBoardOrder(left, right) * sign;
  if (key.field === "status") {
    return (
      (CARD_STATUS_ORDER.indexOf(left.card.status) -
        CARD_STATUS_ORDER.indexOf(right.card.status)) *
      sign
    );
  }
  if (key.field === "priority") {
    return compareNullableRank(
      left.card.priority ? PRIORITY_ORDER.indexOf(left.card.priority) : null,
      right.card.priority ? PRIORITY_ORDER.indexOf(right.card.priority) : null,
      key,
    );
  }
  if (key.field === "estimate") {
    return compareNullableRank(
      left.card.estimate ? ESTIMATE_ORDER.indexOf(left.card.estimate) : null,
      right.card.estimate ? ESTIMATE_ORDER.indexOf(right.card.estimate) : null,
      key,
    );
  }
  if (key.field === "created") {
    return (
      (new Date(left.card.created).getTime() -
        new Date(right.card.created).getTime()) *
      sign
    );
  }
  return left.card.title.localeCompare(right.card.title) * sign;
};

/**
 * Executes the migrated legacy View query over durable membership rows.
 * Missing or invalid effective fields use the canonical show-all query. This
 * keeps Cards accessible, excludes the host by default, and gives old or
 * partially migrated configs the same deterministic order as a new View.
 */
export const evaluateDatabaseViewRows = (
  model: DatabaseViewReadModel,
  context: { readonly hostBlockId?: string } = {},
): readonly DatabaseViewCardRow[] => {
  const query = parseLegacyViewQuery(model.view.config);
  if (!query) return model.rows;
  const filtered = model.rows.filter((row) => {
    if (!query.includeHostCard && row.card.id === context.hostBlockId)
      return false;
    return matchesLegacyFilter(row.card, query.groups);
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
