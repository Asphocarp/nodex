import { lazy, Suspense } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import { useBlockReferenceHostRuntime } from "@/components/block-documents/block-reference-runtime-context";
import { DatabaseViewReferenceSurface } from "@/components/block-documents/reference-block-surfaces";
import { useDatabaseViewReadModel } from "@/lib/block-reference-queries";
import { databaseViewRefBlockConfig } from "../../../../shared/block-documents/blocknote-schema-config";
import { libraryContentAccess } from "../../../../shared/content-access-context";

const EmbeddedReferencedPageDocument = lazy(() =>
  import("./embedded-referenced-page-document").then((module) => ({
    default: module.EmbeddedReferencedPageDocument,
  })),
);

function DatabaseViewRefBlock({
  blockId,
  databaseViewId,
  displayHint,
}: {
  blockId: string;
  databaseViewId: string;
  displayHint: string;
}) {
  const host = useBlockReferenceHostRuntime();
  const view = useDatabaseViewReadModel(
    host?.contentAccessContext ?? libraryContentAccess,
    host ? databaseViewId.trim() : "",
    host?.hostPageId ?? undefined,
  );
  return (
    <DatabaseViewReferenceSurface
      referenceKey={`database-view-ref:${blockId}`}
      displayHint={displayHint}
      model={view.data}
      documentScopeId={host?.documentScopeId ?? ""}
      loading={view.loading}
      error={view.error}
      hostPageId={host?.hostPageId}
      ancestorPageIds={host?.ancestorPageIds}
      onOpenPage={host?.openPage}
      renderDocument={({ projectId, card, isActive }) => (
        <Suspense
          fallback={
            <div className="py-2 text-sm text-token-description-foreground">
              Opening Page…
            </div>
          }
        >
          <EmbeddedReferencedPageDocument
            documentScopeId={host?.documentScopeId ?? projectId}
            card={card}
            isActive={isActive && (host?.isActiveSurface ?? true)}
            hostRuntime={host}
          />
        </Suspense>
      )}
    />
  );
}

/** A durable View reference; query rows never become host ProseMirror children. */
export const createDatabaseViewRefBlockSpec = createReactBlockSpec(
  databaseViewRefBlockConfig,
  {
    render: ({ block }) => (
      <DatabaseViewRefBlock
        blockId={block.id}
        databaseViewId={block.props.databaseViewId}
        displayHint={block.props.displayHint}
      />
    ),
  },
);
