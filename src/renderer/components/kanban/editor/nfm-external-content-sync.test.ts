import { describe, expect, test } from "bun:test";
import { shouldReplaceNfmExternalContent } from "./nfm-external-content-sync";

describe("nfm external content sync", () => {
  test("skips replacement when incoming content is already the editor document", () => {
    const shouldReplace = shouldReplaceNfmExternalContent({
      incomingContent: "Current body",
      previousContent: "Persisted body",
      lastEmittedContent: "Draft body",
      currentSerializedContent: "Current body",
    });

    expect(shouldReplace).toBeFalse();
  });

  test("skips replacement for the editor's own emitted value", () => {
    const shouldReplace = shouldReplaceNfmExternalContent({
      incomingContent: "Draft body",
      previousContent: "Persisted body",
      lastEmittedContent: "Draft body",
      currentSerializedContent: "Different body",
    });

    expect(shouldReplace).toBeFalse();
  });

  test("allows replacement for a truly different external document", () => {
    const shouldReplace = shouldReplaceNfmExternalContent({
      incomingContent: "Remote body",
      previousContent: "Persisted body",
      lastEmittedContent: "Draft body",
      currentSerializedContent: "Current body",
    });

    expect(shouldReplace).toBeTrue();
  });
});
