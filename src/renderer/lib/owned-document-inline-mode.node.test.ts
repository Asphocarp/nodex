import { describe, expect, test } from "vite-plus/test";

import {
  CANVAS_BLOCK_TYPE,
  CANVAS_DOCUMENT_SCHEMA_KEY,
  CANVAS_DOCUMENT_SCHEMA_VERSION,
  REUSABLE_TEMPLATE_DOCUMENT_SCHEMA_KEY,
  REUSABLE_TEMPLATE_DOCUMENT_SCHEMA_VERSION,
  REUSABLE_TEMPLATE_SOURCE_TYPE,
} from "../../shared/block-documents";
import { resolveOwnedDocumentInlineMode } from "./owned-document-inline-mode";

describe("resolveOwnedDocumentInlineMode", () => {
  test("routes BlockNote bodies inline and Canvas scenes to their own view", () => {
    expect(
      resolveOwnedDocumentInlineMode({
        ownerType: REUSABLE_TEMPLATE_SOURCE_TYPE,
        schemaKey: REUSABLE_TEMPLATE_DOCUMENT_SCHEMA_KEY,
        schemaVersion: REUSABLE_TEMPLATE_DOCUMENT_SCHEMA_VERSION,
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
