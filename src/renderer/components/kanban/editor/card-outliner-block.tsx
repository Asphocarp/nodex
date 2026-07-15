import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
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

import {
  moveFromEmbeddedSurfaceToHostNeighbor,
  registerEmbeddedSurfaceBoundaryHandle,
  selectEmbeddedSurfaceShell,
  type EmbeddedSurfaceHostEditor,
  type VerticalArrowDirection,
} from "./embedded-surface-arrow-navigation";
import type { CardOutlinerFocusIntent } from "./active-card-outliner-document";

const ActiveCardOutlinerDocument = lazy(() =>
  import("./active-card-outliner-document").then((module) => ({
    default: module.ActiveCardOutlinerDocument,
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
  readonly hostEditor?: EmbeddedSurfaceHostEditor;
}

export function CardOutlinerBlock({
  relationship,
  shellBlockId,
  targetBlockId,
  hostEditor,
  disclosureStore,
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
    disclosureKey: shellBlockId,
    expandable,
    disclosureStore,
    activationBudget,
    visibilityOverride,
  });
  const nextFocusIntentId = useRef(0);
  const projectedPointerIntent = useRef<{
    readonly clientX: number;
    readonly clientY: number;
  } | null>(null);
  const [focusIntent, setFocusIntent] = useState<CardOutlinerFocusIntent | null>(
    null,
  );
  const requestBoundaryFocus = useCallback((direction: VerticalArrowDirection) => {
    if (!expandable) return false;
    nextFocusIntentId.current += 1;
    activation.engageTitle();
    setFocusIntent({
      id: nextFocusIntentId.current,
      kind: "boundary",
      direction,
    });
    return true;
  }, [activation.engageTitle, expandable]);
  const requestPointerFocus = useCallback((clientX: number, clientY: number) => {
    if (!expandable) return false;
    nextFocusIntentId.current += 1;
    activation.engageTitle();
    setFocusIntent({
      id: nextFocusIntentId.current,
      kind: "pointer",
      clientX,
      clientY,
    });
    return true;
  }, [activation.engageTitle, expandable]);

  useEffect(() => {
    if (!hostEditor || !expandable) return;
    return registerEmbeddedSurfaceBoundaryHandle(hostEditor, shellBlockId, {
      focusBoundary: requestBoundaryFocus,
    });
  }, [expandable, hostEditor, requestBoundaryFocus, shellBlockId]);

  useEffect(() => {
    if (expandable) return;
    setFocusIntent(null);
  }, [expandable]);
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
  const handleProjectedPointerDown = (
    event: PointerEvent<HTMLButtonElement>,
  ): void => {
    projectedPointerIntent.current = {
      clientX: event.clientX,
      clientY: event.clientY,
    };
  };
  const editableProjectedTitle = target.status === "available" && expandable
    ? (
        <button
          type="button"
          data-card-outliner-title-trigger
          aria-label={`Edit ${plainTitle} title`}
          className="block w-full cursor-text text-left"
          onPointerDown={handleProjectedPointerDown}
          onClick={() => {
            const pointer = projectedPointerIntent.current;
            projectedPointerIntent.current = null;
            if (pointer) {
              requestPointerFocus(pointer.clientX, pointer.clientY);
              return;
            }
            requestBoundaryFocus("up");
          }}
        >
          {projectedTitle(target)}
        </button>
      )
    : projectedTitle(target);

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
            <ActiveCardOutlinerDocument
              target={target}
              rowProps={rowProps}
              hostRuntime={host}
              focusIntent={focusIntent}
              onFocusIntentConsumed={(intentId) => {
                setFocusIntent((current) =>
                  current?.id === intentId ? null : current,
                );
              }}
              onTitleFocus={() => {
                activation.engageTitle();
                activation.touch();
              }}
              onTitleBlur={activation.releaseTitle}
              onMoveToHostBoundary={(direction) =>
                hostEditor
                  ? moveFromEmbeddedSurfaceToHostNeighbor(
                      hostEditor,
                      shellBlockId,
                      direction,
                    )
                  : false
              }
              onEscapeToHostShell={() => {
                if (!hostEditor) return false;
                activation.releaseTitle();
                return selectEmbeddedSurfaceShell(hostEditor, shellBlockId);
              }}
            />
          </Suspense>
        ) : (
          <CardOutlinerRowSlots {...rowProps} title={editableProjectedTitle}>
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
  render: ({ block, editor }) => (
    <CardOutlinerBlock
      relationship="child"
      shellBlockId={block.id}
      targetBlockId={block.id}
      hostEditor={editor as unknown as EmbeddedSurfaceHostEditor}
    />
  ),
});

export const createCardRefBlockSpec = createReactBlockSpec(cardRefBlockConfig, {
  render: ({ block, editor }) => (
    <CardOutlinerBlock
      relationship="reference"
      shellBlockId={block.id}
      targetBlockId={block.props.targetBlockId}
      hostEditor={editor as unknown as EmbeddedSurfaceHostEditor}
    />
  ),
});
