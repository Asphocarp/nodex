import { describe, expect, test } from "bun:test";
import {
  DEFAULT_TEXT_ACTION_RECENT_COLOR,
  normalizeTextActionRecentColor,
  normalizeTextActionRecentColors,
  readTextActionRecentColors,
  recordTextActionRecentColors,
  TEXT_ACTION_RECENT_COLOR_STORAGE_KEY,
  writeTextActionRecentColors,
} from "./text-action-color-recents";

function createStorage(seed?: string) {
  const values = new Map<string, string>();
  if (seed !== undefined) {
    values.set(TEXT_ACTION_RECENT_COLOR_STORAGE_KEY, seed);
  }

  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe("text action color recents", () => {
  test("falls back to the Notion-style yellow background recent for invalid storage", () => {
    const recents = readTextActionRecentColors(createStorage("{not-json"));

    expect(recents.length).toBe(1);
    expect(recents[0]?.kind).toBe(DEFAULT_TEXT_ACTION_RECENT_COLOR.kind);
    expect(recents[0]?.color).toBe(DEFAULT_TEXT_ACTION_RECENT_COLOR.color);
  });

  test("normalizes persisted object, arrays, and Notion-style background tokens", () => {
    const textRecent = normalizeTextActionRecentColor({ kind: "text", color: "blue" });
    const backgroundRecent = normalizeTextActionRecentColor("purple_background");
    const recents = normalizeTextActionRecentColors([
      { kind: "text", color: "blue" },
      "purple_background",
      { kind: "text", color: "blue" },
      { kind: "background", color: "green" },
    ]);

    expect(textRecent.kind).toBe("text");
    expect(textRecent.color).toBe("blue");
    expect(backgroundRecent.kind).toBe("background");
    expect(backgroundRecent.color).toBe("purple");
    expect(recents.length).toBe(3);
    expect(recents.map((recent) => `${recent.kind}:${recent.color}`).join("|")).toBe(
      "text:blue|background:purple|background:green",
    );
  });

  test("persists up to five app-wide recent slots for text and background colors", () => {
    const storage = createStorage();

    writeTextActionRecentColors([
      { kind: "text", color: "green" },
      { kind: "background", color: "red" },
      { kind: "text", color: "blue" },
      { kind: "background", color: "yellow" },
      { kind: "text", color: "pink" },
      { kind: "background", color: "purple" },
    ], storage);

    expect(
      readTextActionRecentColors(storage)
        .map((recent) => `${recent.kind}:${recent.color}`)
        .join("|"),
    ).toBe("text:green|background:red|text:blue|background:yellow|text:pink");
  });

  test("records new selections first, dedupes existing colors, and drops the sixth slot", () => {
    const storage = createStorage();

    recordTextActionRecentColors("background", "yellow", storage);
    recordTextActionRecentColors("text", "blue", storage);
    recordTextActionRecentColors("background", "green", storage);
    recordTextActionRecentColors("text", "red", storage);
    recordTextActionRecentColors("background", "purple", storage);
    recordTextActionRecentColors("text", "blue", storage);

    expect(
      readTextActionRecentColors(storage)
        .map((recent) => `${recent.kind}:${recent.color}`)
        .join("|"),
    ).toBe("text:blue|background:purple|text:red|background:green|background:yellow");
  });

  test("does not overwrite the recent slots for default color actions", () => {
    const storage = createStorage();

    recordTextActionRecentColors("background", "yellow", storage);
    const beforeDefaultAction = storage.getItem(TEXT_ACTION_RECENT_COLOR_STORAGE_KEY);
    const result = recordTextActionRecentColors("text", "default", storage);

    expect(result === null).toBeTrue();
    expect(storage.getItem(TEXT_ACTION_RECENT_COLOR_STORAGE_KEY)).toBe(beforeDefaultAction);
  });
});
