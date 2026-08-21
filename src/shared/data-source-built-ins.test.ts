import { describe, expect, test } from "vite-plus/test";
import {
  BUILT_IN_DATA_SOURCE_PROPERTY_DEFINITIONS,
  matchBuiltInDataSourceProperty,
} from "./data-source-built-ins";

describe("Data Source built-in Property definitions", () => {
  test("matches every reserved Property only with its canonical value type", () => {
    for (const [propertyId, definition] of Object.entries(
      BUILT_IN_DATA_SOURCE_PROPERTY_DEFINITIONS,
    )) {
      expect(
        matchBuiltInDataSourceProperty({
          propertyId,
          valueType: definition.valueType,
        }),
      ).toBe(propertyId);
    }
  });

  test("does not grant built-in semantics to custom or type-corrupt properties", () => {
    expect(
      matchBuiltInDataSourceProperty({
        propertyId: "p_0123abcd",
        valueType: "select",
      }),
    ).toBeNull();
    expect(
      matchBuiltInDataSourceProperty({
        propertyId: "status",
        valueType: "multi_select",
      }),
    ).toBeNull();
  });
});
