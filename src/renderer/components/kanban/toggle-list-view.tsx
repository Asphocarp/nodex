import {
  lazy,
  Suspense,
  useDeferredValue,
  useMemo,
  type ReactNode,
} from "react";
import {
  ReferencedCardRow,
  type ReferencedPageDocumentRenderer,
} from "@/components/block-documents/reference-block-surfaces";
import type { BlockReferenceHostRuntime } from "@/components/block-documents/block-reference-runtime-context";
import {
  filterDbViewCards,
  getAvailableDisplayProperties,
  getDefaultDbViewPrefs,
  sortDbViewCards,
  type DbViewPrefs,
  type DbViewCardRecord,
} from "../../lib/db-view-prefs";
import {
  buildPageSearchText,
  matchesSearchTokens,
  tokenizeSearchQuery,
} from "@/lib/page-search";
import { resolveKanbanPriorityOption } from "@/lib/kanban-options";
import type { BlockDisclosureStateStore } from "@/lib/block-disclosure-state";
import type { ReferenceSurfaceActivationBudget } from "@/lib/reference-surface-state";
import { StatusIcon } from "@/lib/status-chip";
import { useKanban } from "@/lib/use-kanban";
import { cn } from "@/lib/utils";
import {
  TOGGLE_LIST_PROPERTY_KEYS,
  type ToggleListPropertyKey,
  type ToggleListStatusId,
} from "@/lib/toggle-list/types";
import { ToggleListScrollContainer } from "./view-scroll-containers";
import type { OpenPageStageOptions } from "./open-page-stage";
import { projectContentAccess } from "../../../shared/content-access-context";

const EmbeddedReferencedPageDocument = lazy(() =>
  import("./editor/embedded-referenced-page-document").then((module) => ({
    default: module.EmbeddedReferencedPageDocument,
  })),
);

const META_CHIP =
  "inline-flex h-5 shrink-0 items-center gap-1 rounded-sm bg-token-foreground/5 px-1.5 text-xs text-token-description-foreground";

interface ToggleListViewProps {
  projectId: string;
  databaseViewId: string;
  searchQuery: string;
  dbViewPrefs: DbViewPrefs | null;
  openPageStage?: (
    projectId: string,
    pageId: string,
    titleSnapshot?: string,
    options?: OpenPageStageOptions,
  ) => void;
  scrollStateKey?: string | null;
}

interface ToggleListReferenceRowsProps {
  readonly projectId: string;
  readonly disclosureScopeKey: string;
  readonly cards: readonly DbViewCardRecord[];
  readonly propertyOrder: readonly ToggleListPropertyKey[];
  readonly hiddenProperties: readonly ToggleListPropertyKey[];
  readonly showEmptyEstimate: boolean;
  readonly showEmptyPriority: boolean;
  readonly renderDocument: ReferencedPageDocumentRenderer;
  readonly onOpenPage?: (input: {
    projectId: string;
    pageId: string;
    titleSnapshot?: string;
  }) => void | Promise<void>;
  readonly disclosureStore?: BlockDisclosureStateStore;
  readonly activationBudget?: ReferenceSurfaceActivationBudget;
  /** Deterministic test/story seam; production uses IntersectionObserver. */
  readonly visibilityOverride?: boolean;
}

interface ToggleListRowMetadataProps {
  readonly card: DbViewCardRecord;
  readonly visibleProperties: readonly ToggleListPropertyKey[];
  readonly showEmptyEstimate: boolean;
  readonly showEmptyPriority: boolean;
}

function EmptyPropertyChip({ label }: { readonly label: string }) {
  return (
    <span
      className={cn(META_CHIP, "text-token-description-foreground/70")}
      title={label}
    >
      —
    </span>
  );
}

function renderToggleListProperty(
  card: DbViewCardRecord,
  property: ToggleListPropertyKey,
  showEmptyEstimate: boolean,
  showEmptyPriority: boolean,
): ReactNode {
  if (property === "priority") {
    const priority = resolveKanbanPriorityOption(card.priority);
    if (!priority) {
      return showEmptyPriority ? (
        <EmptyPropertyChip label="No priority" />
      ) : null;
    }
    return (
      <span
        className={cn(META_CHIP, priority.className)}
        title={priority.label}
      >
        {priority.shortLabel.split(" - ")[0]}
      </span>
    );
  }

  if (property === "estimate") {
    if (!card.estimate) {
      return showEmptyEstimate ? (
        <EmptyPropertyChip label="No estimate" />
      ) : null;
    }
    return <span className={META_CHIP}>{card.estimate.toUpperCase()}</span>;
  }

  if (property === "status") {
    return (
      <span className={META_CHIP} title={card.columnName}>
        <StatusIcon statusId={card.columnId} className="size-3.5!" />
        <span className="max-w-28 truncate">{card.columnName}</span>
      </span>
    );
  }

  return card.tags.map((tag) => (
    <span key={tag} className={META_CHIP} title={tag}>
      <span className="max-w-24 truncate">{tag}</span>
    </span>
  ));
}

function ToggleListRowMetadata({
  card,
  visibleProperties,
  showEmptyEstimate,
  showEmptyPriority,
}: ToggleListRowMetadataProps) {
  return (
    <span className="ml-auto flex max-w-[48%] shrink-0 items-center gap-1 overflow-hidden pl-2">
      {visibleProperties.map((property) => (
        <span key={property} className="contents">
          {renderToggleListProperty(
            card,
            property,
            showEmptyEstimate,
            showEmptyPriority,
          )}
        </span>
      ))}
    </span>
  );
}

/**
 * A Toggle List is a view over Page references. Rows intentionally receive
 * DatabasePageSummary values only; a Page's title/body become writable exclusively
 * inside its independently mounted document surface.
 */
export function ToggleListReferenceRows({
  projectId,
  disclosureScopeKey,
  cards,
  propertyOrder,
  hiddenProperties,
  showEmptyEstimate,
  showEmptyPriority,
  renderDocument,
  onOpenPage,
  disclosureStore,
  activationBudget,
  visibilityOverride,
}: ToggleListReferenceRowsProps) {
  const hidden = new Set(hiddenProperties);
  const visibleProperties = propertyOrder.filter(
    (property) => !hidden.has(property),
  );

  if (cards.length === 0) {
    return (
      <div className="flex min-h-32 items-center justify-center text-sm text-token-description-foreground">
        No Pages in this view
      </div>
    );
  }

  return (
    <div
      data-toggle-list-reference-rows="true"
      className="min-h-80 min-w-0"
      style={{ contentVisibility: "auto" }}
    >
      {cards.map((card) => (
        <ReferencedCardRow
          key={card.id}
          disclosureKey={`${disclosureScopeKey}:${card.id}`}
          projectId={projectId}
          card={card}
          canEdit={!card.archived}
          archived={card.archived}
          metadata={
            <ToggleListRowMetadata
              card={card}
              visibleProperties={visibleProperties}
              showEmptyEstimate={showEmptyEstimate}
              showEmptyPriority={showEmptyPriority}
            />
          }
          renderDocument={renderDocument}
          onOpenPage={onOpenPage}
          disclosureStore={disclosureStore}
          activationBudget={activationBudget}
          visibilityOverride={visibilityOverride}
        />
      ))}
    </div>
  );
}

export function ToggleListView({
  projectId,
  databaseViewId,
  searchQuery,
  dbViewPrefs,
  openPageStage,
  scrollStateKey,
}: ToggleListViewProps) {
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const { board, loading, error } = useKanban({
    projectId,
    databaseViewId,
  });
  const viewPrefs = dbViewPrefs ?? getDefaultDbViewPrefs("toggle-list");
  const displayProperties = useMemo(
    () =>
      getAvailableDisplayProperties("toggle-list").filter(
        (property): property is ToggleListPropertyKey =>
          TOGGLE_LIST_PROPERTY_KEYS.includes(property as ToggleListPropertyKey),
      ),
    [],
  );
  const propertyOrder = useMemo(
    () =>
      viewPrefs.display.propertyOrder.filter(
        (property): property is ToggleListPropertyKey =>
          displayProperties.includes(property as ToggleListPropertyKey),
      ),
    [displayProperties, viewPrefs.display.propertyOrder],
  );
  const hiddenProperties = useMemo(
    () =>
      viewPrefs.display.hiddenProperties.filter(
        (property): property is ToggleListPropertyKey =>
          displayProperties.includes(property as ToggleListPropertyKey),
      ),
    [displayProperties, viewPrefs.display.hiddenProperties],
  );

  const cards = useMemo<DbViewCardRecord[]>(() => {
    if (!board) return [];

    return board.columns.flatMap((column, columnIndex) =>
      column.cards.map((card, pageIndex) => ({
        ...card,
        columnId: column.id as ToggleListStatusId,
        columnName: column.name,
        boardIndex: columnIndex * 100_000 + pageIndex,
      })),
    );
  }, [board]);

  const filteredCards = useMemo(() => {
    const filteredByRules = filterDbViewCards(cards, viewPrefs.rules);
    const searchTokens = tokenizeSearchQuery(deferredSearchQuery);
    if (searchTokens.length === 0) return filteredByRules;
    return filteredByRules.filter((card) => {
      const searchable = `${buildPageSearchText(card)} ${card.columnName.toLowerCase()}`;
      return matchesSearchTokens(searchable, searchTokens);
    });
  }, [cards, deferredSearchQuery, viewPrefs.rules]);

  const visibleCards = useMemo(
    () => sortDbViewCards(filteredCards, viewPrefs.rules),
    [filteredCards, viewPrefs.rules],
  );

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="text-sm text-(--foreground-secondary)">
          Loading toggle list...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="text-sm text-(--destructive)">Error: {error}</div>
      </div>
    );
  }

  if (!board) return null;

  const onOpenReferencedCard = openPageStage
    ? ({
        projectId: targetProjectId,
        pageId,
        titleSnapshot,
      }: {
        projectId: string;
        pageId: string;
        titleSnapshot?: string;
      }) => openPageStage(targetProjectId, pageId, titleSnapshot)
    : undefined;
  const hostRuntime: BlockReferenceHostRuntime = {
    contentAccessContext: projectContentAccess(projectId),
    projectId,
    projectName: null,
    projectWorkspacePath: null,
    hostPageId: null,
    ancestorPageIds: [],
    ancestorDocumentOwnerBlockIds: [],
    isActiveSurface: true,
    ...(onOpenReferencedCard ? { openPage: onOpenReferencedCard } : {}),
  };

  return (
    <ToggleListScrollContainer scrollStateKey={scrollStateKey}>
      <div className="px-4">
        <section className="nodex-toggle-list-editor-shell rounded-lg border-[0.5px] border-(--border) bg-(--card) px-3.5 pt-3 pb-4">
          <ToggleListReferenceRows
            projectId={projectId}
            disclosureScopeKey={`toggle-list:${databaseViewId}`}
            cards={visibleCards}
            propertyOrder={propertyOrder}
            hiddenProperties={hiddenProperties}
            showEmptyEstimate={viewPrefs.display.showEmptyEstimate}
            showEmptyPriority={viewPrefs.display.showEmptyPriority}
            onOpenPage={onOpenReferencedCard}
            renderDocument={({
              projectId: targetProjectId,
              card,
              isActive,
            }) => (
              <Suspense
                fallback={
                  <div className="py-2 text-sm text-token-description-foreground">
                    Opening Page…
                  </div>
                }
              >
                <EmbeddedReferencedPageDocument
                  projectId={targetProjectId}
                  card={card}
                  isActive={isActive}
                  hostRuntime={hostRuntime}
                />
              </Suspense>
            )}
          />
        </section>
      </div>
    </ToggleListScrollContainer>
  );
}
