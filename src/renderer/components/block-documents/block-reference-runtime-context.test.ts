import { describe, expect, test } from "vite-plus/test";
import {
  appendInlineCardAncestor,
  appendInlineDocumentOwnerAncestor,
  isInlineCardCycle,
  isInlineDocumentOwnerCycle,
} from "./block-reference-runtime-context";

describe("inline Card reference ancestry", () => {
  test("tracks the open Document path and detects indirect cycles", () => {
    const root = appendInlineCardAncestor([], "card-a");
    const nested = appendInlineCardAncestor(root, "card-b");

    expect(root.join(",")).toBe("card-a");
    expect(nested.join(",")).toBe("card-a,card-b");
    expect(isInlineCardCycle(nested, "card-a")).toBe(true);
    expect(isInlineCardCycle(nested, "card-b")).toBe(true);
    expect(isInlineCardCycle(nested, "card-c")).toBe(false);
    expect(appendInlineCardAncestor(nested, "card-a") === nested).toBe(true);
  });
});

describe("inline owned Document ancestry", () => {
  test("tracks mixed Card and body-only owners without duplicating a path", () => {
    const cardPath = appendInlineDocumentOwnerAncestor([], "card-a");
    const syncedPath = appendInlineDocumentOwnerAncestor(cardPath, "synced-source-a");

    expect(syncedPath.join(",")).toBe("card-a,synced-source-a");
    expect(isInlineDocumentOwnerCycle(syncedPath, "card-a")).toBe(true);
    expect(isInlineDocumentOwnerCycle(syncedPath, "synced-source-a")).toBe(true);
    expect(isInlineDocumentOwnerCycle(syncedPath, "template-b")).toBe(false);
    expect(appendInlineDocumentOwnerAncestor(syncedPath, "synced-source-a") === syncedPath).toBe(
      true,
    );
  });
});
