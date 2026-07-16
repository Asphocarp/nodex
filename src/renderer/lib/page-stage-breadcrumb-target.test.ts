import { describe, expect, test } from "vitest";
import {
  PAGE_DOCUMENT_SCHEMA_VERSION,
  plainTextToPortableRichText,
} from "../../shared/block-documents";
import type { PageTargetReadModel } from "../../shared/page-targets";
import { resolvePageStageBreadcrumbTarget } from "./page-stage-breadcrumb-target";

const available = (
  title: string,
): Extract<PageTargetReadModel, { readonly status: "available" }> => ({
  status: "available",
  targetPageId: "parent-page",
  page: {
    pageId: "parent-page",
    libraryId: "library:canonical",
    lifecycle: "active",
    parent: { kind: "page", pageId: "host-page" },
    parentRevision: 1,
    metadataRevision: 1,
    documentId: "document:parent-page",
    documentGeneration: 1,
    documentHeadSeq: 2,
    title,
    richTitle: plainTextToPortableRichText(title),
    preview: "",
    plainText: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  document: {
    readiness: "ready",
    schemaKey: "nodex.page",
    schemaVersion: PAGE_DOCUMENT_SCHEMA_VERSION,
  },
});

describe("resolvePageStageBreadcrumbTarget", () => {
  test("uses the canonical current title and Page identity", () => {
    expect(resolvePageStageBreadcrumbTarget({
      targetBlockId: "parent-page",
      model: available("Parent renamed"),
      loading: false,
      error: null,
    })).toEqual({
      title: "Parent renamed",
      navigationTarget: {
        pageId: "parent-page",
        title: "Parent renamed",
      },
    });
  });

  test("treats an authoritative empty title as Untitled", () => {
    expect(resolvePageStageBreadcrumbTarget({
      targetBlockId: "parent-page",
      model: available(""),
      loading: false,
      error: null,
    }).title).toBe("Untitled");
  });

  test.each([
    ["loading", null, true, null, "Loading Page…"],
    ["error", null, false, new Error("offline"), "Page unavailable"],
    ["missing", { status: "missing", targetPageId: "parent-page" }, false, null, "Page unavailable"],
    ["deleted", { status: "deleted", targetPageId: "parent-page", libraryId: "library:alpha" }, false, null, "Deleted Page"],
    ["invalid", { status: "invalid_target", targetPageId: "parent-page", actualBlockType: "database" }, false, null, "Invalid Page"],
  ] as const)("keeps %s targets non-navigable", (_state, model, loading, error, title) => {
    expect(resolvePageStageBreadcrumbTarget({
      targetBlockId: "parent-page",
      model,
      loading,
      error,
    })).toEqual({ title, navigationTarget: null });
  });
});
