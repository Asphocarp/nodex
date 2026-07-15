import { describe, expect, test } from "vitest";
import {
  CARD_DOCUMENT_SCHEMA_VERSION,
  plainTextToPortableRichText,
} from "../../shared/block-documents";
import type { CardTargetReadModel } from "../../shared/card-targets";
import { resolveCardStageBreadcrumbTarget } from "./card-stage-breadcrumb-target";

const available = (
  title: string,
): Extract<CardTargetReadModel, { readonly status: "available" }> => ({
  status: "available",
  targetBlockId: "parent-card",
  card: {
    blockId: "parent-card",
    projectId: "canonical-project",
    lifecycle: "active",
    location: { kind: "document", documentId: "host-document" },
    locationRevision: 1,
    metadataRevision: 1,
    documentId: "document:parent-card",
    documentGeneration: 1,
    documentHeadSeq: 2,
    documentAuthority: "ydoc_primary",
    content: {
      projectedSeq: 2,
      title,
      richTitle: plainTextToPortableRichText(title),
      preview: "",
      plainText: "",
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  document: {
    readiness: "ready",
    schemaKey: "nodex.card",
    schemaVersion: CARD_DOCUMENT_SCHEMA_VERSION,
  },
});

describe("resolveCardStageBreadcrumbTarget", () => {
  test("uses the canonical current title and owning Project", () => {
    expect(resolveCardStageBreadcrumbTarget({
      targetBlockId: "parent-card",
      model: available("Parent renamed"),
      loading: false,
      error: null,
    })).toEqual({
      title: "Parent renamed",
      navigationTarget: {
        projectId: "canonical-project",
        cardId: "parent-card",
        title: "Parent renamed",
      },
    });
  });

  test("treats an authoritative empty title as Untitled", () => {
    expect(resolveCardStageBreadcrumbTarget({
      targetBlockId: "parent-card",
      model: available(""),
      loading: false,
      error: null,
    }).title).toBe("Untitled");
  });

  test.each([
    ["loading", null, true, null, "Loading Card…"],
    ["error", null, false, new Error("offline"), "Card unavailable"],
    ["missing", { status: "missing", targetBlockId: "parent-card" }, false, null, "Card unavailable"],
    ["deleted", { status: "deleted", targetBlockId: "parent-card", projectId: "alpha" }, false, null, "Deleted Card"],
    ["invalid", { status: "invalid_target", targetBlockId: "parent-card", actualBlockType: "database" }, false, null, "Invalid Card"],
  ] as const)("keeps %s targets non-navigable", (_state, model, loading, error, title) => {
    expect(resolveCardStageBreadcrumbTarget({
      targetBlockId: "parent-card",
      model,
      loading,
      error,
    })).toEqual({ title, navigationTarget: null });
  });
});
