import { describe, expect, test } from "bun:test";
import { replaceVisibleOrder } from "./sidebar-project-group-dnd";

describe("replaceVisibleOrder", () => {
  test("replaces only visible project ids inside the full order", () => {
    const result = replaceVisibleOrder(
      ["pinned-a", "alpha", "pinned-b", "beta", "gamma"],
      ["alpha", "beta"],
      ["beta", "alpha"],
    );

    expect(JSON.stringify(result)).toBe(JSON.stringify([
      "pinned-a",
      "beta",
      "pinned-b",
      "alpha",
      "gamma",
    ]));
  });

  test("keeps the current order when the visible id set changes", () => {
    const current = ["alpha", "beta", "gamma"];
    const result = replaceVisibleOrder(current, ["alpha", "beta"], ["beta", "delta"]);

    expect(JSON.stringify(result)).toBe(JSON.stringify(current));
  });
});
