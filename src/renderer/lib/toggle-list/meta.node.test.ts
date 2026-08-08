import { describe, expect, test } from "vitest";
import type { ToggleListCard } from "./types";
import { formatMeta } from "./meta";
import { plainTextToPortableRichText } from "../../../shared/block-documents/portable-rich-text";

const baseCard: ToggleListCard = {
  id: "card-1",
  pageKey: null,
  status: "plan",
  archived: false,
  title: "Example",
  richTitle: plainTextToPortableRichText("Example"),
  description: "",
  priority: "p0-critical",
  estimate: "l",
  tags: [],
  created: new Date("2026-02-10T00:00:00.000Z"),
  order: 0,
  columnId: "plan",
  columnName: "Plan",
  boardIndex: 0,
};

const taggedCard: ToggleListCard = {
  ...baseCard,
  tags: ["frontend", "bug"],
};

describe("toggle-list meta formatting", () => {
  test("formats all properties in requested order", () => {
    const meta = formatMeta(baseCard, ["priority", "estimate", "status"], []);
    expect(meta).toBe("[P0] [L] [Plan]");
  });

  test("hides selected properties", () => {
    const meta = formatMeta(baseCard, ["priority", "estimate", "status"], ["estimate"]);
    expect(meta).toBe("[P0] [Plan]");
  });

  test("respects custom property ordering", () => {
    const meta = formatMeta(baseCard, ["status", "priority", "estimate"], []);
    expect(meta).toBe("[Plan] [P0] [L]");
  });

  test("includes tags as individual tokens", () => {
    const meta = formatMeta(taggedCard, ["priority", "estimate", "status", "tags"], []);
    expect(meta).toBe("[P0] [L] [Plan] [frontend] [bug]");
  });

  test("hides tags when in hiddenProperties", () => {
    const meta = formatMeta(taggedCard, ["priority", "estimate", "status", "tags"], ["tags"]);
    expect(meta).toBe("[P0] [L] [Plan]");
  });

  test("respects tag position in propertyOrder", () => {
    const meta = formatMeta(taggedCard, ["tags", "priority", "status"], ["estimate"]);
    expect(meta).toBe("[frontend] [bug] [P0] [Plan]");
  });

  test("empty tags array produces no extra tokens", () => {
    const meta = formatMeta(baseCard, ["priority", "tags", "status"], []);
    expect(meta).toBe("[P0] [Plan]");
  });

  test("hides estimate chip when estimate is empty", () => {
    const card: ToggleListCard = { ...baseCard, estimate: undefined };
    const meta = formatMeta(card, ["priority", "estimate", "status"], []);
    expect(meta).toBe("[P0] [Plan]");
  });
});
