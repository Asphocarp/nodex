import {
  canonicalizeTagName,
  isCustomDataSourcePropertyId,
  parseDataSourceOptionId,
  type DataSourceId,
} from "../../shared/database-identities";
import {
  stableStringifyDatabaseJson,
  type DatabaseJsonValue,
  type DatabasePropertyOption,
} from "../../shared/database-kernel";
import type {
  DatabaseApplyOperationV2,
  DatabasePropertyValueMutationV2,
  DatabasePropertyValueInputV2,
  DataSourcePageValueV2,
  DataSourcePropertyRecordV2,
} from "../../shared/database-module-v2";

const localError = (propertyId: string): TypeError =>
  new TypeError(`Value is incompatible with Property ${propertyId}`);

const relationCardinality = (
  property: DataSourcePropertyRecordV2,
): "one" | "many" | null =>
  property.schema.kind === "relation" ? property.schema.cardinality : null;

const relationClearEdit = (
  property: DataSourcePropertyRecordV2,
  expectedValueRevision: number,
): DatabasePropertyValueMutationV2["edit"] => {
  const cardinality = relationCardinality(property);
  if (cardinality === "one") {
    return { kind: "replace_one_relation", expectedValueRevision };
  }
  if (cardinality === "many") {
    return { kind: "clear_many_relation", expectedValueRevision };
  }
  throw localError(property.propertyId);
};

const stringSet = (value: DatabaseJsonValue | undefined): ReadonlySet<string> =>
  new Set(
    Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string")
      : [],
  );

export const databasePropertyReplacementValue = (
  property: DataSourcePropertyRecordV2,
  value: DatabaseJsonValue,
): DatabasePropertyValueInputV2 => {
  if (value === null) return { kind: "empty" };
  switch (property.valueType) {
    case "text":
    case "date":
    case "datetime":
      if (typeof value === "string") return { kind: property.valueType, value };
      break;
    case "number":
      if (typeof value === "number" && Number.isFinite(value)) {
        return { kind: "number", value };
      }
      break;
    case "checkbox":
      if (typeof value === "boolean") return { kind: "checkbox", value };
      break;
    case "select":
      if (typeof value === "string") {
        return {
          kind: "select",
          optionId: parseDataSourceOptionId({
            propertyId: property.propertyId,
            value,
          }),
        };
      }
      break;
    case "multi_select":
    case "relation":
      break;
  }
  throw localError(property.propertyId);
};

export const buildDataSourcePropertyValueOperations = (input: {
  readonly pageId: string;
  readonly dataSourceId: DataSourceId;
  readonly property: DataSourcePropertyRecordV2;
  readonly current: DataSourcePageValueV2 | undefined;
  readonly value: DatabaseJsonValue;
}): readonly DatabaseApplyOperationV2[] => {
  const currentValue = input.current?.value ?? null;
  if (
    stableStringifyDatabaseJson(currentValue)
    === stableStringifyDatabaseJson(input.value)
  ) {
    return [];
  }

  if (input.property.valueType === "relation") {
    if (!Array.isArray(input.value) || input.value.length !== 0) {
      throw localError(input.property.propertyId);
    }
    return [{
      kind: "edit_property_values",
      edits: [{
        pageId: input.pageId,
        dataSourceId: input.dataSourceId,
        propertyId: input.property.propertyId,
        edit: relationClearEdit(input.property, input.current?.revision ?? 0),
      }],
    }];
  }

  if (input.property.valueType === "multi_select") {
    const before = stringSet(input.current?.value);
    const after = stringSet(input.value);
    const addOptionIds = [...after]
      .filter((entry) => !before.has(entry))
      .sort()
      .map((value) => parseDataSourceOptionId({
        propertyId: input.property.propertyId,
        value,
      }));
    const removeOptionIds = [...before]
      .filter((entry) => !after.has(entry))
      .sort()
      .map((value) => parseDataSourceOptionId({
        propertyId: input.property.propertyId,
        value,
      }));
    if (addOptionIds.length === 0 && removeOptionIds.length === 0) return [];
    return [{
      kind: "edit_property_values",
      edits: [{
        pageId: input.pageId,
        dataSourceId: input.dataSourceId,
        propertyId: input.property.propertyId,
        edit: {
          kind: "patch_set",
          delta: { kind: "multi_select", addOptionIds, removeOptionIds },
        },
      }],
    }];
  }

  return [{
    kind: "edit_property_values",
    edits: [{
      pageId: input.pageId,
      dataSourceId: input.dataSourceId,
      propertyId: input.property.propertyId,
      edit: {
        kind: "replace",
        expectedValueRevision: input.current?.revision ?? 0,
        value: databasePropertyReplacementValue(input.property, input.value),
      },
    }],
  }];
};

export const buildDataSourceRelationReplacementOperations = (input: {
  readonly pageId: string;
  readonly dataSourceId: DataSourceId;
  readonly property: DataSourcePropertyRecordV2;
  readonly expectedValueRevision: number;
  readonly targetPageId: string | null;
}): readonly DatabaseApplyOperationV2[] => {
  if (relationCardinality(input.property) !== "one") {
    throw localError(input.property.propertyId);
  }
  return [{
    kind: "edit_property_values",
    edits: [{
      pageId: input.pageId,
      dataSourceId: input.dataSourceId,
      propertyId: input.property.propertyId,
      edit: {
        kind: "replace_one_relation",
        expectedValueRevision: input.expectedValueRevision,
        ...(input.targetPageId ? { targetPageId: input.targetPageId } : {}),
      },
    }],
  }];
};

export const buildDataSourceRelationPatchOperations = (input: {
  readonly pageId: string;
  readonly dataSourceId: DataSourceId;
  readonly property: DataSourcePropertyRecordV2;
  readonly addPageIds: readonly string[];
  readonly removeEdgeIds: readonly string[];
}): readonly DatabaseApplyOperationV2[] => {
  if (relationCardinality(input.property) !== "many") {
    throw localError(input.property.propertyId);
  }
  const addPageIds = [...new Set(input.addPageIds)].sort();
  const removeEdgeIds = [...new Set(input.removeEdgeIds)].sort();
  if (addPageIds.length === 0 && removeEdgeIds.length === 0) return [];
  return [{
    kind: "edit_property_values",
    edits: [{
      pageId: input.pageId,
      dataSourceId: input.dataSourceId,
      propertyId: input.property.propertyId,
      edit: {
        kind: "patch_set",
        delta: { kind: "relation", addPageIds, removeEdgeIds },
      },
    }],
  }];
};

export const buildDataSourceMultiSelectPatchOperations = (input: {
  readonly pageId: string;
  readonly dataSourceId: DataSourceId;
  readonly property: DataSourcePropertyRecordV2;
  readonly addOptionIds: readonly string[];
  readonly removeOptionIds: readonly string[];
}): readonly DatabaseApplyOperationV2[] => {
  if (input.property.valueType !== "multi_select") {
    throw localError(input.property.propertyId);
  }
  const addOptionIds = [...new Set(input.addOptionIds)]
    .sort()
    .map((value) => parseDataSourceOptionId({
      propertyId: input.property.propertyId,
      value,
    }));
  const addSet = new Set<string>(addOptionIds);
  const removeOptionIds = [...new Set(input.removeOptionIds)]
    .filter((optionId) => !addSet.has(optionId))
    .sort()
    .map((value) => parseDataSourceOptionId({
      propertyId: input.property.propertyId,
      value,
    }));
  if (addOptionIds.length === 0 && removeOptionIds.length === 0) return [];
  return [{
    kind: "edit_property_values",
    edits: [{
      pageId: input.pageId,
      dataSourceId: input.dataSourceId,
      propertyId: input.property.propertyId,
      edit: {
        kind: "patch_set",
        delta: { kind: "multi_select", addOptionIds, removeOptionIds },
      },
    }],
  }];
};

export const buildDataSourceCreateOptionAndSelectOperations = (input: {
  readonly pageId: string;
  readonly dataSourceId: DataSourceId;
  readonly property: DataSourcePropertyRecordV2;
  readonly current: DataSourcePageValueV2 | undefined;
  readonly option: DatabasePropertyOption;
}): readonly DatabaseApplyOperationV2[] => {
  if (
    input.property.valueType !== "select"
    && input.property.valueType !== "multi_select"
  ) {
    throw localError(input.property.propertyId);
  }
  if (
    !isCustomDataSourcePropertyId(input.property.propertyId)
    && !(
      input.property.propertyId === "tags"
      && input.property.valueType === "multi_select"
    )
  ) {
    throw localError(input.property.propertyId);
  }
  if (!input.option.name || input.option.name !== input.option.name.trim()) {
    throw localError(input.property.propertyId);
  }
  const optionName = input.property.propertyId === "tags"
    ? canonicalizeTagName(input.option.name, { maxLength: 256 })
    : input.option.name;
  const optionId = parseDataSourceOptionId({
    propertyId: input.property.propertyId,
    value: input.option.id,
  });
  const putOption: DatabaseApplyOperationV2 = {
    kind: "put_option",
    dataSourceId: input.dataSourceId,
    propertyId: input.property.propertyId,
    optionId,
    name: optionName,
    ...(input.option.color === undefined ? {} : { color: input.option.color }),
    expectedPropertyRevision: input.property.revision,
  };
  const edit: Extract<
    DatabaseApplyOperationV2,
    { readonly kind: "edit_property_values" }
  > = input.property.valueType === "select"
    ? {
        kind: "edit_property_values",
        edits: [{
          pageId: input.pageId,
          dataSourceId: input.dataSourceId,
          propertyId: input.property.propertyId,
          edit: {
            kind: "replace",
            expectedValueRevision: input.current?.revision ?? 0,
            value: { kind: "select", optionId },
          },
        }],
      }
    : {
        kind: "edit_property_values",
        edits: [{
          pageId: input.pageId,
          dataSourceId: input.dataSourceId,
          propertyId: input.property.propertyId,
          edit: {
            kind: "patch_set",
            delta: {
              kind: "multi_select",
              addOptionIds: [optionId],
              removeOptionIds: [],
            },
          },
        }],
      };
  return [putOption, edit];
};
