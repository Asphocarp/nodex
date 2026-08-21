import { describe, expect, test } from "vite-plus/test";
import { parseDataSourceId, parseDataSourcePropertyId } from "../../shared/database-identities";
import type { DataSourcePropertyRecordV2 } from "../../shared/database-module-v2";
import { testPropertySemantics } from "../../shared/testing/database-property-record";
import {
  gatePageCreateInputByCapabilities,
  resolvePageCreatePropertyCapabilities,
} from "./page-create-capabilities";

const property = (
  propertyId: string,
  valueType: DataSourcePropertyRecordV2["valueType"],
): DataSourcePropertyRecordV2 => ({
  propertyId: parseDataSourcePropertyId(propertyId),
  dataSourceId: parseDataSourceId("source-test"),
  name: propertyId,
  ...testPropertySemantics(
    valueType,
    valueType === "select" || valueType === "multi_select" ? 1 : 0,
  ),
  valueType,
  config: {},
  rankKey: propertyId,
  lifecycle: "active",
  revision: 1,
  createdAt: "2026-08-09T00:00:00.000Z",
  updatedAt: "2026-08-09T00:00:00.000Z",
});

describe("Page create property capabilities", () => {
  test("exposes only canonical built-ins with their required value types", () => {
    const priority = property("priority", "select");
    const invalidEstimate = property("estimate", "number");
    const tags = property("tags", "multi_select");
    const customSelect = property("p_AAAAAAAA", "select");

    expect(
      resolvePageCreatePropertyCapabilities([priority, invalidEstimate, tags, customSelect]),
    ).toEqual({
      priorityProperty: priority,
      estimateProperty: null,
      tagsProperty: tags,
    });
  });

  test("uses the same capabilities to remove stale values from the create payload", () => {
    const tags = property("tags", "multi_select");
    const capabilities = resolvePageCreatePropertyCapabilities([tags]);

    expect(
      gatePageCreateInputByCapabilities(
        {
          title: "Schema-safe Page",
          priority: "p1-high",
          estimate: "m",
          tagOptions: [{ optionId: "o_AAAAAAAA", name: "Product" }],
        },
        capabilities,
      ),
    ).toEqual({
      title: "Schema-safe Page",
      priority: undefined,
      estimate: undefined,
      tagOptions: [{ optionId: "o_AAAAAAAA", name: "Product" }],
    });
  });
});
