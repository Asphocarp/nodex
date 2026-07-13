import {
  useEffect,
  useId,
  type FocusEventHandler,
  type PointerEventHandler,
  type ReactNode,
  type RefCallback,
} from "react";
import { ExternalLink } from "lucide-react";
import {
  ReferenceExpansionStore,
  ReferenceSurfaceActivationBudget,
  referenceExpansionStore,
  referenceSurfaceActivationBudget,
  useReferenceExpansion,
  useReferenceSurfaceActivation,
} from "@/lib/reference-surface-state";
import { useElementVisibility } from "@/lib/use-element-visibility";
import { cn } from "@/lib/utils";

export interface CardOutlinerStateDependencies {
  readonly expansionStore?: ReferenceExpansionStore;
  readonly activationBudget?: ReferenceSurfaceActivationBudget;
  /** Deterministic test/story seam; production always uses IntersectionObserver. */
  readonly visibilityOverride?: boolean;
}

export interface CardOutlinerActivation {
  readonly active: boolean;
  readonly expanded: boolean;
  readonly visible: boolean;
  readonly sectionRef: RefCallback<HTMLElement>;
  readonly setExpanded: (expanded: boolean) => void;
  readonly touch: () => void;
}

export const useCardOutlinerActivation = ({
  activationKey,
  expandable,
  expansionStore = referenceExpansionStore,
  activationBudget = referenceSurfaceActivationBudget,
  visibilityOverride,
}: CardOutlinerStateDependencies & {
  readonly activationKey: string;
  readonly expandable: boolean;
}): CardOutlinerActivation => {
  const surfaceInstanceId = useId();
  const surfaceInstanceKey = `${activationKey}:mount:${surfaceInstanceId}`;
  const [expanded, setExpanded] = useReferenceExpansion(
    surfaceInstanceKey,
    expansionStore,
  );
  const visibility = useElementVisibility();
  const visible = visibilityOverride ?? visibility.visible;
  const active = useReferenceSurfaceActivation(
    surfaceInstanceKey,
    expandable && expanded && visible,
    activationBudget,
  );
  useEffect(() => {
    if (expandable || !expanded) return;
    setExpanded(false);
  }, [expandable, expanded, setExpanded]);
  return {
    active,
    expanded,
    visible,
    sectionRef: visibility.ref,
    setExpanded,
    touch: () => activationBudget.touch(surfaceInstanceKey),
  };
};

export interface CardOutlinerFrameProps {
  readonly targetBlockId: string;
  readonly projectId?: string;
  readonly expanded: boolean;
  readonly active: boolean;
  readonly sectionRef?: RefCallback<HTMLElement>;
  readonly onTouch?: () => void;
  readonly children?: ReactNode;
}

/** The observed DOM anchor never changes while row content loads or activates. */
export function CardOutlinerFrame({
  targetBlockId,
  projectId,
  expanded,
  active,
  sectionRef,
  onTouch,
  children,
}: CardOutlinerFrameProps) {
  const handleFocus: FocusEventHandler<HTMLElement> = () => onTouch?.();
  const handlePointerDown: PointerEventHandler<HTMLElement> = () => onTouch?.();
  return (
    <section
      ref={sectionRef}
      contentEditable={false}
      data-card-outliner-target={targetBlockId}
      data-card-outliner-project={projectId}
      data-card-outliner-expanded={expanded ? "true" : "false"}
      data-card-outliner-active={active ? "true" : "false"}
      className="w-full min-w-0 self-stretch"
      onFocusCapture={handleFocus}
      onPointerDownCapture={handlePointerDown}
    >
      {children}
    </section>
  );
}

export interface CardOutlinerRowContentProps {
  readonly plainTitle: string;
  readonly title: ReactNode;
  readonly stateLabel?: string | null;
  readonly metadata?: ReactNode;
  readonly expanded: boolean;
  readonly expandable: boolean;
  readonly onExpandedChange: (expanded: boolean) => void;
  readonly onOpenCard?: () => void | Promise<void>;
  readonly children?: ReactNode;
}

export type CardOutlinerRowChromeProps = Omit<
  CardOutlinerRowContentProps,
  "title" | "children"
>;

interface CardOutlinerDisclosureProps extends CardOutlinerRowChromeProps {
  readonly children: ReactNode;
}

/** Owns the permanent disclosure control; target runtimes replace only its slots. */
export function CardOutlinerDisclosure({
  plainTitle,
  expanded,
  expandable,
  onExpandedChange,
  children,
}: CardOutlinerDisclosureProps) {
  return (
    <div
      className="bn-toggle-wrapper group/card-outliner grid! min-h-8 w-full min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-y-1 pt-1"
      data-show-children={expanded ? "true" : "false"}
    >
      <button
        type="button"
        data-card-outliner-caret
        aria-label={
          expanded ? `Collapse ${plainTitle}` : `Expand ${plainTitle}`
        }
        aria-expanded={expanded}
        disabled={!expandable}
        className={cn(
          "bn-toggle-button ms-0.5 shrink-0",
          expandable ? "cursor-pointer" : "cursor-default opacity-35",
        )}
        onClick={() => onExpandedChange(!expanded)}
      />
      {children}
    </div>
  );
}

export function CardOutlinerRowSlots({
  plainTitle,
  title,
  stateLabel,
  metadata,
  expanded,
  onOpenCard,
  children,
}: Omit<CardOutlinerRowContentProps, "expandable" | "onExpandedChange">) {
  return (
    <>
      <div className="col-start-2 row-start-1 flex min-h-6 min-w-0 items-start gap-1 pe-0.5 text-[1em] leading-6 text-token-text-primary">
        <div className="min-w-0 flex-1">{title}</div>
        {stateLabel ? (
          <span className="shrink-0 text-[11px] text-token-description-foreground">
            {stateLabel}
          </span>
        ) : null}
        {metadata}
        {onOpenCard ? (
          <button
            type="button"
            aria-label={`Open ${plainTitle}`}
            title="Open Card"
            className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-sm text-token-description-foreground opacity-0 group-hover/card-outliner:opacity-100 hover:bg-token-foreground/8 hover:text-token-text-primary focus-visible:opacity-100"
            onClick={() => void onOpenCard()}
          >
            <ExternalLink aria-hidden="true" className="size-3.5" />
          </button>
        ) : null}
      </div>

      {expanded ? (
        <div
          data-card-outliner-body
          className="col-span-2 col-start-1 row-start-2 w-full min-w-0 ps-6"
        >
          {children}
        </div>
      ) : null}
    </>
  );
}

export function CardOutlinerRowContent(props: CardOutlinerRowContentProps) {
  return (
    <CardOutlinerDisclosure {...props}>
      <CardOutlinerRowSlots {...props} />
    </CardOutlinerDisclosure>
  );
}

export interface CardOutlinerRowProps
  extends CardOutlinerFrameProps,
    CardOutlinerRowContentProps {}

/** Convenience composite for stories and simple consumers. */
export function CardOutlinerRow({
  targetBlockId,
  projectId,
  active,
  sectionRef,
  onTouch,
  ...content
}: CardOutlinerRowProps) {
  return (
    <CardOutlinerFrame
      targetBlockId={targetBlockId}
      projectId={projectId}
      expanded={content.expanded}
      active={active}
      sectionRef={sectionRef}
      onTouch={onTouch}
    >
      <CardOutlinerRowContent {...content} />
    </CardOutlinerFrame>
  );
}

export function CardOutlinerBodySkeleton() {
  return (
    <div
      role="status"
      aria-label="Opening Card content"
      className="space-y-2 py-1.5"
    >
      <div className="h-3 w-[72%] animate-pulse rounded-sm bg-token-foreground/8 motion-reduce:animate-none" />
      <div className="h-3 w-[48%] animate-pulse rounded-sm bg-token-foreground/8 motion-reduce:animate-none" />
    </div>
  );
}
