import type { CardTargetReadModel } from "../../shared/card-targets";

export interface CardStageBreadcrumbNavigationTarget {
  readonly projectId: string;
  readonly cardId: string;
  readonly title: string;
}

export interface CardStageBreadcrumbTarget {
  readonly title: string;
  readonly navigationTarget: CardStageBreadcrumbNavigationTarget | null;
}

export interface CardStageBreadcrumbTargetInput {
  readonly targetBlockId: string;
  readonly model: CardTargetReadModel | null;
  readonly loading: boolean;
  readonly error: Error | null;
}

/**
 * Derive breadcrumb chrome from the membership-independent Card target model.
 * The navigation path owns identity only; titles and owning Projects always
 * come from the current canonical target read.
 */
export function resolveCardStageBreadcrumbTarget({
  targetBlockId,
  model,
  loading,
  error,
}: CardStageBreadcrumbTargetInput): CardStageBreadcrumbTarget {
  if (loading) {
    return { title: "Loading Card…", navigationTarget: null };
  }
  if (error || !model || model.status === "missing") {
    return { title: "Card unavailable", navigationTarget: null };
  }
  if (model.status === "deleted") {
    return { title: "Deleted Card", navigationTarget: null };
  }
  if (model.status === "invalid_target") {
    return { title: "Invalid Card", navigationTarget: null };
  }

  const title = model.card.content?.title.trim() || "Untitled";
  return {
    title,
    navigationTarget: {
      projectId: model.card.projectId,
      cardId: model.card.blockId || targetBlockId,
      title,
    },
  };
}
