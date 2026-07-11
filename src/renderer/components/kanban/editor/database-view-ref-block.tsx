import { lazy, Suspense } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import { useBlockReferenceHostRuntime } from "@/components/block-documents/block-reference-runtime-context";
import { DatabaseViewReferenceSurface } from "@/components/block-documents/reference-block-surfaces";
import { useDatabaseViewReadModel } from "@/lib/block-reference-queries";
import { databaseViewRefBlockConfig } from "../../../../shared/block-documents/blocknote-schema-config";

const EmbeddedReferencedCardDocument = lazy(() =>
  import("./embedded-referenced-card-document").then((module) => ({
    default: module.EmbeddedReferencedCardDocument,
  })),
);

/** A durable View reference; query rows never become host ProseMirror children. */
export const createDatabaseViewRefBlockSpec = createReactBlockSpec(
  databaseViewRefBlockConfig,
  {
    render: ({ block }) => {
      const host = useBlockReferenceHostRuntime();
      const databaseViewId = block.props.databaseViewId.trim();
      const view = useDatabaseViewReadModel(
        host?.projectId ?? "",
        databaseViewId,
        host?.hostCardId ?? undefined,
      );
      return (
        <DatabaseViewReferenceSurface
          referenceKey={`database-view-ref:${host?.hostCardId ?? "unscoped"}:${block.id}:${databaseViewId}`}
          displayHint={block.props.displayHint}
          model={view.data}
          loading={view.loading}
          error={view.error}
          hostCardId={host?.hostCardId}
          ancestorCardIds={host?.ancestorCardIds}
          onOpenCard={host?.openCard}
          renderDocument={({ projectId, card, isActive }) => (
            <Suspense
              fallback={
                <div className="py-2 text-sm text-token-description-foreground">
                  Opening Card…
                </div>
              }
            >
              <EmbeddedReferencedCardDocument
                projectId={projectId}
                card={card}
                isActive={isActive && (host?.isActiveSurface ?? true)}
                hostRuntime={host}
              />
            </Suspense>
          )}
        />
      );
    },
  },
);
