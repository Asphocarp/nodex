import { describe, expect, test } from "vite-plus/test";
import { resolveDataSourcePropertyPresentationRole } from "./data-source-property-presentation-role";

describe("Data Source Property presentation role", () => {
  test("preserves semantic roles across display-name changes by using identity", () => {
    expect(
      resolveDataSourcePropertyPresentationRole({
        propertyId: "status",
        valueType: "select",
      }),
    ).toEqual({ kind: "status" });
  });

  test("keeps a custom select named Status on the typed fallback", () => {
    expect(
      resolveDataSourcePropertyPresentationRole({
        propertyId: "p_0123abcd",
        valueType: "select",
      }),
    ).toEqual({ kind: "typed", valueType: "select" });
  });

  test("keeps a type-corrupt reserved identity on the honest typed fallback", () => {
    expect(
      resolveDataSourcePropertyPresentationRole({
        propertyId: "due_date",
        valueType: "datetime",
      }),
    ).toEqual({ kind: "typed", valueType: "datetime" });
  });

  test("groups both schedule endpoints under one presentation role", () => {
    expect(
      resolveDataSourcePropertyPresentationRole({
        propertyId: "scheduled_end",
        valueType: "datetime",
      }),
    ).toEqual({ kind: "schedule_boundary" });
  });
});
