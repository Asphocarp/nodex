import { describe, expect, test } from "vitest";

import { createUuidV7FromTimestamp } from "../uuid-v7";
import {
  assertExistingCanvasBlockId,
  assertExistingCanvasDocumentId,
  isPrimaryCanvasBlockId,
  isPrimaryCanvasDocumentId,
  primaryCanvasBlockId,
  primaryCanvasDocumentId,
} from "./canvas-document-identity";

const uuidV7 = createUuidV7FromTimestamp(1_785_491_085_000);

describe("Canvas document identity", () => {
  test("accepts user UUID-v7 and deterministic primary identities", () => {
    const primaryBlockId = primaryCanvasBlockId("project:default");
    const primaryDocumentId = primaryCanvasDocumentId("project:default");

    expect(isPrimaryCanvasBlockId(primaryBlockId)).toBe(true);
    expect(isPrimaryCanvasDocumentId(primaryDocumentId)).toBe(true);
    expect(assertExistingCanvasBlockId(uuidV7)).toBe(uuidV7);
    expect(assertExistingCanvasBlockId(primaryBlockId)).toBe(primaryBlockId);
    expect(assertExistingCanvasDocumentId(uuidV7)).toBe(uuidV7);
    expect(assertExistingCanvasDocumentId(primaryDocumentId))
      .toBe(primaryDocumentId);
  });

  test("rejects malformed primary identities and non-v7 UUIDs", () => {
    const malformed = [
      "canvas:primary:",
      "canvas:primary: project-1",
      "canvas:primary:project-1 ",
      "canvas:primary:project-\n1",
      `canvas:primary:${"p".repeat(512)}`,
      "canvas:secondary:project-1",
    ];
    for (const value of malformed) {
      expect(isPrimaryCanvasBlockId(value)).toBe(false);
      expect(() => assertExistingCanvasBlockId(value)).toThrow(
        "primary Canvas Block ID",
      );
    }

    expect(isPrimaryCanvasDocumentId("document:canvas:primary:")).toBe(false);
    expect(() =>
      assertExistingCanvasDocumentId("document:canvas:primary: project-1")
    ).toThrow("primary Canvas Document ID");
    expect(() =>
      assertExistingCanvasBlockId("550e8400-e29b-41d4-a716-446655440000")
    ).toThrow("UUID-v7");
  });
});
