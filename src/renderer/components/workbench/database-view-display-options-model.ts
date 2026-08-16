import type {
  DatabaseViewCompletedRange,
  DatabaseViewField,
  DatabaseViewLayout,
  DatabaseViewSort,
  EffectiveDatabaseViewPresentation,
} from "../../../shared/database-kernel";

export type DatabaseViewDisplayOptionAction =
  | { readonly kind: "set_layout"; readonly layout: DatabaseViewLayout }
  | { readonly kind: "set_group"; readonly propertyId: string | null }
  | { readonly kind: "set_subgroup"; readonly propertyId: string | null }
  | { readonly kind: "toggle_group_direction" }
  | { readonly kind: "set_order_field"; readonly field: DatabaseViewSort["field"] }
  | { readonly kind: "toggle_order_direction" }
  | { readonly kind: "set_completed_range"; readonly range: DatabaseViewCompletedRange }
  | { readonly kind: "set_completed_recency"; readonly enabled: boolean }
  | { readonly kind: "set_show_sub_pages"; readonly enabled: boolean }
  | { readonly kind: "set_nested_sub_pages"; readonly enabled: boolean }
  | { readonly kind: "set_show_empty_groups"; readonly enabled: boolean }
  | { readonly kind: "set_show_description"; readonly enabled: boolean }
  | { readonly kind: "toggle_field"; readonly field: DatabaseViewField };

export interface DatabaseViewDisplayOptionCapabilities {
  readonly groupablePropertyIds: ReadonlySet<string>;
}

export const databaseViewDisplayFieldKey = (field: DatabaseViewField): string =>
  field.kind === "property"
    ? `property:${field.propertyId}`
    : `intrinsic:${field.field}`;

const primarySort = (
  effective: EffectiveDatabaseViewPresentation,
): DatabaseViewSort => effective.presentation.sort[0] ?? {
  field: { kind: "manual" },
  direction: "asc",
  nulls: "last",
};

export const displayFieldForcedByOrdering = (
  field: DatabaseViewSort["field"],
): DatabaseViewField | null => {
  if (field.kind === "property") {
    return { kind: "property", propertyId: field.propertyId };
  }
  if (field.kind === "created") {
    return { kind: "intrinsic", field: "created_at" };
  }
  return null;
};

export const reduceDisplayOptionChange = (
  effective: EffectiveDatabaseViewPresentation,
  action: DatabaseViewDisplayOptionAction,
  capabilities: DatabaseViewDisplayOptionCapabilities,
): EffectiveDatabaseViewPresentation => {
  const presentation = effective.presentation;
  if (action.kind === "set_layout") {
    return { ...effective, layout: action.layout };
  }
  if (action.kind === "set_group") {
    const propertyId = action.propertyId;
    if (propertyId !== null && !capabilities.groupablePropertyIds.has(propertyId)) {
      return effective;
    }
    return {
      ...effective,
      presentation: {
        ...presentation,
        group: propertyId === null ? null : { propertyId },
        subgroup: propertyId !== null
            && presentation.subgroup?.propertyId === propertyId
          ? null
          : presentation.subgroup,
      },
    };
  }
  if (action.kind === "set_subgroup") {
    const propertyId = action.propertyId;
    if (propertyId === null) {
      return { ...effective, presentation: { ...presentation, subgroup: null } };
    }
    if (presentation.group === null
      || presentation.group.propertyId === propertyId
      || !capabilities.groupablePropertyIds.has(propertyId)) {
      return effective;
    }
    return {
      ...effective,
      presentation: { ...presentation, subgroup: { propertyId } },
    };
  }
  if (action.kind === "toggle_group_direction") {
    if (presentation.group === null) return effective;
    return {
      ...effective,
      presentation: {
        ...presentation,
        groupDirection: presentation.groupDirection === "asc" ? "desc" : "asc",
      },
    };
  }
  if (action.kind === "set_order_field") {
    const nextPrimary = { ...primarySort(effective), field: action.field };
    return {
      ...effective,
      presentation: {
        ...presentation,
        sort: presentation.sort.length === 0
          ? [nextPrimary]
          : presentation.sort.map((sort, index) => index === 0 ? nextPrimary : sort),
      },
    };
  }
  if (action.kind === "toggle_order_direction") {
    const current = primarySort(effective);
    const nextPrimary = {
      ...current,
      direction: current.direction === "asc" ? "desc" as const : "asc" as const,
    };
    return {
      ...effective,
      presentation: {
        ...presentation,
        sort: presentation.sort.length === 0
          ? [nextPrimary]
          : presentation.sort.map((sort, index) => index === 0 ? nextPrimary : sort),
      },
    };
  }
  if (action.kind === "set_completed_range") {
    return {
      ...effective,
      presentation: {
        ...presentation,
        completion: { ...presentation.completion, range: action.range },
      },
    };
  }
  if (action.kind === "set_completed_recency") {
    return {
      ...effective,
      presentation: {
        ...presentation,
        completion: {
          ...presentation.completion,
          orderByRecency: action.enabled,
        },
      },
    };
  }
  if (action.kind === "set_show_sub_pages") {
    return {
      ...effective,
      presentation: {
        ...presentation,
        hierarchy: {
          showSubPages: action.enabled,
          nestedSubPages: action.enabled
            ? presentation.hierarchy.nestedSubPages
            : false,
        },
      },
    };
  }
  if (action.kind === "set_nested_sub_pages") {
    return {
      ...effective,
      presentation: {
        ...presentation,
        hierarchy: {
          showSubPages: action.enabled || presentation.hierarchy.showSubPages,
          nestedSubPages: action.enabled,
        },
      },
    };
  }
  const layout = effective.layout;
  const layoutConfig = presentation.layouts[layout];
  if (action.kind === "set_show_empty_groups") {
    return {
      ...effective,
      presentation: {
        ...presentation,
        layouts: {
          ...presentation.layouts,
          [layout]: { ...layoutConfig, showEmptyGroups: action.enabled },
        },
      },
    };
  }
  if (action.kind === "set_show_description") {
    return {
      ...effective,
      presentation: {
        ...presentation,
        layouts: {
          ...presentation.layouts,
          [layout]: { ...layoutConfig, showDescription: action.enabled },
        },
      },
    };
  }
  const key = databaseViewDisplayFieldKey(action.field);
  const visible = layoutConfig.fields.some(
    (field) => databaseViewDisplayFieldKey(field) === key,
  );
  return {
    ...effective,
    presentation: {
      ...presentation,
      layouts: {
        ...presentation.layouts,
        [layout]: {
          ...layoutConfig,
          fields: visible
            ? layoutConfig.fields.filter(
                (field) => databaseViewDisplayFieldKey(field) !== key,
              )
            : [...layoutConfig.fields, action.field],
        },
      },
    },
  };
};
