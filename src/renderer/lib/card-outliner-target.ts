import type { CardTargetReadModel } from "../../shared/card-targets";
import type { CardContentSummary } from "../../shared/database-query";

export type CardOutlinerRelationship = "child" | "reference";

export interface CardOutlinerTargetInput {
  readonly relationship: CardOutlinerRelationship;
  readonly targetBlockId: string;
  readonly model: CardTargetReadModel | null;
  readonly loading: boolean;
  readonly error: Error | null;
  readonly hostCardId: string | null;
  readonly ancestorCardIds: readonly string[];
}

interface CardOutlinerUnavailableTarget {
  readonly relationship: CardOutlinerRelationship;
  readonly targetBlockId: string;
  readonly fallbackTitle: string;
}

export type CardOutlinerTarget =
  | (CardOutlinerUnavailableTarget & { readonly status: "loading" })
  | (CardOutlinerUnavailableTarget & {
      readonly status: "error";
      readonly message: string;
    })
  | (CardOutlinerUnavailableTarget & { readonly status: "missing" })
  | (CardOutlinerUnavailableTarget & { readonly status: "invalid_reference" })
  | (CardOutlinerUnavailableTarget & { readonly status: "deleted" })
  | (CardOutlinerUnavailableTarget & {
      readonly status: "invalid_target";
      readonly actualBlockType: string;
    })
  | {
      readonly status: "available";
      readonly relationship: CardOutlinerRelationship;
      readonly targetBlockId: string;
      readonly projectId: string;
      readonly card: CardContentSummary;
      readonly fallbackTitle: string;
      readonly lifecycle: "active" | "archived";
      readonly inlineMode: "editable" | "self" | "cycle" | "archived";
    };

export const resolveCardOutlinerTarget = ({
  relationship,
  targetBlockId: rawTargetBlockId,
  model,
  loading,
  error,
  hostCardId,
  ancestorCardIds,
}: CardOutlinerTargetInput): CardOutlinerTarget => {
  const targetBlockId = rawTargetBlockId.trim();
  const unavailable = {
    relationship,
    targetBlockId,
  } as const;

  if (targetBlockId.length === 0) {
    return {
      ...unavailable,
      status: "invalid_reference",
      fallbackTitle: "Invalid Card reference",
    };
  }

  if (loading) {
    return {
      ...unavailable,
      status: "loading",
      fallbackTitle: "Loading Card…",
    };
  }
  if (error) {
    return {
      ...unavailable,
      status: "error",
      fallbackTitle: "Card unavailable",
      message: error.message || "Couldn’t load this Card",
    };
  }
  if (!model || model.status === "missing") {
    return {
      ...unavailable,
      status: "missing",
      fallbackTitle: "Card unavailable",
    };
  }
  if (model.status === "deleted") {
    return {
      ...unavailable,
      status: "deleted",
      fallbackTitle: "Deleted Card",
    };
  }
  if (model.status === "invalid_target") {
    return {
      ...unavailable,
      status: "invalid_target",
      fallbackTitle: "Invalid Card reference",
      actualBlockType: model.actualBlockType,
    };
  }

  const referencesSelf = hostCardId === model.card.blockId;
  const closesAncestorCycle = ancestorCardIds.includes(model.card.blockId);
  const inlineMode =
    model.card.lifecycle === "archived"
      ? "archived"
      : referencesSelf
        ? "self"
        : closesAncestorCycle
          ? "cycle"
          : "editable";

  return {
    status: "available",
    relationship,
    targetBlockId: model.card.blockId,
    projectId: model.card.projectId,
    card: model.card,
    fallbackTitle: "Untitled",
    lifecycle: model.card.lifecycle,
    inlineMode,
  };
};

export type AvailableCardOutlinerTarget = Extract<
  CardOutlinerTarget,
  { readonly status: "available" }
>;

export const cardOutlinerPlainTitle = (target: CardOutlinerTarget): string => {
  if (target.status !== "available") return target.fallbackTitle;
  return target.card.content?.title.trim() || target.fallbackTitle;
};

export const cardOutlinerInlineStateLabel = (
  target: CardOutlinerTarget,
): string | null => {
  if (target.status === "loading") return "Loading";
  if (target.status === "error") return "Unavailable";
  if (target.status === "missing") return "Missing";
  if (target.status === "invalid_reference") return "Invalid reference";
  if (target.status === "deleted") return "Deleted";
  if (target.status === "invalid_target") return "Invalid target";
  if (target.inlineMode === "archived") return "Archived";
  if (target.inlineMode === "self") return "Self";
  if (target.inlineMode === "cycle") return "Cycle";
  return null;
};
