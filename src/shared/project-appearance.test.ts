import { describe, expect, test } from "vitest";
import {
  DEFAULT_PROJECT_APPEARANCE,
  isProjectAppearanceEqual,
  PROJECT_MARKER_COLORS,
  PROJECT_MARKER_ICONS,
  selectProjectMarkerColor,
  selectProjectMarkerIcon,
  type ProjectAppearance,
} from "./project-appearance";

describe("project appearance", () => {
  test("keeps the canonical picker order and default stable", () => {
    expect(PROJECT_MARKER_COLORS).toEqual([
      "black",
      "red",
      "orange",
      "yellow",
      "green",
      "blue",
      "purple",
      "pink",
    ]);
    expect(PROJECT_MARKER_ICONS).toHaveLength(30);
    expect(DEFAULT_PROJECT_APPEARANCE).toEqual({
      color: "black",
      marker: { kind: "icon", icon: "folder" },
    });
  });

  test("compares both icon and emoji markers by value", () => {
    expect(
      isProjectAppearanceEqual(
        { color: "blue", marker: { kind: "icon", icon: "terminal" } },
        { color: "blue", marker: { kind: "icon", icon: "terminal" } },
      ),
    ).toBe(true);
    expect(
      isProjectAppearanceEqual(
        { color: "blue", marker: { kind: "emoji", emoji: "🧪" } },
        { color: "blue", marker: { kind: "emoji", emoji: "🪴" } },
      ),
    ).toBe(false);
  });

  test("color selection preserves the marker and icon selection replaces emoji", () => {
    const emojiAppearance: ProjectAppearance = {
      color: "green",
      marker: { kind: "emoji", emoji: "🪴" },
    };

    const recolored = selectProjectMarkerColor(emojiAppearance, "orange");
    expect(recolored).toEqual({
      color: "orange",
      marker: { kind: "emoji", emoji: "🪴" },
    });

    expect(selectProjectMarkerIcon(recolored, "flask")).toEqual({
      color: "orange",
      marker: { kind: "icon", icon: "flask" },
    });
  });
});
