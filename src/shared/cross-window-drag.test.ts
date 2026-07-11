import { describe, expect, test } from "vitest";
import {
  encodeCrossWindowDragToken,
  formatDragDropLabel,
  parseCrossWindowDragToken,
  resolveDragTransferOperation,
} from "./cross-window-drag";

describe("cross-window drag contract", () => {
  test("round-trips opaque versioned tokens and rejects malformed values", () => {
    const sessionId = "00000000-0000-4000-8000-000000000001";
    const parsed = parseCrossWindowDragToken(encodeCrossWindowDragToken(sessionId));

    expect(parsed?.sessionId).toBe(sessionId);
    expect(parseCrossWindowDragToken('{"version":2,"sessionId":"x"}')).toBe(null);
    expect(parseCrossWindowDragToken('{"version":1,"sessionId":"x"}')).toBe(null);
    expect(parseCrossWindowDragToken("not-json")).toBe(null);
  });

  test("resolves the operation from the latest modifier state", () => {
    expect(resolveDragTransferOperation(false)).toBe("move");
    expect(resolveDragTransferOperation(true)).toBe("copy");
    expect(formatDragDropLabel("copy", "Set priority P1")).toBe(
      "Copy · Set priority P1",
    );
    expect(formatDragDropLabel("move")).toBe(undefined);
  });
});
