import type {
  DatabasePropertyCapabilitiesV2,
  DatabasePropertySchemaV2,
  DataSourcePropertyRecordV2,
} from "../database-module-v2";
import type { DatabasePropertyValueType } from "../database-kernel";
import { parseDataSourceId } from "../database-identities";

export const testPropertySemantics = (
  valueType: DatabasePropertyValueType,
  optionCount = 0,
): Pick<DataSourcePropertyRecordV2, "schema" | "capabilities" | "optionCount"> => {
  const schema: DatabasePropertySchemaV2 = valueType === "relation"
    ? {
        kind: "relation",
        targetDataSourceId: parseDataSourceId("source-1"),
        cardinality: "many",
      }
    : { kind: valueType };
  const capabilities: DatabasePropertyCapabilitiesV2 = {
    replace: true,
    patchSetMember: valueType === "multi_select"
      ? "option"
      : valueType === "relation" ? "page" : null,
    filterOperators: valueType === "relation" || valueType === "multi_select"
      ? ["contains", "not_contains", "is_empty", "is_not_empty"]
      : ["equals", "not_equals", "is_empty", "is_not_empty"],
    sortable: valueType !== "relation",
    groupable: valueType !== "relation",
  };
  return { schema, capabilities, optionCount };
};
