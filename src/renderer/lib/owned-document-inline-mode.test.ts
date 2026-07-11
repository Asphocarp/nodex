import { describe, expect, test } from "vitest";

import {
  CANVAS_BLOCK_TYPE,
  CANVAS_DOCUMENT_SCHEMA_KEY,
  CANVAS_DOCUMENT_SCHEMA_VERSION,
  LARGE_DOCUMENT_BLOCK_TYPE,
  LARGE_DOCUMENT_SCHEMA_KEY,
  LARGE_DOCUMENT_SCHEMA_VERSION,
} from "../../shared/block-documents";
import { resolveOwnedDocumentInlineMode } from "./owned-document-inline-mode";

describe("resolveOwnedDocumentInlineMode", () => {
  test("routes BlockNote bodies inline and Canvas scenes to their own view", () => {
    expect(
      resolveOwnedDocumentInlineMode({
        ownerType: LARGE_DOCUMENT_BLOCK_TYPE,
        schemaKey: LARGE_DOCUMENT_SCHEMA_KEY,
        schemaVersion: LARGE_DOCUMENT_SCHEMA_VERSION,
      }),
    ).toBe("block_tree");
    expect(
      resolveOwnedDocumentInlineMode({
        ownerType: CANVAS_BLOCK_TYPE,
        schemaKey: CANVAS_DOCUMENT_SCHEMA_KEY,
        schemaVersion: CANVAS_DOCUMENT_SCHEMA_VERSION,
      }),
    ).toBe("scene_view");
  });
});
