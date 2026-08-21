import { describe, expect, test } from "vitest";
import { getStartupStatus } from "./app-startup";

describe("app startup helpers", () => {
  test("returns bootstrap copy while initialization is running", () => {
    expect(getStartupStatus({ phase: "opening" })).toBe("Opening Nodex…");
  });

  test("returns migration copy while sqlite work is running", () => {
    expect(getStartupStatus({ phase: "migrating", fromVersion: 86, toVersion: 88 })).toBe(
      "Updating local data…",
    );
  });

  test("renders real Core migration progress", () => {
    expect(
      getStartupStatus({
        phase: "migrating",
        fromVersion: 104,
        toVersion: 107,
        completed: 67,
        total: 100,
      }),
    ).toBe("Updating local data… 67%");
  });

  test("stops claiming migration after the Core store is ready", () => {
    expect(getStartupStatus({ phase: "opening_workspace" })).toBe("Opening workspace…");
  });

  test("keeps generic copy until the renderer is actually ready", () => {
    expect(getStartupStatus({ phase: "done" })).toBe("Opening Nodex…");
  });

  test("returns explicit failure copy", () => {
    expect(getStartupStatus({ phase: "failed" })).toBe("Nodex could not finish opening.");
  });
});
