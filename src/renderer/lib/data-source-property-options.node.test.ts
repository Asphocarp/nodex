import { describe, expect, test } from "vitest";
import {
  DATA_SOURCE_PROPERTY_OPTION_PALETTE,
  canCreateDataSourcePropertyOption,
  defaultDataSourcePropertyOptionColor,
  filterDataSourcePropertyOptions,
  presentSelectedDataSourcePropertyOptions,
  propertyOptionColorClassName,
} from "./data-source-property-options";

const options = [
  { id: "one", name: "Needs Review", color: "orange" },
  { id: "two", name: "Ready", color: "green" },
] as const;

describe("Data Source Property option presentation", () => {
  test("filters normalized option names without changing registry order", () => {
    expect(filterDataSourcePropertyOptions(options, " REVIEW ")).toEqual([options[0]]);
  });

  test("offers creation only for a non-empty unique name", () => {
    expect(canCreateDataSourcePropertyOption(options, "Review")).toBe(true);
    expect(canCreateDataSourcePropertyOption(options, " needs review ")).toBe(false);
    expect(canCreateDataSourcePropertyOption(options, " ")).toBe(false);
  });

  test("keeps missing selected identities visible as local warnings", () => {
    expect(presentSelectedDataSourcePropertyOptions(options, ["two", "gone"])).toEqual([
      { ...options[1], missing: false },
      { id: "gone", name: "Unknown option", missing: true },
    ]);
  });

  test("maps only known colors and falls back to neutral tokens", () => {
    expect(propertyOptionColorClassName("green")).toContain("--green-bg");
    expect(propertyOptionColorClassName("arbitrary-tailwind")).toBe(propertyOptionColorClassName());
  });

  test("chooses a stable allowlisted color for atomic option creation", () => {
    const color = defaultDataSourcePropertyOptionColor("o_AAAAAAAA");
    expect(defaultDataSourcePropertyOptionColor("o_AAAAAAAA")).toBe(color);
    expect(DATA_SOURCE_PROPERTY_OPTION_PALETTE).toContain(color);
  });
});
