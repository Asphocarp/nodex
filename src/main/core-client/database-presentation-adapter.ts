import type {
  DatabaseViewField,
  DatabaseViewPresentationOverride,
} from "../../shared/database-kernel";
import type { DatabaseRead } from "./types";

export type CoreDatabaseViewPresentationOverride = Extract<
  Extract<DatabaseRead, { readonly kind: "view_window" }>["target"],
  { readonly kind: "presented_view" }
>["presentation_override"];

const toCoreViewField = (
  field: DatabaseViewField,
): Extract<
  NonNullable<
    NonNullable<CoreDatabaseViewPresentationOverride["layouts"]>["board"]
  >["fields"],
  readonly unknown[]
>[number] => field.kind === "property"
  ? { kind: "property", property_id: field.propertyId }
  : { kind: "intrinsic", field: field.field };

export const toCoreDatabaseViewPresentationOverride = (
  override: DatabaseViewPresentationOverride,
): CoreDatabaseViewPresentationOverride => ({
  ...(override.layout === undefined ? {} : { layout: override.layout }),
  ...(override.sort === undefined
    ? {}
    : {
        sort: override.sort.map((rule) => ({
          field: rule.field.kind === "property"
            ? { kind: "property" as const, property_id: rule.field.propertyId }
            : { kind: rule.field.kind },
          direction: rule.direction,
          nulls: rule.nulls,
        })),
      }),
  ...(override.group === undefined
    ? {}
    : {
        group: override.group === null
          ? { kind: "none" as const }
          : { kind: "property" as const, property_id: override.group.propertyId },
      }),
  ...(override.subgroup === undefined
    ? {}
    : {
        subgroup: override.subgroup === null
          ? { kind: "none" as const }
          : { kind: "property" as const, property_id: override.subgroup.propertyId },
      }),
  ...(override.groupDirection === undefined
    ? {}
    : { group_direction: override.groupDirection }),
  ...(override.completion === undefined
    ? {}
    : {
        completion: {
          ...(override.completion.range === undefined
            ? {}
            : { range: override.completion.range }),
          ...(override.completion.orderByRecency === undefined
            ? {}
            : { order_by_recency: override.completion.orderByRecency }),
        },
      }),
  ...(override.hierarchy === undefined
    ? {}
    : {
        hierarchy: {
          ...(override.hierarchy.showSubPages === undefined
            ? {}
            : { show_sub_pages: override.hierarchy.showSubPages }),
          ...(override.hierarchy.nestedSubPages === undefined
            ? {}
            : { nested_sub_pages: override.hierarchy.nestedSubPages }),
        },
      }),
  ...(override.layouts === undefined
    ? {}
    : {
        layouts: (Object.keys(override.layouts) as ("board" | "list")[]).reduce<
          NonNullable<CoreDatabaseViewPresentationOverride["layouts"]>
        >((layouts, layout) => {
          const display = override.layouts?.[layout];
          if (!display) return layouts;
          return {
            ...layouts,
            [layout]: {
              ...(display.fields === undefined
                ? {}
                : { fields: display.fields.map(toCoreViewField) }),
              ...(display.showEmptyGroups === undefined
                ? {}
                : { show_empty_groups: display.showEmptyGroups }),
            },
          };
        }, {}),
      }),
});

const fromCoreViewField = (
  field: NonNullable<
    NonNullable<
      NonNullable<CoreDatabaseViewPresentationOverride["layouts"]>["board"]
    >["fields"]
  >[number],
): DatabaseViewField => field.kind === "property"
  ? { kind: "property", propertyId: field.property_id }
  : {
      kind: "intrinsic",
      field: field.field as "page_id" | "created_at" | "updated_at",
    };

export const fromCoreDatabaseViewPresentationOverride = (
  override: CoreDatabaseViewPresentationOverride,
): DatabaseViewPresentationOverride => ({
  ...(override.layout == null ? {} : { layout: override.layout }),
  ...(override.sort == null
    ? {}
    : {
        sort: override.sort.map((rule) => ({
          field: rule.field.kind === "property"
            ? { kind: "property" as const, propertyId: rule.field.property_id }
            : { kind: rule.field.kind },
          direction: rule.direction,
          nulls: rule.nulls,
        })),
      }),
  ...(override.group == null
    ? {}
    : {
        group: override.group.kind === "none"
          ? null
          : { propertyId: override.group.property_id },
      }),
  ...(override.subgroup == null
    ? {}
    : {
        subgroup: override.subgroup.kind === "none"
          ? null
          : { propertyId: override.subgroup.property_id },
      }),
  ...(override.group_direction == null
    ? {}
    : { groupDirection: override.group_direction }),
  ...(override.completion == null
    ? {}
    : {
        completion: {
          ...(override.completion.range == null
            ? {}
            : { range: override.completion.range }),
          ...(override.completion.order_by_recency == null
            ? {}
            : { orderByRecency: override.completion.order_by_recency }),
        },
      }),
  ...(override.hierarchy == null
    ? {}
    : {
        hierarchy: {
          ...(override.hierarchy.show_sub_pages == null
            ? {}
            : { showSubPages: override.hierarchy.show_sub_pages }),
          ...(override.hierarchy.nested_sub_pages == null
            ? {}
            : { nestedSubPages: override.hierarchy.nested_sub_pages }),
        },
      }),
  ...(override.layouts == null
    ? {}
    : {
        layouts: (["board", "list"] as const).reduce<
          NonNullable<DatabaseViewPresentationOverride["layouts"]>
        >((layouts, layout) => {
          const display = override.layouts?.[layout];
          if (display == null) return layouts;
          return {
            ...layouts,
            [layout]: {
              ...(display.fields == null
                ? {}
                : { fields: display.fields.map(fromCoreViewField) }),
              ...(display.show_empty_groups == null
                ? {}
                : { showEmptyGroups: display.show_empty_groups }),
            },
          };
        }, {}),
      }),
});
