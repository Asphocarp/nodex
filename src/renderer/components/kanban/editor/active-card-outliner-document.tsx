import {
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import {
  BlockDocumentSurface,
  type BlockDocumentSurfaceValue,
} from "@/components/block-documents/block-document-surface";
import { BlockDocumentSyncStatus } from "@/components/block-documents/block-document-sync-status";
import {
  CardOutlinerBodySkeleton,
  CardOutlinerRowSlots,
  type CardOutlinerRowChromeProps,
} from "@/components/block-documents/card-outliner-surface";
import { CollaborativeCardTitle } from "@/components/block-documents/collaborative-card-title";
import { OwnedBlockDocumentBoundary } from "@/components/block-documents/owned-block-document-boundary";
import { PortableRichTitle } from "@/components/block-documents/portable-rich-title";
import type { BlockReferenceHostRuntime } from "@/components/block-documents/block-reference-runtime-context";
import { NodexButton } from "@/components/ui/button";
import type { AvailableCardOutlinerTarget } from "@/lib/card-outliner-target";
import {
  focusRichTitleDomAtPoint,
  focusRichTitleDomBoundary,
  isRichTitleDomSelectionAtVerticalBoundary,
} from "@/lib/rich-title-editor-dom";
import { useProjects } from "@/lib/use-projects";
import { resolveReferencedProjectContext } from "@/lib/referenced-project-context";
import type { VerticalArrowDirection } from "./embedded-surface-arrow-navigation";
import { NfmEditor, type NfmEditorBoundaryHandle } from "./nfm-editor";

export type CardOutlinerFocusIntent =
  | {
      readonly id: number;
      readonly kind: "boundary";
      readonly direction: VerticalArrowDirection;
    }
  | {
      readonly id: number;
      readonly kind: "pointer";
      readonly clientX: number;
      readonly clientY: number;
    };

export interface ActiveCardOutlinerDocumentProps {
  readonly target: AvailableCardOutlinerTarget;
  readonly rowProps: CardOutlinerRowChromeProps;
  readonly hostRuntime: BlockReferenceHostRuntime;
  readonly focusIntent: CardOutlinerFocusIntent | null;
  readonly onFocusIntentConsumed: (intentId: number) => void;
  readonly onTitleFocus: () => void;
  readonly onTitleBlur: () => void;
  readonly onMoveToHostBoundary: (direction: VerticalArrowDirection) => boolean;
  readonly onEscapeToHostShell: () => boolean;
}

const stopNestedEditorEvent = (event: SyntheticEvent): void => {
  event.stopPropagation();
};

const nestedEditorEventProps = {
  onBeforeInput: stopNestedEditorEvent,
  onClick: stopNestedEditorEvent,
  onDoubleClick: stopNestedEditorEvent,
  onDragStart: stopNestedEditorEvent,
  onDrop: stopNestedEditorEvent,
  onInput: stopNestedEditorEvent,
  onKeyDown: stopNestedEditorEvent,
  onPaste: stopNestedEditorEvent,
  onPointerDown: stopNestedEditorEvent,
} as const;

function ProjectedRow({
  target,
  rowProps,
  children,
}: {
  readonly target: AvailableCardOutlinerTarget;
  readonly rowProps: CardOutlinerRowChromeProps;
  readonly children: ReactNode;
}) {
  return (
    <CardOutlinerRowSlots
      {...rowProps}
      title={
        <PortableRichTitle
          value={target.card.content?.richTitle ?? []}
          fallback={target.card.content?.title.trim() || target.fallbackTitle}
        />
      }
    >
      {children}
    </CardOutlinerRowSlots>
  );
}

function CardOutlinerFailure({
  target,
  rowProps,
  error,
  reloading,
  reload,
}: Pick<ActiveCardOutlinerDocumentProps, "target" | "rowProps"> & {
  readonly error: { readonly message: string };
  readonly reloading: boolean;
  readonly reload: () => Promise<void>;
}) {
  return (
    <ProjectedRow target={target} rowProps={rowProps}>
      <div
        role="alert"
        className="flex min-h-8 items-center gap-2 py-1 text-sm"
      >
        <span className="min-w-0 flex-1 truncate text-token-error-foreground">
          {error.message || "Couldn’t open this collaborative content."}
        </span>
        <NodexButton
          type="button"
          size="xs"
          variant="secondary"
          disabled={reloading}
          onClick={() => void reload()}
        >
          {reloading ? "Retrying…" : "Retry"}
        </NodexButton>
      </div>
    </ProjectedRow>
  );
}

function ActiveCardOutlinerContent({
  target,
  rowProps,
  hostRuntime,
  targetProject,
  surface,
  focusIntent,
  onFocusIntentConsumed,
  onTitleFocus,
  onTitleBlur,
  onMoveToHostBoundary,
  onEscapeToHostShell,
}: ActiveCardOutlinerDocumentProps & {
  readonly targetProject: ReturnType<typeof resolveReferencedProjectContext>;
  readonly surface: BlockDocumentSurfaceValue;
}) {
  const titleRef = useRef<HTMLDivElement | null>(null);
  const bodyNavigationRef = useRef<NfmEditorBoundaryHandle | null>(null);

  useLayoutEffect(() => {
    if (!focusIntent) return;

    if (
      focusIntent.kind === "boundary"
      && focusIntent.direction === "up"
      && rowProps.expanded
    ) {
      if (!bodyNavigationRef.current?.focusBoundary("up")) return;
      onFocusIntentConsumed(focusIntent.id);
      return;
    }

    const title = titleRef.current;
    if (!title) return;
    if (focusIntent.kind === "pointer") {
      focusRichTitleDomAtPoint(
        title,
        focusIntent.clientX,
        focusIntent.clientY,
      );
    } else {
      focusRichTitleDomBoundary(
        title,
        focusIntent.direction === "down" ? "start" : "end",
      );
    }
    onFocusIntentConsumed(focusIntent.id);
  }, [focusIntent, onFocusIntentConsumed, rowProps.expanded]);

  const handleTitleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.isDefaultPrevented() || event.nativeEvent.isComposing) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;

    if (event.key === "Escape") {
      if (!onEscapeToHostShell()) return;
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const direction = event.key === "ArrowUp"
      ? "up"
      : event.key === "ArrowDown"
        ? "down"
        : null;
    if (!direction) return;
    const title = titleRef.current;
    if (!title || !isRichTitleDomSelectionAtVerticalBoundary(title, direction)) {
      return;
    }

    const moved = direction === "down" && rowProps.expanded
      ? bodyNavigationRef.current?.focusBoundary("down") ?? false
      : onMoveToHostBoundary(direction);
    if (!moved) return;
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <CardOutlinerRowSlots
      {...rowProps}
      metadata={
        <>
          {rowProps.metadata}
          <BlockDocumentSyncStatus
            runtime={surface.runtime}
            status={surface.status.provider}
          />
        </>
      }
      title={
        <div
          {...nestedEditorEventProps}
          data-embedded-surface-input="card-title"
        >
          <CollaborativeCardTitle
            ref={titleRef}
            title={surface.title}
            surfaceWriteFence={surface.runtime}
            className="px-0 py-0 text-[1em] leading-6 font-normal"
            aria-label={`Edit ${target.card.content?.title.trim() || target.fallbackTitle} title`}
            onKeyDown={handleTitleKeyDown}
            onFocus={onTitleFocus}
            onBlur={onTitleBlur}
          />
        </div>
      }
    >
      {rowProps.expanded ? (
        <div
          {...nestedEditorEventProps}
          data-embedded-card-document={target.card.blockId}
          className="w-full min-w-0"
        >
          <NfmEditor
            projectId={target.projectId}
            projectName={targetProject.projectName}
            projectWorkspacePath={targetProject.projectWorkspacePath}
            source={{
              kind: "collaborative-document",
              documentId: surface.documentId,
              storeEpoch: surface.descriptor.storeEpoch,
              generation: surface.descriptor.generation,
              clientSessionId: surface.clientSessionId,
              fragment: surface.body,
              user: { name: "You", color: "#3b82f6" },
              provider: { awareness: surface.awareness },
            }}
            sourceCardContext={{
              cardId: target.card.blockId,
            }}
            documentOwnerBlockId={target.card.blockId}
            surfaceWriteFence={surface.runtime}
            onOpenCard={hostRuntime.openCard}
            isActivePanelTab={hostRuntime.isActiveSurface}
            placeholder="Add a description…"
            className="min-h-0! min-w-0"
            embeddedBoundary={{
              navigationRef: bodyNavigationRef,
              onBoundaryArrow: (direction) => {
                if (direction === "down") {
                  return onMoveToHostBoundary("down");
                }
                const title = titleRef.current;
                if (!title) return false;
                focusRichTitleDomBoundary(title, "end");
                return true;
              },
            }}
          />
        </div>
      ) : null}
    </CardOutlinerRowSlots>
  );
}

/** One target Y.Doc supplies the active title and the disclosed body editor. */
export function ActiveCardOutlinerDocument({
  target,
  rowProps,
  hostRuntime,
  focusIntent,
  onFocusIntentConsumed,
  onTitleFocus,
  onTitleBlur,
  onMoveToHostBoundary,
  onEscapeToHostShell,
}: ActiveCardOutlinerDocumentProps) {
  const { projects } = useProjects();
  const targetProject = resolveReferencedProjectContext(
    target.projectId,
    projects,
  );
  const pending = (
    <ProjectedRow target={target} rowProps={rowProps}>
      <CardOutlinerBodySkeleton />
    </ProjectedRow>
  );

  return (
    <OwnedBlockDocumentBoundary
      projectId={target.projectId}
      ownerBlockId={target.card.blockId}
    >
      {(model, controls) => {
        if (model.status === "loading") return pending;
        if (model.status === "error") {
          return (
            <CardOutlinerFailure
              target={target}
              rowProps={rowProps}
              error={model.error}
              reloading={false}
              reload={controls.reload}
            />
          );
        }
        return (
          <BlockDocumentSurface
            projectId={target.projectId}
            descriptor={model.descriptor}
            isActive={hostRuntime.isActiveSurface}
            onReload={controls.reload}
            pendingFallback={pending}
            failureFallback={({ error, reloading, reload }) => (
              <CardOutlinerFailure
                target={target}
                rowProps={rowProps}
                error={error}
                reloading={reloading}
                reload={reload}
              />
            )}
            localAwarenessState={{
              user: { name: "You", color: "#3b82f6" },
              nodex: { embedded: true },
            }}
          >
            {(surface) => (
              <ActiveCardOutlinerContent
                target={target}
                rowProps={rowProps}
                hostRuntime={hostRuntime}
                targetProject={targetProject}
                surface={surface}
                focusIntent={focusIntent}
                onFocusIntentConsumed={onFocusIntentConsumed}
                onTitleFocus={onTitleFocus}
                onTitleBlur={onTitleBlur}
                onMoveToHostBoundary={onMoveToHostBoundary}
                onEscapeToHostShell={onEscapeToHostShell}
              />
            )}
          </BlockDocumentSurface>
        );
      }}
    </OwnedBlockDocumentBoundary>
  );
}
