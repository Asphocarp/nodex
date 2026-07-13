import type { ReactNode, SyntheticEvent } from "react";
import { BlockDocumentSurface } from "@/components/block-documents/block-document-surface";
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
import { useProjects } from "@/lib/use-projects";
import { resolveReferencedProjectContext } from "@/lib/referenced-project-context";
import { NfmEditor } from "./nfm-editor";

export interface ExpandedCardOutlinerDocumentProps {
  readonly target: AvailableCardOutlinerTarget;
  readonly rowProps: CardOutlinerRowChromeProps;
  readonly hostRuntime: BlockReferenceHostRuntime;
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
}: Pick<ExpandedCardOutlinerDocumentProps, "target" | "rowProps"> & {
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

/** One target Y.Doc supplies both the outliner title row and body editor. */
export function ExpandedCardOutlinerDocument({
  target,
  rowProps,
  hostRuntime,
}: ExpandedCardOutlinerDocumentProps) {
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
                  <div {...nestedEditorEventProps}>
                    <CollaborativeCardTitle
                      title={surface.title}
                      surfaceWriteFence={surface.runtime}
                      className="px-0 py-0 text-[1em] leading-6 font-normal"
                      aria-label={`Edit ${target.card.content?.title.trim() || target.fallbackTitle} title`}
                    />
                  </div>
                }
              >
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
                  />
                </div>
              </CardOutlinerRowSlots>
            )}
          </BlockDocumentSurface>
        );
      }}
    </OwnedBlockDocumentBoundary>
  );
}
