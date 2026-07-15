import { describe, expect, test } from "vitest";
import {
  CARD_DOCUMENT_SCHEMA_VERSION,
  plainTextToPortableRichText,
} from "../../shared/block-documents";
import type { CardTargetReadModel } from "../../shared/card-targets";
import type { CardContentSummary } from "../../shared/database-query";
import {
  cardOutlinerInlineStateLabel,
  cardOutlinerPlainTitle,
  resolveCardOutlinerTarget,
  type CardOutlinerTargetInput,
} from "./card-outliner-target";

const card: CardContentSummary & { readonly lifecycle: "active" } = {
  blockId: "card-target",
  projectId: "target-project",
  lifecycle: "active",
  location: { kind: "document", documentId: "host-document" },
  locationRevision: 1,
  metadataRevision: 2,
  documentId: "document:card-target",
  documentGeneration: 1,
  documentHeadSeq: 2,
  documentAuthority: "ydoc_primary",
  content: {
    projectedSeq: 2,
    title: "Canonical title",
    richTitle: plainTextToPortableRichText("Canonical title"),
    preview: "",
    plainText: "",
  },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const available: Extract<CardTargetReadModel, { readonly status: "available" }> = {
  status: "available",
  targetBlockId: card.blockId,
  card,
  document: {
    readiness: "ready",
    schemaKey: "nodex.card",
    schemaVersion: CARD_DOCUMENT_SCHEMA_VERSION,
  },
};

const input = (
  overrides: Partial<CardOutlinerTargetInput> = {},
): CardOutlinerTargetInput => ({
  relationship: "reference",
  targetBlockId: card.blockId,
  model: available,
  loading: false,
  error: null,
  hostCardId: "host-card",
  ancestorCardIds: ["host-card"],
  ...overrides,
});

describe("resolveCardOutlinerTarget", () => {
  test("uses canonical target identity and summary", () => {
    expect(resolveCardOutlinerTarget(input())).toMatchObject({
      status: "available",
      relationship: "reference",
      targetBlockId: "card-target",
      projectId: "target-project",
      card: { content: { title: "Canonical title" } },
      inlineMode: "editable",
    });
  });

  test("renders an intentionally empty authoritative title as Untitled", () => {
    const target = resolveCardOutlinerTarget(input({
      model: {
        ...available,
        card: {
          ...card,
          content: card.content
            ? { ...card.content, title: "", richTitle: [] }
            : null,
        },
      },
    }));
    expect(cardOutlinerPlainTitle(target)).toBe("Untitled");
  });

  test("distinguishes self and ancestor cycles while preserving one target", () => {
    expect(
      resolveCardOutlinerTarget(input({ hostCardId: card.blockId })),
    ).toMatchObject({ status: "available", inlineMode: "self" });
    expect(
      resolveCardOutlinerTarget(
        input({ ancestorCardIds: ["host-card", card.blockId] }),
      ),
    ).toMatchObject({ status: "available", inlineMode: "cycle" });
  });

  test("makes archived targets non-editable independently of summary flags", () => {
    expect(
      resolveCardOutlinerTarget(
        input({
          model: {
            ...available,
            card: { ...card, lifecycle: "archived" },
          },
        }),
      ),
    ).toMatchObject({ status: "available", inlineMode: "archived" });
  });

  test("uses stable state copy when a target is unavailable", () => {
    const target = resolveCardOutlinerTarget(
      input({ model: null, targetBlockId: " missing-target " }),
    );
    expect(target).toEqual({
      status: "missing",
      relationship: "reference",
      targetBlockId: "missing-target",
      fallbackTitle: "Card unavailable",
    });
    expect(cardOutlinerInlineStateLabel(target)).toBe("Missing");
  });

  test("does not present a stale hint as a valid empty reference", () => {
    expect(
      resolveCardOutlinerTarget(
        input({ targetBlockId: " ", model: null }),
      ),
    ).toEqual({
      status: "invalid_reference",
      relationship: "reference",
      targetBlockId: "",
      fallbackTitle: "Invalid Card reference",
    });
  });

  test("keeps a useful fallback and message when target loading fails", () => {
    expect(
      resolveCardOutlinerTarget(
        input({
          model: null,
          error: new Error("Transport closed"),
        }),
      ),
    ).toEqual({
      status: "error",
      relationship: "reference",
      targetBlockId: "card-target",
      fallbackTitle: "Card unavailable",
      message: "Transport closed",
    });
  });
});
