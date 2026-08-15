import { describe, expect, test } from "vitest";

import type { DatabasePropertyValueType } from "../../../shared/database-kernel";
import type { DataSourcePropertyRecordV2 } from "../../../shared/database-module-v2";
import { testPropertySemantics } from "../../../shared/testing/database-property-record";
import { resolveBoardPagePropertyChangeAuthority } from "./use-board-page-property-bindings";

const property = (
  propertyId: string,
  valueType: DatabasePropertyValueType,
): DataSourcePropertyRecordV2 => ({
  propertyId,
  dataSourceId: "source-1",
  name: propertyId,
  valueType,
  ...testPropertySemantics(valueType),
  config: {},
  rankKey: propertyId,
  lifecycle: "active",
  revision: 1,
  createdAt: "2026-08-16T00:00:00.000Z",
  updatedAt: "2026-08-16T00:00:00.000Z",
} as DataSourcePropertyRecordV2);

describe("resolveBoardPagePropertyChangeAuthority", () => {
  test("routes only the exact active select grouping Property through Board move", () => {
    expect(resolveBoardPagePropertyChangeAuthority({
      property: property("status", "select"),
      groupingPropertyId: "status",
      value: "done",
    })).toEqual({ kind: "grouping_move", groupValue: "done" });

    expect(resolveBoardPagePropertyChangeAuthority({
      property: property("priority", "select"),
      groupingPropertyId: "status",
      value: "high",
    })).toEqual({ kind: "property_value" });

    expect(resolveBoardPagePropertyChangeAuthority({
      property: property("p_group", "multi_select"),
      groupingPropertyId: "p_group",
      value: ["one", "two"],
    })).toEqual({ kind: "property_value" });
  });
});
