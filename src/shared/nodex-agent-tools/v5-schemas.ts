import { z } from "zod";
import {
  parseDataSourceOptionId,
  parseDataSourcePropertyId,
  type DataSourcePropertyId,
} from "../database-identities";
import {
  FetchV3InputSchema,
  FetchV3OutputSchema,
  QueryDatabaseV3OutputSchema,
  QueryDatabaseViewV3InputSchema,
  QueryDataSourceV3InputSchema,
  SearchV3OutputSchema,
} from "./v3-read-schemas";
import {
  CreatePagesV3InputSchema,
  DuplicatePageV3InputSchema,
  MovePagesV3InputSchema,
} from "./v3-write-schemas";

type IssuePath = readonly PropertyKey[];

const addIdentityIssue = (context: z.RefinementCtx, path: IssuePath, message: string): void => {
  context.addIssue({
    code: "custom",
    message,
    path: [...path],
  });
};

const checkPropertyId = (
  value: unknown,
  context: z.RefinementCtx,
  path: IssuePath,
): DataSourcePropertyId | null => {
  try {
    return parseDataSourcePropertyId(value);
  } catch (error) {
    addIdentityIssue(
      context,
      path,
      error instanceof Error ? error.message : "Invalid Data Source Property identity",
    );
    return null;
  }
};

const checkPropertyIds = (
  values: readonly unknown[] | undefined,
  context: z.RefinementCtx,
  path: IssuePath,
): void => {
  values?.forEach((value, index) => {
    checkPropertyId(value, context, [...path, index]);
  });
};

const checkPropertyValueDrafts = (
  values: readonly { readonly propertyId: unknown }[] | undefined,
  context: z.RefinementCtx,
  path: IssuePath,
): void => {
  values?.forEach((value, index) => {
    checkPropertyId(value.propertyId, context, [...path, index, "propertyId"]);
  });
};

interface FilterNode {
  readonly kind: "clause" | "group";
  readonly propertyId?: unknown;
  readonly children?: readonly FilterNode[];
}

const checkFilter = (
  filter: FilterNode | undefined,
  context: z.RefinementCtx,
  path: IssuePath,
): void => {
  if (!filter) return;
  if (filter.kind === "clause") {
    checkPropertyId(filter.propertyId, context, [...path, "propertyId"]);
    return;
  }
  filter.children?.forEach((child, index) => {
    checkFilter(child, context, [...path, "children", index]);
  });
};

const checkSort = (
  sort:
    | readonly {
        readonly field: { readonly kind: string; readonly propertyId?: unknown };
      }[]
    | undefined,
  context: z.RefinementCtx,
  path: IssuePath,
): void => {
  sort?.forEach((entry, index) => {
    if (entry.field.kind !== "property") return;
    checkPropertyId(entry.field.propertyId, context, [...path, index, "field", "propertyId"]);
  });
};

export const checkQueryV5Output = (
  output: z.output<typeof QueryDatabaseV3OutputSchema>,
  context: z.RefinementCtx,
): void => {
  const properties = output.data.dataSource.properties;
  const propertyTypes = new Map<DataSourcePropertyId, string>();
  properties.forEach((property, index) => {
    const propertyId = checkPropertyId(property.propertyId, context, [
      "data",
      "dataSource",
      "properties",
      index,
      "propertyId",
    ]);
    if (!propertyId) return;
    propertyTypes.set(propertyId, property.valueType);

    if (property.valueType !== "select" && property.valueType !== "multi_select") {
      return;
    }
    const options = property.config.options;
    if (!Array.isArray(options)) return;
    options.forEach((option, optionIndex) => {
      if (typeof option !== "object" || option === null || Array.isArray(option)) {
        return;
      }
      const optionId = (option as Readonly<Record<string, unknown>>).id;
      try {
        parseDataSourceOptionId({ propertyId, value: optionId });
      } catch (error) {
        addIdentityIssue(
          context,
          ["data", "dataSource", "properties", index, "config", "options", optionIndex, "id"],
          error instanceof Error ? error.message : "Invalid Data Source option identity",
        );
      }
    });
  });

  output.data.rows.forEach((row, rowIndex) => {
    Object.entries(row.values).forEach(([rawPropertyId, value]) => {
      const propertyId = checkPropertyId(rawPropertyId, context, [
        "data",
        "rows",
        rowIndex,
        "values",
        rawPropertyId,
      ]);
      if (!propertyId) return;
      const valueType = propertyTypes.get(propertyId);
      if (valueType !== "select" && valueType !== "multi_select") return;
      const candidates =
        valueType === "multi_select"
          ? Array.isArray(value)
            ? value
            : []
          : typeof value === "string"
            ? [value]
            : [];
      candidates.forEach((candidate, optionIndex) => {
        try {
          parseDataSourceOptionId({ propertyId, value: candidate });
        } catch (error) {
          addIdentityIssue(
            context,
            ["data", "rows", rowIndex, "values", rawPropertyId, optionIndex],
            error instanceof Error ? error.message : "Invalid Data Source option identity",
          );
        }
      });
    });
  });
};

export const FetchV5InputSchema = FetchV3InputSchema.superRefine((input, context) => {
  checkPropertyIds(input.propertyIds, context, ["propertyIds"]);
});

export const checkFetchV5Output = (
  output: {
    readonly data: {
      readonly resource: {
        readonly properties?: Readonly<Record<string, unknown>>;
      };
    };
  },
  context: z.RefinementCtx,
): void => {
  const properties = output.data.resource.properties;
  if (!properties) return;
  Object.keys(properties).forEach((propertyId) => {
    checkPropertyId(propertyId, context, ["data", "resource", "properties", propertyId]);
  });
};

export const FetchV5OutputSchema = FetchV3OutputSchema.superRefine(checkFetchV5Output);

export const checkSearchV5Output = (
  output: {
    readonly data: {
      readonly results: readonly (
        | { readonly kind: "block" }
        | {
            readonly kind: "page";
            readonly matches: readonly {
              readonly source: string;
              readonly propertyId?: unknown;
            }[];
          }
      )[];
    };
  },
  context: z.RefinementCtx,
): void => {
  output.data.results.forEach((result, resultIndex) => {
    if (result.kind !== "page") return;
    result.matches.forEach((match, matchIndex) => {
      if (match.source !== "property") return;
      checkPropertyId(match.propertyId, context, [
        "data",
        "results",
        resultIndex,
        "matches",
        matchIndex,
        "propertyId",
      ]);
    });
  });
};

export const SearchV5OutputSchema = SearchV3OutputSchema.superRefine(checkSearchV5Output);

export const QueryDatabaseViewV5InputSchema = QueryDatabaseViewV3InputSchema.superRefine(
  (input, context) => {
    checkPropertyIds(input.select?.propertyIds, context, ["select", "propertyIds"]);
  },
);

export const QueryDataSourceV5InputSchema = QueryDataSourceV3InputSchema.superRefine(
  (input, context) => {
    checkFilter(input.filter as FilterNode | undefined, context, ["filter"]);
    checkSort(input.sort, context, ["sort"]);
    checkPropertyIds(input.select?.propertyIds, context, ["select", "propertyIds"]);
  },
);

export const QueryDatabaseV5OutputSchema =
  QueryDatabaseV3OutputSchema.superRefine(checkQueryV5Output);

export const CreatePagesV5InputSchema = CreatePagesV3InputSchema.superRefine((input, context) => {
  input.pages.forEach((page, pageIndex) => {
    checkPropertyValueDrafts(page.values, context, ["pages", pageIndex, "values"]);
  });
});

export const MovePagesV5InputSchema = MovePagesV3InputSchema.superRefine((input, context) => {
  if (input.destination.kind !== "data_source") return;
  checkPropertyValueDrafts(input.destination.values, context, ["destination", "values"]);
});

export const DuplicatePageV5InputSchema = DuplicatePageV3InputSchema.superRefine(
  (input, context) => {
    if (input.destination.kind !== "data_source") return;
    checkPropertyValueDrafts(input.destination.values, context, ["destination", "values"]);
  },
);
