import { lazy, Suspense, type ReactNode } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import {
  CardOutlinerBodySkeleton,
  CardOutlinerDisclosure,
  CardOutlinerFrame,
  CardOutlinerRowSlots,
  useCardOutlinerActivation,
  type CardOutlinerRowChromeProps,
  type CardOutlinerStateDependencies,
} from "@/components/block-documents/card-outliner-surface";
import { PortableRichTitle } from "@/components/block-documents/portable-rich-title";
import { useBlockReferenceHostRuntime } from "@/components/block-documents/block-reference-runtime-context";
import { useCardTargetReadModel } from "@/lib/block-reference-queries";
import {
  cardOutlinerInlineStateLabel,
  cardOutlinerPlainTitle,
  resolveCardOutlinerTarget,
  type CardOutlinerRelationship,
  type CardOutlinerTarget,
} from "@/lib/card-outliner-target";
import {
  cardBlockConfig,
  cardRefBlockConfig,
} from "../../../../shared/block-documents/blocknote-schema-config";

const ExpandedCardOutlinerDocument = lazy(() =>
  import("./expanded-card-outliner-document").then((module) => ({
    default: module.ExpandedCardOutlinerDocument,
  })),
);

const projectedTitle = (target: CardOutlinerTarget): ReactNode => {
  if (target.status !== "available") return cardOutlinerPlainTitle(target);
  return (
    <PortableRichTitle
      value={target.card.content?.richTitle ?? []}
      fallback={cardOutlinerPlainTitle(target)}
    />
  );
};

interface CardOutlinerBlockProps extends CardOutlinerStateDependencies {
  readonly relationship: CardOutlinerRelationship;
  readonly shellBlockId: string;
  readonly targetBlockId: string;
  readonly displayHint: string;
}

export function CardOutlinerBlock({
  relationship,
  shellBlockId,
  targetBlockId,
  displayHint,
  expansionStore,
  activationBudget,
  visibilityOverride,
}: CardOutlinerBlockProps) {
  const host = useBlockReferenceHostRuntime();
  const requestingProjectId = host?.projectId ?? "";
  const reference = useCardTargetReadModel(
    requestingProjectId,
    targetBlockId.trim(),
  );
  const target = resolveCardOutlinerTarget({
    relationship,
    targetBlockId,
    displayHint,
    model: reference.data,
    loading: reference.loading,
    error: reference.error,
    hostCardId: host?.hostCardId ?? null,
    ancestorCardIds: host?.ancestorCardIds ?? [],
  });
  const expandable =
    host !== null &&
    target.status === "available" &&
    target.inlineMode === "editable";
  const activation = useCardOutlinerActivation({
    activationKey: `card-outliner:${host?.hostCardId ?? "unscoped"}:${shellBlockId}:${targetBlockId}`,
    expandable,
    expansionStore,
    activationBudget,
    visibilityOverride,
  });
  const plainTitle = cardOutlinerPlainTitle(target);
  const rowProps: CardOutlinerRowChromeProps = {
    plainTitle,
    stateLabel: cardOutlinerInlineStateLabel(target),
    expanded: activation.expanded,
    expandable,
    onExpandedChange: activation.setExpanded,
    ...(target.status === "available" && host?.openCard
      ? {
          onOpenCard: () =>
            host.openCard?.({
              projectId: target.projectId,
              cardId: target.card.blockId,
              titleSnapshot: plainTitle,
            }),
        }
      : {}),
  };

  return (
    <CardOutlinerFrame
      targetBlockId={target.targetBlockId}
      {...(target.status === "available"
        ? { projectId: target.projectId }
        : {})}
      expanded={activation.expanded}
      active={activation.active}
      sectionRef={activation.sectionRef}
      onTouch={activation.touch}
    >
      <CardOutlinerDisclosure {...rowProps}>
        {target.status === "available" && activation.active && host ? (
          <Suspense
            fallback={
              <CardOutlinerRowSlots
                {...rowProps}
                title={projectedTitle(target)}
              >
                <CardOutlinerBodySkeleton />
              </CardOutlinerRowSlots>
            }
          >
            <ExpandedCardOutlinerDocument
              target={target}
              rowProps={rowProps}
              hostRuntime={host}
            />
          </Suspense>
        ) : (
          <CardOutlinerRowSlots {...rowProps} title={projectedTitle(target)}>
            {activation.expanded && activation.visible && expandable ? (
              <CardOutlinerBodySkeleton />
            ) : null}
          </CardOutlinerRowSlots>
        )}
      </CardOutlinerDisclosure>
    </CardOutlinerFrame>
  );
}

export const createCardBlockSpec = createReactBlockSpec(cardBlockConfig, {
  render: ({ block }) => (
    <CardOutlinerBlock
      relationship="child"
      shellBlockId={block.id}
      targetBlockId={block.id}
      displayHint={block.props.displayHint}
    />
  ),
});

export const createCardRefBlockSpec = createReactBlockSpec(cardRefBlockConfig, {
  render: ({ block }) => (
    <CardOutlinerBlock
      relationship="reference"
      shellBlockId={block.id}
      targetBlockId={block.props.targetBlockId}
      displayHint={block.props.displayHint}
    />
  ),
});
