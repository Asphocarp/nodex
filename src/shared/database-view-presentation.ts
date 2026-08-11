import type {
  DatabaseViewCompletedRange,
  DatabaseViewConfigV2,
  DatabaseViewConfigV4,
  DatabaseViewField,
  DatabaseViewLayout,
  DatabaseViewLayoutDisplayConfig,
  DatabaseViewPresentationConfig,
  DatabaseViewPresentationOverride,
  DatabaseViewSort,
  EffectiveDatabaseViewPresentation,
} from "./database-kernel";

const MAX_SORT_RULES = 4;
const MAX_DISPLAY_FIELDS = 64;

const COMPLETED_RANGES: readonly DatabaseViewCompletedRange[] = [
  "all",
  "past_month",
  "past_week",
  "past_day",
  "none",
];

export interface DatabaseViewPropertyCapability {
  readonly propertyId: string;
  readonly sortable: boolean;
  readonly groupable: boolean;
  /** Finite properties can enumerate meaningful empty groups. */
  readonly finite: boolean;
}

export interface DatabaseViewCapabilities {
  readonly properties: readonly DatabaseViewPropertyCapability[];
  readonly intrinsicFields?: readonly Extract<
    DatabaseViewField,
    { readonly kind: "intrinsic" }
  >["field"][];
  /** The Source has a canonical workflow status whose completed state is `ship`. */
  readonly taskStatusPropertyId?: string;
}

const fieldKey = (field: DatabaseViewField): string =>
  field.kind === "property"
    ? `property:${field.propertyId}`
    : `intrinsic:${field.field}`;

const normalizedFields = (
  fields: readonly DatabaseViewField[],
  propertyCapabilities: ReadonlyMap<string, DatabaseViewPropertyCapability>,
  intrinsicFields: ReadonlySet<string>,
): readonly DatabaseViewField[] => {
  const seen = new Set<string>();
  const normalized: DatabaseViewField[] = [];
  for (const field of fields) {
    if (normalized.length >= MAX_DISPLAY_FIELDS) break;
    if (
      field.kind === "property"
      && !propertyCapabilities.has(field.propertyId)
    ) {
      continue;
    }
    if (field.kind === "intrinsic" && !intrinsicFields.has(field.field)) {
      continue;
    }
    const key = fieldKey(field);
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(field);
  }
  return normalized;
};

const normalizedSort = (
  sort: readonly DatabaseViewSort[],
  properties: ReadonlyMap<string, DatabaseViewPropertyCapability>,
): readonly DatabaseViewSort[] => {
  const normalized: DatabaseViewSort[] = [];
  const seen = new Set<string>();
  for (const rule of sort) {
    if (normalized.length >= MAX_SORT_RULES) break;
    if (rule.field.kind === "property") {
      const capability = properties.get(rule.field.propertyId);
      if (!capability?.sortable) continue;
    }
    const key =
      rule.field.kind === "property"
        ? `property:${rule.field.propertyId}`
        : rule.field.kind;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(rule);
  }
  return normalized;
};

const normalizedGroup = (
  group: null | { readonly propertyId: string },
  properties: ReadonlyMap<string, DatabaseViewPropertyCapability>,
): null | { readonly propertyId: string } => {
  if (!group) return null;
  if (!properties.get(group.propertyId)?.groupable) return null;
  return group;
};

const normalizedCompletedRange = (
  range: DatabaseViewCompletedRange,
): DatabaseViewCompletedRange =>
  COMPLETED_RANGES.includes(range) ? range : "all";

const normalizedLayout = (
  layout: DatabaseViewLayoutDisplayConfig,
  group: DatabaseViewPresentationConfig["group"],
  properties: ReadonlyMap<string, DatabaseViewPropertyCapability>,
  intrinsicFields: ReadonlySet<string>,
): DatabaseViewLayoutDisplayConfig => ({
  fields: normalizedFields(layout.fields, properties, intrinsicFields),
  showEmptyGroups:
    layout.showEmptyGroups
    && group !== null
    && properties.get(group.propertyId)?.finite === true,
});

const overlayPresentation = (
  durable: DatabaseViewPresentationConfig,
  override: DatabaseViewPresentationOverride | undefined,
): DatabaseViewPresentationConfig => ({
  sort: override?.sort ?? durable.sort,
  group: override && "group" in override ? override.group ?? null : durable.group,
  subgroup:
    override && "subgroup" in override
      ? override.subgroup ?? null
      : durable.subgroup,
  groupDirection: override?.groupDirection ?? durable.groupDirection,
  completion: {
    range: override?.completion?.range ?? durable.completion.range,
    orderByRecency:
      override?.completion?.orderByRecency
      ?? durable.completion.orderByRecency,
  },
  hierarchy: {
    showSubPages:
      override?.hierarchy?.showSubPages
      ?? durable.hierarchy.showSubPages,
    nestedSubPages:
      override?.hierarchy?.nestedSubPages
      ?? durable.hierarchy.nestedSubPages,
  },
  layouts: {
    board: {
      fields: override?.layouts?.board?.fields ?? durable.layouts.board.fields,
      showEmptyGroups:
        override?.layouts?.board?.showEmptyGroups
        ?? durable.layouts.board.showEmptyGroups,
    },
    list: {
      fields: override?.layouts?.list?.fields ?? durable.layouts.list.fields,
      showEmptyGroups:
        override?.layouts?.list?.showEmptyGroups
        ?? durable.layouts.list.showEmptyGroups,
    },
  },
});

/**
 * Resolves the one presentation consumed by Core reads and renderer layouts.
 * Invalid or stale Profile fields fail closed to the durable Source contract.
 */
export const resolveEffectiveDatabaseView = (
  defaultLayout: DatabaseViewLayout,
  durable: DatabaseViewPresentationConfig,
  override: DatabaseViewPresentationOverride | undefined,
  capabilities: DatabaseViewCapabilities,
): EffectiveDatabaseViewPresentation => {
  const properties = new Map(
    capabilities.properties.map((property) => [
      property.propertyId,
      property,
    ]),
  );
  const intrinsicFields = new Set(
    capabilities.intrinsicFields ?? ["created_at", "updated_at"],
  );
  const overlaid = overlayPresentation(durable, override);
  const group = normalizedGroup(overlaid.group, properties);
  const candidateSubgroup = normalizedGroup(overlaid.subgroup, properties);
  const subgroup =
    !group || candidateSubgroup?.propertyId === group.propertyId
      ? null
      : candidateSubgroup;
  const taskStatusAvailable =
    capabilities.taskStatusPropertyId !== undefined
    && properties.has(capabilities.taskStatusPropertyId);

  return {
    layout: override?.layout ?? defaultLayout,
    presentation: {
      sort: normalizedSort(overlaid.sort, properties),
      group,
      subgroup,
      groupDirection: overlaid.groupDirection,
      completion: taskStatusAvailable
        ? {
            range: normalizedCompletedRange(overlaid.completion.range),
            orderByRecency: overlaid.completion.orderByRecency,
          }
        : { range: "all", orderByRecency: false },
      hierarchy: {
        showSubPages: overlaid.hierarchy.showSubPages,
        nestedSubPages:
          overlaid.hierarchy.showSubPages
          && overlaid.hierarchy.nestedSubPages,
      },
      layouts: {
        board: normalizedLayout(
          overlaid.layouts.board,
          group && (!subgroup || properties.get(subgroup.propertyId)?.finite)
            ? group
            : null,
          properties,
          intrinsicFields,
        ),
        list: normalizedLayout(
          overlaid.layouts.list,
          group && (!subgroup || properties.get(subgroup.propertyId)?.finite)
            ? group
            : null,
          properties,
          intrinsicFields,
        ),
      },
    },
  };
};

const equal = (left: unknown, right: unknown): boolean =>
  JSON.stringify(left) === JSON.stringify(right);

/** Produces the minimal Profile-local patch relative to the durable default. */
export const compactDatabaseViewPresentationOverride = (
  durable: EffectiveDatabaseViewPresentation,
  effective: EffectiveDatabaseViewPresentation,
): DatabaseViewPresentationOverride | null => {
  const completion: {
    range?: DatabaseViewCompletedRange;
    orderByRecency?: boolean;
  } = {};
  if (
    durable.presentation.completion.range
    !== effective.presentation.completion.range
  ) {
    completion.range = effective.presentation.completion.range;
  }
  if (
    durable.presentation.completion.orderByRecency
    !== effective.presentation.completion.orderByRecency
  ) {
    completion.orderByRecency =
      effective.presentation.completion.orderByRecency;
  }

  const compactLayout = (
    baseline: DatabaseViewLayoutDisplayConfig,
    current: DatabaseViewLayoutDisplayConfig,
  ): Partial<DatabaseViewLayoutDisplayConfig> | undefined => {
    const result: {
      fields?: readonly DatabaseViewField[];
      showEmptyGroups?: boolean;
    } = {};
    if (!equal(baseline.fields, current.fields)) result.fields = current.fields;
    if (baseline.showEmptyGroups !== current.showEmptyGroups) {
      result.showEmptyGroups = current.showEmptyGroups;
    }
    return Object.keys(result).length > 0 ? result : undefined;
  };

  const board = compactLayout(
    durable.presentation.layouts.board,
    effective.presentation.layouts.board,
  );
  const list = compactLayout(
    durable.presentation.layouts.list,
    effective.presentation.layouts.list,
  );
  const override: {
    layout?: DatabaseViewLayout;
    sort?: readonly DatabaseViewSort[];
    group?: DatabaseViewPresentationConfig["group"];
    subgroup?: DatabaseViewPresentationConfig["subgroup"];
    groupDirection?: DatabaseViewPresentationConfig["groupDirection"];
    completion?: DatabaseViewPresentationOverride["completion"];
    hierarchy?: DatabaseViewPresentationOverride["hierarchy"];
    layouts?: DatabaseViewPresentationOverride["layouts"];
  } = {};

  if (durable.layout !== effective.layout) override.layout = effective.layout;
  if (!equal(durable.presentation.sort, effective.presentation.sort)) {
    override.sort = effective.presentation.sort;
  }
  if (!equal(durable.presentation.group, effective.presentation.group)) {
    override.group = effective.presentation.group;
  }
  if (!equal(durable.presentation.subgroup, effective.presentation.subgroup)) {
    override.subgroup = effective.presentation.subgroup;
  }
  if (durable.presentation.groupDirection !== effective.presentation.groupDirection) {
    override.groupDirection = effective.presentation.groupDirection;
  }
  if (Object.keys(completion).length > 0) override.completion = completion;
  const hierarchy: {
    showSubPages?: boolean;
    nestedSubPages?: boolean;
  } = {};
  if (
    durable.presentation.hierarchy.showSubPages
    !== effective.presentation.hierarchy.showSubPages
  ) {
    hierarchy.showSubPages = effective.presentation.hierarchy.showSubPages;
  }
  if (
    durable.presentation.hierarchy.nestedSubPages
    !== effective.presentation.hierarchy.nestedSubPages
  ) {
    hierarchy.nestedSubPages = effective.presentation.hierarchy.nestedSubPages;
  }
  if (Object.keys(hierarchy).length > 0) override.hierarchy = hierarchy;
  if (board || list) override.layouts = { ...(board ? { board } : {}), ...(list ? { list } : {}) };
  return Object.keys(override).length > 0 ? override : null;
};

/** Deterministically upgrades the durable v2 presentation shape. */
export const upgradeDatabaseViewConfigV2 = (
  config: DatabaseViewConfigV2,
): DatabaseViewConfigV4 => {
  const fields = config.display.propertyIds.map(
    (propertyId): DatabaseViewField => ({ kind: "property", propertyId }),
  );
  return {
    schemaKey: "nodex.database-view",
    schemaVersion: 4,
    filter: config.filter,
    presentation: {
      sort: config.sort,
      group: config.group,
      subgroup: null,
      groupDirection: "asc",
      completion: { range: "all", orderByRecency: false },
      hierarchy: { showSubPages: true, nestedSubPages: false },
      layouts: {
        board: { fields, showEmptyGroups: false },
        list: { fields, showEmptyGroups: false },
      },
    },
  };
};
