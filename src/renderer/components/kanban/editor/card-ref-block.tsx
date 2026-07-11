import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { createReactBlockSpec } from "@blocknote/react";
import { Link2, Search } from "lucide-react";
import { CardReferenceSurface } from "@/components/block-documents/reference-block-surfaces";
import { useBlockReferenceHostRuntime } from "@/components/block-documents/block-reference-runtime-context";
import { useAllBoards } from "@/lib/use-all-boards";
import { useCardReferenceReadModel } from "@/lib/block-reference-queries";
import type { CardSummary } from "@/lib/types";
import { cardRefBlockConfig } from "../../../../shared/block-documents/blocknote-schema-config";

const EmbeddedReferencedCardDocument = lazy(() =>
  import("./embedded-referenced-card-document").then((module) => ({
    default: module.EmbeddedReferencedCardDocument,
  })),
);

function CardPicker({
  onSelect,
}: {
  readonly onSelect: (card: CardSummary) => void;
}) {
  const { boards, loading } = useAllBoards();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const filtered = useMemo(() => {
    const all: Array<{
      projectName: string;
      columnName: string;
      card: CardSummary;
    }> = [];
    for (const [projectId, board] of boards) {
      for (const column of board.columns) {
        for (const card of column.cards) {
          all.push({ projectName: projectId, columnName: column.name, card });
        }
      }
    }
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return all.slice(0, 20);
    return all
      .filter(({ card }) => card.title.toLowerCase().includes(normalizedQuery))
      .slice(0, 20);
  }, [boards, query]);

  return (
    <section contentEditable={false} className="py-1">
      <header className="flex min-h-8 items-center gap-2 text-sm text-token-description-foreground">
        <Link2 aria-hidden="true" className="size-3.5 shrink-0" />
        <span>Choose a Card</span>
      </header>
      <div className="rounded-lg bg-token-foreground/5 p-1">
        <div className="flex items-center gap-1.5 px-2 py-1">
          <Search
            aria-hidden="true"
            className="size-3.5 shrink-0 text-token-description-foreground"
          />
          <input
            ref={inputRef}
            type="text"
            className="min-w-0 flex-1 border-none bg-transparent py-1 text-sm text-token-text-primary outline-none placeholder:text-token-description-foreground"
            placeholder="Search Cards…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="max-h-52 overflow-y-auto">
          {loading ? (
            <div className="px-2 py-2 text-sm text-token-description-foreground">
              Loading Cards…
            </div>
          ) : null}
          {!loading && filtered.length === 0 ? (
            <div className="px-2 py-2 text-sm text-token-description-foreground">
              No Cards found
            </div>
          ) : null}
          {filtered.map((item) => (
            <button
              key={item.card.id}
              type="button"
              className="flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-left hover:bg-token-foreground/10"
              onClick={() => onSelect(item.card)}
            >
              <span className="min-w-0 flex-1 truncate text-sm text-token-text-primary">
                {item.card.title.trim() || "Untitled"}
              </span>
              <span className="shrink-0 text-xs text-token-description-foreground">
                {item.projectName} · {item.columnName}
              </span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

export const createCardRefBlockSpec = createReactBlockSpec(cardRefBlockConfig, {
  render: ({ block, editor }) => {
    const host = useBlockReferenceHostRuntime();
    const canonicalTargetId = block.props.targetBlockId.trim();
    const legacyTargetId = block.props.cardId.trim();
    const targetBlockId = canonicalTargetId || legacyTargetId;
    const requestingProjectId =
      host?.projectId ?? block.props.sourceProjectId.trim() ?? "";
    const reference = useCardReferenceReadModel(
      requestingProjectId,
      targetBlockId,
    );

    if (!targetBlockId) {
      return (
        <CardPicker
          onSelect={(card) => {
            editor.updateBlock(block, {
              props: {
                targetBlockId: card.id,
                displayHint: card.title.slice(0, 512),
                sourceProjectId: "",
                cardId: "",
              },
            });
          }}
        />
      );
    }

    return (
      <CardReferenceSurface
        referenceKey={`card-ref:${host?.hostCardId ?? "unscoped"}:${block.id}:${targetBlockId}`}
        displayHint={block.props.displayHint}
        model={reference.data}
        loading={reference.loading}
        error={reference.error}
        legacy={!canonicalTargetId}
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
