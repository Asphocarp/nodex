import { describe, expect, test } from "vitest";
import type { NfmCardToggle } from "../../shared/nfm/types";
import { foreignReferenceMigrationTestHelpers } from "./foreign-reference-migration";

const makeToggle = (sourceStatus: string): NfmCardToggle => ({
  type: "cardToggle",
  pageId: "legacy-page",
  meta: "",
  sourceStatus,
  sourceStatusName: "Historical label",
  content: [{ type: "text", text: "Recovered page", styles: {} }],
  children: [],
});

describe("foreign reference status recovery", () => {
  test("maps historical reference metadata without exposing an active alias", () => {
    expect(
      foreignReferenceMigrationTestHelpers.recoveryContent(
        makeToggle("in_review"),
      ).status,
    ).toBe("review");
    expect(
      foreignReferenceMigrationTestHelpers.recoveryContent(
        makeToggle("review"),
      ).status,
    ).toBe("review");
    expect(
      foreignReferenceMigrationTestHelpers.recoveryContent(
        makeToggle("unknown"),
      ).status,
    ).toBeUndefined();
  });
});
