import type { SyntheticEvent } from "react";

import { OwnedBlockDocumentSurface } from "@/components/block-documents/block-document-surface";
import { BlockDocumentSyncStatus } from "@/components/block-documents/block-document-sync-status";
import { RegisteredOwnedBlockDocumentBoundary } from "@/components/block-documents/owned-block-document-boundary";
import type { BlockReferenceHostRuntime } from "@/components/block-documents/block-reference-runtime-context";
import { NodexButton } from "@/components/ui/button";
import { resolveOwnedDocumentInlineMode } from "@/lib/owned-document-inline-mode";
import { NfmEditor } from "./nfm-editor";

export interface EmbeddedOwnedBlockDocumentProps {
  readonly projectId: string;
  readonly ownerBlockId: string;
  readonly isActive: boolean;
  readonly hostRuntime: BlockReferenceHostRuntime | null;
}

const stopNestedEditorEvent = (event: SyntheticEvent): void => {
  event.stopPropagation();
};

/**
 * Mounts a body-only owner's independent Y.Doc. Scene Documents deliberately
 * stop before provider creation: Canvas retains its own editor and view.
 */
export function EmbeddedOwnedBlockDocument({
  projectId,
  ownerBlockId,
  isActive,
  hostRuntime,
}: EmbeddedOwnedBlockDocumentProps) {
  return (
    <RegisteredOwnedBlockDocumentBoundary
      projectId={projectId}
      ownerBlockId={ownerBlockId}
    >
      {(model, controls) => {
        if (model.status === "loading") {
          return (
            <div
              role="status"
              className="py-2 text-sm text-token-description-foreground"
            >
              Opening collaborative content…
            </div>
          );
        }
        if (model.status === "error") {
          return (
            <div
              role="alert"
              className="flex min-h-8 items-center gap-2 py-1 text-sm text-token-error-foreground"
            >
              <span className="min-w-0 flex-1 truncate">
                {model.error.message}
              </span>
              <NodexButton
                type="button"
                size="xs"
                variant="secondary"
                onClick={() => void controls.reload()}
              >
                Retry
              </NodexButton>
            </div>
          );
        }
        if (resolveOwnedDocumentInlineMode(model.descriptor) === "scene_view") {
          return (
            <div
              role="note"
              data-owned-document-scene-redirect={ownerBlockId}
              className="py-2 text-sm text-token-description-foreground"
            >
              Canvas content opens in Canvas view, where its scene tools and
              collaboration model remain intact.
            </div>
          );
        }
        if (model.descriptor.sync.kind !== "yjs") {
          return (
            <div role="alert" className="py-2 text-sm text-token-error-foreground">
              This embedded Document does not use the Yjs editor engine.
            </div>
          );
        }

        return (
          <OwnedBlockDocumentSurface
            projectId={projectId}
            descriptor={{ ...model.descriptor, sync: model.descriptor.sync }}
            isActive={isActive}
            onReload={controls.reload}
            localAwarenessState={{
              user: { name: "You", color: "#3b82f6" },
              nodex: { embedded: true, ownerBlockId },
            }}
          >
            {(surface) => {
              if (surface.kind === "scene_graph") {
                throw new TypeError(
                  "Block-tree inline editor resolved a scene Document",
                );
              }
              return (
                <div
                  data-embedded-owned-document={ownerBlockId}
                  className="min-w-0 py-1"
                  onBeforeInput={stopNestedEditorEvent}
                  onClick={stopNestedEditorEvent}
                  onDoubleClick={stopNestedEditorEvent}
                  onDragStart={stopNestedEditorEvent}
                  onDrop={stopNestedEditorEvent}
                  onInput={stopNestedEditorEvent}
                  onKeyDown={stopNestedEditorEvent}
                  onPaste={stopNestedEditorEvent}
                  onPointerDown={stopNestedEditorEvent}
                >
                  <div className="flex min-h-0 justify-end pr-1">
                    <BlockDocumentSyncStatus
                      runtime={surface.runtime}
                      status={surface.status.provider}
                    />
                  </div>
                  <NfmEditor
                    projectId={projectId}
                    projectName={hostRuntime?.projectName}
                    projectWorkspacePath={
                      hostRuntime?.projectWorkspacePath ?? undefined
                    }
                    documentOwnerBlockId={ownerBlockId}
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
                    surfaceWriteFence={surface.runtime}
                    onOpenCard={hostRuntime?.openCard}
                    isActivePanelTab={isActive}
                    placeholder="Add content…"
                    className="min-w-0"
                  />
                </div>
              );
            }}
          </OwnedBlockDocumentSurface>
        );
      }}
    </RegisteredOwnedBlockDocumentBoundary>
  );
}
