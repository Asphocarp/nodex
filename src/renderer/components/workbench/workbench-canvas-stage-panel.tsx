import {
  lazy,
  Suspense,
  useEffect,
} from "react";

import { CanvasDocumentState } from "@/components/kanban/canvas-document-state";
import { makeCanvasSceneSurfaceKey } from "@/lib/canvas-scene-surface-runtime";
import { makeCanvasViewportPreferenceScope } from "@/lib/canvas-presentation-preference";
import { canvasDocumentSessionRegistry } from "@/lib/canvas-document-session";
import type { WorkbenchTabProjection } from "@/lib/types";
import { useLibraryCanvasTarget } from "@/lib/use-library-navigation";

const CanvasDocumentSurface = lazy(async () => {
  const module = await import(
    "@/components/canvas/canvas-document-surface"
  );
  return { default: module.CanvasDocumentSurface };
});

type CanvasStageTab = Extract<
  WorkbenchTabProjection,
  { readonly kind: "canvas_stage" }
>;

export function WorkbenchCanvasStagePanel({
  tab,
  windowSessionId,
  projectSessionId,
  isActivePanelTab,
  onClose,
  onTitleChange,
}: {
  readonly tab: CanvasStageTab;
  readonly windowSessionId: string;
  readonly projectSessionId: string;
  readonly isActivePanelTab: boolean;
  readonly onClose: () => void;
  readonly onTitleChange: (title: string) => void;
}) {
  const target = useLibraryCanvasTarget(
    tab.config.canvasBlockId,
    isActivePanelTab,
  );
  const summary = target.data?.value.status === "available"
    ? target.data.value.summary
    : null;

  useEffect(() => {
    if (!summary?.title || summary.title === tab.title) return;
    onTitleChange(summary.title);
  }, [onTitleChange, summary?.title, tab.title]);

  const targetStatus = target.data?.value.status;
  useEffect(() => {
    if (targetStatus !== "deleted") return;
    void canvasDocumentSessionRegistry
      .retireOwner(tab.config.projectId, tab.config.canvasBlockId)
      .catch(() => undefined);
  }, [tab.config.canvasBlockId, tab.config.projectId, targetStatus]);

  if (target.isPending) {
    return <CanvasDocumentState status="loading" label="Opening Canvas…" />;
  }
  if (target.isError) {
    return (
      <CanvasDocumentState
        status="error"
        message={
          target.error instanceof Error
            ? target.error.message
            : "Canvas could not be opened"
        }
        onRetry={() => void target.refetch()}
      />
    );
  }
  if (!summary) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 bg-token-main-surface-primary px-6 text-center">
        <p className="text-sm text-token-text-secondary">
          {targetStatus === "deleted"
            ? "This Canvas has been deleted."
            : "This Canvas is no longer available."}
        </p>
        <button
          type="button"
          className="text-sm text-token-text-primary underline underline-offset-4"
          onClick={onClose}
        >
          Close tab
        </button>
      </div>
    );
  }

  return (
    <Suspense
      fallback={<CanvasDocumentState status="loading" label="Opening Canvas…" />}
    >
      <CanvasDocumentSurface
        projectId={tab.config.projectId}
        canvasBlockId={tab.config.canvasBlockId}
        surfaceKey={makeCanvasSceneSurfaceKey(
          windowSessionId,
          projectSessionId,
          tab.id,
        )}
        viewportPreferenceScope={makeCanvasViewportPreferenceScope({
          variant: "stage",
          windowSessionId,
          projectSessionId,
        })}
        variant="stage"
        active={isActivePanelTab}
      />
    </Suspense>
  );
}
