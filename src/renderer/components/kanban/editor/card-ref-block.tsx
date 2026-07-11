import { lazy, Suspense } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import { Link2 } from "lucide-react";
import { CardReferenceSurface } from "@/components/block-documents/reference-block-surfaces";
import { useBlockReferenceHostRuntime } from "@/components/block-documents/block-reference-runtime-context";
import { useCardReferenceReadModel } from "@/lib/block-reference-queries";
import { cardRefBlockConfig } from "../../../../shared/block-documents/blocknote-schema-config";

const EmbeddedReferencedCardDocument = lazy(() =>
  import("./embedded-referenced-card-document").then((module) => ({
    default: module.EmbeddedReferencedCardDocument,
  })),
);

export const createCardRefBlockSpec = createReactBlockSpec(cardRefBlockConfig, {
  render: ({ block }) => {
    const host = useBlockReferenceHostRuntime();
    const targetBlockId = block.props.targetBlockId.trim();
    const requestingProjectId = host?.projectId ?? "";
    const reference = useCardReferenceReadModel(
      requestingProjectId,
      targetBlockId,
    );

    if (!targetBlockId) {
      return (
        <div
          contentEditable={false}
          className="flex min-h-8 items-center gap-2 py-1 text-sm text-token-description-foreground"
        >
          <Link2 aria-hidden="true" className="size-3.5 shrink-0" />
          <span>Invalid Card reference</span>
        </div>
      );
    }

    return (
      <CardReferenceSurface
        referenceKey={`card-ref:${host?.hostCardId ?? "unscoped"}:${block.id}:${targetBlockId}`}
        displayHint={block.props.displayHint}
        model={reference.data}
        loading={reference.loading}
        error={reference.error}
        legacy={false}
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
});
