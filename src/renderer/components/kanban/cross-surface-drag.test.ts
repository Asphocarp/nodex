import { describe, expect, test } from "vitest";
import {
  encodeBlockCardCopyDragPayload,
  encodeCardReferenceDragPayload,
  parseBlockCardCopyDragPayload,
  parseCardReferenceDragPayload,
} from "./cross-surface-drag";

describe("cross-surface Block-first drag payloads", () => {
  test("round-trips Card references without serializing Card bodies", () => {
    const serialized = encodeCardReferenceDragPayload([
      { projectId: "project-a", cardId: "card-a", title: "Card A" },
    ]);
    const payload = parseCardReferenceDragPayload(serialized);

    expect(payload?.cards).toEqual([
      { projectId: "project-a", cardId: "card-a", title: "Card A" },
    ]);
    expect(serialized).not.toContain("description");
  });

  test("round-trips NFM only as new-Card genesis copy data", () => {
    const payload = parseBlockCardCopyDragPayload(
      encodeBlockCardCopyDragPayload({
        sourceProjectId: "project-a",
        cards: [{ title: "Extracted block", description: "Nested body" }],
      }),
    );

    expect(payload?.cards).toEqual([
      { title: "Extracted block", description: "Nested body" },
    ]);
  });

  test("rejects duplicate Card identities and unbounded payloads", () => {
    const duplicate = encodeCardReferenceDragPayload([
      { projectId: "project-a", cardId: "card-a", title: "One" },
      { projectId: "project-a", cardId: "card-a", title: "Two" },
    ]);
    expect(parseCardReferenceDragPayload(duplicate)).toBeNull();
    expect(parseCardReferenceDragPayload("x".repeat(1_900_001))).toBeNull();
  });
});
